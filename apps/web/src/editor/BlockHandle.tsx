import { useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { Node } from "@tiptap/pm/model";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { GripVertical, Plus } from "lucide-react";
import { t } from "@nootion/shared";

/**
 * The handles shown left of the block under the mouse, as in Notion: "+" adds a block below it (the "/" menu opens),
 * and the dots move it by dragging, or select it with a click.
 */
export function BlockHandle({ editor }: { editor: Editor }) {
  const current = useRef<{ node: Node; pos: number } | null>(null);

  function addBelow() {
    const block = current.current;
    if (!block) return;
    const { node, pos } = block;
    // An empty line takes the "/" itself.
    if (node.type.name === "paragraph" && node.content.size === 0) {
      editor.chain().focus().insertContentAt(pos + 1, "/").run();
      return;
    }
    const after = pos + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(after, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .setTextSelection(after + 2)
      .run();
  }

  const button = "flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800";
  return (
    <DragHandle editor={editor} nested onNodeChange={({ node, pos }) => (current.current = node ? { node, pos } : null)}>
      <div className="nt-block-handle flex items-center pr-1" data-block-handle>
        <button type="button" className={button} onClick={addBelow} title={t("editor.addBelow")} aria-label={t("editor.addBelow")}>
          <Plus size={16} />
        </button>
        <div
          role="button"
          tabIndex={-1}
          className={`${button} cursor-grab active:cursor-grabbing`}
          title={t("editor.dragBlock")}
          aria-label={t("editor.dragBlock")}
          onClick={() => current.current && editor.chain().focus().setNodeSelection(current.current.pos).run()}
        >
          <GripVertical size={16} />
        </div>
      </div>
    </DragHandle>
  );
}
