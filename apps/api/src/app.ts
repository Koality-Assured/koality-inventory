import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { type OpenedSqlite } from "@koality-inventory/db";
import type { DatabaseSync } from "node:sqlite";
import { sessions, users } from "@koality-inventory/db/sqlite";
import { createRawUlid } from "@koality-inventory/ids";

import { createItem, createSku, getItem, listItems, listSkus } from "./catalog.js";
import { HttpError } from "./http.js";
import { locationBalance } from "./location-balance.js";
import { createFacility, createLocation, listFacilities, locationTree } from "./locations.js";
import {
  allocateSalesOrder,
  approvePurchaseOrder,
  createPurchaseOrder,
  createSalesOrder,
  createVendor,
  pickerSheet,
  receivePurchaseOrder,
  reconcileCycleCount,
  recordCount,
  reorderRecommendations,
  shipSalesOrder,
  startCycleCount,
  varianceReport,
} from "./operations.js";
import { verifyPassword } from "./passwords.js";
import {
  adjustStock,
  receiveStock,
  receiveTransfer,
  stockPosition,
  stockValuation,
  transferStock,
} from "./stock.js";
import { signAccessToken, verifyAccessToken } from "./tokens.js";

type SqliteDb = OpenedSqlite["db"];

interface AppDeps {
  db: SqliteDb;
  client: DatabaseSync;
  devAuth: boolean;
  sessionSecret: string;
}

type Vars = {
  userId: string;
  orgId: string;
  role: string;
  sessionId: string;
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  category: z.string().max(120).optional(),
  baseUom: z.string().trim().min(1).max(16).optional(),
  tracking: z.enum(["none", "lot", "serial"]).optional(),
  costingMethod: z.enum(["fifo", "wac"]).optional(),
});

const skuSchema = z.object({
  skuCode: z.string().trim().min(1).max(64),
  barcode: z.string().trim().min(1).max(64).nullable().optional(),
  attributes: z.record(z.string()).optional(),
});

const facilitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/),
});

const receiptSchema = z.object({
  skuId: z.string().min(1),
  locationId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCostCents: z.number().int().nonnegative(),
  lotCode: z.string().min(1).optional(),
  expiresOn: z.string().nullable().optional(),
  serialCodes: z.array(z.string().min(1)).optional(),
});

const adjustmentSchema = z.object({
  skuId: z.string().min(1),
  locationId: z.string().min(1),
  quantityDelta: z
    .number()
    .int()
    .refine((value) => value !== 0),
  unitCostCents: z.number().int().nonnegative().optional(),
  reason: z.string().trim().min(1).max(500),
});

const poSchema = z.object({
  vendorId: z.string().min(1),
  lines: z.array(
    z.object({
      skuId: z.string().min(1),
      locationId: z.string().min(1),
      quantity: z.number().int().positive(),
      unitCostCents: z.number().int().nonnegative(),
    }),
  ),
});

const receiptAgainstPoSchema = z.object({
  poId: z.string().min(1),
  lineId: z.string().min(1),
  quantity: z.number().int().positive(),
});

const cycleSchema = z.object({
  locationId: z.string().min(1),
  skuIds: z.array(z.string().min(1)).min(1),
});

const countSchema = z.object({
  cycleId: z.string().min(1),
  lineId: z.string().min(1),
  countedQty: z.number().int().nonnegative(),
});

const salesOrderSchema = z.object({
  skuId: z.string().min(1),
  locationId: z.string().min(1),
  quantity: z.number().int().positive(),
});

const transferSchema = z.object({
  skuId: z.string().min(1),
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  quantity: z.number().int().positive(),
});

const locationSchema = z.object({
  facilityId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  kind: z.enum(["zone", "aisle", "rack", "shelf", "bin"]),
  name: z.string().trim().min(1).max(200),
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/),
});

