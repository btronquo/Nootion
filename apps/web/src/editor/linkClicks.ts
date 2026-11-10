import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Opens text links when they are clicked in the editable editor (a contenteditable link does nothing on its own).
 * A link to a page of this site opens in the app; Ctrl/Cmd+click, or a link to another site, opens a new tab.
 * Alt+click or Shift+click places the cursor in the link instead, to edit its text.
 */
export const LinkClicks = Extension.create<{ navigate: ((path: string) => void) | null }>({
  name: "linkClicks",
  addOptions() {
    return { navigate: null };
  },
  addProseMirrorPlugins() {
    const { navigate } = this.options;
    return [
      new Plugin({
        key: new PluginKey("linkClicks"),
        props: {
          handleClick: (view, _pos, event) => {
            if (event.button !== 0 || !view.editable || event.altKey || event.shiftKey) return false;
            const link = (event.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>("a[href]");
            // Blocks drawn by their own components (page links, widgets...) handle their own links.
            if (!link || !view.dom.contains(link) || link.closest('[contenteditable="false"]')) return false;
            let url: URL;
            try {
              url = new URL(link.href, location.href);
            } catch {
              return false;
            }
            if (!/^(https?|mailto|tel):$/.test(url.protocol)) return false;
            event.preventDefault();
            if (navigate && url.origin === location.origin && !event.ctrlKey && !event.metaKey) navigate(url.pathname + url.search + url.hash);
            else window.open(url.href, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      }),
    ];
  },
});
