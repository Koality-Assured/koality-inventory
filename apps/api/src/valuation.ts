export interface CostLayer {
  qty: number;
  unitCostCents: number;
  receivedAt: string;
  expiresOn: string | null;
}

export interface WacState {
  qty: number;
  totalCostCents: number;
}

export function assertPositiveInt(quantity: number, label: string): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

/** Consume oldest-expiring, then oldest-received layers. Returns COGS in cents. */
export function consumeLayers(
  layers: CostLayer[],
  quantity: number,
): { cogsCents: number; remaining: CostLayer[]; consumed: CostLayer[] } {
  assertPositiveInt(quantity, "quantity");
  const ordered = [...layers].sort(compareLayers);
  let left = quantity;
  let cogsCents = 0;
  const consumed: CostLayer[] = [];
  const remaining: CostLayer[] = [];
  for (const layer of ordered) {
    if (left === 0) {
      remaining.push(layer);
      continue;
    }
    const take = Math.min(left, layer.qty);
    if (take > 0) {
      cogsCents += take * layer.unitCostCents;
      consumed.push({ ...layer, qty: take });
      left -= take;
    }
    if (layer.qty > take) {
      remaining.push({ ...layer, qty: layer.qty - take });
    }
  }
  if (left > 0) {
    throw new Error("Insufficient stock to consume");
  }
  return { cogsCents, remaining, consumed };
}

export function receiveWac(state: WacState, quantity: number, unitCostCents: number): WacState {
  assertPositiveInt(quantity, "quantity");
  if (!Number.isInteger(unitCostCents) || unitCostCents < 0) {
    throw new Error("unit cost must be a non-negative integer number of cents");
  }
  return {
    qty: state.qty + quantity,
    totalCostCents: state.totalCostCents + quantity * unitCostCents,
  };
}

export function issueWac(
  state: WacState,
  quantity: number,
): { state: WacState; cogsCents: number } {
  assertPositiveInt(quantity, "quantity");
  if (quantity > state.qty) {
    throw new Error("Insufficient stock to consume");
  }
  const cogsCents = Math.floor((state.totalCostCents * quantity) / state.qty);
  return {
    cogsCents,
    state: {
      qty: state.qty - quantity,
      totalCostCents: state.totalCostCents - cogsCents,
    },
  };
}

export function wacCents(state: WacState): number {
  if (state.qty === 0) {
    return 0;
  }
  return Math.floor(state.totalCostCents / state.qty);
}

function compareLayers(a: CostLayer, b: CostLayer): number {
  const aExpiry = a.expiresOn ?? "9999-12-31";
  const bExpiry = b.expiresOn ?? "9999-12-31";
  if (aExpiry !== bExpiry) {
    return aExpiry < bExpiry ? -1 : 1;
  }
  if (a.receivedAt !== b.receivedAt) {
    return a.receivedAt < b.receivedAt ? -1 : 1;
  }
  return 0;
}
