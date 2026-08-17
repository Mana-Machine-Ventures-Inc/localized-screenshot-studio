import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { TextSlot } from "../types.js";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function clampRegion(
  left: number,
  top: number,
  width: number,
  height: number,
  W: number,
  H: number,
): { left: number; top: number; width: number; height: number } | null {
  const l = Math.max(0, Math.min(W - 1, Math.round(left)));
  const t = Math.max(0, Math.min(H - 1, Math.round(top)));
  const w = Math.max(1, Math.min(W - l, Math.round(width)));
  const h = Math.max(1, Math.min(H - t, Math.round(height)));
  if (w < 1 || h < 1) return null;
  return { left: l, top: t, width: w, height: h };
}

/** Average color of a region (returns null if out of bounds). */
async function avgColor(
  src: string | Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<Rgb | null> {
  try {
    const { data } = await sharp(src)
      .extract(region)
      .resize(1, 1, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { r: data[0], g: data[1], b: data[2] };
  } catch {
    return null;
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Estimate the background color behind a text box by sampling strips just
 * outside each edge and taking the per-channel median (robust to one strip
 * catching an adjacent icon).
 */
export async function sampleBackgroundColor(
  src: string | Buffer,
  boxPx: { x: number; y: number; w: number; h: number },
  W: number,
  H: number,
): Promise<string> {
  const band = Math.max(3, Math.round(boxPx.h * 0.5));
  const candidates = [
    clampRegion(boxPx.x, boxPx.y - band - 2, boxPx.w, band, W, H), // above
    clampRegion(boxPx.x, boxPx.y + boxPx.h + 2, boxPx.w, band, W, H), // below
    clampRegion(boxPx.x - band - 2, boxPx.y, band, boxPx.h, W, H), // left
    clampRegion(boxPx.x + boxPx.w + 2, boxPx.y, band, boxPx.h, W, H), // right
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  const colors: Rgb[] = [];
  for (const region of candidates) {
    const c = await avgColor(src, region);
    if (c) colors.push(c);
  }
  if (!colors.length) return "#ffffff";
  return toHex({
    r: median(colors.map((c) => c.r)),
    g: median(colors.map((c) => c.g)),
    b: median(colors.map((c) => c.b)),
  });
}

function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminanceRgb({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  return rgb ? luminanceRgb(rgb) : 1;
}

function colorDist(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function estimateWeight(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  bg: Rgb,
  threshold: number,
): number {
  const runs: number[] = [];
  for (let y = 0; y < height; y++) {
    let run = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const ink =
        colorDist({ r: data[i], g: data[i + 1], b: data[i + 2] }, bg) >=
        threshold;
      if (ink) run += 1;
      else if (run >= 2) {
        runs.push(run);
        run = 0;
      } else run = 0;
    }
    if (run >= 2) runs.push(run);
  }
  if (runs.length < 8) return 400;
  const sorted = [...runs].sort((a, b) => a - b);
  const stem = sorted[Math.floor(sorted.length * 0.35)];
  const ratio = stem / Math.max(1, height);
  if (ratio < 0.145) return 400;
  if (ratio < 0.185) return 500;
  if (ratio < 0.23) return 600;
  return 700;
}

/**
 * Sample glyph appearance: the blended ink color (so frosted white stays
 * slightly blue) and a weight from stem thickness.
 */
export async function sampleGlyphStyle(
  src: string | Buffer,
  boxPx: { x: number; y: number; w: number; h: number },
  backgroundHex: string,
  W: number,
  H: number,
): Promise<{ color: string; weight: number }> {
  const insetX = boxPx.w * 0.08;
  const insetY = boxPx.h * 0.1;
  const region = clampRegion(
    boxPx.x + insetX,
    boxPx.y + insetY,
    boxPx.w - insetX * 2,
    boxPx.h - insetY * 2,
    W,
    H,
  );
  const fallback = {
    color: contrastTextColor(backgroundHex),
    weight: 400,
  };
  if (!region) return fallback;
  const bg = hexToRgb(backgroundHex);
  if (!bg) return fallback;

  try {
    const { data, info } = await sharp(src)
      .extract(region)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const ink: Rgb[] = [];
    const threshold = 22;
    for (let i = 0; i < data.length; i += ch) {
      const p = { r: data[i], g: data[i + 1], b: data[i + 2] };
      if (colorDist(p, bg) >= threshold) ink.push(p);
    }
    if (ink.length < 12) return fallback;
    ink.sort((a, b) => luminanceRgb(a) - luminanceRgb(b));
    const lo = Math.floor(ink.length * 0.15);
    const hi = Math.ceil(ink.length * 0.85);
    const body = ink.slice(lo, Math.max(lo + 1, hi));
    return {
      color: toHex({
        r: median(body.map((c) => c.r)),
        g: median(body.map((c) => c.g)),
        b: median(body.map((c) => c.b)),
      }),
      weight: estimateWeight(
        data,
        info.width,
        info.height,
        ch,
        bg,
        threshold,
      ),
    };
  } catch {
    return fallback;
  }
}

/** Pick a legible text color (dark on light, light on dark) for a background. */
export function contrastTextColor(bgHex: string): string {
  return luminance(bgHex) > 0.55 ? "#111111" : "#ffffff";
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/&/g, "&amp;");
}

/**
 * Build the clean plate: paint a solid rectangle over each masked slot so the
 * original text disappears, leaving a reusable background.
 */
export async function buildPlate(
  sourcePath: string,
  slots: TextSlot[],
  outPath: string,
): Promise<{ width: number; height: number }> {
  const meta = await sharp(sourcePath).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;

  const composites = slots
    .filter((s) => s.mask.mode === "solid")
    .map((s) => {
      const padPx = Math.round(s.mask.padding * H);
      const region = clampRegion(
        s.box.x * W - padPx,
        s.box.y * H - padPx,
        s.box.w * W + padPx * 2,
        s.box.h * H + padPx * 2,
        W,
        H,
      );
      if (!region) return null;
      const r = Math.max(0, Math.min(region.width / 2, s.mask.radius));
      const svg = `<svg width="${region.width}" height="${region.height}" xmlns="http://www.w3.org/2000/svg"><rect width="${region.width}" height="${region.height}" rx="${r}" ry="${r}" fill="${escapeAttr(s.mask.color)}"/></svg>`;
      return { input: Buffer.from(svg), left: region.left, top: region.top };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Keep source alpha (Mac window shadows) so compose can blend onto the promo bg.
  await sharp(sourcePath)
    .ensureAlpha()
    .composite(composites)
    .png()
    .toFile(outPath);
  return { width: W, height: H };
}
