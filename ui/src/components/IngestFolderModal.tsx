import { useState } from "react";
import { isTauriShell, pickScreenshotFolder } from "../pickProject";

interface Props {
  baseLocale: string;
  busy: boolean;
  onClose: () => void;
  onIngest: (input: {
    dir: string;
    sourceLocale: string;
    detectText: boolean;
    keyPrefix: string;
  }) => void;
}

export function IngestFolderModal({
  baseLocale,
  busy,
  onClose,
  onIngest,
}: Props) {
  const [dir, setDir] = useState("");
  const [sourceLocale, setSourceLocale] = useState(baseLocale);
  const [keyPrefix, setKeyPrefix] = useState("appstore");
  const [detectText, setDetectText] = useState(false);

  const browse = async () => {
    const picked = await pickScreenshotFolder();
    if (picked) setDir(picked);
  };

  const submit = () => {
    const trimmed = dir.trim();
    if (!trimmed) return;
    onIngest({
      dir: trimmed,
      sourceLocale: sourceLocale.trim() || baseLocale,
      detectText,
      keyPrefix: keyPrefix.trim() || "appstore",
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480 }}
      >
        <div className="modal-title">Import screenshot folder</div>
        <p className="hint">
          Creates screens from images and samples theme colors for the promo
          frame + headline. iPhone and iPad shots with the same index share one
          screen and one key (<code>ios/2.png</code> + <code>ipad/2.png</code> →{" "}
          <code>appstore.ios_2</code>). Mac stays separate (
          <code>macos/1.png</code> → <code>appstore.macos_1</code>).
        </p>

        <div className="field">
          <label>Folder path</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder="/path/to/screenshots"
              style={{ flex: 1 }}
              autoFocus
            />
            {isTauriShell() && (
              <button type="button" className="ghost" onClick={() => void browse()}>
                Browse…
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <label>Key prefix</label>
          <input
            value={keyPrefix}
            onChange={(e) => setKeyPrefix(e.target.value)}
            placeholder="appstore"
          />
          <p className="hint" style={{ margin: "4px 0 0" }}>
            Used for <code>ios/2.png</code> and <code>ipad/2.png</code> →{" "}
            <code>{keyPrefix || "appstore"}.ios_2</code>
          </p>
        </div>

        <div className="field">
          <label>Source locale</label>
          <input
            value={sourceLocale}
            onChange={(e) => setSourceLocale(e.target.value)}
          />
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
              Detect in-screenshot text (OCR)
            </span>
            <span className="hint">
              Usually off for promo frames — leave off unless you need overlay
              slots.
            </span>
          </span>
        </label>

        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="primary"
            disabled={busy || !dir.trim()}
            onClick={submit}
          >
            {busy ? "Importing…" : "Import"}
          </button>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
