import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { applyView, nestRows, subItemProps, subItemsOf, dependencyProps, type DatabaseData, type DatabaseProperty } from "@nootion/shared";
import { Client, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
});

async function createDb(title = "Tâches"): Promise<DatabaseData> {
  const res = await boris.post("/api/databases", { workspaceId: await boris.personalWorkspace(), parentId: null, title });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().database;
}
const getDb = async (id: string): Promise<DatabaseData> => (await boris.get(`/api/databases/${id}`)).json().database;
const structure = async (id: string, body: object) => {
  const res = await boris.put(`/api/databases/${id}/structure`, body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().properties as DatabaseProperty[];
};
async function addRow(dbId: string, title: string, values: Record<string, unknown> = {}) {
  const d = await getDb(dbId);
  const res = await boris.post(`/api/databases/${dbId}/rows`, { values: { [d.properties[0]!.id]: title, ...values } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().row.id as string;
}
const patch = (dbId: string, rowId: string, values: Record<string, unknown>) => boris.patch(`/api/databases/${dbId}/rows/${rowId}`, { values });
const valuesOf = async (dbId: string) => new Map((await getDb(dbId)).rows.map((r) => [r.title, r.values]));

describe("sub-items", () => {
  it("are turned on as two twin relations of the database to itself, and off again", async () => {
    const d = await createDb();
    const props = await structure(d.id, { subItems: true });
    const sub = subItemProps(props)!;
    expect(sub.parent).toMatchObject({
      name: "Élément parent",
      type: "relation",
      config: { databaseId: d.id, role: "parent", twinPropertyId: sub.children.id },
    });
    expect(sub.children).toMatchObject({ name: "Sous-éléments", config: { databaseId: d.id, role: "children", twinPropertyId: sub.parent.id } });
    // Turning it on again changes nothing.
    expect(subItemProps(await structure(d.id, { subItems: true }))!.parent.id).toBe(sub.parent.id);
    // A role can't be given or taken through the column routes.
    const plain = await boris.post(`/api/databases/${d.id}/properties`, { name: "Lien", type: "relation", config: { databaseId: d.id, role: "parent" } });
    expect(plain.json().property.config.role).toBeUndefined();
    await boris.patch(`/api/databases/${d.id}/properties/${sub.parent.id}`, { name: "Projet", config: { databaseId: d.id } });
    expect((await getDb(d.id)).properties.find((p) => p.id === sub.parent.id)).toMatchObject({
      name: "Projet",
      config: { role: "parent", twinPropertyId: sub.children.id },
    });

    expect(subItemProps(await structure(d.id, { subItems: false }))).toBeNull();
    // Deleting one of the two columns removes the other.
    const again = subItemProps(await structure(d.id, { subItems: true }))!;
    await boris.delete(`/api/databases/${d.id}/properties/${again.children.id}`);
    expect((await getDb(d.id)).properties.some((p) => p.id === again.parent.id)).toBe(false);
  });

  it("keeps both sides in step, one parent per row, and refuses loops", async () => {
    const d = await createDb();
    const { parent, children } = subItemProps(await structure(d.id, { subItems: true }))!;
    const projet = await addRow(d.id, "Projet");
    const autre = await addRow(d.id, "Autre");
    const tache = await addRow(d.id, "Tâche", { [parent.id]: [projet] });
    const detail = await addRow(d.id, "Détail", { [parent.id]: [tache] });
    let v = await valuesOf(d.id);
    expect(v.get("Projet")![children.id]).toEqual([tache]);
    expect(v.get("Tâche")![children.id]).toEqual([detail]);

    // Two parents, itself, or one of its own sub-items as parent: refused.
    expect((await patch(d.id, tache, { [parent.id]: [projet, autre] })).statusCode).toBe(400);
    expect((await patch(d.id, tache, { [parent.id]: [tache] })).statusCode).toBe(400);
    const loop = await patch(d.id, projet, { [parent.id]: [detail] });
    expect(loop.statusCode).toBe(400);
    expect(loop.json().message).toContain("propres sous-éléments");
    expect((await patch(d.id, detail, { [children.id]: [projet] })).statusCode).toBe(400);

    // Given as a sub-item of another row from that row's side: it leaves its first parent.
    expect((await patch(d.id, autre, { [children.id]: [tache] })).statusCode).toBe(200);
    v = await valuesOf(d.id);
    expect(v.get("Tâche")![parent.id]).toEqual([autre]);
    expect(v.get("Projet")![children.id] ?? null).toBeNull();
    expect(v.get("Autre")![children.id]).toEqual([tache]);

    // A copy stays beside the row under the same parent, without its sub-items.
    const copy = (await boris.post(`/api/databases/${d.id}/rows/${tache}/duplicate`, {})).json().row;
    expect(copy.values[parent.id]).toEqual([autre]);
    expect(copy.values[children.id] ?? null).toBeNull();
    expect((await valuesOf(d.id)).get("Autre")![children.id]).toEqual([tache, copy.id]);
  });

  it("shows sub-items under their parent; a matching sub-item keeps its parents in view", async () => {
    const d = await createDb();
    const props = await structure(d.id, { subItems: true });
    const { parent } = subItemProps(props)!;
    const status = (await boris.post(`/api/databases/${d.id}/properties`, { name: "État", type: "status" })).json().property as DatabaseProperty;
    const a = await addRow(d.id, "A");
    const a1 = await addRow(d.id, "A1", { [parent.id]: [a], [status.id]: "done" });
    await addRow(d.id, "A2", { [parent.id]: [a] });
    await addRow(d.id, "A1x", { [parent.id]: [a1] });
    await addRow(d.id, "B");
    const data = await getDb(d.id);
    const ctx = { ...data, me: null };
    const tree = nestRows(applyView(ctx, {}), data.rows, parent.id);
    expect(tree.map((x) => `${"-".repeat(x.depth)}${x.row.title}`)).toEqual(["A", "-A1", "--A1x", "-A2", "B"]);
    expect(tree[0]).toMatchObject({ childCount: 2, context: false });
    // Folded: its sub-items are left out.
    expect(nestRows(data.rows, data.rows, parent.id, new Set([a])).map((x) => x.row.title)).toEqual(["A", "B"]);
    // Filtered on "A1x": its parent and grand-parent show around it, as context.
    const filtered = applyView(ctx, { filters: [{ propertyId: data.properties[0]!.id, operator: "contains", value: "A1x" }] });
    expect(nestRows(filtered, data.rows, parent.id).map((x) => [x.row.title, x.context])).toEqual([
      ["A", true],
      ["A1", true],
      ["A1x", false],
    ]);
    // Progress: one of the two sub-items of A is done.
    const row = data.rows.find((r) => r.id === a)!;
    expect(subItemsOf(data.properties, data.rows, row)).toMatchObject({
      done: 1,
      items: [expect.objectContaining({ title: "A1" }), expect.objectContaining({ title: "A2" })],
    });
  });
});

describe("dependencies", () => {
  it("refuse loops, and move the rows a row blocks when asked", async () => {
    const d = await createDb();
    const props = await structure(d.id, { dependencies: true });
    const { blocks, blockedBy } = dependencyProps(props)!;
    expect(blockedBy.name).toBe("Bloqué par");
    expect(blocks.name).toBe("Bloque");
    const date = (await boris.post(`/api/databases/${d.id}/properties`, { name: "Quand", type: "date" })).json().property as DatabaseProperty;
    const conception = await addRow(d.id, "Conception", { [date.id]: { start: "2026-12-01", end: "2026-12-04" } });
    const dev = await addRow(d.id, "Développement", { [date.id]: { start: "2026-12-07", end: "2026-12-18" }, [blockedBy.id]: [conception] });
    const recette = await addRow(d.id, "Recette", { [date.id]: { start: "2026-12-21T09:00" }, [blockedBy.id]: [dev] });
    expect((await valuesOf(d.id)).get("Conception")![blocks.id]).toEqual([dev]);

    // Recette can't block Conception: Conception → Développement → Recette would come back to it.
    const loop = await patch(d.id, recette, { [blocks.id]: [conception] });
    expect(loop.statusCode).toBe(400);
    expect(loop.json().message).toContain("s'attendre elle-même");
    expect((await patch(d.id, conception, { [blockedBy.id]: [recette] })).statusCode).toBe(400);

    // Off: moving a row moves only that row.
    await patch(d.id, conception, { [date.id]: { start: "2026-12-02", end: "2026-12-05" } });
    expect((await valuesOf(d.id)).get("Développement")![date.id]).toEqual({ start: "2026-12-07", end: "2026-12-18" });

    // On: the end moved by 3 days, so do the rows waiting on it, down the chain; times are kept.
    const on = await boris.patch(`/api/databases/${d.id}/properties/${blocks.id}`, { config: { ...blocks.config, shiftDependents: true } });
    expect(on.json().property.config.shiftDependents).toBe(true);
    await patch(d.id, conception, { [date.id]: { start: "2026-12-02", end: "2026-12-08" } });
    let v = await valuesOf(d.id);
    expect(v.get("Développement")![date.id]).toEqual({ start: "2026-12-10", end: "2026-12-21" });
    expect(v.get("Recette")![date.id]).toEqual({ start: "2026-12-24T09:00", end: null });
    // Moving the start alone (the end stays) moves nothing else.
    await patch(d.id, conception, { [date.id]: { start: "2026-11-30", end: "2026-12-08" } });
    v = await valuesOf(d.id);
    expect(v.get("Développement")![date.id]).toEqual({ start: "2026-12-10", end: "2026-12-21" });
    // The option is only kept on the "blocking" column.
    const other = await boris.patch(`/api/databases/${d.id}/properties/${blockedBy.id}`, { config: { ...blockedBy.config, shiftDependents: true } });
    expect(other.json().property.config.shiftDependents).toBeUndefined();
  });
});
