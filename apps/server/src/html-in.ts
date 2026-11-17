import { parse, HTMLElement, TextNode, type Node } from "node-html-parser";
import type { ProseMirrorNode } from "./collab.js";
import type { ImportedFile, MarkdownLinks } from "./markdown-in.js";

type Mark = { type: string; attrs?: Record<string, unknown> };

const SAFE_URL = /^(https?:\/\/|mailto:|\/api\/attachments\/)/i;
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/;
const VIDEO_TYPES = /^video\/(mp4|webm)$/;
const INLINE_TYPES = new Set(["text", "hardBreak", "pageLink", "mathInline"]);

export interface HtmlInOptions {
  links?: MarkdownLinks;
  /** An image held in the page itself ("data:" address, as Word documents give them): copied as a file of the page. */
  dataFile?: (mimeType: string, data: Buffer) => ImportedFile | null;
  /** Something left out or changed, for the report: "embed", "form"… */
  note?: (what: string, info?: string) => void;
  /** The page's title when it is known otherwise (a Word document's file name): a first heading is left out only when it repeats it. */
  title?: string;
}

export interface HtmlPage {
  doc: ProseMirrorNode;
  /** The page's title: the "page-title" heading other tools export, the <title>, or the first heading (then left out of the content). */
  title: string;
  /** An emoji shown as the page's icon in the export. */
  icon: string | null;
}

const MARK_TAGS: Record<string, string> = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  cite: "italic",
  dfn: "italic",
  u: "underline",
  ins: "underline",
  s: "strike",
  del: "strike",
  strike: "strike",
};
const CODE_TAGS = new Set(["code", "kbd", "samp", "tt"]);
const DROPPED = new Set([
  "script",
  "style",
  "head",
  "title",
  "meta",
  "link",
  "noscript",
  "template",
  "svg",
  "object",
  "button",
  "select",
  "textarea",
  "input",
  "canvas",
  "map",
]);

const linkMark = (href: string): Mark => ({ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow", class: null } });
const hasClass = (el: HTMLElement, name: string) => el.classList.contains(name);

/** An HTML page (another tool's export, a saved web page, a Word document once converted) as the editor's JSON. */
export function parseHtml(html: string, o: HtmlInOptions = {}): HtmlPage {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true } });
  const body = root.querySelector("body") ?? root;

  // Other tools' exports put the title and the icon in a header above the content (with the row's properties).
  let title = root.querySelector(".page-title")?.text.trim() ?? "";
  const iconText = root.querySelector(".page-header-icon .icon")?.text.trim() ?? "";
  const icon = iconText && /^\p{Extended_Pictographic}/u.test(iconText) ? iconText.slice(0, 16) : null;
  const header = body.querySelector("header");
  if (header && (title || header.querySelector(".page-header-icon, .properties"))) {
    if (header.querySelector("table.properties")) o.note?.("properties");
    header.remove();
  }
  if (!title) title = root.querySelector("title")?.text.trim() ?? "";

  let content = toBlocks(convert(body.childNodes, [], o));
  // The first heading repeats the title: left out (or taken as the title when there is none).
  const first = content[0];
  if (o.title !== undefined) {
    if (first?.type === "heading" && plain(first).trim() === o.title.trim()) content = content.slice(1);
    title = o.title;
  } else if (first?.type === "heading" && (first.attrs?.level === 1 || !title)) {
    const text = plain(first);
    if (!title || text === title) {
      title ||= text;
      content = content.slice(1);
    }
  }
  return { doc: { type: "doc", content }, title: title.slice(0, 500), icon };
}

function plain(n: ProseMirrorNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "pageLink") return String(n.attrs?.title ?? "");
  return (n.content ?? []).map(plain).join("");
}

/** Text of an element as written (spaces and lines kept), for code. */
const rawText = (el: HTMLElement) => el.text.replace(/\r\n?/g, "\n").replace(/\n$/, "");

