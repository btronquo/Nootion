// "qa" plugin, browser side: the "/test run" block. In turn it picks (or creates) the test databases, starts a run
// (some suites, priorities and products), then shows the run as a grid: a line per case, a column per product, and in
// each cell the result, changed with a click (or the keys 1 to 5).

const TEXTS = {
  en: {
    title: "Test run",
    intro: "Test cases, runs and results are kept in four databases: cases, products, runs and results. Create them once, then start as many runs as you like.",
    create: "Create the test databases here",
    creating: "Creating the databases…",
    useSet: "Use these databases",
    existing: "Or use databases created before:",
    choose: "Choose…",
    notSetUp: "This test run isn't set up yet.",
    signIn: "Sign in to see this test run.",
    loading: "Loading…",
    newRun: "New run",
    runName: "Name",
    runDefault: "Run of {date}",
    version: "Version / build",
    suites: "Suites",
    priorities: "Priorities",
    products: "Products",
    all: "all",
    noProducts: "No product: one result per case. Add products (PC, Xbox…) to run the same cases on each.",
    count: "{cases} cases × {products} = {results} results",
    countPlain: "{cases} cases",
    start: "Start the run",
    starting: "Creating the results…",
    noCases: "No test case yet: add some to the \"Test cases\" database, with their steps in the page of each case.",
    openCases: "Test cases",
    openProducts: "Products",
    openRuns: "All runs",
    openResults: "Results",
    reopen: "Or continue a run:",
    otherSet: "Other databases",
    case: "Case",
    open: "In progress",
    done: "Done",
    finish: "Finish the run",
    reopenRun: "Open again",
    refresh: "Refresh",
    sync: "Add new cases",
    synced: "{n} results added.",
    syncedNone: "No new case in this run's scope.",
    another: "Start another run here",
    confirmAnother: "Start another run in this block? This one stays in the \"Test runs\" database.",
    show: "Show",
    showAll: "All cases",
    showUntested: "Untested",
    showProblems: "Failed or blocked",
    progress: "{done} / {total} tested",
    passRate: "{rate} % passed",
    comment: "Comment",
    bug: "Bug link",
    testedBy: "{name}, {when}",
    deleted: "deleted case",
    gone: "This run no longer exists.",
    readOnly: "You can see this run but not record results.",
    nothing: "Nothing to show with this filter.",
    keys: "Keys 1 to 5 choose a status, Esc closes.",
    s_untested: "Untested",
    s_passed: "Passed",
    s_failed: "Failed",
    s_blocked: "Blocked",
    s_skipped: "Skipped",
  },
  fr: {
    title: "Test run",
    intro: "Les cas de test, les runs et les résultats sont rangés dans quatre bases : cas, produits, runs et résultats. Créez-les une fois, puis lancez autant de runs que vous voulez.",
    create: "Créer les bases de test ici",
    creating: "Création des bases…",
    useSet: "Utiliser ces bases",
    existing: "Ou utiliser des bases créées avant :",
    choose: "Choisir…",
    notSetUp: "Ce test run n'est pas encore configuré.",
    signIn: "Connectez-vous pour voir ce test run.",
    loading: "Chargement…",
    newRun: "Nouveau run",
    runName: "Nom",
    runDefault: "Run du {date}",
    version: "Version / build",
    suites: "Suites",
    priorities: "Priorités",
    products: "Produits",
    all: "toutes",
    noProducts: "Aucun produit : un résultat par cas. Ajoutez des produits (PC, Xbox…) pour dérouler les mêmes cas sur chacun.",
    count: "{cases} cas × {products} = {results} résultats",
    countPlain: "{cases} cas",
    start: "Lancer le run",
    starting: "Création des résultats…",
    noCases: "Pas encore de cas de test : ajoutez-en dans la base « Cas de test », avec les étapes dans la page de chaque cas.",
    openCases: "Cas de test",
    openProducts: "Produits",
    openRuns: "Tous les runs",
    openResults: "Résultats",
    reopen: "Ou reprendre un run :",
    otherSet: "Autres bases",
    case: "Cas",
    open: "En cours",
    done: "Terminé",
    finish: "Terminer le run",
    reopenRun: "Rouvrir",
    refresh: "Actualiser",
    sync: "Ajouter les nouveaux cas",
    synced: "{n} résultats ajoutés.",
    syncedNone: "Aucun nouveau cas dans le périmètre de ce run.",
    another: "Lancer un autre run ici",
    confirmAnother: "Lancer un autre run dans ce bloc ? Celui-ci reste dans la base « Test runs ».",
    show: "Afficher",
    showAll: "Tous les cas",
    showUntested: "Non testés",
    showProblems: "Échoués ou bloqués",
    progress: "{done} / {total} testés",
    passRate: "{rate} % réussis",
    comment: "Commentaire",
    bug: "Lien vers le bug",
    testedBy: "{name}, {when}",
    deleted: "cas supprimé",
    gone: "Ce run n'existe plus.",
    readOnly: "Vous pouvez voir ce run mais pas noter de résultats.",
    nothing: "Rien à afficher avec ce filtre.",
    keys: "Les touches 1 à 5 choisissent un statut, Échap ferme.",
    s_untested: "Non testé",
    s_passed: "Réussi",
    s_failed: "Échoué",
    s_blocked: "Bloqué",
    s_skipped: "Ignoré",
  },
};

