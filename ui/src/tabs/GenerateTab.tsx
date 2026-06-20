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
  const cancelRef = useRef(false);
  const aliveRef = useRef(true);

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
        setActive((a) =>
          a ? { ...a, error: String(e instanceof Error ? e.message : e) } : a,
        );
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

  const clear = async (sel: CellSelector, count: number, label: string) => {
    if (!count || active) return;
    if (
      !window.confirm(
        `Delete ${count} generated image${count === 1 ? "" : "s"} for ${label}? You can regenerate them at any time.`,
      )
    )
      return;
    await api.clearCells(sel);
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
                                className="gen-thumb"
                                style={{ width: thumbW, height: THUMB_H }}
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
                                <button
                                  className="mini"
                                  disabled={!!active}
                                  title="Regenerate this screenshot"
                                  onClick={() =>
                                    regenerateCell({ screenId: screen.id, locale, pid })
                                  }
                                >
                                  {cellBusy ? "…" : "↻"}
                                </button>
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
    </div>
  );
}
