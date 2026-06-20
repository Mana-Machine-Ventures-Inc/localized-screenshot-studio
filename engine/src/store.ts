import fs from "node:fs";
import {
  ensureProjectDirs,
  globalSettingsFile,
  projectPaths,
  type ProjectPaths,
} from "./paths.js";
import * as catalog from "./catalog/index.js";
import type {
  AppStoreMetadataConfig,
  AssetCell,
  CompositorConfig,
  LocalizedString,
  ProjectConfig,
  ProjectData,
  ScreenTemplate,
} from "./types.js";

export const DEFAULT_PRESETS = ["iphone-6-9", "ipad-13"];

export const DEFAULT_COMPOSITOR: CompositorConfig = {
  background: { type: "gradient", from: "#0b1020", to: "#1f6feb", angle: 135 },
  headlineColor: "#ffffff",
  headlineFont: "-apple-system, system-ui, sans-serif",
  headlineStyle: "normal",
  headlineWeight: 800,
  headlineSizePct: 0.052,
  headlineLetterSpacing: -0.01,
  headlineLineHeight: 1.16,
  deviceFrame: true,
  headlineHeightFraction: 0.18,
};

interface GlobalSettings {
  lastProjectPath?: string;
}

/**
 * Single in-memory project session, persisted to `<project>/.lss/project.json`.
 * Kept deliberately simple (a JSON document) so state is transparent and
 * version-controllable.
 */
class Store {
  private config: ProjectConfig | null = null;
  private data: ProjectData | null = null;
  private paths: ProjectPaths | null = null;

  isOpen(): boolean {
    return this.config !== null;
  }

  getPaths(): ProjectPaths {
    if (!this.paths) throw new Error("No project is open");
    return this.paths;
  }

  getConfig(): ProjectConfig {
    if (!this.config) throw new Error("No project is open");
    return this.config;
  }

  getData(): ProjectData | null {
    return this.data;
  }

  setData(data: ProjectData): void {
    this.data = data;
  }

  open(root: string): ProjectConfig {
    const paths = ensureProjectDirs(root);
    this.paths = paths;
    if (fs.existsSync(paths.projectFile)) {
      this.config = JSON.parse(
        fs.readFileSync(paths.projectFile, "utf8"),
      ) as ProjectConfig;
      this.config.projectPath = root;
      // Backfill any newly-added compositor defaults for older projects.
      this.config.compositor = {
        ...DEFAULT_COMPOSITOR,
        ...this.config.compositor,
      };
    } else {
      this.config = {
        projectPath: root,
        baseLocale: "en",
        presetIds: [...DEFAULT_PRESETS],
        compositor: { ...DEFAULT_COMPOSITOR },
        screens: [],
        cells: [],
      };
      this.save();
    }
    this.rememberLastProject(root);
    return this.config;
  }

  save(): void {
    if (!this.config || !this.paths) return;
    fs.writeFileSync(
      this.paths.projectFile,
      JSON.stringify(this.config, null, 2),
      "utf8",
    );
  }

  upsertScreen(screen: ScreenTemplate): void {
    const cfg = this.getConfig();
    const idx = cfg.screens.findIndex((s) => s.id === screen.id);
    if (idx >= 0) cfg.screens[idx] = screen;
    else cfg.screens.push(screen);
    this.save();
  }

  getScreen(id: string): ScreenTemplate | undefined {
    return this.getConfig().screens.find((s) => s.id === id);
  }

  removeScreen(id: string): void {
    const cfg = this.getConfig();
    cfg.screens = cfg.screens.filter((s) => s.id !== id);
    cfg.cells = cfg.cells.filter((c) => c.screenId !== id);
    this.save();
  }

  setCompositor(patch: Partial<CompositorConfig>): CompositorConfig {
    const cfg = this.getConfig();
    cfg.compositor = { ...cfg.compositor, ...patch };
    this.save();
    return cfg.compositor;
  }

  upsertCell(cell: AssetCell): void {
    const cfg = this.getConfig();
    const idx = cfg.cells.findIndex((c) => c.id === cell.id);
    if (idx >= 0) cfg.cells[idx] = cell;
    else cfg.cells.push(cell);
    this.save();
  }

  getCell(id: string): AssetCell | undefined {
    return this.getConfig().cells.find((c) => c.id === id);
  }

  /** Reset a cell back to pending, dropping any captured/composed artifacts. */
  resetCell(id: string): void {
    const cell = this.getCell(id);
    if (!cell) return;
    this.upsertCell({
      id: cell.id,
      screenId: cell.screenId,
      locale: cell.locale,
      presetId: cell.presetId,
      state: "pending",
      updatedAt: new Date().toISOString(),
    });
  }

