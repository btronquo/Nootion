import { randomUUID } from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import { localDay, type Locale } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { attachments, databaseProperties, databaseViews, pages, users, workspaceMembers, workspaces } from "./db/schema.js";
import { encodeContent, setProsemirrorJSON, type ProseMirrorNode } from "./collab.js";
import { attachmentPath, uploadsDir } from "./attachments.js";
import { nextPosition } from "./pages.js";

/**
 * A page that shows what Nootion can do, filled with made-up data: every kind of block, a database with its views,
 * and the widgets. Created once for each new user (and on request); it is an ordinary page they can delete.
 */

type N = ProseMirrorNode;
type Mark = { type: string; attrs?: Record<string, unknown> };

const text = (s: string, ...marks: (string | Mark)[]): N => ({
  type: "text",
  text: s,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const p = (...content: (N | string)[]): N => ({
  type: "paragraph",
  ...(content.length ? { content: content.map((c) => (typeof c === "string" ? text(c) : c)) } : {}),
});
const h = (level: number, s: string): N => ({ type: "heading", attrs: { level }, content: [text(s)] });
const li = (s: string | N, ...children: N[]): N => ({ type: "listItem", content: [typeof s === "string" ? p(s) : s, ...children] });
const ul = (...items: N[]): N => ({ type: "bulletList", content: items });
const ol = (...items: N[]): N => ({ type: "orderedList", content: items });
const tasks = (...items: [boolean, string][]): N => ({
  type: "taskList",
  content: items.map(([checked, s]) => ({ type: "taskItem", attrs: { checked }, content: [p(s)] })),
});
const callout = (emoji: string, ...content: N[]): N => ({ type: "callout", attrs: { emoji }, content });
const toggle = (summary: string, ...content: N[]): N => ({
  type: "details",
  content: [
    { type: "detailsSummary", content: [text(summary)] },
    { type: "detailsContent", content },
  ],
});
const columns = (...cols: N[][]): N => ({ type: "columns", content: cols.map((content) => ({ type: "column", content })) });
const table = (rows: string[][]): N => ({
  type: "table",
  content: rows.map((cells, i) => ({ type: "tableRow", content: cells.map((c) => ({ type: i === 0 ? "tableHeader" : "tableCell", content: [p(c)] })) })),
});
const widget = (type: string, attrs: Record<string, unknown> = {}): N => ({ type, attrs });
const link = (href: string): Mark => ({ type: "link", attrs: { href } });

/* ---------- Images: soft gradients, drawn here as PNG files ---------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A diagonal gradient between two colours, with a soft light in one corner. */
export function gradientPng(width: number, height: number, from: [number, number, number], to: [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const f = (x / width + y / height) / 2;
      const dx = x / width - 0.25;
      const dy = y / height - 0.3;
      const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2) * 70;
      for (let c = 0; c < 3; c++) raw[row + 1 + x * 3 + c] = Math.min(255, Math.round(from[c]! + (to[c]! - from[c]!) * f + glow));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- The demo ---------- */

const day = (offset: number, time?: string) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDay(d) + (time ? `T${time}` : "");
};

function writePage(db: Db, values: typeof pages.$inferInsert, content?: N) {
  let extra = {};
  if (content) {
    const doc = new Y.Doc();
    setProsemirrorJSON(doc, content);
    const { state, json, text: plain } = encodeContent(doc);
    extra = { contentState: state, contentJson: json, contentText: plain };
  }
  db.insert(pages)
    .values({ ...values, ...extra })
    .run();
}

/** Creates the demo page in the user's personal workspace; returns its id. */
export function createDemo(db: Db, dataDir: string, userId: string): string {
  const user = db.select({ name: users.name, locale: users.locale }).from(users).where(eq(users.id, userId)).get();
  const ws = db
    .select({ id: workspaces.id })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.kind, "personal")))
    .get();
  if (!user || !ws) throw new Error("No personal workspace");
  const fr = (user.locale as Locale) === "fr";
  const L = (frText: string, enText: string) => (fr ? frText : enText);

  const demoId = randomUUID();
  const dbId = randomUUID();
  const notesId = randomUUID();
  const base = { workspaceId: ws.id, createdBy: userId };

  return db.transaction((tx) => {
    // The page first: the database, the notes and the images hang from it.
    writePage(tx as unknown as Db, {
      ...base,
      id: demoId,
      parentId: null,
      title: L("Découvrir Nootion", "Discover Nootion"),
      icon: "✨",
      position: nextPosition(tx as unknown as Db, ws.id, null),
    });

    /* Database of made-up projects, with every kind of view. */
    writePage(tx as unknown as Db, { ...base, id: dbId, kind: "database", parentId: demoId, title: L("Projets", "Projects"), icon: "🚀", position: 0 });
    const prop = (name: string, type: string, config: Record<string, unknown> = {}) => {
      const id = randomUUID();
      return { id, name, type, config };
    };
    const opt = (name: string, color: string) => ({ id: randomUUID(), name, color });
    const todo = opt(L("À faire", "To do"), "gray");
    const doing = opt(L("En cours", "In progress"), "blue");
    const done = opt(L("Terminé", "Done"), "green");
    const high = opt(L("Haute", "High"), "red");
    const medium = opt(L("Moyenne", "Medium"), "orange");
    const low = opt(L("Basse", "Low"), "gray");
    const tagDesign = opt("Design", "purple");
    const tagDev = opt(L("Développement", "Development"), "blue");
    const tagMarketing = opt("Marketing", "pink");
    const tagOps = opt(L("Opérations", "Operations"), "brown");
    const title = prop(L("Nom", "Name"), "title");
    const status = prop(L("Statut", "Status"), "select", { options: [todo, doing, done] });
    const priority = prop(L("Priorité", "Priority"), "select", { options: [high, medium, low] });
    const when = prop(L("Échéance", "Dates"), "date", { includeTime: false });
    const owner = prop(L("Responsable", "Owner"), "person");
    const hours = prop(L("Heures", "Hours"), "number");
    const budget = prop("Budget", "currency", { currency: "EUR", decimals: 0 });
    const tags = prop("Tags", "multi_select", { options: [tagDesign, tagDev, tagMarketing, tagOps] });
    const ok = prop(L("Fait", "Done"), "checkbox");
    const url = prop(L("Lien", "Link"), "url");
    [title, status, priority, when, owner, hours, budget, tags, ok, url].forEach((pr, position) =>
      tx
        .insert(databaseProperties)
        .values({ id: pr.id, databaseId: dbId, name: pr.name, type: pr.type as "text", config: pr.config, position })
        .run(),
    );
    const views: [string, string, Record<string, unknown>][] = [
      [L("Tableau", "Table"), "table", { calculations: { [hours.id]: "sum", [budget.id]: "sum" } }],
      [L("Kanban", "Board"), "board", { groupBy: status.id }],
      [L("Calendrier", "Calendar"), "calendar", { dateProperty: when.id }],
      [L("Chronologie", "Timeline"), "timeline", { dateProperty: when.id, timelineScale: "week" }],
      [L("Galerie", "Gallery"), "gallery", {}],
      [L("Liste", "List"), "list", { sorts: [{ propertyId: priority.id, direction: "asc" }] }],
    ];
    views.forEach(([name, type, config], position) =>
      tx
        .insert(databaseViews)
        .values({ id: randomUUID(), databaseId: dbId, name, type: type as "table", config, position })
        .run(),
    );
    const rows: [string, string, typeof todo, typeof todo, { start: string; end: string | null }, number, number, (typeof todo)[], string][] = [
      ["🎨", L("Refonte du site", "Website redesign"), doing, high, { start: day(-6), end: day(8) }, 34, 4200, [tagDesign, tagDev], "https://example.com"],
      ["📱", L("Application mobile", "Mobile app"), todo, high, { start: day(5), end: day(26) }, 80, 12000, [tagDev], ""],
      ["📣", L("Campagne de lancement", "Launch campaign"), todo, medium, { start: day(14), end: day(18) }, 16, 2500, [tagMarketing], ""],
      ["🧪", L("Tests utilisateurs", "User testing"), doing, medium, { start: day(-2, "14:00"), end: day(-2, "17:30") }, 6, 300, [tagDesign], ""],
      ["📝", L("Rédaction de la documentation", "Write the documentation"), done, low, { start: day(-15), end: day(-9) }, 12, 0, [tagDev, tagOps], ""],
      ["🤝", L("Rendez-vous partenaire", "Partner meeting"), done, medium, { start: day(-4, "10:00"), end: null }, 2, 0, [tagOps], ""],
      ["📊", L("Bilan trimestriel", "Quarterly review"), todo, low, { start: day(21, "09:30"), end: day(21, "11:00") }, 3, 0, [tagOps], ""],
      ["🔒", L("Audit de sécurité", "Security audit"), done, high, { start: day(-20), end: day(-12) }, 24, 1800, [tagDev], ""],
    ];
    rows.forEach(([icon, name, st, pr, dates, h, b, tg, u], position) => {
      const id = randomUUID();
      writePage(
        tx as unknown as Db,
        {
          ...base,
          id,
          kind: "row",
          parentId: dbId,
          title: name,
          icon,
          position,
          props: {
            [status.id]: st.id,
            [priority.id]: pr.id,
            [when.id]: dates,
            [owner.id]: [userId],
            [hours.id]: h,
            [budget.id]: b,
            [tags.id]: tg.map((x) => x.id),
            [ok.id]: st === done,
            ...(u ? { [url.id]: u } : {}),
          },
        },
        position === 0
          ? {
              type: "doc",
              content: [
                p(
                  L(
                    "Chaque ligne est aussi une page : on peut y écrire comme partout ailleurs.",
                    "Each row is also a page: you can write in it like anywhere else.",
                  ),
                ),
                tasks([true, L("Maquettes validées", "Mock-ups approved")], [false, L("Intégration", "Build")], [false, L("Mise en ligne", "Go live")]),
              ],
            }
          : undefined,
      );
    });

    /* Meeting notes, a subpage. */
    const notesTitle = L("Notes de réunion", "Meeting notes");
    writePage(
      tx as unknown as Db,
      { ...base, id: notesId, parentId: demoId, title: notesTitle, icon: "📝", position: 1 },
      {
        type: "doc",
        content: [
          p(text(L("Réunion d'équipe du ", "Team meeting, ")), { type: "dateMention", attrs: { id: randomUUID(), date: day(-1) } }),
          h(2, L("Points abordés", "Topics")),
          ul(
            li(L("Avancement de la refonte du site", "Website redesign progress")),
            li(L("Budget du trimestre", "This quarter's budget")),
            li(L("Recrutement d'un designer", "Hiring a designer")),
          ),
          h(2, L("Décisions", "Decisions")),
          tasks([true, L("Valider les maquettes", "Approve the mock-ups")], [false, L("Lancer les tests utilisateurs", "Start user testing")]),
        ],
      },
    );

    /* Images for the image block and the carousel. */
    fs.mkdirSync(uploadsDir(dataDir), { recursive: true });
    const palettes: [[number, number, number], [number, number, number], string][] = [
      [[35, 131, 226], [144, 101, 176], "aurora.png"],
      [[223, 171, 1], [217, 115, 13], "sunset.png"],
      [[77, 159, 111], [15, 159, 168], "lagoon.png"],
    ];
    const images = palettes.map(([from, to, filename]) => {
      const id = randomUUID();
      const png = gradientPng(960, 540, from, to);
      fs.writeFileSync(attachmentPath(dataDir, id), png);
      tx.insert(attachments)
        .values({ id, pageId: demoId, filename, mimeType: "image/png", size: png.length, createdBy: userId, textStatus: "unsupported" })
        .run();
      return `/api/attachments/${id}`;
    });

    /* The page itself. */
    const content: N = {
      type: "doc",
      content: [
        callout(
          "👋",
          p(
            text(L("Bienvenue ! ", "Welcome! "), "bold"),
            L(
              "Cette page montre ce que Nootion sait faire, avec des données inventées. Modifiez-la, cassez-la, puis supprimez-la quand vous voulez : clic droit dessus dans la barre latérale, puis « Mettre à la corbeille ».",
              "This page shows what Nootion can do, with made-up data. Change it, break it, then delete it whenever you like: right-click it in the sidebar, then “Move to trash”.",
            ),
          ),
        ),
        { type: "tableOfContents" },
        h(2, L("Écrire", "Writing")),
        p(
          L("Du texte en ", "Text in "),
          text(L("gras", "bold"), "bold"),
          ", ",
          text(L("italique", "italic"), "italic"),
          ", ",
          text(L("souligné", "underlined"), "underline"),
          ", ",
          text(L("barré", "struck"), "strike"),
          ", ",
          text("code", "code"),
          L(" ou avec un ", " or with a "),
          text(L("lien", "link"), link("https://example.com")),
          L(
            ". Tapez « / » pour insérer un bloc, ou sélectionnez du texte pour le mettre en forme.",
            ". Type “/” to insert a block, or select text to format it.",
          ),
        ),
        p(
          L("On peut citer une date, ", "You can mention a date, "),
          { type: "dateMention", attrs: { id: randomUUID(), date: day(3) } },
          L(", une personne, ", ", a person, "),
          { type: "userMention", attrs: { id: randomUUID(), userId, name: user.name, by: null } },
          L(", ou une page : ", ", or a page: "),
          { type: "pageLink", attrs: { pageId: notesId, title: notesTitle } },
          ".",
        ),
        h(3, L("Listes", "Lists")),
        columns(
          [
            ul(
              li(L("Une liste à puces", "A bulleted list"), ul(li(L("avec des sous-éléments", "with nested items")))),
              li(L("Tab pour décaler", "Tab to indent")),
            ),
          ],
          [ol(li(L("Une liste numérotée", "A numbered list")), li(L("qui se renumérote seule", "that renumbers itself")))],
          [tasks([true, L("Une case cochée", "A checked box")], [false, L("Une tâche à faire", "A task to do")])],
        ),
        { type: "blockquote", content: [p(L("Une citation, pour faire ressortir une idée.", "A quote, to make an idea stand out."))] },
        { type: "horizontalRule" },
        h(2, L("Blocs", "Blocks")),
        callout(
          "💡",
          p(
            L(
              "Un encadré, pour une astuce ou un avertissement. Cliquez sur l'emoji pour le changer.",
              "A callout, for a tip or a warning. Click the emoji to change it.",
            ),
          ),
        ),
        toggle(
          L("Un bloc dépliable : cliquez sur la flèche", "A toggle: click the arrow"),
          p(L("Le contenu caché apparaît ici. Pratique pour une FAQ ou des détails.", "The hidden content shows here. Handy for a FAQ or details.")),
        ),
        table([
          [L("Formule", "Plan"), L("Prix", "Price"), L("Utilisateurs", "Users")],
          [L("Découverte", "Starter"), "0 €", "3"],
          [L("Équipe", "Team"), "8 €", "25"],
          [L("Entreprise", "Business"), "15 €", L("Illimité", "Unlimited")],
        ]),
        {
          type: "codeBlock",
          attrs: { language: "javascript" },
          content: [text('function greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("Nootion"));')],
        },
        columns(
          [
            h(3, L("Colonnes", "Columns")),
            p(
              L(
                "Glissez un bloc à côté d'un autre pour créer des colonnes, avec la poignée ⋮⋮ à gauche des blocs.",
                "Drag a block next to another to make columns, with the ⋮⋮ handle left of the blocks.",
              ),
            ),
          ],
          [{ type: "image", attrs: { src: images[0], alt: "" } }],
        ),
        widget("buttonBlock", {
          id: randomUUID(),
          config: {
            label: L("➕ Nouveau projet", "➕ New project"),
            color: "blue",
            steps: [{ type: "add_row", databaseId: dbId, values: { [title.id]: L("Nouveau projet", "New project") }, open: true }],
            form: null,
          },
        }),
        h(2, L("Bases de données", "Databases")),
        p(
          L(
            "Une base est un tableau dont chaque ligne est une page. La même base s'affiche en tableau, kanban, calendrier, chronologie, galerie ou liste : changez de vue avec les onglets.",
            "A database is a table whose rows are pages. The same database shows as a table, board, calendar, timeline, gallery or list: switch views with the tabs.",
          ),
        ),
        widget("databaseBlock", { pageId: dbId }),
        h(3, L("Calendrier", "Calendar")),
        widget("calendarBlock", { id: randomUUID(), sources: [{ databaseId: dbId, propertyId: when.id, color: "blue" }] }),
        h(2, "Widgets"),
        p(L("Des blocs vivants, pour un tableau de bord ou une page d'accueil.", "Live blocks, for a dashboard or a home page.")),
        columns([widget("clock", { timeZone: "", label: "", seconds: false })], [widget("weather", { city: "Paris", latitude: 48.85341, longitude: 2.3488 })]),
        widget("chart", { databaseId: dbId, viewId: null, kind: "donut", groupBy: status.id, measure: "count" }),
        widget("chart", { databaseId: dbId, viewId: null, kind: "column", groupBy: priority.id, measure: hours.id }),
        columns(
          [widget("progressBar", { mode: "year", label: "", value: 0, goal: 100, databaseId: null, viewId: null, checkbox: null })],
          [
            widget("progressBar", {
              mode: "database",
              label: L("Projets terminés", "Projects done"),
              value: 0,
              goal: 100,
              databaseId: dbId,
              viewId: null,
              checkbox: ok.id,
            }),
          ],
        ),
        columns(
          [widget("countdown", { target: day(30, "09:00"), label: L("Lancement", "Launch") })],
          [widget("pomodoro", { work: 25, rest: 5, longRest: 15, rounds: 4 })],
        ),
        widget("habitTracker", {
          name: L("Lire 20 minutes", "Read 20 minutes"),
          // A believable streak: most days of the last two months, today not yet.
          days: Array.from({ length: 70 }, (_, i) => i + 1)
            .filter((i) => i < 6 || (i * 7) % 10 > 2)
            .map((i) => day(-i))
            .sort(),
          color: "green",
        }),
        widget("databaseRows", { databaseId: dbId, viewId: null, limit: 5 }),
        widget("upcomingEvents", { sources: [{ databaseId: dbId, propertyId: when.id, color: "blue" }], days: 30 }),
        widget("quoteOfDay", { databaseId: null, viewId: null, authorProp: null }),
        widget("imageCarousel", { images, interval: 5, ratio: "16 / 9" }),
        p({ type: "pageLink", attrs: { pageId: notesId, title: notesTitle } }),
        p(),
      ],
    };
    const doc = new Y.Doc();
    setProsemirrorJSON(doc, content);
    const { state, json, text: plain } = encodeContent(doc);
    tx.update(pages).set({ contentState: state, contentJson: json, contentText: plain }).where(eq(pages.id, demoId)).run();
    return demoId;
  });
}
