import { useEffect, useState } from "react";
import type {
  AppStoreMetadataConfig,
  DevicePreset,
  PlatformMetadata,
  ProjectConfig,
  ProjectSummary,
  StorePlatform,
} from "../types";
import { isTauriShell } from "../pickProject";

export interface RecentProjectItem {
  path: string;
  appName?: string;
  openedAt: string;
}

interface Props {
  open: boolean;
  config?: ProjectConfig;
  summary?: ProjectSummary | null;
  presets: DevicePreset[];
  busy: string | null;
  hasCreds: boolean;
  hasOpenAI: boolean;
  recentProjects: RecentProjectItem[];
  onOpenProject: (path: string) => void;
  onBrowseProject: () => void;
  onRemoveRecent: (path: string) => void;
  onSetBaseLocale: (locale: string) => void;
  onSetDevices: (presetIds: string[]) => void;
  onSetMetadata: (input: AppStoreMetadataConfig) => void;
  onSetAscVersion: (versionString?: string) => void;
  onEditCredentials: () => void;
  onEditOpenAI: () => void;
}

const PLATFORMS: { id: StorePlatform; label: string }[] = [
  { id: "ios", label: "iOS / iPadOS" },
  { id: "macos", label: "macOS" },
];

export function ProjectTab({
  open,
  config,
  summary,
  presets,
  busy,
  hasCreds,
  hasOpenAI,
  recentProjects,
  onOpenProject,
  onBrowseProject,
  onRemoveRecent,
  onSetBaseLocale,
  onSetDevices,
  onSetMetadata,
  onSetAscVersion,
  onEditCredentials,
  onEditOpenAI,
}: Props) {
  const [path, setPath] = useState(config?.projectPath ?? "");
  const [ascVersionDraft, setAscVersionDraft] = useState(
    config?.asc?.versionString ?? "",
  );
  const canBrowse = isTauriShell();

  useEffect(() => {
    setAscVersionDraft(config?.asc?.versionString ?? "");
  }, [config?.asc?.versionString]);

  useEffect(() => {
    if (config?.projectPath) setPath(config.projectPath);
  }, [config?.projectPath]);

  const pathField = (
    <>
      <div className="field">
        <label>Project path (.xcodeproj or folder)</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/MyApp.xcodeproj"
            style={{ flex: 1 }}
          />
          {canBrowse && (
            <button
              className="ghost"
              type="button"
              disabled={!!busy}
              onClick={onBrowseProject}
            >
              Browse…
            </button>
          )}
        </div>
      </div>
      <button
        className="primary"
        onClick={() => onOpenProject(path.trim())}
        disabled={!path.trim() || !!busy}
      >
        {open ? "Switch project" : "Open project"}
      </button>
    </>
  );

  const recentList =
    recentProjects.length > 0 ? (
      <div className="recent-projects">
        <div className="section-title">Recent</div>
        <ul className="recent-projects-list">
          {recentProjects.map((r) => (
            <li key={r.path} className="recent-projects-item">
              <button
                type="button"
                className="recent-projects-open"
                disabled={!!busy || r.path === config?.projectPath}
                onClick={() => onOpenProject(r.path)}
              >
                <span className="recent-projects-name">
                  {r.appName || folderName(r.path)}
                </span>
                <span className="recent-projects-path mono">{r.path}</span>
              </button>
              <button
                type="button"
                className="mini ghost recent-projects-remove"
                title="Remove from recent"
                disabled={!!busy}
                onClick={() => onRemoveRecent(r.path)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  if (!open || !config) {
    return (
      <div className="tab-content">
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            Open an Xcode project
          </div>
          <p className="hint">
            Point at the app folder or <span className="mono">.xcodeproj</span>.
            Studio state lives in <span className="mono">.lss/</span> beside it.
          </p>
          {pathField}
          {recentList}
        </div>
      </div>
    );
  }

  const locales = summary?.locales ?? [config.baseLocale];
  const metadata = config.metadata ?? {};
  const keys = summary?.keys ?? [];
  const selectedDevices = config.presetIds ?? [];

  const toggleDevice = (id: string) => {
    const next = selectedDevices.includes(id)
      ? selectedDevices.filter((d) => d !== id)
      : [...selectedDevices, id];
    if (!next.length) return; // keep at least one device targeted
    onSetDevices(next);
  };

  const updateField = (
    platform: StorePlatform,
    field: keyof PlatformMetadata,
    value: string,
  ) => {
    const cur = metadata[platform] ?? {};
    onSetMetadata({ [platform]: { ...cur, [field]: value || undefined } });
  };

  return (
    <div className="tab-content project-tab">
      <div className="project-grid">
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            Linked project
          </div>
          <div className="kv">
            <span>App</span>
            <b>{summary?.appName ?? "—"}</b>
          </div>
          <div className="kv">
            <span>Bundle ID</span>
            <b>{summary?.bundleId ?? "—"}</b>
          </div>
          <div className="kv">
            <span>Path</span>
            <b className="mono" style={{ fontSize: 11 }}>
              {config.projectPath}
            </b>
          </div>
          <div className="kv">
            <span>Strings</span>
            <b>{summary?.stringCount ?? 0}</b>
          </div>
          <div className="kv">
            <span>Release notes</span>
            <b>{summary?.releaseNoteLocales.length ?? 0} locales</b>
          </div>
          <div style={{ marginTop: 12 }}>{pathField}</div>
          {recentList}
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            Source of truth
          </div>
          <p className="hint">
            The default language all other locales are compared against. Usually
            US English.
          </p>
          <div className="field">
            <label>Default language</label>
            <select
              value={config.baseLocale}
              onChange={(e) => onSetBaseLocale(e.target.value)}
            >
              {locales.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="section-title">Locales ({locales.length})</div>
          <div className="chips">
            {locales.map((l) => (
              <span
                key={l}
                className={`chip ${l === config.baseLocale ? "primary" : ""}`}
              >
                {l}
                {l === config.baseLocale ? " ★" : ""}
              </span>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            Devices
          </div>
          <p className="hint">
            The device sizes this project ships screenshots for. New screens and
            the generation matrix follow this selection.
          </p>
          <div className="device-toggle-list">
            {presets.map((p) => {
              const on = selectedDevices.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={`device-toggle${on ? " on" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!!busy}
                    onChange={() => toggleDevice(p.id)}
                  />
                  <span className="grow">{p.label}</span>
                  <span className="hint">
                    {p.pixelWidth}×{p.pixelHeight} · {p.orientation}
                  </span>
                </label>
              );
            })}
            {!presets.length && <p className="hint">No presets available.</p>}
          </div>
        </div>

        <div className="card project-meta">
          <div className="section-title" style={{ marginTop: 0 }}>
            App Store metadata mapping
          </div>
          <p className="hint">
            Pick which localized strings power the App Store <b>description</b>{" "}
            and <b>what&apos;s new</b> text, per platform. Values are resolved
            per locale (falling back to the source language). What&apos;s new
            falls back to any release notes found in the project.
          </p>
          <div className="meta-map">
            {PLATFORMS.map((p) => {
              const m = metadata[p.id] ?? {};
              return (
                <div className="meta-platform" key={p.id}>
                  <div className="meta-platform-title">{p.label}</div>
                  <label className="meta-field">
                    <span>Description</span>
                    <KeySelect
                      value={m.descriptionKey}
                      keys={keys}
                      onChange={(v) => updateField(p.id, "descriptionKey", v)}
                    />
                  </label>
                  <label className="meta-field">
                    <span>What&apos;s new</span>
                    <KeySelect
                      value={m.whatsNewKey}
                      keys={keys}
                      onChange={(v) => updateField(p.id, "whatsNewKey", v)}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            OpenAI
          </div>
          <div className="kv">
            <span>API key</span>
            <b style={{ color: hasOpenAI ? "var(--good)" : "var(--warn)" }}>
              {hasOpenAI ? "configured" : "not set"}
            </b>
          </div>
          <p className="hint">
            Required for AI localization on the Strings tab. Stored under{" "}
            <span className="mono">~/.lss</span>, not in the Xcode project.
          </p>
          <button
            className="ghost"
            style={{ width: "100%", marginTop: 8 }}
            onClick={onEditOpenAI}
          >
            {hasOpenAI ? "Update API key" : "Add API key"}
          </button>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            App Store Connect
          </div>
          <div className="kv">
            <span>Credentials</span>
            <b style={{ color: hasCreds ? "var(--good)" : "var(--warn)" }}>
              {hasCreds ? "configured" : "not set"}
            </b>
          </div>
          {config.asc?.appId && (
            <div className="kv">
              <span>App ID</span>
              <b>{config.asc.appId}</b>
            </div>
          )}
          <div className="field" style={{ marginTop: 10 }}>
            <label>ASC target version</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                value={ascVersionDraft}
                onChange={(e) => setAscVersionDraft(e.target.value)}
                placeholder="e.g. 3.0.7 (blank = auto)"
                style={{ flex: 1 }}
              />
              <button
                className="ghost"
                disabled={!!busy}
                onClick={() =>
                  onSetAscVersion(ascVersionDraft.trim() || undefined)
                }
              >
                Save
              </button>
            </div>
            <p className="hint" style={{ margin: "6px 0 0" }}>
              Marketing version in App Store Connect that uploads attach to.
              Leave blank to use the latest editable version. Changing this does
              not touch credentials.
            </p>
          </div>
          <button
            className="ghost"
            style={{ width: "100%", marginTop: 8 }}
            onClick={onEditCredentials}
          >
            {hasCreds ? "Update credentials" : "Add credentials"}
          </button>
        </div>
      </div>
    </div>
  );
}

function folderName(p: string): string {
  const parts = p.replace(/\/+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function KeySelect({
  value,
  keys,
  onChange,
}: {
  value?: string;
  keys: { key: string; base: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">— none —</option>
      {keys.map((k) => (
        <option key={k.key} value={k.key}>
          {k.key}
          {k.base ? ` — ${truncate(k.base)}` : ""}
        </option>
      ))}
    </select>
  );
}

function truncate(s: string, max = 40): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
