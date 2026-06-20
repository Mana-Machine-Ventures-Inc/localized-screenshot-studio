import { useState } from "react";
import type { ProjectConfig, ProjectSummary } from "../types";

interface Props {
  open: boolean;
  config?: ProjectConfig;
  summary?: ProjectSummary | null;
  busy: string | null;
  hasCreds: boolean;
  onOpenProject: (path: string) => void;
  onSetBaseLocale: (locale: string) => void;
  onEditCredentials: () => void;
}

export function ProjectTab({
  open,
  config,
  summary,
  busy,
  hasCreds,
  onOpenProject,
  onSetBaseLocale,
  onEditCredentials,
}: Props) {
  const [path, setPath] = useState(config?.projectPath ?? "");

  if (!open || !config) {
    return (
      <div className="tab-content">
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            Open an Xcode project
          </div>
          <div className="field">
            <label>Project path (.xcodeproj or folder)</label>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/MyApp.xcodeproj"
            />
          </div>
          <button
            className="primary"
            onClick={() => onOpenProject(path.trim())}
            disabled={!path.trim() || !!busy}
          >
            Open project
          </button>
        </div>
      </div>
    );
  }

  const locales = summary?.locales ?? [config.baseLocale];

  return (
    <div className="tab-content cols">
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
        <div className="field" style={{ marginTop: 12 }}>
          <label>Open a different project</label>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/AnotherApp.xcodeproj"
          />
        </div>
        <button
          className="ghost"
          onClick={() => onOpenProject(path.trim())}
          disabled={!path.trim() || !!busy}
        >
          Switch project
        </button>
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
        {config.asc?.versionString && (
          <div className="kv">
            <span>Version</span>
            <b>{config.asc.versionString}</b>
          </div>
        )}
        <button
          className="ghost"
          style={{ width: "100%", marginTop: 8 }}
          onClick={onEditCredentials}
        >
          {hasCreds ? "Update credentials" : "Add credentials"}
        </button>
      </div>
    </div>
  );
}
