import fs from "node:fs";
import path from "node:path";
import { store } from "../store.js";
import { PRESETS } from "../capture/presets.js";
import {
  getScreenPresetIds,
  primaryPresetId,
  setVariantComposition,
} from "../screens/variants.js";
import type { ScreenComposition, ScreenTemplate } from "../types.js";
import {
  addScreenVariant,
  createOverlayScreen,
  replaceOverlaySource,
} from "./index.js";
import { sampleFrameTheme, type FrameTheme } from "./themeColor.js";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * Folder / filename token → device class used for *presets* (which App Store
 * display type the PNG targets).
 */
const DEVICE_ALIASES: Record<string, "ios" | "ipados" | "macos"> = {
  ios: "ios",
  iphone: "ios",
  ipados: "ipados",
  ipad: "ipados",
  macos: "macos",
  mac: "macos",
  osx: "macos",
};

/**
 * Device class → marketing-copy namespace in string keys.
 * iPhone and iPad share `ios` keys (`appstore.ios_2`); Mac stays separate.
 */
const COPY_NAMESPACE: Record<"ios" | "ipados" | "macos", "ios" | "macos"> = {
  ios: "ios",
  ipados: "ios",
  macos: "macos",
};

/** Strip a known image extension only — keep dots in keys like `appstore.ios_2`. */
function stripImageExt(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of IMAGE_EXTS) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length);
  }
  return name;
}

export interface IngestFileSpec {
  /** Absolute path on disk. */
  path?: string;
  /** Base64 data URL (browser multi-file import). */
  imageDataUrl?: string;
  /** Display name / stem override. */
  name?: string;
  /** Explicit headline string key. */
  headlineKey?: string;
  /** Force a device preset id. */
  presetId?: string;
}

export interface IngestInput {
  /** Absolute directory to scan (non-recursive; platform subfolders allowed one level). */
  dir?: string;
  /** Explicit file list (used instead of / in addition to dir). */
  files?: IngestFileSpec[];
  sourceLocale?: string;
  detectText?: boolean;
  /**
   * Prefix for numeric files in a platform folder, e.g. `appstore` turns
   * `ios/2.png` / `ipad/2.png` into `appstore.ios_2`. Ignored when the
   * filename stem already looks like a full key (contains a dot).
   */
  keyPrefix?: string;
}

export interface IngestItemResult {
  sourcePath?: string;
  name: string;
  headlineKey?: string;
  headlineMatched: boolean;
  /** True when this image was attached as a variant on an existing screen. */
  mergedVariant: boolean;
  theme: FrameTheme;
  screen: ScreenTemplate;
  error?: undefined;
}

export interface IngestItemError {
  sourcePath?: string;
  name: string;
  error: string;
  screen?: undefined;
}

export interface IngestResult {
  created: IngestItemResult[];
  failed: IngestItemError[];
}

