// "qa" plugin, server side: test cases, runs and results kept in four ordinary databases ("a QA set"):
//   Test cases ─┐
//   Products ───┼── Results (one row per case × product of a run, with its status)
//   Runs ───────┘
// Everything is read and written through Nootion's API as the user, so a person only sees and changes what they could
// see and change in the databases themselves. The plugin only remembers which databases (and columns) make up each set.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Result statuses, by the option id they have in the "Status" column (the names can be renamed freely). */
export const STATUSES = ["untested", "passed", "failed", "blocked", "skipped"];
const STATUS_COLORS = { untested: "gray", passed: "green", failed: "red", blocked: "orange", skipped: "brown" };
const PRIORITIES = ["critical", "high", "medium", "low"];
const PRIORITY_COLORS = { critical: "red", high: "orange", medium: "yellow", low: "gray" };
/** Results a single run may hold (cases × products). */
const MAX_RESULTS = 3000;

const TEXTS = {
  en: {
    cases: "Test cases",
    products: "Products",
    runs: "Test runs",
    results: "Results",
    suite: "Suite",
    priority: "Priority",
    preconditions: "Preconditions",
    expected: "Expected result",
    version: "Version",
    status: "Status",
    started: "Started",
    finished: "Finished",
    run: "Run",
    case: "Case",
    product: "Product",
    tester: "Tester",
    testedAt: "Tested on",
    comment: "Comment",
    bug: "Bug",
    s_untested: "Untested",
    s_passed: "Passed",
    s_failed: "Failed",
    s_blocked: "Blocked",
    s_skipped: "Skipped",
    p_critical: "Critical",
    p_high: "High",
    p_medium: "Medium",
    p_low: "Low",
    r_open: "In progress",
    r_done: "Done",
    noSet: "These test databases are no longer set up (or you can't open them).",
    noRun: "This run no longer exists.",
    noCases: "No test case matches: add some to the \"{cases}\" database first.",
    tooMany: "This run would hold {n} results; at most {max} are allowed. Pick fewer suites or products.",
    needPage: "Put the block in a page you can edit to create the databases there.",
    badStatus: "Unknown status.",
  },
  fr: {
    cases: "Cas de test",
    products: "Produits",
    runs: "Test runs",
    results: "Résultats",
    suite: "Suite",
    priority: "Priorité",
    preconditions: "Préconditions",
    expected: "Résultat attendu",
    version: "Version",
    status: "Statut",
    started: "Début",
    finished: "Fin",
    run: "Run",
    case: "Cas",
    product: "Produit",
    tester: "Testeur",
    testedAt: "Testé le",
    comment: "Commentaire",
    bug: "Bug",
    s_untested: "Non testé",
    s_passed: "Réussi",
    s_failed: "Échoué",
    s_blocked: "Bloqué",
    s_skipped: "Ignoré",
    p_critical: "Critique",
    p_high: "Haute",
    p_medium: "Moyenne",
    p_low: "Basse",
    r_open: "En cours",
    r_done: "Terminé",
    noSet: "Ces bases de test ne sont plus configurées (ou vous ne pouvez pas les ouvrir).",
    noRun: "Ce run n'existe plus.",
    noCases: "Aucun cas de test ne correspond : ajoutez-en d'abord dans la base « {cases} ».",
    tooMany: "Ce run contiendrait {n} résultats, au plus {max} sont permis. Choisissez moins de suites ou de produits.",
    needPage: "Placez le bloc dans une page que vous pouvez modifier pour y créer les bases.",
    badStatus: "Statut inconnu.",
  },
};

