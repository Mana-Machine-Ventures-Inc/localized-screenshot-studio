import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { DevicePreset, ProjectConfig, ProjectSummary } from "../types";
import { OverlayEditor } from "../components/OverlayEditor";
import { CompositionPanel } from "../components/CompositionPanel";
import { OverlayUploadModal } from "../components/OverlayUploadModal";
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
  const overlayScreens = config.screens.filter((s) => s.kind === "overlay");
  const [showUpload, setShowUpload] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [armDelete, setArmDelete] = useState(false);
  const [armRemoveVariant, setArmRemoveVariant] = useState(false);
  const [addPreset, setAddPreset] = useState("");
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapInput = useRef<HTMLInputElement>(null);
  const reocrRef = useRef(false);

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

  const availableToAdd = useMemo(() => {
    if (!selected) return presets;
    const have = new Set(getScreenPresetIds(selected, config.presetIds));
    return presets.filter((p) => config.presetIds.includes(p.id) && !have.has(p.id));
  }, [selected, presets, config.presetIds]);

  const presetLabel = (id: string) =>
    presets.find((p) => p.id === id)?.label ?? id;

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
  }) => {
    setBusy("Analyzing screenshot");
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

  const swap = async (file?: File) => {
    if (!file || !selected) return;
    setBusy("Swapping image");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await api.replaceSource(
        selected.id,
        dataUrl,
        reocrRef.current,
        variantPresetId,
      );
      await reload();
    } finally {
      setBusy(null);
      if (swapInput.current) swapInput.current.value = "";
    }
  };

  const rename = async () => {
    if (!selected) return;
    const name = window.prompt("Rename screen", selected.name)?.trim();
    if (!name || name === selected.name) return;
    setBusy("Renaming");
    try {
      await api.updateOverlay(selected.id, { name });
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

  return (
    <div className="tab-content screens-tab unified-screens">
      <div className="toolbar">
        <div className="field inline">
          <label>Screen</label>
          <select
            value={selected?.id ?? ""}
            onChange={(e) => onSelect(e.target.value)}
            disabled={!overlayScreens.length}
          >
            {overlayScreens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {!overlayScreens.length && <option value="">No screens yet</option>}
          </select>
        </div>

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
            <button className="ghost" onClick={() => void rename()} disabled={!!busy}>
              Rename
            </button>
            <button
              className="ghost"
              onClick={() => {
                reocrRef.current = false;
                swapInput.current?.click();
              }}
              disabled={!!busy}
            >
              Swap image
            </button>
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
        <button className="primary" onClick={() => setShowUpload(true)}>
          + New screen
        </button>
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
                  Upload a screenshot for this device size.
                </p>
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => {
                    reocrRef.current = true;
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
            <p>Upload a screenshot to detect text and start localizing.</p>
            <button className="primary" onClick={() => setShowUpload(true)}>
              Upload screenshot
            </button>
          </div>
        )}
      </div>

      {showUpload && (
        <OverlayUploadModal
          summary={summary}
          presets={presets.filter((p) => config.presetIds.includes(p.id))}
          busy={busy === "Analyzing screenshot"}
          onClose={() => setShowUpload(false)}
          onCreate={create}
        />
      )}
    </div>
  );
}
