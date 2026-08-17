import fs from "node:fs";
import { credentialFile } from "../paths.js";
import { store } from "../store.js";
import type { AscCredentials } from "../types.js";

export interface SaveCredentialsInput {
  issuerId: string;
  keyId: string;
  appId: string;
  privateKey: string;
  versionString?: string;
}

/**
 * Persist the ASC private key OUTSIDE the project (~/.lss/credentials) and
 * store only a redacted reference in project.json.
 */
export function saveCredentials(input: SaveCredentialsInput): void {
  fs.writeFileSync(credentialFile(input.appId), input.privateKey, {
    mode: 0o600,
  });
  const existing = store.isOpen() ? store.getConfig().asc : undefined;
  store.setAscRef({
    issuerId: input.issuerId,
    keyId: input.keyId,
    appId: input.appId,
    // Keep the separately-edited target version unless the caller overrides it.
    versionString:
      input.versionString !== undefined
        ? input.versionString || undefined
        : existing?.versionString,
    hasKey: true,
  });
}

/** Load full credentials (including the private key) for upload, if present. */
export function loadCredentials(): AscCredentials | null {
  const ref = store.getConfig().asc;
  if (!ref?.appId || !ref.issuerId || !ref.keyId || !ref.hasKey) return null;
  const file = credentialFile(ref.appId);
  if (!fs.existsSync(file)) return null;
  return {
    issuerId: ref.issuerId,
    keyId: ref.keyId,
    appId: ref.appId,
    versionString: ref.versionString,
    privateKey: fs.readFileSync(file, "utf8"),
  };
}

export function hasCredentials(): boolean {
  return loadCredentials() !== null;
}
