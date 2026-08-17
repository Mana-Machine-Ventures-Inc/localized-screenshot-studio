import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { DevicePreset, ProjectConfig, ProjectSummary } from "../types";
import {
  OverlayEditor,
  type OverlayEditorHandle,
} from "../components/OverlayEditor";
import { CompositionPanel } from "../components/CompositionPanel";
import { OverlayUploadModal } from "../components/OverlayUploadModal";
import { IngestFolderModal } from "../components/IngestFolderModal";
import {
  getOverlay,
  getScreenPresetIds,
  primaryPresetId,
} from "../screens/variants";
import { isTextEditingTarget, useCommandHistory } from "../history";
import { frameColorPalette } from "../projectColors";

export interface ScreensJump {
  screenId: string;
  locale: string;
  presetId: string;
}

interface Props {
  config: ProjectConfig;
  summary: ProjectSummary;
  presets: DevicePreset[];
  reload: () => Promise<void>;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  previewLocale: string;
  onPreviewLocale: (locale: string) => void;
  /** One-shot: open this device variant in Frame mode (from Generate → Edit). */
  jumpTo?: ScreensJump | null;
  onJumpApplied?: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ScreensTab({
  config,
  summary,
  presets,
  reload,
  selectedId,
  onSelect,
  previewLocale,
  onPreviewLocale,
  jumpTo,
  onJumpApplied,
}: Props) {
  const overlayScreens = useMemo(
    () => config.screens.filter((s) => s.kind === "overlay"),
    [config.screens],
  );
  const overlayIdsKey = useMemo(
    () => overlayScreens.map((s) => s.id).join("\0"),
    [overlayScreens],
  );
  const palette = useMemo(() => frameColorPalette(config), [config]);
  const [showUpload, setShowUpload] = useState(false);
  const [showIngest, setShowIngest] = useState(false);
  const [ingestReport, setIngestReport] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armDelete, setArmDelete] = useState(false);
  const [armRemoveVariant, setArmRemoveVariant] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  /** Local order while dragging (and between reloads). */
  const [orderIds, setOrderIds] = useState<string[]>(() =>
    overlayScreens.map((s) => s.id),
  );
  const renameInputRef = useRef<HTMLInputElement>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapInput = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<OverlayEditorHandle>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [editMode, setEditMode] = useState<"overlay" | "frame">(() => {
    try {
      const v = localStorage.getItem("lss.screensEditMode");
      return v === "frame" ? "frame" : "overlay";
    } catch {
      return "overlay";
    }
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [onion, setOnion] = useState(false);
  const history = useCommandHistory();
  const dragMoved = useRef(false);
  const orderIdsRef = useRef(orderIds);
  orderIdsRef.current = orderIds;
  const dragRef = useRef<{
    id: string;
    startY: number;
    originIds: string[];
  } | null>(null);

  // Keep local order in sync with the project, preserving relative order when
  // screens are added/removed. Skip while dragging so we don't fight the live order.
  useEffect(() => {
    if (dragRef.current) return;
    const ids = overlayIdsKey ? overlayIdsKey.split("\0") : [];
    setOrderIds((prev) => {
      if (
        prev.length === ids.length &&
        prev.every((id, i) => id === ids[i])
      ) {
        return prev;
      }
      const idSet = new Set(ids);
      const kept = prev.filter((id) => idSet.has(id));
      if (kept.length === ids.length && kept.length === prev.length) {
        // Same screens, different order — adopt server/config order.
        return ids;
      }
      const keptSet = new Set(kept);
      const added = ids.filter((id) => !keptSet.has(id));
      return [...kept, ...added];
    });
  }, [overlayIdsKey]);

  const screensById = useMemo(() => {
    const m = new Map<string, (typeof overlayScreens)[number]>();
    for (const s of overlayScreens) m.set(s.id, s);
    return m;
  }, [overlayScreens]);

  const orderedScreens = useMemo(
    () =>
      orderIds
        .map((id) => screensById.get(id))
        .filter((s): s is (typeof overlayScreens)[number] => Boolean(s)),
    [orderIds, screensById],
  );

  const selected =
    config.screens.find((s) => s.id === selectedId && s.kind === "overlay") ??
    overlayScreens[0];

  const variantIds = selected
    ? getScreenPresetIds(selected, config.presetIds)
    : [];

  const [variantPresetId, setVariantPresetId] = useState(
    selected ? primaryPresetId(selected) : config.presetIds[0] ?? "iphone-6-9",
  );

  useEffect(() => {
    if (!selected) return;
    const ids = getScreenPresetIds(selected, config.presetIds);
    if (!ids.includes(variantPresetId)) {
      setVariantPresetId(ids[0] ?? primaryPresetId(selected));
    }
  }, [selected?.id, config.presetIds, variantPresetId, selected]);

  useEffect(() => {
    if (!jumpTo) return;
    const ids = selected
      ? getScreenPresetIds(selected, config.presetIds)
      : [];
    if (jumpTo.presetId && ids.includes(jumpTo.presetId)) {
      setVariantPresetId(jumpTo.presetId);
    }
    setEditMode("frame");
    onJumpApplied?.();
  }, [jumpTo]);

  // Cancel inline rename / overflow when switching screens.
  useEffect(() => {
    setRenaming(false);
    setMoreOpen(false);
    setArmDelete(false);
    setArmRemoveVariant(false);
    setOnion(false);
    history.clear();
  }, [selected?.id, variantPresetId]);

  useEffect(() => {
    try {
      localStorage.setItem("lss.screensEditMode", editMode);
    } catch {
      /* ignore */
    }
  }, [editMode]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isTextEditingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        history.redo();
        return;
      }
      if (key === "z") {
        e.preventDefault();
        history.undo();
        return;
      }
      if (key === "y") {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history]);

  const availableToAdd = useMemo(() => {
    if (!selected) return presets;
    const have = new Set(getScreenPresetIds(selected, config.presetIds));
    // Offer every known preset (including Mac) so a screen can target devices
    // the project hasn't opted into yet — creating/adding enables them.
    return presets.filter((p) => !have.has(p.id));
  }, [selected, presets, config.presetIds]);

  const presetLabel = (id: string) =>
    presets.find((p) => p.id === id)?.label ?? id;

  const reorderScreens = async (nextIds: string[]) => {
    const same =
      nextIds.length === overlayScreens.length &&
      nextIds.every((id, i) => id === overlayScreens[i]?.id);
    if (same) return;
    setBusy("Reordering");
    try {
      await api.reorderScreens(nextIds);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  /** Move `fromId` so its index matches where `clientY` falls in the list. */
  const reorderByClientY = (
    ids: string[],
    fromId: string,
    clientY: number,
    itemEls: HTMLElement[],
  ) => {
    const from = ids.indexOf(fromId);
    if (from < 0 || itemEls.length === 0) return ids;

    // Insert before the first row whose midpoint is below the pointer;
    // if below every midpoint, append at the end.
    let insertAt = itemEls.length;
    for (let i = 0; i < itemEls.length; i++) {
      const r = itemEls[i]!.getBoundingClientRect();
      if (clientY < (r.top + r.bottom) / 2) {
        insertAt = i;
        break;
      }
    }

    const next = [...ids];
    next.splice(from, 1);
    if (from < insertAt) insertAt -= 1;
    next.splice(insertAt, 0, fromId);
    return next;
  };

  const onScreenPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (busy || e.button !== 0) return;
    dragMoved.current = false;
    dragRef.current = {
      id,
      startY: e.clientY,
      originIds: orderIds,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onScreenPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(e.clientY - drag.startY) < 5) return;
    dragMoved.current = true;
    setDragId(drag.id);

    const list = e.currentTarget.closest(".screens-sidebar-list");
    if (!list) return;
    const items = [
      ...list.querySelectorAll<HTMLElement>("[data-screen-id]"),
    ];

    setOrderIds((prev) => {
      const next = reorderByClientY(prev, drag.id, e.clientY, items);
      return next.join() === prev.join() ? prev : next;
    });
  };

  const onScreenPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (!drag || !dragMoved.current) return;
    // Persist the live-reordered list.
    void reorderScreens(orderIdsRef.current);
  };

  const armDeleteOnce = () => {
    setArmDelete(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmDelete(false), 4000);
  };

  const create = async (input: {
    name: string;
    sourceLocale: string;
    imageDataUrl: string;
    presetId?: string;
    detectText?: boolean;
  }) => {
    setBusy(input.detectText ? "Analyzing screenshot" : "Uploading screenshot");
    try {
      const res = await api.createOverlay(input);
      setShowUpload(false);
      await reload();
      onSelect(res.screen.id);
      setVariantPresetId(primaryPresetId(res.screen));
    } finally {
      setBusy(null);
    }
  };

  const ingestFolder = async (input: {
    dir: string;
    sourceLocale: string;
    detectText: boolean;
    keyPrefix: string;
  }) => {
    setBusy("Importing folder");
    setIngestReport(null);
    try {
      const res = await api.ingestScreens(input);
      setShowIngest(false);
      await reload();
      const first = res.created[0];
      if (first) {
        onSelect(first.screen.id);
        setVariantPresetId(primaryPresetId(first.screen));
      }
      const unmatched = res.created.filter((c) => c.headlineKey && !c.headlineMatched)
        .length;
      const merged = res.created.filter((c) => c.mergedVariant).length;
      const screens = res.created.length - merged;
      const parts = [
        `${screens} screen${screens === 1 ? "" : "s"}`,
        merged ? `+${merged} iPad/device variant${merged === 1 ? "" : "s"}` : null,
        res.failed.length ? `${res.failed.length} failed` : null,
        unmatched ? `${unmatched} keys not in catalog yet` : null,
      ].filter(Boolean);
      setIngestReport(parts.join(" · "));
    } catch (err) {
      setIngestReport(String((err as Error)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  const swap = async (file?: File) => {
    if (!file || !selected) return;
    setBusy("Swapping image");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await api.replaceSource(selected.id, dataUrl, variantPresetId);
      await reload();
    } finally {
      setBusy(null);
      if (swapInput.current) swapInput.current.value = "";
    }
  };

  const startRename = () => {
    if (!selected) return;
    setRenameDraft(selected.name);
    setRenaming(true);
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameDraft("");
  };

  const commitRename = async () => {
    if (!selected) return;
    const name = renameDraft.trim();
    if (!name || name === selected.name) {
      cancelRename();
      return;
    }
    setBusy("Renaming");
    try {
      await api.updateOverlay(selected.id, { name });
      setRenaming(false);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setBusy("Deleting");
    try {
      await api.deleteScreen(selected.id);
      onSelect(undefined);
      await reload();
    } finally {
      setBusy(null);
      setArmDelete(false);
    }
  };

  const addVariant = async (presetId: string) => {
    if (!selected || !presetId) return;
    setBusy("Adding device");
    try {
      await api.addScreenVariant(selected.id, { presetId });
      setVariantPresetId(presetId);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const removeVariant = async () => {
    if (!selected || variantIds.length <= 1) return;
    setBusy("Removing device");
    try {
      await api.removeScreenVariant(selected.id, variantPresetId);
      const remaining = variantIds.filter((id) => id !== variantPresetId);
      setVariantPresetId(remaining[0] ?? config.presetIds[0]);
      await reload();
    } finally {
      setBusy(null);
      setArmRemoveVariant(false);
    }
  };

  const variantHasOverlay = selected
    ? Boolean(getOverlay(selected, variantPresetId))
    : false;

  const shortPresetLabel = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return id;
    if (p.id === "ipad-13-landscape") return 'iPad 13" LS';
    if (p.id === "ipad-13") return 'iPad 13"';
    if (p.id === "mac") return "Mac";
    return p.label;
  };

  const screenDeviceTitle = (screenId: string) => {
    const s = overlayScreens.find((x) => x.id === screenId);
    if (!s) return "No devices";
    const ids = getScreenPresetIds(s, config.presetIds);
    if (!ids.length) return "No devices";
    return ids.map(shortPresetLabel).join(" + ");
  };

  return (
    <div className="tab-content screens-tab unified-screens">
      <aside className="screens-sidebar">
        <div className="screens-sidebar-head">
          Screens
          {overlayScreens.length > 1 && (
            <span className="screens-sidebar-head-hint">Drag to set upload order</span>
          )}
        </div>
        <div className={`screens-sidebar-list${dragId ? " is-reordering" : ""}`}>
          {orderedScreens.map((s) => {
            const active = s.id === selected?.id;
            const ids = getScreenPresetIds(s, config.presetIds);
            const incomplete = ids.some((id) => !getOverlay(s, id));
            const dragging = dragId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                data-screen-id={s.id}
                disabled={!!busy && !dragId}
                className={`screens-sidebar-item${active ? " active" : ""}${dragging ? " dragging" : ""}`}
                onClick={() => {
                  if (dragMoved.current) {
                    dragMoved.current = false;
                    return;
                  }
                  onSelect(s.id);
                }}
                onPointerDown={(e) => onScreenPointerDown(e, s.id)}
                onPointerMove={onScreenPointerMove}
                onPointerUp={onScreenPointerUp}
                onPointerCancel={onScreenPointerUp}
              >
                <span className={`screens-sidebar-name${incomplete ? " warn" : ""}`}>
                  {screenDeviceTitle(s.id)}
                </span>
                <span className="screens-sidebar-meta">{s.name}</span>
              </button>
            );
          })}
          {!orderedScreens.length && (
            <p className="hint" style={{ padding: "8px 10px", margin: 0 }}>
              No screens yet.
            </p>
          )}
        </div>
        <div className="screens-sidebar-foot">
          <button
            className="primary"
            style={{ width: "100%" }}
            onClick={() => setShowUpload(true)}
          >
            + New screen
          </button>
          <button
            className="ghost"
            style={{ width: "100%", marginTop: 6 }}
            onClick={() => setShowIngest(true)}
            disabled={!!busy}
          >
            Import folder…
          </button>
          {ingestReport && (
            <p className="hint" style={{ margin: "8px 0 0", fontSize: 12 }}>
              {ingestReport}
            </p>
          )}
        </div>
      </aside>

      <div className="screens-main">
      <div className="toolbar screens-toolbar">
        {selected && (
          <div className="seg">
            <button
              type="button"
              className={editMode === "overlay" ? "on" : ""}
              onClick={() => setEditMode("overlay")}
            >
              Source
            </button>
            <button
              type="button"
              className={editMode === "frame" ? "on" : ""}
              onClick={() => setEditMode("frame")}
            >
              Frame
            </button>
          </div>
        )}

        {selected && variantIds.length > 0 && (
          <div className="variant-tabs seg">
            {variantIds.map((id) => (
              <button
                key={id}
                className={id === variantPresetId ? "on" : ""}
                onClick={() => setVariantPresetId(id)}
                title={presetLabel(id)}
              >
                {presetLabel(id)}
                {!getOverlay(selected, id) && " ○"}
              </button>
            ))}
            {availableToAdd.length > 0 && (
              <select
                className="variant-add"
                value=""
                aria-label="Add device"
                disabled={!!busy}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) void addVariant(id);
                }}
              >
                <option value="">+</option>
                {availableToAdd.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <label className="screens-locale">
          <span>Preview</span>
          <select
            value={previewLocale}
            onChange={(e) => onPreviewLocale(e.target.value)}
          >
            {summary.locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        {selected && renaming && (
          <div className="row" style={{ gap: 6 }}>
            <input
              ref={renameInputRef}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                if (e.key === "Escape") cancelRename();
              }}
              disabled={!!busy}
              style={{ width: 160 }}
              aria-label="New screen name"
            />
            <button
              className="primary mini"
              disabled={!!busy || !renameDraft.trim()}
              onClick={() => void commitRename()}
            >
              Save
            </button>
            <button
              className="ghost mini"
              disabled={!!busy}
              onClick={cancelRename}
            >
              Cancel
            </button>
          </div>
        )}

        {selected && !renaming && (
          <div className="screens-more" ref={moreRef}>
            <button
              type="button"
              className="ghost"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-label="More screen actions"
              disabled={!!busy}
              onClick={() => setMoreOpen((v) => !v)}
            >
              •••
            </button>
            {moreOpen && (
              <div className="screens-more-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    startRename();
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    swapInput.current?.click();
                  }}
                >
                  Swap image
                </button>
                {editMode === "overlay" && variantHasOverlay && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        void (async () => {
                          setBusy("Detecting text");
                          try {
                            await overlayRef.current?.detectText();
                          } finally {
                            setBusy(null);
                          }
                        })();
                      }}
                    >
                      Detect text
                    </button>
                    <div className="screens-more-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className={onion ? "is-on" : ""}
                      onClick={() => setOnion((v) => !v)}
                    >
                      {onion ? "Onion skin on" : "Onion skin"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        void overlayRef.current?.rebuildPlate();
                      }}
                    >
                      Rebuild plate
                    </button>
                  </>
                )}
                <div className="screens-more-sep" />
                {variantIds.length > 1 && (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      if (armRemoveVariant) {
                        setMoreOpen(false);
                        void removeVariant();
                      } else {
                        setArmRemoveVariant(true);
                        setTimeout(() => setArmRemoveVariant(false), 4000);
                      }
                    }}
                  >
                    {armRemoveVariant
                      ? "Confirm remove device"
                      : "Remove device"}
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    if (armDelete) {
                      setMoreOpen(false);
                      void remove();
                    } else {
                      armDeleteOnce();
                    }
                  }}
                >
                  {armDelete ? "Confirm delete" : "Delete screen"}
                </button>
              </div>
            )}
          </div>
        )}

        <input
          ref={swapInput}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => void swap(e.target.files?.[0])}
        />
        <div className="spacer" />
        {busy && <span className="hint">{busy}…</span>}
      </div>

      <div className="unified-screens-body">
        {selected ? (
          editMode === "overlay" ? (
            variantHasOverlay ? (
              <div className="unified-overlay-pane solo">
                <OverlayEditor
                  key={`${selected.id}-${variantPresetId}`}
                  ref={overlayRef}
                  screen={selected}
                  presets={presets}
                  summary={summary}
                  initialPreset={variantPresetId}
                  variantPresetId={variantPresetId}
                  hideDevicePicker
                  embedded
                  onion={onion}
                  onOnionChange={setOnion}
                  history={history}
                  palette={palette}
                  onChanged={() => reload().catch(() => {})}
                  previewLocale={previewLocale}
                  onPreviewLocale={onPreviewLocale}
                />
              </div>
            ) : (
              <div className="empty-state">
                <h2>{presetLabel(variantPresetId)} needs a screenshot</h2>
                <p>
                  Upload a screenshot for this device size. After it lands,
                  Detect text in ••• can create slots from the image.
                </p>
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => {
                    swapInput.current?.click();
                  }}
                >
                  {busy ? `${busy}…` : "Upload screenshot"}
                </button>
              </div>
            )
          ) : (
            <div className="unified-compose-pane solo">
              <CompositionPanel
                screen={selected}
                config={config}
                summary={summary}
                presets={presets}
                variantPresetId={variantPresetId}
                previewLocale={previewLocale}
                onPreviewLocale={onPreviewLocale}
                onChanged={() => reload().catch(() => {})}
                hasOverlay={variantHasOverlay}
                history={history}
              />
            </div>
          )
        ) : (
          <div className="empty-state">
            <h2>No screens yet</h2>
            <p>Upload a screenshot to start localizing. Text detection is optional.</p>
            <button className="primary" onClick={() => setShowUpload(true)}>
              Upload screenshot
            </button>
          </div>
        )}
      </div>
      </div>

      {showUpload && (
        <OverlayUploadModal
          summary={summary}
          presets={presets}
          busy={
            busy === "Analyzing screenshot" || busy === "Uploading screenshot"
          }
          onClose={() => setShowUpload(false)}
          onCreate={create}
        />
      )}
      {showIngest && (
        <IngestFolderModal
          baseLocale={summary.baseLocale}
          busy={busy === "Importing folder"}
          onClose={() => setShowIngest(false)}
          onIngest={ingestFolder}
        />
      )}
    </div>
  );
}
