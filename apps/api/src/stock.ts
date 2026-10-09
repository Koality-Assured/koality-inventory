import type { DatabaseSync } from "node:sqlite";

import { createId } from "@koality-inventory/ids";

import { HttpError } from "./http.js";
import {
  consumeLayers,
  issueWac,
  receiveWac,
  wacCents,
  type CostLayer,
  type WacState,
} from "./valuation.js";

type SqlValue = string | number | bigint | null | Uint8Array;

interface SkuFact {
  id: string;
  tracking: string;
  costing_method: string;
  safety_stock: number;
}

interface LayerRow {
  id: string;
  lot_id: string | null;
  qty_remaining: number;
  unit_cost_cents: number;
  expires_on: string | null;
  received_at: string;
}

export interface StockPosition {
  skuId: string;
  onHand: number;
  allocated: number;
  inTransit: number;
  incoming: number;
  safetyStock: number;
  atp: number;
}

export function receiveStock(
  client: DatabaseSync,
  input: {
    orgId: string;
    skuId: string;
    locationId: string;
    quantity: number;
    unitCostCents: number;
    lotCode?: string | undefined;
    expiresOn?: string | null | undefined;
    serialCodes?: string[] | undefined;
  },
) {
  return transaction(client, () => {
    const sku = requireSku(client, input.orgId, input.skuId);
    requireRealLocation(client, input.orgId, input.locationId);
    requireQty(input.quantity);
    requireCost(input.unitCostCents);
    const lotId = resolveLot(client, sku, input);
    const serials = resolveSerials(sku, input.quantity, input.serialCodes);
    const system = ensureSystem(client, input.orgId);
    const now = new Date().toISOString();
    const receiptId = createId("rec");
    post(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: input.locationId,
      bucket: "on_hand",
      direction: "debit",
      quantity: input.quantity,
      unitCostCents: input.unitCostCents,
      refType: "receipt",
      refId: receiptId,
      lotId,
      now,
    });
    post(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: system.supplierLocationId,
      bucket: "on_hand",
      direction: "credit",
      quantity: input.quantity,
      unitCostCents: input.unitCostCents,
      refType: "receipt",
      refId: receiptId,
      lotId,
      now,
    });
    run(
      client,
      `INSERT INTO fifo_layers (
        id, org_id, sku_id, location_id, lot_id, qty_remaining, unit_cost_cents, expires_on, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createId("stk"),
        input.orgId,
        input.skuId,
        input.locationId,
        lotId,
        input.quantity,
        input.unitCostCents,
        input.expiresOn ?? null,
        now,
      ],
    );
    const current = readWac(client, input.orgId, input.skuId);
    const next = receiveWac(current, input.quantity, input.unitCostCents);
    writeWac(client, input.orgId, input.skuId, next);
    for (const serialCode of serials) {
      run(
        client,
        `INSERT INTO serials (id, org_id, sku_id, serial_code, location_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'on_hand', ?)`,
        [createId("ser"), input.orgId, input.skuId, serialCode, input.locationId, now],
      );
    }
    return { receiptId, position: position(client, input.orgId, input.skuId) };
  });
}

export function issueStock(
  client: DatabaseSync,
  input: { orgId: string; skuId: string; locationId: string; quantity: number },
) {
  return transaction(client, () => {
    const sku = requireSku(client, input.orgId, input.skuId);
    requireRealLocation(client, input.orgId, input.locationId);
    requireQty(input.quantity);
    const consumed = takeLayers(client, input.orgId, input.skuId, input.locationId, input.quantity);
    const system = ensureSystem(client, input.orgId);
    const now = new Date().toISOString();
    const issueId = createId("adj");
    const unitCost = Math.floor(consumed.cogsCents / input.quantity);
    post(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: input.locationId,
      bucket: "on_hand",
      direction: "credit",
      quantity: input.quantity,
      unitCostCents: unitCost,
      refType: "issue",
      refId: issueId,
      lotId: null,
      now,
    });
    post(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: system.adjustmentLocationId,
      bucket: "on_hand",
      direction: "debit",
      quantity: input.quantity,
      unitCostCents: unitCost,
      refType: "issue",
      refId: issueId,
      lotId: null,
      now,
    });
    const wac = issueWac(readWac(client, input.orgId, input.skuId), input.quantity);
    writeWac(client, input.orgId, input.skuId, wac.state);
    const cogsCents = sku.costing_method === "wac" ? wac.cogsCents : consumed.cogsCents;
    return { issueId, cogsCents, position: position(client, input.orgId, input.skuId) };
  });
}

export function adjustStock(
  client: DatabaseSync,
  input: {
    orgId: string;
    skuId: string;
    locationId: string;
    quantityDelta: number;
    unitCostCents?: number | undefined;
    reason: string;
  },
) {
  if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0) {
    throw new HttpError(400, "quantityDelta must be a non-zero integer");
  }
  if (input.quantityDelta > 0) {
    const received = receiveStock(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: input.locationId,
      quantity: input.quantityDelta,
      unitCostCents: input.unitCostCents ?? 0,
    });
    return { adjustmentId: received.receiptId, position: received.position, reason: input.reason };
  }
  const issued = issueStock(client, {
    orgId: input.orgId,
    skuId: input.skuId,
    locationId: input.locationId,
    quantity: Math.abs(input.quantityDelta),
  });
  return { adjustmentId: issued.issueId, position: issued.position, cogsCents: issued.cogsCents };
}

export function transferStock(
  client: DatabaseSync,
  input: {
    orgId: string;
    skuId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
  },
) {
  return transaction(client, () => {
    requireSku(client, input.orgId, input.skuId);
    requireRealLocation(client, input.orgId, input.fromLocationId);
    requireRealLocation(client, input.orgId, input.toLocationId);
    if (input.fromLocationId === input.toLocationId) {
      throw new HttpError(400, "Transfer source and destination must differ");
    }
    requireQty(input.quantity);
    const consumed = takeLayers(
      client,
      input.orgId,
      input.skuId,
      input.fromLocationId,
      input.quantity,
    );
    const now = new Date().toISOString();
    const transferId = createId("trn");
    const unitCost = Math.floor(consumed.cogsCents / input.quantity);
    post(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: input.fromLocationId,
      bucket: "on_hand",
      direction: "credit",
      quantity: input.quantity,
      unitCostCents: unitCost,
      refType: "transfer",
      refId: transferId,
      lotId: null,
      now,
    });
    post(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: input.toLocationId,
      bucket: "in_transit",
      direction: "debit",
      quantity: input.quantity,
      unitCostCents: unitCost,
      refType: "transfer",
      refId: transferId,
      lotId: null,
      now,
    });
    run(
      client,
      `INSERT INTO transfers (
        id, org_id, sku_id, from_location_id, to_location_id, quantity, status, layers_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'in_transit', ?, ?)`,
      [
        transferId,
        input.orgId,
        input.skuId,
        input.fromLocationId,
        input.toLocationId,
        input.quantity,
        JSON.stringify(consumed.consumed),
        now,
      ],
    );
    return { transferId, position: position(client, input.orgId, input.skuId) };
  });
}

export function receiveTransfer(client: DatabaseSync, orgId: string, transferId: string) {
  return transaction(client, () => {
    const transfer = one<{
      id: string;
      sku_id: string;
      to_location_id: string;
      quantity: number;
      status: string;
      layers_json: string;
    }>(client, `SELECT * FROM transfers WHERE id = ? AND org_id = ?`, [transferId, orgId]);
    if (!transfer) {
      throw new HttpError(404, "Transfer not found");
    }
    if (transfer.status !== "in_transit") {
      throw new HttpError(409, "Transfer is not in transit");
    }
    const layers = JSON.parse(transfer.layers_json) as CostLayer[];
    const now = new Date().toISOString();
    const unitCost = Math.floor(
      layers.reduce((sum, layer) => sum + layer.qty * layer.unitCostCents, 0) / transfer.quantity,
    );
    post(client, {
      orgId,
      skuId: transfer.sku_id,
      locationId: transfer.to_location_id,
      bucket: "in_transit",
      direction: "credit",
      quantity: transfer.quantity,
      unitCostCents: unitCost,
      refType: "transfer_receive",
      refId: transferId,
      lotId: null,
      now,
    });
    post(client, {
      orgId,
      skuId: transfer.sku_id,
      locationId: transfer.to_location_id,
      bucket: "on_hand",
      direction: "debit",
      quantity: transfer.quantity,
      unitCostCents: unitCost,
      refType: "transfer_receive",
      refId: transferId,
      lotId: null,
      now,
    });
    for (const layer of layers) {
      run(
        client,
        `INSERT INTO fifo_layers (
          id, org_id, sku_id, location_id, lot_id, qty_remaining, unit_cost_cents, expires_on, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createId("stk"),
          orgId,
          transfer.sku_id,
          transfer.to_location_id,
          layer.lotId ?? null,
          layer.qty,
          layer.unitCostCents,
          layer.expiresOn,
          layer.receivedAt,
        ],
      );
    }
    run(client, `UPDATE transfers SET status = 'received' WHERE id = ?`, [transferId]);
    return { transferId, position: position(client, orgId, transfer.sku_id) };
  });
}

