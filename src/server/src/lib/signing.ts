import {
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";
import { recordSigningSecret } from "./instance-secrets.js";

/**
 * Ed25519 key for publicly verifiable records, derived from the instance's record-signing secret.
 * It is independent of the session secret, so rotating sessions never breaks issued records.
 */

/** PKCS#8 prefix for a raw Ed25519 seed. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

let cached: { privateKey: KeyObject; publicKey: KeyObject } | null = null;

function keys() {
  if (cached) return cached;

  const seed = Buffer.from(
    hkdfSync("sha256", recordSigningSecret(), "podium-signing-salt", "podium-record-signing", 32),
  );
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  cached = { privateKey, publicKey: createPublicKey(privateKey) };
  return cached;
}

/** The instance public key, in the form a verifier needs. */
export function signingPublicKey(): { algorithm: string; format: string; publicKey: string } {
  return {
    algorithm: "Ed25519",
    format: "spki-base64url",
    publicKey: keys().publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

/**
 * Canonical JSON: object keys sorted at every level, so a verifier that
 * re-serializes the payload reproduces the exact bytes that were signed.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

export function signPayload(payload: unknown): string {
  return signBytes(null, Buffer.from(canonicalize(payload), "utf8"), keys().privateKey).toString(
    "base64url",
  );
}

export function verifyPayload(payload: unknown, signature: string): boolean {
  try {
    return verifyBytes(
      null,
      Buffer.from(canonicalize(payload), "utf8"),
      keys().publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
