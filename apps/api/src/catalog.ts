import { and, eq } from "drizzle-orm";

import { type OpenedSqlite } from "@koality-inventory/db";
import { items, skus } from "@koality-inventory/db/sqlite";
import { createId } from "@koality-inventory/ids";

import { HttpError, isUniqueViolation } from "./http.js";

type SqliteDb = OpenedSqlite["db"];

export interface ItemInput {
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  baseUom?: string | undefined;
  tracking?: "none" | "lot" | "serial" | undefined;
  costingMethod?: "fifo" | "wac" | undefined;
}

export interface SkuInput {
  skuCode: string;
  barcode?: string | null | undefined;
  attributes?: Record<string, string> | undefined;
}

export async function listItems(db: SqliteDb, orgId: string, query?: string) {
  const rows = await db.select().from(items).where(eq(items.orgId, orgId));
  const needle = query?.trim().toLowerCase();
  const skuRows = needle ? await db.select().from(skus).where(eq(skus.orgId, orgId)) : [];
  const itemIdsFromSku = new Set(
    skuRows
      .filter((sku) => {
        const barcode = sku.barcode ?? "";
        return (
          sku.skuCode.toLowerCase().includes(needle ?? "") ||
          barcode.toLowerCase().includes(needle ?? "")
        );
      })
      .map((sku) => sku.itemId),
  );
  const filtered = needle
    ? rows.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          row.category.toLowerCase().includes(needle) ||
          row.id.toLowerCase().includes(needle) ||
          itemIdsFromSku.has(row.id),
      )
    : rows;
  return filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createItem(db: SqliteDb, orgId: string, input: ItemInput) {
  const now = new Date().toISOString();
  const id = createId("itm");
  await db.insert(items).values({
    id,
    orgId,
    name: input.name,
    description: input.description ?? "",
    category: input.category ?? "",
    baseUom: input.baseUom ?? "ea",
    tracking: input.tracking ?? "none",
    costingMethod: input.costingMethod ?? "fifo",
    createdAt: now,
  });
  const created = await db.select().from(items).where(eq(items.id, id));
  const row = created[0];
  if (!row || row.orgId !== orgId) {
    throw new HttpError(500, "Item insert failed");
  }
  return row;
}

export async function getItem(db: SqliteDb, orgId: string, itemId: string) {
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.orgId, orgId)));
  const row = rows[0];
  if (!row) {
    throw new HttpError(404, "Item not found");
  }
  return row;
}

export async function listSkus(db: SqliteDb, orgId: string, itemId: string) {
  await getItem(db, orgId, itemId);
  const rows = await db
    .select()
    .from(skus)
    .where(and(eq(skus.orgId, orgId), eq(skus.itemId, itemId)));
  return rows.map(presentSku);
}

export async function createSku(db: SqliteDb, orgId: string, itemId: string, input: SkuInput) {
  await getItem(db, orgId, itemId);
  const id = createId("sku");
  const now = new Date().toISOString();
  try {
    await db.insert(skus).values({
      id,
      orgId,
      itemId,
      skuCode: input.skuCode,
      barcode: input.barcode ?? null,
      attributesJson: JSON.stringify(input.attributes ?? {}),
      createdAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "SKU code already exists");
    }
    throw error;
  }
  const created = await db.select().from(skus).where(eq(skus.id, id));
  const row = created[0];
  if (!row) {
    throw new HttpError(404, "SKU insert failed");
  }
  return presentSku(row);
}

function presentSku(row: typeof skus.$inferSelect) {
  return {
    id: row.id,
    orgId: row.orgId,
    itemId: row.itemId,
    skuCode: row.skuCode,
    barcode: row.barcode,
    attributes: JSON.parse(row.attributesJson) as Record<string, string>,
    createdAt: row.createdAt,
  };
}
