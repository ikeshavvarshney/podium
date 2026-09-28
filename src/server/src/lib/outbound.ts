import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { promises as dns } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

/** Addresses a server-side request must never reach: loopback, private, link-local, metadata. */
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1]!, "ipv4");
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) return blocked.check(address, "ipv6");
  return true;
}

export class OutboundBlockedError extends Error {}

function assertPublicHostname(hostname: string): void {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new OutboundBlockedError(`${host} is a private or internal address.`);
    return;
  }
  // Single-label names resolve through container and corporate DNS to internal services.
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|home\.arpa)$/.test(host)) {
    throw new OutboundBlockedError(`${host} is not a public hostname.`);
  }
}

/** Refuses a URL that is not http(s) or that points, now, at a private address. */
export async function assertPublicUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new OutboundBlockedError("Use http or https.");
  if (allowPrivate) return url;
  assertPublicHostname(url.hostname);
  if (!isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
    const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => {
      throw new OutboundBlockedError(`${url.hostname} does not resolve.`);
    });
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      throw new OutboundBlockedError(`${url.hostname} resolves to a private or internal address.`);
    }
  }
  return url;
}

/**
 * A DNS lookup that refuses private answers at connect time, so a hostname that passed the check
 * when the webhook was saved cannot be re-pointed at an internal address later (DNS rebinding).
 */
function guardedLookup(hostname: string, options: object, callback: (...args: unknown[]) => void): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad) return callback(new OutboundBlockedError(`${hostname} resolved to ${bad.address}, which is internal.`));
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}

/** POSTs without following redirects. Resolves to the status code. */
export function postJson(
  url: URL,
  body: string,
  headers: Record<string, string>,
  options: { timeoutMs: number; allowPrivate: boolean },
): Promise<number> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers },
        timeout: options.timeoutMs,
        ...(options.allowPrivate ? {} : { lookup: guardedLookup as never }),
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timed out after ${options.timeoutMs} ms`)));
    req.on("error", reject);
    req.end(body);
  });
}
