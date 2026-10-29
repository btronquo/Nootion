// "embed" plugin, browser side: the "/embed" block shows a video, a map… or a preview of a link.

const TEXTS = {
  en: {
    placeholder: "Paste a link: YouTube, Vimeo, Spotify, Google Maps, Figma or any page",
    label: "Link to embed",
    embed: "Embed",
    open: "Open",
    change: "Change link",
    invalid: "Invalid address.",
    frame: "Embedded content",
  },
  fr: {
    placeholder: "Collez un lien : YouTube, Vimeo, Spotify, Google Maps, Figma ou n'importe quelle page",
    label: "Lien à intégrer",
    embed: "Intégrer",
    open: "Ouvrir",
    change: "Changer le lien",
    invalid: "Adresse invalide.",
    frame: "Contenu intégré",
  },
};

/** Players that accept being shown in a page, from the address the user pastes. */
const PROVIDERS = [
  {
    name: "YouTube",
    match: /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/,
    src: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}`,
  },
  { name: "Vimeo", match: /vimeo\.com\/(?:video\/)?(\d+)/, src: (m) => `https://player.vimeo.com/video/${m[1]}` },
  {
    name: "Dailymotion",
    match: /(?:dailymotion\.com\/video\/|dai\.ly\/)([a-z0-9]+)/i,
    src: (m) => `https://www.dailymotion.com/embed/video/${m[1]}`,
  },
  {
    name: "Spotify",
    match: /open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/,
    src: (m) => `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
    height: (m) => (m[1] === "track" || m[1] === "episode" ? 152 : 352),
  },
  { name: "Loom", match: /loom\.com\/(?:share|embed)\/(\w+)/, src: (m) => `https://www.loom.com/embed/${m[1]}` },
  {
    name: "Figma",
    match: /figma\.com\/(?:file|design|proto|board)\/\w+/,
    src: (_m, url) => `https://www.figma.com/embed?embed_host=nootion&url=${encodeURIComponent(url)}`,
  },
  { name: "Google Maps", match: /google\.[a-z.]+\/maps\/embed/, src: (_m, url) => url, height: () => 400 },
  {
    name: "CodePen",
    match: /codepen\.io\/([\w-]+)\/(?:pen|embed)\/(\w+)/,
    src: (m) => `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`,
    height: () => 400,
  },
];

export function findProvider(url) {
  for (const p of PROVIDERS) {
    const m = url.match(p.match);
    if (m) return { name: p.name, src: p.src(m, url), height: p.height ? p.height(m) : null };
  }
  return null;
}

function normalizeUrl(raw) {
  const text = raw.trim();
  // Google Maps "Share > Embed a map" gives an <iframe> snippet: keep its address.
  const fromIframe = text.match(/<iframe[^>]*\ssrc="([^"]+)"/i);
  const candidate = fromIframe ? fromIframe[1].replace(/&amp;/g, "&") : /^[\w-]+(\.[\w-]+)+/.test(text) ? `https://${text}` : text;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const box = {
  border: "1px solid rgba(128,128,128,.3)",
  borderRadius: "8px",
  overflow: "hidden",
};

export function activate(nootion) {
  const text = TEXTS[nootion.locale] ?? TEXTS.en;
  const { React } = nootion;
  const h = React.createElement;

  function UrlForm({ onSubmit, initial }) {
    const [value, setValue] = React.useState(initial ?? "");
    const [error, setError] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const submit = async (e) => {
      e.preventDefault();
      const url = normalizeUrl(value);
      if (!url) return setError(text.invalid);
      setBusy(true);
      try {
        await onSubmit(url);
      } finally {
        setBusy(false);
      }
    };
    return h(
      "form",
      {
        onSubmit: submit,
        style: { ...box, padding: "10px", display: "flex", flexDirection: "column", gap: "6px", background: "rgba(128,128,128,.06)" },
      },
      h(
        "div",
        { style: { display: "flex", gap: "6px" } },
        h("input", {
          autoFocus: true,
          value,
          onChange: (e) => (setValue(e.target.value), setError(null)),
          placeholder: text.placeholder,
          "aria-label": text.label,
          style: {
            flex: 1,
            minWidth: 0,
            padding: "6px 8px",
            borderRadius: "6px",
            border: "1px solid rgba(128,128,128,.35)",
            background: "transparent",
            color: "inherit",
            font: "inherit",
            fontSize: "14px",
          },
        }),
        h(
          "button",
          {
            type: "submit",
            disabled: busy,
            style: {
              padding: "6px 12px",
              borderRadius: "6px",
              border: "none",
              background: "#2563eb",
              color: "white",
              font: "inherit",
              fontSize: "14px",
              cursor: "pointer",
            },
          },
          busy ? "…" : text.embed,
        ),
      ),
      error && h("div", { style: { color: "#dc2626", fontSize: "13px" } }, error),
    );
  }

  function Toolbar({ data, setData }) {
    const btn = {
      padding: "2px 8px",
      borderRadius: "4px",
      border: "1px solid rgba(128,128,128,.35)",
      background: "rgba(255,255,255,.9)",
      color: "#333",
      fontSize: "12px",
      cursor: "pointer",
    };
    return h(
      "div",
      { className: "nootion-hover-only", style: { position: "absolute", top: "6px", right: "6px", display: "flex", gap: "4px" } },
      h("a", { href: data.url, target: "_blank", rel: "noopener noreferrer", style: { ...btn, textDecoration: "none" } }, text.open),
      h("button", { type: "button", style: btn, onClick: () => setData({ editing: true, url: data.url }) }, text.change),
    );
  }

  function LinkCard({ data }) {
    return h(
      "a",
      {
        href: data.url,
        target: "_blank",
        rel: "noopener noreferrer",
        style: { ...box, display: "flex", textDecoration: "none", color: "inherit", minHeight: "96px" },
      },
      h(
        "div",
        { style: { flex: 1, minWidth: 0, padding: "12px 14px", display: "flex", flexDirection: "column", gap: "4px" } },
        h(
          "div",
          { style: { fontWeight: 600, fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          data.title || data.url,
        ),
        data.description &&
          h(
            "div",
            {
              style: { fontSize: "13px", opacity: 0.7, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },
            },
            data.description,
          ),
        h(
          "div",
          { style: { fontSize: "12px", opacity: 0.55, marginTop: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          data.site ? `${data.site} · ${data.url}` : data.url,
        ),
      ),
      data.image &&
        h("img", {
          src: data.image,
          alt: "",
          referrerPolicy: "no-referrer",
          style: { width: "30%", maxWidth: "220px", objectFit: "cover", flexShrink: 0 },
          onError: (e) => (e.currentTarget.style.display = "none"),
        }),
    );
  }

  function Embed({ data, setData, editable }) {
    if (!data.url || data.editing) {
      if (!editable) return null;
      return h(UrlForm, {
        initial: data.url,
        onSubmit: async (url) => {
          const provider = findProvider(url);
          if (provider) return setData({ url, kind: "frame", provider: provider.name, src: provider.src, height: provider.height });
          // The preview is stored in the page, so shared and public readers see it without another request.
          let meta = {};
          try {
            meta = await nootion.api(`/preview?url=${encodeURIComponent(url)}`);
          } catch {
            meta = {};
          }
          setData({
            url,
            kind: "link",
            title: meta.title ?? url,
            description: meta.description ?? "",
            image: meta.image ?? null,
            site: meta.site ?? null,
          });
        },
      });
    }
    const content =
      data.kind === "frame"
        ? h("iframe", {
            src: data.src,
            title: data.provider ?? text.frame,
            loading: "lazy",
            allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
            allowFullScreen: true,
            referrerPolicy: "strict-origin-when-cross-origin",
            sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation allow-forms",
            style: { display: "block", width: "100%", border: "none", ...(data.height ? { height: `${data.height}px` } : { aspectRatio: "16 / 9" }) },
          })
        : h(LinkCard, { data });
    return h("div", { style: { position: "relative", ...(data.kind === "frame" ? box : {}) } }, content, editable && h(Toolbar, { data, setData }));
  }

  nootion.registerBlock("embed", Embed);
}
