import type {
  OverlayScreenData,
  ScreenComposition,
  ScreenTemplate,
  TextSlot,
} from "../types.js";

/** Per-device overlay + composition within a single logical screen slot. */
export interface ScreenVariant {
  overlay?: OverlayScreenData;
  composition?: ScreenComposition;
}

/** Migrate legacy top-level overlay/composition into `variants`. */
export function migrateScreen(screen: ScreenTemplate): ScreenTemplate {
  if (screen.variants && Object.keys(screen.variants).length > 0) {
    const presetIds = Object.keys(screen.variants);
    return { ...screen, presetIds: presetIds.length ? presetIds : screen.presetIds };
  }

  const presetIds = screen.presetIds?.length ? [...screen.presetIds] : [];
  const primary = presetIds[0] ?? "iphone-6-9";
  const ids = presetIds.length ? presetIds : [primary];

  if (!screen.overlay && !screen.composition) {
    return { ...screen, variants: {}, presetIds: ids };
  }

  const overlayClone = screen.overlay
    ? (JSON.parse(JSON.stringify(screen.overlay)) as OverlayScreenData)
    : undefined;
  const compClone = screen.composition
    ? (JSON.parse(JSON.stringify(screen.composition)) as ScreenComposition)
    : undefined;

  const variants: Record<string, ScreenVariant> = {};
  for (const pid of ids) {
    variants[pid] = {
      overlay: overlayClone
        ? (JSON.parse(JSON.stringify(overlayClone)) as OverlayScreenData)
        : undefined,
      composition: compClone
        ? (JSON.parse(JSON.stringify(compClone)) as ScreenComposition)
        : undefined,
    };
  }

  return { ...screen, variants, presetIds: ids };
}

/** Strip legacy top-level overlay/composition once variants are present. */
export function normalizeScreen(screen: ScreenTemplate): ScreenTemplate {
  const migrated = migrateScreen(screen);
  if (!migrated.variants || !Object.keys(migrated.variants).length) {
    return migrated;
  }
  const presetIds = Object.keys(migrated.variants);
  return {
    id: migrated.id,
    name: migrated.name,
    kind: migrated.kind,
    stringKeys: recomputeStringKeys(migrated),
    headline: migrated.headline,
    variants: migrated.variants,
    presetIds,
    createdAt: migrated.createdAt,
    updatedAt: migrated.updatedAt,
  };
}

export function primaryPresetId(screen: ScreenTemplate): string {
  const ids = getScreenPresetIds(screen);
  return ids[0] ?? "iphone-6-9";
}

export function getScreenPresetIds(
  screen: ScreenTemplate,
  projectPresets?: string[],
): string[] {
  const migrated = migrateScreen(screen);
  if (migrated.variants && Object.keys(migrated.variants).length) {
    return Object.keys(migrated.variants);
  }
  if (migrated.presetIds?.length) return migrated.presetIds;
  return projectPresets?.length ? projectPresets : ["iphone-6-9"];
}

export function getVariant(
  screen: ScreenTemplate,
  presetId: string,
): ScreenVariant {
  const migrated = migrateScreen(screen);
  return migrated.variants?.[presetId] ?? {};
}

export function getOverlay(
  screen: ScreenTemplate,
  presetId: string,
): OverlayScreenData | undefined {
  return getVariant(screen, presetId).overlay ?? screen.overlay;
}

export function getComposition(
  screen: ScreenTemplate,
  presetId: string,
): ScreenComposition | undefined {
  return getVariant(screen, presetId).composition ?? screen.composition;
}

export function setVariantOverlay(
  screen: ScreenTemplate,
  presetId: string,
  overlay: OverlayScreenData | undefined,
): ScreenTemplate {
  const next = migrateScreen(screen);
  next.variants = next.variants ?? {};
  next.variants[presetId] = { ...next.variants[presetId], overlay };
  next.presetIds = Object.keys(next.variants);
  next.stringKeys = recomputeStringKeys(next);
  return normalizeScreen(next);
}

export function setVariantComposition(
  screen: ScreenTemplate,
  presetId: string,
  composition: ScreenComposition | undefined,
): ScreenTemplate {
  const next = migrateScreen(screen);
  next.variants = next.variants ?? {};
  next.variants[presetId] = { ...next.variants[presetId], composition };
  next.presetIds = Object.keys(next.variants);
  return normalizeScreen(next);
}

/** Ensure a variant bucket exists; optionally seed composition from another preset. */
export function ensureVariant(
  screen: ScreenTemplate,
  presetId: string,
  copyFromPresetId?: string,
): ScreenTemplate {
  const next = migrateScreen(screen);
  next.variants = next.variants ?? {};
  if (!next.variants[presetId]) {
    const src = copyFromPresetId
      ? getVariant(next, copyFromPresetId)
      : getVariant(next, primaryPresetId(next));
    next.variants[presetId] = {
      composition: src.composition
        ? (JSON.parse(JSON.stringify(src.composition)) as ScreenComposition)
        : undefined,
    };
  }
  next.presetIds = Object.keys(next.variants);
  return normalizeScreen(next);
}

export function removeVariant(
  screen: ScreenTemplate,
  presetId: string,
): ScreenTemplate {
  const next = migrateScreen(screen);
  if (!next.variants) return next;
  delete next.variants[presetId];
  next.presetIds = Object.keys(next.variants);
  next.stringKeys = recomputeStringKeys(next);
  return normalizeScreen(next);
}

export function recomputeStringKeys(screen: ScreenTemplate): string[] {
  const migrated = migrateScreen(screen);
  const keys = new Set<string>();
  const variants = migrated.variants ?? {};
  for (const v of Object.values(variants)) {
    for (const slot of v.overlay?.slots ?? []) {
      if (slot.linkedKey) keys.add(slot.linkedKey);
    }
  }
  if (!keys.size && migrated.overlay) {
    for (const slot of migrated.overlay.slots) {
      if (slot.linkedKey) keys.add(slot.linkedKey);
    }
  }
  return [...keys];
}

export function slotsFromOverlay(overlay?: OverlayScreenData): TextSlot[] {
  return overlay?.slots ?? [];
}
