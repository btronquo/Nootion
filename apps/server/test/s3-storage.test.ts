import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import yauzl from "yauzl";
import { authorization, presign, s3SettingsFromEnv } from "../src/s3.js";
import { FolderStore, S3Store, fileStore, moveFiles, uploadsDir } from "../src/files.js";
import { cleanOrphanFiles } from "../src/attachments.js";
import { Client, makeApp, setupAdmin } from "./helpers.js";
import { fakeS3Env, startFakeS3, type FakeS3 } from "./s3-fake.js";

describe("AWS Signature Version 4", () => {
  // The examples of the S3 documentation ("Signature Calculations for the Authorization Header", "Query String").
  const key = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
  const at = new Date("2013-05-24T00:00:00Z");

  it("signs a request as AWS does", () => {
    const payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const auth = authorization(key, {
      method: "GET",
      path: "/test.txt",
      query: {},
      headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9", "x-amz-content-sha256": payloadHash, "x-amz-date": "20130524T000000Z" },
      payloadHash,
      at,
    });
    expect(auth).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("signs a link as AWS does", () => {
    const url = presign(key, new URL("https://examplebucket.s3.amazonaws.com/test.txt"), 86400, at);
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });
});

describe("settings", () => {
  it("keeps files in the data folder unless a bucket is given", () => {
    expect(s3SettingsFromEnv({})).toBeNull();
    expect(() => s3SettingsFromEnv({ FILES_S3_BUCKET: "b" })).toThrow(/FILES_S3_ACCESS_KEY_ID/);
    expect(
      s3SettingsFromEnv({ FILES_S3_BUCKET: "b", FILES_S3_ACCESS_KEY_ID: "k", FILES_S3_SECRET_ACCESS_KEY: "s", FILES_S3_REGION: "eu-west-3" }),
    ).toMatchObject({
      endpoint: "https://s3.eu-west-3.amazonaws.com",
      pathStyle: false,
      prefix: "",
      redirect: false,
    });
    expect(
      s3SettingsFromEnv({
        FILES_S3_BUCKET: "b",
        FILES_S3_ACCESS_KEY_ID: "k",
        FILES_S3_SECRET_ACCESS_KEY: "s",
        FILES_S3_ENDPOINT: "http://minio:9000/",
        FILES_S3_PREFIX: "/nootion",
        FILES_S3_REDIRECT: "true",
      }),
    ).toMatchObject({ endpoint: "http://minio:9000", region: "us-east-1", pathStyle: true, prefix: "nootion/", redirect: true });
    expect(() =>
      s3SettingsFromEnv({ FILES_S3_BUCKET: "b", FILES_S3_ACCESS_KEY_ID: "k", FILES_S3_SECRET_ACCESS_KEY: "s", FILES_S3_ENDPOINT: "minio:9000" }),
    ).toThrow(/FILES_S3_ENDPOINT/);
  });
});

let s3: FakeS3;
beforeAll(async () => {
  s3 = await startFakeS3();
});
afterAll(() => s3.close());
afterEach(() => s3.objects.clear());

async function upload(c: Client, pageId: string, name: string, type: string, data: Buffer) {
  const boundary = "----nootion";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await c.request("POST", `/api/pages/${pageId}/attachments`, body, { "content-type": `multipart/form-data; boundary=${boundary}` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().attachment.id as string;
}

function unzipNames(buf: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const names: string[] = [];
      zip.on("entry", (e: yauzl.Entry) => {
        names.push(e.fileName);
        zip.readEntry();
      });
      zip.on("end", () => resolve(names));
      zip.readEntry();
    });
  });
}

