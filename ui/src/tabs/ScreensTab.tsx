import { useRef, useState } from "react";
import { api } from "../api";
import type { DevicePreset, ProjectConfig, ProjectSummary } from "../types";
import { OverlayEditor } from "../components/OverlayEditor";
import { OverlayUploadModal } from "../components/OverlayUploadModal";

interface Props {
  config: ProjectConfig;
  summary: ProjectSummary;
  presets: DevicePreset[];
  activePreset: string;
  reload: () => Promise<void>;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
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
  activePreset,
  reload,
  selectedId,
  onSelect,
}: Props) {
  const overlayScreens = config.screens.filter((s) => s.kind === "overlay");
  const [showUpload, setShowUpload] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const swapInput = useRef<HTMLInputElement>(null);
  const reocrRef = useRef(false);

  const selected =
    config.screens.find((s) => s.id === selectedId && s.kind === "overlay") ??
    overlayScreens[0];

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
    } finally {
      setBusy(null);
    }
  };

  const swap = async (file?: File) => {
    if (!file || !selected) return;
    setBusy("Swapping image");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await api.replaceSource(selected.id, dataUrl, reocrRef.current);
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
    if (!window.confirm(`Delete “${selected.name}” and its captures?`)) return;
    setBusy("Deleting");
    try {
      await api.deleteScreen(selected.id);
      onSelect(undefined);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="tab-content screens-tab">
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
            <button
              className="ghost"
              onClick={() => {
                reocrRef.current = true;
                swapInput.current?.click();
              }}
              disabled={!!busy}
              title="Replace the screenshot and re-run text detection"
            >
              Swap &amp; re-detect
            </button>
            <button className="danger" onClick={() => void remove()} disabled={!!busy}>
              Delete
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
          + Upload screenshot
        </button>
      </div>

      <div className="screens-editor">
        {selected ? (
          <OverlayEditor
            key={selected.id}
            screen={selected}
            presets={presets}
            summary={summary}
            initialPreset={activePreset}
            embedded
            onChanged={() => reload().catch(() => {})}
          />
        ) : (
          <div className="empty-state">
            <h2>No screens yet</h2>
            <p>Upload a screenshot to detect its text and start localizing.</p>
            <button className="primary" onClick={() => setShowUpload(true)}>
              Upload screenshot
            </button>
          </div>
        )}
      </div>

      {showUpload && (
        <OverlayUploadModal
          summary={summary}
          presets={presets}
          busy={busy === "Analyzing screenshot"}
          onClose={() => setShowUpload(false)}
          onCreate={create}
        />
      )}
    </div>
  );
}
