import type { ProseMirrorNode } from "../collab.js";
import type { NotionBlock, NotionFile, RichText } from "./api.js";

/** A Notion block with its children already loaded. */
export type BlockTree = NotionBlock & { children?: BlockTree[] };

export interface ConvertContext {
  /** The Nootion page an imported Notion page or database became, or null when it isn't part of the import. */
  pageFor: (notionId: string) => { id: string; title: string; inline?: boolean } | null;
  /** Stores a file hosted by Notion as an attachment of the page being converted; null when it couldn't be downloaded. */
  saveFile: (url: string, name: string) => Promise<{ url: string; name: string; size: number; mimeType: string } | null>;
  /** Notes what couldn't be imported as it was, for the import report. */
  note: (what: string) => void;
}

type Mark = { type: string; attrs?: Record<string, unknown> };

const text = (s: string, marks: Mark[] = []): ProseMirrorNode => (marks.length ? { type: "text", text: s, marks } : { type: "text", text: s });
const paragraph = (content: ProseMirrorNode[] = []): ProseMirrorNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });

/** Notion's rich text as inline nodes: marks, links, and mentions of pages turned into links to the imported pages. */
export function richText(items: RichText[] | undefined, ctx: Pick<ConvertContext, "pageFor" | "note">): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const a = item.annotations ?? { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
    const marks: Mark[] = [];
    if (a.bold) marks.push({ type: "bold" });
    if (a.italic) marks.push({ type: "italic" });
    if (a.strikethrough) marks.push({ type: "strike" });
    if (a.underline) marks.push({ type: "underline" });
    if (a.code) marks.push({ type: "code" });
    const href = item.type === "text" ? item.text?.link?.url : item.href;
    if (item.type === "mention" && (item.mention?.type === "page" || item.mention?.type === "database")) {
      const id = item.mention.page?.id ?? item.mention.database?.id ?? "";
      const target = ctx.pageFor(id);
      if (target) {
        out.push({ type: "pageLink", attrs: { pageId: target.id, title: target.title || item.plain_text } });
        continue;
      }
    }
    if (item.type === "equation") ctx.note("equation");
    // Notion's own links to its pages point to the imported page.
    const internal = href && /^\/[0-9a-f]{32}(\?|#|$)/.test(href) ? ctx.pageFor(href.slice(1, 33)) : null;
    if (internal) {
      out.push({ type: "pageLink", attrs: { pageId: internal.id, title: internal.title || item.plain_text } });
      continue;
    }
    if (href && /^(https?:|mailto:)/i.test(href))
      marks.push({ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow", class: null } });
    // Line breaks inside a block become hard breaks.
    item.plain_text.split("\n").forEach((part, i) => {
      if (i > 0) out.push({ type: "hardBreak" });
      if (part) out.push(text(part, marks));
    });
  }
  return out;
}

/** Plain text of rich text (database cells, titles). */
export const plainText = (items: RichText[] | undefined) => (Array.isArray(items) ? items.map((i) => i.plain_text ?? "").join("") : "");

const fileUrl = (f: NotionFile | undefined) => (f?.type === "file" ? f.file?.url : f?.external?.url) ?? "";

/** Name of a file from its address, without Notion's query string. */
export function fileName(url: string, fallback = "file"): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return name || fallback;
  } catch {
    return fallback;
  }
}

/** Converts a page's blocks to the editor's document. */
export async function blocksToDoc(blocks: BlockTree[], ctx: ConvertContext): Promise<ProseMirrorNode> {
  const content = await convertBlocks(blocks, ctx);
  return { type: "doc", content: content.length ? content : [paragraph()] };
}

async function convertBlocks(blocks: BlockTree[], ctx: ConvertContext): Promise<ProseMirrorNode[]> {
  const out: ProseMirrorNode[] = [];
  for (const block of blocks) {
    if (block.archived || block.in_trash) continue;
    const nodes = await convertBlock(block, ctx);
    for (const node of nodes) {
      // Consecutive list items of the same kind make one list.
      const last = out[out.length - 1];
      if (last && LISTS.has(node.type) && last.type === node.type) last.content!.push(...node.content!);
      else out.push(node);
    }
  }
  return out;
}

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

