import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getPreset } from "../capture/presets.js";
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

/** Naive word wrap by estimated glyph width (good enough for headlines). */
function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const charWidth = fontSize * 0.56;
  const maxChars = Math.max(6, Math.floor(maxWidth / charWidth));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
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

function backgroundWithHeadlineSvg(
  W: number,
  H: number,
  headline: string,
  cfg: CompositorConfig,
): Buffer {
  const headlineAreaH = Math.round(H * cfg.headlineHeightFraction);
  const fontSize = Math.round(W * (cfg.headlineSizePct ?? 0.052));
  const lineHeight = Math.round(fontSize * (cfg.headlineLineHeight ?? 1.16));
  const lines = wrapText(headline, fontSize, W * 0.86);
  const blockH = lines.length * lineHeight;
  const startY = Math.round(headlineAreaH / 2 - blockH / 2 + fontSize * 0.82);
  const tspans = lines
    .map(
      (l, i) =>
        `<tspan x="${W / 2}" y="${startY + i * lineHeight}">${escapeXml(l)}</tspan>`,
    )
    .join("");

  const tracking = (cfg.headlineLetterSpacing ?? -0.01) * fontSize;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${backgroundCss(cfg.background)}
    <text text-anchor="middle" font-family="${escapeXml(cfg.headlineFont)}" font-weight="${cfg.headlineWeight ?? 800}"
      font-style="${escapeXml(cfg.headlineStyle ?? "normal")}"
      font-size="${fontSize}" fill="${escapeXml(cfg.headlineColor)}" letter-spacing="${tracking.toFixed(2)}">
      ${tspans}
    </text>
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

  const headlineAreaH = Math.round(H * config.headlineHeightFraction);
  const bottomPadding = Math.round(H * 0.04);
  const sidePadding = Math.round(W * 0.08);

  // Fit the device within the area below the headline.
  const availH = H - headlineAreaH - bottomPadding;
  const availW = W - sidePadding * 2;
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
  let deviceLayer = screenshot;
  let layerW = deviceW;
  let layerH = deviceH;
  if (bezel > 0) {
    layerW = deviceW + bezel * 2;
    layerH = deviceH + bezel * 2;
    deviceLayer = await sharp(bezelSvg(layerW, layerH, radius + bezel, "#0b0d12"))
      .composite([{ input: screenshot, left: bezel, top: bezel }])
      .png()
      .toBuffer();
  }

  const deviceLeft = Math.round((W - layerW) / 2);
  const deviceTop = headlineAreaH + Math.round((availH - layerH) / 2);

  // 3) Background + headline, then composite the device.
  const base = backgroundWithHeadlineSvg(W, H, opts.headline, config);
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  await sharp(base)
    .composite([{ input: deviceLayer, left: deviceLeft, top: Math.max(headlineAreaH, deviceTop) }])
    .png()
    .toFile(opts.outPath);

  return opts.outPath;
}

/** Resolve a screen's effective composition, falling back to the global one. */
export function effectiveComposition(screen: ScreenTemplate): ScreenComposition {
  if (screen.composition) return screen.composition;
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

/** Compose a cell using its capture + the screen's composition settings. */
export async function composeCell(cell: AssetCell): Promise<AssetCell> {
  if (!cell.capturePath) {
    throw new Error(`Cell ${cell.id} has no capture to compose`);
  }
  const screen = store.getScreen(cell.screenId);
  if (!screen) throw new Error(`Unknown screen: ${cell.screenId}`);
  const preset = getPreset(cell.presetId);
  const comp = effectiveComposition(screen);
  const paths = store.getPaths();
  const outPath = path.join(
    paths.composedDir,
    `${cell.screenId}__${cell.locale}__${cell.presetId}.png`,
  );

  if (comp.mode === "passthrough") {
    await passthrough(cell.capturePath, outPath, preset);
  } else {
    const g = store.getConfig().compositor;
    const config: CompositorConfig = {
      ...g,
      background: comp.background,
      deviceFrame: true,
      headlineHeightFraction: comp.headlineHeightFraction,
    };
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
  return updated;
}
