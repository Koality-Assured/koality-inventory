CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (
    role IN (
      'SuperAdmin',
      'OrgOwner',
      'InventoryManager',
      'WarehouseSupervisor',
      'ReceivingClerk',
      'PickingClerk',
      'ProcurementAgent',
      'AuditorViewer'
    )
  ),
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  UNIQUE (org_id, email)
);

CREATE TABLE facilities (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (org_id, code)
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  base_uom TEXT NOT NULL DEFAULT 'ea',
  tracking TEXT NOT NULL DEFAULT 'none' CHECK (tracking IN ('none', 'lot', 'serial')),
  costing_method TEXT NOT NULL DEFAULT 'fifo' CHECK (costing_method IN ('fifo', 'wac')),
  created_at TEXT NOT NULL
);

CREATE TABLE skus (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  item_id TEXT NOT NULL REFERENCES items (id),
  sku_code TEXT NOT NULL,
  barcode TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (org_id, sku_code)
);

CREATE INDEX idx_users_org ON users (org_id);
CREATE INDEX idx_facilities_org ON facilities (org_id);
CREATE INDEX idx_items_org ON items (org_id);
CREATE INDEX idx_skus_org ON skus (org_id);
CREATE INDEX idx_skus_item ON skus (item_id);
