import { useEffect, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { X } from "lucide-react";
import { t } from "@nootion/shared";
import { pagePanels, type PagePanelContext } from "./registry";
import { insertIntoPage } from "../editor/selectionPanel";

/**
 * Round buttons at the bottom right of a page, one per plugin page panel (the AI assistant's chat…), and the panel
 * the open one shows beside the page: a column on wide screens, a sheet over the page on phones.
 */
export function PagePanels({ editor, pageId, title, canEdit, touch }: { editor: Editor; pageId: string; title: string; canEdit: boolean; touch: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  // On a phone, the editing bar takes the bottom of the screen while typing: the buttons step aside.
  const typing = useEditorState({ editor, selector: ({ editor: e }) => e.isFocused });
  const hidden = touch && canEdit && typing;
  // Another page: the panel closes (what it said was about the page left).
  useEffect(() => setOpen(null), [pageId]);
  const panels = pagePanels();
  const current = panels.find((p) => p.id === open);
  if (!panels.length) return null;

  const ctx: PagePanelContext | null = current
    ? {
        pageId,
        title: () => title,
        text: () => editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n\n", " ").trim(),
        canEdit,
        insert: (content) => {
          if (canEdit) insertIntoPage(editor, content);
        },
        close: () => setOpen(null),
      }
    : null;

  return (
    <>
      {!current && !hidden && (
        <div className="fixed right-5 bottom-5 z-30 flex flex-col gap-2 pb-[env(safe-area-inset-bottom)] print:hidden">
          {panels.map(({ id, panel }) => (
            <button
              key={id}
              type="button"
              title={panel.label}
              aria-label={panel.label}
              data-page-panel={id}
              onClick={() => setOpen(id)}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-200 bg-white text-xl shadow-lg transition hover:scale-105 hover:shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
            >
              {panel.icon ?? "🧩"}
            </button>
          ))}
        </div>
      )}
      {current && ctx && (
        <aside
          role="complementary"
          aria-label={current.panel.label}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(null);
            }
          }}
          className="fixed z-40 flex flex-col overflow-hidden border-neutral-200 bg-white shadow-2xl max-md:inset-x-0 max-md:bottom-0 max-md:h-[85dvh] max-md:rounded-t-2xl max-md:border-t md:right-5 md:bottom-5 md:h-[min(640px,calc(100dvh-6rem))] md:w-[400px] md:rounded-xl md:border dark:border-neutral-700 dark:bg-neutral-900 print:hidden"
        >
          <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
            <span className="text-lg">{current.panel.icon}</span>
            <span className="flex-1 truncate font-semibold">{current.panel.label}</span>
            <button
              type="button"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={() => setOpen(null)}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1">{current.panel.render(ctx)}</div>
        </aside>
      )}
    </>
  );
}
