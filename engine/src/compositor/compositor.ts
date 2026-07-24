import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getPreset } from "../capture/presets.js";
import { getComposition } from "../screens/variants.js";
import { store } from "../store.js";
import type {
  AssetCell,
  CompositorConfig,
  DevicePreset,
  ScreenComposition,
  ScreenTemplate,
} from "../types.js";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// CJK ideographs, kana, and CJK/fullwidth punctuation may wrap between almost
// any two characters — these scripts don't separate words with spaces. Hangul
// is intentionally excluded: Korean uses spaces and wraps word-by-word.
const BREAK_ANYWHERE =
  /[\u3000-\u303F\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF60\uFFE0-\uFFEF]/;
// Characters that must not begin a line (closing brackets, sentence-final
// punctuation, small kana, prolonged sound mark) — basic kinsoku shori.
const NO_LINE_START =
  /[)\]}）］｝〉》」』】〕、。，．・…！？!?,.:;：；ー―〜ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ｡｣､]/;
// Characters that must not end a line (opening brackets).
const NO_LINE_END = /[([{（［｛〈《「『【〔]/;

function glyphWidth(ch: string, fontSize: number): number {
  if (ch === " ") return fontSize * 0.28;
  // Full-width CJK glyphs are ~1em; Latin/Cyrillic average ~0.56em.
  return BREAK_ANYWHERE.test(ch) ? fontSize : fontSize * 0.56;
}

/**
 * Word-wrap a headline into at most `maxLines` lines that fit `maxWidth`.
 *
 * Latin/Cyrillic/etc. break on spaces; CJK (Chinese, Japanese) has no spaces,
 * so we allow breaks between individual ideographs/kana while keeping embedded
 * Latin words intact, then apply light kinsoku rules so a line never starts
 * with closing punctuation or ends with an opening bracket.
 */
function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxLines = 3,
): string[] {
  // Tokenize into atoms that must stay intact: whole non-CJK words, plus each
  // CJK character on its own. `space` marks atoms preceded by whitespace.
  type Atom = { text: string; space: boolean };
  const atoms: Atom[] = [];
  let buf = "";
  let pendingSpace = false;
  const flush = () => {
    if (buf) {
      atoms.push({ text: buf, space: pendingSpace });
      buf = "";
      pendingSpace = false;
    }
  };
  for (const ch of text) {
    if (/\s/.test(ch)) {
      flush();
      pendingSpace = true;
    } else if (BREAK_ANYWHERE.test(ch)) {
      flush();
      atoms.push({ text: ch, space: pendingSpace });
      pendingSpace = false;
    } else {
      buf += ch;
    }
  }
  flush();

  const measure = (s: string) =>
    Array.from(s).reduce((w, ch) => w + glyphWidth(ch, fontSize), 0);

  const lines: string[] = [];
  let cur = "";
  let curW = 0;
  for (const atom of atoms) {
    const sep = cur && atom.space ? " " : "";
    const addW = (sep ? glyphWidth(" ", fontSize) : 0) + measure(atom.text);
    if (cur && curW + addW > maxWidth) {
      lines.push(cur);
      cur = atom.text;
      curW = measure(atom.text);
    } else {
      cur += sep + atom.text;
      curW += addW;
    }
  }
  if (cur) lines.push(cur);

  // Kinsoku: pull a forbidden leading char up to the previous line, and push a
  // forbidden trailing char (opening bracket) down to the next line.
  for (let i = 1; i < lines.length; i++) {
    let guard = 0;
    while (lines[i] && NO_LINE_START.test(Array.from(lines[i])[0]) && guard++ < 8) {
      const chars = Array.from(lines[i]);
      lines[i - 1] += chars.shift();
      lines[i] = chars.join("");
    }
    const prev = Array.from(lines[i - 1]);
    if (prev.length > 1 && NO_LINE_END.test(prev[prev.length - 1])) {
      lines[i] = prev.pop()! + lines[i];
      lines[i - 1] = prev.join("");
    }
  }

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*$/, "") + "…";
  return kept;
}

function backgroundCss(bg: CompositorConfig["background"]): string {
  if (bg.type === "solid") {
    return `<rect width="100%" height="100%" fill="${bg.color}"/>`;
  }
  const rad = (bg.angle * Math.PI) / 180;
  const x2 = (Math.cos(rad) * 0.5 + 0.5).toFixed(4);
  const y2 = (Math.sin(rad) * 0.5 + 0.5).toFixed(4);
  return `<defs><linearGradient id="bg" x1="${(1 - Number(x2)).toFixed(4)}" y1="${(1 - Number(y2)).toFixed(4)}" x2="${x2}" y2="${y2}">
      <stop offset="0%" stop-color="${bg.from}"/>
      <stop offset="100%" stop-color="${bg.to}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>`;
}

/** Horizontal margin each side for promo headlines (fraction of canvas width). */
function headlineSideInset(platform?: DevicePreset["platform"]): number {
  // Mac Store canvases are wide and short — allow copy closer to the edges.
  return platform === "macos" ? 0.03 : 0.07;
}

/** Headline text spans centered in the top headline band (shared by framed + overlay). */
function headlineTextMarkup(
  W: number,
  H: number,
  headline: string,
  cfg: CompositorConfig,
  platform?: DevicePreset["platform"],
): string {
  const headlineAreaH = Math.round(H * cfg.headlineHeightFraction);
  const fontSize = Math.round(W * (cfg.headlineSizePct ?? 0.052));
  const lineHeight = Math.round(fontSize * (cfg.headlineLineHeight ?? 1.16));
  const maxWidth = W * (1 - 2 * headlineSideInset(platform));
  const lines = wrapText(headline, fontSize, maxWidth);
  const blockH = lines.length * lineHeight;
  const startY = Math.round(headlineAreaH / 2 - blockH / 2 + fontSize * 0.82);
  const tspans = lines
    .map(
      (l, i) =>
        `<tspan x="${W / 2}" y="${startY + i * lineHeight}">${escapeXml(l)}</tspan>`,
    )
    .join("");
  const tracking = (cfg.headlineLetterSpacing ?? -0.01) * fontSize;
  return `<text text-anchor="middle" font-family="${escapeXml(cfg.headlineFont)}" font-weight="${cfg.headlineWeight ?? 800}"
      font-style="${escapeXml(cfg.headlineStyle ?? "normal")}"
      font-size="${fontSize}" fill="${escapeXml(cfg.headlineColor)}" letter-spacing="${tracking.toFixed(2)}">
      ${tspans}
    </text>`;
}

function backgroundWithHeadlineSvg(
  W: number,
  H: number,
  headline: string,
  cfg: CompositorConfig,
  platform?: DevicePreset["platform"],
): Buffer {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${backgroundCss(cfg.background)}
    ${headlineTextMarkup(W, H, headline, cfg, platform)}
  </svg>`;
  return Buffer.from(svg);
}

/** Transparent full-canvas SVG with only the promo headline (for pass-through overlay). */
function headlineOverlaySvg(
  W: number,
  H: number,
  headline: string,
  cfg: CompositorConfig,
  platform?: DevicePreset["platform"],
): Buffer {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${headlineTextMarkup(W, H, headline, cfg, platform)}
  </svg>`;
  return Buffer.from(svg);
}

function roundedMaskSvg(w: number, h: number, r: number): Buffer {
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
}

function bezelSvg(w: number, h: number, r: number, color: string): Buffer {
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${color}"/></svg>`,
  );
}

