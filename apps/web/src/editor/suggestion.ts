import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { SuggestionMenu, type MenuItem, type SuggestionMenuHandle } from "./SuggestionMenu";

export type ItemsFn = (args: { query: string; editor: Editor; range: Range }) => MenuItem[] | Promise<MenuItem[]>;

/** Builds an extension that opens a SuggestionMenu after typing `char`. */
export function createSuggestionExtension(name: string, char: string, items: ItemsFn, empty: string) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      const options: Omit<SuggestionOptions<MenuItem>, "editor"> = {
        char,
        pluginKey: new PluginKey(name),
        allowSpaces: true,
        startOfLine: false,
        items: ({ query, editor }) => items({ query, editor, range: { from: 0, to: 0 } }),
        command: ({ props }) => props.run(),
        render: () => {
          let renderer: ReactRenderer<SuggestionMenuHandle> | null = null;
          let popup: HTMLDivElement | null = null;
          const place = (rect: DOMRect | null | undefined) => {
            if (!popup || !rect) return;
            // On phones the keyboard hides the bottom of the screen: only the visual viewport is free,
            // minus the editing toolbar above the keyboard.
            const vv = window.visualViewport;
            const visibleBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - (document.querySelector(".mobile-toolbar")?.clientHeight ?? 0);
            const visibleTop = vv?.offsetTop ?? 0;
            const below = rect.bottom + 6;
            const spaceBelow = visibleBottom - below - 8;
            const spaceAbove = rect.top - 6 - visibleTop - 8;
            const fitsBelow = spaceBelow >= 320 || spaceBelow >= spaceAbove;
            popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 296))}px`;
            popup.style.top = fitsBelow ? `${below}px` : "";
            popup.style.bottom = fitsBelow ? "" : `${window.innerHeight - rect.top + 6}px`;
            popup.style.setProperty("--menu-max", `${Math.max(120, Math.min(320, fitsBelow ? spaceBelow : spaceAbove))}px`);
          };
          // Each item runs with the range of the typed trigger, so it can replace it.
          const bind = (props: { items: MenuItem[]; editor: Editor; range: Range }) =>
            props.items.map((it) => ({ ...it, run: () => (it as MenuItem & { runIn?: (e: Editor, r: Range) => void }).runIn?.(props.editor, props.range) ?? it.run() }));
          return {
            onStart: (props) => {
              popup = document.createElement("div");
              popup.style.position = "fixed";
              popup.style.zIndex = "60";
              document.body.appendChild(popup);
              renderer = new ReactRenderer(SuggestionMenu, { props: { items: bind(props), empty }, editor: props.editor });
              popup.appendChild(renderer.element);
              place(props.clientRect?.());
            },
            onUpdate: (props) => {
              renderer?.updateProps({ items: bind(props), empty });
              place(props.clientRect?.());
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                popup?.remove();
                return true;
              }
              return renderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              renderer?.destroy();
              popup?.remove();
              renderer = null;
              popup = null;
            },
          };
        },
      };
      return [Suggestion({ editor: this.editor, ...options })];
    },
  });
}

/** A menu item that first deletes the typed trigger ("/heading1") then runs its action. */
export function item(title: string, hint: string, icon: MenuItem["icon"], action: (editor: Editor, range: Range) => void, keywords = ""): MenuItem & { runIn: (e: Editor, r: Range) => void; keywords: string } {
  return { title, hint, icon, keywords, run: () => {}, runIn: action };
}
