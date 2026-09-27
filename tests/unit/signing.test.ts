import { describe, expect, it } from "vitest";
import {
  canonicalize,
  signPayload,
  signingPublicKey,
  verifyPayload,
} from "../../src/server/src/lib/signing.js";

describe("canonical JSON", () => {
  it("sorts keys at every level so re-serializing reproduces the bytes", () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } });
    const b = canonicalize({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it("drops undefined values rather than emitting them", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("record signing", () => {
  const payload = { type: "podium.judge-participation.v1", judge: "alice", reviewed: ["a", "b"] };

  it("publishes an Ed25519 public key", () => {
    const key = signingPublicKey();
    expect(key.algorithm).toBe("Ed25519");
    expect(key.publicKey.length).toBeGreaterThan(20);
  });

  it("verifies a signature it produced", () => {
    expect(verifyPayload(payload, signPayload(payload))).toBe(true);
  });

  it("is stable across calls, so a stored record stays verifiable", () => {
    expect(signPayload(payload)).toBe(signPayload(payload));
  });

  it("verifies a payload whose keys arrive in a different order", () => {
    const signature = signPayload(payload);
    expect(verifyPayload({ reviewed: ["a", "b"], judge: "alice", type: payload.type }, signature)).toBe(
      true,
    );
  });

  it("rejects a tampered payload", () => {
    const signature = signPayload(payload);
    expect(verifyPayload({ ...payload, reviewed: ["a", "b", "c"] }, signature)).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(verifyPayload(payload, "not-a-signature")).toBe(false);
  });
});
