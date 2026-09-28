import { z } from "zod";
import { loadDotEnv } from "./lib/dotenv.js";

loadDotEnv();

const optionalSecret = (name: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined))
    .refine((v) => v === undefined || v.length >= 32, `${name} must be at least 32 characters`);

/**
 * Environment is validated once, at boot. Secrets are optional: unset, the instance generates
 * and stores its own on first boot (lib/instance-secrets.ts). A weak one fails the process.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: optionalSecret("JWT_SECRET"),
  RECORD_SIGNING_SECRET: optionalSecret("RECORD_SIGNING_SECRET"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  PUBLIC_WEB_URL: z.string().default("http://localhost:3000"),
  /** Lets webhooks reach private and loopback addresses. For local development only. */
  WEBHOOK_ALLOW_PRIVATE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SEED_ON_BOOT: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * Express `trust proxy`. Off by default: the API is published directly, so an
   * `X-Forwarded-For` header comes from the client and must not choose the IP that
   * rate limits and vote caps key on. Behind a reverse proxy, set a hop count ("1")
   * or the proxy's address or subnet.
   */
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v): boolean | number | string => {
      const value = v.trim();
      if (value === "" || value === "false") return false;
      if (value === "true") return true;
      return /^\d+$/.test(value) ? Number(value) : value;
    }),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  isProduction: boolean;
  isTest: boolean;
  corsOrigins: string[];
};

function load(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  const env = parsed.data;
  return {
    ...env,
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    corsOrigins: env.CORS_ORIGIN.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export const config: AppConfig = load();

/** Name of the HTTP-only session cookie. */
export const AUTH_COOKIE = "podium_session";
