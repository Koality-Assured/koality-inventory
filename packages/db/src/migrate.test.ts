import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createId } from "@koality-inventory/ids";

import { openPostgres, openSqlite } from "./migrate.js";
import { organizations as pgOrganizations, items as pgItems } from "./postgres/schema.js";
import { organizations as sqliteOrganizations, items as sqliteItems } from "./sqlite/schema.js";

const FOUNDATION_TABLES = [
  "organizations",
  "users",
  "facilities",
  "items",
  "skus",
  "locations",
  "sessions",
];

describe("dual-dialect foundation migrations", () => {
  it("applies the foundation schema on SQLite and round-trips an item master", async () => {
    const opened = openSqlite();
    try {
      const tables = opened.client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((table) => table.name);
      for (const expected of FOUNDATION_TABLES) {
        expect(names).toContain(expected);
      }

      const now = new Date().toISOString();
      const orgId = createId("org");
      const itemId = createId("itm");
      await opened.db.insert(sqliteOrganizations).values({
        id: orgId,
        name: "Local Warehouse",
        slug: "local",
        createdAt: now,
      });
      await opened.db.insert(sqliteItems).values({
        id: itemId,
        orgId,
        name: "Widget",
        createdAt: now,
      });
      const stored = await opened.db.select().from(sqliteItems).where(eq(sqliteItems.id, itemId));
      expect(stored).toHaveLength(1);
      expect(stored[0]?.orgId).toBe(orgId);
      expect(stored[0]?.costingMethod).toBe("fifo");
    } finally {
      opened.close();
    }
  });

  it("applies the foundation schema on PostgreSQL and round-trips an item master", async () => {
    const opened = await openPostgres();
    try {
      const tables = await opened.client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const names = tables.rows.map((row) => row.table_name);
      for (const expected of FOUNDATION_TABLES) {
        expect(names).toContain(expected);
      }

      const now = new Date().toISOString();
      const orgId = createId("org");
      const itemId = createId("itm");
      await opened.db.insert(pgOrganizations).values({
        id: orgId,
        name: "Hosted Warehouse",
        slug: "hosted",
        createdAt: now,
      });
      await opened.db.insert(pgItems).values({
        id: itemId,
        orgId,
        name: "Gadget",
        createdAt: now,
      });
      const stored = await opened.db.select().from(pgItems).where(eq(pgItems.id, itemId));
      expect(stored).toHaveLength(1);
      expect(stored[0]?.name).toBe("Gadget");
      expect(stored[0]?.tracking).toBe("none");
    } finally {
      await opened.close();
    }
  });

  it("is idempotent when migrations run twice", async () => {
    const opened = openSqlite();
    try {
      const { applySqliteMigrations } = await import("./migrate.js");
      applySqliteMigrations(opened.client);
      const rows = opened.client
        .prepare("SELECT count(*) AS count FROM schema_migrations")
        .get() as {
        count: number;
      };
      expect(rows.count).toBe(3);
    } finally {
      opened.close();
    }
  });
});
