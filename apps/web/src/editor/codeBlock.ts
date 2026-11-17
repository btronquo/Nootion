import CodeBlock from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { DETECTED, MERMAID, PLAIN_TEXT, isLoaded, loadLanguage, lowlight, resolveLanguage } from "./codeLanguages";
import { CodeBlockView } from "./CodeBlockView";

/** Past this size a block stays plain: colouring it would slow typing down. */
const MAX_LENGTH = 100_000;
/** How sure the guess must be: short snippets are often ambiguous, and wrong colours are worse than none. */
const MIN_RELEVANCE = 5;

type Span = { from: number; to: number; className: string };
type Highlight = { spans: Span[]; detected: string | null; version: number };

// Bumped each time a grammar arrives: blocks waiting for it are coloured again.
let version = 0;
const views = new Set<EditorView>();
const refresh = () => {
  version++;
  for (const view of views) if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true).setMeta("addToHistory", false));
};
const request = (ids: string[]) => {
  const missing = ids.filter((id) => !isLoaded(id));
  if (missing.length) void Promise.all(missing.map(loadLanguage)).then(refresh);
};

type HastNode = { type: string; value?: string; children?: HastNode[]; properties?: { className?: string[] } };

function flatten(nodes: HastNode[], classes: string[], out: Span[], at: { pos: number }) {
  for (const n of nodes) {
    if (n.type === "text") {
      const len = n.value?.length ?? 0;
      if (len && classes.length) out.push({ from: at.pos, to: at.pos + len, className: classes.join(" ") });
      at.pos += len;
    } else if (n.children) flatten(n.children, n.properties?.className ? [...classes, ...n.properties.className] : classes, out, at);
  }
}

// Blocks are immutable: an unchanged block keeps its colours from one keystroke to the next.
const cache = new WeakMap<PMNode, Highlight>();

/** The colours of a block, from its offset 0; empty while its grammar loads. */
export function highlightBlock(node: PMNode): Highlight {
  const cached = cache.get(node);
  if (cached && cached.version === version) return cached;
  const result: Highlight = { spans: [], detected: null, version };
  const text = node.textContent;
  const name = node.attrs.language as string | null;
  if (text && text.length <= MAX_LENGTH) {
    let tree: ReturnType<typeof lowlight.highlight> | null = null;
    if (name) {
      const id = resolveLanguage(name);
      if (id && id !== PLAIN_TEXT && id !== MERMAID) {
        if (isLoaded(id)) tree = lowlight.highlight(id, text);
        else request([id]);
      }
    } else if (DETECTED.every(isLoaded)) {
      const guess = lowlight.highlightAuto(text, { subset: DETECTED });
      if ((guess.data?.relevance ?? 0) >= MIN_RELEVANCE) {
        tree = guess;
        result.detected = guess.data?.language ?? null;
      }
    } else request(DETECTED);
    if (tree) flatten(tree.children as HastNode[], [], result.spans, { pos: 0 });
  }
  cache.set(node, result);
  return result;
}

type Found = { node: PMNode; pos: number };

function codeBlocks(doc: PMNode, name: string): Found[] {
  const found: Found[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === name) found.push({ node, pos });
    // Nothing to find inside a paragraph, a heading or an atom.
    return !node.isTextblock && !node.isAtom;
  });
  return found;
}

function decorate(doc: PMNode, blocks: Found[]): DecorationSet {
  const decorations: Decoration[] = [];
  for (const { node, pos } of blocks) {
    const { spans, detected } = highlightBlock(node);
    const start = pos + 1;
    for (const s of spans) decorations.push(Decoration.inline(start + s.from, start + s.to, { class: s.className }));
    // Read by the block's view, to show the language it guessed.
    if (detected) decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { detectedLanguage: detected }));
  }
  return DecorationSet.create(doc, decorations);
}

const key = new PluginKey<{ set: DecorationSet; blocks: Found[] }>("codeHighlight");

const sameBlocks = (a: Found[], b: Found[]) => a.length === b.length && a.every((f, i) => f.node === b[i]!.node);

/** Colours code blocks' text by their language, or by the language guessed when they have none. */
function highlightPlugin(name: string) {
  return new Plugin({
    key,
    state: {
      init: (_, { doc }) => {
        const blocks = codeBlocks(doc, name);
        return { set: decorate(doc, blocks), blocks };
      },
      apply: (tr, value) => {
        const forced = tr.getMeta(key) === true;
        if (!tr.docChanged && !forced) return value;
        const blocks = codeBlocks(tr.doc, name);
        // Typing outside code blocks: their colours only move.
        if (!forced && sameBlocks(blocks, value.blocks)) return { set: value.set.map(tr.mapping, tr.doc), blocks };
        return { set: decorate(tr.doc, blocks), blocks };
      },
    },
    props: { decorations: (state) => key.getState(state)?.set },
    view: (view) => {
      views.add(view);
      return { destroy: () => views.delete(view) };
    },
  });
}

/**
 * Code block with a language menu, a copy button and optional line wrapping. Its text is coloured by the language
 * chosen, or guessed when there is none. The language is the attribute the block already had, so exports, imports
 * and existing pages don't change.
 */
export const NootionCodeBlock = CodeBlock.extend({
  addOptions() {
    return { ...this.parent!(), enableTabIndentation: true, tabSize: 2 };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      wrap: {
        default: false,
        parseHTML: (el) => el.hasAttribute("data-wrap"),
        renderHTML: (attrs) => (attrs.wrap ? { "data-wrap": "" } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), highlightPlugin(this.name)];
  },
});
