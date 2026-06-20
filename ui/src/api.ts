import type {
  AppStoreMetadataConfig,
  AssetCell,
  CompositorConfig,
  DevicePreset,
  ProjectConfig,
  ProjectSummary,
  ScreenComposition,
  ScreenTemplate,
  StringEntry,
  TextSlot,
  UploadJob,
} from "./types";

declare global {
  interface Window {
    __LSS_ENGINE__?: string;
  }
}

// In dev the Vite proxy forwards /api and /render to the engine. In a packaged
// Tauri build, window.__LSS_ENGINE__ points at the local engine sidecar.
export const API_BASE = window.__LSS_ENGINE__ ?? "";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

export interface LocalizeResponse {
  key: string;
  baseLocale: string;
  baseValue: string;
  engine: "openai" | "none";
  model?: string;
  results: Record<string, { value?: string; error?: string }>;
  saved: string[];
}

export interface ProjectFont {
  label: string;
  family: string;
  weights: number[];
  italic: boolean;
}

export interface ProjectResponse {
  open: boolean;
  config?: ProjectConfig;
  data?: ProjectSummary | null;
}

export const api = {
  getProject: () => req<ProjectResponse>("GET", "/api/project"),
  openProject: (path: string) =>
    req<{ config: ProjectConfig; data: ProjectSummary }>(
      "POST",
      "/api/project/open",
      { path },
    ),
  getPresets: () => req<DevicePreset[]>("GET", "/api/presets"),
  getFonts: () =>
    req<{ fonts: ProjectFont[] }>("GET", "/api/fonts"),
  setSettings: (input: { baseLocale?: string }) =>
    req<{ config: ProjectConfig; data: ProjectSummary }>(
      "PUT",
      "/api/project/settings",
      input,
    ),
  setMetadata: (input: AppStoreMetadataConfig) =>
    req<{ metadata: AppStoreMetadataConfig }>("PUT", "/api/metadata", input),
  getStrings: () =>
    req<{
      open: boolean;
      baseLocale: string;
      locales: string[];
      catalogWrite?: boolean;
      catalogFile?: string;
      strings: StringEntry[];
    }>("GET", "/api/strings"),
  setCatalogWrite: (enabled: boolean) =>
    req<{ catalogWrite: boolean; catalogFile?: string }>(
      "PUT",
      "/api/strings/catalog-write",
      { enabled },
    ),
  setString: (key: string, locale: string, value: string) =>
    req<{ ok: boolean }>("PUT", `/api/strings/${encodeURIComponent(key)}`, {
      locale,
      value,
    }),
  setBaseString: (key: string, value: string) =>
    req<{ ok: boolean }>(
      "PUT",
      `/api/strings/${encodeURIComponent(key)}/base`,
      { value },
    ),
  deleteString: (key: string) =>
    req<{ ok: boolean }>("DELETE", `/api/strings/${encodeURIComponent(key)}`),
  localizeString: (key: string, locales?: string[]) =>
    req<LocalizeResponse>(
      "POST",
      `/api/strings/${encodeURIComponent(key)}/localize`,
      { locales },
    ),
  addString: (key: string, value: string, comment?: string) =>
    req<{ string: StringEntry }>("POST", "/api/strings", {
      key,
      value,
      comment,
    }),
  deleteScreen: (screenId: string) =>
    req<{ ok: boolean; config: ProjectConfig }>(
      "DELETE",
      `/api/screens/${screenId}`,
    ),
  setCompositor: (patch: Partial<CompositorConfig>) =>
    req<{ compositor: CompositorConfig }>("PUT", "/api/compositor", patch),
  setComposition: (screenId: string, composition: ScreenComposition) =>
    req<{ screen: ScreenTemplate }>(
      "PUT",
      `/api/screens/${screenId}/composition`,
      { composition },
    ),
  createHeadline: (screenId: string, text: string, key?: string) =>
    req<{ screen: ScreenTemplate; key: string }>(
      "POST",
      `/api/screens/${screenId}/composition/headline`,
      { text, key },
    ),
  replaceSource: (screenId: string, imageDataUrl: string, reocr: boolean) =>
    req<{ screen: ScreenTemplate }>(
      "POST",
      `/api/overlay/screens/${screenId}/source`,
      { imageDataUrl, reocr },
    ),
  setHeadline: (screenId: string, locale: string, value: string) =>
    req<ScreenTemplate>("POST", `/api/screens/${screenId}/headline`, {
      locale,
      value,
    }),
  createOverlay: (input: {
    name: string;
    sourceLocale?: string;
    imageDataUrl: string;
    presetId?: string;
  }) =>
    req<{
      screen: ScreenTemplate;
      ocrEngine: string;
      detectedCount: number;
      matchedCount: number;
    }>("POST", "/api/overlay/screens", input),
  updateOverlay: (
    screenId: string,
    input: {
      name?: string;
      sourceLocale?: string;
      slots?: TextSlot[];
      presetIds?: string[];
    },
  ) =>
    req<{ screen: ScreenTemplate }>(
      "PUT",
      `/api/overlay/screens/${screenId}`,
      input,
    ),
  rebuildPlate: (screenId: string) =>
    req<{ screen: ScreenTemplate }>(
      "POST",
      `/api/overlay/screens/${screenId}/plate`,
    ),
  sampleColors: (
    screenId: string,
    box: { x: number; y: number; w: number; h: number },
  ) =>
    req<{ background: string; textColor: string }>(
      "POST",
      `/api/overlay/screens/${screenId}/sample`,
      { box },
    ),
  capture: (sel: CellSelector) =>
    req<{ cells: AssetCell[] }>("POST", "/api/capture", sel),
  compose: (sel: CellSelector) =>
    req<{ cells: AssetCell[] }>("POST", "/api/compose", sel),
  clearCells: (sel: CellSelector) =>
    req<{ cleared: number }>("POST", "/api/cells/clear", sel),
  approve: (cellId: string) =>
    req<AssetCell>("POST", `/api/cells/${cellId}/approve`),
  ascStatus: () =>
    req<{ hasCredentials: boolean; ref?: ProjectConfig["asc"] }>(
      "GET",
      "/api/asc/status",
    ),
  saveCredentials: (input: {
    issuerId: string;
    keyId: string;
    appId: string;
    privateKey: string;
    versionString?: string;
  }) => req<{ ok: boolean }>("POST", "/api/asc/credentials", input),
  upload: (opts: {
    kind: "screenshots" | "metadata" | "both";
    dryRun?: boolean;
    cellIds?: string[];
    locales?: string[];
  }) => req<{ job: UploadJob }>("POST", "/api/upload", opts),
  getJob: (id: string) => req<UploadJob>("GET", `/api/jobs/${id}`),
};

export interface CellSelector {
  cellIds?: string[];
  screenId?: string;
  locales?: string[];
  presetIds?: string[];
}

export function imageUrl(path: string): string {
  return `${API_BASE}/api/image?path=${encodeURIComponent(path)}&t=${Date.now()}`;
}

export function renderUrl(
  screenId: string,
  locale: string,
  preset: string,
): string {
  return `${API_BASE}/render/${screenId}?locale=${locale}&preset=${preset}&t=${Date.now()}`;
}

/** URL for an overlay screen's source upload or generated clean plate. */
export function overlayImageUrl(
  screenId: string,
  which: "source" | "plate",
  bust?: number,
): string {
  return `${API_BASE}/overlay/${screenId}/${which}?t=${bust ?? Date.now()}`;
}

/** Subscribe to upload job progress via Server-Sent Events. */
export function subscribeJob(
  id: string,
  onEvent: (msg: { event: string; payload: unknown }) => void,
): () => void {
  const es = new EventSource(`${API_BASE}/api/jobs/${id}/events`);
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      /* ignore malformed */
    }
  };
  return () => es.close();
}
