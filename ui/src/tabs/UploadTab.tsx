import { useEffect, useState } from "react";
import { api } from "../api";
import { getScreenPresetIds } from "../screens/variants";
import { Dashboard } from "../components/Dashboard";
import type {
  DevicePreset,
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
  onRetryFailed: () => void;
  onCancel: () => void;
  onCloseJob: () => void;
  onEditCredentials: () => void;
  onGoToSettings: () => void;
  onSetAscVersion: (versionString?: string) => void;
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
  onRetryFailed,
  onCancel,
  onCloseJob,
  onEditCredentials,
  onGoToSettings,
  onSetAscVersion,
}: Props) {
  const hasScreens = config.screens.length > 0;
  const metadata = config.metadata ?? {};
  const running = (!!job && !job.done) || !!busy;
  const dryRun = !hasCreds;

  const [ascVersionDraft, setAscVersionDraft] = useState(
    config.asc?.versionString ?? "",
  );

  useEffect(() => {
    setAscVersionDraft(config.asc?.versionString ?? "");
  }, [config.asc?.versionString]);

  // Device presets actually used by the project's screens.
  const usedPresetIds = Array.from(
    new Set(
      config.screens.flatMap((s) => getScreenPresetIds(s, config.presetIds)),
    ),
  );
  const presetLabel = (id: string) =>
    presets.find((p) => p.id === id)?.label ?? id;

  const [deviceFilter, setDeviceFilter] = useState<string>("all");
  const presetIds = deviceFilter === "all" ? undefined : [deviceFilter];

  const inFilter = (presetId: string) =>
    deviceFilter === "all" || presetId === deviceFilter;

  const composedCells = (locale: string) =>
    config.cells.filter(
      (c) => c.locale === locale && c.composedPath && inFilter(c.presetId),
    );

  const shotCount = (locale: string) => composedCells(locale).length;

  // --- upload ledger: what's live for the current binary -------------------
  const curVersion = summary.marketingVersion;
  const curBuild = summary.buildNumber;
  const uploads = config.uploads ?? [];
  const isCurrentBinary = (u: { version?: string; build?: string }) =>
    u.version === curVersion && u.build === curBuild;

  /** Per-locale upload status under the active device filter. */
  const localeStatus = (locale: string) => {
    const cells = composedCells(locale);
    const ids = new Set(cells.map((c) => c.id));
    const recs = uploads.filter((u) => ids.has(u.cellId));
    const current = recs.filter(isCurrentBinary);
    return {
      total: cells.length,
      uploaded: current.length,
      // Uploaded before, but only against a different (older) build.
      staleBuild: recs.length > 0 && current.length === 0,
    };
  };

  // Overall "uploaded for this build" tally across every locale + device.
  const allComposed = config.cells.filter((c) => c.composedPath);
  const allComposedIds = new Set(allComposed.map((c) => c.id));
  const uploadedThisBuild = uploads.filter(
    (u) => isCurrentBinary(u) && allComposedIds.has(u.cellId),
  ).length;

  const deviceLabel = deviceFilter === "all" ? "all devices" : presetLabel(deviceFilter);

  const replaceAll = () =>
    onUpload(
      { kind: "screenshots", presetIds, replace: true, dryRun },
      `Replacing all languages · ${deviceLabel}`,
    );

  const hasMetaMapping = PLATFORMS.some((p) => {
    const mm = metadata[p.id];
    return Boolean(mm?.descriptionKey || mm?.whatsNewKey);
  });

  const replaceMetaLocale = (locale: string) =>
    onUpload(
      { kind: "metadata", locales: [locale], dryRun },
      `Metadata · ${locale}`,
    );

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

  // Live readout for the running job (so a Replace shows what's happening).
  const items = job?.items ?? [];
  const totalItems = items.length;
  const doneItems = items.filter(
    (i) => i.state === "verified" || i.state === "failed",
  ).length;
  const failedItems = items.filter((i) => i.state === "failed").length;
  const activeItem = items.find((i) => i.state === "uploading");
  const activeLocale = !job?.done ? activeItem?.locale : undefined;
  const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  const stepText = (): string => {
    if (!job) return "";
    if (job.error) return `Failed: ${job.error}`;
    if (job.done)
      return job.cancelled
        ? "Cancelled"
        : failedItems
          ? `Finished — ${failedItems} failed`
          : "Finished";
    if (activeItem) {
      const dev = activeItem.presetId
        ? presetLabel(activeItem.presetId)
        : activeItem.platform ?? "";
      if (activeItem.kind === "clear")
        return `Deleting existing ${dev} screenshots · ${activeItem.locale}`;
      if (activeItem.kind === "metadata")
        return `Uploading metadata · ${activeItem.locale}`;
      return `Uploading ${activeItem.locale} · ${dev}`;
    }
    return "Starting…";
  };

  return (
    <div className="tab-content upload-tab">
      {job && (
        <div className="upload-status">
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <span className={`status-dot ${job.done ? (job.error || failedItems ? "bad" : "good") : "live"}`} />
            <b className="grow">{stepText()}</b>
            <span className="hint">
              {doneItems}/{totalItems}
            </span>
            {!job.done ? (
              <button
                className="mini danger"
                onClick={onCancel}
                disabled={job.cancelled}
              >
                {job.cancelled ? "Cancelling…" : "Cancel"}
              </button>
            ) : (
              <button className="mini ghost" onClick={onCloseJob}>
                Dismiss
              </button>
            )}
          </div>
          <div className="progress" style={{ marginTop: 8 }}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

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
          <div className="field" style={{ marginTop: 10 }}>
            <label>ASC target version</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                value={ascVersionDraft}
                onChange={(e) => setAscVersionDraft(e.target.value)}
                placeholder="e.g. 3.0.7 (blank = auto)"
                style={{ flex: 1 }}
                disabled={running}
              />
              <button
                className="ghost"
                disabled={running || !!busy}
                onClick={() =>
                  onSetAscVersion(ascVersionDraft.trim() || undefined)
                }
              >
                Save
              </button>
            </div>
          </div>
          <div className="kv">
            <span>Uploaded for this build</span>
            <b
              style={{
                color:
                  allComposed.length > 0 &&
                  uploadedThisBuild >= allComposed.length
                    ? "var(--good)"
                    : "var(--text)",
              }}
            >
              {uploadedThisBuild}/{allComposed.length} screens
            </b>
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
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
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
            <button
              className="primary"
              disabled={running || !hasScreens}
              onClick={replaceAll}
              title="Delete then re-upload every language's screenshots (one at a time)"
            >
              {dryRun ? "Upload all (dry run)" : "Upload all languages"}
            </button>
          </div>
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
              const isActive = activeLocale === locale;
              const st = localeStatus(locale);
              return (
                <div
                  className={`lang-upload-row${isActive ? " active" : ""}`}
                  key={locale}
                >
                  <span className="grow">
                    <b>{locale}</b>
                    {isBase && <span className="chip">source</span>}
                    {!isActive && count > 0 && (
                      st.uploaded >= count ? (
                        <span className="chip ok" title={`Live for build ${curBuild ?? "?"}`}>
                          ✓ uploaded
                        </span>
                      ) : st.uploaded > 0 ? (
                        <span className="chip warn">
                          {st.uploaded}/{count} uploaded
                        </span>
                      ) : st.staleBuild ? (
                        <span className="chip warn" title="Uploaded for a previous build">
                          previous build
                        </span>
                      ) : null
                    )}
                  </span>
                  {isActive ? (
                    <span className="hint uploading-text">{stepText()}</span>
                  ) : (
                    <span className="hint">
                      {count} screen{count === 1 ? "" : "s"}
                    </span>
                  )}
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
          Metadata by language
        </div>
        <p className="hint">
          Upload description + What's New for a single language and watch the
          full request/response in the dashboard below. Use this to debug a
          value that "won't take". The string mapping lives in{" "}
          <button className="linklike" onClick={onGoToSettings}>
            Project → metadata mapping
          </button>
          .
        </p>
        {!hasMetaMapping ? (
          <div className="empty-state">
            <p>
              Map a Description or What's New string in the Project tab first.
            </p>
          </div>
        ) : (
          <div className="lang-upload-list">
            {summary.locales.map((locale) => {
              const isBase = locale === summary.baseLocale;
              const isActive = activeLocale === locale;
              return (
                <div
                  className={`lang-upload-row${isActive ? " active" : ""}`}
                  key={locale}
                >
                  <span className="grow">
                    <b>{locale}</b>
                    {isBase && <span className="chip">source</span>}
                  </span>
                  {isActive && (
                    <span className="hint uploading-text">{stepText()}</span>
                  )}
                  <button
                    className="mini primary"
                    disabled={running}
                    onClick={() => replaceMetaLocale(locale)}
                    title="Upload description + What's New for just this language"
                  >
                    {dryRun ? "Upload meta (dry run)" : "Upload metadata"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
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
