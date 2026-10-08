import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { type OpenedSqlite } from "@koality-inventory/db";
import { sessions, users } from "@koality-inventory/db/sqlite";
import { createRawUlid } from "@koality-inventory/ids";

import { createItem, createSku, getItem, listItems, listSkus } from "./catalog.js";
import { HttpError } from "./http.js";
import { createFacility, createLocation, listFacilities, locationTree } from "./locations.js";
import { verifyPassword } from "./passwords.js";
import { signAccessToken, verifyAccessToken } from "./tokens.js";

type SqliteDb = OpenedSqlite["db"];

interface AppDeps {
  db: SqliteDb;
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
