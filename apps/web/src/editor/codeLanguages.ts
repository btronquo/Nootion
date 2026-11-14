import { createLowlight } from "lowlight";
import type { LanguageFn } from "highlight.js";

/**
 * Languages of code blocks. Each one's grammar is loaded the first time a block needs it, so pages without code
 * don't download any of them.
 */
export type CodeLanguage = { id: string; label: string; load: () => Promise<{ default: LanguageFn }> };

// Literal paths: the bundler makes one small file per grammar.
export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: "bash", label: "Bash / Shell", load: () => import("highlight.js/lib/languages/bash") },
  { id: "c", label: "C", load: () => import("highlight.js/lib/languages/c") },
  { id: "cpp", label: "C++", load: () => import("highlight.js/lib/languages/cpp") },
  { id: "csharp", label: "C#", load: () => import("highlight.js/lib/languages/csharp") },
  { id: "css", label: "CSS", load: () => import("highlight.js/lib/languages/css") },
  { id: "dart", label: "Dart", load: () => import("highlight.js/lib/languages/dart") },
  { id: "diff", label: "Diff", load: () => import("highlight.js/lib/languages/diff") },
  { id: "dockerfile", label: "Dockerfile", load: () => import("highlight.js/lib/languages/dockerfile") },
  { id: "elixir", label: "Elixir", load: () => import("highlight.js/lib/languages/elixir") },
  { id: "go", label: "Go", load: () => import("highlight.js/lib/languages/go") },
  { id: "graphql", label: "GraphQL", load: () => import("highlight.js/lib/languages/graphql") },
  { id: "haskell", label: "Haskell", load: () => import("highlight.js/lib/languages/haskell") },
  { id: "xml", label: "HTML / XML", load: () => import("highlight.js/lib/languages/xml") },
  { id: "ini", label: "INI / TOML", load: () => import("highlight.js/lib/languages/ini") },
  { id: "java", label: "Java", load: () => import("highlight.js/lib/languages/java") },
  { id: "javascript", label: "JavaScript", load: () => import("highlight.js/lib/languages/javascript") },
  { id: "json", label: "JSON", load: () => import("highlight.js/lib/languages/json") },
  { id: "kotlin", label: "Kotlin", load: () => import("highlight.js/lib/languages/kotlin") },
  { id: "latex", label: "LaTeX", load: () => import("highlight.js/lib/languages/latex") },
  { id: "lua", label: "Lua", load: () => import("highlight.js/lib/languages/lua") },
  { id: "makefile", label: "Makefile", load: () => import("highlight.js/lib/languages/makefile") },
  { id: "markdown", label: "Markdown", load: () => import("highlight.js/lib/languages/markdown") },
  { id: "objectivec", label: "Objective-C", load: () => import("highlight.js/lib/languages/objectivec") },
  { id: "perl", label: "Perl", load: () => import("highlight.js/lib/languages/perl") },
  { id: "php", label: "PHP", load: () => import("highlight.js/lib/languages/php") },
  { id: "powershell", label: "PowerShell", load: () => import("highlight.js/lib/languages/powershell") },
  { id: "python", label: "Python", load: () => import("highlight.js/lib/languages/python") },
  { id: "r", label: "R", load: () => import("highlight.js/lib/languages/r") },
  { id: "ruby", label: "Ruby", load: () => import("highlight.js/lib/languages/ruby") },
  { id: "rust", label: "Rust", load: () => import("highlight.js/lib/languages/rust") },
  { id: "scala", label: "Scala", load: () => import("highlight.js/lib/languages/scala") },
  { id: "scss", label: "SCSS", load: () => import("highlight.js/lib/languages/scss") },
  { id: "sql", label: "SQL", load: () => import("highlight.js/lib/languages/sql") },
  { id: "swift", label: "Swift", load: () => import("highlight.js/lib/languages/swift") },
  { id: "typescript", label: "TypeScript", load: () => import("highlight.js/lib/languages/typescript") },
  { id: "yaml", label: "YAML", load: () => import("highlight.js/lib/languages/yaml") },
];

/** A block that is plain text on purpose: never coloured nor guessed. */
export const PLAIN_TEXT = "plaintext";

/** Languages tried when a block has none: the most common ones, so that guessing stays fast and sensible. */
export const DETECTED = [
  "javascript",
  "typescript",
  "python",
  "bash",
  "json",
  "xml",
  "css",
  "sql",
  "java",
  "go",
  "rust",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "yaml",
];

// Names other tools and Markdown fences give (imports keep them as they are).
const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  python3: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  shellsession: "bash",
  "c++": "cpp",
  cc: "cpp",
  hpp: "cpp",
  h: "c",
  "c#": "csharp",
  cs: "csharp",
  html: "xml",
  htm: "xml",
  xhtml: "xml",
  svg: "xml",
  vue: "xml",
  yml: "yaml",
  md: "markdown",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  golang: "go",
  ps: "powershell",
  ps1: "powershell",
  pwsh: "powershell",
  "objective-c": "objectivec",
  objc: "objectivec",
  docker: "dockerfile",
  make: "makefile",
  mk: "makefile",
  tex: "latex",
  toml: "ini",
  gql: "graphql",
  patch: "diff",
  text: PLAIN_TEXT,
  txt: PLAIN_TEXT,
  plain: PLAIN_TEXT,
  "plain text": PLAIN_TEXT,
};

const BY_ID = new Map(CODE_LANGUAGES.map((l) => [l.id, l]));

/** The language a block's name stands for ("JS", "c++", "plain text"…), or null when it isn't one we colour. */
export function resolveLanguage(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  const id = ALIASES[key] ?? key;
  return id === PLAIN_TEXT || BY_ID.has(id) ? id : null;
}

/** The name shown for a language id, or the name itself when it is one we don't know (kept from an import). */
export function languageLabel(name: string): string {
  const id = resolveLanguage(name);
  return (id && BY_ID.get(id)?.label) || name;
}

export const lowlight = createLowlight();

const loading = new Map<string, Promise<void>>();

export const isLoaded = (id: string) => lowlight.registered(id);

/** Loads a language's grammar once; resolves when it can be used (or failed to load, offline). */
export function loadLanguage(id: string): Promise<void> {
  const language = BY_ID.get(id);
  if (!language || isLoaded(id)) return Promise.resolve();
  let promise = loading.get(id);
  if (!promise) {
    promise = language
      .load()
      .then((m) => lowlight.register(id, m.default))
      // Offline and not cached: the block stays plain until the page is opened again.
      .catch(() => undefined);
    loading.set(id, promise);
  }
  return promise;
}