export function activate(nootion) {
  const lang = () => TEXTS[nootion.locale()] ?? TEXTS.en;
  const text = (key, vars = {}) => lang()[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const fail = (status, code, key, vars) => new nootion.HttpError(status, code, text(key, vars));

  // --- QA sets, kept in a file of the plugin's folder ---------------------------------------------

  const file = path.join(nootion.dataDir, "sets.json");
  /** @type {Record<string, QaSet>} */
  let sets = {};
  try {
    sets = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    sets = {};
  }
  const save = () => {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(sets, null, 1));
    fs.renameSync(`${file}.tmp`, file);
  };

  /** A set the user can open (they must be able to read its databases). */
  function setFor(user, setId) {
    const set = sets[setId];
    const dbs = set && [set.cases.id, set.products.id, set.runs.id, set.results.id];
    if (!set || dbs.some((id) => !nootion.pages.role(user.id, id))) throw fail(404, "qa_no_set", "noSet");
    return set;
  }

  const api = (user, method, apiPath, body) => nootion.request(user.id, method, apiPath, body);

  /** Every row of a database (the API gives them a thousand at a time). */
  async function allRows(user, databaseId) {
    const rows = [];
    let cursor;
    let people = {};
    for (;;) {
      const page = await api(user, "POST", `/databases/${databaseId}/query`, { limit: 1000, ...(cursor ? { cursor } : {}) });
      rows.push(...page.rows);
      people = { ...people, ...page.people };
      if (!page.nextCursor) return { rows, properties: page.properties, people };
      cursor = page.nextCursor;
    }
  }

  const options = (keys, prefix, colors) => keys.map((k) => ({ id: k, name: text(`${prefix}_${k}`), color: colors[k] }));

  // --- Creating a set ---------------------------------------------------------------------------

  async function createSet(user, pageId) {
    const role = pageId ? nootion.pages.role(user.id, pageId) : null;
    if (!role || role === "viewer" || role === "commenter") throw fail(403, "qa_need_page", "needPage");
    const { page } = await api(user, "GET", `/pages/${pageId}`);
    const newDb = async (key, icon) => {
      const { database } = await api(user, "POST", "/databases", { workspaceId: page.workspaceId, parentId: pageId, title: text(key) });
      await api(user, "PATCH", `/pages/${database.id}`, { icon }).catch(() => {});
      return database;
    };
    const prop = async (databaseId, name, type, config = {}, twoWay) =>
      (await api(user, "POST", `/databases/${databaseId}/properties`, { name, type, config, ...(twoWay ? { twoWay } : {}) })).property;
    const titleOf = (database) => database.properties.find((p) => p.type === "title").id;
    const dropTags = (database) =>
      Promise.all(database.properties.filter((p) => p.type === "multi_select").map((p) => api(user, "DELETE", `/databases/${database.id}/properties/${p.id}`)));

    const cases = await newDb("cases", "🧪");
    const products = await newDb("products", "🎮");
    const runs = await newDb("runs", "🏃");
    const results = await newDb("results", "✅");
    await Promise.all([dropTags(products), dropTags(runs), dropTags(results)]);

    const set = {
      id: randomUUID(),
      workspaceId: page.workspaceId,
      pageId,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      cases: { id: cases.id, title: titleOf(cases) },
      products: { id: products.id, title: titleOf(products) },
      runs: { id: runs.id, title: titleOf(runs) },
      results: { id: results.id, title: titleOf(results) },
    };
    set.cases.suite = (await prop(cases.id, text("suite"), "select", { options: [] })).id;
    set.cases.priority = (await prop(cases.id, text("priority"), "select", { options: options(PRIORITIES, "p", PRIORITY_COLORS) })).id;
    set.cases.preconditions = (await prop(cases.id, text("preconditions"), "text")).id;
    set.cases.expected = (await prop(cases.id, text("expected"), "text")).id;

    set.runs.version = (await prop(runs.id, text("version"), "text")).id;
    set.runs.status = (await prop(runs.id, text("status"), "select", { options: [{ id: "open", name: text("r_open"), color: "blue" }, { id: "done", name: text("r_done"), color: "green" }] })).id;
    set.runs.started = (await prop(runs.id, text("started"), "date", { includeTime: false })).id;
    set.runs.finished = (await prop(runs.id, text("finished"), "date", { includeTime: false })).id;

    // Two-way relations: each case, product and run lists its results.
    set.results.run = (await prop(results.id, text("run"), "relation", { databaseId: runs.id }, true)).id;
    set.results.case = (await prop(results.id, text("case"), "relation", { databaseId: cases.id }, true)).id;
    set.results.product = (await prop(results.id, text("product"), "relation", { databaseId: products.id }, true)).id;
    set.results.status = (await prop(results.id, text("status"), "select", { options: options(STATUSES, "s", STATUS_COLORS) })).id;
    set.results.tester = (await prop(results.id, text("tester"), "person")).id;
    set.results.testedAt = (await prop(results.id, text("testedAt"), "date", { includeTime: true })).id;
    set.results.comment = (await prop(results.id, text("comment"), "text")).id;
    set.results.bug = (await prop(results.id, text("bug"), "url")).id;

    sets[set.id] = set;
    save();
    return set;
  }

  // --- Reading --------------------------------------------------------------------------------

  const optionsOf = (properties, propId) => (properties.find((p) => p.id === propId)?.config.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color }));
  const one = (v) => (Array.isArray(v) ? (v[0] ?? null) : null);

  /** Cases matching a run's scope: some suites and priorities (none chosen: all of them). */
  function inScope(set, row, scope) {
    const suites = scope?.suites ?? [];
    const priorities = scope?.priorities ?? [];
    if (suites.length && !suites.includes(row.values[set.cases.suite] ?? "")) return false;
    if (priorities.length && !priorities.includes(row.values[set.cases.priority] ?? "")) return false;
    return true;
  }

  async function summary(user, set) {
    const [cases, products, runs] = await Promise.all([allRows(user, set.cases.id), allRows(user, set.products.id), allRows(user, set.runs.id)]);
    const role = nootion.pages.role(user.id, set.results.id);
    return {
      id: set.id,
      databases: { cases: set.cases.id, products: set.products.id, runs: set.runs.id, results: set.results.id },
      canEdit: role === "editor" || role === "full",
      suites: optionsOf(cases.properties, set.cases.suite),
      priorities: optionsOf(cases.properties, set.cases.priority),
      cases: cases.rows.map((r) => ({ id: r.id, title: r.title, suite: r.values[set.cases.suite] ?? null, priority: r.values[set.cases.priority] ?? null })),
      products: products.rows.map((r) => ({ id: r.id, title: r.title || "—" })),
      runs: runs.rows.map((r) => ({ id: r.id, title: r.title, status: r.values[set.runs.status] ?? null })),
    };
  }

  async function loadRun(user, set, runId) {
    let run;
    try {
      run = (await api(user, "GET", `/databases/${set.runs.id}/rows/${runId}`)).row;
    } catch (e) {
      if (e.statusCode === 404) throw fail(404, "qa_no_run", "noRun");
      throw e;
    }
    const [results, cases, products] = await Promise.all([allRows(user, set.results.id), allRows(user, set.cases.id), allRows(user, set.products.id)]);
    const mine = results.rows.filter((r) => (r.values[set.results.run] ?? []).includes(runId));
    const caseById = new Map(cases.rows.map((r, i) => [r.id, { r, i }]));
    const productIds = new Set(mine.map((r) => one(r.values[set.results.product])).filter(Boolean));
    const caseIds = new Set(mine.map((r) => one(r.values[set.results.case])).filter(Boolean));
    const suites = optionsOf(cases.properties, set.cases.suite);
    const suiteOrder = new Map(suites.map((s, i) => [s.id, i]));
    const caseList = [...caseIds]
      .map((id) => {
        const c = caseById.get(id);
        // A case deleted since the run started keeps its results, under its last known title.
        if (!c) {
          const res = mine.find((r) => one(r.values[set.results.case]) === id);
          return { id, title: res?.title ?? "", suite: null, priority: null, deleted: true, order: Infinity };
        }
        return { id, title: c.r.title, suite: c.r.values[set.cases.suite] ?? null, priority: c.r.values[set.cases.priority] ?? null, order: c.i };
      })
      .sort((a, b) => (suiteOrder.get(a.suite) ?? 1e9) - (suiteOrder.get(b.suite) ?? 1e9) || a.order - b.order)
      .map(({ order: _o, ...c }) => c);
    const role = nootion.pages.role(user.id, set.results.id);
    return {
      set: set.id,
      databases: { cases: set.cases.id, products: set.products.id, runs: set.runs.id, results: set.results.id },
      canEdit: role === "editor" || role === "full",
      run: {
        id: run.id,
        title: run.title,
        version: run.values[set.runs.version] ?? "",
        status: run.values[set.runs.status] ?? "open",
        started: run.values[set.runs.started]?.start ?? null,
        finished: run.values[set.runs.finished]?.start ?? null,
      },
      suites,
      priorities: optionsOf(cases.properties, set.cases.priority),
      statuses: optionsOf(results.properties, set.results.status),
      products: products.rows.filter((r) => productIds.has(r.id)).map((r) => ({ id: r.id, title: r.title || "—" })),
      cases: caseList,
      results: mine.map((r) => resultOut(set, r, results.people)),
    };
  }

  function resultOut(set, r, people) {
    const tester = one(r.values[set.results.tester]);
    return {
      id: r.id,
      case: one(r.values[set.results.case]),
      product: one(r.values[set.results.product]),
      status: r.values[set.results.status] ?? "untested",
      tester: tester ? (people?.[tester] ?? null) : null,
      testedAt: r.values[set.results.testedAt]?.start ?? null,
      comment: r.values[set.results.comment] ?? "",
      bug: r.values[set.results.bug] ?? "",
    };
  }

  // --- Writing ----------------------------------------------------------------------------------

  /** Adds the missing results of a run: one per case in scope and product (or one per case without products). */
  async function addResults(user, set, runId, caseRows, productRows, existing) {
    const have = new Set(existing.map((r) => `${r.case}|${r.product ?? ""}`));
    const targets = productRows.length ? productRows : [null];
    const todo = [];
    for (const c of caseRows) for (const p of targets) if (!have.has(`${c.id}|${p?.id ?? ""}`)) todo.push([c, p]);
    if (existing.length + todo.length > MAX_RESULTS) throw fail(400, "qa_too_many", "tooMany", { n: existing.length + todo.length, max: MAX_RESULTS });
    for (const [c, p] of todo) {
      await api(user, "POST", `/databases/${set.results.id}/rows`, {
        title: p ? `${c.title} · ${p.title}` : c.title,
        templateId: null,
        values: {
          [set.results.run]: [runId],
          [set.results.case]: [c.id],
          ...(p ? { [set.results.product]: [p.id] } : {}),
          [set.results.status]: "untested",
        },
      });
    }
    return todo.length;
  }

  async function createRun(user, set, input) {
    const [cases, products] = await Promise.all([allRows(user, set.cases.id), allRows(user, set.products.id)]);
    const scope = { suites: strings(input.suites), priorities: strings(input.priorities) };
    const caseRows = cases.rows.filter((r) => inScope(set, r, scope));
    if (!caseRows.length) throw fail(400, "qa_no_cases", "noCases", { cases: text("cases") });
    const wanted = new Set(strings(input.products));
    const productRows = products.rows.filter((r) => wanted.has(r.id));
    const total = caseRows.length * Math.max(1, productRows.length);
    if (total > MAX_RESULTS) throw fail(400, "qa_too_many", "tooMany", { n: total, max: MAX_RESULTS });
    const title = String(input.title ?? "").trim().slice(0, 500);
    const { row } = await api(user, "POST", `/databases/${set.runs.id}/rows`, {
      title,
      templateId: null,
      values: {
        [set.runs.version]: String(input.version ?? "").trim().slice(0, 200) || null,
        [set.runs.status]: "open",
        [set.runs.started]: { start: new Date().toISOString().slice(0, 10) },
      },
    });
    await addResults(user, set, row.id, caseRows, productRows.map((r) => ({ id: r.id, title: r.title || "—" })), []);
    return row.id;
  }

  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x).slice(0, 500) : []);

  // --- Routes -----------------------------------------------------------------------------------

  // The sets the user can open, with what a new run can be made of.
  nootion.route("GET", "/sets", async ({ user }) => {
    const out = [];
    for (const set of Object.values(sets)) {
      try {
        setFor(user, set.id);
      } catch {
        continue;
      }
      const role = nootion.pages.role(user.id, set.cases.id);
      if (!role) continue;
      const { database } = await api(user, "GET", `/databases/${set.cases.id}`).catch(() => ({ database: null }));
      if (database) out.push({ id: set.id, title: database.title, pageId: set.pageId });
    }
    return { sets: out };
  });

  nootion.route("POST", "/sets", async ({ user, body }) => {
    const set = await createSet(user, typeof body?.pageId === "string" ? body.pageId : null);
    return { set: await summary(user, set) };
  });

  nootion.route("GET", "/sets/:setId", async ({ user, params }) => ({ set: await summary(user, setFor(user, params.setId)) }));

  nootion.route("POST", "/sets/:setId/runs", async ({ user, params, body }) => {
    const set = setFor(user, params.setId);
    const runId = await createRun(user, set, body ?? {});
    return { run: await loadRun(user, set, runId) };
  });

  nootion.route("GET", "/sets/:setId/runs/:runId", async ({ user, params }) => ({ run: await loadRun(user, setFor(user, params.setId), params.runId) }));

  // Adds the cases created since the run started (in its scope), for the products it already covers.
  nootion.route("POST", "/sets/:setId/runs/:runId/sync", async ({ user, params, body }) => {
    const set = setFor(user, params.setId);
    const current = await loadRun(user, set, params.runId);
    const cases = await allRows(user, set.cases.id);
    const scope = { suites: strings(body?.suites), priorities: strings(body?.priorities) };
    const caseRows = cases.rows.filter((r) => inScope(set, r, scope));
    const added = await addResults(user, set, params.runId, caseRows, current.products, current.results);
    return { added, run: added ? await loadRun(user, set, params.runId) : current };
  });

  // Finishes a run, or opens it again.
  nootion.route("PATCH", "/sets/:setId/runs/:runId", async ({ user, params, body }) => {
    const set = setFor(user, params.setId);
    const values = {};
    if (body?.status === "done" || body?.status === "open") {
      values[set.runs.status] = body.status;
      values[set.runs.finished] = body.status === "done" ? { start: new Date().toISOString().slice(0, 10) } : null;
    }
    const input = { values };
    if (typeof body?.title === "string") input.title = body.title.trim().slice(0, 500);
    if (typeof body?.version === "string") values[set.runs.version] = body.version.trim().slice(0, 200) || null;
    await api(user, "PATCH", `/databases/${set.runs.id}/rows/${params.runId}`, input);
    return { run: await loadRun(user, set, params.runId) };
  });

  // Records a result: its status (with who and when), a comment, a link to a bug.
  nootion.route("PATCH", "/sets/:setId/results/:resultId", async ({ user, params, body }) => {
    const set = setFor(user, params.setId);
    const values = {};
    if (body?.status !== undefined) {
      if (!STATUSES.includes(body.status)) throw fail(400, "qa_bad_status", "badStatus");
      values[set.results.status] = body.status;
      values[set.results.tester] = body.status === "untested" ? null : [user.id];
      values[set.results.testedAt] = body.status === "untested" ? null : { start: new Date().toISOString() };
    }
    if (typeof body?.comment === "string") values[set.results.comment] = body.comment.slice(0, 20000) || null;
    if (typeof body?.bug === "string") values[set.results.bug] = body.bug.trim().slice(0, 2000) || null;
    const res = await api(user, "PATCH", `/databases/${set.results.id}/rows/${params.resultId}`, { values });
    const { people } = await api(user, "GET", `/databases/${set.results.id}/rows/${params.resultId}`);
    return { result: resultOut(set, res.row, people) };
  });
}

/**
 * @typedef {{ id: string, title: string, [column: string]: string }} QaDatabase
 * @typedef {{ id: string, workspaceId: string, pageId: string, createdBy: string, createdAt: string,
 *   cases: QaDatabase, products: QaDatabase, runs: QaDatabase, results: QaDatabase }} QaSet
 */
