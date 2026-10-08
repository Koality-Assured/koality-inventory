# koality-inventory

Inventory platform for human operators and autonomous agents. The core service keeps a type-prefixed identifier catalog and a dual-dialect database (embedded SQLite for local mode, PostgreSQL for hosted mode).

## Slice 0

This repository currently contains the foundation:

- `@koality-inventory/ids` — millisecond-sortable ULID identifiers with entity prefixes (`itm_`, `sku_`, `loc_`, and the rest of the catalog).
- `@koality-inventory/db` — Drizzle schemas and SQL migrations for organizations, users, facilities, and item masters on both SQLite and PostgreSQL.

Hosted PostgreSQL is exercised in CI with [PGlite](https://pglite.dev/), an embedded PostgreSQL build, so the migration dry-run does not need a database server. Local mode uses Node's built-in `node:sqlite`.

## Scripts

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
```

Node.js 24 or newer is required.
