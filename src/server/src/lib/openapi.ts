import type { Express } from "express";
import type { ZodTypeAny } from "zod";
import { AUTH_COOKIE } from "../config.js";

/**
 * Builds an OpenAPI 3.1 document from the running Express app, so the published
 * spec cannot drift from the routes: every path, method and Zod request schema
 * is read from the same objects that serve and validate the requests.
 * No runtime dependency: a small Zod-to-JSON-Schema converter lives here.
 */

type Json = Record<string, unknown>;

interface ZodDef {
  typeName?: string;
  [key: string]: unknown;
}

const defOf = (schema: ZodTypeAny): ZodDef => (schema as unknown as { _def: ZodDef })._def;

function isOptional(schema: ZodTypeAny): boolean {
  return (schema as unknown as { isOptional: () => boolean }).isOptional();
}

export function zodToSchema(schema: ZodTypeAny): Json {
  const def = defOf(schema);
  const inner = (s: unknown) => zodToSchema(s as ZodTypeAny);
  const checksOf = () => (def.checks as Array<{ kind: string; value?: number }> | undefined) ?? [];

  switch (def.typeName) {
    case "ZodString": {
      const out: Json = { type: "string" };
      for (const check of checksOf()) {
        if (check.kind === "min") out.minLength = check.value;
        if (check.kind === "max") out.maxLength = check.value;
        if (check.kind === "email") out.format = "email";
        if (check.kind === "url") out.format = "uri";
        if (check.kind === "uuid") out.format = "uuid";
        if (check.kind === "datetime") out.format = "date-time";
      }
      return out;
    }
    case "ZodNumber": {
      const out: Json = { type: "number" };
      for (const check of checksOf()) {
        if (check.kind === "int") out.type = "integer";
        if (check.kind === "min") out.minimum = check.value;
        if (check.kind === "max") out.maximum = check.value;
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodDate":
      return { type: "string", format: "date-time" };
    case "ZodLiteral":
      return { const: def.value };
    case "ZodEnum":
      return { type: "string", enum: def.values };
    case "ZodNativeEnum":
      return { enum: Object.values(def.values as Json).filter((v) => typeof v === "string") };
    case "ZodArray": {
      const out: Json = { type: "array", items: inner(def.type) };
      const min = def.minLength as { value: number } | null;
      const max = def.maxLength as { value: number } | null;
      if (min) out.minItems = min.value;
      if (max) out.maxItems = max.value;
      return out;
    }
    case "ZodObject": {
      const shape = (def.shape as () => Record<string, ZodTypeAny>)();
      const properties: Json = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = inner(value);
        if (!isOptional(value)) required.push(key);
      }
      const out: Json = { type: "object", properties };
      if (required.length) out.required = required;
      return out;
    }
    case "ZodRecord":
      return { type: "object", additionalProperties: inner(def.valueType) };
    case "ZodOptional":
    case "ZodDefault":
    case "ZodBranded":
    case "ZodReadonly":
      return inner(def.innerType ?? def.type);
    case "ZodNullable":
      return { anyOf: [inner(def.innerType), { type: "null" }] };
    case "ZodEffects":
      return inner(def.schema);
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return { anyOf: Array.from((def.options as Iterable<unknown>) ?? []).map(inner) };
    case "ZodIntersection":
      return { allOf: [inner(def.left), inner(def.right)] };
    default:
      return {};
  }
}

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

interface Layer {
  name?: string;
  handle: ((...args: unknown[]) => unknown) & { schemas?: Schemas; stack?: Layer[] };
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
  regexp?: RegExp & { fast_slash?: boolean };
  keys?: Array<{ name: string }>;
}

interface Operation {
  method: string;
  path: string;
  schemas: Schemas;
  auth: boolean;
  role: string | null;
  areas: string[] | null;
}

/** Turns an Express mount regexp back into a path such as "/events/:eventId/tracks". */
function mountPath(layer: Layer): string {
  if (layer.regexp?.fast_slash) return "";
  const keys = [...(layer.keys ?? [])];
  const param = () => `:${keys.shift()?.name ?? "param"}`;
  return (layer.regexp?.source ?? "")
    .replace(/\\\//g, "/")
    .replace(/^\^/, "")
    .replace("/?(?=/|$)", "")
    .replace(/\(\?:\/\(\[\^\/\]\+\?\)\)/g, () => `/${param()}`)
    .replace(/\(\?:\(\[\^\/\]\+\?\)\)/g, param)
    .replace(/\/$/, "");
}

const ROLE_BY_MIDDLEWARE: Record<string, string> = {
  requireEventAdmin: "event admin",
  requirePermission: "event admin",
  requireJudge: "judge in this event",
  requireOrganizerCapability: "organizer account",
};

function collect(stack: Layer[], prefix: string, out: Operation[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const schemas: Schemas = {};
      let role: string | null = null;
      let areasNeeded: string[] | null = null;
      let auth = false;
      for (const h of layer.route.stack) {
        if (h.handle.schemas) Object.assign(schemas, h.handle.schemas);
        if (h.name === "requireAuth") auth = true;
        const mapped = ROLE_BY_MIDDLEWARE[h.name ?? ""];
        if (mapped) {
          role = mapped;
          auth = true;
        }
        const areas = (h.handle as { areas?: string[] }).areas;
        if (areas) areasNeeded = areas;
      }
      const routePath = layer.route.path === "/" ? "" : layer.route.path;
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method, path: `${prefix}${routePath}`, schemas, auth, role, areas: areasNeeded });
      }
    } else if (layer.handle.stack) {
      collect(layer.handle.stack, `${prefix}${mountPath(layer)}`, out);
    }
  }
}

