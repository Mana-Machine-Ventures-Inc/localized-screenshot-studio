import { useState } from "react";

interface Props {
  onClose: () => void;
  onSave: (input: { apiKey: string; model?: string }) => void;
  onClear?: () => void;
  configured?: boolean;
}

export function OpenAIModal({
  onClose,
  onSave,
  onClear,
  configured,
}: Props) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  const canSave = apiKey.trim().length > 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>OpenAI API key</h3>
        <div className="banner info">
          Required for AI localization (and OCR fallback). Stored outside the
          project under <span className="mono">~/.lss/openai.json</span> — never
          written to <span className="mono">project.json</span>.
        </div>
        <div className="field">
          <label>API key</label>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
          />
        </div>
        <div className="field">
          <label>Model (optional)</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
          />
          <p className="hint" style={{ margin: "6px 0 0" }}>
            Leave blank to use the default translation model.
          </p>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          {configured && onClear && (
            <button type="button" className="danger" onClick={onClear}>
              Remove key
            </button>
          )}
          <div className="spacer" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!canSave}
            onClick={() =>
              onSave({
                apiKey: apiKey.trim(),
                model: model.trim() || undefined,
              })
            }
          >
            Save key
          </button>
        </div>
      </div>
    </div>
  );
}
