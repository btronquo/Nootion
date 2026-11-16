import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { authorization, type S3Settings } from "../src/s3.js";

/**
 * An S3-compatible server in memory, path-style, for the tests: objects, byte ranges, copies, listing by pages,
 * and signature checks (the signature is recomputed from what arrived, so a request changed on the way fails).
 */
export interface FakeS3 {
  url: string;
  settings: (extra?: Partial<S3Settings>) => S3Settings;
  objects: Map<string, { data: Buffer; type: string; modified: Date }>;
  requests: { method: string; path: string }[];
  close: () => Promise<void>;
}

const KEY = { accessKeyId: "AKIAFAKE", secretAccessKey: "fake-secret-key", region: "eu-test-1" };

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const error = (res: http.ServerResponse, status: number, code: string) =>
  res.writeHead(status, { "content-type": "application/xml" }).end(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);

export async function startFakeS3(bucket = "nootion-files"): Promise<FakeS3> {
  const objects: FakeS3["objects"] = new Map();
  const requests: FakeS3["requests"] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url!, "http://fake");
    requests.push({ method: req.method!, path: url.pathname });

    // A presigned link: X-Amz-* in the query.
    if (url.searchParams.has("X-Amz-Signature")) {
      if (Number(url.searchParams.get("X-Amz-Expires")) > 604800) return error(res, 403, "AuthorizationQueryParametersError");
    } else {
      const auth = req.headers.authorization ?? "";
      const m = /SignedHeaders=([^,]+), Signature=([0-9a-f]+)$/.exec(auth);
      if (!m) return error(res, 403, "AccessDenied");
      const signed = m[1]!.split(";");
      const headers = Object.fromEntries(signed.map((h) => [h, String(req.headers[h] ?? "")]));
      const payloadHash = String(req.headers["x-amz-content-sha256"]);
      if (payloadHash !== "UNSIGNED-PAYLOAD" && payloadHash !== createHash("sha256").update(body).digest("hex"))
        return error(res, 400, "XAmzContentSHA256Mismatch");
      const query = Object.fromEntries(url.searchParams);
      const d = String(req.headers["x-amz-date"]);
      const at = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
      const expected = authorization(KEY, { method: req.method!, path: url.pathname, query, headers, payloadHash, at });
      if (expected !== auth) return error(res, 403, "SignatureDoesNotMatch");
    }

    const parts = url.pathname.split("/").slice(1);
    if (decodeURIComponent(parts[0]!) !== bucket) return error(res, 404, "NoSuchBucket");
    const key = decodeURIComponent(parts.slice(1).join("/"));

    if (!key) {
      if (req.method !== "GET") return error(res, 405, "MethodNotAllowed");
      const prefix = url.searchParams.get("prefix") ?? "";
      const max = Number(url.searchParams.get("max-keys") ?? 1000);
      const after = url.searchParams.get("continuation-token") ?? "";
      const keys = [...objects.keys()]
        .filter((k) => k.startsWith(prefix) && k > after)
        .sort()
        .slice(0, max + 1);
      const page = keys.slice(0, max);
      const truncated = keys.length > max;
      const contents = page
        .map(
          (k) =>
            `<Contents><Key>${xml(k)}</Key><LastModified>${objects.get(k)!.modified.toISOString()}</LastModified><Size>${objects.get(k)!.data.length}</Size></Contents>`,
        )
        .join("");
      return res
        .writeHead(200, { "content-type": "application/xml" })
        .end(
          `<?xml version="1.0"?><ListBucketResult><Name>${bucket}</Name><IsTruncated>${truncated}</IsTruncated>${contents}${truncated ? `<NextContinuationToken>${xml(page.at(-1)!)}</NextContinuationToken>` : ""}</ListBucketResult>`,
        );
    }

    const object = objects.get(key);
    switch (req.method) {
      case "PUT": {
        const source = req.headers["x-amz-copy-source"];
        if (source) {
          const from = decodeURIComponent(String(source)).replace(`/${bucket}/`, "");
          const o = objects.get(from);
          if (!o) return error(res, 404, "NoSuchKey");
          objects.set(key, { ...o, modified: new Date() });
          return res.writeHead(200, { "content-type": "application/xml" }).end("<CopyObjectResult><ETag>x</ETag></CopyObjectResult>");
        }
        if (Number(req.headers["content-length"]) !== body.length) return error(res, 400, "IncompleteBody");
        objects.set(key, { data: body, type: String(req.headers["content-type"] ?? "binary/octet-stream"), modified: new Date() });
        return res.writeHead(200).end();
      }
      case "GET":
      case "HEAD": {
        if (!object) return req.method === "HEAD" ? res.writeHead(404).end() : error(res, 404, "NoSuchKey");
        const headers: Record<string, string> = { "content-type": url.searchParams.get("response-content-type") ?? object.type };
        const disposition = url.searchParams.get("response-content-disposition");
        if (disposition) headers["content-disposition"] = disposition;
        const range = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ""));
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(Number(range[2]), object.data.length - 1);
          const part = object.data.subarray(start, end + 1);
          return res
            .writeHead(206, { ...headers, "content-length": String(part.length), "content-range": `bytes ${start}-${end}/${object.data.length}` })
            .end(req.method === "HEAD" ? undefined : part);
        }
        return res.writeHead(200, { ...headers, "content-length": String(object.data.length) }).end(req.method === "HEAD" ? undefined : object.data);
      }
      case "DELETE":
        objects.delete(key);
        return res.writeHead(204).end();
      default:
        return error(res, 405, "MethodNotAllowed");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    objects,
    requests,
    settings: (extra = {}) => ({ bucket, endpoint: url, prefix: "", pathStyle: true, redirect: false, ...KEY, ...extra }),
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** The environment that points Nootion at the fake bucket. */
export function fakeS3Env(s3: FakeS3, extra: Record<string, string> = {}): Record<string, string> {
  return {
    FILES_S3_BUCKET: "nootion-files",
    FILES_S3_ENDPOINT: s3.url,
    FILES_S3_REGION: KEY.region,
    FILES_S3_ACCESS_KEY_ID: KEY.accessKeyId,
    FILES_S3_SECRET_ACCESS_KEY: KEY.secretAccessKey,
    ...extra,
  };
}
