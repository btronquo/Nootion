import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { pluginNodeName, type ClientPluginInfo } from "@nootion/shared";
import { PluginBlockView, type PluginNodeOptions } from "./PluginBlockView";

/**
 * Editor nodes of every installed plugin's blocks, enabled or not: a page keeps its plugin blocks
 * (shown as placeholders) while a plugin is off. The block's data is kept as a JSON string.
 */
export function pluginNodes(plugins: ClientPluginInfo[]) {
  return plugins.flatMap((p) =>
    p.blocks.map((block) => {
      const name = pluginNodeName(p.id, block.id);
      return Node.create<PluginNodeOptions>({
        name,
        group: "block",
        atom: true,
        draggable: true,
        selectable: true,
        addOptions: () => ({ pluginId: p.id, pluginName: p.name, block }),
        addAttributes: () => ({ data: { default: JSON.stringify(block.defaultData) } }),
        parseHTML: () => [{ tag: `div[data-plugin-block="${name}"]`, getAttrs: (el) => ({ data: (el as HTMLElement).dataset.data ?? "{}" }) }],
        renderHTML: ({ node }) => ["div", { "data-plugin-block": name, "data-data": node.attrs.data }],
        addNodeView: () => ReactNodeViewRenderer(PluginBlockView),
      });
    }),
  );
}
