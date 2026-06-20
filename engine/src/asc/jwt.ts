import { SignJWT, importPKCS8 } from "jose";

/**
 * Build an ES256-signed App Store Connect JWT from a `.p8` private key.
 * Tokens are short-lived (<= 20 min) per Apple's requirements.
 */
export async function createAscToken(opts: {
  issuerId: string;
  keyId: string;
  privateKey: string;
}): Promise<string> {
  const key = await importPKCS8(opts.privateKey.trim(), "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: opts.keyId, typ: "JWT" })
    .setIssuer(opts.issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + 19 * 60)
    .setAudience("appstoreconnect-v1")
    .sign(key);
}