export function changeIncoming(
  client: DatabaseSync,
  input: { orgId: string; skuId: string; locationId: string; delta: number; refId: string },
) {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new HttpError(400, "incoming delta must be a non-zero integer");
  }
  return transaction(client, () => {
    const system = ensureSystem(client, input.orgId);
    const quantity = Math.abs(input.delta);
    const now = new Date().toISOString();
    const increase = input.delta > 0;
    post(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: input.locationId,
      bucket: "incoming",
      direction: increase ? "debit" : "credit",
      quantity,
      unitCostCents: 0,
      refType: "incoming",
      refId: input.refId,
      lotId: null,
      now,
    });
    post(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: system.supplierLocationId,
      bucket: "incoming",
      direction: increase ? "credit" : "debit",
      quantity,
      unitCostCents: 0,
      refType: "incoming",
      refId: input.refId,
      lotId: null,
      now,
    });
    return position(client, input.orgId, input.skuId);
  });
}

export function changeAllocated(
  client: DatabaseSync,
  input: { orgId: string; skuId: string; locationId: string; delta: number; refId: string },
) {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new HttpError(400, "allocated delta must be a non-zero integer");
  }
  return transaction(client, () => {
    const system = ensureSystem(client, input.orgId);
    const quantity = Math.abs(input.delta);
    const now = new Date().toISOString();
    const increase = input.delta > 0;
    post(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: input.locationId,
      bucket: "allocated",
      direction: increase ? "debit" : "credit",
      quantity,
      unitCostCents: 0,
      refType: "allocation",
      refId: input.refId,
      lotId: null,
      now,
    });
    post(client, {
      orgId: input.orgId,
      skuId: input.skuId,
      locationId: system.adjustmentLocationId,
      bucket: "allocated",
      direction: increase ? "credit" : "debit",
      quantity,
      unitCostCents: 0,
      refType: "allocation",
      refId: input.refId,
      lotId: null,
      now,
    });
    return position(client, input.orgId, input.skuId);
  });
}

