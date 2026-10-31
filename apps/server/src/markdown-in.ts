import { randomUUID } from "node:crypto";
import type { ProseMirrorNode } from "./collab.js";

type Mark = { type: string; attrs?: Record<string, unknown> };

/** Addresses a link, an image or a file may point to: the web, email, and the server's own files. */
const SAFE_URL = /^(https?:\/\/|mailto:|\/api\/attachments\/)/i;

const text = (value: string, marks: Mark[]): ProseMirrorNode => (marks.length ? { type: "text", text: value, marks } : { type: "text", text: value });

/** Inline Markdown: **bold**, *italic*, ~~strike~~, `code`, [links](https://…), and line breaks. */
export function parseInline(src: string, marks: Mark[] = []): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push(text(plain, marks));
    plain = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if (rest[0] === "\\" && rest.length > 1 && /[\\`*_~[\]()#>!|-]/.test(rest[1]!)) {
      plain += rest[1];
      i += 2;
    } else if ((m = rest.match(/^`([^`]+)`/))) {
      flush();
      out.push(text(m[1]!, [...marks, { type: "code" }]));
      i += m[0].length;
    } else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush();
      const href = m[2]!;
      out.push(
        ...parseInline(
          m[1]!,
          SAFE_URL.test(href) ? [...marks, { type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow", class: null } }] : marks,
        ),
      );
      i += m[0].length;
    } else if ((m = rest.match(/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/))) {
      flush();
      out.push(...parseInline(m[2]!, [...marks, { type: "bold" }]));
      i += m[0].length;
    } else if ((m = rest.match(/^~~(?=\S)([\s\S]*?\S)~~/))) {
      flush();
      out.push(...parseInline(m[1]!, [...marks, { type: "strike" }]));
      i += m[0].length;
    } else if ((m = rest.match(/^(\*|_)(?=\S)([\s\S]*?\S)\1(?![*_])/)) && (m[1] === "*" || !/\w/.test(src[i - 1] ?? ""))) {
      flush();
      out.push(...parseInline(m[2]!, [...marks, { type: "italic" }]));
      i += m[0].length;
    } else if (rest.startsWith("\n")) {
      flush();
      out.push({ type: "hardBreak" });
      i += 1;
    } else {
      plain += rest[0];
      i += 1;
    }
  }
  flush();
  return out;
}

const paragraph = (src: string): ProseMirrorNode => {
  const content = parseInline(src.trim());
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** Blocks of Markdown: headings, paragraphs, lists and to-do lists, quotes, code, tables, images, dividers. */
export function parseMarkdown(markdown: string): ProseMirrorNode {
  return { type: "doc", content: parseBlocks(markdown.replace(/\r\n?/g, "\n").split("\n")) };
}

function parseBlocks(lines: string[]): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      i++;
    } else if ((m = line.match(/^\s*(```|~~~)\s*([\w+#-]*)\s*$/))) {
      const fence = m[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence)) body.push(lines[i++]!);
      i++;
      const code = body.join("\n");
      out.push({ type: "codeBlock", attrs: { language: m[2] || null }, ...(code ? { content: [{ type: "text", text: code }] } : {}) });
    } else if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const content = parseInline(m[2]!);
      out.push({ type: "heading", attrs: { level: Math.min(3, m[1]!.length) }, ...(content.length ? { content } : {}) });
      i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ type: "horizontalRule" });
      i++;
    } else if ((m = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/)) && SAFE_URL.test(m[2]!)) {
      out.push({ type: "image", attrs: { src: m[2], alt: m[1] || null } });
      i++;
    } else if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*> ?/, ""));
      const content = parseBlocks(body);
      out.push({ type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] });
    } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map((c) => c.trim().replace(/\\\|/g, "|"));
      const header = cells(line);
      const rows = [header];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      out.push({
        type: "table",
        content: rows.map((r, ri) => ({
          type: "tableRow",
          content: header.map((_, ci) => ({
            type: ri === 0 ? "tableHeader" : "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [paragraph(r[ci] ?? "")],
          })),
        })),
      });
    } else if ((m = line.match(LIST_ITEM))) {
      const { node, next } = parseList(lines, i, m[1]!.length);
      out.push(node);
      i = next;
    } else {
      // A line no other block took (an image with a refused address, a lone "|") is text.
      const body: string[] = [lines[i++]!.trimStart()];
      while (i < lines.length && lines[i]!.trim() && !/^(\s*(```|~~~|#{1,6}\s|>|\|)|\s*!\[)/.test(lines[i]!) && !LIST_ITEM.test(lines[i]!))
        body.push(lines[i++]!.trimStart());
      // Two spaces or a backslash at the end of a line: a line break; otherwise lines join with a space.
      out.push(
        paragraph(body.map((l, k) => (k === body.length - 1 ? l : /( {2,}|\\)$/.test(l) ? l.replace(/( {2,}|\\)$/, "\n") : `${l.trimEnd()} `)).join("")),
      );
    }
  }
  return out;
}

/** A list starting at line `start`, with its nested lists: bullets, numbers or to-dos ("- [ ]", "- [x]"). */
function parseList(lines: string[], start: number, indent: number): { node: ProseMirrorNode; next: number } {
  const first = lines[start]!.match(LIST_ITEM)!;
  const ordered = /\d/.test(first[2]!);
  const task = /^\[[ xX]\]\s/.test(first[3]!);
  const items: ProseMirrorNode[] = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i]!.match(LIST_ITEM);
    if (!m || m[1]!.length !== indent || /\d/.test(m[2]!) !== ordered) break;
    let body = m[3]!;
    const checked = task ? /^\[[xX]\]/.test(body) : false;
    if (task) {
      if (!/^\[[ xX]\]\s/.test(body)) break;
      body = body.slice(4);
    }
    const content: ProseMirrorNode[] = [paragraph(body)];
    i++;
    // Lines indented under the item: more text, or a nested list.
    while (i < lines.length) {
      const l = lines[i]!;
      const nested = l.match(LIST_ITEM);
      if (nested && nested[1]!.length > indent) {
        const sub = parseList(lines, i, nested[1]!.length);
        content.push(sub.node);
        i = sub.next;
      } else if (l.trim() && !nested && /^\s+/.test(l) && l.match(/^\s*/)![0].length > indent) {
        content.push(paragraph(l));
        i++;
      } else break;
    }
    items.push({ type: task ? "taskItem" : "listItem", ...(task ? { attrs: { checked } } : {}), content });
  }
  return {
    node: {
      type: task ? "taskList" : ordered ? "orderedList" : "bulletList",
      ...(ordered ? { attrs: { start: Number.parseInt(first[2]!, 10) || 1, type: null } } : {}),
      content: items,
    },
    next: i,
  };
}