const DEV_BANNER = "Local development authentication is active.";

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: Vars }>();

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: error.message }, error.status);
    }
    console.error(error);
    return c.json({ error: "Internal error" }, 500);
  });

  app.get("/api/v1/health", (c) => c.json({ ok: true, mode: "local" }));

  app.get("/api/v1/meta", (c) =>
    c.json({
      mode: "local",
      devAuth: deps.devAuth,
      banner: deps.devAuth ? DEV_BANNER : null,
    }),
  );

  app.get("/openapi.json", (c) => c.json(openApiDocument()));

  app.post("/api/v1/auth/dev-login", zValidator("json", loginSchema), async (c) => {
    if (!deps.devAuth) {
      return c.json({ error: "Not found" }, 404);
    }
    const body = c.req.valid("json");
    const candidates = await deps.db.select().from(users).where(eq(users.email, body.email));
    let matched: (typeof candidates)[number] | undefined;
    for (const user of candidates) {
      if (user.status !== "active" || !user.passwordHash) {
        continue;
      }
      if (await verifyPassword(body.password, user.passwordHash)) {
        matched = user;
        break;
      }
    }
    if (!matched) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const sessionId = createRawUlid();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await deps.db.insert(sessions).values({
      id: sessionId,
      userId: matched.id,
      orgId: matched.orgId,
      expiresAt,
      revokedAt: null,
      createdAt: now.toISOString(),
    });
    const accessToken = signAccessToken(
      { sub: matched.id, org: matched.orgId, role: matched.role, sid: sessionId },
      deps.sessionSecret,
    );
    return c.json({
      accessToken,
      tokenType: "Bearer",
      expiresIn: 900,
      user: {
        id: matched.id,
        email: matched.email,
        role: matched.role,
        displayName: matched.displayName,
        orgId: matched.orgId,
      },
    });
  });

  app.post("/api/v1/auth/logout", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    await deps.db
      .update(sessions)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(sessions.id, auth.sessionId));
    return c.json({ ok: true });
  });

  app.get("/api/v1/items", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const rows = await listItems(deps.db, auth.orgId, c.req.query("q"));
    return c.json({ items: rows });
  });

  app.post("/api/v1/items", zValidator("json", itemSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const created = await createItem(deps.db, auth.orgId, c.req.valid("json"));
    return c.json({ item: created }, 201);
  });

  app.get("/api/v1/items/:id", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const item = await getItem(deps.db, auth.orgId, c.req.param("id"));
    return c.json({ item });
  });

  app.get("/api/v1/items/:id/skus", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const rows = await listSkus(deps.db, auth.orgId, c.req.param("id"));
    return c.json({ skus: rows });
  });

  app.post("/api/v1/items/:id/skus", zValidator("json", skuSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const sku = await createSku(deps.db, auth.orgId, c.req.param("id"), c.req.valid("json"));
    return c.json({ sku }, 201);
  });

  app.get("/api/v1/locations/facilities", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    return c.json({ facilities: await listFacilities(deps.db, auth.orgId) });
  });

  app.post("/api/v1/locations/facilities", zValidator("json", facilitySchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const facility = await createFacility(deps.db, auth.orgId, c.req.valid("json"));
    return c.json({ facility }, 201);
  });

  app.get("/api/v1/locations/tree", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    return c.json({ facilities: await locationTree(deps.db, auth.orgId) });
  });

  app.post("/api/v1/locations", zValidator("json", locationSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const location = await createLocation(deps.db, auth.orgId, c.req.valid("json"));
    return c.json({ location }, 201);
  });

  app.get("/api/v1/stock/balances", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const skuId = c.req.query("skuId");
    if (!skuId) {
      return c.json({ error: "skuId is required" }, 400);
    }
    const locationId = c.req.query("locationId");
    if (locationId) {
      return c.json({
        balance: locationBalance(deps.client, auth.orgId, skuId, locationId),
      });
    }
    return c.json({ balance: stockPosition(deps.client, auth.orgId, skuId) });
  });

  app.get("/api/v1/stock/valuation", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const skuId = c.req.query("skuId");
    if (!skuId) {
      return c.json({ error: "skuId is required" }, 400);
    }
    return c.json({ valuation: stockValuation(deps.client, auth.orgId, skuId) });
  });

  app.post("/api/v1/stock/receipts", zValidator("json", receiptSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const receipt = receiveStock(deps.client, { orgId: auth.orgId, ...c.req.valid("json") });
    return c.json(receipt, 201);
  });

  app.post("/api/v1/stock/adjustments", zValidator("json", adjustmentSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const body = c.req.valid("json");
    const adjustment = adjustStock(deps.client, { orgId: auth.orgId, ...body });
    return c.json(adjustment, 201);
  });

  app.post("/api/v1/stock/transfers", zValidator("json", transferSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const transfer = transferStock(deps.client, { orgId: auth.orgId, ...c.req.valid("json") });
    return c.json(transfer, 201);
  });

  app.get("/api/v1/procurement/reorder-recommendations", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    return c.json({ recommendations: reorderRecommendations(deps.client, auth.orgId) });
  });

  app.post(
    "/api/v1/procurement/vendors",
    zValidator("json", z.object({ name: z.string().min(1) })),
    async (c) => {
      const auth = await authenticate(c, deps);
      if (auth instanceof Response) {
        return auth;
      }
      return c.json(
        { vendor: createVendor(deps.client, auth.orgId, c.req.valid("json").name) },
        201,
      );
    },
  );

  app.post("/api/v1/procurement/purchase-orders", zValidator("json", poSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const body = c.req.valid("json");
    return c.json(
      createPurchaseOrder(deps.client, {
        orgId: auth.orgId,
        vendorId: body.vendorId,
        lines: body.lines,
      }),
      201,
    );
  });

  app.post("/api/v1/procurement/purchase-orders/:id/approve", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    return c.json(approvePurchaseOrder(deps.client, auth.orgId, c.req.param("id")));
  });

  app.post(
    "/api/v1/procurement/receipts",
    zValidator("json", receiptAgainstPoSchema),
    async (c) => {
      const auth = await authenticate(c, deps);
      if (auth instanceof Response) {
        return auth;
      }
      const body = c.req.valid("json");
      return c.json(receivePurchaseOrder(deps.client, { orgId: auth.orgId, ...body }), 201);
    },
  );

  app.post("/api/v1/cycle-counts", zValidator("json", cycleSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const body = c.req.valid("json");
    return c.json(startCycleCount(deps.client, { orgId: auth.orgId, ...body }), 201);
  });

  app.get("/api/v1/cycle-counts/:id", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    return c.json(pickerSheet(deps.client, auth.orgId, c.req.param("id")));
  });

  app.post("/api/v1/cycle-counts/record", zValidator("json", countSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const body = c.req.valid("json");
    return c.json(recordCount(deps.client, { orgId: auth.orgId, ...body }));
  });

  app.get("/api/v1/cycle-counts/:id/variance", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    return c.json(varianceReport(deps.client, auth.orgId, c.req.param("id")));
  });

  app.post("/api/v1/cycle-counts/:id/reconcile", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    return c.json(reconcileCycleCount(deps.client, auth.orgId, c.req.param("id")));
  });

  app.post("/api/v1/fulfillment/orders", zValidator("json", salesOrderSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const body = c.req.valid("json");
    return c.json(createSalesOrder(deps.client, { orgId: auth.orgId, ...body }), 201);
  });

  app.post("/api/v1/fulfillment/orders/:id/allocate", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    return c.json(allocateSalesOrder(deps.client, auth.orgId, c.req.param("id")));
  });

  app.post("/api/v1/fulfillment/orders/:id/ship", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    return c.json(shipSalesOrder(deps.client, auth.orgId, c.req.param("id")));
  });

  app.put("/api/v1/stock/transfers/:id/receive", async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const transfer = receiveTransfer(deps.client, auth.orgId, c.req.param("id"));
    return c.json(transfer);
  });

  app.post("/api/v1/locations/bins", zValidator("json", locationSchema), async (c) => {
    const auth = await authenticate(c, deps);
    if (auth instanceof Response) {
      return auth;
    }
    const body = c.req.valid("json");
    if (body.kind !== "bin") {
      return c.json({ error: "This endpoint creates bins only" }, 400);
    }
    const location = await createLocation(deps.db, auth.orgId, body);
    return c.json({ location }, 201);
  });

  return app;
}