export function stockPosition(client: DatabaseSync, orgId: string, skuId: string): StockPosition {
  return position(client, orgId, skuId);
}

export function stockValuation(client: DatabaseSync, orgId: string, skuId: string) {
  const sku = requireSku(client, orgId, skuId);
  const wac = readWac(client, orgId, skuId);
  const layerRows = rows<LayerRow>(
    client,
    `SELECT id, lot_id, qty_remaining, unit_cost_cents, expires_on, received_at
     FROM fifo_layers WHERE org_id = ? AND sku_id = ? AND qty_remaining > 0`,
    [orgId, skuId],
  );
  const fifoValueCents = layerRows.reduce(
    (sum, layer) => sum + layer.qty_remaining * layer.unit_cost_cents,
    0,
  );
  return {
    skuId,
    costingMethod: sku.costing_method,
    onHandQty: wac.qty,
    wacCents: wacCents(wac),
    wacValueCents: wac.totalCostCents,
    fifoValueCents,
    valueCents: sku.costing_method === "wac" ? wac.totalCostCents : fifoValueCents,
  };
}

export function ledgerIsBalanced(client: DatabaseSync, orgId: string, skuId: string): boolean {
  const nets = rows<{ location_id: string; bucket: string; net: number }>(
    client,
    `SELECT location_id, bucket,
            SUM(CASE WHEN direction = 'debit' THEN quantity ELSE -quantity END) AS net
     FROM ledger_entries WHERE org_id = ? AND sku_id = ?
     GROUP BY location_id, bucket`,
    [orgId, skuId],
  );
  const balances = rows<{ location_id: string; bucket: string; quantity: number }>(
    client,
    `SELECT location_id, bucket, quantity FROM stock_balances WHERE org_id = ? AND sku_id = ?`,
    [orgId, skuId],
  );
  if (nets.length !== balances.length) {
    return false;
  }
  return nets.every((net) =>
    balances.some(
      (balance) =>
        balance.location_id === net.location_id &&
        balance.bucket === net.bucket &&
        balance.quantity === net.net,
    ),
  );
}