/** Marks set by inline styles, as in pages saved from online editors (bold or italic spans). */
function styleMarks(el: HTMLElement): Mark[] {
  const style = (el.getAttribute("style") ?? "").toLowerCase();
  if (!style) return [];
  const out: Mark[] = [];
  const weight = /font-weight\s*:\s*(\w+)/.exec(style)?.[1];
  if (weight && (weight === "bold" || weight === "bolder" || Number(weight) >= 600)) out.push({ type: "bold" });
  if (/font-style\s*:\s*italic/.test(style)) out.push({ type: "italic" });
  if (/text-decoration[\w-]*\s*:[^;]*underline/.test(style)) out.push({ type: "underline" });
  if (/text-decoration[\w-]*\s*:[^;]*line-through/.test(style)) out.push({ type: "strike" });
  return out;
}

const withMarks = (marks: Mark[], more: Mark[]) => [...marks, ...more.filter((m) => !marks.some((x) => x.type === m.type))];

/** Nodes as a mix of inline nodes and blocks; toBlocks and toInline sort them out where they land. */
function convert(nodes: Node[], marks: Mark[], o: HtmlInOptions): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  for (const node of nodes) {
    if (node instanceof TextNode) {
      const value = node.text.replace(/[\s ]+/g, (s) => (s.includes(" ") && !/[\t\n\r]/.test(s) ? s.replace(/[^ ]/g, " ") : " "));
      if (value) out.push(marks.length ? { type: "text", text: value, marks } : { type: "text", text: value });
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    out.push(...element(node, marks, o));
  }
  return out;
}

function element(el: HTMLElement, marks: Mark[], o: HtmlInOptions): ProseMirrorNode[] {
  const tag = el.rawTagName?.toLowerCase() ?? "";
  const children = (m = marks) => convert(el.childNodes, m, o);
  const blocks = () => toBlocks(children(marks.filter((m) => m.type === "link")));
  if (DROPPED.has(tag)) {
    if (tag === "input" || tag === "button" || tag === "select" || tag === "textarea") return [];
    return [];
  }
  // An equation drawn by KaTeX (other tools' HTML exports, pages saved from the web): its LaTeX is kept beside the drawing.
  if (hasClass(el, "katex") || hasClass(el, "katex-display") || (tag === "math" && el.querySelector("annotation"))) return equation(el);
  if (MARK_TAGS[tag]) return children(withMarks(marks, [{ type: MARK_TAGS[tag]! }]));
  if (CODE_TAGS.has(tag) && !(el.parentNode instanceof HTMLElement && el.parentNode.rawTagName?.toLowerCase() === "pre")) {
    const value = el.text.replace(/\s+/g, " ");
    return value ? [{ type: "text", text: value, marks: [...marks, { type: "code" }] }] : [];
  }
  switch (tag) {
    case "br":
      return [{ type: "hardBreak" }];
    case "span":
    case "font":
    case "mark":
    case "small":
    case "big":
    case "sub":
    case "sup":
    case "abbr":
    case "time":
    case "label":
    case "q":
    case "bdi":
    case "bdo":
    case "data":
    case "var":
      return children(withMarks(marks, styleMarks(el)));
    case "a":
      return anchor(el, marks, o);
    case "img":
      return image(el.getAttribute("src") ?? "", el.getAttribute("alt") ?? "", o);
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const content = toInline(children());
      return [{ type: "heading", attrs: { level: Math.min(3, Number(tag[1])) }, ...(content.length ? { content } : {}) }];
    }
    case "ul":
    case "ol":
    case "menu":
      return list(el, tag === "ol", o);
    case "blockquote": {
      const content = blocks();
      return [{ type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] }];
    }
    case "pre": {
      const code = el.querySelector("code");
      const cls = `${code?.getAttribute("class") ?? ""} ${el.getAttribute("class") ?? ""}`;
      const language = /(?:language|lang)-([\w+#-]+)/.exec(cls)?.[1] ?? null;
      const value = rawText(el);
      return [{ type: "codeBlock", attrs: { language }, ...(value ? { content: [{ type: "text", text: value }] } : {}) }];
    }
    case "hr":
      return [{ type: "horizontalRule" }];
    case "table":
      return table(el, o);
    case "details": {
      const summary = el.childNodes.find((c): c is HTMLElement => c instanceof HTMLElement && c.rawTagName?.toLowerCase() === "summary");
      const rest = el.childNodes.filter((c) => c !== summary);
      const title = summary ? toInline(convert(summary.childNodes, [], o)) : [];
      const content = toBlocks(convert(rest, [], o));
      return [
        {
          type: "details",
          content: [
            { type: "detailsSummary", ...(title.length ? { content: title } : {}) },
            { type: "detailsContent", content: content.length ? content : [{ type: "paragraph" }] },
          ],
        },
      ];
    }
    case "figure":
      return figure(el, o);
    case "dt":
      return toBlocks(children(withMarks(marks, [{ type: "bold" }])));
    case "video":
    case "audio":
    case "source": {
      const src = el.getAttribute("src") ?? el.querySelector("source")?.getAttribute("src") ?? "";
      return media(src, o);
    }
    case "iframe":
    case "embed": {
      const src = el.getAttribute("src") ?? "";
      o.note?.("embed", src);
      return SAFE_URL.test(src) ? [{ type: "paragraph", content: [{ type: "text", text: src, marks: [linkMark(src)] }] }] : [];
    }
    case "form":
    case "nav":
      o.note?.(tag === "form" ? "form" : "navigation");
      return [];
    case "div":
      if (hasClass(el, "column-list")) return columns(el, o);
      if (hasClass(el, "indented")) return blocks();
      return blocks();
    default:
      // div, section, article, p, header, footer, main, aside, center, address, dd…: their content as blocks.
      return blocks();
  }
}

