import fs from "node:fs";
import path from "node:path";
import { store } from "../store.js";
import { PRESETS } from "../capture/presets.js";
import type { DevicePreset, ScreenTemplate, TextSlot } from "../types.js";
import { detectText, type OcrResult } from "./ocr.js";
import { matchText } from "./match.js";
import {
  buildPlate,
  sampleBackgroundColor,
  contrastTextColor,
} from "./plate.js";

function defaultFontFamily(): string {
  const data = store.getData();
  const family = data?.tokens.fonts.find((f) => f.dataUrl)?.family;
  return family
    ? `"${family}", -apple-system, system-ui, sans-serif`
    : `-apple-system, system-ui, "SF Pro Text", "Helvetica Neue", sans-serif`;
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("Invalid image data URL");
  const mime = m[1].toLowerCase();
  const ext = mime.includes("jpeg") || mime.includes("jpg")
    ? "jpg"
    : mime.includes("webp")
      ? "webp"
      : "png";
  return { buffer: Buffer.from(m[2], "base64"), ext };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "screen"
  );
}

function uniqueScreenId(base: string): string {
  const existing = new Set(store.getConfig().screens.map((s) => s.id));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Choose the device preset whose aspect ratio best matches the upload. */
function bestPreset(width: number, height: number): DevicePreset {
  const ratio = width / height;
  let best = PRESETS[0];
  let bestDiff = Infinity;
  for (const p of PRESETS) {
    const diff = Math.abs(ratio - p.pointWidth / p.pointHeight);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  return best;
}

async function buildSlots(
  sourceBuf: Buffer,
  ocr: OcrResult,
  sourceLocale: string,
  W: number,
  H: number,
): Promise<TextSlot[]> {
  const font = defaultFontFamily();
  const slots: TextSlot[] = [];
  for (let i = 0; i < ocr.lines.length; i++) {
    const line = ocr.lines[i];
    const match = matchText(line.text, sourceLocale);
    const boxPx = { x: line.x * W, y: line.y * H, w: line.w * W, h: line.h * H };
    const bg = await sampleBackgroundColor(sourceBuf, boxPx, W, H);
    slots.push({
      id: `slot-${i + 1}`,
      box: { x: line.x, y: line.y, w: line.w, h: line.h },
      linkedKey: match.key,
      detectedText: line.text,
      confidence: match.key ? match.score : line.confidence,
      mask: {
        mode: "solid",
        color: bg,
        padding: 0.004,
        radius: Math.round(boxPx.h * 0.12),
      },
      type: {
        fontFamily: font,
        fontWeight: 600,
        fontSizePct: line.h * 0.82,
        color: contrastTextColor(bg),
        align: "left",
        valign: "middle",
        lineHeight: 1.1,
        letterSpacing: 0,
        autoFit: "shrink",
        maxLines: 1,
      },
    });
  }
  return slots;
}

export interface CreateOverlayInput {
  name: string;
  sourceLocale?: string;
  imageDataUrl: string;
  presetId?: string;
}

export interface OverlayResult {
  screen: ScreenTemplate;
  ocrEngine: OcrResult["engine"];
  detectedCount: number;
  matchedCount: number;
}

/** Upload a screenshot, detect + match text, build a clean plate, save screen. */
export async function createOverlayScreen(
  input: CreateOverlayInput,
): Promise<OverlayResult> {
  if (!store.isOpen()) throw new Error("No project is open");
  const paths = store.getPaths();
  const cfg = store.getConfig();
  const sourceLocale = input.sourceLocale ?? cfg.baseLocale;

  const { buffer, ext } = decodeDataUrl(input.imageDataUrl);
  const id = uniqueScreenId(slugify(input.name));
  const sourceAbs = path.join(paths.overlayDir, `${id}__source.${ext}`);
  fs.mkdirSync(paths.overlayDir, { recursive: true });
  fs.writeFileSync(sourceAbs, buffer);

  const ocr = await detectText(sourceAbs);

  const sharp = (await import("sharp")).default;
  const meta = await sharp(sourceAbs).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;

  const slots = await buildSlots(buffer, ocr, sourceLocale, W, H);

  const plateAbs = path.join(paths.overlayDir, `${id}__plate.png`);
  await buildPlate(sourceAbs, slots, plateAbs);

  const preset = input.presetId
    ? PRESETS.find((p) => p.id === input.presetId) ?? bestPreset(W, H)
    : bestPreset(W, H);

  const now = new Date().toISOString();
  const screen: ScreenTemplate = {
    id,
    name: input.name,
    kind: "overlay",
    stringKeys: slots.map((s) => s.linkedKey).filter((k): k is string => !!k),
    headline: {},
    presetIds: [preset.id],
    createdAt: now,
    updatedAt: now,
    overlay: {
      sourceLocale,
      sourceImagePath: path.relative(paths.dataDir, sourceAbs),
      platePath: path.relative(paths.dataDir, plateAbs),
      plateWidth: W,
      plateHeight: H,
      slots,
    },
  };
  store.upsertScreen(screen);
  store.reconcileCells(store.getData()?.locales ?? [cfg.baseLocale]);

  return {
    screen,
    ocrEngine: ocr.engine,
    detectedCount: ocr.lines.length,
    matchedCount: slots.filter((s) => s.linkedKey).length,
  };
}

const DEVICE_CLASS_NAME: Record<string, string> = {
  ios: "iPhone",
  ipados: "iPad",
  macos: "Mac",
};

/** Suggest "<Base name> (Mac)" for a duplicate targeting a device class. */
function defaultDuplicateName(source: ScreenTemplate, presetIds: string[]): string {
  const preset = PRESETS.find((p) => p.id === presetIds[0]);
  const cls = preset ? DEVICE_CLASS_NAME[preset.platform] ?? preset.platform : "Copy";
  const base = source.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || source.name;
  return `${base} (${cls})`;
}

export interface DuplicateScreenInput {
  /** device presets the new screen targets (defaults to the source's). */
  presetIds?: string[];
  /** override the auto-generated name. */
  name?: string;
}

/**
 * Clone a screen's theming (composition + headline mapping) into a brand-new
 * screen that targets a different device class. The clone has no overlay yet —
 * the user supplies a fresh screenshot in the Screens tab — so this is the
 * "make a macOS version of my iPad screen" primitive: same background, headline
 * color, and copy selection, new screenshot and device size.
 */
export function duplicateScreen(
  sourceId: string,
  input: DuplicateScreenInput = {},
): ScreenTemplate {
  if (!store.isOpen()) throw new Error("No project is open");
  const source = store.getScreen(sourceId);
  if (!source) throw new Error(`Unknown screen: ${sourceId}`);
  const cfg = store.getConfig();

  const requested = (input.presetIds ?? source.presetIds).filter((id) =>
    PRESETS.some((p) => p.id === id),
  );
  const presetIds = requested.length ? requested : source.presetIds;

  const name = input.name?.trim() || defaultDuplicateName(source, presetIds);
  const id = uniqueScreenId(slugify(name));
  const now = new Date().toISOString();

  const screen: ScreenTemplate = {
    id,
    name,
    kind: "overlay",
    stringKeys: [],
    headline: { ...source.headline },
    // Deep-clone the composition so edits to the clone don't mutate the source.
    composition: source.composition
      ? (JSON.parse(JSON.stringify(source.composition)) as ScreenTemplate["composition"])
      : undefined,
    presetIds,
    createdAt: now,
    updatedAt: now,
    // No overlay: the clone awaits its own screenshot.
  };
  store.upsertScreen(screen);
  store.reconcileCells(store.getData()?.locales ?? [cfg.baseLocale]);
  return screen;
}

export interface UpdateOverlayInput {
  name?: string;
  sourceLocale?: string;
  slots?: TextSlot[];
  /** device presets this screen targets (validated against known presets). */
  presetIds?: string[];
}

/** Save edits to an overlay screen; rebuilds the plate when slots change. */
export async function updateOverlayScreen(
  screenId: string,
  input: UpdateOverlayInput,
): Promise<ScreenTemplate> {
  const screen = store.getScreen(screenId);
  if (!screen || !screen.overlay) {
    throw new Error(`Unknown overlay screen: ${screenId}`);
  }
  const paths = store.getPaths();
  if (input.name) screen.name = input.name;
  if (input.sourceLocale) screen.overlay.sourceLocale = input.sourceLocale;

  let presetsChanged = false;
  if (input.presetIds && input.presetIds.length) {
    const valid = input.presetIds.filter((id) =>
      PRESETS.some((p) => p.id === id),
    );
    if (valid.length && valid.join() !== screen.presetIds.join()) {
      screen.presetIds = valid;
      presetsChanged = true;
    }
  }

  if (input.slots) {
    screen.overlay.slots = input.slots;
    screen.stringKeys = input.slots
      .map((s) => s.linkedKey)
      .filter((k): k is string => !!k);
    const sourceAbs = path.join(paths.dataDir, screen.overlay.sourceImagePath);
    const plateAbs = path.join(paths.dataDir, screen.overlay.platePath);
    await buildPlate(sourceAbs, input.slots, plateAbs);
  }

  screen.updatedAt = new Date().toISOString();
  store.upsertScreen(screen);
  // New presets need their own cell matrix entries; old ones get pruned.
  if (presetsChanged) {
    store.reconcileCells(
      store.getData()?.locales ?? [store.getConfig().baseLocale],
    );
  }
  return screen;
}

/** Replace an overlay screen's source screenshot (e.g. a new app version). */
export async function replaceOverlaySource(
  screenId: string,
  imageDataUrl: string,
  reocr: boolean,
): Promise<ScreenTemplate> {
  const screen = store.getScreen(screenId);
  if (!screen?.overlay) throw new Error(`Unknown overlay screen: ${screenId}`);
  const paths = store.getPaths();
  const { buffer, ext } = decodeDataUrl(imageDataUrl);
  const oldAbs = path.join(paths.dataDir, screen.overlay.sourceImagePath);
  const sourceAbs = path.join(paths.overlayDir, `${screenId}__source.${ext}`);
  if (oldAbs !== sourceAbs && fs.existsSync(oldAbs)) {
    try {
      fs.rmSync(oldAbs);
    } catch {
      /* ignore */
    }
  }
  fs.writeFileSync(sourceAbs, buffer);

  const sharp = (await import("sharp")).default;
  const meta = await sharp(sourceAbs).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  screen.overlay.sourceImagePath = path.relative(paths.dataDir, sourceAbs);
  screen.overlay.plateWidth = W;
  screen.overlay.plateHeight = H;

  if (reocr) {
    const ocr = await detectText(sourceAbs);
    screen.overlay.slots = await buildSlots(
      buffer,
      ocr,
      screen.overlay.sourceLocale,
      W,
      H,
    );
    screen.stringKeys = screen.overlay.slots
      .map((s) => s.linkedKey)
      .filter((k): k is string => !!k);
  }

  const plateAbs = path.join(paths.dataDir, screen.overlay.platePath);
  await buildPlate(sourceAbs, screen.overlay.slots, plateAbs);
  screen.updatedAt = new Date().toISOString();
  store.upsertScreen(screen);
  return screen;
}

/** Force a rebuild of the clean plate from the current slots. */
export async function rebuildPlate(screenId: string): Promise<ScreenTemplate> {
  const screen = store.getScreen(screenId);
  if (!screen || !screen.overlay) {
    throw new Error(`Unknown overlay screen: ${screenId}`);
  }
  const paths = store.getPaths();
  const sourceAbs = path.join(paths.dataDir, screen.overlay.sourceImagePath);
  const plateAbs = path.join(paths.dataDir, screen.overlay.platePath);
  await buildPlate(sourceAbs, screen.overlay.slots, plateAbs);
  return screen;
}

/** Sample the source image under a box to suggest mask + text colors. */
export async function sampleSlotColors(
  screenId: string,
  boxNorm: { x: number; y: number; w: number; h: number },
): Promise<{ background: string; textColor: string }> {
  const screen = store.getScreen(screenId);
  if (!screen?.overlay) throw new Error(`Unknown overlay screen: ${screenId}`);
  const { plateWidth: W, plateHeight: H, sourceImagePath } = screen.overlay;
  const sourceAbs = path.join(store.getPaths().dataDir, sourceImagePath);
  const boxPx = {
    x: boxNorm.x * W,
    y: boxNorm.y * H,
    w: boxNorm.w * W,
    h: boxNorm.h * H,
  };
  const background = await sampleBackgroundColor(sourceAbs, boxPx, W, H);
  return { background, textColor: contrastTextColor(background) };
}

/** Absolute path to an overlay screen's source or plate image. */
export function overlayImagePath(
  screenId: string,
  which: "source" | "plate",
): string | null {
  const screen = store.getScreen(screenId);
  if (!screen?.overlay) return null;
  const rel =
    which === "source"
      ? screen.overlay.sourceImagePath
      : screen.overlay.platePath;
  const abs = path.join(store.getPaths().dataDir, rel);
  return fs.existsSync(abs) ? abs : null;
}
