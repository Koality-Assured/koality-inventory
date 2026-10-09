import { afterEach, describe, expect, it } from "vitest";

import { bootLocal, type Booted } from "./boot.js";
import { DEV_USERS } from "./seed.js";

const running: Booted[] = [];

afterEach(() => {
  for (const booted of running.splice(0)) {
    booted.server.close();
    booted.opened.close();
  }
});

async function start(): Promise<{ booted: Booted; token: string }> {
  const booted = await bootLocal({
    env: { NODE_ENV: "development", ALLOW_DEV_PASSWORD_AUTH: "true" },
    dbPath: ":memory:",
    port: 0,
  });
  running.push(booted);
  const login = await booted.app.request("/api/v1/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: DEV_USERS[0]?.email,
      password: DEV_USERS[0]?.password,
    }),
  });
  const body = (await login.json()) as { accessToken: string };
  return { booted, token: body.accessToken };
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function createSku(booted: Booted, token: string, barcode: string) {
  const itemResponse = await booted.app.request("/api/v1/items", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name: "Widget", category: "Parts" }),
  });
  const item = ((await itemResponse.json()) as { item: { id: string } }).item;
  const skuResponse = await booted.app.request(`/api/v1/items/${item.id}/skus`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ skuCode: "WIDGET-1", barcode }),
  });
  const sku = ((await skuResponse.json()) as { sku: { id: string } }).sku;
  return { itemId: item.id, skuId: sku.id };
}

async function createZone(booted: Booted, token: string, code: string) {
  const facilityResponse = await booted.app.request("/api/v1/locations/facilities", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name: `Facility ${code}`, code }),
  });
  const facility = ((await facilityResponse.json()) as { facility: { id: string } }).facility;
  const locationResponse = await booted.app.request("/api/v1/locations", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      facilityId: facility.id,
      parentId: null,
      kind: "zone",
      name: code,
      code,
    }),
  });
  const location = ((await locationResponse.json()) as { location: { id: string } }).location;
  return location.id;
}

async function receive(
  booted: Booted,
  token: string,
  skuId: string,
  locationId: string,
  quantity: number,
) {
  const response = await booted.app.request("/api/v1/stock/receipts", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ skuId, locationId, quantity, unitCostCents: 100 }),
  });
  expect(response.status).toBe(201);
}

describe("bin balances, catalog search, and floor routes", () => {
  it("returns a bin quantity without replacing the org total", async () => {
    const { booted, token } = await start();
    const { skuId } = await createSku(booted, token, "000111222333");
    const binA = await createZone(booted, token, "BIN-A");
    const binB = await createZone(booted, token, "BIN-B");
    await receive(booted, token, skuId, binA, 4);
    await receive(booted, token, skuId, binB, 9);

    const org = await booted.app.request(`/api/v1/stock/balances?skuId=${skuId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const orgBody = (await org.json()) as { balance: { onHand: number; locationId?: string } };
    expect(orgBody.balance.onHand).toBe(13);
    expect(orgBody.balance.locationId).toBeUndefined();

    const located = await booted.app.request(
      `/api/v1/stock/balances?skuId=${skuId}&locationId=${binA}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const locatedBody = (await located.json()) as {
      balance: { onHand: number; locationId: string; inTransit: number };
    };
    expect(locatedBody.balance.locationId).toBe(binA);
    expect(locatedBody.balance.onHand).toBe(4);
    expect(locatedBody.balance.inTransit).toBe(0);

    const other = await booted.app.request(
      `/api/v1/stock/balances?skuId=${skuId}&locationId=${binB}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const otherBody = (await other.json()) as { balance: { onHand: number } };
    expect(otherBody.balance.onHand).toBe(9);
  });

  it("finds an item by SKU code and by barcode", async () => {
    const { booted, token } = await start();
    const { itemId } = await createSku(booted, token, "000111222333");
    const byCode = await booted.app.request("/api/v1/items?q=WIDGET-1", {
      headers: { authorization: `Bearer ${token}` },
    });
    const byBarcode = await booted.app.request("/api/v1/items?q=000111222333", {
      headers: { authorization: `Bearer ${token}` },
    });
    const codeBody = (await byCode.json()) as { items: Array<{ id: string }> };
    const barcodeBody = (await byBarcode.json()) as { items: Array<{ id: string }> };
    expect(codeBody.items.map((item) => item.id)).toEqual([itemId]);
    expect(barcodeBody.items.map((item) => item.id)).toEqual([itemId]);
  });

  it("posts a blind count onto the book quantity and ships an allocation", async () => {
    const { booted, token } = await start();
    const { skuId } = await createSku(booted, token, "000111222333");
    const locationId = await createZone(booted, token, "BULK");
    await receive(booted, token, skuId, locationId, 10);

    const cycle = await booted.app.request("/api/v1/cycle-counts", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ locationId, skuIds: [skuId] }),
    });
    expect(cycle.status).toBe(201);
    const cycleBody = (await cycle.json()) as { cycleCountId: string };
    const sheet = await booted.app.request(`/api/v1/cycle-counts/${cycleBody.cycleCountId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const sheetBody = (await sheet.json()) as { lines: Array<{ lineId: string }> };
    const lineId = sheetBody.lines[0]?.lineId;
    if (!lineId) {
      throw new Error("missing count line");
    }
    expect(JSON.stringify(sheetBody).toLowerCase()).not.toContain("expected");

    const recorded = await booted.app.request("/api/v1/cycle-counts/record", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ cycleId: cycleBody.cycleCountId, lineId, countedQty: 7 }),
    });
    expect(recorded.status).toBe(200);
    const reconciled = await booted.app.request(
      `/api/v1/cycle-counts/${cycleBody.cycleCountId}/reconcile`,
      { method: "POST", headers: authHeaders(token) },
    );
    expect(reconciled.status).toBe(200);
    const afterCount = await booted.app.request(
      `/api/v1/stock/balances?skuId=${skuId}&locationId=${locationId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const counted = (await afterCount.json()) as { balance: { onHand: number } };
    expect(counted.balance.onHand).toBe(7);

    const order = await booted.app.request("/api/v1/fulfillment/orders", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ skuId, locationId, quantity: 4 }),
    });
    expect(order.status).toBe(201);
    const orderBody = (await order.json()) as { orderId: string };
    const allocated = await booted.app.request(
      `/api/v1/fulfillment/orders/${orderBody.orderId}/allocate`,
      { method: "POST", headers: authHeaders(token) },
    );
    expect(allocated.status).toBe(200);
    const shipped = await booted.app.request(
      `/api/v1/fulfillment/orders/${orderBody.orderId}/ship`,
      { method: "POST", headers: authHeaders(token) },
    );
    expect(shipped.status).toBe(200);
    const afterShip = await booted.app.request(
      `/api/v1/stock/balances?skuId=${skuId}&locationId=${locationId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const shippedBody = (await afterShip.json()) as {
      balance: { onHand: number; allocated: number };
    };
    expect(shippedBody.balance.onHand).toBe(3);
    expect(shippedBody.balance.allocated).toBe(0);
  });
});
