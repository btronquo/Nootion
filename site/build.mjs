// Builds Nootion's website into site/dist, ready for GitHub Pages:
//   - the home page (src/index.html) and its assets (src/assets);
//   - the documentation: the guides of docs/ (the same files as in the repository, so there is only one copy of them)
//     and the pages of site/content/, turned into HTML pages with a sidebar, a table of contents and a search;
//   - the screenshots of docs/screenshots and the app's icons.
// Every link is relative, so the site works at https://<user>.github.io/<repo>/ as well as on its own domain.
// Usage: node build.mjs (from site/, or with npm run build).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, Renderer } from "marked";

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SITE, "..");
const DIST = path.join(SITE, "dist");
const REPO = "https://github.com/btronquo/Nootion";
const SITE_URL = "https://btronquo.github.io/Nootion/";
const ICONS = path.join(SITE, "node_modules/@phosphor-icons/core/assets/regular");

const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

// The documentation, in the order of the sidebar. "file" is relative to the repository; "slug" is the page's address.
const SECTIONS = [
  {
    title: "Start here",
    pages: [
      { slug: "introduction", file: "site/content/introduction.md" },
      { slug: "features", file: "site/content/features.md" },
    ],
  },
  {
    title: "Install",
    pages: [
      { slug: "docker", file: "site/content/docker.md", nav: "Install with Docker" },
      { slug: "install-desktop", file: "site/content/install-desktop.md", nav: "Install the desktop app" },
      { slug: "deployment", file: "docs/DEPLOYMENT.md", nav: "Deployment reference" },
      { slug: "desktop", file: "docs/DESKTOP.md", nav: "How the desktop app works" },
    ],
  },
  {
    title: "Use",
    pages: [
      { slug: "editor", file: "docs/EDITOR.md", nav: "Writing and finding" },
      { slug: "databases", file: "docs/DATABASES.md", nav: "Databases" },
      { slug: "buttons", file: "docs/BUTTONS.md", nav: "Buttons and automations" },
      { slug: "ai-assistant", file: "docs/AI_ASSISTANT.md", nav: "AI assistant" },
    ],
  },
  {
    title: "Administer",
    pages: [{ slug: "sso", file: "docs/SSO.md", nav: "Single sign-on" }],
  },
  {
    title: "Extend",
    pages: [
      { slug: "api", file: "docs/API.md", nav: "REST API" },
      { slug: "mcp", file: "docs/MCP.md", nav: "MCP server" },
      { slug: "plugins", file: "docs/PLUGINS.md", nav: "Writing plugins" },
      { slug: "nextcloud", file: "docs/NEXTCLOUD.md", nav: "Nextcloud" },
      { slug: "google-calendar", file: "docs/GOOGLE_CALENDAR.md", nav: "Google Calendar" },
      { slug: "qa", file: "docs/QA.md", nav: "Test management" },
      { slug: "map", file: "docs/MAP.md", nav: "Map" },
    ],
  },
  {
    title: "Contribute",
    pages: [
      { slug: "translating", file: "docs/TRANSLATING.md", nav: "Translating" },
      { slug: "architecture", file: "docs/ARCHITECTURE.md", nav: "Architecture" },
    ],
  },
];
const PAGES = SECTIONS.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.title })));
// docs/EDITOR.md, site/content/docker.md… → slug, to turn links between Markdown files into links between pages.
const SLUG_BY_FILE = new Map(PAGES.map((p) => [path.resolve(ROOT, p.file), p.slug]));

// ---------- Helpers ----------

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Same anchors as GitHub, so that links such as DEPLOYMENT.md#securing-your-instance keep working.
function githubSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const iconCache = new Map();
function icon(name) {
  if (!iconCache.has(name)) {
    const svg = fs.readFileSync(path.join(ICONS, `${name}.svg`), "utf8").trim();
    iconCache.set(name, svg.replace("<svg ", '<svg class="icon" aria-hidden="true" focusable="false" '));
  }
  return iconCache.get(name);
}
// {{icon:name}} in the HTML files.
const withIcons = (html) => html.replace(/\{\{icon:([a-z0-9-]+)\}\}/g, (_, name) => icon(name));

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

// ---------- Markdown to HTML ----------

