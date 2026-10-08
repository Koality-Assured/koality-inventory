import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)],
);

export const users = pgTable(
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

export const facilities = pgTable(
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

export const items = pgTable(
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

export const skus = pgTable(
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

export const locations = pgTable(
  "locations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    parentId: text("parent_id"),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_locations_org").on(table.orgId),
    index("idx_locations_facility").on(table.facilityId),
    index("idx_locations_parent").on(table.parentId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_sessions_user").on(table.userId)],
);

export const postgresSchema = {
  organizations,
  users,
  facilities,
  items,
  skus,
  locations,
  sessions,
};