function position(client: DatabaseSync, orgId: string, skuId: string): StockPosition {
  const sku = requireSku(client, orgId, skuId);
  const totals = rows<{ bucket: string; quantity: number }>(
    client,
    `SELECT b.bucket, SUM(b.quantity) AS quantity
     FROM stock_balances b
     JOIN locations l ON l.id = b.location_id
     WHERE b.org_id = ? AND b.sku_id = ? AND l.code NOT LIKE '\\_\\_%' ESCAPE '\\'
     GROUP BY b.bucket`,
    [orgId, skuId],
  );
  const qty = (bucket: string) => totals.find((row) => row.bucket === bucket)?.quantity ?? 0;
  const onHand = qty("on_hand");
  const allocated = qty("allocated");
  const incoming = qty("incoming");
  return {
    skuId,
    onHand,
    allocated,
    inTransit: qty("in_transit"),
    incoming,
    safetyStock: sku.safety_stock,
    atp: onHand - allocated + incoming - sku.safety_stock,
  };
}

function takeLayers(
  client: DatabaseSync,
  orgId: string,
  skuId: string,
  locationId: string,
  quantity: number,
) {
  const existing = rows<LayerRow>(
    client,
    `SELECT id, lot_id, qty_remaining, unit_cost_cents, expires_on, received_at
     FROM fifo_layers
     WHERE org_id = ? AND sku_id = ? AND location_id = ? AND qty_remaining > 0`,
    [orgId, skuId, locationId],
  );
  const result = consumeLayers(
    existing.map((layer) => ({
      qty: layer.qty_remaining,
      unitCostCents: layer.unit_cost_cents,
      receivedAt: layer.received_at,
      expiresOn: layer.expires_on,
      lotId: layer.lot_id,
    })),
    quantity,
  );
  for (const layer of existing) {
    run(client, `UPDATE fifo_layers SET qty_remaining = 0 WHERE id = ?`, [layer.id]);
  }
  for (const layer of result.remaining) {
    const original = existing.find(
      (row) =>
        row.lot_id === (layer.lotId ?? null) &&
        row.unit_cost_cents === layer.unitCostCents &&
        row.received_at === layer.receivedAt &&
        row.expires_on === layer.expiresOn,
    );
    if (!original) {
      continue;
    }
    run(client, `UPDATE fifo_layers SET qty_remaining = ? WHERE id = ?`, [layer.qty, original.id]);
  }
  return result;
}

