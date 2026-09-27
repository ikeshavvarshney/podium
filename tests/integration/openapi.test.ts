import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { anon, prisma } from "../helpers.js";

describe("OpenAPI document", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("is served publicly and covers the API", async () => {
    const res = await anon().get("/api/openapi.json").expect(200);
    expect(res.body.openapi).toBe("3.1.0");
    const operations = Object.values(res.body.paths as Record<string, object>).flatMap((p) => Object.keys(p));
    expect(operations.length).toBeGreaterThan(100);
    for (const path of Object.keys(res.body.paths)) expect(path).toMatch(/^\/api[A-Za-z0-9/{}._-]*$/);
  });

  it("reads request schemas and required roles from the real validators", async () => {
    const res = await anon().get("/api/openapi.json").expect(200);
    const tracks = Object.entries(res.body.paths as Record<string, Record<string, any>>).find(
      ([path, ops]) => path.endsWith("/tracks") && ops.post,
    );
    expect(tracks).toBeTruthy();
    const post = tracks![1].post;
    expect(post.requestBody.content["application/json"].schema.required).toContain("name");
    expect(post["x-required-role"]).toBe("event admin");
    expect(post.security).toEqual([{ cookieAuth: [] }]);
  });

  it("matches the committed docs/openapi.json (run npm run openapi if this fails)", async () => {
    const live = await anon().get("/api/openapi.json").expect(200);
    const committed = JSON.parse(readFileSync(new URL("../../docs/openapi.json", import.meta.url), "utf8"));
    expect(Object.keys(committed.paths).sort()).toEqual(Object.keys(live.body.paths).sort());
  });
});