const toOpenApiPath = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, "{$1}") || "/";

export function buildOpenApi(app: Express): Json {
  const router = (app as unknown as { _router?: { stack: Layer[] } })._router;
  const found: Operation[] = [];
  collect(router?.stack ?? [], "", found);

  const paths: Record<string, Record<string, Json>> = {};
  for (const op of found) {
    if (!op.path.startsWith("/api")) continue;
    const path = toOpenApiPath(op.path);
    const pathParams = [...op.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1]!,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const queryParams: Json[] = [];
    if (op.schemas.query) {
      const q = zodToSchema(op.schemas.query) as { properties?: Record<string, Json>; required?: string[] };
      for (const [name, schema] of Object.entries(q.properties ?? {})) {
        queryParams.push({ name, in: "query", required: q.required?.includes(name) ?? false, schema });
      }
    }
    const segments = path
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter((s) => s && !s.startsWith("{"));
    const tag = segments[0] === "events" && segments[1] ? segments[1] : (segments[0] ?? "api");

    const operation: Json = {
      operationId: `${op.method}_${path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      tags: [tag],
      summary: `${op.method.toUpperCase()} ${path}`,
      parameters: [...pathParams, ...queryParams],
      responses: {
        "200": { description: "Success. The body is JSON unless the route exports a file." },
        "400": {
          description: "Validation failed. `error.details` maps field names to messages.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        ...(op.auth ? { "401": { description: "Not signed in." }, "403": { description: "Signed in but not permitted." } } : {}),
        "404": { description: "Not found, or hidden from this caller." },
      },
    };
    if (op.auth) operation.security = [{ cookieAuth: [] }];
    if (op.role) operation["x-required-role"] = op.role;
    if (op.areas) operation["x-required-area"] = op.areas;
    if (op.schemas.body) {
      operation.requestBody = { required: true, content: { "application/json": { schema: zodToSchema(op.schemas.body) } } };
    }
    (paths[path] ??= {})[op.method] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "podium API",
      version: "0.1.0",
      description:
        "REST API for the podium hackathon platform. Every UI action goes through these routes. Authorization is enforced server side and scoped to the event in the path. Request schemas are read from the same Zod validators the server runs.",
      license: { name: "MIT" },
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: { cookieAuth: { type: "apiKey", in: "cookie", name: AUTH_COOKIE } },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: { type: "object", additionalProperties: { type: "string" } },
              },
            },
          },
        },
      },
    },
    paths,
  };
}
