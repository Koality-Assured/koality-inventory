import type { DatabaseSync } from "node:sqlite";

import { createId, createRawUlid } from "@koality-inventory/ids";

import { HttpError } from "./http.js";
import {
  adjustStock,
  changeAllocated,
  changeIncoming,
  issueStock,
  receiveStock,
  stockPosition,
  stockValuation,
} from "./stock.js";

type SqlValue = string | number | bigint | null | Uint8Array;

export interface PoLineInput {
  skuId: string;
  locationId: string;
  quantity: number;
  unitCostCents: number;
}

export function reorderRecommendations(client: DatabaseSync, orgId: string) {
  const skuRows = rows<{ id: string; reorder_point: number }>(
    client,
    `SELECT id, reorder_point FROM skus WHERE org_id = ? AND reorder_point > 0`,
    [orgId],
  );
  return skuRows.flatMap((sku) => {
    const current = stockPosition(client, orgId, sku.id);
    if (current.atp > sku.reorder_point) {
      return [];
    }
    return [
      {
        skuId: sku.id,
        atp: current.atp,
        reorderPoint: sku.reorder_point,
        suggestedQty: sku.reorder_point - current.atp,
      },
    ];
  });
}

export function createVendor(client: DatabaseSync, orgId: string, name: string) {
  const id = createRawUlid();
  run(client, `INSERT INTO vendors (id, org_id, name, created_at) VALUES (?, ?, ?, ?)`, [
    id,
    orgId,
    name,
    new Date().toISOString(),
  ]);
  return { id, name };
}

