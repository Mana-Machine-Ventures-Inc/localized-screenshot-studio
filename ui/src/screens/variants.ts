import type {
  OverlayScreenData,
  ScreenComposition,
  ScreenTemplate,
} from "../types";

export function getScreenPresetIds(
  screen: ScreenTemplate,
  projectPresets?: string[],
): string[] {
  if (screen.variants && Object.keys(screen.variants).length) {
    return Object.keys(screen.variants);
  }
  if (screen.presetIds?.length) return screen.presetIds;
  return projectPresets?.length ? projectPresets : ["iphone-6-9"];
}

export function primaryPresetId(screen: ScreenTemplate): string {
  return getScreenPresetIds(screen)[0] ?? "iphone-6-9";
}

export function getOverlay(
  screen: ScreenTemplate,
  presetId: string,
): OverlayScreenData | undefined {
  return screen.variants?.[presetId]?.overlay ?? screen.overlay;
}

export function getComposition(
  screen: ScreenTemplate,
  presetId: string,
): ScreenComposition | undefined {
  return screen.variants?.[presetId]?.composition ?? screen.composition;
}

export function hasOverlay(
  screen: ScreenTemplate,
  presetId?: string,
): boolean {
  if (presetId) return Boolean(getOverlay(screen, presetId));
  return getScreenPresetIds(screen).some((id) => getOverlay(screen, id));
}
