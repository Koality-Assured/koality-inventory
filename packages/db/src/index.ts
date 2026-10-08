export { ENTITY_PREFIXES } from "@koality-inventory/ids";
export { postgresSchema } from "./postgres/schema.js";
export { sqliteSchema } from "./sqlite/schema.js";
export {
  applyPostgresMigrations,
  applySqliteMigrations,
  openPostgres,
  openSqlite,
  type OpenedPostgres,
  type OpenedSqlite,
} from "./migrate.js";
