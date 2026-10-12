import { afterEach, describe, expect, it } from "vitest";

import { bootLocal, type Booted } from "./boot.js";
import { DEV_USERS } from "./seed.js";

const running: Booted[] = [];

async function login(booted: Booted, email: string, password: string): Promise<string> {
  const response = await booted.app.request("/api/v1/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 200) {
    throw new Error(`Login failed: ${await response.text()}`);
  }
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}

function jsonAuth(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

afterEach(() => {
  for (const booted of running.splice(0)) {
    booted.server.close();
    booted.opened.close();
  }
});

describe("RBAC and security", () => {
  it("enforces RBAC correctly per role (401 vs 403)", async () => {
    const booted = await bootLocal({
      env: { NODE_ENV: "development", ALLOW_DEV_PASSWORD_AUTH: "true" },
      args: ["--dev"],
      port: 0,
    });
    running.push(booted);

    const adminToken = await login(booted, DEV_USERS[0]!.email, DEV_USERS[0]!.password);
    const clerkToken = await login(booted, DEV_USERS[2]!.email, DEV_USERS[2]!.password);

    const unauthRes = await booted.app.request("/api/v1/items", { method: "GET" });
    expect(unauthRes.status).toBe(401);

    const adminRes = await booted.app.request("/api/v1/items", {
      method: "POST",
      headers: jsonAuth(adminToken),
      body: JSON.stringify({ name: "Test" }),
    });
    expect(adminRes.status).not.toBe(403);
    expect(adminRes.status).not.toBe(401);

    const clerkRes = await booted.app.request("/api/v1/items", {
      method: "POST",
      headers: jsonAuth(clerkToken),
      body: JSON.stringify({ name: "Test" }),
    });
    expect(clerkRes.status).toBe(403);
  });

  it("rate limits login endpoint", async () => {
    const booted = await bootLocal({
      env: { NODE_ENV: "development", ALLOW_DEV_PASSWORD_AUTH: "true" },
      args: ["--dev"],
      port: 0,
    });
    running.push(booted);

    const loginData = JSON.stringify({ email: DEV_USERS[0]!.email, password: DEV_USERS[0]!.password });
    
    for (let i = 0; i < 5; i++) {
      const res = await booted.app.request("/api/v1/auth/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
        body: loginData,
      });
      expect(res.status).toBe(200);
    }
    
    const limitedRes = await booted.app.request("/api/v1/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
      body: loginData,
    });
    expect(limitedRes.status).toBe(429);
  });

  it("checks OpenAPI document completeness", async () => {
    const booted = await bootLocal({
      env: { NODE_ENV: "development", ALLOW_DEV_PASSWORD_AUTH: "true" },
      args: ["--dev"],
      port: 0,
    });
    running.push(booted);

    const res = await booted.app.request("/openapi.json");
    const openapi = (await res.json()) as { paths: Record<string, Record<string, unknown>> };

    expect(openapi.paths["/api/v1/stock/adjustments"]).toBeDefined();
    expect(openapi.paths["/api/v1/procurement/purchase-orders"]).toBeDefined();
    
    const routes = booted.app.routes.filter(
      (r: { path: string; method: string }) =>
        r.path.startsWith("/api/v1/") && r.path !== "/api/v1/health" && r.path !== "/api/v1/meta",
    );
    for (const r of routes) {
      const openapiPath = r.path.replace(/:([^/]+)/g, "{$1}");
      if (r.path.endsWith("*") || r.method === "ALL") continue;

      const pathObj = openapi.paths[openapiPath];
      expect(pathObj, `Missing route in OpenAPI doc: ${r.method} ${openapiPath}`).toBeDefined();
      const methodObj = pathObj![r.method.toLowerCase()];
      expect(methodObj, `Missing method in OpenAPI doc: ${r.method} ${openapiPath}`).toBeDefined();
    }
  });
});
