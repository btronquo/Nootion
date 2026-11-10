import { Fragment, type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { intlLocale, t, type WhatsNew } from "@nootion/shared";
import { api } from "../lib/api";
import { Button, Modal, useModalClose } from "./ui";

/** Links of the changelog that point into the repository (docs/QA.md…). */
const REPO = "https://github.com/btronquo/Nootion/blob/main/";

/** **bold**, `code` and [links](url) of a line of the changelog. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text)); last = re.lastIndex) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const k = parts.length;
    if (m[1] !== undefined) parts.push(<strong key={k}>{inline(m[1])}</strong>);
    else if (m[2] !== undefined)
      parts.push(
        <code key={k} className="rounded bg-neutral-100 px-1 text-[0.9em] dark:bg-neutral-800">
          {m[2]}
        </code>,
      );
    else {
      const href = /^https?:\/\//.test(m[4]!) ? m[4]! : REPO + m[4]!.replace(/^\.?\//, "");
      parts.push(
        <a key={k} href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline dark:text-blue-400">
          {m[3]}
        </a>,
      );
    }
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Keep a Changelog's headings, in the user's language. */
const HEADINGS: Record<string, Parameters<typeof t>[0]> = {
  added: "whatsNew.added",
  changed: "whatsNew.changed",
  fixed: "whatsNew.fixed",
  removed: "whatsNew.removed",
  security: "whatsNew.security",
  deprecated: "whatsNew.deprecated",
};

interface Item {
  text: string;
  children: string[];
}

/** A release's section of CHANGELOG.md: "### Added" headings, paragraphs and lists (one level of nesting). */
function Notes({ markdown }: { markdown: string }) {
  const out: ReactNode[] = [];
  let list: Item[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push(<p key={out.length}>{inline(paragraph.join(" "))}</p>);
    paragraph = [];
    if (list.length)
      out.push(
        <ul key={out.length} className="list-disc space-y-1.5 pl-5">
          {list.map((item, i) => (
            <li key={i}>
              {inline(item.text)}
              {item.children.length > 0 && (
                <ul className="mt-1 list-[circle] space-y-1 pl-5">
                  {item.children.map((c, j) => (
                    <li key={j}>{inline(c)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const line of markdown.split("\n")) {
    const heading = /^#{3,}\s+(.*)/.exec(line);
    const bullet = /^(\s*)[-*]\s+(.*)/.exec(line);
    if (heading) {
      flush();
      out.push(
        <h4 key={out.length} className="pt-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {HEADINGS[heading[1]!.trim().toLowerCase()] ? t(HEADINGS[heading[1]!.trim().toLowerCase()]!) : heading[1]}
        </h4>,
      );
    } else if (bullet) {
      if (paragraph.length) flush();
      if (bullet[1]!.length >= 2 && list.length) list[list.length - 1]!.children.push(bullet[2]!);
      else list.push({ text: bullet[2]!, children: [] });
    } else if (!line.trim()) {
      if (paragraph.length) flush();
    } else if (list.length && /^\s/.test(line)) {
      // The rest of a list item, wrapped onto the next line.
      const item = list[list.length - 1]!;
      if (item.children.length) item.children[item.children.length - 1] += " " + line.trim();
      else item.text += " " + line.trim();
    } else {
      if (list.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return <>{out}</>;
}

const date = (d: string | null) =>
  d ? new Intl.DateTimeFormat(intlLocale(), { dateStyle: "long" }).format(new Date(`${d}T12:00:00`)) : null;

/** "What's new": shown once after an update, with the release notes of the versions this user hasn't seen. */
export function WhatsNewDialog() {
  const [closed, setClosed] = useState(false);
  const data = useQuery({
    queryKey: ["whats-new"],
    queryFn: () => api<WhatsNew>("/whats-new"),
    staleTime: Infinity,
    retry: false,
  }).data;
  if (closed || !data?.releases.length) return null;
  const close = () => {
    setClosed(true);
    void api("/whats-new/seen", { method: "POST", body: {} }).catch(() => {});
  };
  return (
    <Modal title={t("whatsNew.title", { version: data.version })} onClose={close} wide>
      <div className="-mx-5 max-h-[60vh] overflow-y-auto px-5 text-sm leading-relaxed" data-whats-new>
        {data.releases.map((r, i) => (
          <Fragment key={r.version}>
            {i > 0 && <hr className="my-5 border-neutral-200 dark:border-neutral-800" />}
            <section className="space-y-2">
              <h3 className="flex items-baseline gap-2 text-base font-semibold">
                {i === 0 && <Sparkles size={16} className="self-center text-amber-500" />}
                {t("whatsNew.version", { version: r.version })}
                {r.date && <span className="text-xs font-normal text-neutral-500">{date(r.date)}</span>}
              </h3>
              <Notes markdown={r.markdown} />
            </section>
          </Fragment>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <a
          href="https://github.com/btronquo/Nootion/blob/main/CHANGELOG.md"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-neutral-500 hover:underline"
        >
          {t("whatsNew.all")}
        </a>
        <ModalOk />
      </div>
    </Modal>
  );
}

function ModalOk() {
  const close = useModalClose(() => {});
  return (
    <Button type="button" onClick={close} autoFocus data-whats-new-ok>
      {t("whatsNew.ok")}
    </Button>
  );
}