export interface ComposeOptions {
  capturePath: string;
  outPath: string;
  preset: DevicePreset;
  headline: string;
  config: CompositorConfig;
}

/** Composite a captured screenshot into a framed App Store promo image. */
export async function compose(opts: ComposeOptions): Promise<string> {
  const { preset, config } = opts;
  const W = preset.pixelWidth;
  const H = preset.pixelHeight;
  const isMac = preset.platform === "macos";

  const headlineAreaH = Math.round(H * config.headlineHeightFraction);
  const bottomPadding = Math.round(H * 0.04);
  const sidePadding = Math.round(W * 0.08);

  // Fit the device within the area below the headline.
  const availH = H - headlineAreaH - bottomPadding;
  const availW = W - sidePadding * 2;

  let deviceLayer: Buffer;
  let layerW: number;
  let layerH: number;

  if (isMac) {
    // Mac App Store: float the window screenshot (already has chrome + shadow).
    // Contain-fit into the promo area — no bezel, no corner mask (mask clips shadow).
    const meta = await sharp(opts.capturePath).metadata();
    const srcW = Math.max(1, meta.width ?? W);
    const srcH = Math.max(1, meta.height ?? H);
    const fitScale = Math.min(availW / srcW, availH / srcH);
    layerW = Math.max(1, Math.round(srcW * fitScale));
    layerH = Math.max(1, Math.round(srcH * fitScale));
    deviceLayer = await sharp(opts.capturePath)
      .ensureAlpha()
      .resize(layerW, layerH, { fit: "inside" })
      .png()
      .toBuffer();
  } else {
    const fitScale = Math.min(availW / W, availH / H);
    const deviceW = Math.round(W * fitScale);
    const deviceH = Math.round(H * fitScale);
    const bezel = config.deviceFrame ? Math.round(W * 0.012) : 0;
    const radius = Math.round(preset.cornerRadius * preset.scale * fitScale);

    // 1) Round the screenshot corners.
    const screenshot = await sharp(opts.capturePath)
      .resize(deviceW, deviceH, { fit: "fill" })
      .composite([
        { input: roundedMaskSvg(deviceW, deviceH, radius), blend: "dest-in" },
      ])
      .png()
      .toBuffer();

    // 2) Optional bezel behind the screenshot.
    deviceLayer = screenshot;
    layerW = deviceW;
    layerH = deviceH;
    if (bezel > 0) {
      layerW = deviceW + bezel * 2;
      layerH = deviceH + bezel * 2;
      deviceLayer = await sharp(
        bezelSvg(layerW, layerH, radius + bezel, "#0b0d12"),
      )
        .composite([{ input: screenshot, left: bezel, top: bezel }])
        .png()
        .toBuffer();
    }
  }

  const deviceLeft = Math.round((W - layerW) / 2);
  const deviceTop = headlineAreaH + Math.round((availH - layerH) / 2);

  // 3) Background + headline, then composite the device (flattens any alpha).
  const base = backgroundWithHeadlineSvg(
    W,
    H,
    opts.headline,
    config,
    preset.platform,
  );
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  await sharp(base)
    .composite([
      {
        input: deviceLayer,
        left: deviceLeft,
        top: Math.max(headlineAreaH, deviceTop),
      },
    ])
    .png()
    .toFile(opts.outPath);

  return opts.outPath;
}

