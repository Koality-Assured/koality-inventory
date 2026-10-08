import { describe, expect, it } from "vitest";

import {
  ENTITY_PREFIXES,
  createId,
  createIdGenerator,
  parseId,
  type EntityPrefix,
} from "./index.js";

describe("type-prefixed identifiers", () => {
  it("emits every contract prefix as lowercase prefix plus 26-char ULID", () => {
    for (const prefix of ENTITY_PREFIXES) {
      const id = createId(prefix);
      const parsed = parseId(id);
      expect(parsed.prefix).toBe(prefix);
      expect(parsed.ulid).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
      expect(id).toBe(`${prefix}_${parsed.ulid}`);
    }
  });

  it("sorts lexicographically in generation order, including same-millisecond ids", () => {
    let clock = Date.UTC(2026, 9, 8, 12, 0, 0, 0);
    const generate = createIdGenerator(() => clock);
    const first = generate("itm");
    const second = generate("itm");
    clock += 5;
    const third = generate("itm");

    expect([first, second, third].sort()).toEqual([first, second, third]);
    expect(parseId(first).timestampMs).toBe(parseId(second).timestampMs);
    expect(parseId(third).timestampMs).toBeGreaterThan(parseId(first).timestampMs);
    expect(first).not.toBe(second);
  });

  it("resists collisions across a large burst", () => {
    const generate = createIdGenerator();
    const total = 20_000;
    const seen = new Set<string>();
    for (let i = 0; i < total; i += 1) {
      seen.add(generate("sku"));
    }
    expect(seen.size).toBe(total);
  });

  it("accepts uppercase ULID bodies and rejects unknown prefixes", () => {
    const id = createId("loc");
    expect(parseId(id.toUpperCase()).prefix).toBe("loc");
    expect(() => parseId("nope_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toThrow(/Invalid/);
    expect(() => parseId("itm_short")).toThrow(/Invalid/);
    expect(() => parseId("")).toThrow(/Invalid/);
  });

  it("covers the full entity prefix catalog", () => {
    const expected: EntityPrefix[] = [
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
    ];
    expect([...ENTITY_PREFIXES]).toEqual(expected);
  });
});
