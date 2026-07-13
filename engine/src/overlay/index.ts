import fs from "node:fs";
import path from "node:path";
import { store } from "../store.js";
import { PRESETS } from "../capture/presets.js";
import {
  ensureVariant,
  getOverlay,
  getScreenPresetIds,
  primaryPresetId,
  removeVariant,
  setVariantOverlay,
} from "../screens/variants.js";
import type { DevicePreset, OverlayScreenData, ScreenTemplate, TextSlot } from "../types.js";
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

function variantAssetBase(screenId: string, presetId: string): string {
  return `${screenId}__${presetId}`;
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

  const sharp = (await import("sharp")).default;
  const metaProbe = await sharp(buffer).metadata();
  const W = metaProbe.width ?? 1;
  const H = metaProbe.height ?? 1;

  const preset = input.presetId
    ? PRESETS.find((p) => p.id === input.presetId) ?? bestPreset(W, H)
    : bestPreset(W, H);

  const base = variantAssetBase(id, preset.id);
  const sourceAbs = path.join(paths.overlayDir, `${base}__source.${ext}`);
  fs.mkdirSync(paths.overlayDir, { recursive: true });
  fs.writeFileSync(sourceAbs, buffer);

  const ocr = await detectText(sourceAbs);
  const slots = await buildSlots(buffer, ocr, sourceLocale, W, H);
  const plateAbs = path.join(paths.overlayDir, `${base}__plate.png`);
  await buildPlate(sourceAbs, slots, plateAbs);

  const overlay: OverlayScreenData = {
    sourceLocale,
    sourceImagePath: path.relative(paths.dataDir, sourceAbs),
    platePath: path.relative(paths.dataDir, plateAbs),
    plateWidth: W,
    plateHeight: H,
    slots,
  };

  const now = new Date().toISOString();
  let screen: ScreenTemplate = {
    id,
    name: input.name,
    kind: "overlay",
    stringKeys: slots.map((s) => s.linkedKey).filter((k): k is string => !!k),
    headline: {},
    presetIds: [preset.id],
    variants: { [preset.id]: { overlay } },
    createdAt: now,
    updatedAt: now,
  };
  store.upsertScreen(screen);
  store.reconcileCells(store.getData()?.locales ?? [cfg.baseLocale]);
  screen = store.getScreen(id)!;

  return {
    screen,
    ocrEngine: ocr.engine,
    detectedCount: ocr.lines.length,
    matchedCount: slots.filter((s) => s.linkedKey).length,
  };
}

export interface AddVariantInput {
  presetId: string;
  /** Copy composition from this preset (defaults to the screen's primary). */
  copyFromPresetId?: string;
}

/** Add a device variant to an existing screen (composition only — no overlay yet). */
export function addScreenVariant(
  screenId: string,
  input: AddVariantInput,
): ScreenTemplate {
  if (!store.isOpen()) throw new Error("No project is open");
  const screen = store.getScreen(screenId);
  if (!screen) throw new Error(`Unknown screen: ${screenId}`);
  if (!PRESETS.some((p) => p.id === input.presetId)) {
    throw new Error(`Unknown preset: ${input.presetId}`);
  }
  const existing = getScreenPresetIds(screen);
  if (existing.includes(input.presetId)) {
    throw new Error(`Variant for ${input.presetId} already exists`);
  }

  const next = ensureVariant(
    screen,
    input.presetId,
    input.copyFromPresetId ?? primaryPresetId(screen),
  );
  next.updatedAt = new Date().toISOString();
  store.upsertScreen(next);
  store.reconcileCells(
    store.getData()?.locales ?? [store.getConfig().baseLocale],
  );
  return store.getScreen(screenId)!;
}

/** Remove a device variant from a screen. */
export function removeScreenVariant(
  screenId: string,
  presetId: string,
): ScreenTemplate {
  const screen = store.getScreen(screenId);
  if (!screen) throw new Error(`Unknown screen: ${screenId}`);
  const ids = getScreenPresetIds(screen);
  if (ids.length <= 1) {
    throw new Error("Cannot remove the last device variant");
  }
  const next = removeVariant(screen, presetId);
  next.updatedAt = new Date().toISOString();
  store.upsertScreen(next);
  store.reconcileCells(
    store.getData()?.locales ?? [store.getConfig().baseLocale],
  );
  return store.getScreen(screenId)!;
}

/** @deprecated Use addScreenVariant — kept for API compatibility. */
export function duplicateScreen(
  sourceId: string,
  input: { presetIds?: string[]; name?: string } = {},
): ScreenTemplate {
  const presetId = input.presetIds?.[0];
  if (!presetId) throw new Error("presetIds[0] is required");
  return addScreenVariant(sourceId, { presetId });
}

export interface UpdateOverlayInput {
  name?: string;
  sourceLocale?: string;
  slots?: TextSlot[];
  /** Which device variant to update (defaults to primary). */
  presetId?: string;
}

