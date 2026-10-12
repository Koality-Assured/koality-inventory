import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { organizations, sessions, users } from "@koality-inventory/db/sqlite";
import { createId, createRawUlid } from "@koality-inventory/ids";

import { bootLocal, type Booted } from "./boot.js";
import { openApiDocument } from "./openapi.js";
import {
  authorizationGuard,
  hasPermission,
  ROLE_PERMISSIONS,
  ROUTE_POLICIES,
  type AuthEnv,
} from "./rbac.js";
import { DEV_USERS } from "./seed.js";
import { HttpError } from "./http.js";
import { signAccessToken } from "./tokens.js";

interface OpenApiOperation {
  summary?: string;
  security: unknown;
  responses: Record<string, unknown>;
  requestBody?: unknown;
}

const SECRET = "rbac-test-secret";
const running: Booted[] = [];

afterEach(() => {
  for (const booted of running.splice(0)) {
    booted.server.close();
    booted.opened.close();
  }
});

async function boot(env: Record<string, string> = {}): Promise<Booted> {
  const booted = await bootLocal({
    env: {
      NODE_ENV: "development",
      ALLOW_DEV_PASSWORD_AUTH: "true",
      SESSION_SECRET: SECRET,
      ...env,
    },
    dbPath: ":memory:",
    port: 0,
  });
  running.push(booted);
  return booted;
}

/** Creates a user with the given role and returns a bearer token for a live session. */
async function tokenFor(booted: Booted, role: string): Promise<string> {
  const { db } = booted.opened;
  const org = (await db.select().from(organizations))[0]!;
  const now = new Date();
  const userId = createId("usr");
  await db.insert(users).values({
    id: userId,
    orgId: org.id,
    email: `${role.toLowerCase()}-${userId}@rbac.test`,
    displayName: role,
    role,
    passwordHash: null,
    status: "active",
    createdAt: now.toISOString(),
  });
  const sid = createRawUlid();
  await db.insert(sessions).values({
    id: sid,
    userId,
    orgId: org.id,
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    revokedAt: null,
    createdAt: now.toISOString(),
  });
  return signAccessToken({ sub: userId, org: org.id, role, sid }, SECRET);
}

function concretePath(honoPath: string): string {
  return honoPath.replace(/:[A-Za-z0-9_]+/g, "nonexistent-id");
}

const PROTECTED = Object.entries(ROUTE_POLICIES).filter(([, policy]) => policy.access !== "public");
// Logout revokes the session, so it is exercised separately from the shared-token matrix.
const MATRIX = PROTECTED.filter(([key]) => key !== "POST /api/v1/auth/logout");

describe("policy map", () => {
  it("covers exactly the registered /api/v1 routes (deny-by-default has no gaps)", async () => {
    const booted = await boot();
    const registered = new Set(
      booted.app.routes
        .filter((r) => r.method !== "ALL" && r.path.startsWith("/api/"))
        .map((r) => `${r.method} ${r.path}`),
    );
    expect([...registered].sort()).toEqual(Object.keys(ROUTE_POLICIES).sort());
  });

  it("only references permissions granted to at least one role", () => {
    const granted = new Set(Object.values(ROLE_PERMISSIONS).flat());
    for (const [key, policy] of PROTECTED) {
      if (typeof policy.access === "object") {
        expect(granted.has(policy.access.permission), key).toBe(true);
      }
    }
  });

  it("denies unknown roles everything", () => {
    expect(hasPermission("Nobody", "items:read")).toBe(false);
  });
});