// A link of a Markdown file (relative to the file) → a link that works from the page docs/<slug>/.
function rewriteHref(href, sourceFile) {
  if (!href || /^([a-z]+:|#|\/\/)/i.test(href)) return href;
  const [target, hash = ""] = href.split("#");
  const anchor = hash ? `#${hash}` : "";
  const resolved = path.resolve(path.dirname(sourceFile), target);
  const slug = SLUG_BY_FILE.get(resolved);
  if (slug) return `../${slug}/${anchor}`;
  const fromRoot = path.relative(ROOT, resolved).split(path.sep).join("/");
  if (fromRoot.startsWith("docs/screenshots/")) return `../../screenshots/${fromRoot.slice("docs/screenshots/".length)}`;
  // The repository's root or README: the home page of the site.
  if (fromRoot === "" || fromRoot === "README.md") return `../../${anchor}`;
  // Any other file of the repository (docker-compose.yml, CHANGELOG.md, apps/…) is shown on GitHub.
  const isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  return `${REPO}/${isDir ? "tree" : "blob"}/main/${fromRoot}${anchor}`;
}

function renderMarkdown(source, sourceFile) {
  const headings = [];
  const used = new Map();
  let title = "";
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = html
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"');
        let id = githubSlug(text);
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth === 1) {
          if (!title) title = text;
          return `<h1 id="${id}">${html}</h1>\n`;
        }
        if (depth <= 3) headings.push({ depth, id, text });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${html}</h${depth}>\n`;
      },
      link({ href, title: linkTitle, tokens }) {
        const text = this.parser.parseInline(tokens);
        const url = rewriteHref(href, sourceFile);
        const external = /^https?:/.test(url) ? ' rel="noopener"' : "";
        return `<a href="${escapeHtml(url)}"${linkTitle ? ` title="${escapeHtml(linkTitle)}"` : ""}${external}>${text}</a>`;
      },
      image({ href, title: imgTitle, text }) {
        const url = rewriteHref(href, sourceFile);
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${imgTitle ? ` title="${escapeHtml(imgTitle)}"` : ""} loading="lazy">`;
      },
      table(token) {
        // Wide tables scroll on their own instead of widening the page.
        return `<div class="table-wrap">${Renderer.prototype.table.call(this, token)}</div>`;
      },
      code({ text, lang }) {
        const language = (lang || "").split(/\s/)[0];
        const label = language ? `<span class="code-lang">${escapeHtml(language)}</span>` : "";
        return `<div class="code">${label}<button class="copy" type="button" aria-label="Copy">${icon("copy")}</button><pre><code${
          language ? ` class="language-${escapeHtml(language)}"` : ""
        }>${escapeHtml(text)}</code></pre></div>\n`;
      },
    },
  });
  // Blockquotes starting with "> Note" keep their look; nothing else to adjust.
  const html = marked.parse(source);
  return { html, headings, title };
}

