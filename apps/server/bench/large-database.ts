/**
 * Measures how a database of many rows loads (pnpm --filter @nootion/server bench:db [rows] [runs] [--serve]).
 * Builds a habit tracker like the one Notion exports: a date, a few habit checkboxes, a mood select,
 * a formula and a created time, then times the API calls the web app makes.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { pages } from "../src/db/schema.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ROWS = Number(args[0] ?? 5000);
const RUNS = Number(args[1] ?? 5);
// --serve: keeps the server running on port 3000 with the built web app, to measure it in a browser.
const SERVE = process.argv.includes("--serve");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nootion-bench-"));
const db = openDb(path.join(dataDir, "nootion.db"));
const config = loadConfig({
  APP_SECRET: "bench-secret-0123456789",
  APP_URL: "http://localhost:3000",
  DATA_DIR: dataDir,
  DEMO_PAGE: "false",
  UPDATE_CHECK: "false",
  ...(SERVE ? { WEB_DIR: path.resolve(import.meta.dirname, "../../web/dist"), CONTENT_SECURITY_POLICY: "off" } : {}),
});
const app = await buildApp({ db, config });

let cookie = "";
const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method: method as "GET", url, payload: body as object, headers: { ...(cookie ? { cookie } : {}), ...headers } });
  const set = res.cookies.find((c) => c.name === "nootion_session");
  if (set?.value) cookie = `nootion_session=${set.value}`;
  if (res.statusCode >= 400) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body.slice(0, 200)}`);
  return res;
};

await call("POST", "/api/setup", { name: "Bench", email: "bench@example.com", password: "motdepasse-bench", locale: "fr" });
const workspaceId = (await call("GET", "/api/workspaces")).json().workspaces.find((w: { kind: string }) => w.kind === "personal").id;
const database = (await call("POST", "/api/databases", { workspaceId, parentId: null, title: "Habit tracker" })).json().database;
const id: string = database.id;
const prop = async (name: string, type: string, config: object = {}) =>
  (await call("POST", `/api/databases/${id}/properties`, { name, type, config })).json().property.id as string;

const date = await prop("Date", "date");
const habits = await Promise.all(["Sport", "Lecture", "Méditation", "Eau", "Sommeil", "Écran"].map((n) => prop(n, "checkbox")));
const mood = await prop("Humeur", "select", { options: ["😀", "🙂", "😐", "🙁"].map((name, i) => ({ id: `m${i}`, name, color: "gray" })) });
await prop("Score", "formula", {
  expression: habits.map((_, i) => `toNumber(prop("${["Sport", "Lecture", "Méditation", "Eau", "Sommeil", "Écran"][i]}"))`).join(" + "),
});
await prop("Progression", "formula", { expression: 'round(prop("Score") / 6 * 100) + "%"' });
await prop("Créé le", "created_time");
const notes = await prop("Notes", "text");

const user = (await call("GET", "/api/auth/me")).json().user.id;
const start = Date.UTC(2010, 0, 1);
const t0 = performance.now();
db.transaction((tx) => {
  for (let i = 0; i < ROWS; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const props: Record<string, unknown> = { [date]: { start: day, end: null }, [mood]: `m${i % 4}` };
    habits.forEach((h, j) => {
      if ((i * 7 + j * 3) % 5 < 3) props[h] = true;
    });
    if (i % 3 === 0) props[notes] = `Journée ${i}, rien de spécial à signaler.`;
    tx.insert(pages).values({ id: randomUUID(), kind: "row", workspaceId, parentId: id, title: day, props, position: i, createdBy: user }).run();
  }
});
console.log(`${ROWS} lignes créées en ${(performance.now() - t0).toFixed(0)} ms`);

const time = async (label: string, fn: () => Promise<{ body: string; statusCode: number }>) => {
  const times: number[] = [];
  let size = 0;
  let status = 0;
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    const res = await fn();
    times.push(performance.now() - s);
    size = res.body.length;
    status = res.statusCode;
  }
  times.sort((a, b) => a - b);
  console.log(
    `${label.padEnd(44)} médiane ${times[Math.floor(times.length / 2)]!.toFixed(1).padStart(7)} ms  ${(size / 1024).toFixed(0).padStart(6)} Ko  (${status})`,
  );
  return { status };
};

const full = await call("GET", `/api/databases/${id}`);
const etag = full.headers.etag as string | undefined;
await time("GET /databases/:id (chargement complet)", () => call("GET", `/api/databases/${id}`));
if (etag) await time("GET /databases/:id inchangé (sondage 5 s)", () => call("GET", `/api/databases/${id}`, undefined, { "if-none-match": etag }));
await time("POST /query (50 lignes, API)", () => call("POST", `/api/databases/${id}/query`, { limit: 50 }));
const rowId = full.json().database.rows[10].id;
await time("PATCH une cellule", () => call("PATCH", `/api/databases/${id}/rows/${rowId}`, { values: { [habits[0]!]: true } }));
await time("POST nouvelle ligne", () => call("POST", `/api/databases/${id}/rows`, { values: {} }));

if (SERVE) {
  await app.listen({ port: 3000, host: "127.0.0.1" });
  console.log(`SERVING ${id}`);
} else {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
