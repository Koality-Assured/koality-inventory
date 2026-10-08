ALTER TABLE skus ADD COLUMN safety_stock INTEGER NOT NULL DEFAULT 0;

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  sku_id TEXT NOT NULL REFERENCES skus (id),
  location_id TEXT NOT NULL REFERENCES locations (id),
  lot_id TEXT,
  serial_id TEXT,
  bucket TEXT NOT NULL CHECK (bucket IN ('on_hand', 'allocated', 'in_transit', 'quarantine', 'incoming')),
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_ledger_sku ON ledger_entries (org_id, sku_id, location_id, bucket);

CREATE TABLE stock_balances (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  sku_id TEXT NOT NULL REFERENCES skus (id),
  location_id TEXT NOT NULL REFERENCES locations (id),
  bucket TEXT NOT NULL CHECK (bucket IN ('on_hand', 'allocated', 'in_transit', 'quarantine', 'incoming')),
  quantity INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (org_id, sku_id, location_id, bucket)
);

CREATE TABLE lots (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  sku_id TEXT NOT NULL REFERENCES skus (id),
  lot_code TEXT NOT NULL,
  expires_on TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (org_id, sku_id, lot_code)
);

CREATE TABLE serials (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  sku_id TEXT NOT NULL REFERENCES skus (id),
  serial_code TEXT NOT NULL,
  location_id TEXT REFERENCES locations (id),
  status TEXT NOT NULL CHECK (status IN ('on_hand', 'issued')),
  created_at TEXT NOT NULL,
  UNIQUE (org_id, serial_code)
);

CREATE TABLE fifo_layers (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  sku_id TEXT NOT NULL REFERENCES skus (id),
  location_id TEXT NOT NULL REFERENCES locations (id),
  lot_id TEXT REFERENCES lots (id),
  qty_remaining INTEGER NOT NULL CHECK (qty_remaining >= 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  expires_on TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX idx_fifo_pick ON fifo_layers (org_id, sku_id, location_id, qty_remaining);

CREATE TABLE sku_valuations (
  org_id TEXT NOT NULL REFERENCES organizations (id),
  sku_id TEXT NOT NULL REFERENCES skus (id),
  qty INTEGER NOT NULL,
  total_cost_cents INTEGER NOT NULL,
  PRIMARY KEY (org_id, sku_id)
);

CREATE TABLE transfers (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  sku_id TEXT NOT NULL REFERENCES skus (id),
  from_location_id TEXT NOT NULL REFERENCES locations (id),
  to_location_id TEXT NOT NULL REFERENCES locations (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL CHECK (status IN ('in_transit', 'received')),
  layers_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
