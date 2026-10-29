import type { ProseMirrorNode } from "./collab.js";
import { calendarSources, t as translate } from "@nootion/shared";

/** How links of an exported page point to the other files of the export. */
export interface MarkdownLinks {
  /** Relative path of an attached file, or null to keep the original address. */
  file: (attachmentId: string) => string | null;
  /** Relative path of another exported page (or database), or null when it isn't in the export. */
  page: (pageId: string) => string | null;
}

const ATTACHMENT = /^\/api\/attachments\/([0-9a-f-]{36})/;

function escapeText(s: string): string {
  return s.replace(/([\\`*_[\]<>])/g, "\\$1");
}

/** Link destinations with spaces or parentheses are wrapped in <…> (CommonMark). */
function dest(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
}

function fileUrl(url: unknown, links: MarkdownLinks): string {
  const u = String(url ?? "");
  const m = ATTACHMENT.exec(u);
  return (m && links.file(m[1]!)) ?? u;
}

function inline(nodes: ProseMirrorNode[] | undefined, links: MarkdownLinks): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "pageLink" || n.type === "pageMention") {
        const title = String(n.attrs?.title || translate("common.untitled"));
        const target = links.page(String(n.attrs?.pageId ?? ""));
        return target ? `[${escapeText(title)}](${dest(target)})` : escapeText(title);
      }
      if (n.type === "image") return `![${escapeText(String(n.attrs?.alt ?? ""))}](${dest(fileUrl(n.attrs?.src, links))})`;
      if (n.type !== "text") return inline(n.content, links);
      const marks = n.marks ?? [];
      const has = (t: string) => marks.find((m) => m.type === t);
      let t = n.text ?? "";
      if (has("code")) t = t.includes("`") ? `\`\` ${t} \`\`` : `\`${t}\``;
      else t = escapeText(t);
      // Keep spaces outside the markers: "** gras**" is not bold in Markdown.
      const wrap = (open: string, close = open) => {
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t)!;
        t = m[2] ? `${m[1]}${open}${m[2]}${close}${m[3]}` : t;
      };
      if (has("bold")) wrap("**");
      if (has("italic")) wrap("_");
      if (has("strike")) wrap("~~");
      if (has("underline")) wrap("<u>", "</u>");
      if (has("highlight")) wrap("==");
      const link = has("link");
      if (link?.attrs?.href) t = `[${t}](${dest(String(link.attrs.href))})`;
      return t;
    })
    .join("");
}

const indent = (text: string, prefix: string) =>
  text
    .split("\n")
    .map((line, i) => (i === 0 ? prefix + line : line ? " ".repeat(prefix.length) + line : line))
    .join("\n");

function cellText(cell: ProseMirrorNode, links: MarkdownLinks): string {
  return (cell.content ?? [])
    .map((b) => inline(b.content, links))
    .join("<br>")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function block(n: ProseMirrorNode, links: MarkdownLinks): string {
  const children = (sep = "\n\n") =>
    (n.content ?? [])
      .map((c) => block(c, links))
      .filter((s) => s !== "")
      .join(sep);
  switch (n.type) {
    case "doc":
      return children();
    case "paragraph":
      return inline(n.content, links);
    case "heading":
      return `${"#".repeat(Math.min(6, Number(n.attrs?.level ?? 1)))} ${inline(n.content, links)}`;
    case "bulletList":
      return (n.content ?? []).map((li) => indent((li.content ?? []).map((c) => block(c, links)).join("\n"), "- ")).join("\n");
    case "orderedList": {
      const start = Number(n.attrs?.start ?? 1);
      return (n.content ?? []).map((li, i) => indent((li.content ?? []).map((c) => block(c, links)).join("\n"), `${start + i}. `)).join("\n");
    }
    case "taskList":
      return (n.content ?? [])
        .map((li) => indent((li.content ?? []).map((c) => block(c, links)).join("\n"), `- [${li.attrs?.checked ? "x" : " "}] `))
        .join("\n");
    case "blockquote":
      return children()
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "callout":
      return `${n.attrs?.emoji ?? "💡"} ${children()}`
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "details": {
      // HTML <details>, which most Markdown readers show as a toggle.
      const [summary, body] = n.content ?? [];
      const inner = body ? block(body, links) : "";
      return `<details>\n<summary>${inline(summary?.content, links)}</summary>\n\n${inner}\n\n</details>`;
    }
    case "codeBlock": {
      const code = (n.content ?? []).map((t) => t.text ?? "").join("");
      const fence = code.includes("```") ? "~~~~" : "```";
      return `${fence}${n.attrs?.language ?? ""}\n${code}\n${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "image":
      return inline([n], links);
    case "table": {
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => cellText(c, links)));
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return [line(rows[0]!), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
    }
    case "fileAttachment":
      return `[📎 ${escapeText(String(n.attrs?.name ?? "file"))}](${dest(fileUrl(n.attrs?.url, links))})`;
    case "pageLink":
    case "pageMention":
      return inline([n], links);
    case "databaseBlock": {
      const id = String(n.attrs?.pageId ?? "");
      const target = id ? links.page(id) : null;
      return target ? `[🗃 ${translate("common.database")}](${dest(target)})` : "";
    }
    case "calendarBlock":
      return calendarSources(n.attrs?.sources)
        .map((s) => links.page(s.databaseId))
        .filter((target): target is string => !!target)
        .map((target) => `[📅 ${translate("common.database")}](${dest(target)})`)
        .join("\n\n");
    default: {
      // Plugin blocks keep a link when their data has one (embeds…).
      if (n.type.startsWith("plugin_")) {
        try {
          const data = JSON.parse(String(n.attrs?.data ?? "{}")) as { url?: unknown; title?: unknown };
          if (typeof data.url === "string") return `[${escapeText(String(data.title || data.url))}](${dest(data.url)})`;
        } catch {
          // Unreadable data: nothing to export.
        }
        return "";
      }
      return n.content ? (n.content.some((c) => c.type === "text") ? inline(n.content, links) : children()) : "";
    }
  }
}

/** Markdown of a page body (ProseMirror JSON). */
export function toMarkdown(doc: ProseMirrorNode | null | undefined, links: MarkdownLinks): string {
  if (!doc) return "";
  return block(doc, links)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** YAML front matter: values are written as JSON, which YAML reads as-is. */
export function frontMatter(fields: Record<string, unknown>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}
