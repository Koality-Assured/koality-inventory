import { describe, expect, it } from "vitest";

import { openSqlite } from "@koality-inventory/db";
import { facilities, items, locations, organizations, skus } from "@koality-inventory/db/sqlite";
import { createId } from "@koality-inventory/ids";

import {
  issueStock,
  ledgerIsBalanced,
  receiveStock,
  receiveTransfer,
  stockValuation,
  transferStock,
} from "./stock.js";

async function fixture(costingMethod: "fifo" | "wac") {
  const opened = openSqlite(":memory:");
  const now = new Date().toISOString();
  const orgId = createId("org");
  const facilityId = createId("fac");
  const locationId = createId("loc");
  const itemId = createId("itm");
  const skuId = createId("sku");
  await opened.db.insert(organizations).values({
    id: orgId,
    name: "Acme",
    slug: `acme-${skuId}`,
    createdAt: now,
  });
  await opened.db.insert(facilities).values({
    id: facilityId,
    orgId,
    name: "DC",
    code: "DC",
    createdAt: now,
  });
  await opened.db.insert(locations).values({
    id: locationId,
    orgId,
    facilityId,
    parentId: null,
    kind: "zone",
    name: "Bulk",
    code: "BULK",
    createdAt: now,
  });
  await opened.db.insert(items).values({
    id: itemId,
    orgId,
    name: "Widget",
    costingMethod,
    createdAt: now,
  });
  await opened.db.insert(skus).values({
    id: skuId,
    orgId,
    itemId,
    skuCode: "W-1",
    createdAt: now,
  });
  opened.client.prepare("UPDATE skus SET safety_stock = 2 WHERE id = ?").run(skuId);
  return { opened, orgId, skuId, locationId };
}

describe("stock ledger", () => {
  it("keeps FIFO layers and a balanced ledger across two receipts and an issue", async () => {
    const { opened, orgId, skuId, locationId } = await fixture("fifo");
    try {
      const first = receiveStock(opened.client, {
        orgId,
        skuId,
        locationId,
        quantity: 10,
        unitCostCents: 500,
      });
      expect(first.position.atp).toBe(8);
      receiveStock(opened.client, {
        orgId,
        skuId,
        locationId,
        quantity: 10,
        unitCostCents: 700,
      });
      const issued = issueStock(opened.client, { orgId, skuId, locationId, quantity: 15 });
      expect(issued.cogsCents).toBe(8500);
      expect(issued.position.onHand).toBe(5);
      expect(issued.position.atp).toBe(3);
      expect(stockValuation(opened.client, orgId, skuId).valueCents).toBe(3500);
      expect(ledgerIsBalanced(opened.client, orgId, skuId)).toBe(true);
    } finally {
      opened.close();
    }
  });

  it("recalculates weighted average cost from the same receipts", async () => {
    const { opened, orgId, skuId, locationId } = await fixture("wac");
    try {
      receiveStock(opened.client, {
        orgId,
        skuId,
        locationId,
        quantity: 10,
        unitCostCents: 500,
      });
      receiveStock(opened.client, {
        orgId,
        skuId,
        locationId,
        quantity: 10,
        unitCostCents: 700,
      });
      const issued = issueStock(opened.client, { orgId, skuId, locationId, quantity: 15 });
      expect(issued.cogsCents).toBe(9000);
      const valuation = stockValuation(opened.client, orgId, skuId);
      expect(valuation.wacCents).toBe(600);
      expect(valuation.valueCents).toBe(3000);
      expect(ledgerIsBalanced(opened.client, orgId, skuId)).toBe(true);
    } finally {
      opened.close();
    }
  });

  it("refuses to issue more than on-hand", async () => {
    const { opened, orgId, skuId, locationId } = await fixture("fifo");
    try {
      receiveStock(opened.client, {
        orgId,
        skuId,
        locationId,
        quantity: 1,
        unitCostCents: 100,
      });
      expect(() => issueStock(opened.client, { orgId, skuId, locationId, quantity: 2 })).toThrow(
        /Insufficient/,
      );
      const row = opened.client
        .prepare("SELECT quantity FROM stock_balances WHERE sku_id = ? AND location_id = ?")
        .get(skuId, locationId) as { quantity: number };
      expect(row.quantity).toBe(1);
    } finally {
      opened.close();
    }
  });

  it("keeps the source lot when a transfer is received", async () => {
    const { opened, orgId, skuId, locationId } = await fixture("fifo");
    try {
      opened.client.prepare("UPDATE items SET tracking = 'lot' WHERE org_id = ?").run(orgId);
      const facility = opened.client
        .prepare("SELECT facility_id FROM locations WHERE id = ?")
        .get(locationId) as { facility_id: string };
      const destinationId = createId("loc");
      const now = new Date().toISOString();
      await opened.db.insert(locations).values({
        id: destinationId,
        orgId,
        facilityId: facility.facility_id,
        parentId: null,
        kind: "zone",
        name: "Pick",
        code: "PICK",
        createdAt: now,
      });
      receiveStock(opened.client, {
        orgId,
        skuId,
        locationId,
        quantity: 4,
        unitCostCents: 250,
        lotCode: "L-1",
      });
      expect(() =>
        transferStock(opened.client, {
          orgId,
          skuId,
          fromLocationId: locationId,
          toLocationId: locationId,
          quantity: 4,
        }),
      ).toThrow(/must differ/);
      const moved = transferStock(opened.client, {
        orgId,
        skuId,
        fromLocationId: locationId,
        toLocationId: destinationId,
        quantity: 4,
      });
      receiveTransfer(opened.client, orgId, moved.transferId);
      const lot = opened.client
        .prepare("SELECT id FROM lots WHERE org_id = ? AND lot_code = ?")
        .get(orgId, "L-1") as { id: string };
      const layer = opened.client
        .prepare(
          "SELECT lot_id, qty_remaining FROM fifo_layers WHERE location_id = ? AND qty_remaining > 0",
        )
        .get(destinationId) as { lot_id: string | null; qty_remaining: number };
      expect(layer.lot_id).toBe(lot.id);
      expect(layer.qty_remaining).toBe(4);
      expect(ledgerIsBalanced(opened.client, orgId, skuId)).toBe(true);
    } finally {
      opened.close();
    }
  });
});
