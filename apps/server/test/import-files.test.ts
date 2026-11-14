import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import yazl from "yazl";
import { and, eq, isNull } from "drizzle-orm";
import { attachments, databaseProperties, pages } from "../src/db/schema.js";
import type { ProseMirrorNode } from "../src/collab.js";
import { buildTree, cleanName, safeEntryPath } from "../src/import-files.js";
import { parseHtml } from "../src/html-in.js";
import { parseMarkdown, splitFrontMatter } from "../src/markdown-in.js";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let ws = "";

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  ws = await boris.personalWorkspace();
});
afterEach(async () => {
  await app.close();
});

// A 1×1 PNG.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

function zip(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const z = new yazl.ZipFile();
  for (const [name, data] of Object.entries(entries)) z.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name);
  z.end();
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    z.outputStream.on("data", (c: Buffer) => chunks.push(c));
    z.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function form(fields: Record<string, string>, files: { name: string; data: Buffer | string }[]) {
  const boundary = "----nootion-import";
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    );
    parts.push(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function runImport(files: { name: string; data: Buffer | string }[], fields: Record<string, string> = {}, who = boris, expected = "done") {
  const { body, headers } = form({ workspaceId: ws, ...fields }, files);
  const res = await who.request("POST", "/api/import/files", body, headers);
  expect(res.statusCode, res.body).toBe(200);
  for (let i = 0; i < 300; i++) {
    const { job } = (await who.get(`/api/import/files?workspaceId=${ws}`)).json();
    if (job.status !== "running") {
      if (expected === "done") expect(job.error).toBeNull();
      expect(job.status).toBe(expected);
      return job;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("import never finished");
}

const live = () =>
  app.db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, ws), isNull(pages.deletedAt)))
    .all();
const byTitle = (title: string) => live().find((p) => p.title === title)!;
const contentOf = (id: string) => app.db.select({ json: pages.contentJson }).from(pages).where(eq(pages.id, id)).get()!.json as ProseMirrorNode;
const find = (n: ProseMirrorNode, type: string): ProseMirrorNode[] => [...(n.type === type ? [n] : []), ...(n.content ?? []).flatMap((c) => find(c, type))];