/**
 * Resolve the concrete CompositorConfig for a screen + preset by layering the
 * three scopes:
 *   - universal  (global): font family/weight/style, tracking, line-height
 *   - per device class    : headline size + headline area (by preset.platform)
 *   - per screen          : background + headline color
 */
export function resolveCompositor(
  comp: ScreenComposition,
  preset: DevicePreset,
): CompositorConfig {
  const g = store.getConfig().compositor;
  const dev = g.perDevice?.[preset.platform] ?? {};
  return {
    ...g,
    // per-device-class
    headlineSizePct: dev.headlineSizePct ?? g.headlineSizePct,
    headlineHeightFraction:
      dev.headlineHeightFraction ??
      comp.headlineHeightFraction ??
      g.headlineHeightFraction,
    // per-screen
    background: comp.background,
    headlineColor: comp.headlineColor ?? g.headlineColor,
    // Phone/iPad get a synthetic bezel; Mac window shots already include chrome.
    deviceFrame: preset.platform !== "macos",
  };
}

/** Resolve a screen variant's effective composition, falling back to the global one. */
export function effectiveComposition(
  screen: ScreenTemplate,
  presetId: string,
): ScreenComposition {
  const variant = getComposition(screen, presetId);
  if (variant) return variant;
  const g = store.getConfig().compositor;
  return {
    mode: "device",
    background: g.background,
    headlineColor: g.headlineColor,
    headlineFont: g.headlineFont,
    headlineHeightFraction: g.headlineHeightFraction,
    headlineText: screen.headline,
  };
}

function headlineFor(
  screen: ScreenTemplate,
  comp: ScreenComposition,
  locale: string,
): string {
  const base = store.getConfig().baseLocale;
  if (comp.headlineKey) {
    const v =
      store.resolveString(comp.headlineKey, locale) ??
      store.resolveString(comp.headlineKey, base);
    if (v) return v;
  }
  return (
    comp.headlineText?.[locale] ??
    comp.headlineText?.[base] ??
    screen.headline?.[locale] ??
    ""
  );
}

/** Copy/resize a capture straight to the composed output (no frame). */
async function passthrough(
  capturePath: string,
  outPath: string,
  preset: DevicePreset,
): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(capturePath)
    .resize(preset.pixelWidth, preset.pixelHeight, { fit: "fill" })
    .png()
    .toFile(outPath);
}

/**
 * Full-bleed screenshot with promo headline drawn on top (no background/bezel).
 */
async function passthroughWithHeadline(
  capturePath: string,
  outPath: string,
  preset: DevicePreset,
  headline: string,
  config: CompositorConfig,
): Promise<void> {
  const W = preset.pixelWidth;
  const H = preset.pixelHeight;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const base = await sharp(capturePath)
    .resize(W, H, { fit: "fill" })
    .png()
    .toBuffer();
  await sharp(base)
    .composite([
      {
        input: headlineOverlaySvg(W, H, headline, config, preset.platform),
      },
    ])
    .png()
    .toFile(outPath);
}

/** Compose a cell using its capture + the screen's composition settings. */
export async function composeCell(cell: AssetCell): Promise<AssetCell> {
  if (!cell.capturePath) {
    throw new Error(`Cell ${cell.id} has no capture to compose`);
  }
  const screen = store.getScreen(cell.screenId);
  if (!screen) throw new Error(`Unknown screen: ${cell.screenId}`);
  const preset = getPreset(cell.presetId);
  const comp = effectiveComposition(screen, cell.presetId);
  const paths = store.getPaths();
  const outPath = path.join(
    paths.composedDir,
    `${cell.screenId}__${cell.locale}__${cell.presetId}.png`,
  );

  if (comp.mode === "passthrough") {
    const headline = headlineFor(screen, comp, cell.locale).trim();
    if (headline) {
      const config = resolveCompositor(comp, preset);
      await passthroughWithHeadline(
        cell.capturePath,
        outPath,
        preset,
        headline,
        config,
      );
    } else {
      await passthrough(cell.capturePath, outPath, preset);
    }
  } else {
    const config = resolveCompositor(comp, preset);
    await compose({
      capturePath: cell.capturePath,
      outPath,
      preset,
      headline: headlineFor(screen, comp, cell.locale),
      config,
    });
  }

  const updated: AssetCell = {
    ...cell,
    state: "composed",
    composedPath: outPath,
    lastError: undefined,
    updatedAt: new Date().toISOString(),
  };
  store.upsertCell(updated);
  // The screenshot changed, so any prior upload of this cell is now stale.
  store.clearUploadForCell(updated.id);
  return updated;
}
