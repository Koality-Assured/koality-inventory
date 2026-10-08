ALTER TABLE skus ADD COLUMN reorder_point INTEGER NOT NULL DEFAULT 0;

CREATE TABLE vendors (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  vendor_id TEXT NOT NULL REFERENCES vendors (id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'partially_received', 'closed')),
  created_at TEXT NOT NULL
);

CREATE TABLE purchase_order_lines (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders (id),
  sku_id TEXT NOT NULL REFERENCES skus (id),
  location_id TEXT NOT NULL REFERENCES locations (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  quantity_received INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0)
);

CREATE TABLE sales_orders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  status TEXT NOT NULL CHECK (status IN ('open', 'allocated', 'shipped')),
  created_at TEXT NOT NULL
);

CREATE TABLE sales_order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_orders (id),
  sku_id TEXT NOT NULL REFERENCES skus (id),
  location_id TEXT NOT NULL REFERENCES locations (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE cycle_counts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (id),
  status TEXT NOT NULL CHECK (status IN ('open', 'recorded', 'reconciled')),
  created_at TEXT NOT NULL
);

CREATE TABLE cycle_count_lines (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES cycle_counts (id),
  sku_id TEXT NOT NULL REFERENCES skus (id),
  location_id TEXT NOT NULL REFERENCES locations (id),
  expected_qty INTEGER NOT NULL,
  counted_qty INTEGER
);
