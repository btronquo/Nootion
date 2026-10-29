import http from "node:http";
import type { AddressInfo } from "node:net";

/** A small stand-in for Notion's API, serving a fixed workspace. */

const rt = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  plain_text: text,
  href: null,
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
  text: { content: text, link: null },
  ...extra,
});
const bold = (text: string) => ({ ...rt(text), annotations: { ...rt(text).annotations, bold: true } });
const block = (id: string, type: string, data: Record<string, unknown>, children?: unknown[]) => ({
  object: "block",
  id,
  type,
  has_children: !!children?.length,
  [type]: data,
  _children: children ?? [],
});

export const IDS = {
  home: "11111111-1111-1111-1111-111111111111",
  notes: "22222222-2222-2222-2222-222222222222",
  tasks: "33333333-3333-3333-3333-333333333333",
  projects: "44444444-4444-4444-4444-444444444444",
  task1: "55555555-5555-5555-5555-555555555551",
  task2: "55555555-5555-5555-5555-555555555552",
  house: "66666666-6666-6666-6666-666666666666",
  ada: "77777777-7777-7777-7777-777777777777",
  wiki: "88888888-8888-8888-8888-888888888888",
};

const titleProp = (text: string) => ({ id: "title", type: "title", title: [rt(text)] });

export function fakeNotion() {
  let notesEdited = "2024-01-02T10:00:00.000Z";
  let notesText = "First notes.";
  let breakContent = false;
  const page = (id: string, parent: unknown, title: string, edited: string, icon: unknown = null) => ({
    object: "page",
    id,
    parent,
    created_time: "2024-01-01T09:00:00.000Z",
    last_edited_time: edited,
    created_by: { id: IDS.ada },
    icon,
    cover: null,
    archived: false,
    properties: { title: titleProp(title) },
  });

  const tasksSchema = {
    Name: { id: "title", name: "Name", type: "title", title: {} },
    Status: {
      id: "st",
      name: "Status",
      type: "status",
      status: {
        options: [
          { id: "s1", name: "To do", color: "gray" },
          { id: "s2", name: "Doing", color: "blue" },
        ],
      },
    },
    Tags: {
      id: "tg",
      name: "Tags",
      type: "multi_select",
      multi_select: {
        options: [
          { id: "t1", name: "paint", color: "default" },
          { id: "t2", name: "urgent", color: "red" },
        ],
      },
    },
    Due: { id: "du", name: "Due", type: "date", date: {} },
    Done: { id: "dn", name: "Done", type: "checkbox", checkbox: {} },
    Price: { id: "pr", name: "Price", type: "number", number: { format: "euro" } },
    Progress: { id: "pg", name: "Progress", type: "number", number: { format: "percent" } },
    Assignee: { id: "as", name: "Assignee", type: "people", people: {} },
    Project: {
      id: "pj",
      name: "Project",
      type: "relation",
      relation: { database_id: IDS.projects, type: "dual_property", dual_property: { synced_property_id: "tk", synced_property_name: "Tasks" } },
    },
    Double: {
      id: "db",
      name: "Double",
      type: "formula",
      formula: { expression: "{{notion:block_property:pr:00000000-0000-0000-0000-000000000000:aaaa}} * 2" },
    },
    Label: { id: "lb", name: "Label", type: "formula", formula: { expression: 'prop("Name").upper()' } },
    Weird: { id: "wd", name: "Weird", type: "formula", formula: { expression: 'prop("Tags").map(current.name).join(",")' } },
    Link: { id: "ln", name: "Link", type: "url", url: {} },
    Created: { id: "cr", name: "Created", type: "created_time", created_time: {} },
    Button: { id: "bt", name: "Button", type: "button", button: {} },
  };
  const projectsSchema = {
    Name: { id: "title", name: "Name", type: "title", title: {} },
    Tasks: {
      id: "tk",
      name: "Tasks",
      type: "relation",
      relation: { database_id: IDS.tasks, type: "dual_property", dual_property: { synced_property_id: "pj", synced_property_name: "Project" } },
    },
    Total: {
      id: "to",
      name: "Total",
      type: "rollup",
      rollup: { relation_property_id: "tk", relation_property_name: "Tasks", rollup_property_id: "pr", rollup_property_name: "Price", function: "sum" },
    },
  };
  const database = (id: string, parent: unknown, title: string, properties: unknown, inline: boolean) => ({
    object: "database",
    id,
    parent,
    created_time: "2024-01-01T09:00:00.000Z",
    last_edited_time: "2024-01-02T09:00:00.000Z",
    icon: { type: "emoji", emoji: "✅" },
    title: [rt(title)],
    is_inline: inline,
    archived: false,
    properties,
  });
  const row = (id: string, dbId: string, properties: Record<string, unknown>) => ({
    object: "page",
    id,
    parent: { type: "database_id", database_id: dbId },
    created_time: "2024-01-03T09:00:00.000Z",
    last_edited_time: "2024-01-03T10:00:00.000Z",
    created_by: { id: IDS.ada },
    icon: null,
    cover: null,
    archived: false,
    properties,
  });
  const tasksRows = () => [
    row(IDS.task1, IDS.tasks, {
      Name: { id: "title", type: "title", title: [rt("Buy paint")] },
      Status: { id: "st", type: "status", status: { id: "s2", name: "Doing", color: "blue" } },
      Tags: {
        id: "tg",
        type: "multi_select",
        multi_select: [
          { id: "t1", name: "paint", color: "default" },
          { id: "t2", name: "urgent", color: "red" },
        ],
      },
      Due: { id: "du", type: "date", date: { start: "2024-02-01", end: null } },
      Done: { id: "dn", type: "checkbox", checkbox: false },
      Price: { id: "pr", type: "number", number: 120 },
      Progress: { id: "pg", type: "number", number: 0.5 },
      Assignee: { id: "as", type: "people", people: [{ object: "user", id: IDS.ada, name: "Ada", person: { email: "boris@example.com" } }] },
      Project: { id: "pj", type: "relation", relation: [{ id: IDS.house }], has_more: false },
      Double: { id: "db", type: "formula", formula: { type: "number", number: 240 } },
      Label: { id: "lb", type: "formula", formula: { type: "string", string: "BUY PAINT" } },
      Weird: { id: "wd", type: "formula", formula: { type: "string", string: "paint,urgent" } },
      Link: { id: "ln", type: "url", url: "https://example.org" },
      Created: { id: "cr", type: "created_time", created_time: "2024-01-03T09:00:00.000Z" },
    }),
    row(IDS.task2, IDS.tasks, {
      Name: { id: "title", type: "title", title: [rt("Call plumber")] },
      Done: { id: "dn", type: "checkbox", checkbox: true },
      Price: { id: "pr", type: "number", number: 80 },
      // More than 25 related rows: Notion sends them on their own.
      Project: { id: "pj", type: "relation", relation: [], has_more: true },
    }),
  ];
  const projectRows = () => [
    row(IDS.house, IDS.projects, {
      Name: { id: "title", type: "title", title: [rt("House")] },
      Tasks: { id: "tk", type: "relation", relation: [{ id: IDS.task1 }, { id: IDS.task2 }], has_more: false },
    }),
  ];

  // A database inside the Tasks database (as in Notion's wikis): listed by its query too.
  const wiki = () =>
    database(IDS.wiki, { type: "database_id", database_id: IDS.tasks }, "Glossary", { Term: { id: "title", name: "Term", type: "title", title: {} } }, false);

  let base = "";
  const homeBlocks = () => [
    block("b1", "heading_1", { rich_text: [rt("Welcome")] }),
    block("b2", "paragraph", {
      rich_text: [
        rt("See "),
        bold("my notes"),
        rt(" and "),
        { type: "mention", plain_text: "Notes", href: null, annotations: rt("").annotations, mention: { type: "page", page: { id: IDS.notes } } },
        rt(" or "),
        { ...rt("the site"), href: "https://example.org", text: { content: "the site", link: { url: "https://example.org" } } },
      ],
    }),
    block("b3", "bulleted_list_item", { rich_text: [rt("one")] }, [block("b3a", "bulleted_list_item", { rich_text: [rt("one.a")] })]),
    block("b4", "bulleted_list_item", { rich_text: [rt("two")] }),
    block("b5", "to_do", { rich_text: [rt("done task")], checked: true }),
    block("b6", "toggle", { rich_text: [rt("More")] }, [block("b6a", "paragraph", { rich_text: [rt("Hidden text")] })]),
    block("b7", "callout", { rich_text: [rt("Careful")], icon: { type: "emoji", emoji: "⚠️" } }),
    block("b8", "code", { rich_text: [rt("let x = 1;")], language: "javascript" }),
    block("b9", "quote", { rich_text: [rt("Quoted")] }),
    block("b10", "divider", {}),
    block("b11", "image", { type: "file", file: { url: `${base}/files/pic.png?X-Amz=1` }, caption: [rt("A picture")] }),
    block("b12", "table", { table_width: 2, has_column_header: true, has_row_header: false }, [
      block("r1", "table_row", { cells: [[rt("A")], [rt("B")]] }),
      block("r2", "table_row", { cells: [[rt("1")], [rt("2")]] }),
    ]),
    { ...block(IDS.notes, "child_page", { title: "Notes" }), has_children: true },
    { ...block(IDS.tasks, "child_database", { title: "Tasks" }), has_children: true },
    block("b13", "column_list", {}, [
      block("c1", "column", {}, [block("c1p", "paragraph", { rich_text: [rt("Left")] })]),
      block("c2", "column", {}, [block("c2p", "paragraph", { rich_text: [rt("Right")] })]),
    ]),
    block("b14", "table_of_contents", {}),
    block("b15", "file", { type: "external", external: { url: "https://example.org/doc.pdf" }, name: "doc.pdf" }),
  ];
  const blocksOf = (id: string): ReturnType<typeof block>[] => {
    if (id === IDS.home) return homeBlocks();
    if (id === IDS.notes) return [block("n1", "paragraph", { rich_text: [rt(notesText)] })];
    if (id === IDS.task1) return [block("t1p", "paragraph", { rich_text: [rt("Two coats.")] })];
    const all = (list: ReturnType<typeof block>[]): ReturnType<typeof block>[] => list.flatMap((b) => [b, ...all(b._children as ReturnType<typeof block>[])]);
    return (all(homeBlocks()).find((b) => b.id === id)?._children as ReturnType<typeof block>[]) ?? [];
  };
  const strip = (b: ReturnType<typeof block>) => {
    const { _children: _, ...rest } = b;
    return rest;
  };
  const list = (results: unknown[], cursor: string | null) => {
    const start = cursor ? Number(cursor) : 0;
    // Two results per page, to go through pagination.
    const slice = results.slice(start, start + 2);
    return { object: "list", results: slice, has_more: start + 2 < results.length, next_cursor: start + 2 < results.length ? String(start + 2) : null };
  };

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const url = new URL(req.url!, "http://x");
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === "/files/pic.png") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
    if (req.headers.authorization !== "Bearer secret_good_token") return send(401, { code: "unauthorized", message: "API token is invalid." });
    const p = url.pathname;
    const cursor = body.start_cursor ?? url.searchParams.get("start_cursor");
    if (p === "/v1/users/me") return send(200, { object: "user", id: "bot", type: "bot", bot: {} });
    if (p === "/v1/users")
      return send(200, list([{ object: "user", id: IDS.ada, name: "Ada", type: "person", person: { email: "boris@example.com" } }], cursor));
    if (p === "/v1/search") {
      return send(
        200,
        list(
          [
            page(IDS.home, { type: "workspace", workspace: true }, "Home", "2024-01-02T09:00:00.000Z", { type: "emoji", emoji: "🏠" }),
            page(IDS.notes, { type: "page_id", page_id: IDS.home }, "Notes", notesEdited, { type: "external", external: { url: "https://x/i.png" } }),
            database(IDS.tasks, { type: "page_id", page_id: IDS.home }, "Tasks", tasksSchema, true),
            database(IDS.projects, { type: "workspace", workspace: true }, "Projects", projectsSchema, false),
            wiki(),
            ...tasksRows(),
          ],
          cursor,
        ),
      );
    }
    let m = /^\/v1\/databases\/([^/]+)\/query$/.exec(p);
    if (m) return send(200, list(m[1] === IDS.tasks ? [...tasksRows(), wiki()] : m[1] === IDS.wiki ? [] : projectRows(), cursor));
    m = /^\/v1\/blocks\/([^/]+)\/children$/.exec(p);
    if (m && breakContent) return send(400, { code: "validation_error", message: "Broken on purpose." });
    if (m) return send(200, list(blocksOf(m[1]!).map(strip), cursor));
    m = /^\/v1\/pages\/([^/]+)\/properties\/([^/]+)$/.exec(p);
    if (m) return send(200, list([{ object: "property_item", type: "relation", relation: { id: IDS.house } }], cursor));
    send(404, { code: "object_not_found", message: `Not found: ${p}` });
  });

  return {
    async start() {
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return base;
    },
    stop: () => new Promise<void>((r) => server.close(() => r())),
    /** Page contents fail to load, which stops an import halfway. */
    breakContent(broken: boolean) {
      breakContent = broken;
    },
    editNotes(text: string) {
      notesText = text;
      notesEdited = "2024-02-01T10:00:00.000Z";
    },
  };
}
