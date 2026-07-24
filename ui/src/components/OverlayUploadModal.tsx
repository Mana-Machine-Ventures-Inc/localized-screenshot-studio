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
    detectText?: boolean;
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
  const [detectText, setDetectText] = useState(false);

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
      detectText,
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
          Attach a source image for this screen. Text detection is optional —
          turn it on only when you want slots auto-created from OCR.
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
                  {p.platform === "macos" ? " · macOS" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="detect-text-opt">
          <input
            type="checkbox"
            checked={detectText}
            onChange={(e) => setDetectText(e.target.checked)}
            disabled={busy}
          />
          <span className="detect-text-opt-copy">
            <span className="detect-text-opt-title">
              Detect text and create fields
            </span>
            <span className="hint">
              Matches OCR to your localizable strings. Leave off to add slots
              yourself.
            </span>
          </span>
        </label>

        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button
            className="primary"
            onClick={submit}
            disabled={busy || !dataUrl || !name.trim()}
          >
            {busy
              ? detectText
                ? "Analyzing…"
                : "Uploading…"
              : "Create screen"}
          </button>
          <button className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