/** In the order of the keys 1 to 5. */
const STATUS_KEYS = ["passed", "failed", "blocked", "skipped", "untested"];
const STATUS_STYLE = {
  untested: { color: "#6b7280", bg: "rgba(107,114,128,.14)", icon: "○" },
  passed: { color: "#15803d", bg: "rgba(22,163,74,.16)", icon: "✓" },
  failed: { color: "#b91c1c", bg: "rgba(220,38,38,.16)", icon: "✗" },
  blocked: { color: "#c2410c", bg: "rgba(234,88,12,.16)", icon: "⊘" },
  skipped: { color: "#78716c", bg: "rgba(120,113,108,.16)", icon: "↷" },
};
const BAR_COLORS = { passed: "#16a34a", failed: "#dc2626", blocked: "#ea580c", skipped: "#a8a29e", untested: "rgba(128,128,128,.22)" };
const OPTION_COLORS = {
  gray: "rgba(128,128,128,.2)",
  brown: "rgba(146,64,14,.18)",
  orange: "rgba(234,88,12,.18)",
  yellow: "rgba(202,138,4,.2)",
  green: "rgba(22,163,74,.18)",
  blue: "rgba(37,99,235,.18)",
  purple: "rgba(147,51,234,.18)",
  pink: "rgba(219,39,119,.18)",
  red: "rgba(220,38,38,.18)",
};

const CSS = `
.qa-box { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 12px 14px; font-size: 14px; }
.qa-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.qa-title { font-weight: 600; font-size: 15px; }
.qa-sub { font-size: 12px; opacity: .65; }
.qa-badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: rgba(37,99,235,.16); color: #2563eb; }
.qa-badge.done { background: rgba(22,163,74,.16); color: #15803d; }
.qa-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 12px 0; }
.qa-grid label, .qa-field { display: grid; gap: 4px; font-size: 12px; }
.qa-input { width: 100%; box-sizing: border-box; border: 1px solid rgba(128,128,128,.4); border-radius: 6px; padding: 6px 8px; font-size: 14px; background: transparent; color: inherit; font-family: inherit; }
.qa-input option { color: #111; }
.qa-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.qa-chip { border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit; border-radius: 999px; padding: 2px 10px; font-size: 13px; cursor: pointer; }
.qa-chip[aria-pressed="true"] { border-color: #2563eb; background: rgba(37,99,235,.14); }
.qa-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.qa-link { background: none; border: 0; padding: 0; color: #3b82f6; cursor: pointer; font-size: 12px; text-decoration: none; }
.qa-link:hover { text-decoration: underline; }
.qa-error { color: #dc2626; font-size: 13px; margin-top: 8px; }
.qa-note { font-size: 13px; margin-top: 8px; opacity: .8; }
.qa-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: rgba(128,128,128,.15); margin: 10px 0 4px; }
.qa-stats { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; }
.qa-stats span { white-space: nowrap; }
.qa-scroll { overflow-x: auto; margin-top: 10px; border-top: 1px solid rgba(128,128,128,.18); }
.qa-matrix { display: grid; font-size: 13px; }
.qa-matrix > div { border-bottom: 1px solid rgba(128,128,128,.16); padding: 4px 6px; display: flex; align-items: center; min-width: 0; }
.qa-matrix .qa-th { font-weight: 500; font-size: 12px; opacity: .7; white-space: nowrap; }
.qa-matrix .qa-p { justify-content: center; }
@media (max-width: 640px) {
  .qa-matrix .qa-c { position: sticky; left: 0; z-index: 1; background: #fff; }
  .dark .qa-matrix .qa-c { background: #171717; }
}
.qa-matrix .qa-suite { grid-column: 1 / -1; font-weight: 600; font-size: 12px; padding-top: 12px; opacity: .85; }
.qa-box a.qa-case, .qa-box a.qa-link { color: inherit !important; text-decoration: none !important; }
.qa-box a.qa-link { color: #3b82f6 !important; }
.qa-box a.qa-case:hover, .qa-box a.qa-link:hover { text-decoration: underline !important; }
.qa-case { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qa-tag { font-size: 11px; padding: 0 6px; border-radius: 4px; margin-left: 6px; white-space: nowrap; flex: none; }
.qa-products { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 10px; align-items: center; font-size: 12px; margin-top: 8px; }
.qa-products .qa-bar { margin: 0; height: 6px; }
.qa-cell { display: inline-flex; white-space: nowrap; align-items: center; justify-content: center; gap: 4px; min-width: 84px; border: 0; border-radius: 5px; padding: 3px 6px; font-size: 12px; cursor: pointer; font-family: inherit; }
.qa-cell:disabled { cursor: default; }
.qa-cell .qa-dot { font-size: 10px; opacity: .8; }
.qa-pop { position: fixed; z-index: 60; width: 280px; background: var(--qa-pop-bg, #fff); color: #111; border: 1px solid rgba(128,128,128,.35); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 10px; font-size: 13px; }
.dark .qa-pop { --qa-pop-bg: #262626; color: #eee; }
.qa-pop .qa-cell { width: 100%; justify-content: flex-start; margin-bottom: 4px; font-size: 13px; padding: 5px 8px; }
.qa-pop .qa-cell[aria-pressed="true"] { outline: 2px solid currentColor; }
.qa-kbd { margin-left: auto; font-size: 11px; opacity: .6; }
`;

