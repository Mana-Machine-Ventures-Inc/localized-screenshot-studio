import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { DevicePreset, ProjectConfig, ProjectSummary } from "../types";
import { OverlayEditor } from "../components/OverlayEditor";
import { CompositionPanel } from "../components/CompositionPanel";
import { OverlayUploadModal } from "../components/OverlayUploadModal";
import { IngestFolderModal } from "../components/IngestFolderModal";
import {
  getOverlay,
  getScreenPresetIds,
  primaryPresetId,
} from "../screens/variants";

interface Props {
  config: ProjectConfig;
  summary: ProjectSummary;
  presets: DevicePreset[];
  reload: () => Promise<void>;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  previewLocale: string;
  onPreviewLocale: (locale: string) => void;
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
}: Props) {
  const overlayScreens = useMemo(
    () => config.screens.filter((s) => s.kind === "overlay"),
    [config.screens],
  );
  const overlayIdsKey = useMemo(
    () => overlayScreens.map((s) => s.id).join("\0"),
    [overlayScreens],
  );
  const [showUpload, setShowUpload] = useState(false);
  const [showIngest, setShowIngest] = useState(false);
  const [ingestReport, setIngestReport] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armDelete, setArmDelete] = useState(false);
  const [armRemoveVariant, setArmRemoveVariant] = useState(false);
  const [addPreset, setAddPreset] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [detectTextOnSwap, setDetectTextOnSwap] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  /** Local order while dragging (and between reloads). */
  const [orderIds, setOrderIds] = useState<string[]>(() =>
    overlayScreens.map((s) => s.id),
  );
  const renameInputRef = useRef<HTMLInputElement>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapInput = useRef<HTMLInputElement>(null);
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

  // Cancel inline rename when switching screens.
  useEffect(() => {
    setRenaming(false);
  }, [selected?.id]);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

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
    setBusy(detectTextOnSwap ? "Analyzing screenshot" : "Swapping image");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await api.replaceSource(
        selected.id,
        dataUrl,
        detectTextOnSwap,
        variantPresetId,
      );
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

  const addVariant = async () => {
    if (!selected || !addPreset) return;
    setBusy("Adding device");
    try {
      await api.addScreenVariant(selected.id, { presetId: addPreset });
      setVariantPresetId(addPreset);
      setAddPreset("");
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

  const screenMeta = (screenId: string) => {
    const s = overlayScreens.find((x) => x.id === screenId);
    if (!s) return "";
    const ids = getScreenPresetIds(s, config.presetIds);
    const missing = ids.filter((id) => !getOverlay(s, id)).length;
    if (!ids.length) return "no devices";
    if (missing) return `${ids.length - missing}/${ids.length} devices`;
    return `${ids.length} device${ids.length === 1 ? "" : "s"}`;
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
                <span className="screens-sidebar-name">{s.name}</span>
                <span className={`screens-sidebar-meta${incomplete ? " warn" : ""}`}>
                  {screenMeta(s.id)}
                </span>
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
      <div className="toolbar">
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
          </div>
        )}

        {selected && availableToAdd.length > 0 && (
          <div className="row" style={{ gap: 6 }}>
            <select
              value={addPreset}
              onChange={(e) => setAddPreset(e.target.value)}
              style={{ maxWidth: 140 }}
            >
              <option value="">+ device…</option>
              {availableToAdd.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              className="ghost mini"
              disabled={!addPreset || !!busy}
              onClick={() => void addVariant()}
            >
              Add
            </button>
          </div>
        )}

        <div className="field inline">
          <label>Preview</label>
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
        </div>

        {selected && (
          <>
            {renaming ? (
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
            ) : (
              <button
                className="ghost"
                onClick={startRename}
                disabled={!!busy}
              >
                Rename
              </button>
            )}
            <button
              className="ghost"
              onClick={() => {
                swapInput.current?.click();
              }}
              disabled={!!busy}
            >
              Swap image
            </button>
            <label
              className="row"
              style={{ gap: 6, alignItems: "center" }}
              title="When swapping or attaching an image, run OCR and replace text slots"
            >
              <input
                type="checkbox"
                checked={detectTextOnSwap}
                onChange={(e) => setDetectTextOnSwap(e.target.checked)}
                disabled={!!busy}
              />
              <span className="hint">Detect text</span>
            </label>
            {variantIds.length > 1 && (
              <button
                className="ghost danger"
                onClick={() => {
                  if (armRemoveVariant) {
                    void removeVariant();
                  } else {
                    setArmRemoveVariant(true);
                    setTimeout(() => setArmRemoveVariant(false), 4000);
                  }
                }}
                disabled={!!busy}
              >
                {armRemoveVariant ? "Confirm remove device" : "Remove device"}
              </button>
            )}
            <button
              className="danger"
              onClick={() => {
                if (armDelete) {
                  void remove();
                } else {
                  armDeleteOnce();
                }
              }}
              disabled={!!busy}
            >
              {armDelete ? "Confirm delete" : "Delete screen"}
            </button>
          </>
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
          variantHasOverlay ? (
            <>
              <div className="unified-overlay-pane">
                <OverlayEditor
                  key={`${selected.id}-${variantPresetId}`}
                  screen={selected}
                  presets={presets}
                  summary={summary}
                  initialPreset={variantPresetId}
                  variantPresetId={variantPresetId}
                  hideDevicePicker
                  embedded
                  onChanged={() => reload().catch(() => {})}
                  previewLocale={previewLocale}
                  onPreviewLocale={onPreviewLocale}
                />
              </div>
              <div className="unified-compose-pane">
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
                />
              </div>
            </>
          ) : (
            <div className="unified-empty-split">
              <div className="empty-state">
                <h2>{presetLabel(variantPresetId)} needs a screenshot</h2>
                <p>
                  This device variant has composition settings but no image yet.
                  Upload a screenshot for this device size. Use Detect text in
                  the toolbar if you want OCR slots created automatically.
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
                  hasOverlay={false}
                />
              </div>
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
