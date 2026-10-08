import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/pglite";
import { drizzle as drizzleSqlite } from "drizzle-orm/sqlite-proxy";

import { postgresSchema } from "./postgres/schema.js";
import { sqliteSchema } from "./sqlite/schema.js";

const MIGRATION_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

export interface OpenedSqlite {
  dialect: "sqlite";
  client: DatabaseSync;
  db: ReturnType<typeof createSqliteDb>;
  close: () => void;
}

export interface OpenedPostgres {
  dialect: "postgres";
  client: PGlite;
  db: ReturnType<typeof drizzlePg<typeof postgresSchema>>;
  close: () => Promise<void>;
}

export function openSqlite(filename = ":memory:"): OpenedSqlite {
  const client = new DatabaseSync(filename);
  client.exec("PRAGMA foreign_keys = ON");
  applySqliteMigrations(client);
  return {
    dialect: "sqlite",
    client,
    db: createSqliteDb(client),
    close: () => client.close(),
  };
}

export async function openPostgres(): Promise<OpenedPostgres> {
  const client = new PGlite();
  await applyPostgresMigrations(client);
  return {
    dialect: "postgres",
    client,
    db: drizzlePg(client, { schema: postgresSchema }),
    close: () => client.close(),
  };
}

export function applySqliteMigrations(client: DatabaseSync): void {
  client.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  for (const file of listMigrations("sqlite")) {
    const existing = client.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(file) as
      { id: string } | undefined;
    if (existing) {
      continue;
    }
    const sql = readFileSync(join(MIGRATION_ROOT, "sqlite", file), "utf8");
    client.exec("BEGIN");
    try {
      client.exec(sql);
      client
        .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run(file, new Date().toISOString());
      client.exec("COMMIT");
    } catch (error) {
      client.exec("ROLLBACK");
      throw error;
    }
  }
}

export async function applyPostgresMigrations(client: PGlite): Promise<void> {
  await client.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  for (const file of listMigrations("postgres")) {
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [file],
    );
    if (existing.rows.length > 0) {
      continue;
    }
    const sql = readFileSync(join(MIGRATION_ROOT, "postgres", file), "utf8");
    await client.exec("BEGIN");
    try {
      await client.exec(sql);
      await client.query("INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)", [
        file,
        new Date().toISOString(),
      ]);
      await client.exec("COMMIT");
    } catch (error) {
      await client.exec("ROLLBACK");
      throw error;
    }
  }
}

export function createSqliteDb(client: DatabaseSync) {
  return drizzleSqlite(
    async (sql, params, method) => {
      const statement = client.prepare(sql);
      const bound = params as Array<string | number | bigint | null | Uint8Array>;
      if (method === "run") {
        statement.run(...bound);
        return { rows: [] };
      }
      if (method === "get") {
        const row = statement.get(...bound) as Record<string, unknown> | undefined;
        return { rows: (row ? Object.values(row) : undefined) as never[] };
      }
      const rows = statement.all(...bound) as Record<string, unknown>[];
      return { rows: rows.map((row) => Object.values(row)) };
    },
    { schema: sqliteSchema },
  );
}

function listMigrations(dialect: "sqlite" | "postgres"): string[] {
  return readdirSync(join(MIGRATION_ROOT, dialect))
    .filter((name) => name.endsWith(".sql"))
    .sort();
}
