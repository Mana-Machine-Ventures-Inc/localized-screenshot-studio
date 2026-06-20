import { useState } from "react";

interface Props {
  onClose: () => void;
  onSave: (input: {
    issuerId: string;
    keyId: string;
    appId: string;
    versionString?: string;
    privateKey: string;
  }) => void;
}

export function CredentialsModal({ onClose, onSave }: Props) {
  const [issuerId, setIssuerId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [appId, setAppId] = useState("");
  const [versionString, setVersionString] = useState("");
  const [privateKey, setPrivateKey] = useState("");

  const canSave = issuerId && keyId && appId && privateKey;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>App Store Connect credentials</h3>
        <div className="banner info">
          The private key is stored outside the project (a Keychain stand-in
          under <span className="mono">~/.lss/credentials</span>) and never
          written to <span className="mono">project.json</span>.
        </div>
        <div className="field">
          <label>Issuer ID</label>
          <input value={issuerId} onChange={(e) => setIssuerId(e.target.value)} />
        </div>
        <div className="field">
          <label>Key ID</label>
          <input value={keyId} onChange={(e) => setKeyId(e.target.value)} />
        </div>
        <div className="field">
          <label>App ID (Apple ID, numeric)</label>
          <input value={appId} onChange={(e) => setAppId(e.target.value)} />
        </div>
        <div className="field">
          <label>Version string (optional)</label>
          <input
            value={versionString}
            onChange={(e) => setVersionString(e.target.value)}
            placeholder="e.g. 2.4.0 (blank = first editable version)"
          />
        </div>
        <div className="field">
          <label>Private key (.p8 contents)</label>
          <textarea
            className="mono"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="-----BEGIN PRIVATE KEY-----"
            style={{ minHeight: 120 }}
          />
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!canSave}
            onClick={() =>
              onSave({
                issuerId,
                keyId,
                appId,
                versionString: versionString || undefined,
                privateKey,
              })
            }
          >
            Save credentials
          </button>
        </div>
      </div>
    </div>
  );
}
