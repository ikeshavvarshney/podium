import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The tests live in the repo-level tests/ folder, next to src/, while their dependencies are
 * installed in this package. Bare imports from a test file would otherwise be looked up from
 * tests/ upwards and miss this package's node_modules, so they are resolved from here.
 */
// Lower-cased too: Windows reports the same drive as "E:" or "e:" depending on how the shell started.
const norm = (p: string) => p.split("\\").join("/").toLowerCase();
const serverDir = fileURLToPath(new URL(".", import.meta.url)).split("\\").join("/");
const testsPath = fileURLToPath(new URL("../../tests", import.meta.url)).split("\\").join("/");
const testsDir = norm(testsPath);

const isBare = (source: string) =>
  !source.startsWith(".") && !source.startsWith("/") && !source.startsWith("\0") && !/^[A-Za-z]:/.test(source);

export default defineConfig({
  plugins: [
    {
      name: "resolve-test-deps-from-server",
      enforce: "pre",
      async resolveId(source, importer, options) {
        if (!importer || !isBare(source) || !norm(importer).startsWith(testsDir)) return null;
        return this.resolve(source, `${serverDir}package.json`, { ...options, skipSelf: true });
      },
    },
  ],
  server: { fs: { allow: [serverDir, testsPath] } },
  test: {
    environment: "node",
    dir: testsPath,
    include: ["**/*.test.ts"],
    globalSetup: [`${testsPath}/global-setup.ts`],
    // Integration tests share one Postgres database, so they run serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
