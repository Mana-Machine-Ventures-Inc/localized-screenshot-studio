import type { DevicePreset } from "../types.js";

/**
 * App Store Connect requires exact screenshot pixel dimensions per display type.
 * We render at logical points with a pinned devicePixelRatio so the captured
 * PNG lands on the required pixel size deterministically.
 *
 * Display-type enums match App Store Connect's `screenshotDisplayType`.
 */
export const PRESETS: DevicePreset[] = [
  {
    id: "iphone-6-9",
    label: 'iPhone 6.9"',
    ascDisplayType: "APP_IPHONE_67", // 6.7/6.9" share the 1290x2796 slot
    pointWidth: 430,
    pointHeight: 932,
    scale: 3,
    pixelWidth: 1290,
    pixelHeight: 2796,
    platform: "ios",
    orientation: "portrait",
    cornerRadius: 55,
  },
  {
    id: "iphone-6-5",
    label: 'iPhone 6.5"',
    ascDisplayType: "APP_IPHONE_65",
    pointWidth: 414,
    pointHeight: 896,
    scale: 3,
    pixelWidth: 1242,
    pixelHeight: 2688,
    platform: "ios",
    orientation: "portrait",
    cornerRadius: 48,
  },
  {
    id: "iphone-5-5",
    label: 'iPhone 5.5"',
    ascDisplayType: "APP_IPHONE_55",
    pointWidth: 414,
    pointHeight: 736,
    scale: 3,
    pixelWidth: 1242,
    pixelHeight: 2208,
    platform: "ios",
    orientation: "portrait",
    cornerRadius: 0,
  },
  {
    id: "ipad-13",
    label: 'iPad 13" — Portrait',
    ascDisplayType: "APP_IPAD_PRO_3GEN_129",
    pointWidth: 1032,
    pointHeight: 1376,
    scale: 2,
    pixelWidth: 2064,
    pixelHeight: 2752,
    platform: "ipados",
    orientation: "portrait",
    cornerRadius: 24,
  },
  {
    id: "ipad-13-landscape",
    label: 'iPad 13" — Landscape',
    ascDisplayType: "APP_IPAD_PRO_3GEN_129",
    pointWidth: 1376,
    pointHeight: 1032,
    scale: 2,
    pixelWidth: 2752,
    pixelHeight: 2064,
    platform: "ipados",
    orientation: "landscape",
    cornerRadius: 24,
  },
  {
    id: "mac",
    label: "Mac App Store",
    ascDisplayType: "APP_DESKTOP",
    pointWidth: 1440,
    pointHeight: 900,
    scale: 1,
    pixelWidth: 1440,
    pixelHeight: 900,
    platform: "macos",
    orientation: "landscape",
    cornerRadius: 0,
  },
];

const byId = new Map(PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string): DevicePreset {
  const preset = byId.get(id);
  if (!preset) throw new Error(`Unknown device preset: ${id}`);
  return preset;
}

/** The matching iPad preset in the opposite orientation, if any. */
export function oppositeOrientation(id: string): DevicePreset | undefined {
  if (id === "ipad-13") return byId.get("ipad-13-landscape");
  if (id === "ipad-13-landscape") return byId.get("ipad-13");
  return undefined;
}
