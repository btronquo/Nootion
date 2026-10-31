import { useEffect, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { t } from "@nootion/shared";

interface Heading {
  pos: number;
  level: number;
  text: string;
}

/** The page's headings (toggle headings included), at their depth. */
function headingsOf(editor: NodeViewProps["editor"]): Heading[] {
  const out: Heading[] = [];
  editor.state.doc.descendants((node, pos, parent) => {
    if (node.type.name === "heading") out.push({ pos, level: node.attrs.level as number, text: node.textContent });
    else if (node.type.name === "detailsSummary" && parent?.attrs.level) out.push({ pos, level: parent.attrs.level as number, text: node.textContent });
    else return true;
    return false;
  });
  return out.filter((h) => h.text.trim());
}

/** A list of links to the page's headings, kept up to date as the page changes. */
export function TableOfContentsView({ editor }: NodeViewProps) {
  const [headings, setHeadings] = useState(() => headingsOf(editor));
  useEffect(() => {
    const update = () =>
      setHeadings((old) => {
        const next = headingsOf(editor);
        return JSON.stringify(next) === JSON.stringify(old) ? old : next;
      });
    editor.on("update", update);
    return () => void editor.off("update", update);
  }, [editor]);
  const top = Math.min(...headings.map((h) => h.level));

  function go(pos: number) {
    const dom = editor.view.nodeDOM(pos);
    (dom instanceof HTMLElement ? dom : dom?.parentElement)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <NodeViewWrapper className="table-of-contents my-2" data-table-of-contents contentEditable={false}>
      {headings.length ? (
        <nav aria-label={t("toc.title")} className="border-l-2 border-neutral-200 py-0.5 dark:border-neutral-700">
          {headings.map((h) => (
            <button
              key={h.pos}
              type="button"
              onClick={() => go(h.pos)}
              style={{ paddingLeft: `${0.75 + (h.level - top) * 1}rem` }}
              className="block w-full truncate rounded-r py-0.5 pr-2 text-left text-sm text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:bg-neutral-100 hover:text-neutral-800 dark:decoration-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              {h.text}
            </button>
          ))}
        </nav>
      ) : (
        <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-400 dark:bg-neutral-800/50">{t("toc.empty")}</p>
      )}
    </NodeViewWrapper>
  );
}