describe("attached files in a bucket", () => {
  let app: FastifyInstance;
  let boris: Client;
  let page: string;
  beforeEach(async () => {
    app = await makeApp(undefined, fakeS3Env(s3, { FILES_S3_PREFIX: "instance-a" }));
    boris = await setupAdmin(app);
    page = await boris.createPage(await boris.personalWorkspace(), "Devis");
  });

  it("stores uploads in the bucket, not in the data folder, and serves them with byte ranges", async () => {
    const id = await upload(boris, page, "devis.txt", "text/plain", Buffer.from("Devis du couvreur : 4 200 €"));
    expect([...s3.objects.keys()]).toEqual([`instance-a/${id}`]);
    expect(fs.existsSync(path.join(uploadsDir(app.config.dataDir), id))).toBe(false);

    const whole = await boris.get(`/api/attachments/${id}`);
    expect(whole.statusCode).toBe(200);
    expect(whole.body).toBe("Devis du couvreur : 4 200 €");
    expect(whole.headers["content-type"]).toBe("text/plain");
    expect(whole.headers["content-security-policy"]).toContain("sandbox");

    const part = await boris.request("GET", `/api/attachments/${id}`, undefined, { range: "bytes=0-4" });
    expect(part.statusCode).toBe(206);
    expect(part.body).toBe("Devis");
    expect(part.headers["content-range"]).toBe(`bytes 0-4/${Buffer.byteLength("Devis du couvreur : 4 200 €")}`);
    expect((await boris.request("GET", `/api/attachments/${id}`, undefined, { range: "bytes=999-" })).statusCode).toBe(416);

    // Others still can't read it: access is checked by Nootion before anything is asked of the bucket.
    expect((await new Client(app).get(`/api/attachments/${id}`)).statusCode).toBe(401);
  });

  it("reads the text of files for search through the bucket", async () => {
    const id = await upload(boris, page, "notes.txt", "text/plain", Buffer.from("remplacement du chauffe-eau"));
    await app.extractor.drain();
    const results = (await boris.get(`/api/search?q=${encodeURIComponent("chauffe-eau")}`)).json().results as { file?: { id: string } }[];
    expect(results.some((r) => r.file?.id === id)).toBe(true);
  });

  it("copies files with the page, puts them in exports, and removes them with the page", async () => {
    const id = await upload(boris, page, "plan.png", "image/png", Buffer.from("PNG-bytes"));
    await boris.put(`/api/pages/${page}/content`, { markdown: `![plan](/api/attachments/${id})` });

    const copy = (await boris.post(`/api/pages/${page}/duplicate`)).json();
    expect(s3.objects.size).toBe(2);
    const copyId = [...s3.objects.keys()].map((k) => k.slice("instance-a/".length)).find((k) => k !== id)!;
    expect((await boris.get(`/api/attachments/${copyId}`)).body).toBe("PNG-bytes");
    expect(copy).toBeTruthy();

    const zip = await boris.get(`/api/pages/${page}/export`);
    expect(zip.statusCode).toBe(200);
    expect((await unzipNames(zip.rawPayload)).some((n) => n.endsWith("plan.png"))).toBe(true);

    await boris.delete(`/api/pages/${page}`);
    await boris.delete(`/api/pages/${page}/permanent`);
    // From a bucket, removal runs in the background: wait for it.
    await cleanOrphanFiles(app.db, app.config.dataDir);
    expect([...s3.objects.keys()]).toEqual([`instance-a/${copyId}`]);
  });

  it("leaves files of other instances sharing the bucket alone", async () => {
    s3.objects.set("instance-b/0b5f6a4e-1111-4222-8333-444455556666", { data: Buffer.from("x"), type: "text/plain", modified: new Date(0) });
    s3.objects.set("instance-a/notes-of-the-admin.txt", { data: Buffer.from("x"), type: "text/plain", modified: new Date(0) });
    await cleanOrphanFiles(app.db, app.config.dataDir);
    expect(s3.objects.size).toBe(2);
  });

  it("leaves the files out of backups and says where they are", async () => {
    await upload(boris, page, "devis.txt", "text/plain", Buffer.from("x"));
    const res = await boris.get("/api/admin/backup");
    expect(res.statusCode).toBe(200);
    const names = await unzipNames(res.rawPayload);
    expect(names).toContain("nootion.db");
    expect(names).toContain("ATTACHED-FILES.txt");
    expect(names.some((n) => n.startsWith("uploads/"))).toBe(false);
    expect((await boris.get("/api/admin/backups/schedule")).json().filesBucket).toMatch(/^s3:\/\/nootion-files\/instance-a\//);
  });
});

describe("downloads straight from the bucket", () => {
  it("sends the browser to a short-lived signed link, once access is checked", async () => {
    const app = await makeApp(undefined, fakeS3Env(s3, { FILES_S3_REDIRECT: "true" }));
    const boris = await setupAdmin(app);
    const page = await boris.createPage(await boris.personalWorkspace(), "Photos");
    const id = await upload(boris, page, "page <1>.html", "text/html", Buffer.from("<script>alert(1)</script>"));
    expect((await new Client(app).get(`/api/attachments/${id}`)).statusCode).toBe(401);

    const res = await boris.get(`/api/attachments/${id}`);
    expect(res.statusCode).toBe(302);
    const link = new URL(res.headers.location as string);
    expect(link.origin).toBe(s3.url);
    expect(link.searchParams.get("X-Amz-Expires")).toBe("300");
    // HTML is never shown: the bucket is told to send it as a download.
    expect(link.searchParams.get("response-content-type")).toBe("application/octet-stream");
    const file = await fetch(link);
    expect(await file.text()).toBe("<script>alert(1)</script>");
    expect(file.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''page%20%3C1%3E.html$/);
  });
});

describe("moving files between the data folder and a bucket", () => {
  it("copies everything, skips what is already there, and can remove the source", async () => {
    const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "nootion-move-"));
    const folder = new FolderStore(uploadsDir(dataDir));
    const bucket = new S3Store(s3.settings({ prefix: "moved/" }), path.join(dataDir, "incoming"));
    const ids = ["6f1c3b2a-0000-4000-8000-000000000001", "6f1c3b2a-0000-4000-8000-000000000002", "6f1c3b2a-0000-4000-8000-000000000003"];
    for (const [i, id] of ids.entries()) await folder.putBuffer(id, Buffer.from(`fichier ${i}`.repeat(i * 1000 + 1)));
    fs.writeFileSync(path.join(uploadsDir(dataDir), "half-written.part"), "x");

    let report = await moveFiles(folder, bucket);
    expect(report).toEqual({ copied: 3, skipped: 0, removed: 0, failed: [] });
    expect([...s3.objects.keys()].sort()).toEqual(ids.map((id) => `moved/${id}`));
    expect((await bucket.read(ids[2]!))!.toString()).toBe("fichier 2".repeat(2001));

    // Run again (after an interruption, or for the files added meanwhile): nothing to copy.
    report = await moveFiles(folder, bucket, { removeSource: true });
    expect(report).toEqual({ copied: 0, skipped: 3, removed: 3, failed: [] });
    expect(fs.readdirSync(uploadsDir(dataDir))).toEqual(["half-written.part"]);

    // And back.
    report = await moveFiles(bucket, folder, { removeSource: true });
    expect(report).toEqual({ copied: 3, skipped: 0, removed: 3, failed: [] });
    expect(s3.objects.size).toBe(0);
    expect(fs.readFileSync(path.join(uploadsDir(dataDir), ids[1]!), "utf8")).toBe("fichier 1".repeat(1001));
  });

  it("serves the files moved to the bucket once the server uses it", async () => {
    const plain = await makeApp();
    const boris = await setupAdmin(plain);
    const page = await boris.createPage(await boris.personalWorkspace(), "Archives");
    const id = await upload(boris, page, "a.txt", "text/plain", Buffer.from("archive"));
    expect(fileStore(plain.config.dataDir).kind).toBe("folder");
    await moveFiles(fileStore(plain.config.dataDir), new S3Store(s3.settings(), path.join(plain.config.dataDir, "incoming")), { removeSource: true });

    // The same data folder, started with the bucket's settings.
    const { loadConfig } = await import("../src/config.js");
    const { buildApp } = await import("../src/app.js");
    const config = loadConfig({
      APP_SECRET: "test-secret-0123456789",
      DATA_DIR: plain.config.dataDir,
      DEMO_PAGE: "false",
      UPDATE_CHECK: "false",
      ...fakeS3Env(s3),
    });
    const withBucket = await buildApp({ db: plain.db, config });
    const again = new Client(withBucket);
    again.cookie = boris.cookie;
    expect((await again.get(`/api/attachments/${id}`)).body).toBe("archive");
  });
});
