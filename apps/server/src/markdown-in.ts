import { randomUUID } from "node:crypto";
import type { ProseMirrorNode } from "./collab.js";
import { OPTION_COLORS } from "@nootion/shared";

type Mark = { type: string; attrs?: Record<string, unknown> };

/** Addresses a link, an image or a file may point to: the web, email, and the server's own files. */
const SAFE_URL = /^(https?:\/\/|mailto:|\/api\/attachments\/)/i;

const text = (value: string, marks: Mark[]): ProseMirrorNode => (marks.length ? { type: "text", text: value, marks } : { type: "text", text: value });

/** A file of an import, once copied to the server. */
export interface ImportedFile {
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

/**
 * Links between the files of an import: relative paths ("Other page.md", "images/a.png") and wiki links ("[[Other page]]").
 * Each returns null for a target outside the import (the importer notes it).
 */
export interface MarkdownLinks {
  page(target: string, wiki: boolean): { id: string; title: string } | null;
  file(target: string, wiki: boolean): ImportedFile | null;
}

/**
 * Markdown written by other tools, read by the import from files: wiki links and embeds ("[[Page]]", "![[image.png]]"),
 * callouts ("> [!note]", or a quote starting with an emoji, as Nootion exports them), "==highlight==", "<u>underline</u>",
 * "<details>" toggles, "%%comments%%", and links between the imported files. Left out, Markdown is read as before (API).
 */
export interface MarkdownInOptions {
  links?: MarkdownLinks;
}

type Opts = MarkdownInOptions & { extended: boolean };
const BASIC: Opts = { extended: false };
const opts = (o?: MarkdownInOptions): Opts => (o ? { ...o, extended: true } : BASIC);

/** "$…$" (Pandoc's rule): no space just inside the dollars, and no digit just after the closing one. */
const INLINE_MATH = /^\$((?:[^\s$\\]|\\.)(?:(?:[^$\\\n]|\\.)*?(?:[^\s$\\]|\\.))?)\$(?![\d$])/;

const linkMark = (href: string): Mark => ({ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow", class: null } });
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/;

/** A link's target as written: "<a b.md>" or "a%20b.md", with its title ("a.md \"Title\"") left out. */
const linkTarget = (raw: string) => raw.trim().replace(/^<(.*)>$/, "$1").replace(/\s+"[^"]*"$/, "");

/** Inline Markdown: **bold**, *italic*, ~~strike~~, `code`, [links](https://…), and line breaks. */
export function parseInline(src: string, marks: Mark[] = [], options?: MarkdownInOptions): ProseMirrorNode[] {
  return inlineNodes(src, marks, opts(options));
}

function inlineNodes(src: string, marks: Mark[], o: Opts): ProseMirrorNode[] {
  const parseInline = (s: string, m: Mark[]) => inlineNodes(s, m, o);
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
    if (rest[0] === "\\" && rest.length > 1 && /[\\`*_~[\]()#>!|$-]/.test(rest[1]!)) {
      plain += rest[1];
      i += 2;
    } else if ((m = rest.match(/^`([^`]+)`/))) {
      flush();
      out.push(text(m[1]!, [...marks, { type: "code" }]));
      i += m[0].length;
    } else if ((m = rest.match(INLINE_MATH))) {
      // $x^2$: an equation in the line. Not "$5 and $10" (no space just inside the "$", no digit just after).
      flush();
      out.push({ type: "mathInline", attrs: { latex: m[1]! } });
      i += m[0].length;
    } else if (o.extended && (m = rest.match(/^!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/))) {
      // [[Page]], [[Page|shown text]], [[Page#Heading]], ![[file.png]] in a line.
      flush();
      const target = m[1]!.trim();
      const label = (m[2] ?? target.split("/").pop()!.replace(/\.md$/i, "")).trim();
      const page = o.links?.page(target, true);
      const file = page ? null : o.links?.file(target, true);
      if (page) out.push({ type: "pageLink", attrs: { pageId: page.id, title: page.title } });
      else if (file) out.push(text(label, [...marks, linkMark(file.url)]));
      else if (label) out.push(text(label, marks));
      i += m[0].length;
    } else if (o.extended && rest.startsWith("%%") && rest.indexOf("%%", 2) > 0) {
      // Obsidian's comments are not shown.
      flush();
      i += rest.indexOf("%%", 2) + 2;
    } else if (o.extended && (m = rest.match(/^==(?=\S)([\s\S]*?\S)==/))) {
      // Highlighted text: in yellow once the editor has the highlight mark; until then, the text alone.
      flush();
      out.push(...parseInline(m[1]!, MARKS.has("highlight") ? [...marks, { type: "highlight", attrs: { color: "yellow" } }] : marks));
      i += m[0].length;
    } else if (o.extended && (m = rest.match(/^<u>([\s\S]*?)<\/u>/i))) {
      flush();
      out.push(...parseInline(m[1]!, [...marks, { type: "underline" }]));
      i += m[0].length;
    } else if (o.extended && (m = rest.match(/^<br\s*\/?>/i))) {
      flush();
      out.push({ type: "hardBreak" });
      i += m[0].length;
    } else if ((m = o.extended ? rest.match(/^!?\[((?:[^\]\\]|\\.)*)\]\((<[^>]*>|[^)\s]+(?:\s+"[^"]*")?)\)/) : rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush();
      const href = o.extended ? linkTarget(m[2]!) : m[2]!;
      const label = m[1]!;
      if (SAFE_URL.test(href)) out.push(...parseInline(label, [...marks, linkMark(href)]));
      else {
        // A link to another file of the import.
        const page = o.links?.page(href, false);
        const file = page ? null : o.links?.file(href, false);
        if (page) out.push({ type: "pageLink", attrs: { pageId: page.id, title: page.title } });
        else if (file) out.push(...parseInline(label || file.name, [...marks, linkMark(file.url)]));
        else if (label) out.push(...parseInline(label, marks));
      }
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

const paragraph = (src: string, o: Opts = BASIC): ProseMirrorNode => {
  const content = inlineNodes(src.trim(), [], o);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** Blocks of Markdown: headings, paragraphs, lists and to-do lists, quotes, code, tables, images, dividers. */
export function parseMarkdown(markdown: string, options?: MarkdownInOptions): ProseMirrorNode {
  return { type: "doc", content: parseBlocks(markdown.replace(/\r\n?/g, "\n").split("\n"), opts(options)) };
}

/** Emoji of Obsidian's (and GitHub's) callout types. */
const CALLOUTS: Record<string, string> = {
  note: "📝", abstract: "📄", summary: "📄", tldr: "📄", info: "ℹ️", todo: "☑️", tip: "💡", hint: "💡", important: "❗",
  success: "✅", check: "✅", done: "✅", question: "❓", help: "❓", faq: "❓", warning: "⚠️", caution: "⚠️", attention: "⚠️",
  failure: "❌", fail: "❌", missing: "❌", danger: "🚫", error: "🚫", bug: "🐛", example: "📋", quote: "💬", cite: "💬",
};
const LEADING_EMOJI = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s+/u;

function parseBlocks(lines: string[], o: Opts = BASIC): ProseMirrorNode[] {
  const parseInline = (s: string) => inlineNodes(s, [], o);
  const paragraph_ = (s: string) => paragraph(s, o);
  /** An imported file shown as a block (an image, or the file), or a page linked on its own line; null when it is neither. */
  const embedded = (target: string, wiki: boolean, label: string, image: boolean): ProseMirrorNode | null => {
    const raw = wiki ? target : linkTarget(target);
    if (!o.links || SAFE_URL.test(raw)) return null;
    const file = o.links.file(raw, wiki);
    if (file) {
      if (IMAGE_TYPES.test(file.mimeType)) return { type: "image", attrs: { src: file.url, alt: (image ? label : "") || null } };
      return { type: "fileAttachment", attrs: { url: file.url, name: file.name, size: file.size, mimeType: file.mimeType } };
    }
    if (!image && !wiki) return null; // a link to a page alone on its line stays a paragraph with that link
    const page = o.links.page(raw, wiki);
    return page ? { type: "paragraph", content: [{ type: "pageLink", attrs: { pageId: page.id, title: page.title } }] } : null;
  };
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
      // ```math, as GitHub writes equations: an equation block.
      if (m[2]!.toLowerCase() === "math") {
        out.push({ type: "mathBlock", attrs: { latex: code.trim() } });
        continue;
      }
      out.push({ type: "codeBlock", attrs: { language: m[2] || null }, ...(code ? { content: [{ type: "text", text: code }] } : {}) });
    } else if (/^\s*\$\$/.test(line) && mathBlockEnd(lines, i) >= 0) {
      // $$ … $$, on one line or several: an equation block.
      const end = mathBlockEnd(lines, i);
      const body = lines.slice(i, end + 1).join("\n").trim();
      out.push({ type: "mathBlock", attrs: { latex: body.slice(2, -2).trim() } });
      i = end + 1;
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
    } else if (o.extended && (m = line.match(/^\s*(!?)\[((?:[^\]\\]|\\.)*)\]\((<[^>]*>|[^)\s]+(?:\s+"[^"]*")?)\)\s*$/)) && embedded(m[3]!, false, m[2]!, !!m[1])) {
      // An image, or a link alone on its line to a file of the import: the image, or the file as a block.
      out.push(embedded(m[3]!, false, m[2]!, !!m[1])!);
      i++;
    } else if (o.extended && (m = line.match(/^\s*!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]\s*$/))) {
      // ![[image.png]], ![[document.pdf]], ![[Other note]] on its own line.
      const block = embedded(m[1]!.trim(), true, m[2]?.trim() ?? "", true);
      out.push(block ?? paragraph_(line));
      i++;
    } else if (o.extended && /^\s*<details>\s*$/i.test(line)) {
      // <details><summary>…</summary> … </details>: a toggle, as Nootion exports them.
      let depth = 0;
      let end = i;
      for (; end < lines.length; end++) {
        if (/^\s*<details>\s*$/i.test(lines[end]!)) depth++;
        else if (/^\s*<\/details>\s*$/i.test(lines[end]!) && --depth === 0) break;
      }
      const inner = lines.slice(i + 1, end);
      const summaryAt = inner.findIndex((l) => l.trim());
      const summary = summaryAt >= 0 ? inner[summaryAt]!.match(/^\s*<summary>(.*)<\/summary>\s*$/i) : null;
      const content = parseBlocks(summary ? inner.slice(summaryAt + 1) : inner, o);
      const title = summary ? parseInline(summary[1]!) : [];
      out.push({
        type: "details",
        content: [
          { type: "detailsSummary", ...(title.length ? { content: title } : {}) },
          { type: "detailsContent", content: content.length ? content : [{ type: "paragraph" }] },
        ],
      });
      i = end + 1;
    } else if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*> ?/, ""));
      const callout = o.extended ? body[0]!.match(/^\s*\[!(\w+)\][+-]?\s*(.*)$/) : null;
      const emoji = o.extended && !callout ? body[0]!.match(LEADING_EMOJI) : null;
      if (callout) {
        // > [!warning] Title, then its text.
        const title = callout[2]!.trim();
        const content = parseBlocks(body.slice(1), o);
        const head = title ? [{ type: "paragraph", content: inlineNodes(title, [{ type: "bold" }], o) }] : [];
        const blocks = [...head, ...content];
        out.push({ type: "callout", attrs: { emoji: CALLOUTS[callout[1]!.toLowerCase()] ?? "💡" }, content: blocks.length ? blocks : [{ type: "paragraph" }] });
      } else if (emoji) {
        // > 💡 Text: a callout as Nootion exports them.
        const content = parseBlocks([body[0]!.slice(emoji[0].length), ...body.slice(1)], o);
        out.push({ type: "callout", attrs: { emoji: emoji[1] }, content: content.length ? content : [{ type: "paragraph" }] });
      } else {
        const content = parseBlocks(body, o);
        out.push({ type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] });
      }
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
            content: [paragraph_(r[ci] ?? "")],
          })),
        })),
      });
    } else if ((m = line.match(LIST_ITEM))) {
      const { node, next } = parseList(lines, i, m[1]!.length, o);
      out.push(node);
      i = next;
    } else {
      // A line no other block took (an image with a refused address, a lone "|") is text.
      const body: string[] = [lines[i++]!.trimStart()];
      while (i < lines.length && lines[i]!.trim() && !/^(\s*(```|~~~|#{1,6}\s|>|\||\$\$)|\s*!\[)/.test(lines[i]!) && !LIST_ITEM.test(lines[i]!))
        body.push(lines[i++]!.trimStart());
      // Two spaces or a backslash at the end of a line: a line break; otherwise lines join with a space.
      out.push(
        paragraph_(body.map((l, k) => (k === body.length - 1 ? l : /( {2,}|\\)$/.test(l) ? l.replace(/( {2,}|\\)$/, "\n") : `${l.trimEnd()} `)).join("")),
      );
    }
  }
  return out;
}

/** The line closing a "$$" equation opened at line `start` (the same line when it ends with "$$"), or -1. */
function mathBlockEnd(lines: string[], start: number): number {
  const first = lines[start]!.trim();
  if (first.length > 4 && first.endsWith("$$")) return start;
  for (let j = start + 1; j < lines.length && j < start + 200; j++) {
    const l = lines[j]!.trim();
    if (l.endsWith("$$")) return j;
    if (!l) return -1; // an empty line: not an equation
  }
  return -1;
}

/** A list starting at line `start`, with its nested lists: bullets, numbers or to-dos ("- [ ]", "- [x]"). */
function parseList(lines: string[], start: number, indent: number, o: Opts = BASIC): { node: ProseMirrorNode; next: number } {
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
    const content: ProseMirrorNode[] = [paragraph(body, o)];
    i++;
    // Lines indented under the item: more text, or a nested list.
    while (i < lines.length) {
      const l = lines[i]!;
      const nested = l.match(LIST_ITEM);
      if (nested && nested[1]!.length > indent) {
        const sub = parseList(lines, i, nested[1]!.length, o);
        content.push(sub.node);
        i = sub.next;
      } else if (l.trim() && !nested && /^\s+/.test(l) && l.match(/^\s*/)![0].length > indent) {
        content.push(paragraph(l, o));
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
  "recentPages", "favoritesList", "tasksList", "upcomingEvents", "databaseRows", "buttonBlock", "chart", "progressBar", "countdown", "pomodoro",
  "habitTracker", "clock", "weather", "quoteOfDay", "imageCarousel", "drawing", "video", "mathInline", "mathBlock", "syncedBlock",
]);
const MARKS = new Set(["bold", "italic", "strike", "underline", "code", "link", "textColor", "highlight"]);
/** Marks whose only attribute is one of the blocks' colors, never a free CSS value. */
const COLOR_MARKS = new Set(["textColor", "highlight"]);
const isOptionColor = (c: unknown) => typeof c === "string" && (OPTION_COLORS as readonly string[]).includes(c);

/** Longest equation kept, as in the editor. */
const MAX_LATEX = 10_000;

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
        (m) =>
          MARKS.has(m?.type) &&
          (m.type !== "link" || SAFE_URL.test(String(m.attrs?.href ?? ""))) &&
          (!COLOR_MARKS.has(m.type) || isOptionColor(m.attrs?.color)),
      );
      const copy = (m: (typeof marks)[number]) =>
        COLOR_MARKS.has(m.type) ? { type: m.type, attrs: { color: m.attrs!.color } } : { type: m.type, ...(m.attrs ? { attrs: { ...m.attrs } } : {}) };
      return marks.length ? { type: "text", text: n.text, marks: marks.map(copy) } : { type: "text", text: n.text };
    }
    let attrs = n.attrs && typeof n.attrs === "object" ? { ...n.attrs } : undefined;
    if (attrs) {
      for (const key of ["src", "url", "href"]) if (key in attrs && attrs[key] !== null && !SAFE_URL.test(String(attrs[key]))) attrs[key] = null;
      // A mention sent through the API is the sender's.
      if (n.type === "userMention") attrs = { ...attrs, id: typeof attrs.id === "string" && attrs.id ? attrs.id : randomUUID(), by: userId };
      // An equation is its LaTeX, as text: never longer than the editor draws.
      if (n.type === "mathInline" || n.type === "mathBlock") attrs = { latex: typeof attrs.latex === "string" ? attrs.latex.slice(0, MAX_LATEX) : "" };
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

/**
 * Front matter of a Markdown file ("---" lines at the top, in YAML): simple values, quoted strings, [lists] and "- item"
 * lists, which is what other tools write there. Anything else is kept as text.
 */
export function splitFrontMatter(markdown: string): { data: Record<string, string | string[]>; body: string } {
  const src = markdown.replace(/^﻿/, "");
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { data: {}, body: src };
  const data: Record<string, string | string[]> = {};
  const unquote = (v: string) => {
    const s = v.trim();
    if (/^"(?:[^"\\]|\\.)*"$/.test(s)) {
      try {
        return JSON.parse(s) as string;
      } catch {
        return s.slice(1, -1);
      }
    }
    if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    return s;
  };
  let listKey: string | null = null;
  for (const line of m[1]!.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line) ?? (listKey ? /^-\s+(.*)$/.exec(line) : null);
    if (item && listKey) {
      const list = data[listKey];
      data[listKey] = [...(Array.isArray(list) ? list : []), unquote(item[1]!)];
      continue;
    }
    const kv = /^("(?:[^"\\]|\\.)*"|[^:#\s][^:]*?)\s*:(?:\s+(.*))?$/.exec(line);
    if (!kv) continue;
    const key = unquote(kv[1]!);
    const value = (kv[2] ?? "").replace(/\s+#.*$/, "").trim();
    listKey = null;
    if (!value) {
      listKey = key;
      data[key] = [];
    } else if (/^\[.*\]$/.test(value)) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map(unquote)
        .filter(Boolean);
    } else data[key] = unquote(value);
  }
  return { data, body: src.slice(m[0].length) };
}
