// Client-side mirror of the engine domain types (only what the UI needs).

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

export interface DevicePreset {
  id: string;
  label: string;
  ascDisplayType: string;
  pointWidth: number;
  pointHeight: number;
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
  platform: string;
  orientation: "portrait" | "landscape";
  cornerRadius: number;
}

export type ScreenKind = "overlay";
export type SlotAlign = "left" | "center" | "right";
export type SlotVAlign = "top" | "middle" | "bottom";
export type SlotAutoFit = "shrink" | "wrap" | "none";

export interface SlotTypography {
  fontFamily: string;
  fontWeight: number;
  fontStyle?: "normal" | "italic";
  fontSizePct: number;
  color: string;
  align: SlotAlign;
  valign: SlotVAlign;
  lineHeight: number;
  letterSpacing: number;
  autoFit: SlotAutoFit;
  maxLines: number;
}

export interface SlotMask {
  mode: "solid" | "none";
  color: string;
  padding: number;
  radius: number;
}

export interface TextSlot {
  id: string;
  box: { x: number; y: number; w: number; h: number };
  linkedKey?: string;
  literal?: string;
  detectedText?: string;
  confidence?: number;
  mask: SlotMask;
  type: SlotTypography;
  localeOverrides?: Record<
    string,
    Partial<SlotTypography> & { box?: TextSlot["box"] }
  >;
}

export interface OverlayScreenData {
  sourceLocale: string;
  sourceImagePath: string;
  platePath: string;
  plateWidth: number;
  plateHeight: number;
  slots: TextSlot[];
}

export type CompositionMode = "passthrough" | "device";

export interface ScreenComposition {
  mode: CompositionMode;
  background:
    | { type: "solid"; color: string }
    | { type: "gradient"; from: string; to: string; angle: number };
  headlineColor: string;
  headlineFont: string;
  headlineHeightFraction: number;
  headlineKey?: string;
  headlineText?: Record<string, string>;
}

export interface ScreenTemplate {
  id: string;
  name: string;
  kind?: ScreenKind;
  stringKeys: string[];
  overlay?: OverlayScreenData;
  headline: Record<string, string>;
  composition?: ScreenComposition;
  presetIds: string[];
}

export interface StringEntry {
  key: string;
  comment?: string;
  values: Record<string, string>;
  added?: boolean;
  edited?: boolean;
}

export interface AssetCell {
  id: string;
  screenId: string;
  locale: string;
  presetId: string;
  state: AssetState;
  capturePath?: string;
  composedPath?: string;
  overflow?: boolean;
  lastError?: string;
  ascScreenshotId?: string;
}

export interface CompositorConfig {
  background:
    | { type: "solid"; color: string }
    | { type: "gradient"; from: string; to: string; angle: number };
  headlineColor: string;
  headlineFont: string;
  headlineStyle?: "normal" | "italic";
  headlineWeight: number;
  headlineSizePct: number;
  headlineLetterSpacing: number;
  headlineLineHeight: number;
  deviceFrame: boolean;
  headlineHeightFraction: number;
  perDevice?: Record<string, DeviceTypography>;
}

export interface DeviceTypography {
  headlineSizePct?: number;
  headlineHeightFraction?: number;
}

export type StorePlatform = "ios" | "macos";

export interface UploadRecord {
  cellId: string;
  locale: string;
  presetId: string;
  displayType: string;
  platform: StorePlatform;
  version?: string;
  build?: string;
  ascScreenshotId?: string;
  uploadedAt: string;
}

export interface PlatformMetadata {
  descriptionKey?: string;
  whatsNewKey?: string;
}

export interface AppStoreMetadataConfig {
  ios?: PlatformMetadata;
  macos?: PlatformMetadata;
}

export interface ProjectConfig {
  projectPath: string;
  baseLocale: string;
  presetIds: string[];
  compositor: CompositorConfig;
  screens: ScreenTemplate[];
  cells: AssetCell[];
  stringEdits?: Record<string, Record<string, string>>;
  addedStrings?: { key: string; comment?: string; values: Record<string, string> }[];
  metadata?: AppStoreMetadataConfig;
  uploads?: UploadRecord[];
  asc?: {
    issuerId?: string;
    keyId?: string;
    appId?: string;
    versionString?: string;
    hasKey: boolean;
  };
}

export interface ProjectSummary {
  appName: string;
  bundleId?: string;
  marketingVersion?: string;
  buildNumber?: string;
  locales: string[];
  baseLocale: string;
  stringCount: number;
  keys: { key: string; base: string }[];
  releaseNoteLocales: string[];
  tokens: {
    colorCount: number;
    fontCount: number;
    hasAppIcon: boolean;
    sfSymbolCount: number;
    accentColor?: string;
  };
}

export interface UploadJobItem {
  cellId?: string;
  locale: string;
  presetId?: string;
  platform?: StorePlatform;
  displayType?: string;
  kind: "screenshot" | "metadata" | "clear";
  state: AssetState;
  attempts: number;
  error?: string;
  note?: string;
  log?: string[];
}

export interface UploadJob {
  id: string;
  kind: "screenshots" | "metadata" | "both";
  dryRun: boolean;
  items: UploadJobItem[];
  done: boolean;
  cancelled?: boolean;
  error?: string;
}
