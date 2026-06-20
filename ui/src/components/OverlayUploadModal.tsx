import { useState } from "react";
import type { DevicePreset, ProjectSummary } from "../types";

interface Props {
  summary: ProjectSummary;
  presets: DevicePreset[];
  busy: boolean;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    sourceLocale: string;
    imageDataUrl: string;
    presetId?: string;
  }) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function OverlayUploadModal({
  summary,
  presets,
  busy,
  onClose,
  onCreate,
}: Props) {
  const [name, setName] = useState("");
  const [sourceLocale, setSourceLocale] = useState(summary.baseLocale);
  const [presetId, setPresetId] = useState("");
  const [dataUrl, setDataUrl] = useState<string>();

  const pick = async (file?: File) => {
    if (!file) return;
    setDataUrl(await readFileAsDataUrl(file));
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
  };

  const submit = () => {
    if (!dataUrl || !name.trim()) return;
    onCreate({
      name: name.trim(),
      sourceLocale,
      imageDataUrl: dataUrl,
      presetId: presetId || undefined,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460 }}
      >
        <div className="modal-title">Upload a screenshot</div>
        <p className="hint">
          We’ll detect the on-screen text, match it to your localizable strings,
          and produce a clean plate you can re-localize.
        </p>

        <div className="field">
          <label>Screenshot</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>
        {dataUrl && (
          <img
            src={dataUrl}
            alt="preview"
            style={{
              maxWidth: "100%",
              maxHeight: 220,
              borderRadius: 8,
              margin: "6px 0",
              border: "1px solid var(--border)",
            }}
          />
        )}

        <div className="field">
          <label>Screen name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Home"
          />
        </div>

        <div className="row" style={{ gap: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Screenshot language</label>
            <select
              value={sourceLocale}
              onChange={(e) => setSourceLocale(e.target.value)}
            >
              {summary.locales.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Device preset</label>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              <option value="">Auto (match aspect)</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button
            className="primary"
            onClick={submit}
            disabled={busy || !dataUrl || !name.trim()}
          >
            {busy ? "Analyzing…" : "Detect text & create"}
          </button>
          <button className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
