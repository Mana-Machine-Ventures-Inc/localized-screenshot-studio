import { api } from "../api";
import { Dashboard } from "../components/Dashboard";
import type {
  AppStoreMetadataConfig,
  PlatformMetadata,
  ProjectConfig,
  ProjectSummary,
  StorePlatform,
  UploadJob,
} from "../types";

interface Props {
  config: ProjectConfig;
  summary: ProjectSummary;
  hasCreds: boolean;
  busy: string | null;
  job: UploadJob | null;
  onUpload: (opts: Parameters<typeof api.upload>[0], label: string) => void;
  onSetMetadata: (input: AppStoreMetadataConfig) => void;
  onRetryFailed: () => void;
  onEditCredentials: () => void;
}

const PLATFORMS: { id: StorePlatform; label: string }[] = [
  { id: "ios", label: "iOS / iPadOS" },
  { id: "macos", label: "macOS" },
];

export function UploadTab({
  config,
  summary,
  hasCreds,
  busy,
  job,
  onUpload,
  onSetMetadata,
  onRetryFailed,
  onEditCredentials,
}: Props) {
  const hasScreens = config.screens.length > 0;
  const metadata = config.metadata ?? {};
  const keys = summary.keys;

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
            Push
          </div>
          <div className="col">
            <button
              className="primary"
              disabled={!!busy || !hasScreens}
              onClick={() =>
                onUpload({ kind: "both", dryRun: !hasCreds }, "Uploading")
              }
            >
              {hasCreds
                ? "Upload screenshots + metadata"
                : "Upload everything (dry run)"}
            </button>
            <button
              disabled={!!busy || !hasScreens}
              onClick={() =>
                onUpload(
                  { kind: "screenshots", dryRun: !hasCreds },
                  "Uploading screenshots",
                )
              }
            >
              Screenshots only
            </button>
            <button
              disabled={!!busy}
              onClick={() =>
                onUpload(
                  { kind: "metadata", dryRun: !hasCreds },
                  "Uploading metadata",
                )
              }
            >
              Metadata only
            </button>
          </div>
        </div>
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
          <Dashboard job={job} onRetryFailed={onRetryFailed} onClose={() => {}} />
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
