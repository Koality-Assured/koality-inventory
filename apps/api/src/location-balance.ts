import type { DatabaseSync } from "node:sqlite";

import { HttpError } from "./http.js";

export interface LocationBalance {
  skuId: string;
  locationId: string;
  onHand: number;
  allocated: number;
  inTransit: number;
  incoming: number;
  safetyStock: number;
  atp: number;
}

export function locationBalance(
  client: DatabaseSync,
  orgId: string,
  skuId: string,
  locationId: string,
): LocationBalance {
  const sku = client
    .prepare("SELECT id, safety_stock FROM skus WHERE id = ? AND org_id = ?")
    .get(skuId, orgId) as { id: string; safety_stock: number } | undefined;
  if (!sku) {
    throw new HttpError(404, "SKU not found");
  }
  const location = client
    .prepare("SELECT id, code FROM locations WHERE id = ? AND org_id = ?")
    .get(locationId, orgId) as { id: string; code: string } | undefined;
  if (!location || location.code.startsWith("__")) {
    throw new HttpError(404, "Location not found");
  }
  const totals = client
    .prepare(
      `SELECT bucket, quantity FROM stock_balances
       WHERE org_id = ? AND sku_id = ? AND location_id = ?`,
    )
    .all(orgId, skuId, locationId) as Array<{ bucket: string; quantity: number }>;
  const qty = (bucket: string) => totals.find((row) => row.bucket === bucket)?.quantity ?? 0;
  const onHand = qty("on_hand");
  const allocated = qty("allocated");
  const incoming = qty("incoming");
  return {
    skuId,
    locationId,
    onHand,
    allocated,
    inTransit: qty("in_transit"),
    incoming,
    safetyStock: sku.safety_stock,
    atp: onHand - allocated + incoming - sku.safety_stock,
  };
}