function post(
  client: DatabaseSync,
  entry: {
    orgId: string;
    skuId: string;
    locationId: string;
    bucket: string;
    direction: "debit" | "credit";
    quantity: number;
    unitCostCents: number;
    refType: string;
    refId: string;
    lotId: string | null;
    now: string;
  },
) {
  run(
    client,
    `INSERT INTO ledger_entries (
      id, org_id, sku_id, location_id, lot_id, serial_id, bucket, direction, quantity, unit_cost_cents, ref_type, ref_id, created_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [
      createId("stk"),
      entry.orgId,
      entry.skuId,
      entry.locationId,
      entry.lotId,
      entry.bucket,
      entry.direction,
      entry.quantity,
      entry.unitCostCents,
      entry.refType,
      entry.refId,
      entry.now,
    ],
  );
  const delta = entry.direction === "debit" ? entry.quantity : -entry.quantity;
  run(
    client,
    `INSERT INTO stock_balances (id, org_id, sku_id, location_id, bucket, quantity, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (org_id, sku_id, location_id, bucket)
     DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`,
    [createId("stk"), entry.orgId, entry.skuId, entry.locationId, entry.bucket, delta, entry.now],
  );
}

function ensureSystem(client: DatabaseSync, orgId: string) {
  let facility = one<{ id: string }>(
    client,
    `SELECT id FROM facilities WHERE org_id = ? AND code = '__external'`,
    [orgId],
  );
  const now = new Date().toISOString();
  if (!facility) {
    const id = createId("fac");
    run(
      client,
      `INSERT INTO facilities (id, org_id, name, code, created_at) VALUES (?, ?, 'External', '__external', ?)`,
      [id, orgId, now],
    );
    facility = { id };
  }
  const supplier = ensureZone(client, orgId, facility.id, "__supplier", "Supplier");
  const adjustment = ensureZone(client, orgId, facility.id, "__adjustment", "Adjustment");
  return { supplierLocationId: supplier, adjustmentLocationId: adjustment };
}

function ensureZone(
  client: DatabaseSync,
  orgId: string,
  facilityId: string,
  code: string,
  name: string,
) {
  const existing = one<{ id: string }>(
    client,
    `SELECT id FROM locations WHERE org_id = ? AND facility_id = ? AND code = ?`,
    [orgId, facilityId, code],
  );
  if (existing) {
    return existing.id;
  }
  const id = createId("loc");
  run(
    client,
    `INSERT INTO locations (id, org_id, facility_id, parent_id, kind, name, code, created_at)
     VALUES (?, ?, ?, NULL, 'zone', ?, ?, ?)`,
    [id, orgId, facilityId, name, code, new Date().toISOString()],
  );
  return id;
}

function requireSku(client: DatabaseSync, orgId: string, skuId: string): SkuFact {
  const sku = one<SkuFact>(
    client,
    `SELECT s.id, i.tracking, i.costing_method, s.safety_stock
     FROM skus s JOIN items i ON i.id = s.item_id
     WHERE s.id = ? AND s.org_id = ?`,
    [skuId, orgId],
  );
  if (!sku) {
    throw new HttpError(404, "SKU not found");
  }
  return sku;
}

function requireRealLocation(client: DatabaseSync, orgId: string, locationId: string) {
  const location = one<{ id: string; code: string }>(
    client,
    `SELECT id, code FROM locations WHERE id = ? AND org_id = ?`,
    [locationId, orgId],
  );
  if (!location || location.code.startsWith("__")) {
    throw new HttpError(404, "Location not found");
  }
}

function resolveLot(
  client: DatabaseSync,
  sku: SkuFact,
  input: {
    orgId: string;
    skuId: string;
    lotCode?: string | undefined;
    expiresOn?: string | null | undefined;
  },
): string | null {
  if (sku.tracking !== "lot") {
    return null;
  }
  if (!input.lotCode) {
    throw new HttpError(400, "Lot code is required");
  }
  const existing = one<{ id: string }>(
    client,
    `SELECT id FROM lots WHERE org_id = ? AND sku_id = ? AND lot_code = ?`,
    [input.orgId, input.skuId, input.lotCode],
  );
  if (existing) {
    return existing.id;
  }
  const id = createId("lot");
  run(
    client,
    `INSERT INTO lots (id, org_id, sku_id, lot_code, expires_on, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.orgId,
      input.skuId,
      input.lotCode,
      input.expiresOn ?? null,
      new Date().toISOString(),
    ],
  );
  return id;
}

function resolveSerials(
  sku: SkuFact,
  quantity: number,
  serialCodes: string[] | undefined,
): string[] {
  if (sku.tracking !== "serial") {
    return [];
  }
  const codes = serialCodes ?? [];
  if (codes.length !== quantity || new Set(codes).size !== codes.length) {
    throw new HttpError(400, "Serial count must match quantity");
  }
  return codes;
}

function readWac(client: DatabaseSync, orgId: string, skuId: string): WacState {
  const row = one<{ qty: number; total_cost_cents: number }>(
    client,
    `SELECT qty, total_cost_cents FROM sku_valuations WHERE org_id = ? AND sku_id = ?`,
    [orgId, skuId],
  );
  return { qty: row?.qty ?? 0, totalCostCents: row?.total_cost_cents ?? 0 };
}

function writeWac(client: DatabaseSync, orgId: string, skuId: string, state: WacState) {
  run(
    client,
    `INSERT INTO sku_valuations (org_id, sku_id, qty, total_cost_cents) VALUES (?, ?, ?, ?)
     ON CONFLICT (org_id, sku_id) DO UPDATE SET qty = excluded.qty, total_cost_cents = excluded.total_cost_cents`,
    [orgId, skuId, state.qty, state.totalCostCents],
  );
}

function requireQty(quantity: number) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new HttpError(400, "quantity must be a positive integer");
  }
}

function requireCost(unitCostCents: number) {
  if (!Number.isInteger(unitCostCents) || unitCostCents < 0) {
    throw new HttpError(400, "unitCostCents must be a non-negative integer");
  }
}

function transaction<T>(client: DatabaseSync, fn: () => T): T {
  client.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    client.exec("COMMIT");
    return value;
  } catch (error) {
    client.exec("ROLLBACK");
    throw error;
  }
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
