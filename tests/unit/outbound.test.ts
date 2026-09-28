import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress, OutboundBlockedError } from "../../src/server/src/lib/outbound.js";

describe("outbound address guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.5",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("treats %s as internal", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700::1111"])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://db:5432/",
    "http://localhost:4000/api",
    "http://[::1]/",
    "http://10.0.0.1/hook",
    "http://printer.local/",
    "http://metadata.google.internal/",
  ])("refuses %s", async (url) => {
    await expect(assertPublicUrl(url, false)).rejects.toBeInstanceOf(OutboundBlockedError);
  });

  it("refuses a non-http scheme", async () => {
    await expect(assertPublicUrl("file:///etc/passwd", false)).rejects.toBeInstanceOf(OutboundBlockedError);
  });

  it("accepts a public address, and anything when private targets are allowed", async () => {
    await expect(assertPublicUrl("https://93.184.216.34/hook", false)).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl("http://127.0.0.1:9999/hook", true)).resolves.toBeInstanceOf(URL);
  });
});
