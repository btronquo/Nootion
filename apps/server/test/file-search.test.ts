import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { attachments } from "../src/db/schema.js";
import { detectTools, type ExtractTools } from "../src/extract.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let tools: ExtractTools;

beforeAll(async () => {
  tools = await detectTools();
});

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
});

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name));

async function upload(c: Client, pageId: string, name: string, type: string, data: Buffer) {
  const boundary = "----nootion";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await c.request("POST", `/api/pages/${pageId}/attachments`, body, { "content-type": `multipart/form-data; boundary=${boundary}` });
  return res.json().attachment.id as string;
}

const search = async (c: Client, q: string) =>
  (await c.get(`/api/search?q=${encodeURIComponent(q)}`)).json().results as {
    id: string;
    title: string;
    snippet: string;
    file?: { id: string; name: string };
  }[];
const status = (id: string) => app.db.select({ s: attachments.textStatus, t: attachments.text }).from(attachments).where(eq(attachments.id, id)).get()!;

describe("search in attached files", { timeout: 60_000 }, () => {
  it("finds the words of text files and files by name, leading to their page", async () => {
    const page = await boris.createPage(await boris.personalWorkspace(), "Maison");
    const notes = await upload(boris, page, "travaux.txt", "text/plain", Buffer.from("Devis du plombier : remplacement du chauffe-eau"));
    const bin = await upload(boris, page, "photo.raw", "application/octet-stream", Buffer.from([0, 1, 2]));
    await app.extractor.drain();
    expect(status(notes)).toEqual({ s: "done", t: "Devis du plombier : remplacement du chauffe-eau" });
    expect(status(bin).s).toBe("unsupported");

    const [hit] = await search(boris, "chauffe eau");
    expect(hit).toMatchObject({ id: page, title: "Maison", file: { id: notes, name: "travaux.txt" } });
    expect(hit!.snippet).toContain("\u0001chauffe\u0002");
    // Accents and case don't matter; the file name is searched too.
    expect((await search(boris, "PLOMBIER"))[0]?.file?.id).toBe(notes);
    expect((await search(boris, "travaux"))[0]?.file?.id).toBe(notes);
  });

  it("only shows files of pages the reader can open, and not in the trash", async () => {
    const ws = await boris.personalWorkspace();
    const page = await boris.createPage(ws, "Impôts");
    await upload(boris, page, "avis.txt", "text/plain", Buffer.from("Avis d'imposition revenus"));
    await app.extractor.drain();
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "motdepasse-alice" });
    expect(await search(alice, "imposition")).toEqual([]);
    expect(await search(boris, "imposition")).toHaveLength(1);
    await boris.delete(`/api/pages/${page}`);
    expect(await search(boris, "imposition")).toEqual([]);
  });

  it.skipIf(!process.env.CI && !fs.existsSync("/usr/bin/pdftotext"))("reads the text of PDFs", async () => {
    const page = await boris.createPage(await boris.personalWorkspace(), "Logement");
    const id = await upload(boris, page, "quittance.pdf", "application/pdf", fixture("rent.pdf"));
    await app.extractor.drain();
    expect(status(id).s).toBe("done");
    expect((await search(boris, "quittance loyer"))[0]?.file?.id).toBe(id);
  });

  it.skipIf(!process.env.CI && !fs.existsSync("/usr/bin/tesseract"))("reads images and scanned PDFs by OCR", async () => {
    expect(tools.ocr).toContain("fra");
    const page = await boris.createPage(await boris.personalWorkspace(), "Papiers");
    const img = await upload(boris, page, "facture.png", "image/png", fixture("invoice.png"));
    const scan = await upload(boris, page, "contrat.pdf", "application/pdf", fixture("scan.pdf"));
    await app.extractor.drain();
    expect(status(img).t).toContain("Référence client 7731");
    expect(status(scan).t).toContain("assurance habitation");
    expect((await search(boris, "reference 7731"))[0]?.file?.id).toBe(img);
    expect((await search(boris, "echeance annuelle"))[0]?.file?.id).toBe(scan);
  });
});
