import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bootLocal, type Booted } from "./boot.js";
import { DEV_USERS } from "./seed.js";

const running: Booted[] = [];

async function login(booted: Booted): Promise<string> {
  const response = await booted.app.request("/api/v1/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: DEV_USERS[0]?.email,
      password: DEV_USERS[0]?.password,
    }),
  });
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

describe("local standalone boot", () => {
  it("starts offline, seeds dev admin, and does not call fetch", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      calls.push(String(input));
      throw new Error(`unexpected network call: ${String(input)}`);
    }) as typeof fetch;

    try {
      const booted = await bootLocal({
        env: { NODE_ENV: "development", ALLOW_DEV_PASSWORD_AUTH: "true" },
        dbPath: ":memory:",
        port: 0,
      });
      running.push(booted);
      expect(calls).toEqual([]);
      expect(booted.devAuth).toBe(true);

      const login = await booted.app.request("/api/v1/auth/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: DEV_USERS[0].email,
          password: DEV_USERS[0].password,
        }),
      });
      expect(login.status).toBe(200);
      const body = (await login.json()) as { user: { role: string; email: string } };
      expect(body.user.role).toBe("SuperAdmin");
      expect(body.user.email).toBe("admin@koalityinventory.local");

      const meta = await booted.app.request("/api/v1/meta");
      const metaBody = (await meta.json()) as { banner: string };
      expect(metaBody.banner).toContain("development authentication");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("creates a catalog item and a facility-to-bin tree for the signed-in org", async () => {
    const booted = await bootLocal({
      env: { NODE_ENV: "development", ALLOW_DEV_PASSWORD_AUTH: "true" },
      dbPath: ":memory:",
      port: 0,
    });
    running.push(booted);
    const token = await login(booted);
    const itemResponse = await booted.app.request("/api/v1/items", {
      method: "POST",
      headers: jsonAuth(token),
      body: JSON.stringify({ name: "Widget", category: "Parts" }),
    });
    expect(itemResponse.status).toBe(201);
    const itemBody = (await itemResponse.json()) as { item: { id: string } };
    const skuResponse = await booted.app.request(`/api/v1/items/${itemBody.item.id}/skus`, {
      method: "POST",
      headers: jsonAuth(token),
      body: JSON.stringify({
        skuCode: "WIDGET-1",
        barcode: "000111222333",
        attributes: { color: "blue" },
      }),
    });
    expect(skuResponse.status).toBe(201);

    const facilityResponse = await booted.app.request("/api/v1/locations/facilities", {
      method: "POST",
      headers: jsonAuth(token),
      body: JSON.stringify({ name: "Main DC", code: "MAIN" }),
    });
    const facility = ((await facilityResponse.json()) as { facility: { id: string } }).facility;
    let parentId: string | null = null;
    for (const kind of ["zone", "aisle", "rack", "shelf", "bin"] as const) {
      const response = await booted.app.request("/api/v1/locations", {
        method: "POST",
        headers: jsonAuth(token),
        body: JSON.stringify({
          facilityId: facility.id,
          parentId,
          kind,
          name: kind,
          code: kind.toUpperCase(),
        }),
      });
      expect(response.status).toBe(201);
      parentId = ((await response.json()) as { location: { id: string } }).location.id;
    }
    const treeResponse = await booted.app.request("/api/v1/locations/tree", {
      headers: { authorization: `Bearer ${token}` },
    });
    const tree = (await treeResponse.json()) as {
      facilities: Array<{ locations: Array<{ kind: string; children: unknown[] }> }>;
    };
    expect(tree.facilities[0]?.locations[0]?.kind).toBe("zone");
    expect(JSON.stringify(tree)).toContain("BIN");
  });

  it("hides dev login when the flag is off", async () => {
    const booted = await bootLocal({
      env: { NODE_ENV: "development" },
      dbPath: ":memory:",
      port: 0,
    });
    running.push(booted);
    const loginResponse = await booted.app.request("/api/v1/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: DEV_USERS[0].email,
        password: DEV_USERS[0].password,
      }),
    });
    expect(loginResponse.status).toBe(404);
  });

  it("fails closed before opening a database when production dev auth has no override", async () => {
    const dir = mkdtempSync(join(tmpdir(), "koality-inventory-closed-"));
    const dbPath = join(dir, "stock.db");
    await expect(
      bootLocal({
        env: { NODE_ENV: "production", ALLOW_DEV_PASSWORD_AUTH: "true" },
        argv: ["--dev"],
        dbPath,
        port: 0,
      }),
    ).rejects.toThrow(/DEV_OVERRIDE_KEY/);
    expect(existsSync(dbPath)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
