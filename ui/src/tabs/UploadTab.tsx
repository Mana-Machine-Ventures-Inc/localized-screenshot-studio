import { useState } from "react";
import { api } from "../api";
import { Dashboard } from "../components/Dashboard";
import type {
  AppStoreMetadataConfig,
  DevicePreset,
  PlatformMetadata,
  ProjectConfig,
  ProjectSummary,
  StorePlatform,
  UploadJob,
} from "../types";

interface Props {
  config: ProjectConfig;
  summary: ProjectSummary;
  presets: DevicePreset[];
  hasCreds: boolean;
  busy: string | null;
  job: UploadJob | null;
  onUpload: (opts: Parameters<typeof api.upload>[0], label: string) => void;
  onSetMetadata: (input: AppStoreMetadataConfig) => void;
  onRetryFailed: () => void;
  onCancel: () => void;
  onCloseJob: () => void;
  onEditCredentials: () => void;
}

const PLATFORMS: { id: StorePlatform; label: string }[] = [
  { id: "ios", label: "iOS / iPadOS" },
  { id: "macos", label: "macOS" },
];

export function UploadTab({
  config,
  summary,
  presets,
  hasCreds,
  busy,
  job,
  onUpload,
  onSetMetadata,
  onRetryFailed,
  onCancel,
  onCloseJob,
  onEditCredentials,
}: Props) {
  const hasScreens = config.screens.length > 0;
  const metadata = config.metadata ?? {};
  const keys = summary.keys;
  const running = (!!job && !job.done) || !!busy;
  const dryRun = !hasCreds;

  // Device presets actually used by the project's screens.
  const usedPresetIds = Array.from(
    new Set(
      config.screens.flatMap((s) =>
        s.presetIds.length ? s.presetIds : config.presetIds,
      ),
    ),
  );
  const presetLabel = (id: string) =>
    presets.find((p) => p.id === id)?.label ?? id;

  const [deviceFilter, setDeviceFilter] = useState<string>("all");
  const presetIds = deviceFilter === "all" ? undefined : [deviceFilter];

  const shotCount = (locale: string) =>
    config.cells.filter(
      (c) =>
        c.locale === locale &&
        c.composedPath &&
        (deviceFilter === "all" || c.presetId === deviceFilter),
    ).length;

  const deviceLabel = deviceFilter === "all" ? "all devices" : presetLabel(deviceFilter);

  const replaceLocale = (locale: string) =>
    onUpload(
      { kind: "screenshots", locales: [locale], presetIds, replace: true, dryRun },
      `Replacing ${locale} · ${deviceLabel}`,
    );
  const clearLocale = (locale: string) =>
    onUpload(
      { kind: "screenshots", locales: [locale], presetIds, clearOnly: true, dryRun },
      `Clearing ${locale} · ${deviceLabel}`,
    );

  const updateField = (
    platform: StorePlatform,
    field: keyof PlatformMetadata,
    value: string,
  ) => {
    const cur = metadata[platform] ?? {};
    onSetMetadata({ [platform]: { ...cur, [field]: value || undefined } });
  };

  return (
    <div className="tab-content upload-tab">
      <div className="upload-actions">
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            Release
          </div>
          <div className="kv">
            <span>App</span>
            <b>{summary.appName}</b>
          </div>
          <div className="kv">
            <span>Marketing version</span>
            <b>{summary.marketingVersion ?? "—"}</b>
          </div>
          <div className="kv">
            <span>Build number</span>
            <b>{summary.buildNumber ?? "—"}</b>
          </div>
          <div className="kv">
            <span>ASC target version</span>
            <b>{config.asc?.versionString ?? "auto (editable)"}</b>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Uploads attach to the editable App Store version
            {config.asc?.versionString
              ? ` "${config.asc.versionString}"`
              : " (most recent in a prepare-for-submission state)"}{" "}
            for each platform.
          </p>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            App Store Connect
          </div>
          <div className="kv">
            <span>Credentials</span>
            <b style={{ color: hasCreds ? "var(--good)" : "var(--warn)" }}>
              {hasCreds ? "configured" : "not set — uploads run as dry run"}
            </b>
          </div>
          <button
            className="ghost"
            style={{ width: "100%", marginTop: 8 }}
            onClick={onEditCredentials}
          >
            {hasCreds ? "Update credentials" : "Add credentials"}
          </button>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            Metadata
          </div>
          <div className="col">
            <button
              disabled={running}
              onClick={() =>
                onUpload(
                  { kind: "metadata", dryRun },
                  "Uploading metadata (all languages)",
                )
              }
            >
              Upload metadata · all languages
            </button>
            <p className="hint" style={{ margin: 0 }}>
              Description + what's new for every locale. Mapping is configured
              below.
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            Screenshots by language
          </div>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="hint">Device</span>
            <select
              value={deviceFilter}
              onChange={(e) => setDeviceFilter(e.target.value)}
            >
              <option value="all">All devices</option>
              {usedPresetIds.map((id) => (
                <option key={id} value={id}>
                  {presetLabel(id)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">
          Each upload runs one language at a time and, per device, <b>deletes the
          existing App Store screenshots first</b>, then uploads that language's
          screens in order. Watch it happen in the dashboard below — and cancel
          or retry a single language without touching the rest.
        </p>

        {!hasScreens ? (
          <div className="empty-state">
            <p>No screens yet. Add them in the Screens tab.</p>
          </div>
        ) : (
          <div className="lang-upload-list">
            {summary.locales.map((locale) => {
              const count = shotCount(locale);
              const isBase = locale === summary.baseLocale;
              return (
                <div className="lang-upload-row" key={locale}>
                  <span className="grow">
                    <b>{locale}</b>
                    {isBase && <span className="chip">source</span>}
                  </span>
                  <span className="hint">
                    {count} screen{count === 1 ? "" : "s"}
                  </span>
                  <button
                    className="mini"
                    disabled={running || count === 0}
                    onClick={() => clearLocale(locale)}
                    title="Delete this language's screenshots on App Store Connect"
                  >
                    Clear
                  </button>
                  <button
                    className="mini primary"
                    disabled={running || count === 0}
                    onClick={() => replaceLocale(locale)}
                    title="Delete existing, then upload this language's screenshots"
                  >
                    {dryRun ? "Replace (dry run)" : "Replace"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          Metadata mapping
        </div>
        <p className="hint">
          Pick which localized strings power the App Store{" "}
          <b>description</b> and <b>what's new</b> text, per platform. Values are
          resolved per locale (falling back to the source language). What's new
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
                  <span>What's new</span>
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

      <div className="upload-dashboard">
        {job ? (
          <Dashboard
            job={job}
            onRetryFailed={onRetryFailed}
            onCancel={onCancel}
            onClose={onCloseJob}
          />
        ) : (
          <div className="empty-state">
            <p>Start an upload to track per-locale progress here.</p>
          </div>
        )}
      </div>
    </div>
  );
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
