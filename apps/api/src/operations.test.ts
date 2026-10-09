import { describe, expect, it } from "vitest";

import { openSqlite } from "@koality-inventory/db";
import { facilities, items, locations, organizations, skus } from "@koality-inventory/db/sqlite";
import { createId } from "@koality-inventory/ids";

import {
  allocateSalesOrder,
  approvePurchaseOrder,
  createPurchaseOrder,
  createSalesOrder,
  createVendor,
  pickerSheet,
  receivePurchaseOrder,
  recordCount,
  shipSalesOrder,
  startCycleCount,
  varianceReport,
} from "./operations.js";
import { receiveStock } from "./stock.js";

async function fixture() {
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
    costingMethod: "fifo",
    createdAt: now,
  });
  await opened.db.insert(skus).values({
    id: skuId,
    orgId,
    itemId,
    skuCode: "W-1",
    createdAt: now,
  });
  return { opened, orgId, skuId, locationId };
}

describe("purchasing and cycle counts", () => {
  it("raises ATP on approval and posts FIFO layers when the shipment is received", async () => {
    const { opened, orgId, skuId, locationId } = await fixture();
    try {
      const vendor = createVendor(opened.client, orgId, "Northwind");
      const po = createPurchaseOrder(opened.client, {
        orgId,
        vendorId: vendor.id,
        lines: [{ skuId, locationId, quantity: 10, unitCostCents: 500 }],
      });
      expect(po.lines).toHaveLength(1);
      const lineId = po.lines[0]?.lineId;
      if (!lineId) {
        throw new Error("missing purchase order line");
      }
      const approved = approvePurchaseOrder(opened.client, orgId, po.purchaseOrderId);
      expect(approved.lines[0]?.lineId).toBe(lineId);
      const received = receivePurchaseOrder(opened.client, {
        orgId,
        poId: po.purchaseOrderId,
        lineId,
        quantity: 10,
      });
      expect(received.position.onHand).toBe(10);
      expect(received.position.incoming).toBe(0);
      expect(received.position.atp).toBe(10);
      expect(received.valuation.fifoValueCents).toBe(5000);
      expect(received.status).toBe("closed");
    } finally {
      opened.close();
    }
  });

  it("hides expected quantities from the picker sheet", async () => {
    const { opened, orgId, skuId, locationId } = await fixture();
    try {
      receiveStock(opened.client, {
        orgId,
        skuId,
        locationId,
        quantity: 10,
        unitCostCents: 100,
      });
      const cycle = startCycleCount(opened.client, { orgId, locationId, skuIds: [skuId] });
      const sheet = pickerSheet(opened.client, orgId, cycle.cycleCountId);
      expect(JSON.stringify(sheet).toLowerCase()).not.toContain("expected");
      expect(sheet.lines).toHaveLength(1);
      const line = sheet.lines[0];
      if (!line) {
        throw new Error("missing count line");
      }
      recordCount(opened.client, {
        orgId,
        cycleId: cycle.cycleCountId,
        lineId: line.lineId,
        countedQty: 7,
      });
      const variance = varianceReport(opened.client, orgId, cycle.cycleCountId);
      expect(variance.lines[0]?.expectedQty).toBe(10);
      expect(variance.lines[0]?.countedQty).toBe(7);
      expect(variance.lines[0]?.variance).toBe(-3);
    } finally {
      opened.close();
    }
  });

  it("allocates a sales order and ships it", async () => {
    const { opened, orgId, skuId, locationId } = await fixture();
    try {
      receiveStock(opened.client, {
        orgId,
        skuId,
        locationId,
        quantity: 10,
        unitCostCents: 100,
      });
      const order = createSalesOrder(opened.client, { orgId, skuId, locationId, quantity: 4 });
      const allocated = allocateSalesOrder(opened.client, orgId, order.orderId);
      expect(allocated.position.allocated).toBe(4);
      expect(allocated.position.atp).toBe(6);
      const shipped = shipSalesOrder(opened.client, orgId, order.orderId);
      expect(shipped.position.onHand).toBe(6);
      expect(shipped.position.allocated).toBe(0);
      expect(shipped.cogsCents).toBe(400);
    } finally {
      opened.close();
    }
  });
});
