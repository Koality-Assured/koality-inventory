import type { Context, MiddlewareHandler } from "hono";

import { HttpError } from "./http.js";

export interface AuthContext {
  userId: string;
  orgId: string;
  role: string;
  sessionId: string;
}

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  SuperAdmin: ["*"],
  InventoryManager: [
    "items:read",
    "items:write",
    "locations:read",
    "locations:write",
    "stock:read",
    "stock:write",
    "procurement:read",
    "procurement:write",
    "fulfillment:read",
    "fulfillment:write",
    "cycle:read",
    "cycle:write",
  ],
  WarehouseSupervisor: [
    "locations:read",
    "locations:write",
    "stock:read",
    "stock:write",
    "cycle:read",
    "cycle:write",
    "fulfillment:read",
    "fulfillment:write",
    "procurement:read",
  ],
  PickingClerk: [
    "stock:read",
    "locations:read",
    "cycle:read",
    "cycle:write",
    "fulfillment:read",
    "fulfillment:write",
  ],
  AuditorViewer: [
    "items:read",
    "locations:read",
    "stock:read",
    "procurement:read",
    "fulfillment:read",
    "cycle:read",
  ],
};

export function hasPermission(role: string, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes("*") || perms.includes(permission);
}

/**
 * `public`        - no authentication required.
 * `authenticated` - any valid session, no specific permission.
 * otherwise       - the named permission is required.
 */
export type RouteAccess = "public" | "authenticated" | { permission: string };

export interface RoutePolicy {
  access: RouteAccess;
  summary: string;
  tag: string;
  /** Name of a component schema in the OpenAPI document describing the JSON body. */
  body?: string;
  successStatus?: 200 | 201;
}

const perm = (permission: string): RouteAccess => ({ permission });

/**
 * Single source of truth for route authorization. Keys are `METHOD /hono/path/:param`.
 * Any `/api/*` route that is registered but absent here is rejected with 403 (deny by default).
 */
