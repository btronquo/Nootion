import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageBlockView } from "./ImageBlockView";
import { parseAlign, parseCrop, parseWidth } from "./imageGeometry";

/** The comment threads shown on an image, as decorations (see CommentHighlights), as a string to compare. */
function commentKey(decorations: readonly unknown[]): string {
  return decorations
    .map((d) => (d as { spec?: { commentThread?: string; active?: boolean } }).spec)
    .filter((s) => s?.commentThread)
    .map((s) => `${s!.commentThread}${s!.active ? "*" : ""}`)
    .join(",");
}

/** What the page around the editor offers image blocks: commenting one, and opening a thread from its badge. */
export interface ImageBlockStorage {
  /** Starts a comment on the image at this position; null when the reader can't comment. */
  onComment: ((pos: number) => void) | null;
  /** Opens a comment thread. */
  openThread: ((threadId: string) => void) | null;
}

declare module "@tiptap/core" {
  interface Storage {
    image: ImageBlockStorage;
  }
}

/**
 * The image block: the image of the content, with a width set by dragging its sides, an alignment, a caption and a
 * crop. The crop only changes what is shown: the file is kept whole, so it can be undone at any time.
 */
export const NootionImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => parseWidth(el.getAttribute("data-width") ?? el.getAttribute("width")),
        renderHTML: () => ({}),
      },
      align: { default: null, parseHTML: (el) => el.getAttribute("data-align"), renderHTML: () => ({}) },
      caption: {
        default: null,
        parseHTML: (el) => el.querySelector?.("figcaption")?.textContent ?? null,
        renderHTML: () => ({}),
      },
      crop: { default: null, parseHTML: (el) => parseCrop(el.getAttribute("data-crop")), renderHTML: () => ({}) },
    };
  },

  addStorage() {
    return { onComment: null, openThread: null } as ImageBlockStorage;
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-image]",
        getAttrs: (el) => {
          const img = (el as HTMLElement).querySelector("img");
          return img?.getAttribute("src") ? { src: img.getAttribute("src"), alt: img.getAttribute("alt"), title: img.getAttribute("title") } : false;
        },
      },
      ...(this.parent?.() ?? []),
    ];
  },

  /** As a figure in copied HTML, so that pasting it here again keeps its width, crop and caption. */
  renderHTML({ node, HTMLAttributes }) {
    const width = parseWidth(node.attrs.width);
    const crop = parseCrop(node.attrs.crop);
    const align = parseAlign(node.attrs.align);
    const caption = typeof node.attrs.caption === "string" && node.attrs.caption.trim() ? node.attrs.caption : null;
    const img = ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, width ? { width } : {})];
    return [
      "figure",
      {
        "data-image": "",
        "data-width": width ?? undefined,
        "data-align": align === "left" ? undefined : align,
        "data-crop": crop ? JSON.stringify(crop) : undefined,
      },
      img,
      ...(caption ? [["figcaption", {}, caption]] : []),
    ] as never;
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView, {
      // The toolbar, the handles and the caption are the view's own: the editor leaves their clicks and keys alone.
      stopEvent: ({ event }) => !!(event.target as Element | null)?.closest?.("[data-image-ui]"),
      // Redrawn when its comments change too (they come as decorations, which alone don't redraw a view).
      update: ({ oldNode, newNode, oldDecorations, newDecorations, updateProps }) => {
        if (newNode.type !== oldNode.type) return false;
        if (newNode !== oldNode || commentKey(oldDecorations) !== commentKey(newDecorations)) updateProps();
        return true;
      },
    });
  },
});
