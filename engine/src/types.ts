// Shared domain types for the Localized Screenshot & Release Studio engine.

/** A single localized value for a string key. */
export interface LocalizedString {
  key: string;
  /** locale code (e.g. "en", "fr", "de") -> translated value */
  values: Record<string, string>;
  comment?: string;
}

/** Design tokens extracted from the Xcode project to keep replicas on-brand. */
export interface DesignTokens {
  /** Named colors from asset catalogs, hex form (light appearance). */
  colors: Record<string, string>;
  /** Dark-appearance variants where available. */
  colorsDark: Record<string, string>;
  /** Bundled custom font family names discovered in the project. */
  fonts: FontAsset[];
  /** Absolute path to the largest app icon found, if any. */
  appIconPath?: string;
  /** Data URL of the app icon for direct embedding in templates. */
  appIconDataUrl?: string;
  /** SF Symbols referenced in source (best-effort scan). */
  sfSymbols: string[];
  /** A small palette derived from the icon / named colors for backgrounds. */
  accentColor?: string;
}

export interface FontAsset {
  family: string;
  path: string;
  /** css-friendly format, e.g. "truetype", "opentype". */
  format: string;
  dataUrl?: string;
  /** numeric weight parsed from the file name (100..900), defaults to 400. */
  weight?: number;
  /** font style parsed from the file name. */
  style?: "normal" | "italic";
}

/** Where a string key physically lives so the studio can write edits back. */
export interface CatalogRef {
  kind: "xcstrings" | "strings";
  /**
   * For `.xcstrings`: the catalog file. For legacy `.strings`: a representative
   * locale file (other locales are derived by swapping the `.lproj` segment).
   */
  file: string;
}

/** Result of reading an Xcode project. */
export interface ProjectData {
  projectPath: string;
  /** display name from Info.plist / project, best-effort. */
  appName: string;
  bundleId?: string;
  /** CFBundleShortVersionString (MARKETING_VERSION), best-effort. */
  marketingVersion?: string;
  /** CFBundleVersion (CURRENT_PROJECT_VERSION), best-effort. */
  buildNumber?: string;
  locales: string[];
  baseLocale: string;
  strings: LocalizedString[];
  releaseNotes: Record<string, string>;
  tokens: DesignTokens;
  /** key -> source catalog, used for write-back. Recomputed on every read. */
  catalogIndex?: Record<string, CatalogRef>;
  /** default `.xcstrings` catalog that receives brand-new keys, if any. */
  defaultCatalog?: string;
  /** a representative legacy `.strings` file (fallback for new keys). */
  defaultStringsFile?: string;
}

/** App Store device preset for capture + compose. */
export interface DevicePreset {
  id: string;
  label: string;
  /** App Store Connect display type enum (screenshotDisplayType). */
  ascDisplayType: string;
  /** logical CSS points used to render the page. */
  pointWidth: number;
  pointHeight: number;
  /** devicePixelRatio used during capture. */
  scale: number;
  /** required output pixel dimensions = point * scale. */
  pixelWidth: number;
  pixelHeight: number;
  platform: "ios" | "ipados" | "macos";
  /** screen orientation; iPad ships both, other devices are fixed. */
  orientation: "portrait" | "landscape";
  /** corner radius (in points) used by the synthetic device frame. */
  cornerRadius: number;
}

/** How a screen produces its capture PNG. */
export type ScreenKind = "overlay";

