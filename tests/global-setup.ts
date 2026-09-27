import { execSync } from "node:child_process";
import { loadDotEnv } from "../src/server/src/lib/dotenv.js";

/**
 * Tests run against a dedicated `podium_test` database so a test run can never
 * truncate development data.
 */
export default function setup(): void {
  loadDotEnv(".env.test");
  loadDotEnv(".env");

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the test suite.");
  if (!/_test(\?|$)/.test(url.split("/").pop() ?? "")) {
    throw new Error(
      `Refusing to run tests against "${url}". The database name must end in _test.`,
    );
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
