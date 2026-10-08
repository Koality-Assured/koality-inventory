import { and, eq } from "drizzle-orm";

import { type OpenedSqlite } from "@koality-inventory/db";
import { organizations, users } from "@koality-inventory/db/sqlite";
import { createId } from "@koality-inventory/ids";

import { hashPassword } from "./passwords.js";

type SqliteDb = OpenedSqlite["db"];

export const DEV_USERS = [
  {
    email: "admin@koalityinventory.local",
    password: "dev-admin-password-123",
    role: "SuperAdmin",
    displayName: "Dev Admin",
  },
  {
    email: "supervisor@koalityinventory.local",
    password: "dev-supervisor-password-123",
    role: "WarehouseSupervisor",
    displayName: "Dev Supervisor",
  },
  {
    email: "clerk@koalityinventory.local",
    password: "dev-clerk-password-123",
    role: "PickingClerk",
    displayName: "Dev Clerk",
  },
] as const;

export async function seedDevUsers(db: SqliteDb): Promise<void> {
  const now = new Date().toISOString();
  const existingOrg = await db.select().from(organizations).where(eq(organizations.slug, "local"));
  let orgId = existingOrg[0]?.id;
  if (!orgId) {
    orgId = createId("org");
    await db.insert(organizations).values({
      id: orgId,
      name: "Local Standalone",
      slug: "local",
      createdAt: now,
    });
  }

  for (const account of DEV_USERS) {
    const existing = await db
      .select()
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.email, account.email)));
    if (existing[0]) {
      continue;
    }
    await db.insert(users).values({
      id: createId("usr"),
      orgId,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      passwordHash: await hashPassword(account.password),
      status: "active",
      createdAt: now,
    });
  }
}