describe("import from files", () => {
  it("imports a folder of notes: subpages, wiki links, images and callouts", async () => {
    const vault = await zip({
      "Vault/Home.md":
        "---\ntags: [projet, perso]\n---\n# Home\n\nSee [[Plan]] and [[Plan|the plan]].\n\n![[photo.png]]\n\n> [!warning] Attention\n> Bientôt.\n\nUn ==surligné== et %%caché%% texte.",
      "Vault/Projects/Plan.md": "Back to [home](../Home.md).\n\n- [ ] faire\n- [x] fait",
      "Vault/Projects/Projects.md": "Note du dossier",
      "Vault/attachments/photo.png": PNG,
      "Vault/attachments/unused.pdf": "%PDF-1.4",
      "Vault/.obsidian/app.json": "{}",
    });
    const job = await runImport([{ name: "Vault.zip", data: vault }]);
    expect(job.report).toMatchObject({ pages: 5, files: 2 });

    const root = byTitle("Vault");
    const home = byTitle("Home");
    const projects = byTitle("Projects");
    const plan = byTitle("Plan");
    expect(root.parentId).toBeNull();
    expect(home.parentId).toBe(root.id);
    expect(plan.parentId).toBe(projects.id);
    // The settings folder of the notes app is left out.
    expect(live().some((p) => p.title === ".obsidian" || p.title === "app")).toBe(false);

    const doc = contentOf(home.id);
    // The first heading is the title; the tags come first.
    expect(doc.content![0]).toMatchObject({ type: "paragraph", content: [{ text: "#projet #perso" }] });
    expect(find(doc, "pageLink").map((n) => n.attrs!.pageId)).toEqual([plan.id, plan.id]);
    const image = find(doc, "image")[0]!;
    expect(image.attrs!.src).toMatch(/^\/api\/attachments\//);
    const file = app.db
      .select()
      .from(attachments)
      .where(eq(attachments.id, String(image.attrs!.src).split("/").pop()!))
      .get()!;
    expect(file).toMatchObject({ pageId: home.id, filename: "photo.png", mimeType: "image/png" });
    expect(find(doc, "callout")[0]).toMatchObject({ attrs: { emoji: "⚠️" } });
    // ==text== is a highlight (text colours), %%comments%% are dropped.
    const last = doc.content!.at(-1)!;
    expect(last.content!.map((n) => n.text).join("")).toBe("Un surligné et  texte.");
    expect(last.content!.find((n) => n.text === "surligné")!.marks).toEqual([{ type: "highlight", attrs: { color: "yellow" } }]);

    expect(find(contentOf(plan.id), "pageLink")[0]!.attrs!.pageId).toBe(home.id);
    expect(find(contentOf(plan.id), "taskItem").map((n) => n.attrs!.checked)).toEqual([false, true]);
    // The folder note is the folder's page.
    expect(JSON.stringify(contentOf(projects.id))).toContain("Note du dossier");
    // A file no page shows goes at the end of its folder's page.
    expect(find(contentOf(byTitle("attachments").id), "fileAttachment")[0]!.attrs!.name).toBe("unused.pdf");
  });

  it("turns a CSV beside a folder into a database whose rows get their pages", async () => {
    const id = "0123456789abcdef0123456789abcdef";
    const exp = await zip({
      [`Projets ${id}.md`]: `# Projets\n\n[Tâches](Projets%20${id}/T%C3%A2ches%20${id}.csv)`,
      [`Projets ${id}/Tâches ${id}.csv`]: "Nom,Statut,Points,Fait\nÉcrire,En cours,3,Oui\nRelire,À faire,5,Non\n",
      [`Projets ${id}/Tâches ${id}_all.csv`]: "Nom,Statut,Points,Fait\nÉcrire,En cours,3,Oui\nRelire,À faire,5,Non\nPublier,À faire,1,Non\n",
      [`Projets ${id}/Tâches ${id}/Écrire ${id.replace(/0/g, "1")}.md`]: "# Écrire\n\nStatut: En cours\n\nLe brouillon est prêt.",
    });
    const job = await runImport([{ name: "Export-123.zip", data: exp }]);
    expect(job.report).toMatchObject({ pages: 1, databases: 1, rows: 3 });
    const projets = byTitle("Projets");
    // The archive holds one page: no page named after the archive.
    expect(projets.parentId).toBeNull();
    const db = byTitle("Tâches");
    expect(db).toMatchObject({ kind: "database", parentId: projets.id });
    const columns = app.db.select().from(databaseProperties).where(eq(databaseProperties.databaseId, db.id)).all();
    expect(columns.map((c) => [c.name, c.type])).toEqual([
      ["Nom", "title"],
      ["Statut", "text"],
      ["Points", "number"],
      ["Fait", "checkbox"],
    ]);
    const rows = live().filter((p) => p.parentId === db.id);
    expect(rows.map((r) => r.title).sort()).toEqual(["Publier", "Relire", "Écrire"]);
    const write = rows.find((r) => r.title === "Écrire")!;
    expect(write.kind).toBe("row");
    expect(JSON.stringify(contentOf(write.id))).toContain("Le brouillon est prêt.");
    expect(find(contentOf(projets.id), "pageLink")[0]!.attrs!.pageId).toBe(db.id);
  });

  it("imports HTML pages and loose Markdown files at the place chosen", async () => {
    const parent = await boris.createPage(ws, "Archives");
    const html = `<html><head><title>x</title></head><body><article><header><div class="page-header-icon"><span class="icon">🎯</span></div><h1 class="page-title">Objectifs</h1></header>
      <div class="page-body"><p>Du <strong>gras</strong> et <a href="https://example.com">un lien</a>.</p>
      <figure class="callout"><div><span class="icon">💡</span></div><div>Une idée</div></figure>
      <ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span>Fait</span></li><li><div class="checkbox checkbox-off"></div> <span>À faire</span></li></ul>
      <pre><code class="language-js">const a = 1 &lt; 2;</code></pre><script>alert(1)</script>
      <p><a href="javascript:alert(1)">piège</a><img src="data:image/png;base64,${PNG.toString("base64")}"></p></div></article></body></html>`;
    const job = await runImport(
      [
        { name: "objectifs.html", data: html },
        { name: "note.md", data: "# Note\n\nVoir [objectifs](objectifs.html)." },
      ],
      { parentId: parent },
    );
    expect(job.report.pages).toBe(2);
    const page = byTitle("Objectifs");
    expect(page).toMatchObject({ parentId: parent, icon: "🎯" });
    const doc = contentOf(page.id);
    expect(find(doc, "callout")[0]).toMatchObject({ attrs: { emoji: "💡" } });
    expect(find(doc, "taskItem").map((n) => n.attrs!.checked)).toEqual([true, false]);
    expect(find(doc, "codeBlock")[0]).toMatchObject({ attrs: { language: "js" }, content: [{ text: "const a = 1 < 2;" }] });
    expect(JSON.stringify(doc)).not.toContain("alert");
    expect(String(find(doc, "image")[0]!.attrs!.src)).toMatch(/^\/api\/attachments\//);
    expect(find(contentOf(byTitle("Note").id), "pageLink")[0]!.attrs!.pageId).toBe(page.id);
  });

  it("imports a Word document with its headings, lists and images", async () => {
    const docx = await zip({
      "[Content_Types].xml":
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels":
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/_rels/document.xml.rels":
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/><Relationship Id="rSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      "word/styles.xml":
        '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>',
      "word/media/a.png": PNG,
      "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Compte rendu</w:t></w:r></w:p>
        <w:p><w:r><w:t xml:space="preserve">Texte </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>important</w:t></w:r></w:p>
        <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="a"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
      </w:body></w:document>`,
    });
    await runImport([{ name: "Réunion.docx", data: docx }]);
    const page = byTitle("Réunion");
    const doc = contentOf(page.id);
    expect(find(doc, "heading")[0]).toMatchObject({ content: [{ text: "Compte rendu" }] });
    expect(find(doc, "paragraph")[0]!.content).toEqual([
      { type: "text", text: "Texte " },
      { type: "text", text: "important", marks: [{ type: "bold" }] },
    ]);
    expect(String(find(doc, "image")[0]!.attrs!.src)).toMatch(/^\/api\/attachments\//);
  });

  it("leaves out paths going outside the archive, and undoes the import", async () => {
    await runImport([{ name: "a.md", data: "A" }]);
    // yazl refuses unsafe names: the entry is renamed in the archive's bytes (names aren't covered by checksums).
    const raw = await zip({ "x/ok.md": "ok", zzzzzzzzzzzzz: "non" });
    const z2 = Buffer.from(raw.toString("latin1").replaceAll("zzzzzzzzzzzzz", "../../evil.md"), "latin1");
    const job2 = await runImport([{ name: "lot2.zip", data: z2 }]);
    expect(job2.report.notes.unsafePath).toBe(1);
    expect(live().some((p) => p.title === "evil")).toBe(false);

    const before = live().length;
    const res = await boris.post(`/api/import/files/${job2.id}/undo`);
    expect(res.statusCode).toBe(200);
    expect(res.json().job.undone).toBe(true);
    expect(live().length).toBeLessThan(before);
    expect(live().some((p) => p.title === "x")).toBe(false);
    expect(live().some((p) => p.title === "a")).toBe(true);
  });

  it("is refused to people who can't add pages to the space", async () => {
    const shared = (await boris.post("/api/workspaces", { name: "Équipe" })).json().workspace.id;
    const lea = await inviteUser(app, boris, { name: "Léa", email: "lea@example.com", password: "motdepasse-lea" });
    const leaId = await lea.id();
    await boris.post(`/api/workspaces/${shared}/members`, { userId: leaId, role: "viewer" });
    const { body, headers } = form({ workspaceId: shared }, [{ name: "a.md", data: "x" }]);
    const res = await lea.request("POST", "/api/import/files", body, headers);
    expect(res.statusCode).toBe(404);
  });
});

describe("converters", () => {
  it("reads front matter", () => {
    expect(splitFrontMatter('---\ntitle: "Mon titre"\ntags:\n  - a\n  - b\nicon: 🎯\n---\ncorps').data).toEqual({
      title: "Mon titre",
      tags: ["a", "b"],
      icon: "🎯",
    });
    expect(splitFrontMatter("pas de front matter").body).toBe("pas de front matter");
  });

  it("keeps Markdown sent through the API as before", () => {
    const doc = parseMarkdown("> [!note] x\n\n[[Page]] ==a==");
    expect(doc.content![0]!.type).toBe("blockquote");
    expect(JSON.stringify(doc)).toContain("[[Page]] ==a==");
  });

  it("reads Nootion's own export back: callouts with an emoji, toggles, underline", () => {
    const doc = parseMarkdown("> 🔥 Chaud\n\n<details>\n<summary>Plus</summary>\n\nDedans\n\n</details>\n\n<u>souligné</u>", {});
    expect(doc.content![0]).toMatchObject({ type: "callout", attrs: { emoji: "🔥" } });
    expect(doc.content![1]).toMatchObject({ type: "details", content: [{ type: "detailsSummary", content: [{ text: "Plus" }] }, { type: "detailsContent" }] });
    expect(doc.content![2]!.content![0]).toEqual({ type: "text", text: "souligné", marks: [{ type: "underline" }] });
  });

  it("converts HTML tables, nested lists and columns", () => {
    const { doc } = parseHtml(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></table><ul><li>un<ul><li>deux</li></ul></li></ul><div class="column-list"><div class="column"><p>g</p></div><div class="column"><p>d</p></div></div>',
    );
    const [table, list, columns] = doc.content!;
    expect(table!.content!.map((r) => r.content!.length)).toEqual([2, 2]);
    expect(table!.content![0]!.content![0]!.type).toBe("tableHeader");
    expect(list!.content![0]!.content!.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
    expect(columns).toMatchObject({ type: "columns", content: [{ type: "column" }, { type: "column" }] });
  });

  it("names pages after their files and keeps paths inside the archive", () => {
    expect(cleanName("Ma page 0123456789abcdef0123456789abcdef.md", true)).toBe("Ma page");
    expect(safeEntryPath("a/../../b")).toBeNull();
    expect(safeEntryPath("C:/Windows/x")).toBeNull();
    expect(safeEntryPath("/etc/passwd")).toBeNull();
    expect(safeEntryPath("a/./b.md")).toBe("a/b.md");
    const tree = buildTree([
      { path: "P.md", size: 1, disk: "" },
      { path: "P/Q.md", size: 1, disk: "" },
      { path: "D.csv", size: 1, disk: "" },
      { path: "D.json", size: 1, disk: "" },
    ]);
    expect(tree.map((n) => [n.name, n.kind, n.children.length, n.assets.length])).toEqual([
      ["D", "database", 0, 0],
      ["P", "page", 1, 0],
    ]);
  });
});
