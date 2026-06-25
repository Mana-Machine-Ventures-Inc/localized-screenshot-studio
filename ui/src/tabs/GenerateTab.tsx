import { useEffect, useRef, useState } from "react";
import { api, imageUrl, type CellSelector } from "../api";
import type {
  AssetCell,
  DevicePreset,
  ProjectConfig,
  ProjectSummary,
  ScreenTemplate,
} from "../types";

interface Props {
  config: ProjectConfig;
  summary: ProjectSummary;
  presets: DevicePreset[];
  reload: () => Promise<void>;
}

const THUMB_H = 232;

interface WorkItem {
  screenId: string;
  locale: string;
  pid: string;
}

interface ActiveJob {
  /** "all" | screenId | `cell:${cellId}` */
  scope: string;
  total: number;
  done: number;
  stopping?: boolean;
  error?: string;
}

export function GenerateTab({ config, summary, presets, reload }: Props) {
  const locales = summary.locales;
  const screens = config.screens;
  const presetOf = (id: string) => presets.find((p) => p.id === id);

  const [active, setActive] = useState<ActiveJob | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    sel: CellSelector;
    count: number;
    label: string;
  } | null>(null);
  const cancelRef = useRef(false);
  const aliveRef = useRef(true);

  // Close the lightbox / confirm dialog on Escape.
  useEffect(() => {
    if (!lightbox && !pendingDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightbox(null);
        setPendingDelete(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, pendingDelete]);

  // Leaving the tab cancels any in-flight generation.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelRef.current = true;
    };
  }, []);

  const presetsForScreen = (s: ScreenTemplate) =>
    s.presetIds.length ? s.presetIds : config.presetIds;

  const workForScreens = (targets: ScreenTemplate[]): WorkItem[] => {
    const work: WorkItem[] = [];
    for (const screen of targets) {
      for (const pid of presetsForScreen(screen)) {
        for (const locale of locales) {
          work.push({ screenId: screen.id, locale, pid });
        }
      }
    }
    return work;
  };

  // Capture + compose each cell one at a time so progress is observable and the
  // run can be cancelled between cells. We only care about the composed result.
  const runCells = async (work: WorkItem[], scope: string) => {
    if (active || !work.length) return;
    cancelRef.current = false;
    setGenError(null);
    setActive({ scope, total: work.length, done: 0 });
    try {
      for (let i = 0; i < work.length; i++) {
        if (cancelRef.current) break;
        const w = work[i];
        const sel = { screenId: w.screenId, locales: [w.locale], presetIds: [w.pid] };
        await api.capture(sel);
        await api.compose(sel);
        if (!aliveRef.current) return;
        setActive((a) => (a ? { ...a, done: i + 1 } : a));
        await reload();
      }
    } catch (e) {
      if (aliveRef.current) {
        // Surface the error but always release `active`, otherwise the toolbar
        // stays stuck and "Delete all"/"Generate all" remain disabled.
        setGenError(String(e instanceof Error ? e.message : e));
        setActive(null);
        await reload();
      }
      return;
    }
    if (aliveRef.current) {
      await reload();
      setActive(null);
    }
  };

  const stop = () => {
    cancelRef.current = true;
    setActive((a) => (a ? { ...a, stopping: true } : a));
  };

  const generateAll = () => void runCells(workForScreens(screens), "all");
  const generateScreen = (screen: ScreenTemplate) =>
    void runCells(workForScreens([screen]), screen.id);
  const regenerateCell = (item: WorkItem) =>
    void runCells([item], `cell:${item.screenId}__${item.locale}__${item.pid}`);

  // --- delete generated artifacts ----------------------------------------
  const isGenerated = (c: AssetCell) =>
    Boolean(c.composedPath || c.capturePath);
  const countAll = config.cells.filter(isGenerated).length;
  const countScreen = (sid: string) =>
    config.cells.filter((c) => c.screenId === sid && isGenerated(c)).length;
  const countDevice = (sid: string, pid: string) =>
    config.cells.filter(
      (c) => c.screenId === sid && c.presetId === pid && isGenerated(c),
    ).length;

  // Open an in-app confirmation. We can't use window.confirm(): it's a no-op in
  // the Tauri (WKWebView) window, which silently skipped every delete.
  const clear = (sel: CellSelector, count: number, label: string) => {
    if (!count || active) return;
    setPendingDelete({ sel, count, label });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { sel } = pendingDelete;
    setPendingDelete(null);
    await api.clearCells(sel);
    await reload();
  };

  // Single-cell delete: nuke immediately (no confirm) so one click clears it
  // and the tile flips back to a regenerate button.
  const clearCell = async (item: WorkItem) => {
    if (active) return;
    await api.clearCells({
      screenId: item.screenId,
      locales: [item.locale],
      presetIds: [item.pid],
    });
    await reload();
  };

  const deleteAll = () =>
    void clear({}, countAll, "all screens");
  const deleteScreen = (screen: ScreenTemplate) =>
    void clear({ screenId: screen.id }, countScreen(screen.id), screen.name);
  const deleteDevice = (screen: ScreenTemplate, pid: string) =>
    void clear(
      { screenId: screen.id, presetIds: [pid] },
      countDevice(screen.id, pid),
      `${screen.name} · ${presetOf(pid)?.label ?? pid}`,
    );

  const renderProgress = (job: ActiveJob) => {
    const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
    return (
      <div className="gen-progress">
        <div className="progress">
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="hint">
          {job.stopping ? "stopping… " : ""}
          {job.done}/{job.total}
        </span>
        {job.error ? (
          <span className="error-text">{job.error}</span>
        ) : (
          <button className="mini danger" onClick={stop} disabled={job.stopping}>
            Stop
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="tab-content generate-tab">
      <div className="toolbar">
        <div className="section-title" style={{ margin: 0 }}>
          Composed screens
        </div>
        <div className="spacer" />
        {active?.scope === "all" ? (
          renderProgress(active)
        ) : (
          <>
            <button
              className="ghost danger"
              disabled={!!active || !countAll}
              onClick={deleteAll}
            >
              Delete all
            </button>
            <button
              className="primary"
              disabled={!!active || !screens.length}
              onClick={generateAll}
            >
              Generate all
            </button>
          </>
        )}
      </div>

      {genError && (
        <div className="gen-error-banner">
          <span className="error-text">Generation failed: {genError}</span>
          <button className="mini" onClick={() => setGenError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {!screens.length ? (
        <div className="empty-state">
          <p>No screens yet. Add one in the Screens tab.</p>
        </div>
      ) : (
        <div className="gen-grid">
          {screens.map((screen) => {
            const screenPresets = presetsForScreen(screen);
            const screenActive = active?.scope === screen.id;
            return (
              <div key={screen.id} className="gen-screen">
                <div className="gen-screen-head">
                  <b>{screen.name}</b>
                  <span className="hint">
                    {screen.composition?.mode === "passthrough"
                      ? "pass-through"
                      : "device frame"}
                  </span>
                  <div className="spacer" />
                  {screenActive ? (
                    renderProgress(active)
                  ) : (
                    <>
                      <button
                        className="mini danger"
                        disabled={!!active || !countScreen(screen.id)}
                        onClick={() => deleteScreen(screen)}
                      >
                        Delete
                      </button>
                      <button
                        className="ghost mini"
                        disabled={!!active}
                        onClick={() => generateScreen(screen)}
                      >
                        Generate
                      </button>
                    </>
                  )}
                </div>
                {screenPresets.map((pid) => {
                  const p = presetOf(pid);
                  const aspect = p ? p.pixelWidth / p.pixelHeight : 0.46;
                  const thumbW = Math.round(THUMB_H * aspect);
                  return (
                    <div key={pid} className="gen-preset">
                      <div className="gen-device-label">
                        <span className="hint">
                          {p?.label ?? pid}
                          {p ? ` · ${p.pixelWidth}×${p.pixelHeight}` : ""}
                        </span>
                        <button
                          className="mini danger"
                          disabled={!!active || !countDevice(screen.id, pid)}
                          title="Delete generated images for this device"
                          onClick={() => deleteDevice(screen, pid)}
                        >
                          Delete
                        </button>
                      </div>
                      <div className="gen-row">
                        {locales.map((locale) => {
                          const id = `${screen.id}__${locale}__${pid}`;
                          const cell = config.cells.find((c) => c.id === id);
                          const src = cell?.composedPath
                            ? imageUrl(cell.composedPath)
                            : cell?.capturePath
                              ? imageUrl(cell.capturePath)
                              : undefined;
                          const cellBusy = active?.scope === `cell:${id}`;
                          return (
                            <div
                              className="gen-cell"
                              key={id}
                              style={{ width: thumbW }}
                              title={`${screen.name} · ${locale}`}
                            >
                              <div
                                className={`gen-thumb ${src ? "clickable" : ""}`}
                                style={{ width: thumbW, height: THUMB_H }}
                                onClick={() => src && setLightbox(src)}
                                title={src ? "Click to view full size" : undefined}
                              >
                                {src ? (
                                  <img src={src} alt={`${screen.name} ${locale}`} />
                                ) : (
                                  <div className="gen-empty">not generated</div>
                                )}
                              </div>
                              <div className="gen-cell-foot">
                                <span className="locale-tag">{locale}</span>
                                <span
                                  className={`slot-badge ${cell?.state === "composed" ? "ok" : cell ? "" : "warn"}`}
                                >
                                  {cell?.state ?? "—"}
                                </span>
                                {src ? (
                                  <button
                                    className="mini danger"
                                    disabled={!!active}
                                    title="Delete this screenshot (then regenerate)"
                                    onClick={() =>
                                      void clearCell({ screenId: screen.id, locale, pid })
                                    }
                                  >
                                    🗑
                                  </button>
                                ) : (
                                  <button
                                    className="mini"
                                    disabled={!!active}
                                    title="Generate this screenshot"
                                    onClick={() =>
                                      regenerateCell({ screenId: screen.id, locale, pid })
                                    }
                                  >
                                    {cellBusy ? "…" : "↻"}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <button
            className="lightbox-close"
            onClick={() => setLightbox(null)}
            title="Close"
          >
            ✕
          </button>
          <img
            src={lightbox}
            alt="full size"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {pendingDelete && (
        <div className="confirm-overlay" onClick={() => setPendingDelete(null)}>
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h3>Delete generated images?</h3>
            <p>
              Delete {pendingDelete.count} generated image
              {pendingDelete.count === 1 ? "" : "s"} for{" "}
              <b>{pendingDelete.label}</b>? You can regenerate them at any time.
            </p>
            <div className="confirm-actions">
              <button className="ghost" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button className="danger" onClick={() => void confirmDelete()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
