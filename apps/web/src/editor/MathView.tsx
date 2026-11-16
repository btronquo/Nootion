import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { t } from "@nootion/shared";
import { Popover } from "../database/Popover";
import { renderMath, renderedNow, type Rendered } from "./math";

/** Typing pauses this long before the preview is drawn again. */
const DELAY = 120;

/** Asked by the editor to open an equation's editor (a new equation, or Enter on a selected one). */
export const MATH_EDIT_EVENT = "nootion-math-edit";

/** The equation drawn from `latex`, as soon as KaTeX has it: at once when it was drawn before. */
function useRendered(latex: string, display: boolean, delay = 0): Rendered | null {
  const [state, setState] = useState<{ key: string; result: Rendered } | null>(null);
  const key = `${display ? "d" : "i"}:${latex}`;
  const now = renderedNow(latex, display);
  useEffect(() => {
    if (!latex.trim() || renderedNow(latex, display)) return;
    let current = true;
    const timer = setTimeout(() => void renderMath(latex, display).then((result) => current && setState({ key, result })), delay);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [latex, display, key, delay]);
  if (!latex.trim()) return null;
  return now ?? (state?.key === key ? state.result : null);
}

/** KaTeX's HTML, made without `trust`: no links, no HTML of the equation's own. */
function Formula({ rendered, className }: { rendered: Rendered | null; className?: string }) {
  if (!rendered || "error" in rendered) return null;
  return <span className={className} dangerouslySetInnerHTML={{ __html: rendered.html }} />;
}

/**
 * An equation, in a line (`mathInline`) or as a block of its own (`mathBlock`). Clicked in an editable page, it opens a
 * small editor of its LaTeX with a live preview; an equation left empty is removed when the editor closes.
 */
export function MathView({ node, editor, updateAttributes, deleteNode, getPos, selected }: NodeViewProps) {
  const display = node.type.name === "mathBlock";
  const latex = String(node.attrs.latex ?? "");
  const rendered = useRendered(latex, display);
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const editable = editor.isEditable;

  useEffect(() => {
    if (!editable) return;
    const onEdit = (e: Event) => {
      const dom = (e as CustomEvent<{ dom: Node | null }>).detail?.dom;
      if (dom && ref.current && dom.contains(ref.current)) setOpen(true);
    };
    document.addEventListener(MATH_EDIT_EVENT, onEdit);
    return () => document.removeEventListener(MATH_EDIT_EVENT, onEdit);
  }, [editable]);

  const close = () => {
    setOpen(false);
    const pos = getPos();
    if (typeof pos !== "number") return;
    if (!String(editor.state.doc.nodeAt(pos)?.attrs.latex ?? "").trim()) {
      deleteNode();
      editor.commands.focus();
      return;
    }
    // The cursor goes back just after the equation, to keep on writing.
    editor
      .chain()
      .focus()
      .setTextSelection(pos + node.nodeSize)
      .run();
  };

  const error = rendered && "error" in rendered ? rendered.error : null;
  const Tag = display ? "div" : "span";
  return (
    <NodeViewWrapper as={Tag} contentEditable={false} data-math={display ? "block" : "inline"} className={display ? "math-block-wrapper" : undefined}>
      <Tag
        ref={ref as React.RefObject<HTMLDivElement & HTMLSpanElement>}
        role={editable ? "button" : "img"}
        tabIndex={-1}
        aria-label={latex ? t("math.label", { latex }) : t("math.empty")}
        title={error ? t("math.error", { message: error }) : undefined}
        onClick={() => editable && setOpen(true)}
        className={`${display ? "math-block" : "math-inline"} ${selected || open ? "math-selected" : ""} ${error ? "math-has-error" : ""} ${editable ? "cursor-pointer" : ""}`}
      >
        {!latex.trim() ? (
          <span className="math-placeholder">{display ? t("math.newBlock") : t("math.newInline")}</span>
        ) : rendered && "html" in rendered ? (
          <Formula rendered={rendered} />
        ) : (
          // While KaTeX loads, or when the LaTeX has a mistake: the source itself.
          <code className="math-source">{latex}</code>
        )}
      </Tag>
      {open && <MathEditor anchor={ref.current} latex={latex} display={display} onChange={(v) => updateAttributes({ latex: v })} onClose={close} />}
    </NodeViewWrapper>
  );
}

function MathEditor({
  anchor,
  latex,
  display,
  onChange,
  onClose,
}: {
  anchor: HTMLElement | null;
  latex: string;
  display: boolean;
  onChange: (latex: string) => void;
  onClose: () => void;
}) {
  const preview = useRendered(latex, display, DELAY);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const error = preview && "error" in preview ? preview.error : null;
  return (
    <Popover anchor={anchor} onClose={onClose} width={display ? 520 : 360}>
      <div className="space-y-2 p-2" data-math-editor>
        <textarea
          ref={area}
          value={latex}
          rows={display ? 4 : 2}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={display ? "\\int_0^1 x^2\\,dx = \\frac{1}{3}" : "e^{i\\pi} + 1 = 0"}
          aria-label={t("math.source")}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter closes an equation in a line; a block takes several lines, and closes with Ctrl+Enter.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey || (!display && !e.shiftKey))) {
              e.preventDefault();
              onClose();
            }
          }}
          className="w-full resize-y rounded border border-neutral-300 bg-transparent px-2 py-1 font-mono text-[13px] leading-snug outline-none focus:border-blue-500 dark:border-neutral-700 dark:focus:border-blue-400"
        />
        <div className="math-preview" aria-live="polite">
          {!latex.trim() ? (
            <span className="text-xs text-neutral-400">{t("math.hint")}</span>
          ) : error ? (
            <span className="text-xs text-red-600 dark:text-red-400">{t("math.error", { message: error })}</span>
          ) : preview ? (
            <Formula rendered={preview} className={display ? "block text-center" : undefined} />
          ) : (
            <span className="text-xs text-neutral-400">{t("math.loading")}</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-400">{display ? t("math.closeBlock") : t("math.closeInline")}</span>
          <button
            onClick={onClose}
            className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-white hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900"
          >
            {t("math.done")}
          </button>
        </div>
      </div>
    </Popover>
  );
}
