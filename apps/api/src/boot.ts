import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { serve, type ServerType } from "@hono/node-server";

import { openSqlite, type OpenedSqlite } from "@koality-inventory/db";

import { createApp } from "./app.js";
import { resolveDevAuth, resolveSessionSecret } from "./dev-policy.js";
import { seedDevUsers } from "./seed.js";

export interface BootOptions {
  env: Record<string, string | undefined>;
  argv?: readonly string[];
  dbPath?: string;
  port?: number;
}

export interface Booted {
  app: ReturnType<typeof createApp>;
  server: ServerType;
  opened: OpenedSqlite;
  devAuth: boolean;
  dbPath: string;
  port: number;
}

export async function bootLocal(options: BootOptions): Promise<Booted> {
  const dev = resolveDevAuth(options.env, options.argv ?? []);
  const sessionSecret = resolveSessionSecret(options.env);
  const dbPath = options.dbPath ?? join(homedir(), ".koality-inventory", "stock.db");
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const opened = openSqlite(dbPath);
  if (dev.enabled) {
    await seedDevUsers(opened.db);
  }
  const app = createApp({ db: opened.db, devAuth: dev.enabled, sessionSecret });
  const requestedPort = options.port ?? (options.env.PORT ? Number(options.env.PORT) : 3000);
  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: requestedPort,
  });
  const port = await boundPort(server);
  return { app, server, opened, devAuth: dev.enabled, dbPath, port };
}

function boundPort(server: ServerType): Promise<number> {
  const read = () => {
    const address = server.address();
    return address && typeof address === "object" ? address.port : 0;
  };
  const current = read();
  if (current !== 0) {
    return Promise.resolve(current);
  }
  return new Promise((resolve, reject) => {
    server.once("listening", () => resolve(read()));
    server.once("error", reject);
  });
}
