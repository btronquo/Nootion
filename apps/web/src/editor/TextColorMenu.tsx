import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Ban, ChevronDown } from "lucide-react";
import { OPTION_COLORS, t, type MessageKey, type OptionColor } from "@nootion/shared";
import { selectionColors } from "./textColors";

/** The colors of the selected text: the nine colors of the blocks, for the text and for its highlight. */
export function TextColorPanel({ editor, onPicked }: { editor: Editor; onPicked?: () => void }) {
  const current = useEditorState({ editor, selector: ({ editor: e }) => selectionColors(e) });
  const name = (c: OptionColor) => t(`color.${c}` as MessageKey);
  const swatch = (label: string, sample: string | null, checked: boolean, run: () => void, testId: string) => (
    <button
      key={testId}
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-label={label}
      title={label}
      data-testid={testId}
      // Keeps the selection: the editor doesn't lose focus.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        run();
        onPicked?.();
      }}
      className={`flex h-8 w-8 items-center justify-center rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 ${checked ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
    >
      <span
        data-color={sample ?? undefined}
        className={`nt-swatch flex h-6 w-6 items-center justify-center rounded border text-sm font-semibold ${
          checked ? "border-blue-500 ring-1 ring-blue-500" : "border-neutral-200 dark:border-neutral-700"
        }`}
      >
        {sample === null ? <Ban size={13} className="text-neutral-400" /> : "A"}
      </span>
    </button>
  );
  const section = (label: string) => <div className="px-1 pt-1.5 pb-1 text-xs font-medium text-neutral-500">{label}</div>;
  return (
    <div className="w-max p-1.5" role="menu" aria-label={t("editor.textColor")}>
      {section(t("block.textColor"))}
      <div className="grid grid-cols-[repeat(5,2rem)] sm:grid-cols-[repeat(10,2rem)]">
        {swatch(t("block.defaultColor"), null, current.text === null, () => editor.chain().focus().setTextColor(null).run(), "text-color-none")}
        {OPTION_COLORS.map((c) => swatch(name(c), c, current.text === c, () => editor.chain().focus().setTextColor(c).run(), `text-color-${c}`))}
      </div>
      {section(t("editor.highlight"))}
      <div className="grid grid-cols-[repeat(5,2rem)] sm:grid-cols-[repeat(10,2rem)]">
        {swatch(t("editor.noHighlight"), null, current.highlight === null, () => editor.chain().focus().setHighlight(null).run(), "highlight-none")}
        {OPTION_COLORS.map((c) => swatch(name(c), `${c}-bg`, current.highlight === c, () => editor.chain().focus().setHighlight(c).run(), `highlight-${c}`))}
      </div>
    </div>
  );
}

/** The button of the selection toolbar that opens the text colors, showing the selection's own. */
export function TextColorButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = useEditorState({ editor, selector: ({ editor: e }) => selectionColors(e) });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onSelection = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    editor.on("blur", onSelection);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      editor.off("blur", onSelection);
    };
  }, [open, editor]);
  const colored = current.text !== null || current.highlight !== null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={t("editor.textColor")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="text-color-button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-0.5 rounded p-1.5 ${open || colored ? "bg-neutral-200 dark:bg-neutral-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
      >
        <span
          data-color={current.highlight ? `${current.highlight}-bg` : undefined}
          className="nt-swatch flex h-[15px] w-[15px] items-center justify-center rounded-sm text-[13px] leading-none font-semibold"
        >
          <span data-color={current.text ?? undefined} className="nt-swatch underline decoration-2 underline-offset-2">
            A
          </span>
        </span>
        <ChevronDown size={11} className="text-neutral-500" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1.5 rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <TextColorPanel editor={editor} onPicked={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
