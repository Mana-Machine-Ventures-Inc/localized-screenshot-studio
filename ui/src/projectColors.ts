import { normalizeHex } from "./color";
import { getComposition, getOverlay, getScreenPresetIds } from "./screens/variants";
import type { ProjectConfig, ScreenComposition, ScreenTemplate } from "./types";

export interface ColorSwatch {
  hex: string;
  label: string;
}

export interface ColorSwatchGroup {
  label: string;
  colors: ColorSwatch[];
}

function deviceShort(presetId: string): string {
  if (presetId.startsWith("ipad")) {
    return presetId.includes("landscape") ? "iPad LS" : "iPad";
  }
  if (presetId.startsWith("iphone")) return "iPhone";
  if (presetId.startsWith("mac")) return "Mac";
  return "Device";
}

function screenNumber(screen: ScreenTemplate, index: number): number {
  const m = screen.name.match(/(\d+)\s*$/) ?? screen.name.match(/(\d+)/);
  return m ? Number(m[1]) : index + 1;
}

/** Brisk usage name: "iPad #3" for iPad 13" / Screen Shot 3. */
export function usageLabel(
  presetId: string,
  screen: ScreenTemplate,
  index: number,
): string {
  return `${deviceShort(presetId)} #${screenNumber(screen, index)}`;
}

function addUsage(
  map: Map<string, ColorSwatch>,
  raw: string | undefined,
  label: string,
) {
  const hex = normalizeHex(raw);
  if (!hex || map.has(hex)) return;
  map.set(hex, { hex, label });
}

function addBackground(
  map: Map<string, ColorSwatch>,
  bg: ScreenComposition["background"] | undefined,
  label: string,
) {
  if (!bg) return;
  if (bg.type === "solid") addUsage(map, bg.color, label);
  else {
    addUsage(map, bg.from, label);
    addUsage(map, bg.to, label);
  }
}

/**
 * Unique Frame (and Source) colors across the project, grouped by role.
 * A shared hex appears once; the label is the first usage in screen order.
 */
export function frameColorPalette(config: ProjectConfig): ColorSwatchGroup[] {
  const backgrounds = new Map<string, ColorSwatch>();
  const headlines = new Map<string, ColorSwatch>();
  const texts = new Map<string, ColorSwatch>();
  const masks = new Map<string, ColorSwatch>();

  config.screens.forEach((screen, index) => {
    const presetIds = getScreenPresetIds(screen, config.presetIds);
    for (const presetId of presetIds) {
      const label = usageLabel(presetId, screen, index);
      const comp = getComposition(screen, presetId);
      if (comp) {
        addUsage(headlines, comp.headlineColor, label);
        addBackground(backgrounds, comp.background, label);
      }
      const overlay = getOverlay(screen, presetId);
      if (!overlay) continue;
      for (const slot of overlay.slots) {
        addUsage(texts, slot.type.color, label);
        if (slot.mask.mode === "solid") addUsage(masks, slot.mask.color, label);
      }
    }
  });

  addUsage(headlines, config.compositor.headlineColor, "Default");
  addBackground(backgrounds, config.compositor.background, "Default");

  const groups: ColorSwatchGroup[] = [];
  if (backgrounds.size) groups.push({ label: "Backgrounds", colors: [...backgrounds.values()] });
  if (headlines.size) groups.push({ label: "Headlines", colors: [...headlines.values()] });
  if (texts.size) groups.push({ label: "Text", colors: [...texts.values()] });
  if (masks.size) groups.push({ label: "Masks", colors: [...masks.values()] });
  return groups;
}