async function authenticate(
  c: {
    req: { header: (name: string) => string | undefined };
    json: (body: unknown, status?: number) => Response;
  },
  deps: AppDeps,
): Promise<{ userId: string; orgId: string; role: string; sessionId: string } | Response> {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const claims = verifyAccessToken(token, deps.sessionSecret);
  if (!claims) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const sessionRows = await deps.db.select().from(sessions).where(eq(sessions.id, claims.sid));
  const session = sessionRows[0];
  if (!session || session.revokedAt || session.expiresAt <= new Date().toISOString()) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (session.orgId !== claims.org || session.userId !== claims.sub) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const userRows = await deps.db
    .select()
    .from(users)
    .where(and(eq(users.id, claims.sub), eq(users.orgId, claims.org)));
  const user = userRows[0];
  if (!user || user.status !== "active") {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return { userId: user.id, orgId: user.orgId, role: user.role, sessionId: session.id };
}

function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "koality-inventory",
      version: "0.1.0",
    },
    paths: {
      "/api/v1/auth/dev-login": { post: { summary: "Local dev login" } },
      "/api/v1/items": { get: { summary: "List items" }, post: { summary: "Create item" } },
      "/api/v1/items/{id}/skus": {
        get: { summary: "List SKUs" },
        post: { summary: "Create SKU" },
      },
      "/api/v1/locations/facilities": {
        get: { summary: "List facilities" },
        post: { summary: "Create facility" },
      },
      "/api/v1/locations/tree": { get: { summary: "Location tree" } },
      "/api/v1/locations": { post: { summary: "Create location node" } },
      "/api/v1/locations/bins": { post: { summary: "Create bin" } },
    },
  };
}
