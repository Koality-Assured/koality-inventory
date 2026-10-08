import { decodeTime, monotonicFactory } from "ulid";

/**
 * Millisecond-sortable, type-prefixed identifiers.
 * Format: `<prefix>_<26-char ULID>` (Crockford base32, lowercase).
 */
export const ENTITY_PREFIXES = [
  "org",
  "fac",
  "loc",
  "itm",
  "sku",
  "stk",
  "lot",
  "ser",
  "po",
  "rec",
  "ord",
  "trn",
  "cyc",
  "adj",
  "usr",
  "agt",
  "aud",
] as const;

export type EntityPrefix = (typeof ENTITY_PREFIXES)[number];

const PREFIX_SET = new Set<string>(ENTITY_PREFIXES);
const ULID_BODY = "[0-9A-HJKMNP-TV-Z]{26}";
const ID_PATTERN = new RegExp(`^(${ENTITY_PREFIXES.join("|")})_(${ULID_BODY})$`, "i");

export interface ParsedId {
  prefix: EntityPrefix;
  ulid: string;
  timestampMs: number;
}

export interface IdGenerator {
  (prefix: EntityPrefix): string;
}

export function createIdGenerator(now: () => number = Date.now): IdGenerator {
  const nextUlid = monotonicFactory();
  return (prefix: EntityPrefix) => {
    assertPrefix(prefix);
    return `${prefix}_${nextUlid(now()).toLowerCase()}`;
  };
}

const defaultGenerator = createIdGenerator();
const rawUlid = monotonicFactory();

export function createRawUlid(): string {
  return rawUlid().toLowerCase();
}

export function createId(prefix: EntityPrefix): string {
  return defaultGenerator(prefix);
}

export function isEntityPrefix(value: string): value is EntityPrefix {
  return PREFIX_SET.has(value);
}

export function parseId(value: string): ParsedId {
  const match = ID_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid type-prefixed identifier: ${value}`);
  }
  const prefixRaw = match[1];
  const ulidRaw = match[2];
  if (!prefixRaw || !ulidRaw) {
    throw new Error(`Invalid type-prefixed identifier: ${value}`);
  }
  const prefix = prefixRaw.toLowerCase();
  if (!isEntityPrefix(prefix)) {
    throw new Error(`Unknown identifier prefix: ${prefix}`);
  }
  const ulid = ulidRaw.toLowerCase();
  return {
    prefix,
    ulid,
    timestampMs: decodeTime(ulid.toUpperCase()),
  };
}

export function assertPrefix(prefix: string): asserts prefix is EntityPrefix {
  if (!isEntityPrefix(prefix)) {
    throw new Error(`Unknown identifier prefix: ${prefix}`);
  }
}