describe("authorization guard over HTTP", () => {
  it("returns 401 JSON for every protected route without a session", async () => {
    const booted = await boot();
    for (const [key] of PROTECTED) {
      const [method, path] = key.split(" ") as [string, string];
      const res = await booted.app.request(concretePath(path), { method });
      expect(res.status, key).toBe(401);
      expect(await res.json(), key).toEqual({ error: "Unauthorized" });
    }
  });

  it("rejects tampered and malformed tokens with 401", async () => {
    const booted = await boot();
    const token = await tokenFor(booted, "SuperAdmin");
    for (const bad of [`${token}x`, "garbage", ""]) {
      const res = await booted.app.request("/api/v1/items", {
        headers: { authorization: `Bearer ${bad}` },
      });
      expect(res.status).toBe(401);
    }
  });

  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    it(`${role}: 403 where the permission is missing, otherwise passes the guard`, async () => {
      const booted = await boot();
      const token = await tokenFor(booted, role);
      for (const [key, policy] of MATRIX) {
        const [method, path] = key.split(" ") as [string, string];
        const res = await booted.app.request(concretePath(path), {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          ...(method === "GET" ? {} : { body: "{}" }),
        });
        const needed = typeof policy.access === "object" ? policy.access.permission : null;
        const allowed = needed === null || hasPermission(role, needed);
        if (allowed) {
          expect(res.status, `${role} ${key}`).not.toBe(401);
          expect(res.status, `${role} ${key}`).not.toBe(403);
        } else {
          expect(res.status, `${role} ${key}`).toBe(403);
          expect(res.headers.get("content-type")).toContain("application/json");
          expect(await res.json(), `${role} ${key}`).toMatchObject({
            error: expect.stringContaining("Forbidden"),
          });
        }
      }
    });
  }

  it("pins sensitive route groups per role (regression guard on the map itself)", async () => {
    const booted = await boot();
    const clerk = await tokenFor(booted, "PickingClerk");
    const auditor = await tokenFor(booted, "AuditorViewer");
    const manager = await tokenFor(booted, "InventoryManager");
    const post = (path: string, token: string) =>
      booted.app.request(path, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      });
    // Previously unguarded routes: any authenticated role could write.
    expect((await post("/api/v1/procurement/vendors", clerk)).status).toBe(403);
    expect((await post("/api/v1/procurement/vendors", auditor)).status).toBe(403);
    expect((await post("/api/v1/procurement/receipts", auditor)).status).toBe(403);
    expect((await post("/api/v1/items", clerk)).status).toBe(403);
    expect((await post("/api/v1/stock/adjustments", auditor)).status).toBe(403);
    expect((await post("/api/v1/procurement/vendors", manager)).status).toBe(400);
  });

  it("any authenticated role may log out; a revoked session is then 401", async () => {
    const booted = await boot();
    const token = await tokenFor(booted, "AuditorViewer");
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (await booted.app.request("/api/v1/auth/logout", { method: "POST", headers })).status,
    ).toBe(200);
    expect((await booted.app.request("/api/v1/items", { headers })).status).toBe(401);
  });

  it("denies authenticated requests to registered routes missing from the map (403)", async () => {
    const app = new Hono<AuthEnv>();
    const authenticate = async (c: { req: { header: (n: string) => string | undefined } }) => {
      if (!c.req.header("authorization")) throw new HttpError(401, "Unauthorized");
      return { userId: "u", orgId: "o", role: "SuperAdmin", sessionId: "s" };
    };
    app.use("/api/*", authorizationGuard(authenticate));
    app.onError((error, c) =>
      error instanceof HttpError
        ? c.json({ error: error.message }, error.status)
        : c.text("x", 500),
    );
    app.get("/api/v1/unmapped", (c) => c.json({ reached: true }));

    expect((await app.request("/api/v1/unmapped")).status).toBe(401);
    const res = await app.request("/api/v1/unmapped", { headers: { authorization: "Bearer t" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });
});

describe("public routes", () => {
  it("serves health, meta and openapi without a session", async () => {
    const booted = await boot();
    for (const path of ["/api/v1/health", "/api/v1/meta", "/openapi.json"]) {
      expect((await booted.app.request(path)).status, path).toBe(200);
    }
  });
});

describe("rate limiting", () => {
  const credentials = JSON.stringify({
    email: DEV_USERS[0].email,
    password: DEV_USERS[0].password,
  });
  const attempt = (booted: Booted) =>
    booted.app.request("/api/v1/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: credentials,
    });

  it("limits login attempts per client and sets Retry-After", async () => {
    const booted = await boot();
    for (let i = 0; i < 5; i++) {
      expect((await attempt(booted)).status).toBe(200);
    }
    const limited = await attempt(booted);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ error: "Too Many Requests" });
  });

  it("limits failed password guessing too", async () => {
    const booted = await boot();
    const wrong = () =>
      booted.app.request("/api/v1/auth/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: DEV_USERS[0].email, password: "wrong" }),
      });
    for (let i = 0; i < 5; i++) {
      expect((await wrong()).status).toBe(401);
    }
    expect((await wrong()).status).toBe(429);
  });

  it("does not share counters between app instances", async () => {
    const first = await boot();
    for (let i = 0; i < 6; i++) await attempt(first);
    const second = await boot();
    expect((await attempt(second)).status).toBe(200);
  });

  it("ignores X-Forwarded-For unless TRUST_PROXY=true (no spoofed bypass)", async () => {
    const booted = await boot();
    const spoofed = (n: number) =>
      booted.app.request("/api/v1/auth/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${n}` },
        body: credentials,
      });
    for (let i = 0; i < 5; i++) await spoofed(i);
    expect((await spoofed(99)).status).toBe(429);

    const proxied = await boot({ TRUST_PROXY: "true" });
    for (let i = 0; i < 5; i++)
      await proxied.app.request("/api/v1/auth/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.1" },
        body: credentials,
      });
    const other = await proxied.app.request("/api/v1/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.2" },
      body: credentials,
    });
    expect(other.status).toBe(200);
  });
});

