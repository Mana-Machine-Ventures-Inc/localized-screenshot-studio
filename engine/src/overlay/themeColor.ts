import sharp from "sharp";
import { contrastTextColor } from "./plate.js";

export interface FrameTheme {
  /** Promo-frame fill derived from the screenshot's dominant theme color. */
  background: { type: "solid"; color: string };
  /** Readable headline color against that background. */
  headlineColor: string;
  /** Hex that won the sampling contest (for diagnostics / UI). */
  sampledColor: string;
  /** 0..1 saturation of the winning sample. */
  saturation: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function luminance({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** HSL saturation 0..1 (relative to max channel range). */
function saturation({ r, g, b }: Rgb): number {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/**
 * Score a candidate for use as an App Store promo-frame background.
 * Prefers saturated "theme" colors over gray UI chrome / white content.
 */
function themeScore(c: Rgb): number {
  const sat = saturation(c);
  const lum = luminance(c);
  // Penalize near-white / near-black (status bars, bezels, content plates).
  const midBias = 1 - Math.abs(lum - 0.42) * 1.4;
  const mid = Math.max(0, midBias);
  return sat * 2.2 + mid * 0.35 + sat * mid;
}

async function avgRegion(
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

/**
 * Derive a per-screenshot promo-frame background + headline color.
 *
 * Samples a top band (where app chrome / theme gradients usually live) plus
 * inset corners, then picks the most theme-like (saturated) color. Headline
 * color is pure contrast against that fill — matching compositions like a
 * magenta Candy theme with white marketing copy.
 */
export async function sampleFrameTheme(
  src: string | Buffer,
): Promise<FrameTheme> {
  const meta = await sharp(src).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;

  const candidates: Rgb[] = [];
  const push = async (
    left: number,
    top: number,
    width: number,
    height: number,
  ) => {
    const l = Math.max(0, Math.min(W - 1, Math.round(left)));
    const t = Math.max(0, Math.min(H - 1, Math.round(top)));
    const w = Math.max(1, Math.min(W - l, Math.round(width)));
    const h = Math.max(1, Math.min(H - t, Math.round(height)));
    const c = await avgRegion(src, { left: l, top: t, width: w, height: h });
    if (c) candidates.push(c);
  };

  // Top band: ~10% of height, five horizontal tiles (theme often lives here).
  const bandH = Math.max(8, Math.round(H * 0.1));
  const tileW = Math.max(8, Math.round(W / 5));
  for (let i = 0; i < 5; i++) {
    await push(i * tileW, 0, tileW, bandH);
  }
  // Slightly lower strip — skips thin status-bar white on some captures.
  const band2Top = Math.round(H * 0.06);
  const band2H = Math.max(8, Math.round(H * 0.08));
  for (let i = 0; i < 5; i++) {
    await push(i * tileW, band2Top, tileW, band2H);
  }

  // Inset corners (avoid pure bezel black on framed device shots).
  const inset = Math.round(Math.min(W, H) * 0.04);
  const corner = Math.max(12, Math.round(Math.min(W, H) * 0.08));
  await push(inset, inset, corner, corner);
  await push(W - inset - corner, inset, corner, corner);
  await push(inset, H - inset - corner, corner, corner);
  await push(W - inset - corner, H - inset - corner, corner, corner);

  if (!candidates.length) {
    const fallback = "#1f6feb";
    return {
      background: { type: "solid", color: fallback },
      headlineColor: "#ffffff",
      sampledColor: fallback,
      saturation: 0,
    };
  }

  let best = candidates[0]!;
  let bestScore = themeScore(best);
  for (const c of candidates.slice(1)) {
    const s = themeScore(c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }

  // If nothing is meaningfully saturated, fall back to the median of the
  // top-band tiles (first 5 samples) so we still pick *something* coherent.
  const sat = saturation(best);
  if (sat < 0.08 && candidates.length >= 5) {
    const topBand = candidates.slice(0, 5);
    const sortBy = (ch: "r" | "g" | "b") =>
      [...topBand].sort((a, b) => a[ch] - b[ch])[Math.floor(topBand.length / 2)]![ch];
    best = { r: sortBy("r"), g: sortBy("g"), b: sortBy("b") };
  }

  const sampledColor = toHex(best);
  return {
    background: { type: "solid", color: sampledColor },
    headlineColor: contrastTextColor(sampledColor),
    sampledColor,
    saturation: saturation(best),
  };
}
