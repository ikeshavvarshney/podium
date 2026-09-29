import { describe, expect, it } from "vitest";
import { httpUrl, isHttpUrl } from "../../src/server/src/middleware/validate.js";

describe("submission link validation", () => {
  it.each([
    "https://github.com/sievebox/inbox",
    "http://example.org",
    "https://sievebox.dev/demo?x=1#top",
    "http://192.168.1.20:8080/demo",
    "http://localhost:4000/api/uploads/9000117c-c155-41a7-a455-dad9d266d5f0",
    "http://localhost/cover.png",
    "http://[::1]:4000/api/uploads/abc",
  ])("accepts %s", (value) => {
    expect(isHttpUrl(value)).toBe(true);
  });

  it.each([
    "github.com/sievebox",
    "https://foo",
    "ftp://example.org/file",
    "javascript:alert(1)",
    "https://exa mple.org",
    "https://.org",
    "https://example.",
    "",
  ])("rejects %s", (value) => {
    expect(isHttpUrl(value)).toBe(false);
  });

  it("accepts the platform's own upload link, which is what a thumbnail upload writes back", () => {
    expect(httpUrl.safeParse(" http://localhost:4000/api/uploads/9000117c-c155-41a7-a455-dad9d266d5f0 ").success).toBe(true);
    expect(httpUrl.safeParse("https://foo").success).toBe(false);
  });
});