  /** Synchronise the cell matrix with the current screens x locales x presets. */
  reconcileCells(locales: string[]): void {
    const cfg = this.getConfig();
    const now = new Date().toISOString();
    const wanted = new Set<string>();
    for (const screen of cfg.screens) {
      const presetIds = screen.presetIds.length
        ? screen.presetIds
        : cfg.presetIds;
      for (const locale of locales) {
        for (const presetId of presetIds) {
          const id = cellId(screen.id, locale, presetId);
          wanted.add(id);
          if (!cfg.cells.find((c) => c.id === id)) {
            cfg.cells.push({
              id,
              screenId: screen.id,
              locale,
              presetId,
              state: "pending",
              updatedAt: now,
            });
          }
        }
      }
    }
    cfg.cells = cfg.cells.filter((c) => wanted.has(c.id));
    this.save();
  }

  setAscRef(ref: ProjectConfig["asc"]): void {
    const cfg = this.getConfig();
    cfg.asc = ref;
    this.save();
  }

  setBaseLocale(locale: string): void {
    const cfg = this.getConfig();
    cfg.baseLocale = locale;
    this.save();
  }

  /**
   * Update App Store metadata mappings. Each platform present in the patch
   * fully replaces that platform's mapping (so omitted fields are cleared);
   * platforms absent from the patch are left untouched.
   */
  setMetadata(patch: AppStoreMetadataConfig): AppStoreMetadataConfig {
    const cfg = this.getConfig();
    const next: AppStoreMetadataConfig = { ...(cfg.metadata ?? {}) };
    const prune = (m?: { descriptionKey?: string; whatsNewKey?: string }) => {
      const out: { descriptionKey?: string; whatsNewKey?: string } = {};
      if (m?.descriptionKey?.trim()) out.descriptionKey = m.descriptionKey.trim();
      if (m?.whatsNewKey?.trim()) out.whatsNewKey = m.whatsNewKey.trim();
      return out;
    };
    if ("ios" in patch) next.ios = prune(patch.ios);
    if ("macos" in patch) next.macos = prune(patch.macos);
    cfg.metadata = next;
    this.save();
    return cfg.metadata;
  }

  /**
   * Whether edits should be written straight into the Xcode catalogs. Requires
   * the project to expose a writable catalog and the config flag to be on
   * (defaults on for new + existing projects).
   */
  catalogWriteEnabled(): boolean {
    if (this.config?.writeToCatalog === false) return false;
    return catalog.canWrite(this.data);
  }

  setCatalogWrite(enabled: boolean): void {
    const cfg = this.getConfig();
    cfg.writeToCatalog = enabled;
    this.save();
  }

  /** Filename edits are written to, for surfacing in the UI. */
  catalogLabel(): string | undefined {
    return catalog.catalogLabel(this.data);
  }

  // --- in-memory mirrors so reads reflect catalog writes immediately --------

  private dataEntry(key: string): LocalizedString {
    const data = this.data!;
    let entry = data.strings.find((s) => s.key === key);
    if (!entry) {
      entry = { key, values: {} };
      data.strings.push(entry);
    }
    return entry;
  }

  private dataSetValue(key: string, locale: string, value: string): void {
    if (!this.data) return;
    this.dataEntry(key).values[locale] = value;
    if (!this.data.locales.includes(locale)) this.data.locales.push(locale);
  }

  private dataClearLocale(key: string, locale: string): void {
    const entry = this.data?.strings.find((s) => s.key === key);
    if (entry) delete entry.values[locale];
  }

  private dataRemoveKey(key: string): void {
    if (!this.data) return;
    this.data.strings = this.data.strings.filter((s) => s.key !== key);
  }

  /** Drop any studio overlay for a key/locale so the catalog value wins. */
  private clearOverlay(key: string, locale?: string): void {
    const cfg = this.config;
    if (!cfg) return;
    if (locale === undefined) {
      if (cfg.stringEdits) delete cfg.stringEdits[key];
      cfg.addedStrings = cfg.addedStrings?.filter((s) => s.key !== key);
      cfg.deletedKeys = cfg.deletedKeys?.filter((k) => k !== key);
    } else {
      if (cfg.stringEdits?.[key]) delete cfg.stringEdits[key][locale];
      const added = cfg.addedStrings?.find((s) => s.key === key);
      if (added) delete added.values[locale];
    }
  }

  /** Base (Xcode) strings merged with studio edits + studio-added strings. */
  getMergedStrings(): LocalizedString[] {
    const cfg = this.config;
    const base = this.data?.strings ?? [];
    const map = new Map<string, LocalizedString>();
    for (const s of base) {
      map.set(s.key, { key: s.key, comment: s.comment, values: { ...s.values } });
    }
    for (const s of cfg?.addedStrings ?? []) {
      map.set(s.key, { key: s.key, comment: s.comment, values: { ...s.values } });
    }
    for (const [key, locs] of Object.entries(cfg?.stringEdits ?? {})) {
      const cur = map.get(key) ?? { key, values: {} };
      cur.values = { ...cur.values, ...locs };
      map.set(key, cur);
    }
    const deleted = new Set(cfg?.deletedKeys ?? []);
    return [...map.values()].filter((s) => !deleted.has(s.key));
  }