export const ROUTE_POLICIES: Readonly<Record<string, RoutePolicy>> = {
  "GET /api/v1/health": { access: "public", summary: "Health check", tag: "System" },
  "GET /api/v1/meta": { access: "public", summary: "Deployment metadata", tag: "System" },
  "POST /api/v1/auth/dev-login": {
    access: "public",
    summary: "Local dev login (rate limited; disabled unless dev auth is enabled)",
    tag: "Auth",
    body: "LoginRequest",
  },
  "POST /api/v1/auth/logout": {
    access: "authenticated",
    summary: "Revoke the current session",
    tag: "Auth",
  },

  "GET /api/v1/items": { access: perm("items:read"), summary: "List items", tag: "Items" },
  "POST /api/v1/items": {
    access: perm("items:write"),
    summary: "Create item",
    tag: "Items",
    body: "ItemInput",
    successStatus: 201,
  },
  "GET /api/v1/items/:id": { access: perm("items:read"), summary: "Get item", tag: "Items" },
  "GET /api/v1/items/:id/skus": {
    access: perm("items:read"),
    summary: "List SKUs of an item",
    tag: "Items",
  },
  "POST /api/v1/items/:id/skus": {
    access: perm("items:write"),
    summary: "Create SKU",
    tag: "Items",
    body: "SkuInput",
    successStatus: 201,
  },

  "GET /api/v1/locations/facilities": {
    access: perm("locations:read"),
    summary: "List facilities",
    tag: "Locations",
  },
  "POST /api/v1/locations/facilities": {
    access: perm("locations:write"),
    summary: "Create facility",
    tag: "Locations",
    body: "FacilityInput",
    successStatus: 201,
  },
  "GET /api/v1/locations/tree": {
    access: perm("locations:read"),
    summary: "Location tree",
    tag: "Locations",
  },
  "POST /api/v1/locations": {
    access: perm("locations:write"),
    summary: "Create location node",
    tag: "Locations",
    body: "LocationInput",
    successStatus: 201,
  },
  "POST /api/v1/locations/bins": {
    access: perm("locations:write"),
    summary: "Create bin",
    tag: "Locations",
    body: "LocationInput",
    successStatus: 201,
  },

  "GET /api/v1/stock/balances": {
    access: perm("stock:read"),
    summary: "Stock balances",
    tag: "Stock",
  },
  "GET /api/v1/stock/valuation": {
    access: perm("stock:read"),
    summary: "Stock valuation",
    tag: "Stock",
  },
  "POST /api/v1/stock/receipts": {
    access: perm("stock:write"),
    summary: "Receive stock",
    tag: "Stock",
    body: "StockReceiptInput",
    successStatus: 201,
  },
  "POST /api/v1/stock/adjustments": {
    access: perm("stock:write"),
    summary: "Adjust stock",
    tag: "Stock",
    body: "StockAdjustmentInput",
    successStatus: 201,
  },
  "POST /api/v1/stock/transfers": {
    access: perm("stock:write"),
    summary: "Create stock transfer",
    tag: "Stock",
    body: "StockTransferInput",
    successStatus: 201,
  },
  "PUT /api/v1/stock/transfers/:id/receive": {
    access: perm("stock:write"),
    summary: "Receive stock transfer",
    tag: "Stock",
  },

  "GET /api/v1/procurement/reorder-recommendations": {
    access: perm("procurement:read"),
    summary: "Reorder recommendations",
    tag: "Procurement",
  },
  "POST /api/v1/procurement/vendors": {
    access: perm("procurement:write"),
    summary: "Create vendor",
    tag: "Procurement",
    body: "VendorInput",
    successStatus: 201,
  },
  "POST /api/v1/procurement/purchase-orders": {
    access: perm("procurement:write"),
    summary: "Create purchase order",
    tag: "Procurement",
    body: "PurchaseOrderInput",
    successStatus: 201,
  },
  "POST /api/v1/procurement/purchase-orders/:id/approve": {
    access: perm("procurement:write"),
    summary: "Approve purchase order",
    tag: "Procurement",
  },
  "POST /api/v1/procurement/receipts": {
    access: perm("procurement:write"),
    summary: "Receive against a purchase order",
    tag: "Procurement",
    body: "PurchaseOrderReceiptInput",
    successStatus: 201,
  },

  "POST /api/v1/cycle-counts": {
    access: perm("cycle:write"),
    summary: "Start cycle count",
    tag: "Cycle counts",
    body: "CycleCountInput",
    successStatus: 201,
  },
  "GET /api/v1/cycle-counts/:id": {
    access: perm("cycle:read"),
    summary: "Cycle count sheet",
    tag: "Cycle counts",
  },
  "POST /api/v1/cycle-counts/record": {
    access: perm("cycle:write"),
    summary: "Record counted quantity",
    tag: "Cycle counts",
    body: "CountRecordInput",
  },
  "GET /api/v1/cycle-counts/:id/variance": {
    access: perm("cycle:read"),
    summary: "Variance report",
    tag: "Cycle counts",
  },
  "POST /api/v1/cycle-counts/:id/reconcile": {
    access: perm("cycle:write"),
    summary: "Reconcile cycle count",
    tag: "Cycle counts",
  },

  "POST /api/v1/fulfillment/orders": {
    access: perm("fulfillment:write"),
    summary: "Create sales order",
    tag: "Fulfillment",
    body: "SalesOrderInput",
    successStatus: 201,
  },
  "POST /api/v1/fulfillment/orders/:id/allocate": {
    access: perm("fulfillment:write"),
    summary: "Allocate sales order",
    tag: "Fulfillment",
  },
  "POST /api/v1/fulfillment/orders/:id/ship": {
    access: perm("fulfillment:write"),
    summary: "Ship sales order",
    tag: "Fulfillment",
  },
};

/**
 * Authorization middleware for `/api/*`. Runs before validators and handlers:
 * - public routes pass through;
 * - everything else must carry a valid session (401);
 * - routes without a policy, or whose role lacks the permission, get 403.
 * Authenticated identity is stored on the context as `auth`.
 */
export type AuthEnv = { Variables: { auth: AuthContext } };

export function authorizationGuard(
  authenticate: (c: Context) => Promise<AuthContext>,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const method = c.req.method === "HEAD" ? "GET" : c.req.method;
    const handler = c.req.matchedRoutes.find((route) => route.method === method);
    if (!handler) {
      await next();
      return;
    }
    const policy = ROUTE_POLICIES[`${method} ${handler.path}`];
    if (policy?.access === "public") {
      await next();
      return;
    }
    const auth = await authenticate(c);
    if (!policy) {
      throw new HttpError(403, "Forbidden");
    }
    if (policy.access !== "authenticated" && !hasPermission(auth.role, policy.access.permission)) {
      throw new HttpError(403, `Forbidden: requires ${policy.access.permission}`);
    }
    c.set("auth", auth);
    await next();
  };
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Resolves the client key for a request. */
  key: (c: Context) => string;
  now?: () => number;
}

/** Fixed-window limiter. Each instance owns its own counters. */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const t = now();
    for (const [key, entry] of windows) {
      if (entry.resetAt <= t) windows.delete(key);
    }
    const key = options.key(c);
    let entry = windows.get(key);
    if (!entry) {
      entry = { count: 0, resetAt: t + options.windowMs };
      windows.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > options.limit) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - t) / 1000))));
      throw new HttpError(429, "Too Many Requests");
    }
    await next();
  };
}
