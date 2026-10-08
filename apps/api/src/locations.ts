import { and, eq } from "drizzle-orm";

import { type OpenedSqlite } from "@koality-inventory/db";
import { facilities, locations } from "@koality-inventory/db/sqlite";
import { createId } from "@koality-inventory/ids";

import { HttpError, isUniqueViolation } from "./http.js";

type SqliteDb = OpenedSqlite["db"];

export const LOCATION_PARENT: Record<string, string | null> = {
  zone: null,
  aisle: "zone",
  rack: "aisle",
  shelf: "rack",
  bin: "shelf",
};

export interface FacilityInput {
  name: string;
  code: string;
}

export interface LocationInput {
  facilityId: string;
  parentId?: string | null | undefined;
  kind: "zone" | "aisle" | "rack" | "shelf" | "bin";
  name: string;
  code: string;
}

interface LocationNode {
  id: string;
  kind: string;
  name: string;
  code: string;
  children: LocationNode[];
}

export async function listFacilities(db: SqliteDb, orgId: string) {
  const rows = await db.select().from(facilities).where(eq(facilities.orgId, orgId));
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export async function createFacility(db: SqliteDb, orgId: string, input: FacilityInput) {
  const id = createId("fac");
  const now = new Date().toISOString();
  try {
    await db.insert(facilities).values({
      id,
      orgId,
      name: input.name,
      code: input.code,
      createdAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "Facility code already exists");
    }
    throw error;
  }
  const created = await db.select().from(facilities).where(eq(facilities.id, id));
  const row = created[0];
  if (!row) {
    throw new HttpError(500, "Facility insert failed");
  }
  return row;
}

export async function createLocation(db: SqliteDb, orgId: string, input: LocationInput) {
  const facilityRows = await db
    .select()
    .from(facilities)
    .where(and(eq(facilities.id, input.facilityId), eq(facilities.orgId, orgId)));
  if (!facilityRows[0]) {
    throw new HttpError(404, "Facility not found");
  }

  const expectedParent = LOCATION_PARENT[input.kind];
  if (expectedParent === undefined) {
    throw new HttpError(400, "Unknown location kind");
  }

  let parentId: string | null = input.parentId ?? null;
  if (expectedParent === null) {
    if (parentId) {
      throw new HttpError(400, "Zones attach directly to a facility");
    }
    parentId = null;
  } else {
    if (!parentId) {
      throw new HttpError(400, `${input.kind} requires a ${expectedParent} parent`);
    }
    const parentRows = await db
      .select()
      .from(locations)
      .where(and(eq(locations.id, parentId), eq(locations.orgId, orgId)));
    const parent = parentRows[0];
    if (!parent || parent.facilityId !== input.facilityId) {
      throw new HttpError(404, "Parent location not found");
    }
    if (parent.kind !== expectedParent) {
      throw new HttpError(400, `${input.kind} must be created under a ${expectedParent}`);
    }
  }

  const id = createId("loc");
  const now = new Date().toISOString();
  try {
    await db.insert(locations).values({
      id,
      orgId,
      facilityId: input.facilityId,
      parentId,
      kind: input.kind,
      name: input.name,
      code: input.code,
      createdAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "Location code already exists under that parent");
    }
    throw error;
  }
  const created = await db.select().from(locations).where(eq(locations.id, id));
  const row = created[0];
  if (!row) {
    throw new HttpError(500, "Location insert failed");
  }
  return row;
}

export async function locationTree(db: SqliteDb, orgId: string) {
  const facilityRows = await listFacilities(db, orgId);
  const locationRows = await db.select().from(locations).where(eq(locations.orgId, orgId));
  return facilityRows.map((facility) => ({
    id: facility.id,
    name: facility.name,
    code: facility.code,
    locations: buildTree(locationRows.filter((row) => row.facilityId === facility.id)),
  }));
}

function buildTree(
  rows: Array<{
    id: string;
    parentId: string | null;
    kind: string;
    name: string;
    code: string;
  }>,
): LocationNode[] {
  const nodes = new Map<string, LocationNode & { parentId: string | null }>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      kind: row.kind,
      name: row.name,
      code: row.code,
      children: [],
    });
  }
  const roots: LocationNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId) {
      const parent = nodes.get(node.parentId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }
  const strip = (node: LocationNode & { parentId?: string | null }): LocationNode => ({
    id: node.id,
    kind: node.kind,
    name: node.name,
    code: node.code,
    children: node.children.map((child) =>
      strip(child as LocationNode & { parentId: string | null }),
    ),
  });
  return roots.map((root) => strip(root as LocationNode & { parentId: string | null }));
}
