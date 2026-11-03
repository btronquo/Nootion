import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { TextSelection } from "@tiptap/pm/state";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  Link,
  List,
  ListOrdered,
  MessageSquare,
  Palette,
  Plus,
  Quote,
  Repeat2,
  Text,
  Trash2,
} from "lucide-react";
import { OPTION_COLORS, t, type MessageKey, type OptionColor } from "@nootion/shared";
import { Popover } from "../database/Popover";
import { isMac } from "../components/QuickCapture";
import { editedLabel } from "../components/EditedAt";
import { copyText } from "../lib/browser";
import { canTurnInto, currentKind, deleteBlock, duplicateBlock, moveBlock, stillThere, turnInto, type Block, type TurnInto } from "./blockActions";
import { canColor, ensureBlockId, lastEdit, setBlockColor, type BlockColor } from "./blockAttrs";

/**
 * The handles shown left of the block under the mouse, as in Notion: "+" adds a block below it (the "/" menu opens),
 * and the dots move it by dragging, or open the block's menu with a click.
 */
export function BlockHandle({
  editor,
  pageId,
  onComment,
  personName,
}: {
  editor: Editor;
  pageId: string;
  onComment?: () => void;
  /** Today's name of someone, from their id (the one kept in the block may be older). */
  personName?: (id: string) => string | undefined;
}) {
  const current = useRef<Block | null>(null);
  const grip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    block: Block;
    anchor: HTMLElement;
  } | null>(null);

  function addBelow() {
    const block = current.current;
    if (!block) return;
    const { node, pos } = block;
    // An empty line takes the "/" itself.
    if (node.type.name === "paragraph" && node.content.size === 0) {
      editor
        .chain()
        .focus()
        .insertContentAt(pos + 1, "/")
        .run();
      return;
    }
    const after = pos + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(after, {
        type: "paragraph",
        content: [{ type: "text", text: "/" }],
      })
      .setTextSelection(after + 2)
      .run();
  }

  function openMenu() {
    const block = current.current;
    if (!block || !grip.current) return;
    // Not focused: the menu's search takes the keys (the editor's focus would come back a frame later).
    editor.commands.setNodeSelection(block.pos);
    // A fixed spot: the handle moves away with the mouse.
    const r = grip.current.getBoundingClientRect();
    const anchor = {
      getBoundingClientRect: () => r,
      contains: () => false,
    } as unknown as HTMLElement;
    setMenu({ block, anchor });
  }

  const button = "flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800";
  return (
    <>
      <DragHandle editor={editor} nested onNodeChange={({ node, pos }) => (current.current = node ? { node, pos } : null)}>
        <div className="nt-block-handle flex items-center pr-1" data-block-handle>
          <button type="button" className={button} onClick={addBelow} title={t("editor.addBelow")} aria-label={t("editor.addBelow")}>
            <Plus size={16} />
          </button>
          <div
            ref={grip}
            role="button"
            tabIndex={-1}
            aria-haspopup="menu"
            className={`${button} cursor-grab active:cursor-grabbing`}
            title={t("editor.dragBlock")}
            aria-label={t("editor.dragBlock")}
            onClick={openMenu}
            data-block-grip
          >
            <GripVertical size={16} />
          </div>
        </div>
      </DragHandle>
      {menu && (
        <BlockMenu
          editor={editor}
          pageId={pageId}
          block={menu.block}
          anchor={menu.anchor}
          onComment={onComment}
          personName={personName}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

interface Action {
  id: string;
  label: string;
  icon: ReactNode;
  keys?: string;
  danger?: boolean;
  checked?: boolean;
  /** Opens a submenu. */
  sub?: "turn" | "color";
  /** A heading above the item, in a submenu. */
  section?: string;
  run: () => void;
}

const KINDS: { kind: TurnInto; label: () => string; icon: ReactNode }[] = [
  { kind: "paragraph", label: () => t("command.text"), icon: <Text size={16} /> },
  { kind: "h1", label: () => t("command.h1"), icon: <Heading1 size={16} /> },
  { kind: "h2", label: () => t("command.h2"), icon: <Heading2 size={16} /> },
  { kind: "h3", label: () => t("command.h3"), icon: <Heading3 size={16} /> },
  { kind: "bulletList", label: () => t("command.bullets"), icon: <List size={16} /> },
  { kind: "orderedList", label: () => t("command.numbers"), icon: <ListOrdered size={16} /> },
  { kind: "taskList", label: () => t("command.todo"), icon: <CheckSquare size={16} /> },
  { kind: "blockquote", label: () => t("command.quote"), icon: <Quote size={16} /> },
  { kind: "callout", label: () => t("command.callout"), icon: <Lightbulb size={16} /> },
  { kind: "codeBlock", label: () => t("command.code"), icon: <Code size={16} /> },
];

/** The sample of a color in its menu: an "A" in the text color, or on the background color. */
function Swatch({ color }: { color: BlockColor | null }) {
  return (
    <span
      data-color={color ?? undefined}
      className="nt-swatch flex h-5 w-5 items-center justify-center rounded border border-neutral-200 text-xs font-semibold dark:border-neutral-700"
    >
      A
    </span>
  );
}

/** The menu of a block (a click on its dots): turn into, color, copy link, duplicate, move, comment, delete. */
function BlockMenu({
  editor,
  pageId,
  block,
  anchor,
  onComment,
  personName,
  onClose,
}: {
  editor: Editor;
  pageId: string;
  block: Block;
  anchor: HTMLElement;
  onComment?: () => void;
  personName?: (id: string) => string | undefined;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sub, setSub] = useState<"turn" | "color" | null>(null);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, []);
  const mod = isMac() ? "⌘" : "Ctrl+";
  const shift = isMac() ? "⇧" : "Shift+";

  // The page changed under the menu (someone else's edit): it no longer points at the right block.
  useEffect(() => {
    const check = () => !stillThere(editor, block) && onClose();
    editor.on("update", check);
    return () => {
      editor.off("update", check);
    };
  }, [editor, block, onClose]);

  const act = (fn: () => void) => () => {
    onClose();
    if (stillThere(editor, block)) fn();
  };
  const open = (which: "turn" | "color") => () => (setSub(which), setActive(0), setQuery(""));
  const kind = currentKind(block);
  const kinds: Action[] = canTurnInto(block)
    ? KINDS.map((k) => ({
        id: `into-${k.kind}`,
        label: k.label(),
        icon: k.icon,
        checked: kind === k.kind,
        run: act(() => turnInto(editor, block, k.kind)),
      }))
    : [];
  const color = (block.node.attrs.color as BlockColor | null) ?? null;
  const colorItem = (c: BlockColor | null, label: string, section?: string): Action => ({
    id: `color-${c ?? "none"}${section === t("block.background") ? "-bg" : ""}`,
    label,
    icon: <Swatch color={c} />,
    checked: color === c && (c !== null || section === t("block.textColor")),
    section,
    run: act(() => setBlockColor(editor, block.pos, c)),
  });
  const colorName = (c: OptionColor) => t(`color.${c}` as MessageKey);
  const colors: Action[] = canColor(block.node)
    ? [
        colorItem(null, t("block.defaultColor"), t("block.textColor")),
        ...OPTION_COLORS.map((c) => colorItem(c, colorName(c))),
        colorItem(null, t("block.defaultBackground"), t("block.background")),
        ...OPTION_COLORS.map((c) => colorItem(`${c}-bg`, colorName(c))),
      ]
    : [];

  const actions: Action[] = [
    ...(kinds.length ? [{ id: "turn", label: t("block.turnInto"), icon: <Repeat2 size={16} />, sub: "turn" as const, run: open("turn") }] : []),
    ...(colors.length ? [{ id: "color", label: t("block.color"), icon: <Palette size={16} />, sub: "color" as const, run: open("color") }] : []),
    {
      id: "link",
      label: copied ? t("block.linkCopied") : t("block.copyLink"),
      icon: copied ? <Check size={16} /> : <Link size={16} />,
      run: () => {
        if (!stillThere(editor, block)) return onClose();
        const id = ensureBlockId(editor, block.pos);
        if (!id) return onClose();
        void copyText(`${window.location.origin}/page/${pageId}#block-${id}`).then((ok) => {
          if (!ok) return onClose();
          setCopied(true);
          window.setTimeout(onClose, 700);
        });
      },
    },
    { id: "duplicate", label: t("block.duplicate"), icon: <Copy size={16} />, keys: `${mod}D`, run: act(() => duplicateBlock(editor, block)) },
    { id: "up", label: t("block.moveUp"), icon: <ArrowUp size={16} />, keys: `${mod}${shift}↑`, run: act(() => moveBlock(editor, block, -1)) },
    { id: "down", label: t("block.moveDown"), icon: <ArrowDown size={16} />, keys: `${mod}${shift}↓`, run: act(() => moveBlock(editor, block, 1)) },
    ...(onComment && block.node.textContent.trim()
      ? [
          {
            id: "comment",
            label: t("block.comment"),
            icon: <MessageSquare size={16} />,
            run: act(() => {
              // The block's text, as if selected by hand.
              const { pos, node } = block;
              editor
                .chain()
                .focus()
                .command(({ tr }) => {
                  tr.setSelection(TextSelection.between(tr.doc.resolve(pos + 1), tr.doc.resolve(pos + node.nodeSize - 1)));
                  return true;
                })
                .run();
              onComment();
            }),
          },
        ]
      : []),
    {
      id: "delete",
      label: t("block.delete"),
      icon: <Trash2 size={16} />,
      keys: isMac() ? "⌫" : t("block.deleteKey"),
      danger: true,
      run: act(() => deleteBlock(editor, block)),
    },
  ];

  // Typing searches every action, those of the submenus included.
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return sub === "turn" ? kinds : sub === "color" ? colors : actions;
    const prefixed = (list: Action[], prefix: string) => list.map((a) => ({ ...a, section: undefined, label: `${prefix} : ${a.label}` }));
    return [
      ...actions.filter((a) => !a.sub),
      ...prefixed(kinds, t("block.turnInto")),
      ...prefixed(colors.slice(0, OPTION_COLORS.length + 1), t("block.textColor")),
      ...prefixed(colors.slice(OPTION_COLORS.length + 1), t("block.background")),
    ].filter((a) => {
      // Every word, in any order: "blue back" finds "Background: Blue".
      const label = a.label.toLocaleLowerCase();
      return q.split(/\s+/).every((w) => label.includes(w));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sub, block, copied]);
  const index = Math.min(active, Math.max(0, shown.length - 1));
  const edit = lastEdit(block.node);

  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <div
        role="menu"
        data-block-menu
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((index + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % Math.max(1, shown.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            shown[index]?.run();
          } else if (e.key === "ArrowLeft" && sub && !query) {
            e.preventDefault();
            setSub(null);
          } else if (e.key === "ArrowRight" && shown[index]?.sub) {
            e.preventDefault();
            shown[index].run();
          }
        }}
      >
        <input
          ref={search}
          value={query}
          onChange={(e) => (setQuery(e.target.value), setActive(0))}
          placeholder={t("block.search")}
          aria-label={t("block.search")}
          className="mb-1 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
        />
        {sub && !query && (
          <button
            type="button"
            onClick={() => setSub(null)}
            className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <ChevronLeft size={14} /> {sub === "turn" ? t("block.turnInto") : t("block.color")}
          </button>
        )}
        <div className={sub === "color" && !query ? "max-h-80 overflow-y-auto" : undefined}>
          {shown.map((a, i) => (
            <div key={a.id}>
              {(a.id === "link" || a.id === "comment" || a.id === "delete") && !query && <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-800" />}
              {a.section && <p className="px-2 pt-2 pb-1 text-xs font-medium text-neutral-500">{a.section}</p>}
              <button
                type="button"
                role="menuitem"
                onClick={a.run}
                onMouseEnter={() => setActive(i)}
                data-action={a.id}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${i === index ? "bg-neutral-100 dark:bg-neutral-800" : ""} ${a.danger ? "text-red-600 dark:text-red-400" : ""}`}
              >
                <span className="flex w-5 shrink-0 justify-center text-neutral-500">{a.icon}</span>
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {a.keys && <span className="shrink-0 text-xs text-neutral-400">{a.keys}</span>}
                {a.checked && <Check size={14} className="shrink-0 text-neutral-500" />}
                {a.sub && <ChevronRight size={14} className="shrink-0 text-neutral-400" />}
              </button>
            </div>
          ))}
        </div>
        {!shown.length && <p className="px-2 py-1.5 text-neutral-500">{t("block.noAction")}</p>}
        {edit && !sub && !query && (
          <div className="mt-1 border-t border-neutral-200 px-2 pt-2 pb-1 text-xs text-neutral-500 dark:border-neutral-800" data-block-edited>
            <p className="truncate">{t("block.editedBy", { name: (edit.by && personName?.(edit.by)) || edit.name || t("block.someone") })}</p>
            <p>{editedLabel(new Date(edit.at))}</p>
          </div>
        )}
      </div>
    </Popover>
  );
}