/** An equation of KaTeX or MathML, from the LaTeX it keeps in an <annotation>: a block when it is shown on its own. */
function equation(el: HTMLElement): ProseMirrorNode[] {
  const annotation = el.querySelectorAll("annotation").find((a) => /tex/i.test(a.getAttribute("encoding") ?? ""));
  const latex = (annotation?.text ?? "").trim();
  if (!latex) return [{ type: "text", text: el.text.replace(/\s+/g, " ") }].filter((n) => n.text.trim());
  const display =
    hasClass(el, "katex-display") ||
    el.getAttribute("display") === "block" ||
    !!el.closest(".katex-display") ||
    !!el.closest("figure.equation") ||
    !!el.querySelector("math[display=block]");
  return [{ type: display ? "mathBlock" : "mathInline", attrs: { latex } }];
}

function anchor(el: HTMLElement, marks: Mark[], o: HtmlInOptions): ProseMirrorNode[] {
  const href = (el.getAttribute("href") ?? "").trim();
  if (!href || href.startsWith("#") || /^(javascript|data|vbscript):/i.test(href)) return convert(el.childNodes, marks, o);
  if (SAFE_URL.test(href)) return convert(el.childNodes, [...marks.filter((m) => m.type !== "link"), linkMark(href)], o);
  // A link to another file of the import.
  const page = o.links?.page(href, false);
  if (page) {
    const images = convert(el.childNodes, [], o).filter((n) => n.type === "image");
    return [{ type: "pageLink", attrs: { pageId: page.id, title: page.title } }, ...images];
  }
  const file = o.links?.file(href, false);
  if (file) {
    const inner = convert(el.childNodes, [...marks.filter((m) => m.type !== "link"), linkMark(file.url)], o);
    return inner.length ? inner : [{ type: "text", text: file.name, marks: [linkMark(file.url)] }];
  }
  return convert(el.childNodes, marks, o);
}

/** A file of the import as a block: an image, a video, or the file. */
function fileBlock(file: ImportedFile, alt = ""): ProseMirrorNode {
  if (IMAGE_TYPES.test(file.mimeType)) return { type: "image", attrs: { src: file.url, alt: alt || null } };
  if (VIDEO_TYPES.test(file.mimeType)) return { type: "video", attrs: { src: file.url } };
  return { type: "fileAttachment", attrs: { url: file.url, name: file.name, size: file.size, mimeType: file.mimeType } };
}

