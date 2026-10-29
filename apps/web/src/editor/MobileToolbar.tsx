import { useEffect, useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronDown,
  Heading2,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";
import { t } from "@nootion/shared";

const LIST_ITEMS = ["listItem", "taskItem"];

/**
 * Moves the block holding the cursor before the previous one (dir = -1) or after the next one (dir = 1).
 * In a list, the list item moves among its siblings; elsewhere, the top-level block moves.
 */
export function moveBlock(editor: Editor, dir: -1 | 1): boolean {
  const { state } = editor;
  const { $from, from, to } = state.selection;
  let depth = $from.depth;
  while (depth > 1 && !LIST_ITEMS.includes($from.node(depth).type.name)) depth--;
  if (depth < 1) return false;
  const parent = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const node = $from.node(depth);
  const start = $from.before(depth);
  const other: PMNode | null = index + dir >= 0 && index + dir < parent.childCount ? parent.child(index + dir) : null;
  if (!other) return false;
  const tr = state.tr;
  if (dir < 0) tr.replaceWith(start - other.nodeSize, start + node.nodeSize, Fragment.from([node, other]));
  else tr.replaceWith(start, start + node.nodeSize + other.nodeSize, Fragment.from([other, node]));
  const shift = dir < 0 ? -other.nodeSize : other.nodeSize;
  tr.setSelection(TextSelection.create(tr.doc, from + shift, to + shift)).scrollIntoView();
  editor.view.dispatch(tr);
  return true;
}

/** Opens the "/" menu at the cursor, adding a space first when the cursor ends a word. */
function openBlockMenu(editor: Editor) {
  const { $from } = editor.state.selection;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, "\0", "\0");
  editor
    .chain()
    .focus()
    .insertContent(before && !/\s/.test(before) ? " /" : "/")
    .run();
}

/** Distance between the bottom of the window and the top of the on-screen keyboard. */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/**
 * Editing bar for touch screens, shown above the keyboard while the page is being edited:
 * the "/" menu, formatting, lists, indentation, moving blocks, undo.
 */
export function MobileToolbar({ editor }: { editor: Editor }) {
  const inset = useKeyboardInset();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      link: e.isActive("link"),
      heading: e.isActive("heading", { level: 2 }),
      bullet: e.isActive("bulletList"),
      task: e.isActive("taskList"),
      inList: e.isActive("listItem") || e.isActive("taskItem"),
      canUndo: e.can().undo?.() ?? false,
      canRedo: e.can().redo?.() ?? false,
    }),
  });
  // Tapping a button blurs the editor for a moment: wait before hiding the bar.
  const [focused, setFocused] = useState(editor.isFocused);
  useEffect(() => {
    let timer: number | undefined;
    const onFocus = () => {
      window.clearTimeout(timer);
      setFocused(true);
    };
    const onBlur = () => {
      timer = window.setTimeout(() => setFocused(editor.isFocused), 200);
    };
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    return () => {
      window.clearTimeout(timer);
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
    };
  }, [editor]);
  if (!focused) return null;

  const listItem = editor.isActive("taskItem") ? "taskItem" : "listItem";
  const run = (fn: () => unknown) => () => void fn();
  return (
    <div
      role="toolbar"
      aria-label={t("toolbar.label")}
      style={{ bottom: inset }}
      className="mobile-toolbar fixed inset-x-0 z-40 flex items-center gap-0.5 overflow-x-auto border-t border-neutral-200 bg-neutral-50 px-1 py-1 [scrollbar-width:none] dark:border-neutral-800 dark:bg-neutral-950"
      // Keeps the keyboard open: the editor stays focused while a button is tapped.
      onMouseDown={(e) => e.preventDefault()}
    >
      <ToolButton label={t("toolbar.insert")} onClick={run(() => openBlockMenu(editor))}>
        <Plus size={20} />
      </ToolButton>
      <Divider />
      <ToolButton label={t("editor.bold")} active={state.bold} onClick={run(() => editor.chain().focus().toggleBold().run())}>
        <Bold size={18} />
      </ToolButton>
      <ToolButton label={t("editor.italic")} active={state.italic} onClick={run(() => editor.chain().focus().toggleItalic().run())}>
        <Italic size={18} />
      </ToolButton>
      <ToolButton
        label={t("editor.link")}
        active={state.link}
        onClick={run(() => {
          if (state.link) return editor.chain().focus().unsetLink().run();
          const url = prompt(t("editor.linkPrompt"));
          if (url)
            editor
              .chain()
              .focus()
              .setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` })
              .run();
        })}
      >
        <LinkIcon size={18} />
      </ToolButton>
      <ToolButton label={t("toolbar.heading")} active={state.heading} onClick={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>
        <Heading2 size={18} />
      </ToolButton>
      <ToolButton label={t("toolbar.bulletList")} active={state.bullet} onClick={run(() => editor.chain().focus().toggleBulletList().run())}>
        <List size={18} />
      </ToolButton>
      <ToolButton label={t("toolbar.taskList")} active={state.task} onClick={run(() => editor.chain().focus().toggleTaskList().run())}>
        <ListChecks size={18} />
      </ToolButton>
      <Divider />
      <ToolButton label={t("toolbar.outdent")} disabled={!state.inList} onClick={run(() => editor.chain().focus().liftListItem(listItem).run())}>
        <IndentDecrease size={18} />
      </ToolButton>
      <ToolButton label={t("toolbar.indent")} disabled={!state.inList} onClick={run(() => editor.chain().focus().sinkListItem(listItem).run())}>
        <IndentIncrease size={18} />
      </ToolButton>
      <ToolButton label={t("toolbar.moveUp")} onClick={run(() => moveBlock(editor, -1))}>
        <ArrowUp size={18} />
      </ToolButton>
      <ToolButton label={t("toolbar.moveDown")} onClick={run(() => moveBlock(editor, 1))}>
        <ArrowDown size={18} />
      </ToolButton>
      <Divider />
      <ToolButton label={t("toolbar.undo")} disabled={!state.canUndo} onClick={run(() => editor.chain().focus().undo().run())}>
        <Undo2 size={18} />
      </ToolButton>
      <ToolButton label={t("toolbar.redo")} disabled={!state.canRedo} onClick={run(() => editor.chain().focus().redo().run())}>
        <Redo2 size={18} />
      </ToolButton>
      <span className="flex-1" />
      <ToolButton label={t("toolbar.done")} onClick={run(() => editor.commands.blur())}>
        <ChevronDown size={20} />
      </ToolButton>
    </div>
  );
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md disabled:opacity-30 ${active ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-white" : "text-neutral-600 dark:text-neutral-300"}`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-6 w-px shrink-0 bg-neutral-200 dark:bg-neutral-800" />;