// Blocks and marks of the editor; content sent through the API may only use these.
const NODES = new Set([
  "doc", "paragraph", "text", "hardBreak", "heading", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "blockquote",
  "codeBlock", "horizontalRule", "table", "tableRow", "tableHeader", "tableCell", "image", "callout", "details", "detailsSummary",
  "detailsContent", "columns", "column", "fileAttachment", "pageLink", "dateMention", "userMention", "databaseBlock", "calendarBlock", "tableOfContents",
  "recentPages", "favoritesList", "upcomingEvents", "databaseRows", "buttonBlock", "chart", "progressBar", "countdown", "pomodoro",
  "habitTracker", "clock", "weather", "quoteOfDay", "imageCarousel",
]);
const MARKS = new Set(["bold", "italic", "strike", "underline", "code", "link"]);

export class ContentError extends Error {}

/**
 * Checks ProseMirror JSON sent through the API: known blocks and marks only, safe addresses, at most `maxNodes` nodes.
 * Dates keep a reminder only when it is the sender's own; others get new ids.
 */
export function checkContent(json: unknown, userId: string, maxNodes = 20_000): ProseMirrorNode {
  let count = 0;
  const walk = (value: unknown, depth: number): ProseMirrorNode => {
    if (++count > maxNodes || depth > 50) throw new ContentError("too large");
    if (!value || typeof value !== "object") throw new ContentError("not a node");
    const n = value as ProseMirrorNode;
    if (typeof n.type !== "string" || !(NODES.has(n.type) || /^plugin_[\w-]+__[\w-]+$/.test(n.type)))
      throw new ContentError(`unknown block "${String(n.type)}"`);
    if (n.type === "text") {
      if (typeof n.text !== "string" || !n.text) throw new ContentError("empty text");
      const marks = (Array.isArray(n.marks) ? n.marks : []).filter(
        (m) => MARKS.has(m?.type) && (m.type !== "link" || SAFE_URL.test(String(m.attrs?.href ?? ""))),
      );
      return marks.length
        ? { type: "text", text: n.text, marks: marks.map((m) => ({ type: m.type, ...(m.attrs ? { attrs: { ...m.attrs } } : {}) })) }
        : { type: "text", text: n.text };
    }
    let attrs = n.attrs && typeof n.attrs === "object" ? { ...n.attrs } : undefined;
    if (attrs) {
      for (const key of ["src", "url", "href"]) if (key in attrs && attrs[key] !== null && !SAFE_URL.test(String(attrs[key]))) attrs[key] = null;
      // A mention sent through the API is the sender's.
      if (n.type === "userMention") attrs = { ...attrs, id: typeof attrs.id === "string" && attrs.id ? attrs.id : randomUUID(), by: userId };
      if (n.type === "dateMention") {
        attrs.id = randomUUID();
        if (attrs.remindUser !== userId) attrs = { ...attrs, reminder: null, remindAt: null, remindUser: null };
      }
    }
    const content = Array.isArray(n.content) ? n.content.map((c) => walk(c, depth + 1)) : undefined;
    return { type: n.type, ...(attrs ? { attrs } : {}), ...(content?.length ? { content } : {}) };
  };
  const doc = walk(json, 0);
  if (doc.type !== "doc") throw new ContentError("the content must be a doc");
  return doc;
}