function listImageFiles(dir: string): string[] {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const full = path.join(abs, entry.name);
    if (entry.isFile()) {
      if (IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        if (isIngestableName(entry.name)) out.push(full);
      }
    } else if (entry.isDirectory()) {
      // One level of platform folders: ios/, ipad/, macos/, …
      for (const child of fs.readdirSync(full, { withFileTypes: true })) {
        if (!child.isFile()) continue;
        if (!IMAGE_EXTS.has(path.extname(child.name).toLowerCase())) continue;
        // Platform folders only accept slot shots (1.png) or key-named files —
        // skip supporting frames like Mac6_1.png / Mac6_2.png.
        if (!isIngestableName(child.name)) continue;
        out.push(path.join(full, child.name));
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Accept numbered slots (`1.png`), platform_index (`ios_2.png`), or full keys
 * (`appstore.macos_5.png`). Reject supporting frames (`Mac6_1.png`, `Mac5.png`).
 */
export function isIngestableName(filename: string): boolean {
  const stem = stripImageExt(filename);
  if (/^\d+$/.test(stem)) return true;
  if (/^(ios|ipados|macos|iphone|ipad|mac)_\d+$/i.test(stem)) return true;
  if (/^appstore\.(ios|ipados|macos)_\d+$/i.test(stem)) return true;
  // Stem already equals a dotted localization key.
  if (stem.includes(".") && !/_\d+_\d+$/.test(stem)) return true;
  return false;
}

function knownStringKeys(): Set<string> {
  return new Set(store.getMergedStrings().map((s) => s.key));
}

function displayNameFor(filePath: string | undefined, name?: string): string {
  if (name?.trim()) return stripImageExt(name.trim());
  if (filePath) return stripImageExt(path.basename(filePath));
  return "screen";
}

function parentFolder(filePath: string | undefined): string {
  if (!filePath) return "";
  return path.basename(path.dirname(filePath)).toLowerCase();
}

/** Infer device class from folder name, filename token, or image aspect. */
export function resolveDeviceClass(
  filePath: string | undefined,
  name: string,
  presetId?: string,
): "ios" | "ipados" | "macos" | undefined {
  if (presetId) {
    const p = PRESETS.find((x) => x.id === presetId);
    if (p) return p.platform;
  }
  const parent = parentFolder(filePath);
  if (DEVICE_ALIASES[parent]) return DEVICE_ALIASES[parent];

  const stem = stripImageExt(name);
  const platNum =
    /^(ios|ipados|macos|iphone|ipad|mac)_(\d+)$/i.exec(stem) ??
    /^appstore\.(ios|ipados|macos)_(\d+)$/i.exec(stem);
  if (platNum) {
    return DEVICE_ALIASES[platNum[1]!.toLowerCase()];
  }
  return undefined;
}

/**
 * Resolve a headline key from filename + optional parent platform folder.
 *
 * iPhone and iPad share the `ios` copy namespace:
 *   ios/2.png  → appstore.ios_2
 *   ipad/2.png → appstore.ios_2
 * Mac stays separate:
 *   macos/1.png → appstore.macos_1
 *
 * Explicit stems win when they already look like a full key
 * (`appstore.ipados_2.png` if you ever need divergent iPad copy).
 */
export function resolveHeadlineKey(
  filePath: string | undefined,
  name: string,
  explicit: string | undefined,
  keyPrefix: string,
  known: Set<string>,
): string | undefined {
  if (explicit?.trim()) return explicit.trim();

  const stem = stripImageExt(name);
  if (known.has(stem)) return stem;
  if (stem.includes(".")) return stem;

  const prefix = keyPrefix.trim() || "appstore";
  const device = resolveDeviceClass(filePath, name);
  const numeric = /^(\d+)$/.exec(stem);

  if (device && numeric) {
    const ns = COPY_NAMESPACE[device];
    return `${prefix}.${ns}_${numeric[1]}`;
  }

  // ios_2.png / ipad_2.png / macos_1.png at the folder root
  const platNum = /^(ios|ipados|macos|iphone|ipad|mac)_(\d+)$/i.exec(stem);
  if (platNum) {
    const deviceFromStem = DEVICE_ALIASES[platNum[1]!.toLowerCase()];
    if (deviceFromStem) {
      return `${prefix}.${COPY_NAMESPACE[deviceFromStem]}_${platNum[2]}`;
    }
  }

  if (known.has(`${prefix}.${stem}`)) return `${prefix}.${stem}`;
  return undefined;
}

/**
 * Slot identity for merging iPhone + iPad into one screen.
 * Same copy namespace + same index → same logical screen
 * (`ios/2` + `ipad/2` → group `ios:2`).
 */
export function resolveSlotGroup(
  filePath: string | undefined,
  name: string,
  headlineKey: string | undefined,
  keyPrefix: string,
): string | undefined {
  const prefix = keyPrefix.trim() || "appstore";
  if (headlineKey) {
    const m = new RegExp(
      `^${escapeRegExp(prefix)}\\.(ios|macos)_(\\d+)$`,
      "i",
    ).exec(headlineKey);
    if (m) return `${m[1]!.toLowerCase()}:${m[2]}`;
  }

  const stem = stripImageExt(name);
  const device = resolveDeviceClass(filePath, name);
  const numeric = /^(\d+)$/.exec(stem);
  if (device && numeric) {
    return `${COPY_NAMESPACE[device]}:${numeric[1]}`;
  }

  const platNum = /^(ios|ipados|macos|iphone|ipad|mac)_(\d+)$/i.exec(stem);
  if (platNum) {
    const d = DEVICE_ALIASES[platNum[1]!.toLowerCase()];
    if (d) return `${COPY_NAMESPACE[d]}:${platNum[2]}`;
  }
  return undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pick a default preset for a device class from image dimensions. */
function presetForDevice(
  device: "ios" | "ipados" | "macos" | undefined,
  width: number,
  height: number,
  forced?: string,
): string {
  if (forced && PRESETS.some((p) => p.id === forced)) return forced;
  const candidates = device
    ? PRESETS.filter((p) => p.platform === device)
    : PRESETS;
  const list = candidates.length ? candidates : PRESETS;
  const ratio = width / Math.max(1, height);
  let best = list[0]!;
  let bestDiff = Infinity;
  for (const p of list) {
    const diff = Math.abs(ratio - p.pointWidth / p.pointHeight);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  return best.id;
}

async function probeSize(
  sourcePath: string | undefined,
  imageDataUrl: string | undefined,
): Promise<{ w: number; h: number }> {
  const sharp = (await import("sharp")).default;
  if (sourcePath) {
    const meta = await sharp(sourcePath).metadata();
    return { w: meta.width ?? 1, h: meta.height ?? 1 };
  }
  const m = /^data:.*?;base64,(.*)$/s.exec(imageDataUrl ?? "");
  if (!m) return { w: 1, h: 1 };
  const meta = await sharp(Buffer.from(m[1]!, "base64")).metadata();
  return { w: meta.width ?? 1, h: meta.height ?? 1 };
}

function applyComposition(
  screen: ScreenTemplate,
  presetId: string,
  theme: FrameTheme,
  headlineKey: string | undefined,
): ScreenTemplate {
  const cfg = store.getConfig();
  const composition: ScreenComposition = {
    mode: "device",
    background: theme.background,
    headlineColor: theme.headlineColor,
    headlineFont: cfg.compositor.headlineFont,
    headlineHeightFraction: cfg.compositor.headlineHeightFraction,
    headlineKey,
  };
  const next = setVariantComposition(screen, presetId, composition);
  next.updatedAt = new Date().toISOString();
  store.upsertScreen(next);
  return store.getScreen(screen.id)!;
}

async function ingestOne(
  spec: IngestFileSpec,
  opts: {
    sourceLocale?: string;
    detectText?: boolean;
    keyPrefix: string;
    known: Set<string>;
    /** slot group → screen id already created in this ingest batch */
    slotScreens: Map<string, string>;
  },
): Promise<IngestItemResult> {
  const name = displayNameFor(spec.path, spec.name);
  const sourcePath = spec.path ? path.resolve(spec.path) : undefined;
  const themeSrc = sourcePath
    ? sourcePath
    : spec.imageDataUrl
      ? Buffer.from(
          /^data:.*?;base64,(.*)$/s.exec(spec.imageDataUrl)?.[1] ?? "",
          "base64",
        )
      : null;
  if (!themeSrc || (Buffer.isBuffer(themeSrc) && themeSrc.length === 0)) {
    throw new Error("path or imageDataUrl is required");
  }

  const theme = await sampleFrameTheme(themeSrc);
  const headlineKey = resolveHeadlineKey(
    sourcePath,
    name,
    spec.headlineKey,
    opts.keyPrefix,
    opts.known,
  );
  const slotGroup = resolveSlotGroup(
    sourcePath,
    name,
    headlineKey,
    opts.keyPrefix,
  );
  const device = resolveDeviceClass(sourcePath, name, spec.presetId);
  const { w, h } = await probeSize(sourcePath, spec.imageDataUrl);
  const presetId = presetForDevice(device, w, h, spec.presetId);

  // Merge iPhone + iPad (same slot) onto one screen as device variants.
  const existingId = slotGroup ? opts.slotScreens.get(slotGroup) : undefined;
  if (existingId) {
    let screen = store.getScreen(existingId);
    if (!screen) throw new Error(`Missing screen ${existingId}`);
    const have = new Set(getScreenPresetIds(screen));
    if (!have.has(presetId)) {
      screen = addScreenVariant(existingId, {
        presetId,
        copyFromPresetId: primaryPresetId(screen),
      });
    }
    screen = await replaceOverlaySource(
      existingId,
      sourcePath ? undefined : spec.imageDataUrl,
      Boolean(opts.detectText),
      presetId,
      sourcePath,
    );
    screen = applyComposition(screen, presetId, theme, headlineKey);
    return {
      sourcePath,
      name,
      headlineKey,
      headlineMatched: Boolean(headlineKey && opts.known.has(headlineKey)),
      mergedVariant: true,
      theme,
      screen,
    };
  }

  const slotMatch = slotGroup ? /^[\w]+:(\d+)$/.exec(slotGroup) : null;
  const screenName = slotMatch ? `Screen ${slotMatch[1]}` : name;

  const created = await createOverlayScreen({
    name: screenName,
    sourceLocale: opts.sourceLocale,
    imagePath: sourcePath,
    imageDataUrl: sourcePath ? undefined : spec.imageDataUrl,
    presetId,
    detectText: opts.detectText,
  });

  let screen = applyComposition(
    created.screen,
    primaryPresetId(created.screen),
    theme,
    headlineKey,
  );

  if (slotGroup) opts.slotScreens.set(slotGroup, screen.id);

  return {
    sourcePath,
    name: screenName,
    headlineKey,
    headlineMatched: Boolean(headlineKey && opts.known.has(headlineKey)),
    mergedVariant: false,
    theme,
    screen,
  };
}

/**
 * Import screenshots from a folder (and/or explicit file list), sample each
 * image's theme colors, and wire composition + headline keys.
 *
 * iPhone (`ios/`) and iPad (`ipad/`) shots with the same index share one
 * screen (two device variants) and one headline key (`appstore.ios_N`).
 */
export async function ingestScreens(input: IngestInput): Promise<IngestResult> {
  if (!store.isOpen()) throw new Error("No project is open");

  const specs: IngestFileSpec[] = [...(input.files ?? [])];
  if (input.dir) {
    for (const p of listImageFiles(input.dir)) {
      specs.push({ path: p });
    }
  }
  if (!specs.length) {
    throw new Error("No images to ingest — pass dir or files");
  }

  // Prefer phone before pad so the primary variant is iPhone when both exist.
  specs.sort((a, b) => {
    const rank = (s: IngestFileSpec) => {
      const d = resolveDeviceClass(
        s.path,
        displayNameFor(s.path, s.name),
        s.presetId,
      );
      if (d === "ios") return 0;
      if (d === "ipados") return 1;
      if (d === "macos") return 2;
      return 3;
    };
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    const ap = a.path ?? a.name ?? "";
    const bp = b.path ?? b.name ?? "";
    return ap.localeCompare(bp, undefined, { numeric: true });
  });

  const known = knownStringKeys();
  const keyPrefix = input.keyPrefix ?? "appstore";
  const slotScreens = new Map<string, string>();
  const created: IngestItemResult[] = [];
  const failed: IngestItemError[] = [];

  for (const spec of specs) {
    const name = displayNameFor(spec.path, spec.name);
    try {
      created.push(
        await ingestOne(spec, {
          sourceLocale: input.sourceLocale,
          detectText: input.detectText,
          keyPrefix,
          known,
          slotScreens,
        }),
      );
    } catch (err) {
      failed.push({
        sourcePath: spec.path,
        name,
        error: String((err as Error)?.message ?? err),
      });
    }
  }

  return { created, failed };
}
