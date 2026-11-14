import { useMemo, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check, ChevronDown, Copy, WrapText } from "lucide-react";
import { t } from "@nootion/shared";
import { Popover } from "../database/Popover";
import { copyText } from "../lib/browser";
import { CODE_LANGUAGES, PLAIN_TEXT, languageLabel, resolveLanguage } from "./codeLanguages";

const barButton =
  "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100";

/** A code block: its language (chosen or guessed), a copy button and line wrapping above the code. */
export function CodeBlockView({ node, updateAttributes, editor, decorations }: NodeViewProps) {
  const language = node.attrs.language as string | null;
  const wrap = node.attrs.wrap === true;
  const detected = decorations.map((d) => (d as { spec?: { detectedLanguage?: string } }).spec?.detectedLanguage).find(Boolean) ?? null;
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const editable = editor.isEditable;

  const label =
    language === null
      ? detected
        ? t("codeBlock.detected", { language: languageLabel(detected) })
        : t("codeBlock.auto")
      : resolveLanguage(language) === PLAIN_TEXT
        ? t("codeBlock.plainText")
        : languageLabel(language);

  const copy = async () => {
    await copyText(node.textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <NodeViewWrapper className="code-block group relative" data-language={language ?? undefined} data-wrap={wrap ? "" : undefined}>
      <div className="code-block-bar" contentEditable={false}>
        {editable ? (
          <button
            ref={button}
            type="button"
            className={barButton}
            onClick={() => setMenu(!menu)}
            aria-haspopup="listbox"
            aria-expanded={menu}
            title={t("codeBlock.language")}
          >
            {label}
            <ChevronDown size={12} />
          </button>
        ) : (
          <span className="px-1.5 py-0.5 text-xs text-neutral-500 dark:text-neutral-400">{language === null && !detected ? "" : label}</span>
        )}
        <span className="code-block-actions ml-auto flex items-center gap-0.5">
          {editable && (
            <button
              type="button"
              className={`${barButton} ${wrap ? "text-blue-600 dark:text-blue-400" : ""}`}
              onClick={() => updateAttributes({ wrap: !wrap })}
              aria-pressed={wrap}
              title={t("codeBlock.wrap")}
              aria-label={t("codeBlock.wrap")}
            >
              <WrapText size={14} />
            </button>
          )}
          <button type="button" className={barButton} onClick={copy} title={t("codeBlock.copy")} aria-label={t("codeBlock.copy")}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? t("codeBlock.copied") : t("codeBlock.copy")}</span>
          </button>
        </span>
      </div>
      <pre spellCheck={false}>
        <NodeViewContent<"code"> as="code" />
      </pre>
      {menu && (
        <LanguageMenu
          anchor={button.current}
          current={language}
          onClose={() => setMenu(false)}
          onPick={(id) => {
            updateAttributes({ language: id });
            setMenu(false);
            editor.commands.focus();
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

type Choice = { id: string | null; label: string };

function LanguageMenu({
  anchor,
  current,
  onClose,
  onPick,
}: {
  anchor: HTMLElement | null;
  current: string | null;
  onClose: () => void;
  onPick: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const resolved = resolveLanguage(current);
  const choices = useMemo(() => {
    const all: Choice[] = [
      { id: null, label: t("codeBlock.auto") },
      { id: PLAIN_TEXT, label: t("codeBlock.plainText") },
      ...CODE_LANGUAGES.map((l) => ({ id: l.id, label: l.label })),
    ];
    // A language from an import that we don't colour stays listed, so that the menu shows what the block has.
    if (current && !resolved) all.splice(2, 0, { id: current, label: current });
    const q = query.trim().toLocaleLowerCase();
    return q ? all.filter((c) => c.label.toLocaleLowerCase().includes(q) || (c.id ?? "").includes(q) || (c.id !== null && resolveLanguage(q) === c.id)) : all;
  }, [query, current, resolved]);
  const index = Math.min(active, Math.max(0, choices.length - 1));
  const isCurrent = (c: Choice) => (c.id === null ? current === null : c.id === current || (!!resolved && c.id === resolved));

  return (
    <Popover anchor={anchor} onClose={onClose} width={220}>
      <div
        data-code-language-menu
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((index + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % Math.max(1, choices.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const c = choices[index];
            if (c) onPick(c.id);
          }
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => (setQuery(e.target.value), setActive(0))}
          placeholder={t("codeBlock.searchLanguage")}
          aria-label={t("codeBlock.searchLanguage")}
          className="mb-1 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
        />
        <div role="listbox" className="max-h-64 overflow-y-auto">
          {choices.map((c, i) => (
            <button
              key={c.id ?? "auto"}
              type="button"
              role="option"
              aria-selected={isCurrent(c)}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(c.id)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${i === index ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {isCurrent(c) && <Check size={14} className="shrink-0 text-neutral-500" />}
            </button>
          ))}
          {!choices.length && <p className="px-2 py-1.5 text-neutral-500">{t("codeBlock.noLanguage")}</p>}
        </div>
      </div>
    </Popover>
  );
}