describe("CORS", () => {
  const origin = "https://app.example.test";

  it("denies cross-origin access by default (no allowlist)", async () => {
    const booted = await boot();
    const res = await booted.app.request("/api/v1/health", { headers: { origin } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await booted.app.request("/api/v1/items", {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "POST" },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("only echoes origins on the explicit allowlist", async () => {
    const booted = await boot({
      CORS_ALLOWED_ORIGINS: `${origin}, https://other.example.test`,
    });
    const allowed = await booted.app.request("/api/v1/health", { headers: { origin } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);
    const denied = await booted.app.request("/api/v1/health", {
      headers: { origin: "https://evil.example.test" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not open CORS in development either", async () => {
    const booted = await boot({ NODE_ENV: "development" });
    const res = await booted.app.request("/api/v1/health", { headers: { origin } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("OpenAPI document", () => {
  it("documents every route with matching security and error responses", () => {
    const doc = openApiDocument();
    for (const [key, policy] of Object.entries(ROUTE_POLICIES)) {
      const [method, path] = key.split(" ") as [string, string];
      const operation = (
        doc.paths[path.replace(/:([^/]+)/g, "{$1}")] as Record<string, OpenApiOperation>
      )?.[method.toLowerCase()];
      if (!operation) throw new Error(`Missing OpenAPI operation for ${key}`);
      expect(operation.summary, key).toBeTruthy();
      expect(Object.keys(operation.responses), key).toContain(String(policy.successStatus ?? 200));
      if (policy.access === "public") {
        expect(operation.security, key).toEqual([]);
      } else {
        expect(operation.security, key).toEqual([{ bearerAuth: [] }]);
        expect(operation.responses["401"], key).toBeDefined();
        expect(operation.responses["403"], key).toBeDefined();
      }
      if (policy.body) {
        expect(doc.components.schemas[policy.body], key).toBeDefined();
        expect(operation.requestBody, key).toBeDefined();
      }
    }
  });

  it("is served at /openapi.json and lists the stock and procurement endpoints", async () => {
    const booted = await boot();
    const res = await booted.app.request("/openapi.json");
    const body = (await res.json()) as { paths: Record<string, unknown> };
    expect(body.paths["/api/v1/stock/adjustments"]).toBeDefined();
    expect(body.paths["/api/v1/procurement/purchase-orders"]).toBeDefined();
    expect(body.paths["/api/v1/procurement/vendors"]).toBeDefined();
  });
});