export interface ScreenTemplate {
  id: string;
  name: string;
  /** Currently always "overlay" = real screenshot + localized text slots. */
  kind?: ScreenKind;
  /** string keys this screen references (derived from its text slots). */
  stringKeys: string[];
  /** overlay data (source screenshot, clean plate, and text slots). */
  overlay?: OverlayScreenData;
  /** marketing headline keyed by locale, shown in the promo frame. */
  headline: Record<string, string>;
  /** per-screen composition (frame/background/headline). */
  composition?: ScreenComposition;
  /** device presets this screen targets. */
  presetIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type CompositionMode = "passthrough" | "device";

/** How a captured screen is wrapped into the final App Store image. */
export interface ScreenComposition {
  mode: CompositionMode;
  background:
    | { type: "solid"; color: string }
    | { type: "gradient"; from: string; to: string; angle: number };
  headlineColor: string;
  headlineFont: string;
  /** fraction of canvas reserved for the headline (device mode). */
  headlineHeightFraction: number;
  /** localizable key powering the headline text (preferred). */
  headlineKey?: string;
  /** literal headline per locale, used when no key is linked. */
  headlineText?: Record<string, string>;
}

export type SlotAlign = "left" | "center" | "right";
export type SlotVAlign = "top" | "middle" | "bottom";
/** shrink = reduce font until it fits one area; wrap = allow line wrap. */
export type SlotAutoFit = "shrink" | "wrap" | "none";

export interface SlotTypography {
  fontFamily: string;
  fontWeight: number;
  /** "normal" | "italic" — defaults to "normal" when absent. */
  fontStyle?: "normal" | "italic";
  /** font size as a fraction of the plate height (resolution independent). */
  fontSizePct: number;
  color: string;
  align: SlotAlign;
  valign: SlotVAlign;
  /** unitless line-height multiplier. */
  lineHeight: number;
  /** letter spacing in em. */
  letterSpacing: number;
  autoFit: SlotAutoFit;
  maxLines: number;
}

export interface SlotMask {
  mode: "solid" | "none";
  /** hex fill used to cover the original text. */
  color: string;
  /** padding around the text box as a fraction of plate height. */
  padding: number;
  /** corner radius in plate pixels. */
  radius: number;
}

/** A localizable text region detected on (or added to) a screenshot. */
export interface TextSlot {
  id: string;
  /** normalized box (0..1) relative to the plate. */
  box: { x: number; y: number; w: number; h: number };
  /** matched localizable key, if any. */
  linkedKey?: string;
  /** literal text used when no key is linked. */
  literal?: string;
  /** raw OCR text, for reference in the editor. */
  detectedText?: string;
  /** OCR/match confidence 0..1. */
  confidence?: number;
  mask: SlotMask;
  type: SlotTypography;
  /** per-locale overrides of typography and/or box. */
  localeOverrides?: Record<
    string,
    Partial<SlotTypography> & { box?: TextSlot["box"] }
  >;
}

export interface OverlayScreenData {
  /** language the source screenshot was captured in. */
  sourceLocale: string;
  /** original upload, relative to .lss/. */
  sourceImagePath: string;
  /** cleaned plate (text masked out), relative to .lss/. */
  platePath: string;
  /** native pixel size of the source/plate. */
  plateWidth: number;
  plateHeight: number;
  slots: TextSlot[];
}

export type AssetState =
  | "pending"
  | "generated"
  | "captured"
  | "composed"
  | "approved"
  | "uploading"
  | "committed"
  | "verified"
  | "failed";

/** One cell of the screen x locale x preset matrix. */
export interface AssetCell {
  id: string;
  screenId: string;
  locale: string;
  presetId: string;
  state: AssetState;
  capturePath?: string;
  composedPath?: string;
  checksum?: string;
  overflow?: boolean;
  lastError?: string;
  ascScreenshotId?: string;
  updatedAt: string;
}

export interface CompositorConfig {
  /** global headline typography — applies to every composition. */
  headlineWeight: number;
  /** headline font size as a fraction of canvas width. */
  headlineSizePct: number;
  /** headline letter spacing in em. */
  headlineLetterSpacing: number;
  /** headline line-height multiplier. */
  headlineLineHeight: number;
  /** background style for the promo frame. */
  background:
    | { type: "solid"; color: string }
    | { type: "gradient"; from: string; to: string; angle: number };
  headlineColor: string;
  headlineFont: string;
  /** "normal" | "italic" — defaults to "normal" when absent. */
  headlineStyle?: "normal" | "italic";
  /** show synthetic device bezel around the screenshot. */
  deviceFrame: boolean;
  /** fraction of canvas height reserved for the headline (0..1). */
  headlineHeightFraction: number;
}

export interface AscCredentials {
  issuerId: string;
  keyId: string;
  /** PEM/p8 private key contents. Stored in OS keychain, never in project file. */
  privateKey: string;
  appId: string;
  /** optional explicit appStoreVersion id; otherwise resolved by version string. */
  versionId?: string;
  versionString?: string;
}

export interface ProjectConfig {
  projectPath: string;
  baseLocale: string;
  presetIds: string[];
  compositor: CompositorConfig;
  screens: ScreenTemplate[];
  cells: AssetCell[];
  /** studio overrides of existing string values: key -> locale -> value. */
  stringEdits?: Record<string, Record<string, string>>;
  /** strings created inside the studio (e.g. headline copy). */
  addedStrings?: LocalizedString[];
  /** keys hidden/removed inside the studio (base Xcode keys can't be deleted at source). */
  deletedKeys?: string[];
  /**
   * When true (default), string edits are written straight back into the
   * project's `.xcstrings` / `.strings` files instead of staying as a studio
   * overlay. The studio acts as a live editor of the Xcode catalogs.
   */
  writeToCatalog?: boolean;
  /** which localized string keys drive App Store metadata, per platform. */
  metadata?: AppStoreMetadataConfig;
  /** redacted ASC config reference (no secrets persisted to disk). */
  asc?: {
    issuerId?: string;
    keyId?: string;
    appId?: string;
    versionString?: string;
    hasKey: boolean;
  };
}

export type UploadKind = "screenshots" | "metadata" | "both";

/** App Store platform group we expose in the studio. */
export type StorePlatform = "ios" | "macos";

/** Localized string keys that supply App Store metadata for one platform. */
export interface PlatformMetadata {
  descriptionKey?: string;
  whatsNewKey?: string;
}

export interface AppStoreMetadataConfig {
  ios?: PlatformMetadata;
  macos?: PlatformMetadata;
}

export interface UploadJobItem {
  cellId?: string;
  locale: string;
  presetId?: string;
  /** which App Store platform this item targets. */
  platform?: StorePlatform;
  kind: "screenshot" | "metadata";
  state: AssetState;
  attempts: number;
  error?: string;
}

export interface UploadJob {
  id: string;
  kind: UploadKind;
  dryRun: boolean;
  createdAt: string;
  items: UploadJobItem[];
  done: boolean;
}