// Plain text of a page, for the search index.
function plainText(html) {
  return html
    .replace(/<pre[\s\S]*?<\/pre>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Page templates ----------

function header(prefix, current) {
  const link = (href, label, key, cls = "") =>
    `<a href="${prefix}${href}"${cls ? ` class="${cls}"` : ""}${current === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="${prefix}" aria-label="Nootion, home">
      <img src="${prefix}assets/logo.svg" alt="" width="28" height="28">
      <span>Nootion</span>
    </a>
    <nav class="main-nav" aria-label="Main">
      ${link("#features", "Features", "features", "nav-wide")}
      ${link("#download", "Download", "download", "nav-wide")}
      ${link("docs/introduction/", "Docs", "docs")}
      <a class="nav-wide" href="${REPO}/blob/main/CHANGELOG.md" rel="noopener">Changelog</a>
    </nav>
    <div class="header-actions">
      <button class="icon-button theme-toggle" type="button" aria-label="Switch between light and dark">
        <span class="when-light">${icon("moon")}</span><span class="when-dark">${icon("sun")}</span>
      </button>
      <a class="icon-button" href="${REPO}" rel="noopener" aria-label="Nootion on GitHub">${icon("github-logo")}</a>
    </div>
  </div>
</header>`;
}

function footer(prefix) {
  return `<footer class="site-footer">
  <div class="container footer-inner">
    <div class="footer-brand">
      <img src="${prefix}assets/logo.svg" alt="" width="24" height="24">
      <span>Nootion ${escapeHtml(version)}</span>
    </div>
    <nav class="footer-links" aria-label="Footer">
      <a href="${prefix}docs/introduction/">Documentation</a>
      <a href="${REPO}/releases" rel="noopener">Releases</a>
      <a href="${REPO}/issues" rel="noopener">Issues</a>
      <a href="${REPO}/blob/main/SECURITY.md" rel="noopener">Security</a>
      <a href="${REPO}/blob/main/LICENSE" rel="noopener">AGPL-3.0</a>
    </nav>
  </div>
</footer>`;
}

function head({ title, description, prefix, canonical }) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="${prefix}assets/logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${prefix}assets/apple-touch-icon.png">
<meta name="theme-color" content="#f7f7f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111214" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${SITE_URL}assets/social-preview.png">
<meta name="twitter:card" content="summary_large_image">
<script>
  // Before the first paint, so that the page doesn't flash in the wrong theme.
  (function () {
    var t = localStorage.getItem("nootion-site-theme");
    if (t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
  })();
</script>
<link rel="stylesheet" href="${prefix}assets/site.css">
<script src="${prefix}assets/site.js" defer></script>`;
}

function docPage(page, rendered, index) {
  const prefix = "../../";
  const prev = PAGES[index - 1];
  const next = PAGES[index + 1];
  const navTitle = (p) => p.nav ?? p.title;
  const sidebar = SECTIONS.map(
    (s) => `<div class="nav-group">
        <p class="nav-group-title">${escapeHtml(s.title)}</p>
        <ul>${s.pages
          .map(
            (p) =>
              `<li><a href="../${p.slug}/"${p.slug === page.slug ? ' aria-current="page"' : ""}>${escapeHtml(navTitle(PAGES.find((x) => x.slug === p.slug)))}</a></li>`,
          )
          .join("")}</ul>
      </div>`,
  ).join("\n      ");
  const toc = rendered.headings.filter((h) => h.depth === 2);
  const tocHtml = toc.length
    ? `<aside class="doc-toc" aria-label="On this page">
      <p class="toc-title">On this page</p>
      <ul>${toc.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join("")}</ul>
    </aside>`
    : "";
  const pager = `<nav class="doc-pager" aria-label="Previous and next pages">
        ${prev ? `<a class="pager-prev" href="../${prev.slug}/"><span>Previous</span>${escapeHtml(navTitle(prev))}</a>` : "<span></span>"}
        ${next ? `<a class="pager-next" href="../${next.slug}/"><span>Next</span>${escapeHtml(navTitle(next))}</a>` : "<span></span>"}
      </nav>`;
  const editUrl = `${REPO}/blob/develop/${page.file}`;
  return `<!doctype html>
<html lang="en">
<head>
${head({ title: `${rendered.title} · Nootion docs`, description: page.description, prefix, canonical: `${SITE_URL}docs/${page.slug}/` })}
</head>
<body class="docs" data-root="${prefix}">
<a class="skip-link" href="#content">Skip to the content</a>
${header(prefix, "docs")}
<div class="container docs-layout">
  <aside class="doc-sidebar" aria-label="Documentation">
    <button class="sidebar-toggle" type="button" aria-expanded="false" aria-controls="doc-nav">${icon("list")}<span>Menu</span></button>
    <div class="doc-nav" id="doc-nav">
      <div class="doc-search">
        <label class="visually-hidden" for="doc-search-input">Search the documentation</label>
        ${icon("magnifying-glass")}
        <input id="doc-search-input" type="search" placeholder="Search the docs" autocomplete="off">
        <ul class="search-results" hidden></ul>
      </div>
      ${sidebar}
    </div>
  </aside>
  <main id="content" class="doc-main">
    <article class="prose">
      ${rendered.html}
    </article>
    <p class="doc-edit"><a href="${editUrl}" rel="noopener">${icon("github-logo")}Edit this page on GitHub</a></p>
    ${pager}
  </main>
  ${tocHtml}
</div>
${footer(prefix)}
</body>
</html>
`;
}

// ---------- Build ----------

fs.rmSync(DIST, { recursive: true, force: true });
copyDir(path.join(SITE, "src"), DIST);
copyDir(path.join(ROOT, "docs/screenshots"), path.join(DIST, "screenshots"));
fs.copyFileSync(path.join(ROOT, "apps/web/public/favicon.svg"), path.join(DIST, "assets/logo.svg"));
fs.copyFileSync(path.join(ROOT, "apps/web/public/apple-touch-icon.png"), path.join(DIST, "assets/apple-touch-icon.png"));
// No Jekyll on GitHub Pages: the files are served as they are.
fs.writeFileSync(path.join(DIST, ".nojekyll"), "");

const searchIndex = [];
PAGES.forEach((page) => {
  const file = path.join(ROOT, page.file);
  const source = fs.readFileSync(file, "utf8");
  const rendered = renderMarkdown(source, file);
  page.title = rendered.title || page.slug;
  const firstParagraph = rendered.html.match(/<p>([\s\S]*?)<\/p>/);
  page.description = firstParagraph ? plainText(firstParagraph[1]).slice(0, 180) : `Nootion documentation: ${page.title}`;
  page.rendered = rendered;
});
PAGES.forEach((page, i) => {
  const dir = path.join(DIST, "docs", page.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), docPage(page, page.rendered, i));
  // One entry per section, so that a search lands on the right heading.
  const parts = page.rendered.html.split(/(?=<h[23] id=")/);
  for (const part of parts) {
    const m = part.match(/^<h[23] id="([^"]+)">(?:<a[^>]*>#<\/a>)?([\s\S]*?)<\/h[23]>/);
    searchIndex.push({
      page: page.nav ?? page.title,
      title: m ? plainText(m[2]) : page.title,
      url: `docs/${page.slug}/${m ? `#${m[1]}` : ""}`,
      text: plainText(m ? part.slice(m[0].length) : part).slice(0, 1200),
    });
  }
});
fs.writeFileSync(path.join(DIST, "docs/search-index.json"), JSON.stringify(searchIndex));
// docs/ alone opens the first page.
fs.writeFileSync(
  path.join(DIST, "docs/index.html"),
  `<!doctype html><meta charset="utf-8"><title>Nootion docs</title><meta http-equiv="refresh" content="0; url=introduction/"><link rel="canonical" href="introduction/"><a href="introduction/">Nootion documentation</a>\n`,
);

// Home page.
const indexHtml = fs
  .readFileSync(path.join(SITE, "src/index.html"), "utf8")
  .replace(
    "{{head}}",
    head({
      title: "Nootion: your open-source workspace, self-hosted or on your desktop",
      description:
        "Pages, wikis and real databases. A desktop app for Windows, macOS and Linux that needs no server, or one Docker container for your team. AGPL-3.0.",
      prefix: "",
      canonical: SITE_URL,
    }),
  )
  .replace("{{header}}", header("", ""))
  .replace("{{footer}}", footer(""))
  .replace(/\{\{version\}\}/g, escapeHtml(version))
  .replace(/\{\{repo\}\}/g, REPO);
fs.writeFileSync(path.join(DIST, "index.html"), withIcons(indexHtml));

// 404 page, served by GitHub Pages for unknown addresses (links are absolute here, the page can be at any depth).
const notFound = fs
  .readFileSync(path.join(SITE, "src/404.html"), "utf8")
  .replace("{{head}}", head({ title: "Page not found · Nootion", description: "This page doesn't exist.", prefix: "/Nootion/", canonical: SITE_URL }))
  .replace("{{header}}", header("/Nootion/", ""))
  .replace("{{footer}}", footer("/Nootion/"));
fs.writeFileSync(path.join(DIST, "404.html"), withIcons(notFound));

// The public texts name no other product: warn if one slipped into the docs.
for (const page of PAGES) {
  if (/\bNotion\b/.test(page.rendered.html)) console.warn(`Warning: ${page.file} names another product ("Notion").`);
}
console.log(`Built ${PAGES.length} documentation pages and the home page into ${path.relative(process.cwd(), DIST) || "."} (version ${version}).`);
