import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Requests the server makes to addresses people type (link previews, webhooks). Unless allowed, they only reach
 * the internet: never the server itself, its local network or the cloud's metadata addresses (SSRF).
 */

function isPrivateV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** The eight 16-bit groups of an IPv6 address, or null when it isn't one. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, "");
  if (!net.isIPv6(s)) return null;
  // A dotted IPv4 tail ("::ffff:127.0.0.1") is two groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    s = s.slice(0, tail.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head = "", rest] = s.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const groups = rest === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return groups.length === 8 ? groups.map((g) => parseInt(g, 16)) : null;
}

/** Loopback, private, link-local and other addresses that are not on the internet. Anything unreadable counts as private. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  const g = v6Groups(ip);
  if (!g) return true;
  const v4 = (hi: number, lo: number) => isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  // "::" and "::1".
  if (zeros(7) && g[7]! <= 1) return true;
  // An IPv4 address inside an IPv6 one: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::/96), 6to4 (2002::/16).
  if (zeros(5) && g[5] === 0xffff) return v4(g[6]!, g[7]!);
  if (zeros(6)) return v4(g[6]!, g[7]!);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4(g[6]!, g[7]!);
  if (g[0] === 0x2002) return v4(g[1]!, g[2]!);
  // Unique local (fc00::/7), link-local (fe80::/10), site-local (fec0::/10), multicast (ff00::/8).
  return (g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xff80) === 0xfe80 || (g[0]! & 0xffc0) === 0xfec0 || (g[0]! & 0xff00) === 0xff00;
}

/** Thrown when an address is refused because it isn't on the internet. */
export class PrivateAddressError extends Error {
  constructor() {
    super("local network address refused");
  }
}

export interface OutboundOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Lets the request reach the server's own network. */
  allowPrivate?: boolean;
  /** Redirections followed (each checked like the first address). Default: none. */
  maxRedirects?: number;
  /** How much of the answer is read. Default: nothing (status and headers only). */
  maxBytes?: number;
}

export interface OutboundResponse {
  status: number;
  ok: boolean;
  /** The address that answered, after redirections. */
  url: URL;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function requestOnce(url: URL, opts: OutboundOptions, deadline: number): Promise<OutboundResponse> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!opts.allowPrivate && net.isIP(host) && isPrivateAddress(host)) return reject(new PrivateAddressError());
    const transport = url.protocol === "https:" ? https : http;
    // The address is checked as the connection is made, so that a name can't answer with a public address first
    // and a private one next (DNS rebinding).
    const lookup: net.LookupFunction = (hostname, options, callback) => {
      dns.lookup(hostname, { ...(options as dns.LookupOptions), all: true }, (err, addresses) => {
        if (err) return callback(err, "", 0);
        const list = addresses as dns.LookupAddress[];
        if (!list.length) return callback(new Error("address not found"), "", 0);
        if (!opts.allowPrivate && list.some((a) => isPrivateAddress(a.address))) return callback(new PrivateAddressError(), "", 0);
        if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
        callback(null, list[0]!.address, list[0]!.family);
      });
    };
    const req = transport.request(
      url,
      {
        method: opts.method ?? "GET",
        headers: { ...opts.headers, ...(opts.body === undefined ? {} : { "content-length": String(Buffer.byteLength(opts.body)) }) },
        lookup,
        agent: false,
      },
      (res) => {
        const max = opts.maxBytes ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, url, headers: res.headers, body: Buffer.concat(chunks) });
        };
        if (max <= 0) {
          res.destroy();
          return done();
        }
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= max) {
            res.destroy();
            done();
          }
        });
        res.on("end", done);
        res.on("error", (err) => (size ? done() : fail(err)));
      },
    );
    const fail = (err: Error) => {
      clearTimeout(timer);
      req.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error("timeout")), Math.max(1, deadline - Date.now()));
    req.on("error", fail);
    req.end(opts.body);
  });
}

/** An http(s) request to an address someone typed; throws PrivateAddressError when it leads to the local network. */
export async function outboundRequest(target: string | URL, opts: OutboundOptions = {}): Promise<OutboundResponse> {
  let url = new URL(target);
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("http or https only");
    const res = await requestOnce(url, opts, deadline);
    const location = res.headers.location;
    if (res.status < 300 || res.status >= 400 || !location || hop >= (opts.maxRedirects ?? 0)) return res;
    url = new URL(location, url);
  }
}
