/** Minimal client of Notion's public API (version 2022-06-28), used by the importer. */

export const NOTION_VERSION = "2022-06-28";

export interface RichText {
  type: "text" | "mention" | "equation";
  plain_text: string;
  href: string | null;
  annotations: { bold: boolean; italic: boolean; strikethrough: boolean; underline: boolean; code: boolean; color: string };
  text?: { content: string; link: { url: string } | null };
  mention?: {
    type: string;
    page?: { id: string };
    database?: { id: string };
    user?: { id: string; name?: string; person?: { email?: string } };
    date?: { start: string; end: string | null };
    link_preview?: { url: string };
  };
  equation?: { expression: string };
}

export type Parent =
  | { type: "workspace"; workspace: true }
  | { type: "page_id"; page_id: string }
  | { type: "database_id"; database_id: string }
  | { type: "block_id"; block_id: string };

export type NotionIcon = { type: "emoji"; emoji: string } | { type: "external"; external: { url: string } } | { type: "file"; file: { url: string } } | null;

export interface NotionPage {
  object: "page";
  id: string;
  parent: Parent;
  created_time: string;
  last_edited_time: string;
  created_by?: { id: string };
  archived?: boolean;
  in_trash?: boolean;
  icon: NotionIcon;
  cover: NotionCover;
  properties: Record<string, NotionPropertyValue>;
  url?: string;
}

export interface NotionDatabase {
  object: "database";
  id: string;
  parent: Parent;
  created_time: string;
  last_edited_time: string;
  archived?: boolean;
  in_trash?: boolean;
  is_inline?: boolean;
  icon: NotionIcon;
  cover?: NotionCover;
  title: RichText[];
  description?: RichText[];
  properties: Record<string, NotionPropertySchema>;
}

export type NotionCover = { type: "external"; external: { url: string } } | { type: "file"; file: { url: string } } | null;

export interface NotionOption {
  id: string;
  name: string;
  color: string;
}

export interface NotionPropertySchema {
  id: string;
  name: string;
  type: string;
  number?: { format: string };
  select?: { options: NotionOption[] };
  multi_select?: { options: NotionOption[] };
  status?: { options: NotionOption[] };
  formula?: { expression: string };
  relation?: { database_id: string; type?: "single_property" | "dual_property"; dual_property?: { synced_property_id: string; synced_property_name: string } };
  rollup?: {
    relation_property_id: string;
    relation_property_name: string;
    rollup_property_id: string;
    rollup_property_name: string;
    function: string;
  };
}

export interface NotionUser {
  object: "user";
  id: string;
  name?: string;
  type?: "person" | "bot";
  person?: { email?: string };
}

export interface NotionFile {
  name: string;
  type: "file" | "external";
  file?: { url: string };
  external?: { url: string };
}

export interface NotionPropertyValue {
  id: string;
  type: string;
  title?: RichText[];
  rich_text?: RichText[];
  number?: number | null;
  select?: NotionOption | null;
  status?: NotionOption | null;
  multi_select?: NotionOption[];
  date?: { start: string; end: string | null } | null;
  checkbox?: boolean;
  url?: string | null;
  email?: string | null;
  phone_number?: string | null;
  people?: NotionUser[];
  files?: NotionFile[];
  relation?: { id: string }[];
  has_more?: boolean;
  formula?: {
    type: "string" | "number" | "boolean" | "date";
    string?: string | null;
    number?: number | null;
    boolean?: boolean | null;
    date?: { start: string; end: string | null } | null;
  };
  rollup?: unknown;
  unique_id?: { prefix: string | null; number: number | null };
  created_time?: string;
  last_edited_time?: string;
  created_by?: NotionUser;
  last_edited_by?: NotionUser;
}

export interface NotionBlock {
  object: "block";
  id: string;
  type: string;
  has_children: boolean;
  archived?: boolean;
  in_trash?: boolean;
  [type: string]: unknown;
}

interface ListResponse<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export class NotionError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NotionClient {
  /** Requests sent, for the progress shown to the user. */
  requests = 0;

  constructor(
    private token: string,
    private baseUrl = "https://api.notion.com",
    private opts: { minInterval?: number; retryDelay?: number } = {},
  ) {}

  private last = 0;

  /** One request, spaced to stay under Notion's limit (about 3 per second), retried when Notion asks to wait. */
  async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + (this.opts.minInterval ?? 340) - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      this.requests++;
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/v1${path}`, {
          method,
          headers: { authorization: `Bearer ${this.token}`, "notion-version": NOTION_VERSION, ...(body ? { "content-type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if (attempt < 4) {
          await sleep((this.opts.retryDelay ?? 1000) * 2 ** attempt);
          continue;
        }
        throw new NotionError(0, "network", e instanceof Error ? e.message : String(e));
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 6) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(after > 0 ? after * 1000 : (this.opts.retryDelay ?? 1000) * 2 ** attempt);
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      if (!res.ok) throw new NotionError(res.status, data.code ?? "error", data.message ?? `HTTP ${res.status}`);
      return data as T;
    }
  }

  /** Every result of a paginated list. */
  private async all<T>(method: "GET" | "POST", path: string, body: Record<string, unknown> = {}): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    do {
      const page: ListResponse<T> =
        method === "GET"
          ? await this.request("GET", `${path}${path.includes("?") ? "&" : "?"}page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`)
          : await this.request("POST", path, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      out.push(...page.results);
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
    return out;
  }

  me() {
    return this.request<NotionUser & { bot?: { workspace_name?: string } }>("GET", "/users/me");
  }

  /** Every page and database shared with the integration. */
  search() {
    return this.all<NotionPage | NotionDatabase>("POST", "/search");
  }

  database(id: string) {
    return this.request<NotionDatabase>("GET", `/databases/${id}`);
  }

  queryDatabase(id: string) {
    return this.all<NotionPage>("POST", `/databases/${id}/query`);
  }

  blockChildren(id: string) {
    return this.all<NotionBlock>("GET", `/blocks/${id}/children`);
  }

  block(id: string) {
    return this.request<NotionBlock & { parent: Parent }>("GET", `/blocks/${id}`);
  }

  /** Every item of a page property; needed when a relation has more than 25 entries. */
  propertyItems(pageId: string, propertyId: string) {
    return this.all<{ relation?: { id: string } }>("GET", `/pages/${pageId}/properties/${encodeURIComponent(propertyId)}`);
  }

  users() {
    return this.all<NotionUser>("GET", "/users");
  }

  /** Downloads a file (Notion's own file addresses expire after an hour). */
  async download(url: string, maxBytes: number): Promise<{ data: Buffer; type: string } | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok || !res.body) return null;
      const length = Number(res.headers.get("content-length"));
      if (length > maxBytes) return null;
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > maxBytes) return null;
      return { data, type: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim() };
    } catch {
      return null;
    }
  }
}
