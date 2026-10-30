import { useState } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Settings2 } from "lucide-react";
import { buttonConfigSchema, emptyButtonConfig, t, type ButtonConfig } from "@nootion/shared";
import { usePage } from "../lib/queries";
import { ButtonAction } from "../buttons/ButtonAction";
import { ButtonEditor } from "../buttons/ButtonEditor";

const parse = (value: unknown): ButtonConfig => {
  const parsed = buttonConfigSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : emptyButtonConfig();
};

/** A button in a page: runs its steps when clicked; its settings open from the gear next to it. */
export function ButtonBlockView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const pageId = (extension.options as { pageId: string | null }).pageId;
  const config = parse(node.attrs.config);
  const editable = editor.isEditable && !!pageId;
  // A new button (no settings yet) opens its settings at once.
  const [editing, setEditing] = useState(editable && node.attrs.config === null);
  const page = usePage(pageId ?? "");
  const rowDatabaseId = page.data?.kind === "row" ? page.data.parentId : null;

  return (
    <NodeViewWrapper className="button-block group my-1 flex items-center gap-1" data-button-block={node.attrs.id} contentEditable={false}>
      <ButtonAction config={config} label={t("command.button")} source={pageId && node.attrs.id ? { kind: "block", pageId, blockId: node.attrs.id } : null} />
      {editable && (
        <button
          type="button"
          title={t("button.configure")}
          aria-label={t("button.configure")}
          onClick={() => setEditing(true)}
          className="rounded p-1 text-neutral-400 opacity-60 hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100 dark:hover:bg-neutral-800"
        >
          <Settings2 size={16} />
        </button>
      )}
      {editing &&
        // Outside the page's content, whose styles would apply to it.
        createPortal(
          <ButtonEditor
            initial={config}
            pageId={pageId}
            rowDatabaseId={rowDatabaseId}
            defaultLabel={t("command.button")}
            publicSource={pageId && node.attrs.id ? { pageId, blockId: node.attrs.id } : undefined}
            onClose={() => {
              setEditing(false);
              if (node.attrs.config === null) updateAttributes({ config: emptyButtonConfig() });
            }}
            onSave={(c) => {
              updateAttributes({ config: c });
              setEditing(false);
            }}
          />,
          document.body,
        )}
    </NodeViewWrapper>
  );
}
