import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import { Readable } from "node:stream";

/**
 * A small client for S3-compatible storage (AWS S3, MinIO, Backblaze B2, Cloudflare R2, Garage, Ceph…): the few calls
 * attached files need, signed with AWS Signature Version 4. No SDK: the whole protocol used here fits in this file.
 */
export interface S3Settings {
  bucket: string;
  /** "https://s3.eu-west-3.amazonaws.com", "http://minio:9000", "https://<account>.r2.cloudflarestorage.com"… */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Put before every key ("nootion/"): several instances can share a bucket. */
  prefix: string;
  /** Bucket in the path (http://host/bucket/key) rather than in the host name (http://bucket.host/key). */
  pathStyle: boolean;
  /** Downloads are sent to the bucket with a link signed for a few minutes, once access is checked. */
  redirect: boolean;
}

export interface S3Object {
  key: string;
  size: number;
  modified: Date;
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
const UNSIGNED = "UNSIGNED-PAYLOAD";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding, as SigV4 wants it ("/" kept in paths). */
export function uriEncode(value: string, keepSlash = false): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === "/")) out += c;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

const amzDate = (at: Date) =>
  at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

function signingKey(secret: string, date: string, region: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request");
}

function canonicalQuery(query: Record<string, string>) {
  return Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k]!)}`)
    .join("&");
}

export interface SignInput {
  method: string;
  /** The path, already encoded ("/bucket/a%20b"). */
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  payloadHash: string;
  at: Date;
}

/** The Authorization header of a request (headers must hold `host`, `x-amz-date` and `x-amz-content-sha256`). */
export function authorization(s: Pick<S3Settings, "accessKeyId" | "secretAccessKey" | "region">, r: SignInput): string {
  const names = Object.keys(r.headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonical = [
    r.method,
    r.path,
    canonicalQuery(r.query),
    names.map((h) => `${h}:${lower[h]!.trim().replace(/\s+/g, " ")}\n`).join(""),
    names.join(";"),
    r.payloadHash,
  ].join("\n");
  const date = amzDate(r.at).slice(0, 8);
  const scope = `${date}/${s.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate(r.at), scope, sha256(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(s.secretAccessKey, date, s.region))
    .update(toSign)
    .digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${s.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
}

/** A link to an object anyone can open until it expires (query-string signing). */
export function presign(
  s: Pick<S3Settings, "accessKeyId" | "secretAccessKey" | "region">,
  url: URL,
  expiresSeconds: number,
  at = new Date(),
  extra: Record<string, string> = {},
): string {
  const date = amzDate(at).slice(0, 8);
  const query: Record<string, string> = {
    ...extra,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${s.accessKeyId}/${date}/${s.region}/s3/aws4_request`,
    "X-Amz-Date": amzDate(at),
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonical = ["GET", url.pathname, canonicalQuery(query), `host:${url.host}\n`, "host", UNSIGNED].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate(at), `${date}/${s.region}/s3/aws4_request`, sha256(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(s.secretAccessKey, date, s.region))
    .update(toSign)
    .digest("hex");
  return `${url.origin}${url.pathname}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

const xmlValue = (xml: string, tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1];
const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

type Body = Buffer | { file: string; size: number } | null;

export class S3Client {
  constructor(readonly settings: S3Settings) {}

  /** The URL of a key (or of the bucket, for an empty key), with the prefix added. */
  url(key: string | null): URL {
    const base = new URL(this.settings.endpoint);
    const object = key === null ? "" : uriEncode(this.settings.prefix + key, true);
    if (this.settings.pathStyle) {
      const root = base.pathname.replace(/\/+$/, "");
      return new URL(`${base.origin}${root}/${uriEncode(this.settings.bucket)}${key === null ? "" : `/${object}`}`);
    }
    return new URL(`${base.protocol}//${this.settings.bucket}.${base.host}/${object}`);
  }

  private async send(
    method: string,
    key: string | null,
    opts: { query?: Record<string, string>; headers?: Record<string, string>; body?: Body } = {},
  ): Promise<Response> {
    const url = this.url(key);
    const query = opts.query ?? {};
    const at = new Date();
    const body = opts.body ?? null;
    const payloadHash = Buffer.isBuffer(body) ? sha256(body) : body ? UNSIGNED : EMPTY_SHA256;
    const headers: Record<string, string> = { ...opts.headers, host: url.host, "x-amz-date": amzDate(at), "x-amz-content-sha256": payloadHash };
    if (body) headers["content-length"] = String(Buffer.isBuffer(body) ? body.length : body.size);
    headers.authorization = authorization(this.settings, { method, path: url.pathname, query, headers, payloadHash, at });
    delete headers.host;
    const qs = canonicalQuery(query);
    const init: RequestInit & { duplex?: "half" } = { method, headers, signal: AbortSignal.timeout(30 * 60_000) };
    if (Buffer.isBuffer(body)) init.body = new Uint8Array(body.buffer, body.byteOffset, body.length) as Uint8Array<ArrayBuffer>;
    else if (body) {
      init.body = Readable.toWeb(fs.createReadStream(body.file)) as ReadableStream;
      init.duplex = "half";
    }
    let res: Response;
    try {
      res = await fetch(`${url.origin}${url.pathname}${qs ? `?${qs}` : ""}`, init);
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      throw new S3Error(0, "unreachable", `Can't reach ${url.host}: ${cause?.code ?? cause?.message ?? (err as Error).message}`);
    }
    return res;
  }

  private async fail(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => "");
    const code = xmlValue(text, "Code") ?? `HTTP ${res.status}`;
    const message = xmlValue(text, "Message");
    throw new S3Error(res.status, code, `${what}: ${code}${message ? ` (${unescapeXml(message)})` : ""}`);
  }

  async put(key: string, body: Buffer | { file: string; size: number }, contentType = "application/octet-stream") {
    const res = await this.send("PUT", key, { body, headers: { "content-type": contentType } });
    if (!res.ok) await this.fail(res, "Upload");
    await res.body?.cancel();
  }

  /** The object, or part of it (`range` inclusive); null when it doesn't exist. */
  async get(key: string, range?: { start: number; end: number }): Promise<Response | null> {
    const res = await this.send("GET", key, range ? { headers: { range: `bytes=${range.start}-${range.end}` } } : {});
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) await this.fail(res, "Download");
    return res;
  }

  /** The object's size, or null when it doesn't exist. */
  async head(key: string): Promise<number | null> {
    const res = await this.send("HEAD", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new S3Error(res.status, `HTTP ${res.status}`, `Reading a file's size: HTTP ${res.status}`);
    return Number(res.headers.get("content-length") ?? 0);
  }

  async delete(key: string) {
    const res = await this.send("DELETE", key);
    if (!res.ok && res.status !== 404) await this.fail(res, "Delete");
    await res.body?.cancel();
  }

  async copy(from: string, to: string): Promise<boolean> {
    const source = `/${this.settings.bucket}/${uriEncode(this.settings.prefix + from, true)}`;
    const res = await this.send("PUT", to, { headers: { "x-amz-copy-source": source } });
    if (res.status === 404) return false;
    // A copy can fail after a 200: the error is then in the body.
    const text = await res.text();
    if (!res.ok || /<Error>/.test(text)) {
      if (/<Code>NoSuchKey<\/Code>/.test(text)) return false;
      throw new S3Error(res.status, xmlValue(text, "Code") ?? `HTTP ${res.status}`, `Copy: ${xmlValue(text, "Code") ?? res.status}`);
    }
    return true;
  }

  /** Every object under the prefix (keys without the prefix). */
  async *list(): AsyncGenerator<S3Object> {
    let token: string | undefined;
    do {
      const query: Record<string, string> = { "list-type": "2", "max-keys": "1000" };
      if (this.settings.prefix) query.prefix = this.settings.prefix;
      if (token) query["continuation-token"] = token;
      const res = await this.send("GET", null, { query });
      if (!res.ok) await this.fail(res, "Listing the bucket");
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = unescapeXml(xmlValue(m[1]!, "Key") ?? "");
        yield {
          key: key.slice(this.settings.prefix.length),
          size: Number(xmlValue(m[1]!, "Size") ?? 0),
          modified: new Date(xmlValue(m[1]!, "LastModified") ?? 0),
        };
      }
      token = xmlValue(xml, "IsTruncated") === "true" ? unescapeXml(xmlValue(xml, "NextContinuationToken") ?? "") || undefined : undefined;
    } while (token);
  }

  /** Checks that the bucket can be reached with these keys (at start-up). */
  async check() {
    const query: Record<string, string> = { "list-type": "2", "max-keys": "1" };
    if (this.settings.prefix) query.prefix = this.settings.prefix;
    const res = await this.send("GET", null, { query });
    if (!res.ok) await this.fail(res, `Bucket "${this.settings.bucket}"`);
    await res.body?.cancel();
  }

  /** A link to an object, valid `seconds`; `extra` adds response-content-type and the like. */
  signedUrl(key: string, seconds: number, extra: Record<string, string> = {}): string {
    return presign(this.settings, this.url(key), seconds, new Date(), extra);
  }
}

/** S3 settings from the environment (FILES_S3_*), or null when files stay in the data folder. */
export function s3SettingsFromEnv(env: NodeJS.ProcessEnv): S3Settings | null {
  const bucket = env.FILES_S3_BUCKET?.trim();
  if (!bucket) return null;
  const accessKeyId = (env.FILES_S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (env.FILES_S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? "").trim();
  if (!accessKeyId || !secretAccessKey) throw new Error("FILES_S3_BUCKET is set: FILES_S3_ACCESS_KEY_ID and FILES_S3_SECRET_ACCESS_KEY are needed too.");
  const region = env.FILES_S3_REGION?.trim() || env.AWS_REGION?.trim() || "us-east-1";
  const custom = env.FILES_S3_ENDPOINT?.trim();
  const endpoint = (custom || `https://s3.${region}.amazonaws.com`).replace(/\/+$/, "");
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
  } catch {
    throw new Error(`FILES_S3_ENDPOINT is not a valid address: "${endpoint}".`);
  }
  const flag = (v: string | undefined, fallback: boolean) => (v?.trim() ? /^(true|yes|on|1)$/i.test(v.trim()) : fallback);
  let prefix = (env.FILES_S3_PREFIX ?? "").trim().replace(/^\/+/, "");
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  return {
    bucket,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    prefix,
    // MinIO, Garage and most self-hosted servers want the bucket in the path; AWS prefers it in the host name.
    pathStyle: flag(env.FILES_S3_PATH_STYLE, !!custom),
    redirect: flag(env.FILES_S3_REDIRECT, false),
  };
}
