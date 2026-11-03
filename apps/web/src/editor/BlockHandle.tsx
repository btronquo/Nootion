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
  List,
  ListOrdered,
  MessageSquare,
  Plus,
  Quote,
  Repeat2,
  Text,
  Trash2,
} from "lucide-react";
import { t } from "@nootion/shared";
import { Popover } from "../database/Popover";
import { isMac } from "../components/QuickCapture";
import { canTurnInto, currentKind, deleteBlock, duplicateBlock, moveBlock, stillThere, turnInto, type Block, type TurnInto } from "./blockActions";

/**
 * The handles shown left of the block under the mouse, as in Notion: "+" adds a block below it (the "/" menu opens),
 * and the dots move it by dragging, or open the block's menu with a click.
 */
export function BlockHandle({ editor, onComment }: { editor: Editor; onComment?: () => void }) {
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
      {menu && <BlockMenu editor={editor} block={menu.block} anchor={menu.anchor} onComment={onComment} onClose={() => setMenu(null)} />}
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
  /** Opens "Turn into". */
  sub?: boolean;
  run: () => void;
}

const KINDS: { kind: TurnInto; label: () => string; icon: ReactNode }[] = [
  {
    kind: "paragraph",
    label: () => t("command.text"),
    icon: <Text size={16} />,
  },
  { kind: "h1", label: () => t("command.h1"), icon: <Heading1 size={16} /> },
  { kind: "h2", label: () => t("command.h2"), icon: <Heading2 size={16} /> },
  { kind: "h3", label: () => t("command.h3"), icon: <Heading3 size={16} /> },
  {
    kind: "bulletList",
    label: () => t("command.bullets"),
    icon: <List size={16} />,
  },
  {
    kind: "orderedList",
    label: () => t("command.numbers"),
    icon: <ListOrdered size={16} />,
  },
  {
    kind: "taskList",
    label: () => t("command.todo"),
    icon: <CheckSquare size={16} />,
  },
  {
    kind: "blockquote",
    label: () => t("command.quote"),
    icon: <Quote size={16} />,
  },
  {
    kind: "callout",
    label: () => t("command.callout"),
    icon: <Lightbulb size={16} />,
  },
  {
    kind: "codeBlock",
    label: () => t("command.code"),
    icon: <Code size={16} />,
  },
];

/** The menu of a block (a click on its dots): turn into, duplicate, move, delete, comment. */
function BlockMenu({
  editor,
  block,
  anchor,
  onComment,
  onClose,
}: {
  editor: Editor;
  block: Block;
  anchor: HTMLElement;
  onComment?: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sub, setSub] = useState(false);
  const [active, setActive] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => search.current?.focus());
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
  const actions: Action[] = [
    ...(kinds.length
      ? [
          {
            id: "turn",
            label: t("block.turnInto"),
            icon: <Repeat2 size={16} />,
            sub: true,
            run: () => (setSub(true), setActive(0)),
          },
        ]
      : []),
    {
      id: "duplicate",
      label: t("block.duplicate"),
      icon: <Copy size={16} />,
      keys: `${mod}D`,
      run: act(() => duplicateBlock(editor, block)),
    },
    {
      id: "up",
      label: t("block.moveUp"),
      icon: <ArrowUp size={16} />,
      keys: `${mod}${shift}↑`,
      run: act(() => moveBlock(editor, block, -1)),
    },
    {
      id: "down",
      label: t("block.moveDown"),
      icon: <ArrowDown size={16} />,
      keys: `${mod}${shift}↓`,
      run: act(() => moveBlock(editor, block, 1)),
    },
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

  // Typing searches every action, "Turn into" ones included.
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (sub && !q) return kinds;
    if (!q) return actions;
    return [
      ...actions.filter((a) => !a.sub),
      ...kinds.map((k) => ({
        ...k,
        label: `${t("block.turnInto")} : ${k.label}`,
      })),
    ].filter((a) => a.label.toLocaleLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sub, block]);
  const index = Math.min(active, Math.max(0, shown.length - 1));

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
            setSub(false);
          } else if (e.key === "ArrowRight" && shown[index]?.sub) {
            e.preventDefault();
            shown[index].run();
          }
        }}
      >
        <input
          ref={search}
          autoFocus
          value={query}
          onChange={(e) => (setQuery(e.target.value), setActive(0))}
          placeholder={t("block.search")}
          aria-label={t("block.search")}
          className="mb-1 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
        />
        {sub && !query && (
          <button
            type="button"
            onClick={() => setSub(false)}
            className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <ChevronLeft size={14} /> {t("block.turnInto")}
          </button>
        )}
        {shown.map((a, i) => (
          <div key={a.id}>
            {(a.id === "comment" || a.id === "delete") && !query && <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-800" />}
            <button
              type="button"
              role="menuitem"
              onClick={a.run}
              onMouseEnter={() => setActive(i)}
              data-action={a.id}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${i === index ? "bg-neutral-100 dark:bg-neutral-800" : ""} ${a.danger ? "text-red-600 dark:text-red-400" : ""}`}
            >
              <span className="flex w-4 shrink-0 justify-center text-neutral-500">{a.icon}</span>
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
              {a.keys && <span className="shrink-0 text-xs text-neutral-400">{a.keys}</span>}
              {a.checked && <Check size={14} className="shrink-0 text-neutral-500" />}
              {a.sub && <ChevronRight size={14} className="shrink-0 text-neutral-400" />}
            </button>
          </div>
        ))}
        {!shown.length && <p className="px-2 py-1.5 text-neutral-500">{t("block.noAction")}</p>}
      </div>
    </Popover>
  );
}