  resolveString(key: string, locale: string): string | undefined {
    const cfg = this.config;
    const edit = cfg?.stringEdits?.[key]?.[locale];
    if (edit !== undefined) return edit;
    const added = cfg?.addedStrings?.find((s) => s.key === key);
    if (added && added.values[locale] !== undefined) return added.values[locale];
    const base = this.data?.strings.find((s) => s.key === key);
    return base?.values[locale];
  }

  /** Mutate one locale value without persisting (callers must call save()). */
  private writeStringValue(key: string, locale: string, value: string): void {
    const cfg = this.getConfig();
    const added = cfg.addedStrings?.find((s) => s.key === key);
    if (added) {
      added.values[locale] = value;
      return;
    }
    cfg.stringEdits = cfg.stringEdits ?? {};
    cfg.stringEdits[key] = { ...(cfg.stringEdits[key] ?? {}), [locale]: value };
  }

  /** Set/override a single string value for a locale. */
  setStringValue(key: string, locale: string, value: string): void {
    if (this.catalogWriteEnabled() && catalog.setValue(this.data!, key, locale, value)) {
      this.dataSetValue(key, locale, value);
      this.clearOverlay(key, locale);
      this.save();
      return;
    }
    this.writeStringValue(key, locale, value);
    this.save();
  }

  /**
   * Update the default-language value and invalidate every other locale so the
   * translations are flagged missing and must be re-localized. The default is
   * the single source of truth.
   */
  setBaseStringValue(key: string, value: string): void {
    const cfg = this.getConfig();
    const locales = this.data?.locales ?? [cfg.baseLocale];
    if (this.catalogWriteEnabled() && catalog.setValue(this.data!, key, cfg.baseLocale, value)) {
      this.dataSetValue(key, cfg.baseLocale, value);
      this.clearOverlay(key, cfg.baseLocale);
      for (const locale of [...locales]) {
        if (locale === cfg.baseLocale) continue;
        // Drop the stale translation so Xcode (and the studio) flag it missing.
        catalog.clearLocale(this.data!, key, locale);
        this.dataClearLocale(key, locale);
        this.clearOverlay(key, locale);
      }
      this.save();
      return;
    }
    this.writeStringValue(key, cfg.baseLocale, value);
    for (const locale of locales) {
      if (locale === cfg.baseLocale) continue;
      this.writeStringValue(key, locale, "");
    }
    this.save();
  }

  /** Remove a key. With catalog write-through this deletes it from the source. */
  deleteString(key: string): void {
    const cfg = this.getConfig();
    if (this.catalogWriteEnabled() && catalog.removeKey(this.data!, key)) {
      this.dataRemoveKey(key);
      this.clearOverlay(key);
      this.save();
      return;
    }
    if (cfg.addedStrings?.some((s) => s.key === key)) {
      cfg.addedStrings = cfg.addedStrings.filter((s) => s.key !== key);
    }
    if (cfg.stringEdits?.[key]) delete cfg.stringEdits[key];
    cfg.deletedKeys = cfg.deletedKeys ?? [];
    if (!cfg.deletedKeys.includes(key)) cfg.deletedKeys.push(key);
    this.save();
  }

  /** Create a new studio string (e.g. headline copy). */
  addString(key: string, baseValue: string, comment?: string): LocalizedString {
    const cfg = this.getConfig();
    if (cfg.deletedKeys?.includes(key)) {
      cfg.deletedKeys = cfg.deletedKeys.filter((k) => k !== key);
    }
    if (
      this.catalogWriteEnabled() &&
      catalog.addKey(this.data!, key, cfg.baseLocale, baseValue, comment)
    ) {
      const entry = this.dataEntry(key);
      entry.values[cfg.baseLocale] = baseValue;
      if (comment) entry.comment = comment;
      this.clearOverlay(key);
      this.save();
      return { key, comment: entry.comment, values: { ...entry.values } };
    }
    cfg.addedStrings = cfg.addedStrings ?? [];
    const existing = cfg.addedStrings.find((s) => s.key === key);
    if (existing) {
      existing.values[cfg.baseLocale] = baseValue;
      if (comment) existing.comment = comment;
      this.save();
      return existing;
    }
    const entry: LocalizedString = {
      key,
      comment,
      values: { [cfg.baseLocale]: baseValue },
    };
    cfg.addedStrings.push(entry);
    this.save();
    return entry;
  }

  private rememberLastProject(root: string): void {
    const settings = readGlobalSettings();
    settings.lastProjectPath = root;
    fs.writeFileSync(globalSettingsFile(), JSON.stringify(settings, null, 2));
  }
}

export function cellId(
  screenId: string,
  locale: string,
  presetId: string,
): string {
  return `${screenId}__${locale}__${presetId}`;
}

export function readGlobalSettings(): GlobalSettings {
  try {
    return JSON.parse(fs.readFileSync(globalSettingsFile(), "utf8"));
  } catch {
    return {};
  }
}

export function pathsFor(root: string): ProjectPaths {
  return projectPaths(root);
}

export const store = new Store();