async function convertBlock(block: BlockTree, ctx: ConvertContext): Promise<ProseMirrorNode[]> {
  const data = (block[block.type] ?? {}) as { rich_text?: RichText[]; color?: string; [key: string]: unknown };
  const inline = () => richText(data.rich_text, ctx);
  const children = () => convertBlocks(block.children ?? [], ctx);

  switch (block.type) {
    case "paragraph": {
      const nested = await children();
      // Indented paragraphs: Nootion has no indentation, the children follow the paragraph.
      return [paragraph(inline()), ...nested];
    }
    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = Number(block.type.slice(-1));
      const heading: ProseMirrorNode = { type: "heading", attrs: { level }, ...(inline().length ? { content: inline() } : {}) };
      // Toggle headings show their content below them.
      if (data.is_toggleable) ctx.note("toggle");
      return [heading, ...(await children())];
    }
    case "bulleted_list_item":
    case "numbered_list_item": {
      const item: ProseMirrorNode = { type: "listItem", content: [paragraph(inline()), ...(await children())] };
      return [{ type: block.type === "bulleted_list_item" ? "bulletList" : "orderedList", content: [item] }];
    }
    case "to_do": {
      const item: ProseMirrorNode = { type: "taskItem", attrs: { checked: !!data.checked }, content: [paragraph(inline()), ...(await children())] };
      return [{ type: "taskList", content: [item] }];
    }
    case "toggle": {
      // No toggles in Nootion: the summary in bold, then the content in a quote.
      ctx.note("toggle");
      const summary = inline().map((n) => (n.type === "text" ? { ...n, marks: [...(n.marks ?? []), { type: "bold" }] } : n));
      const nested = await children();
      return [paragraph([text("▸ "), ...summary]), ...(nested.length ? [{ type: "blockquote", content: nested }] : [])];
    }
    case "quote": {
      return [{ type: "blockquote", content: [paragraph(inline()), ...(await children())] }];
    }
    case "callout": {
      const icon = data.icon as { type: string; emoji?: string } | null;
      const nested = await children();
      // A callout holds paragraphs only: other blocks follow it.
      const paragraphs = nested.filter((n) => n.type === "paragraph");
      const rest = nested.filter((n) => n.type !== "paragraph");
      return [{ type: "callout", attrs: { emoji: icon?.type === "emoji" ? icon.emoji : "💡" }, content: [paragraph(inline()), ...paragraphs] }, ...rest];
    }
    case "code": {
      const code = plainText(data.rich_text);
      const language = typeof data.language === "string" && data.language !== "plain text" ? data.language : null;
      return [{ type: "codeBlock", attrs: { language }, ...(code ? { content: [text(code)] } : {}) }];
    }
    case "equation": {
      ctx.note("equation");
      return [{ type: "codeBlock", attrs: { language: "latex" }, content: [text(String(data.expression ?? ""))] }];
    }
    case "divider":
      return [{ type: "horizontalRule" }];
    case "image": {
      const file = data as unknown as NotionFile & { caption?: RichText[] };
      const url = fileUrl(file);
      const caption = plainText(file.caption);
      if (file.type === "file") {
        const saved = await ctx.saveFile(url, fileName(url, "image"));
        if (!saved) {
          ctx.note("fileMissing");
          return [];
        }
        return [{ type: "image", attrs: { src: saved.url, alt: caption || null } }];
      }
      return url ? [{ type: "image", attrs: { src: url, alt: caption || null } }] : [];
    }
    case "file":
    case "pdf":
    case "video":
    case "audio": {
      const file = data as unknown as NotionFile & { name?: string; caption?: RichText[] };
      const url = fileUrl(file);
      if (file.type === "file") {
        const saved = await ctx.saveFile(url, file.name || fileName(url));
        if (!saved) {
          ctx.note("fileMissing");
          return [];
        }
        return [{ type: "fileAttachment", attrs: saved }];
      }
      // Files hosted elsewhere (YouTube…) stay links.
      return url
        ? [
            paragraph([
              text(file.name || plainText(file.caption) || url, [
                { type: "link", attrs: { href: url, target: "_blank", rel: "noopener noreferrer nofollow", class: null } },
              ]),
            ]),
          ]
        : [];
    }
    case "bookmark":
    case "embed":
    case "link_preview": {
      const url = String(data.url ?? "");
      if (!url) return [];
      const caption = plainText(data.caption as RichText[] | undefined);
      return [paragraph([text(caption || url, [{ type: "link", attrs: { href: url, target: "_blank", rel: "noopener noreferrer nofollow", class: null } }])])];
    }
    case "table": {
      const hasHeader = !!data.has_column_header;
      const rows = (block.children ?? []).filter((r) => r.type === "table_row");
      if (!rows.length) return [];
      if (data.has_row_header) ctx.note("tableRowHeader");
      return [
        {
          type: "table",
          content: rows.map((row, i) => ({
            type: "tableRow",
            content: ((row.table_row as { cells: RichText[][] }).cells ?? []).map((cell) => ({
              type: hasHeader && i === 0 ? "tableHeader" : "tableCell",
              content: [paragraph(richText(cell, ctx))],
            })),
          })),
        },
      ];
    }
    case "child_page":
    case "link_to_page": {
      const id = block.type === "child_page" ? block.id : String((data.page_id ?? data.database_id) || "");
      const target = ctx.pageFor(id);
      if (!target) {
        ctx.note("pageNotShared");
        return block.type === "child_page" ? [paragraph([text(String(data.title ?? ""))])] : [];
      }
      return [paragraph([{ type: "pageLink", attrs: { pageId: target.id, title: target.title } }])];
    }
    case "child_database": {
      const target = ctx.pageFor(block.id);
      if (!target) {
        ctx.note("pageNotShared");
        return [];
      }
      // Inline databases show in the page; full-page ones are linked.
      return target.inline === false
        ? [paragraph([{ type: "pageLink", attrs: { pageId: target.id, title: target.title } }])]
        : [{ type: "databaseBlock", attrs: { pageId: target.id } }];
    }
    case "column_list":
    case "column":
    case "synced_block":
    case "template":
      // Columns are put one after the other; synced blocks keep their content.
      if (block.type === "column_list") ctx.note("columns");
      return children();
    case "table_of_contents":
    case "breadcrumb":
      ctx.note(block.type);
      return [];
    default:
      ctx.note("unsupported");
      return [];
  }
}
