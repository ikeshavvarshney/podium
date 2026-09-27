import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { buildOpenApi } from "../src/lib/openapi.js";

const spec = buildOpenApi(createApp());
const out = fileURLToPath(new URL("../../../docs/openapi.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`[openapi] ${Object.keys(spec.paths as object).length} paths written to docs/openapi.json`);
