import { hkdfSync, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { config } from "../config.js";

/** The default that shipped in docker-compose.yml before secrets were generated per instance. */
export const KNOWN_DEV_SECRETS = new Set(["dev-only-change-me-in-production-0123456789abcdef"]);

type SecretName = "session" | "record_signing";

const loaded = new Map<SecretName, string>();

/**
 * Loads the instance's secrets, creating each one on first boot. An operator can still pin them
 * with JWT_SECRET and RECORD_SIGNING_SECRET; the stored values are the default, so a fresh
 * `docker compose up` never runs on a secret that is published in the repository.
 */
export async function initSecrets(db: PrismaClient): Promise<void> {
  if (config.JWT_SECRET && KNOWN_DEV_SECRETS.has(config.JWT_SECRET) && config.isProduction) {
    throw new Error(
      "JWT_SECRET is set to the public development default. Unset it to have podium generate one, or set your own.",
    );
  }
  for (const name of ["session", "record_signing"] as const) {
    const fresh = randomBytes(48).toString("base64url");
    await db.$executeRaw`INSERT INTO "instance_secrets" ("name", "value") VALUES (${name}, ${fresh}) ON CONFLICT ("name") DO NOTHING`;
    const rows = await db.$queryRaw<Array<{ value: string }>>`SELECT "value" FROM "instance_secrets" WHERE "name" = ${name}`;
    loaded.set(name, rows[0]!.value);
  }
}

function derivedForTests(label: string): string {
  if (!config.isTest || !config.JWT_SECRET) {
    throw new Error("Instance secrets are not loaded. Call initSecrets() at boot.");
  }
  return Buffer.from(hkdfSync("sha256", config.JWT_SECRET, "podium", label, 32)).toString("base64url");
}

export function sessionSecret(): string {
  return config.JWT_SECRET ?? loaded.get("session") ?? derivedForTests("session");
}

/** Separate from the session secret, so rotating one never invalidates the other. */
export function recordSigningSecret(): string {
  return config.RECORD_SIGNING_SECRET ?? loaded.get("record_signing") ?? derivedForTests("record-signing");
}
