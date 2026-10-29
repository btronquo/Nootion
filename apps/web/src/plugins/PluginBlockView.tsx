import { Component, type ReactNode } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { PluginBlock } from "@nootion/shared";
import { blockRenderer } from "./registry";
import { t } from "@nootion/shared";

export interface PluginNodeOptions {
  pluginId: string;
  pluginName: string;
  block: PluginBlock;
}

class Boundary extends Component<{ children: ReactNode; label: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    return this.state.error ? (
      <Placeholder>
        {t("plugins.blockCrashed", { block: this.props.label, error: this.state.error })}
      </Placeholder>
    ) : (
      this.props.children
    );
  }
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700">🧩 {children}</div>
  );
}

function parse(data: unknown): Record<string, unknown> {
  try {
    const v = typeof data === "string" ? JSON.parse(data) : data;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A block of a plugin in a page: drawn by the plugin's component, or a placeholder when the plugin is off. */
export function PluginBlockView({ node, extension, editor, updateAttributes }: NodeViewProps) {
  const { pluginId, pluginName, block } = extension.options as PluginNodeOptions;
  const Renderer = blockRenderer(pluginId, block.id);
  return (
    <NodeViewWrapper className="plugin-block my-2" contentEditable={false} data-drag-handle="">
      {Renderer ? (
        <Boundary label={block.title}>
          <Renderer data={parse(node.attrs.data)} setData={(d) => updateAttributes({ data: JSON.stringify(d) })} editable={editor.isEditable} />
        </Boundary>
      ) : (
        <Placeholder>
          {t("plugins.blockDisabled", { block: block.title, plugin: pluginName })}
        </Placeholder>
      )}
    </NodeViewWrapper>
  );
}