/** Save edits to an overlay variant; rebuilds the plate when slots change. */
export async function updateOverlayScreen(
  screenId: string,
  input: UpdateOverlayInput,
): Promise<ScreenTemplate> {
  let screen = store.getScreen(screenId);
  if (!screen) throw new Error(`Unknown screen: ${screenId}`);
  const presetId = input.presetId ?? primaryPresetId(screen);
  const overlay = getOverlay(screen, presetId);
  if (!overlay) {
    throw new Error(`Screen ${screenId} has no overlay for ${presetId}`);
  }
  const paths = store.getPaths();
  if (input.name) screen.name = input.name;
  if (input.sourceLocale) overlay.sourceLocale = input.sourceLocale;

  if (input.slots) {
    overlay.slots = input.slots;
    const sourceAbs = path.join(paths.dataDir, overlay.sourceImagePath);
    const plateAbs = path.join(paths.dataDir, overlay.platePath);
    await buildPlate(sourceAbs, input.slots, plateAbs);
    screen = setVariantOverlay(screen, presetId, overlay);
  } else if (input.sourceLocale) {
    screen = setVariantOverlay(screen, presetId, overlay);
  }

  screen.updatedAt = new Date().toISOString();
  store.upsertScreen(screen);
  return store.getScreen(screenId)!;
}

/** Replace a variant's source screenshot or attach the first one. */
export async function replaceOverlaySource(
  screenId: string,
  imageDataUrl: string,
  reocr: boolean,
  presetId?: string,
): Promise<ScreenTemplate> {
  let screen = store.getScreen(screenId);
  if (!screen) throw new Error(`Unknown screen: ${screenId}`);
  const pid = presetId ?? primaryPresetId(screen);
  const paths = store.getPaths();
  const { buffer, ext } = decodeDataUrl(imageDataUrl);
  fs.mkdirSync(paths.overlayDir, { recursive: true });

  let overlay = getOverlay(screen, pid);
  const sourceLocale =
    overlay?.sourceLocale ?? store.getConfig().baseLocale;

  if (!overlay) {
    screen = ensureVariant(screen, pid, primaryPresetId(screen));
  }

  const base = variantAssetBase(screenId, pid);
  const sourceAbs = path.join(paths.overlayDir, `${base}__source.${ext}`);
  if (overlay?.sourceImagePath) {
    const oldAbs = path.join(paths.dataDir, overlay.sourceImagePath);
    if (oldAbs !== sourceAbs && fs.existsSync(oldAbs)) {
      try {
        fs.rmSync(oldAbs);
      } catch {
        /* ignore */
      }
    }
  }
  fs.writeFileSync(sourceAbs, buffer);

  const sharp = (await import("sharp")).default;
  const meta = await sharp(sourceAbs).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;

  const hadOverlay = Boolean(getOverlay(screen, pid));
  overlay = getOverlay(screen, pid) ?? {
    sourceLocale,
    sourceImagePath: path.relative(paths.dataDir, sourceAbs),
    platePath: path.relative(paths.dataDir, `${base}__plate.png`),
    plateWidth: W,
    plateHeight: H,
    slots: [],
  };

  overlay.sourceImagePath = path.relative(paths.dataDir, sourceAbs);
  overlay.platePath = path.relative(
    paths.dataDir,
    path.join(paths.overlayDir, `${base}__plate.png`),
  );
  overlay.plateWidth = W;
  overlay.plateHeight = H;

  if (!hadOverlay || reocr) {
    const ocr = await detectText(sourceAbs);
    overlay.slots = await buildSlots(buffer, ocr, sourceLocale, W, H);
  }

  const plateAbs = path.join(paths.dataDir, overlay.platePath);
  await buildPlate(sourceAbs, overlay.slots, plateAbs);

  screen = setVariantOverlay(screen, pid, overlay);
  screen.kind = "overlay";
  screen.updatedAt = new Date().toISOString();
  store.upsertScreen(screen);
  if (!hadOverlay) {
    store.reconcileCells(
      store.getData()?.locales ?? [store.getConfig().baseLocale],
    );
  }
  return store.getScreen(screenId)!;
}

/** Force a rebuild of the clean plate from the current slots. */
export async function rebuildPlate(
  screenId: string,
  presetId?: string,
): Promise<ScreenTemplate> {
  const screen = store.getScreen(screenId);
  if (!screen) throw new Error(`Unknown screen: ${screenId}`);
  const pid = presetId ?? primaryPresetId(screen);
  const overlay = getOverlay(screen, pid);
  if (!overlay) throw new Error(`No overlay for ${screenId}/${pid}`);
  const paths = store.getPaths();
  const sourceAbs = path.join(paths.dataDir, overlay.sourceImagePath);
  const plateAbs = path.join(paths.dataDir, overlay.platePath);
  await buildPlate(sourceAbs, overlay.slots, plateAbs);
  return screen;
}

/** Sample the source image under a box to suggest mask + text colors. */
export async function sampleSlotColors(
  screenId: string,
  boxNorm: { x: number; y: number; w: number; h: number },
  presetId?: string,
): Promise<{ background: string; textColor: string }> {
  const screen = store.getScreen(screenId);
  if (!screen) throw new Error(`Unknown screen: ${screenId}`);
  const pid = presetId ?? primaryPresetId(screen);
  const overlay = getOverlay(screen, pid);
  if (!overlay) throw new Error(`No overlay for ${screenId}/${pid}`);
  const { plateWidth: W, plateHeight: H, sourceImagePath } = overlay;
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

/** Absolute path to a variant's source or plate image. */
export function overlayImagePath(
  screenId: string,
  which: "source" | "plate",
  presetId?: string,
): string | null {
  const screen = store.getScreen(screenId);
  if (!screen) return null;
  const pid = presetId ?? primaryPresetId(screen);
  const overlay = getOverlay(screen, pid);
  if (!overlay) return null;
  const rel =
    which === "source" ? overlay.sourceImagePath : overlay.platePath;
  const abs = path.join(store.getPaths().dataDir, rel);
  return fs.existsSync(abs) ? abs : null;
}