export function activate(nootion) {
  const { React } = nootion;
  const { useEffect, useMemo, useRef, useState, useCallback } = React;
  const h = React.createElement;
  const { Button } = nootion.ui;
  const T = TEXTS[nootion.locale] ?? TEXTS.en;
  const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const message = (e) => (e instanceof Error ? e.message : String(e));
  const pageUrl = (id) => `/page/${id}`;
  const today = () => new Date().toLocaleDateString(nootion.locale);
  const when = (iso) => new Date(iso).toLocaleString(nootion.locale, { dateStyle: "short", timeStyle: "short" });

  if (!document.getElementById("nootion-qa-css")) {
    const style = document.createElement("style");
    style.id = "nootion-qa-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const Box = ({ children }) => h("div", { className: "qa-box", "data-qa": "" }, children);
  const Head = ({ children }) => h("div", { className: "qa-head" }, h("span", null, "🧪"), children);
  const ErrorText = ({ error }) => (error ? h("div", { className: "qa-error", role: "alert" }, error) : null);

  /** Chips to pick some values; none picked means all of them. */
  function Chips({ items, picked, onChange }) {
    return h(
      "div",
      { className: "qa-chips" },
      items.map((it) =>
        h(
          "button",
          {
            key: it.id,
            type: "button",
            className: "qa-chip",
            "aria-pressed": picked.includes(it.id),
            onClick: () => onChange(picked.includes(it.id) ? picked.filter((x) => x !== it.id) : [...picked, it.id]),
          },
          it.name ?? it.title,
        ),
      ),
    );
  }

  const DbLinks = ({ databases }) =>
    h(
      "div",
      { className: "qa-row", style: { gap: 12 } },
      h("a", { className: "qa-link", href: pageUrl(databases.cases) }, "🧪 ", T.openCases),
      h("a", { className: "qa-link", href: pageUrl(databases.products) }, "🎮 ", T.openProducts),
      h("a", { className: "qa-link", href: pageUrl(databases.runs) }, "🏃 ", T.openRuns),
      h("a", { className: "qa-link", href: pageUrl(databases.results) }, "✅ ", T.openResults),
    );

  // --- Step 1: the databases --------------------------------------------------------------------

  function Setup({ pageId, onPicked }) {
    const [sets, setSets] = useState(null);
    const [picked, setPicked] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
      nootion.api("/sets").then((r) => setSets(r.sets), (e) => setError(message(e)));
    }, []);
    async function create() {
      setBusy(true);
      setError(null);
      try {
        const { set } = await nootion.api("/sets", { method: "POST", body: { pageId } });
        onPicked(set.id);
      } catch (e) {
        setError(message(e));
        setBusy(false);
      }
    }
    return h(
      Box,
      null,
      h(Head, null, h("span", { className: "qa-title" }, T.title)),
      h("p", { className: "qa-note", style: { margin: "6px 0 10px" } }, T.intro),
      pageId && h(Button, { type: "button", onClick: create, disabled: busy }, busy ? T.creating : T.create),
      sets?.length
        ? h(
            "div",
            { className: "qa-row" },
            h("span", { className: "qa-sub" }, T.existing),
            h(
              "select",
              { className: "qa-input", style: { width: "auto" }, value: picked, onChange: (e) => setPicked(e.target.value) },
              h("option", { value: "" }, T.choose),
              sets.map((s) => h("option", { key: s.id, value: s.id }, s.title)),
            ),
            h(Button, { type: "button", variant: "ghost", disabled: !picked, onClick: () => onPicked(picked) }, T.useSet),
          )
        : null,
      h(ErrorText, { error }),
    );
  }

  // --- Step 2: a new run ------------------------------------------------------------------------

  function NewRun({ setId, onStarted, onOtherSet }) {
    const [set, setSet] = useState(null);
    const [error, setError] = useState(null);
    const [title, setTitle] = useState(fmt(T.runDefault, { date: today() }));
    const [version, setVersion] = useState("");
    const [suites, setSuites] = useState([]);
    const [priorities, setPriorities] = useState([]);
    const [products, setProducts] = useState([]);
    const [busy, setBusy] = useState(false);
    const [resume, setResume] = useState("");
    useEffect(() => {
      nootion.api(`/sets/${setId}`).then(
        (r) => {
          setSet(r.set);
          setProducts(r.set.products.map((p) => p.id));
        },
        (e) => setError(message(e)),
      );
    }, [setId]);
    if (!set) return h(Box, null, h(Head, null, h("span", { className: "qa-title" }, T.title)), error ? h(ErrorText, { error }) : h("div", { className: "qa-sub" }, T.loading), error && h("button", { type: "button", className: "qa-link", onClick: onOtherSet }, T.otherSet));
    const cases = set.cases.filter((c) => (!suites.length || suites.includes(c.suite)) && (!priorities.length || priorities.includes(c.priority)));
    const n = cases.length * Math.max(1, products.length);
    async function start(e) {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const { run } = await nootion.api(`/sets/${setId}/runs`, { method: "POST", body: { title, version, suites, priorities, products } });
        onStarted(run.run.id, { suites, priorities });
      } catch (err) {
        setError(message(err));
        setBusy(false);
      }
    }
    return h(
      Box,
      null,
      h(Head, null, h("span", { className: "qa-title" }, T.newRun)),
      h(DbLinks, { databases: set.databases }),
      !set.cases.length
        ? h("p", { className: "qa-note" }, T.noCases)
        : h(
            "form",
            { onSubmit: start },
            h(
              "div",
              { className: "qa-grid" },
              h("label", null, T.runName, h("input", { className: "qa-input", value: title, required: true, maxLength: 500, onChange: (e) => setTitle(e.target.value) })),
              h("label", null, T.version, h("input", { className: "qa-input", value: version, maxLength: 200, placeholder: "1.4.0", onChange: (e) => setVersion(e.target.value) })),
            ),
            set.suites.length > 0 &&
              h("div", { className: "qa-field", style: { marginBottom: 10 } }, h("span", null, T.suites, " ", h("span", { className: "qa-sub" }, `(${T.all} : ∅)`)), h(Chips, { items: set.suites, picked: suites, onChange: setSuites })),
            h("div", { className: "qa-field", style: { marginBottom: 10 } }, h("span", null, T.priorities), h(Chips, { items: set.priorities, picked: priorities, onChange: setPriorities })),
            h(
              "div",
              { className: "qa-field" },
              h("span", null, T.products),
              set.products.length ? h(Chips, { items: set.products, picked: products, onChange: setProducts }) : h("span", { className: "qa-sub" }, T.noProducts),
            ),
            h(
              "div",
              { className: "qa-row" },
              h(Button, { type: "submit", disabled: busy || !cases.length || !title.trim() }, busy ? T.starting : T.start),
              h("span", { className: "qa-sub" }, products.length ? fmt(T.count, { cases: cases.length, products: products.length, results: n }) : fmt(T.countPlain, { cases: cases.length })),
            ),
          ),
      set.runs.length > 0 &&
        h(
          "div",
          { className: "qa-row" },
          h("span", { className: "qa-sub" }, T.reopen),
          h(
            "select",
            { className: "qa-input", style: { width: "auto" }, value: resume, onChange: (e) => setResume(e.target.value) },
            h("option", { value: "" }, T.choose),
            set.runs.map((r) => h("option", { key: r.id, value: r.id }, r.title || "—")),
          ),
          h(Button, { type: "button", variant: "ghost", disabled: !resume, onClick: () => onStarted(resume, null) }, "→"),
        ),
      h(ErrorText, { error }),
      h("div", { className: "qa-row" }, h("button", { type: "button", className: "qa-link", onClick: onOtherSet }, T.otherSet)),
    );
  }

  // --- Step 3: the run --------------------------------------------------------------------------

  function counts(results) {
    const c = { untested: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 };
    for (const r of results) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }

  function Progress({ results, statuses, label }) {
    const c = counts(results);
    const total = results.length || 1;
    const tested = results.length - c.untested;
    const name = (k) => statuses.find((s) => s.id === k)?.name ?? T[`s_${k}`] ?? k;
    return h(
      "div",
      null,
      h(
        "div",
        { className: "qa-bar", role: "img", "aria-label": fmt(T.progress, { done: tested, total: results.length }) },
        ["passed", "failed", "blocked", "skipped", "untested"].map((k) => (c[k] ? h("div", { key: k, style: { width: `${(c[k] / total) * 100}%`, background: BAR_COLORS[k] } }) : null)),
      ),
      h(
        "div",
        { className: "qa-stats" },
        label && h("span", { style: { fontWeight: 600 } }, label),
        h("span", null, fmt(T.progress, { done: tested, total: results.length })),
        tested > 0 && h("span", null, fmt(T.passRate, { rate: Math.round((c.passed / Math.max(1, tested - c.skipped)) * 100) })),
        ["passed", "failed", "blocked", "skipped"].map((k) => (c[k] ? h("span", { key: k, style: { color: STATUS_STYLE[k].color } }, `${STATUS_STYLE[k].icon} ${c[k]} ${name(k)}`) : null)),
      ),
    );
  }

  /** One line per product: its name, a bar, how many results are in. */
  function ProductProgress({ products, results }) {
    return h(
      "div",
      { className: "qa-products" },
      products.flatMap((p) => {
        const mine = results.filter((r) => r.product === p.id);
        const c = counts(mine);
        const total = mine.length || 1;
        return [
          h("span", { key: `${p.id}-n`, style: { fontWeight: 500 } }, p.title),
          h(
            "div",
            { key: `${p.id}-b`, className: "qa-bar" },
            ["passed", "failed", "blocked", "skipped"].map((k) => (c[k] ? h("div", { key: k, style: { width: `${(c[k] / total) * 100}%`, background: BAR_COLORS[k] } }) : null)),
          ),
          h(
            "span",
            { key: `${p.id}-c`, className: "qa-sub", style: { whiteSpace: "nowrap" } },
            `${mine.length - c.untested}/${mine.length}`,
            c.failed ? h("span", { style: { color: STATUS_STYLE.failed.color, marginLeft: 6 } }, `${STATUS_STYLE.failed.icon} ${c.failed}`) : null,
            c.blocked ? h("span", { style: { color: STATUS_STYLE.blocked.color, marginLeft: 6 } }, `${STATUS_STYLE.blocked.icon} ${c.blocked}`) : null,
          ),
        ];
      }),
    );
  }

  function StatusPill({ status, name, onClick, disabled, pressed, kbd, title }) {
    const s = STATUS_STYLE[status] ?? STATUS_STYLE.untested;
    return h(
      "button",
      { type: "button", className: "qa-cell", style: { color: s.color, background: s.bg }, onClick, disabled, title, "aria-pressed": pressed },
      h("span", null, s.icon),
      h("span", null, name),
      kbd && h("span", { className: "qa-kbd" }, kbd),
    );
  }

  /** The result of a cell, to change its status, comment and bug link. */
  function ResultPopover({ result, anchor, statuses, onSave, onClose, caseTitle, productTitle }) {
    const ref = useRef(null);
    const opened = useRef(Date.now());
    const [comment, setComment] = useState(result.comment);
    const [bug, setBug] = useState(result.bug);
    const name = (k) => statuses.find((s) => s.id === k)?.name ?? T[`s_${k}`] ?? k;
    const rect = anchor.getBoundingClientRect();
    // Below the cell, or above it when there isn't room.
    const height = 440;
    const top = rect.bottom + 4 + height <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 4 - height);
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 290));
    const flush = () => {
      const patch = {};
      if (comment !== result.comment) patch.comment = comment;
      if (bug !== result.bug) patch.bug = bug;
      if (Object.keys(patch).length) onSave(patch);
    };
    const close = () => {
      flush();
      onClose();
    };
    useEffect(() => {
      const down = (e) => {
        if (ref.current && !ref.current.contains(e.target) && !anchor.contains(e.target)) close();
      };
      const key = (e) => {
        if (e.key === "Escape") return (e.preventDefault(), close());
        const inField = e.target instanceof HTMLElement && ["TEXTAREA", "INPUT"].includes(e.target.tagName);
        const i = Number(e.key) - 1;
        if (!inField && i >= 0 && i < STATUS_KEYS.length) {
          e.preventDefault();
          e.stopPropagation();
          onSave({ status: STATUS_KEYS[i] });
        }
      };
      // It stays where the cell was: scrolling the page closes it.
      const scroll = (e) => {
        if (Date.now() - opened.current > 400 && !ref.current?.contains(e.target)) close();
      };
      document.addEventListener("mousedown", down);
      document.addEventListener("keydown", key, true);
      window.addEventListener("scroll", scroll, true);
      return () => {
        document.removeEventListener("mousedown", down);
        document.removeEventListener("keydown", key, true);
        window.removeEventListener("scroll", scroll, true);
      };
    });
    return h(
      "div",
      { ref, className: "qa-pop", style: { top, left }, role: "dialog", "aria-label": `${caseTitle} · ${productTitle}`, onKeyDown: (e) => e.stopPropagation() },
      h("div", { style: { fontWeight: 600, marginBottom: 2 } }, caseTitle),
      productTitle && h("div", { className: "qa-sub", style: { marginBottom: 8 } }, productTitle),
      STATUS_KEYS.map((k, i) => h(StatusPill, { key: k, status: k, name: name(k), pressed: result.status === k, kbd: String(i + 1), onClick: () => onSave({ status: k }) })),
      h("label", { className: "qa-field", style: { marginTop: 6 } }, T.comment, h("textarea", { className: "qa-input", rows: 2, value: comment, onChange: (e) => setComment(e.target.value), onBlur: flush })),
      h("label", { className: "qa-field", style: { marginTop: 6 } }, T.bug, h("input", { className: "qa-input", type: "url", value: bug, placeholder: "https://", onChange: (e) => setBug(e.target.value), onBlur: flush })),
      result.tester && h("div", { className: "qa-sub", style: { marginTop: 8 } }, fmt(T.testedBy, { name: result.tester, when: result.testedAt ? when(result.testedAt) : "" })),
      h("div", { className: "qa-sub", style: { marginTop: 4 } }, T.keys),
    );
  }

  function RunView({ setId, runId, scope, editable, onAnother, onSummary }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [note, setNote] = useState(null);
    const [show, setShow] = useState("all");
    const [open, setOpen] = useState(null); // { resultId, anchor }
    const [busy, setBusy] = useState(false);
    const openRef = useRef(open);
    openRef.current = open;

    const load = useCallback(
      () =>
        nootion.api(`/sets/${setId}/runs/${runId}`).then(
          (r) => {
            setData(r.run);
            setError(null);
          },
          (e) => setError(message(e)),
        ),
      [setId, runId],
    );
    useEffect(() => {
      load();
      // Others may be testing at the same time: refresh now and then while the page is in view.
      const t = setInterval(() => {
        if (document.visibilityState === "visible" && !openRef.current) load();
      }, 20000);
      return () => clearInterval(t);
    }, [load]);

    // Readers of a public page can't call the API: the block keeps the latest figures for them.
    useEffect(() => {
      if (data && editable) onSummary({ title: data.run.title, version: data.run.version, status: data.run.status, counts: counts(data.results), total: data.results.length });
    }, [data && data.run.status, data && data.run.title, data && data.results.length]);

    const byCell = useMemo(() => {
      const m = new Map();
      for (const r of data?.results ?? []) m.set(`${r.case}|${r.product ?? ""}`, r);
      return m;
    }, [data]);

    if (!data) return h(Box, null, h(Head, null, h("span", { className: "qa-title" }, T.title)), error ? h(ErrorText, { error }) : h("div", { className: "qa-sub" }, T.loading), error && editable && h("button", { type: "button", className: "qa-link", onClick: onAnother }, T.another));

    const canEdit = data.canEdit && editable && data.run.status !== "done";
    const columns = data.products.length ? data.products : [{ id: null, title: "" }];
    const statusName = (k) => data.statuses.find((s) => s.id === k)?.name ?? T[`s_${k}`] ?? k;
    const optionOf = (list, id) => list.find((o) => o.id === id);

    async function save(resultId, patch) {
      const before = data.results.find((r) => r.id === resultId);
      // Shown at once; put back if the server refuses.
      setData((d) => ({ ...d, results: d.results.map((r) => (r.id === resultId ? { ...r, ...patch } : r)) }));
      try {
        const { result } = await nootion.api(`/sets/${setId}/results/${resultId}`, { method: "PATCH", body: patch });
        setData((d) => ({ ...d, results: d.results.map((r) => (r.id === resultId ? result : r)) }));
      } catch (e) {
        setData((d) => ({ ...d, results: d.results.map((r) => (r.id === resultId ? before : r)) }));
        setError(message(e));
      }
    }

    async function action(fn) {
      setBusy(true);
      setError(null);
      setNote(null);
      try {
        await fn();
      } catch (e) {
        setError(message(e));
      }
      setBusy(false);
    }
    const setRunStatus = (status) =>
      action(async () => {
        const { run } = await nootion.api(`/sets/${setId}/runs/${runId}`, { method: "PATCH", body: { status } });
        setData(run);
      });
    const sync = () =>
      action(async () => {
        const r = await nootion.api(`/sets/${setId}/runs/${runId}/sync`, { method: "POST", body: scope ?? {} });
        setData(r.run);
        setNote(r.added ? fmt(T.synced, { n: r.added }) : T.syncedNone);
      });

    const visible = (c) => {
      if (show === "all") return true;
      const rs = columns.map((p) => byCell.get(`${c.id}|${p.id ?? ""}`)).filter(Boolean);
      if (show === "untested") return rs.some((r) => r.status === "untested");
      return rs.some((r) => r.status === "failed" || r.status === "blocked");
    };
    const shown = data.cases.filter(visible);
    const rows = [];
    let suite;
    for (const c of shown) {
      if (data.suites.length && c.suite !== suite) {
        suite = c.suite;
        rows.push(h("div", { key: `s-${suite}`, className: "qa-suite" }, optionOf(data.suites, suite)?.name ?? "—"));
      }
      const prio = optionOf(data.priorities, c.priority);
      rows.push(
          h(
            "div",
            { key: c.id, className: "qa-c", title: c.title },
            c.deleted ? h("span", { style: { opacity: 0.6 } }, c.title, ` (${T.deleted})`) : h("a", { className: "qa-case", href: pageUrl(c.id) }, c.title || "—"),
            prio && h("span", { className: "qa-tag", style: { background: OPTION_COLORS[prio.color] ?? OPTION_COLORS.gray } }, prio.name),
          ),
          ...columns.map((p) => {
            const r = byCell.get(`${c.id}|${p.id ?? ""}`);
            if (!r) return h("div", { key: `${c.id}-${p.id ?? "-"}`, className: "qa-p" }, "");
            const tip = [r.tester && fmt(T.testedBy, { name: r.tester, when: r.testedAt ? when(r.testedAt) : "" }), r.comment].filter(Boolean).join("\n");
            return h(
              "div",
              { key: `${c.id}-${p.id ?? "-"}`, className: "qa-p" },
              h(
                "span",
                { style: { position: "relative", display: "inline-flex", alignItems: "center", gap: 2 } },
                h(StatusPill, {
                  status: r.status,
                  name: statusName(r.status),
                  disabled: !canEdit,
                  title: tip || undefined,
                  onClick: (e) => setOpen(open?.resultId === r.id ? null : { resultId: r.id, anchor: e.currentTarget, caseTitle: c.title, productTitle: p.title }),
                }),
                r.comment && h("span", { className: "qa-dot", title: r.comment }, "💬"),
                r.bug && h("a", { className: "qa-dot", href: r.bug, target: "_blank", rel: "noopener noreferrer", title: r.bug, style: { textDecoration: "none" } }, "🐞"),
              ),
            );
          }),
      );
    }
    const openResult = open && data.results.find((r) => r.id === open.resultId);

    return h(
      Box,
      null,
      h(
        Head,
        null,
        h("span", { className: "qa-title" }, data.run.title || "—"),
        data.run.version && h("span", { className: "qa-sub" }, data.run.version),
        h("span", { className: `qa-badge ${data.run.status === "done" ? "done" : ""}` }, data.run.status === "done" ? T.done : T.open),
        h("a", { className: "qa-link", href: pageUrl(data.run.id), style: { marginLeft: "auto" } }, "↗"),
      ),
      h(Progress, { results: data.results, statuses: data.statuses }),
      data.products.length > 1 && h(ProductProgress, { products: data.products, results: data.results }),
      h(
        "div",
        { className: "qa-row" },
        h("label", { className: "qa-sub", style: { display: "flex", alignItems: "center", gap: 6 } }, T.show,
          h(
            "select",
            { className: "qa-input", style: { width: "auto", padding: "2px 6px", fontSize: 13 }, value: show, onChange: (e) => setShow(e.target.value) },
            h("option", { value: "all" }, T.showAll),
            h("option", { value: "untested" }, T.showUntested),
            h("option", { value: "problems" }, T.showProblems),
          ),
        ),
        h("span", { style: { flex: 1 } }),
        h(Button, { type: "button", variant: "ghost", onClick: () => action(load), disabled: busy, title: T.refresh, "aria-label": T.refresh }, "⟳"),
        editable && data.canEdit && data.run.status !== "done" && h(Button, { type: "button", variant: "ghost", onClick: sync, disabled: busy }, "＋ ", T.sync),
        editable && data.canEdit && h(Button, { type: "button", variant: data.run.status === "done" ? "ghost" : "primary", onClick: () => setRunStatus(data.run.status === "done" ? "open" : "done"), disabled: busy }, data.run.status === "done" ? T.reopenRun : T.finish),
      ),
      note && h("div", { className: "qa-note" }, note),
      h(ErrorText, { error }),
      !data.canEdit && h("div", { className: "qa-note" }, T.readOnly),
      h(
        "div",
        { className: "qa-scroll" },
        h(
          "div",
          { className: "qa-matrix", role: "table", style: { gridTemplateColumns: `minmax(min(220px, 42vw), 1fr) repeat(${columns.length}, 112px)`, minWidth: `calc(min(220px, 42vw) + ${columns.length * 112}px)` } },
          h("div", { className: "qa-th qa-c" }, T.case),
          columns.map((p) => h("div", { key: p.id ?? "-", className: "qa-th qa-p" }, p.title)),
          rows,
        ),
        !shown.length && h("div", { className: "qa-note" }, T.nothing),
      ),
      h(DbLinks, { databases: data.databases }),
      editable &&
        h(
          "div",
          { className: "qa-row nootion-hover-only" },
          h("button", { type: "button", className: "qa-link", onClick: () => window.confirm(T.confirmAnother) && onAnother() }, T.another),
        ),
      openResult &&
        h(ResultPopover, {
          key: openResult.id,
          result: openResult,
          anchor: open.anchor,
          statuses: data.statuses,
          caseTitle: open.caseTitle,
          productTitle: open.productTitle,
          onSave: (patch) => save(openResult.id, patch),
          onClose: () => setOpen(null),
        }),
    );
  }

  /** What readers of a public page see: the figures the block kept. */
  function PublicSummary({ summary }) {
    if (!summary) return h(Box, null, h(Head, null, h("span", { className: "qa-title" }, T.title)), h("div", { className: "qa-sub" }, T.signIn));
    const results = Object.entries(summary.counts ?? {}).flatMap(([status, n]) => Array.from({ length: n }, () => ({ status })));
    return h(
      Box,
      null,
      h(
        Head,
        null,
        h("span", { className: "qa-title" }, summary.title || T.title),
        summary.version && h("span", { className: "qa-sub" }, summary.version),
        h("span", { className: `qa-badge ${summary.status === "done" ? "done" : ""}` }, summary.status === "done" ? T.done : T.open),
      ),
      h(Progress, { results, statuses: [] }),
    );
  }

  function TestRun({ data, setData, editable, pageId }) {
    // Public pages: no page id and no editing.
    if (!editable && !pageId) return h(PublicSummary, { summary: data.summary });
    if (!data.setId) return editable ? h(Setup, { pageId, onPicked: (setId) => setData({ setId }) }) : h(Box, null, h("div", { className: "qa-sub" }, "🧪 ", T.notSetUp));
    if (!data.runId)
      return editable
        ? h(NewRun, { setId: data.setId, onStarted: (runId, scope) => setData({ setId: data.setId, runId, scope }), onOtherSet: () => setData({}) })
        : h(Box, null, h("div", { className: "qa-sub" }, "🧪 ", T.notSetUp));
    return h(RunView, {
      key: data.runId,
      setId: data.setId,
      runId: data.runId,
      scope: data.scope,
      editable,
      onAnother: () => setData({ setId: data.setId }),
      onSummary: (summary) => {
        if (JSON.stringify(summary) !== JSON.stringify(data.summary)) setData({ ...data, summary });
      },
    });
  }

  nootion.registerBlock("run", TestRun);
}
