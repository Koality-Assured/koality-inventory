# koality-inventory

Inventory platform for human operators and autonomous agents. The core service keeps a type-prefixed identifier catalog and a dual-dialect database (embedded SQLite for local mode, PostgreSQL for hosted mode).

## Local standalone mode

```bash
npm ci
npm run dev:api -- --dev
npm run dev:web
```

The API listens on `http://127.0.0.1:3000` and stores data in `~/.koality-inventory/stock.db`. `--dev` or `ALLOW_DEV_PASSWORD_AUTH=true` seeds:

- `admin@koalityinventory.local` / `dev-admin-password-123`
- `supervisor@koalityinventory.local` / `dev-supervisor-password-123`
- `clerk@koalityinventory.local` / `dev-clerk-password-123`

The web UI is at `http://127.0.0.1:5173`. Production (`NODE_ENV=production`) refuses dev auth unless `DEV_OVERRIDE_KEY` is set, and it also requires `SESSION_SECRET`.

## Slice 0

The foundation contains:

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