function image(src: string, alt: string, o: HtmlInOptions): ProseMirrorNode[] {
  src = src.trim();
  if (!src) return [];
  if (/^https?:\/\//i.test(src)) return [{ type: "image", attrs: { src, alt: alt || null } }];
  const data = /^data:([\w./+-]+);base64,(.*)$/s.exec(src);
  if (data) {
    const file = o.dataFile?.(data[1]!.toLowerCase(), Buffer.from(data[2]!, "base64"));
    return file ? [fileBlock(file, alt)] : [];
  }
  if (SAFE_URL.test(src)) return [{ type: "image", attrs: { src, alt: alt || null } }];
  const file = o.links?.file(src, false);
  return file ? [fileBlock(file, alt)] : [];
}

function media(src: string, o: HtmlInOptions): ProseMirrorNode[] {
  src = src.trim();
  if (!src) return [];
  if (/^https?:\/\//i.test(src)) return [{ type: "paragraph", content: [{ type: "text", text: src, marks: [linkMark(src)] }] }];
  const file = SAFE_URL.test(src) ? null : o.links?.file(src, false);
  return file ? [fileBlock(file)] : [];
}

function list(el: HTMLElement, ordered: boolean, o: HtmlInOptions): ProseMirrorNode[] {
  const items = el.childNodes.filter((c): c is HTMLElement => c instanceof HTMLElement && c.rawTagName?.toLowerCase() === "li");
  // Toggle lists of other tools' exports hold a <details> per item.
  if (hasClass(el, "toggle")) return items.flatMap((li) => toBlocks(convert(li.childNodes, [], o)));
  const checkbox = (li: HTMLElement) =>
    li.querySelector(":scope > input[type=checkbox], :scope > label > input[type=checkbox], :scope > p > input[type=checkbox], :scope > div.checkbox") ?? null;
  const task = hasClass(el, "to-do-list") || (items.length > 0 && items.every((li) => checkbox(li)));
  const out = items.map((li): ProseMirrorNode => {
    let checked = false;
    if (task) {
      const box = checkbox(li);
      checked = !!box && (box.hasAttribute("checked") || hasClass(box, "checkbox-on"));
      box?.remove();
    }
    let content = toBlocks(convert(li.childNodes, [], o));
    if (content[0]?.type !== "paragraph") content = [{ type: "paragraph" }, ...content];
    return { type: task ? "taskItem" : "listItem", ...(task ? { attrs: { checked } } : {}), content };
  });
  if (!out.length) return [];
  const start = Number.parseInt(el.getAttribute("start") ?? "1", 10);
  return [
    {
      type: task ? "taskList" : ordered ? "orderedList" : "bulletList",
      ...(ordered && !task ? { attrs: { start: Number.isFinite(start) ? start : 1, type: null } } : {}),
      content: out,
    },
  ];
}

function table(el: HTMLElement, o: HtmlInOptions): ProseMirrorNode[] {
  const rows = el.querySelectorAll("tr").filter((tr) => tr.closest("table") === el);
  if (!rows.length) return [];
  const cells = rows.map((tr) =>
    tr.childNodes
      .filter((c): c is HTMLElement => c instanceof HTMLElement && /^t[hd]$/i.test(c.rawTagName ?? ""))
      .map((cell) => {
        // Cells hold paragraphs: lists and other blocks become their lines of text.
        const blocks = toBlocks(convert(cell.childNodes, [], o)).flatMap(flattenToParagraphs);
        return { header: cell.rawTagName.toLowerCase() === "th", content: blocks.length ? blocks : [{ type: "paragraph" }] };
      }),
  );
  const width = Math.max(1, ...cells.map((r) => r.length));
  return [
    {
      type: "table",
      content: cells.map((r) => ({
        type: "tableRow",
        content: Array.from({ length: width }, (_, i) => {
          const c = r[i] ?? { header: false, content: [{ type: "paragraph" }] };
          return { type: c.header ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: c.content };
        }),
      })),
    },
  ];
}

function flattenToParagraphs(n: ProseMirrorNode): ProseMirrorNode[] {
  if (n.type === "paragraph") return [n];
  if (n.type === "heading") return [{ type: "paragraph", ...(n.content ? { content: n.content } : {}) }];
  if (n.type === "codeBlock") return n.content ? [{ type: "paragraph", content: n.content }] : [];
  if (n.type === "mathBlock") return [{ type: "paragraph", content: [{ type: "mathInline", attrs: n.attrs ?? {} }] }];
  return (n.content ?? []).flatMap(flattenToParagraphs);
}

function figure(el: HTMLElement, o: HtmlInOptions): ProseMirrorNode[] {
  if (hasClass(el, "callout")) {
    // An icon, then the text: a callout.
    const divs = el.childNodes.filter((c): c is HTMLElement => c instanceof HTMLElement);
    const iconEl = divs.length > 1 ? divs[0]! : null;
    const emoji = iconEl?.text.trim() ?? "";
    const rest = iconEl ? el.childNodes.filter((c) => c !== iconEl) : el.childNodes;
    const content = toBlocks(convert(rest, [], o));
    return [
      {
        type: "callout",
        attrs: { emoji: /^\p{Extended_Pictographic}/u.test(emoji) ? emoji.slice(0, 16) : iconEl ? "💡" : "" },
        content: content.length ? content : [{ type: "paragraph" }],
      },
    ];
  }
  const caption = el.querySelector("figcaption")?.text.trim() ?? "";
  const img = el.querySelector("img");
  if (img) {
    const nodes = image(img.getAttribute("src") ?? "", caption || img.getAttribute("alt") || "", o);
    if (nodes.length) return nodes;
    // An image missing from the export: the link around it may point to the file.
    const href = img.closest("a")?.getAttribute("href");
    if (href) return toBlocks(anchor(img.closest("a")!, [], o));
    return [];
  }
  const bookmark = el.querySelector("a.bookmark");
  if (bookmark) {
    const href = bookmark.getAttribute("href") ?? "";
    const label = bookmark.querySelector(".bookmark-title")?.text.trim() || href;
    return SAFE_URL.test(href) ? [{ type: "paragraph", content: [{ type: "text", text: label, marks: [linkMark(href)] }] }] : [];
  }
  return toBlocks(
    convert(
      el.childNodes.filter((c) => !(c instanceof HTMLElement && c.rawTagName?.toLowerCase() === "figcaption")),
      [],
      o,
    ),
  );
}

function columns(el: HTMLElement, o: HtmlInOptions): ProseMirrorNode[] {
  const cols = el.childNodes
    .filter((c): c is HTMLElement => c instanceof HTMLElement)
    .map((c) => toBlocks(convert(c.childNodes, [], o)))
    .filter((c) => c.length);
  if (cols.length < 2) return cols.flat();
  return [{ type: "columns", content: cols.map((content) => ({ type: "column", content })) }];
}

/** Inline content only: blocks inside (an image in a heading) give their text. */
function toInline(nodes: ProseMirrorNode[]): ProseMirrorNode[] {
  const flat = nodes.flatMap((n): ProseMirrorNode[] => (INLINE_TYPES.has(n.type) ? [n] : n.type === "image" ? [] : toInline(n.content ?? [])));
  return trimInline(flat);
}

/** Runs of inline nodes become paragraphs; spaces at their ends go. */
export function toBlocks(nodes: ProseMirrorNode[]): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  let run: ProseMirrorNode[] = [];
  const flush = () => {
    const content = trimInline(run);
    run = [];
    if (content.length) out.push({ type: "paragraph", content });
  };
  for (const n of nodes) {
    if (INLINE_TYPES.has(n.type)) run.push(n);
    else {
      flush();
      out.push(n);
    }
  }
  flush();
  return out;
}

function trimInline(nodes: ProseMirrorNode[]): ProseMirrorNode[] {
  const out = nodes.map((n) => ({ ...n }));
  // Spaces after a line break or another space go, as browsers show them.
  for (let i = 0; i < out.length; i++) {
    const n = out[i]!;
    if (n.type !== "text") continue;
    const prev = out[i - 1];
    if (!prev || prev.type === "hardBreak" || (prev.type === "text" && /\s$/.test(prev.text ?? ""))) n.text = n.text!.replace(/^ +/, "");
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const n = out[i]!;
    if (n.type === "text") {
      n.text = n.text!.replace(/\s+$/, "");
      if (n.text) break;
    } else break;
  }
  return out.filter((n) => n.type !== "text" || n.text);
}
