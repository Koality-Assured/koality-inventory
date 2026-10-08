CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  facility_id TEXT NOT NULL REFERENCES facilities (id),
  parent_id TEXT REFERENCES locations (id),
  kind TEXT NOT NULL CHECK (kind IN ('zone', 'aisle', 'rack', 'shelf', 'bin')),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_locations_org ON locations (org_id);
CREATE INDEX idx_locations_facility ON locations (facility_id);
CREATE INDEX idx_locations_parent ON locations (parent_id);
CREATE UNIQUE INDEX locations_root_code ON locations (facility_id, code) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX locations_child_code ON locations (parent_id, code) WHERE parent_id IS NOT NULL;
