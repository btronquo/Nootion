import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";

let app: FastifyInstance;
let boris: Client;
let ws: string;
let db: string;
let statut: string;
let payeLe: string;
let echeance: string;
let note: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  ws = await boris.personalWorkspace();
  db = (await boris.post("/api/databases", { workspaceId: ws, parentId: null, title: "Factures" })).json().database.id;
  const prop = async (name: string, type: string, config = {}) =>
    (await boris.post(`/api/databases/${db}/properties`, { name, type, config })).json().property.id;
  statut = await prop("Statut", "select", {
    options: [
      { id: "a", name: "À payer" },
      { id: "b", name: "Payé" },
    ],
  });
  payeLe = await prop("Payé le", "date");
  echeance = await prop("Échéance", "date");
  note = await prop("Note", "text");
});

const addRow = async (title: string, values: Record<string, unknown> = {}) =>
  (await boris.post(`/api/databases/${db}/rows`, { title, values })).json().row.id as string;
const values = async (row: string) => (await boris.get(`/api/databases/${db}/rows/${row}`)).json().row.values;
const automation = (body: unknown) => boris.post(`/api/databases/${db}/automations`, body);
const settle = () => app.automations.idle();

describe("automations", () => {
  it("runs steps on the row when one is added, or when a column takes a value", async () => {
    expect(
      (await automation({ name: "Nouvelle", trigger: { type: "row_added" }, steps: [{ type: "update_row", values: { [statut]: "À payer" } }] })).statusCode,
    ).toBe(200);
    const paid = (
      await automation({
        name: "Payée",
        trigger: { type: "property_changed", propertyId: statut, to: "payé" },
        steps: [{ type: "update_row", values: { [payeLe]: "2026-11-02", [note]: "{{row.title}} réglée" } }],
      })
    ).json().automation;
    // Its own changes set nothing off: this one would loop otherwise.
    await automation({ trigger: { type: "property_changed", propertyId: note, to: null }, steps: [{ type: "update_row", values: { [note]: "boucle" } }] });

    const row = await addRow("EDF");
    await settle();
    expect(await values(row)).toMatchObject({ [statut]: "a", [payeLe]: null });

    // Another value doesn't count; "Payé" does.
    await boris.patch(`/api/databases/${db}/rows/${row}`, { values: { [statut]: "a" } });
    await settle();
    expect((await values(row))[payeLe]).toBeNull();
    // The answer already holds what the automation changed.
    const res = await boris.patch(`/api/databases/${db}/rows/${row}`, { values: { [statut]: "b" } });
    expect(res.json().row.values[payeLe]).toEqual({ start: "2026-11-02", end: null });
    await settle();
    expect(await values(row)).toMatchObject({ [payeLe]: { start: "2026-11-02", end: null }, [note]: "EDF réglée" });

    const list = (await boris.get(`/api/databases/${db}/automations`)).json().automations;
    expect(list.find((a: { id: string }) => a.id === paid.id).runs).toMatchObject([{ rowId: row, rowTitle: "EDF", error: null }]);
    // The loop one never ran: changes made by automations don't count.
    expect(list[2].runs).toEqual([]);

    // Paused, it does nothing.
    await boris.post(`/api/automations/${paid.id}/enabled`, { enabled: false });
    const other = await addRow("Eau");
    await boris.patch(`/api/databases/${db}/rows/${other}`, { values: { [statut]: "b" } });
    await settle();
    expect((await values(other))[payeLe]).toBeNull();
  });

  it("goes off once when a date arrives", async () => {
    await automation({
      name: "Relance",
      trigger: { type: "date_reached", propertyId: echeance },
      steps: [{ type: "update_row", values: { [note]: "À relancer" } }],
    });
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date(Date.now() + 2 * 86_400_000);
    now.setHours(10, 0, 0, 0);
    const due = await addRow("Loyer", { [echeance]: { start: day(now), end: null } });
    const later = await addRow("Assurance", { [echeance]: { start: `${day(now)}T11:30`, end: null } });
    await app.automations.tick(now);
    await app.automations.tick(now);
    expect((await values(due))[note]).toBe("À relancer");
    expect((await values(later))[note]).toBeNull();
    const runs = (await boris.get(`/api/databases/${db}/automations`)).json().automations[0].runs;
    expect(runs).toHaveLength(1);

    // Moving the date sets it off again, once it arrives.
    await boris.patch(`/api/databases/${db}/rows/${due}`, { values: { [note]: "", [echeance]: { start: `${day(now)}T09:45`, end: null } } });
    await app.automations.tick(now);
    expect((await values(due))[note]).toBe("À relancer");
  });

  it("logs failed steps, checks the trigger, and is only for the database's editors", async () => {
    const failing = (await automation({ trigger: { type: "row_added" }, steps: [{ type: "update_row", values: { [payeLe]: "pas une date" } }] })).json()
      .automation;
    await addRow("Gaz");
    await settle();
    const [run] = (await boris.get(`/api/databases/${db}/automations`)).json().automations[0].runs;
    expect(run.error).toMatch(/pas une date/);

    expect((await automation({ trigger: { type: "date_reached", propertyId: note }, steps: [{ type: "update_row", values: {} }] })).statusCode).toBe(400);
    expect(
      (await automation({ trigger: { type: "property_changed", propertyId: "nope", to: null }, steps: [{ type: "update_row", values: {} }] })).statusCode,
    ).toBe(400);
    expect((await automation({ trigger: { type: "row_added" }, steps: [] })).statusCode).toBe(400);

    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    await boris.put(`/api/pages/${db}/shares`, { userId: await alice.id(), role: "viewer" });
    expect((await alice.get(`/api/databases/${db}/automations`)).statusCode).toBe(404);
    expect((await alice.delete(`/api/automations/${failing.id}`)).statusCode).toBe(404);
    // Rows Alice can't edit stay out of her reach through an automation she can't set up.
    expect((await boris.delete(`/api/automations/${failing.id}`)).statusCode).toBe(200);
    expect((await boris.get(`/api/databases/${db}/automations`)).json().automations).toEqual([]);
  });
});
