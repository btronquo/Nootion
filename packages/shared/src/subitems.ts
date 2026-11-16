import { statusGroupOf, type DatabaseProperty, type DatabaseRow } from "./databases.js";

/**
 * Sub-items and dependencies are relations of a database to itself with a role: "parent" (one row at most) and its
 * twin "children"; "blocks" and its twin "blockedBy". Filters, rollups, formulas and the API see ordinary relations.
 */
export type RelationRole = "parent" | "children" | "blocks" | "blockedBy";

/** How far moving a row's dates carries along the rows it blocks, and how deep a tree is followed. */
export const MAX_CHAIN_DEPTH = 50;

/** The relation column of a database with a role, if any. */
export function roleProperty(properties: DatabaseProperty[], role: RelationRole): DatabaseProperty | undefined {
  return properties.find((p) => p.type === "relation" && p.config.role === role);
}

/** The two columns of sub-items, when they are turned on. */
export function subItemProps(properties: DatabaseProperty[]): { parent: DatabaseProperty; children: DatabaseProperty } | null {
  const parent = roleProperty(properties, "parent");
  const children = roleProperty(properties, "children");
  return parent && children ? { parent, children } : null;
}

/** The two columns of dependencies, when they are turned on. */
export function dependencyProps(properties: DatabaseProperty[]): { blocks: DatabaseProperty; blockedBy: DatabaseProperty } | null {
  const blocks = roleProperty(properties, "blocks");
  const blockedBy = roleProperty(properties, "blockedBy");
  return blocks && blockedBy ? { blocks, blockedBy } : null;
}

const ids = (row: DatabaseRow | undefined, propId: string): string[] => {
  const v = row?.values[propId];
  return Array.isArray(v) ? (v as string[]) : [];
};

/**
 * Whether `to` can be reached from `from` by following `next` (the rows a row links to): adding a link from `to`
 * back to `from` would then close a loop. A row reaches itself.
 */
export function reaches(next: (id: string) => readonly string[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...next(id));
  }
  return false;
}

export interface TreeRow {
  row: DatabaseRow;
  depth: number;
  /** Sub-items shown under it (folded or not). */
  childCount: number;
  /** Shown only because one of its sub-items matches the view's filters. */
  context: boolean;
}

/**
 * Rows of a view as a tree: sub-items under their parent, in the view's order. A sub-item matching the filters keeps
 * its parents visible (marked as context); rows inside a folded parent are left out.
 */
export function nestRows(shown: DatabaseRow[], all: DatabaseRow[], parentPropId: string, folded: ReadonlySet<string> = new Set()): TreeRow[] {
  const byId = new Map(all.map((r) => [r.id, r]));
  for (const r of shown) byId.set(r.id, r);
  const parentOf = (r: DatabaseRow): DatabaseRow | undefined => {
    const id = ids(r, parentPropId)[0];
    return id && id !== r.id ? byId.get(id) : undefined;
  };
  // Each row is placed where its first matching row (itself or a sub-item) comes in the view.
  const order = new Map<string, number>();
  const matching = new Set(shown.map((r) => r.id));
  shown.forEach((r, i) => {
    let cur: DatabaseRow | undefined = r;
    for (let depth = 0; cur && depth <= MAX_CHAIN_DEPTH; depth++) {
      const at = order.get(cur.id);
      if (at !== undefined && at <= i) break;
      order.set(cur.id, i);
      cur = parentOf(cur);
    }
  });
  const children = new Map<string, DatabaseRow[]>();
  const roots: DatabaseRow[] = [];
  for (const id of order.keys()) {
    const r = byId.get(id)!;
    const p = parentOf(r);
    if (p && order.has(p.id)) {
      const list = children.get(p.id) ?? [];
      list.push(r);
      children.set(p.id, list);
    } else roots.push(r);
  }
  const byOrder = (a: DatabaseRow, b: DatabaseRow) => order.get(a.id)! - order.get(b.id)!;
  const out: TreeRow[] = [];
  const placed = new Set<string>();
  const visit = (r: DatabaseRow, depth: number, hidden: boolean) => {
    if (placed.has(r.id)) return;
    placed.add(r.id);
    const kids = (children.get(r.id) ?? []).sort(byOrder);
    if (!hidden) out.push({ row: r, depth, childCount: kids.length, context: !matching.has(r.id) });
    if (depth >= MAX_CHAIN_DEPTH) return;
    for (const k of kids) visit(k, depth + 1, hidden || folded.has(r.id));
  };
  for (const r of roots.sort(byOrder)) visit(r, 0, false);
  // Rows caught in a loop (stored before loops were refused) still show, at the top level.
  for (const id of order.keys()) if (!placed.has(id)) visit(byId.get(id)!, 0, false);
  return out;
}

/**
 * Whether a row counts as done, for the progress of its parent: its first status column is in the "done" category,
 * or else its first checkbox is checked. Null when the database has neither.
 */
export function rowDone(properties: DatabaseProperty[], row: DatabaseRow): boolean | null {
  const status = properties.find((p) => p.type === "status");
  if (status) {
    const v = row.values[status.id];
    return v != null && statusGroupOf(status.config.options?.find((o) => o.id === v)) === "done";
  }
  const box = properties.find((p) => p.type === "checkbox");
  return box ? row.values[box.id] === true : null;
}

/** Sub-items of a row, in the database's order, with how many are done (null: nothing tells). */
export function subItemsOf(properties: DatabaseProperty[], rows: DatabaseRow[], row: DatabaseRow): { items: DatabaseRow[]; done: number | null } {
  const sub = subItemProps(properties);
  if (!sub) return { items: [], done: null };
  const wanted = new Set(ids(row, sub.children.id));
  const items = rows.filter((r) => wanted.has(r.id) && r.id !== row.id);
  const states = items.map((r) => rowDone(properties, r));
  return { items, done: states.some((s) => s === null) ? null : states.filter(Boolean).length };
}
