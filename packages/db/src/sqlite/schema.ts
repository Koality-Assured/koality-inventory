import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull(),
    passwordHash: text("password_hash"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("users_org_email_unique").on(table.orgId, table.email),
    index("idx_users_org").on(table.orgId),
  ],
);

export const facilities = sqliteTable(
  "facilities",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("facilities_org_code_unique").on(table.orgId, table.code),
    index("idx_facilities_org").on(table.orgId),
  ],
);

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default(""),
    baseUom: text("base_uom").notNull().default("ea"),
    tracking: text("tracking").notNull().default("none"),
    costingMethod: text("costing_method").notNull().default("fifo"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_items_org").on(table.orgId)],
);

export const skus = sqliteTable(
  "skus",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    skuCode: text("sku_code").notNull(),
    barcode: text("barcode"),
    attributesJson: text("attributes_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("skus_org_code_unique").on(table.orgId, table.skuCode),
    index("idx_skus_org").on(table.orgId),
    index("idx_skus_item").on(table.itemId),
  ],
);

export const sqliteSchema = { organizations, users, facilities, items, skus };
