import { z } from "zod";
import { loadDotEnv } from "./lib/dotenv.js";

loadDotEnv();

/**
 * Environment is validated once, at boot. A missing or weak secret fails the
 * process rather than silently degrading security.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  PUBLIC_WEB_URL: z.string().default("http://localhost:3000"),
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
