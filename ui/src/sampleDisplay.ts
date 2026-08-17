import { clamp, parseCssColorToHex, toHex } from "./color";

type SampleEntry = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
};

const drawn = new Map<string, SampleEntry>();
const loading = new Map<string, Promise<SampleEntry | null>>();
const gradientCache = new Map<string, SampleEntry>();

function pixelAt(entry: SampleEntry, nx: number, ny: number): string {
  const x = clamp(Math.round(nx * (entry.w - 1)), 0, entry.w - 1);
  const y = clamp(Math.round(ny * (entry.h - 1)), 0, entry.h - 1);
  const [r, g, b] = entry.ctx.getImageData(x, y, 1, 1).data;
  return toHex(r, g, b);
}

function drawImage(img: CanvasImageSource, key: string, w: number, h: number): SampleEntry | null {
  const hit = drawn.get(key);
  if (hit) return hit;
  if (w < 1 || h < 1) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    ctx.getImageData(0, 0, 1, 1);
  } catch {
    return null;
  }
  const entry = { ctx, w, h };
  drawn.set(key, entry);
  return entry;
}

function loadUrl(url: string): Promise<SampleEntry | null> {
  const hit = drawn.get(url);
  if (hit) return Promise.resolve(hit);
  const pending = loading.get(url);
  if (pending) return pending;
  const job = new Promise<SampleEntry | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      loading.delete(url);
      resolve(drawImage(img, url, img.naturalWidth, img.naturalHeight));
    };
    img.onerror = () => {
      loading.delete(url);
      resolve(null);
    };
    img.src = url;
  });
  loading.set(url, job);
  return job;
}

function sampleImgElement(img: HTMLImageElement, clientX: number, clientY: number): string | null {
  const rect = img.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
  const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
  const key = img.currentSrc || img.src;
  const entry =
    drawImage(img, key, img.naturalWidth, img.naturalHeight) ?? drawn.get(key);
  if (!entry) {
    if (key) void loadUrl(key);
    return null;
  }
  return pixelAt(entry, nx, ny);
}

function sampleUrlAt(
  url: string,
  clientX: number,
  clientY: number,
  rect: DOMRect,
): string | null {
  if (rect.width < 1 || rect.height < 1) return null;
  const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
  const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
  const entry = drawn.get(url);
  if (!entry) {
    void loadUrl(url);
    return null;
  }
  return pixelAt(entry, nx, ny);
}

function sampleGradient(
  el: HTMLElement,
  backgroundImage: string,
  clientX: number,
  clientY: number,
): string | null {
  const rect = el.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const cacheKey = `${w}x${h}|${backgroundImage}`;
  let entry = gradientCache.get(cacheKey);
  if (!entry) {
    const m = backgroundImage.match(
      /linear-gradient\(\s*([-\d.]+)deg\s*,\s*([^,]+)\s*,\s*([^)]+)\)/i,
    );
    if (!m) return parseCssColorToHex(getComputedStyle(el).backgroundColor);
    const angle = Number(m[1]);
    const from = m[2].trim();
    const to = m[3].trim();
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    // CSS 0deg is upward; convert to a centered gradient line.
    const rad = (angle * Math.PI) / 180;
    const length = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
    const cx = w / 2;
    const cy = h / 2;
    const dx = Math.sin(rad) * (length / 2);
    const dy = -Math.cos(rad) * (length / 2);
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    g.addColorStop(0, from);
    g.addColorStop(1, to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    entry = { ctx, w, h };
    gradientCache.set(cacheKey, entry);
  }
  const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
  const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
  return pixelAt(entry, nx, ny);
}

function sampleStageBackground(el: HTMLElement, clientX: number, clientY: number): string | null {
  const cs = getComputedStyle(el);
  if (cs.backgroundImage && cs.backgroundImage !== "none" && cs.backgroundImage.includes("gradient")) {
    return sampleGradient(el, cs.backgroundImage, clientX, clientY);
  }
  return parseCssColorToHex(cs.backgroundColor);
}

function sampleClip(clip: HTMLElement, clientX: number, clientY: number): string | null {
  const url = clip.dataset.sampleSrc;
  if (url) return sampleUrlAt(url, clientX, clientY, clip.getBoundingClientRect());
  return parseCssColorToHex(getComputedStyle(clip).backgroundColor);
}

/** Preload any on-screen Source / Frame images so the first hover can sample. */
export function warmSampleCache() {
  document.querySelectorAll<HTMLImageElement>("img.overlay-plate, img.overlay-onion").forEach((img) => {
    const key = img.currentSrc || img.src;
    if (key && !drawn.has(key)) {
      if (img.complete && img.naturalWidth) drawImage(img, key, img.naturalWidth, img.naturalHeight);
      else void loadUrl(key);
    }
  });
  document.querySelectorAll<HTMLElement>("[data-sample-src]").forEach((el) => {
    const url = el.dataset.sampleSrc;
    if (url && !drawn.has(url)) void loadUrl(url);
  });
}

function isSampleableNode(el: Element): boolean {
  if (el instanceof HTMLImageElement &&
    (el.classList.contains("overlay-plate") || el.classList.contains("overlay-onion"))) {
    return true;
  }
  if (el instanceof HTMLElement &&
    (el.classList.contains("comp-screen-clip") ||
      el.classList.contains("comp-device") ||
      el.classList.contains("comp-stage"))) {
    return true;
  }
  return el instanceof HTMLIFrameElement && Boolean(el.closest(".comp-screen-clip"));
}

export function hasSampleableSurface(clientX: number, clientY: number): boolean {
  return document.elementsFromPoint(clientX, clientY).some(isSampleableNode);
}

/** Actual displayed color under the cursor, or null if it is not a sampleable image. */
export function sampleDisplayAt(clientX: number, clientY: number): string | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (el instanceof HTMLImageElement &&
      (el.classList.contains("overlay-plate") || el.classList.contains("overlay-onion"))) {
      return sampleImgElement(el, clientX, clientY);
    }
    if (el instanceof HTMLElement && el.classList.contains("comp-screen-clip")) {
      return sampleClip(el, clientX, clientY);
    }
    if (el instanceof HTMLIFrameElement) {
      const clip = el.closest(".comp-screen-clip");
      if (clip instanceof HTMLElement) return sampleClip(clip, clientX, clientY);
    }
    if (el instanceof HTMLElement && el.classList.contains("comp-device")) {
      return (
        parseCssColorToHex(getComputedStyle(el).backgroundColor) ??
        sampleStageBackground(el.closest(".comp-stage") ?? el, clientX, clientY)
      );
    }
    if (el instanceof HTMLElement && el.classList.contains("comp-stage")) {
      return sampleStageBackground(el, clientX, clientY);
    }
  }
  return null;
}
