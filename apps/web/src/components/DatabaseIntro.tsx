import { useEffect, useRef, useState } from "react";
import { Database, Info } from "lucide-react";
import { DESCRIPTION_MAX, t, type PageDetail } from "@nootion/shared";
import { Popover } from "../database/Popover";

/**
 * Under the title of a database page: a badge that says the page is a database (it holds rows, not free text, which
 * could pass for a bug), with an explanation, and the database's description, the place for a few lines of text.
 */
export function DatabaseIntro({ page, canEdit, onSave }: { page: PageDetail; canEdit: boolean; onSave: (description: string) => void }) {
  const [description, setDescription] = useState(page.description);
  const [help, setHelp] = useState<HTMLElement | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<string | null>(null);

  // Changed elsewhere (another tab, the desktop sync): shown, unless it is being typed here.
  useEffect(() => {
    if (pending.current === null) setDescription(page.description);
  }, [page.description]);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [description]);

  const flush = () => {
    window.clearTimeout(timer.current);
    if (pending.current === null) return;
    const value = pending.current;
    pending.current = null;
    onSave(value);
  };
  // Typed just before leaving the page: still saved.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => flushRef.current(), []);

  const change = (value: string) => {
    setDescription(value);
    pending.current = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
  };

  return (
    <div className="mt-1" data-database-intro>
      <button
        type="button"
        onClick={(e) => setHelp(help ? null : e.currentTarget)}
        aria-expanded={!!help}
        title={t("database.pageHint")}
        className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
        data-database-badge
      >
        <Database size={12} /> {t("database.pageBadge")} <Info size={12} className="text-neutral-400" />
      </button>
      {help && (
        <Popover anchor={help} onClose={() => setHelp(null)} width={320}>
          <p className="p-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-200">{t("database.pageHint")}</p>
        </Popover>
      )}
      {(canEdit || description) && (
        <textarea
          ref={ref}
          rows={1}
          value={description}
          readOnly={!canEdit}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => change(e.target.value)}
          onBlur={flush}
          placeholder={t("database.descriptionPlaceholder")}
          aria-label={t("database.descriptionLabel")}
          className="mt-2 block w-full resize-none overflow-hidden bg-transparent text-sm text-neutral-600 outline-none placeholder:text-neutral-400 dark:text-neutral-300 dark:placeholder:text-neutral-500"
          data-database-description
        />
      )}
    </div>
  );
}
