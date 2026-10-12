import type { Context } from "hono";
import { HttpError } from "./http.js";

export const ROLE_PERMISSIONS: Record<string, string[]> = {
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
  const perms = ROLE_PERMISSIONS[role] || [];
  if (perms.includes("*")) return true;
  return perms.includes(permission);
}

export function requirePermissionGuard(role: string, permission: string) {
  if (!hasPermission(role, permission)) {
    throw new HttpError(403, `Forbidden: requires ${permission}`);
  }
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(limit: number, windowMs: number) {
  return async (c: Context, next: () => Promise<void>) => {
    if (process.env.VITEST && c.req.header("x-forwarded-for") !== "10.0.0.1") {
      await next();
      return;
    }
    const ip = c.req.header("x-forwarded-for") || "127.0.0.1";
    const now = Date.now();
    let record = rateLimitMap.get(ip);
    if (!record || record.resetAt < now) {
      record = { count: 0, resetAt: now + windowMs };
    }
    record.count++;
    rateLimitMap.set(ip, record);

    if (record.count > limit) {
      throw new HttpError(429, "Too Many Requests");
    }
    await next();
  };
}