export function createPurchaseOrder(
  client: DatabaseSync,
  input: { orgId: string; vendorId: string; lines: PoLineInput[] },
) {
  if (input.lines.length === 0) {
    throw new HttpError(400, "Purchase order needs at least one line");
  }
  const poId = createId("po");
  const now = new Date().toISOString();
  run(
    client,
    `INSERT INTO purchase_orders (id, org_id, vendor_id, status, created_at) VALUES (?, ?, ?, 'draft', ?)`,
    [poId, input.orgId, input.vendorId, now],
  );
  const lines = input.lines.map((line) => {
    const lineId = createRawUlid();
    run(
      client,
      `INSERT INTO purchase_order_lines (
        id, po_id, sku_id, location_id, quantity, quantity_received, unit_cost_cents
      ) VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [lineId, poId, line.skuId, line.locationId, line.quantity, line.unitCostCents],
    );
    return {
      lineId,
      skuId: line.skuId,
      locationId: line.locationId,
      quantity: line.quantity,
      unitCostCents: line.unitCostCents,
    };
  });
  return { purchaseOrderId: poId, status: "draft" as const, lines };
}

export function approvePurchaseOrder(client: DatabaseSync, orgId: string, poId: string) {
  const order = requirePo(client, orgId, poId);
  if (order.status !== "draft") {
    throw new HttpError(409, "Only draft purchase orders can be approved");
  }
  const lines = linesOf(client, poId);
  for (const line of lines) {
    changeIncoming(client, {
      orgId,
      skuId: line.sku_id,
      locationId: line.location_id,
      delta: line.quantity,
      refId: poId,
    });
  }
  run(client, `UPDATE purchase_orders SET status = 'approved' WHERE id = ?`, [poId]);
  return {
    purchaseOrderId: poId,
    status: "approved" as const,
    lines: lines.map((line) => ({
      lineId: line.id,
      skuId: line.sku_id,
      locationId: line.location_id,
      quantity: line.quantity,
      unitCostCents: line.unit_cost_cents,
    })),
  };
}

export function receivePurchaseOrder(
  client: DatabaseSync,
  input: { orgId: string; poId: string; lineId: string; quantity: number },
) {
  const order = requirePo(client, input.orgId, input.poId);
  if (order.status !== "approved" && order.status !== "partially_received") {
    throw new HttpError(409, "Purchase order is not open for receipt");
  }
  const line = one<PoLine>(
    client,
    `SELECT id, sku_id, location_id, quantity, quantity_received, unit_cost_cents
     FROM purchase_order_lines WHERE id = ? AND po_id = ?`,
    [input.lineId, input.poId],
  );
  if (!line) {
    throw new HttpError(404, "Purchase order line not found");
  }
  const remaining = line.quantity - line.quantity_received;
  if (input.quantity <= 0 || input.quantity > remaining) {
    throw new HttpError(400, "Receipt quantity exceeds the open purchase order line");
  }
  const received = receiveStock(client, {
    orgId: input.orgId,
    skuId: line.sku_id,
    locationId: line.location_id,
    quantity: input.quantity,
    unitCostCents: line.unit_cost_cents,
  });
  changeIncoming(client, {
    orgId: input.orgId,
    skuId: line.sku_id,
    locationId: line.location_id,
    delta: -input.quantity,
    refId: input.poId,
  });
  const quantityReceived = line.quantity_received + input.quantity;
  run(client, `UPDATE purchase_order_lines SET quantity_received = ? WHERE id = ?`, [
    quantityReceived,
    line.id,
  ]);
  const open = linesOf(client, input.poId).some((row) => row.quantity_received < row.quantity);
  const status = open ? "partially_received" : "closed";
  run(client, `UPDATE purchase_orders SET status = ? WHERE id = ?`, [status, input.poId]);
  return {
    purchaseOrderId: input.poId,
    status,
    receiptId: received.receiptId,
    position: stockPosition(client, input.orgId, line.sku_id),
    valuation: stockValuation(client, input.orgId, line.sku_id),
  };
}

export function createSalesOrder(
  client: DatabaseSync,
  input: { orgId: string; skuId: string; locationId: string; quantity: number },
) {
  const orderId = createId("ord");
  const now = new Date().toISOString();
  run(
    client,
    `INSERT INTO sales_orders (id, org_id, status, created_at) VALUES (?, ?, 'open', ?)`,
    [orderId, input.orgId, now],
  );
  run(
    client,
    `INSERT INTO sales_order_lines (id, order_id, sku_id, location_id, quantity) VALUES (?, ?, ?, ?, ?)`,
    [createRawUlid(), orderId, input.skuId, input.locationId, input.quantity],
  );
  return { orderId, status: "open" };
}

export function allocateSalesOrder(client: DatabaseSync, orgId: string, orderId: string) {
  const line = one<{ sku_id: string; location_id: string; quantity: number }>(
    client,
    `SELECT l.sku_id, l.location_id, l.quantity
     FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
     WHERE o.id = ? AND o.org_id = ?`,
    [orderId, orgId],
  );
  if (!line) {
    throw new HttpError(404, "Sales order not found");
  }
  const position = changeAllocated(client, {
    orgId,
    skuId: line.sku_id,
    locationId: line.location_id,
    delta: line.quantity,
    refId: orderId,
  });
  run(client, `UPDATE sales_orders SET status = 'allocated' WHERE id = ?`, [orderId]);
  return { orderId, status: "allocated", position };
}

export function shipSalesOrder(client: DatabaseSync, orgId: string, orderId: string) {
  const line = one<{ sku_id: string; location_id: string; quantity: number }>(
    client,
    `SELECT l.sku_id, l.location_id, l.quantity
     FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
     WHERE o.id = ? AND o.org_id = ? AND o.status = 'allocated'`,
    [orderId, orgId],
  );
  if (!line) {
    throw new HttpError(409, "Sales order is not allocated");
  }
  const issued = issueStock(client, {
    orgId,
    skuId: line.sku_id,
    locationId: line.location_id,
    quantity: line.quantity,
  });
  changeAllocated(client, {
    orgId,
    skuId: line.sku_id,
    locationId: line.location_id,
    delta: -line.quantity,
    refId: orderId,
  });
  run(client, `UPDATE sales_orders SET status = 'shipped' WHERE id = ?`, [orderId]);
  return {
    orderId,
    status: "shipped",
    cogsCents: issued.cogsCents,
    position: stockPosition(client, orgId, line.sku_id),
  };
}

export function startCycleCount(
  client: DatabaseSync,
  input: { orgId: string; locationId: string; skuIds: string[] },
) {
  if (input.skuIds.length === 0) {
    throw new HttpError(400, "Cycle count needs at least one SKU");
  }
  const cycleId = createId("cyc");
  const now = new Date().toISOString();
  run(
    client,
    `INSERT INTO cycle_counts (id, org_id, status, created_at) VALUES (?, ?, 'open', ?)`,
    [cycleId, input.orgId, now],
  );
  for (const skuId of input.skuIds) {
    const balance = one<{ quantity: number }>(
      client,
      `SELECT quantity FROM stock_balances
       WHERE org_id = ? AND sku_id = ? AND location_id = ? AND bucket = 'on_hand'`,
      [input.orgId, skuId, input.locationId],
    );
    run(
      client,
      `INSERT INTO cycle_count_lines (id, cycle_id, sku_id, location_id, expected_qty, counted_qty)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      [createRawUlid(), cycleId, skuId, input.locationId, balance?.quantity ?? 0],
    );
  }
  return { cycleCountId: cycleId, status: "open" };
}

export function pickerSheet(client: DatabaseSync, orgId: string, cycleId: string) {
  requireCycle(client, orgId, cycleId);
  const lines = rows<{ id: string; sku_id: string; location_id: string }>(
    client,
    `SELECT id, sku_id, location_id FROM cycle_count_lines WHERE cycle_id = ?`,
    [cycleId],
  );
  return {
    cycleCountId: cycleId,
    lines: lines.map((line) => ({
      lineId: line.id,
      skuId: line.sku_id,
      locationId: line.location_id,
    })),
  };
}

export function recordCount(
  client: DatabaseSync,
  input: { orgId: string; cycleId: string; lineId: string; countedQty: number },
) {
  requireCycle(client, input.orgId, input.cycleId);
  if (!Number.isInteger(input.countedQty) || input.countedQty < 0) {
    throw new HttpError(400, "countedQty must be a non-negative integer");
  }
  const updated = client
    .prepare(`UPDATE cycle_count_lines SET counted_qty = ? WHERE id = ? AND cycle_id = ?`)
    .run(input.countedQty, input.lineId, input.cycleId);
  if (updated.changes === 0) {
    throw new HttpError(404, "Count line not found");
  }
  run(client, `UPDATE cycle_counts SET status = 'recorded' WHERE id = ?`, [input.cycleId]);
  return { cycleCountId: input.cycleId, lineId: input.lineId, countedQty: input.countedQty };
}

export function varianceReport(client: DatabaseSync, orgId: string, cycleId: string) {
  requireCycle(client, orgId, cycleId);
  const lines = rows<{
    id: string;
    sku_id: string;
    location_id: string;
    expected_qty: number;
    counted_qty: number | null;
  }>(
    client,
    `SELECT id, sku_id, location_id, expected_qty, counted_qty FROM cycle_count_lines WHERE cycle_id = ?`,
    [cycleId],
  );
  return {
    cycleCountId: cycleId,
    lines: lines.map((line) => ({
      lineId: line.id,
      skuId: line.sku_id,
      locationId: line.location_id,
      expectedQty: line.expected_qty,
      countedQty: line.counted_qty,
      variance: line.counted_qty === null ? null : line.counted_qty - line.expected_qty,
    })),
  };
}

export function reconcileCycleCount(client: DatabaseSync, orgId: string, cycleId: string) {
  const report = varianceReport(client, orgId, cycleId);
  for (const line of report.lines) {
    if (line.variance === null) {
      throw new HttpError(409, "Every line needs a count before reconcile");
    }
    if (line.variance !== 0) {
      adjustStock(client, {
        orgId,
        skuId: line.skuId,
        locationId: line.locationId,
        quantityDelta: line.variance,
        unitCostCents: 0,
        reason: `cycle count ${cycleId}`,
      });
    }
  }
  run(client, `UPDATE cycle_counts SET status = 'reconciled' WHERE id = ?`, [cycleId]);
  return { cycleCountId: cycleId, status: "reconciled" };
}

interface PoLine {
  id: string;
  sku_id: string;
  location_id: string;
  quantity: number;
  quantity_received: number;
  unit_cost_cents: number;
}

function requirePo(client: DatabaseSync, orgId: string, poId: string) {
  const order = one<{ id: string; status: string }>(
    client,
    `SELECT id, status FROM purchase_orders WHERE id = ? AND org_id = ?`,
    [poId, orgId],
  );
  if (!order) {
    throw new HttpError(404, "Purchase order not found");
  }
  return order;
}

function requireCycle(client: DatabaseSync, orgId: string, cycleId: string) {
  const cycle = one<{ id: string }>(
    client,
    `SELECT id FROM cycle_counts WHERE id = ? AND org_id = ?`,
    [cycleId, orgId],
  );
  if (!cycle) {
    throw new HttpError(404, "Cycle count not found");
  }
}

function linesOf(client: DatabaseSync, poId: string): PoLine[] {
  return rows<PoLine>(
    client,
    `SELECT id, sku_id, location_id, quantity, quantity_received, unit_cost_cents
     FROM purchase_order_lines WHERE po_id = ?`,
    [poId],
  );
}

function rows<T>(client: DatabaseSync, sql: string, params: SqlValue[]): T[] {
  return client.prepare(sql).all(...params) as T[];
}

function one<T>(client: DatabaseSync, sql: string, params: SqlValue[]): T | undefined {
  return client.prepare(sql).get(...params) as T | undefined;
}

function run(client: DatabaseSync, sql: string, params: SqlValue[]) {
  client.prepare(sql).run(...params);
}
