import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
/** A database or an open transaction. */
export type DbLike = BaseSQLiteDatabase<"sync", Database.RunResult, typeof schema>;

function findMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR);
  // Works from src/db (dev, tests) and from dist (bundled build).
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, "../../migrations"), path.join(here, "../migrations")]) {
    if (fs.existsSync(path.join(candidate, "meta/_journal.json"))) return candidate;
  }
  throw new Error("Dossier des migrations introuvable.");
}

/** Opens (or creates) the SQLite database and applies pending migrations. Use ":memory:" in tests. */
export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema }) as Db;
  migrate(db, { migrationsFolder: findMigrationsDir() });
  return db;
}

export { schema };
