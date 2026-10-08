import { describe, expect, it } from "vitest";

import { consumeLayers, issueWac, receiveWac, wacCents, type CostLayer } from "./valuation.js";

const layers = (rows: Array<[number, number, string, string | null]>): CostLayer[] =>
  rows.map(([qty, unitCostCents, receivedAt, expiresOn]) => ({
    qty,
    unitCostCents,
    receivedAt,
    expiresOn,
  }));

describe("FIFO and WAC valuation", () => {
  it("depletes oldest cost layers first across two receipts", () => {
    const onHand = layers([
      [10, 500, "2026-01-01T00:00:00.000Z", null],
      [10, 700, "2026-02-01T00:00:00.000Z", null],
    ]);
    const issued = consumeLayers(onHand, 15);
    expect(issued.cogsCents).toBe(10 * 500 + 5 * 700);
    expect(issued.remaining).toEqual([
      {
        qty: 5,
        unitCostCents: 700,
        receivedAt: "2026-02-01T00:00:00.000Z",
        expiresOn: null,
      },
    ]);
    expect(issued.remaining.reduce((sum, layer) => sum + layer.qty * layer.unitCostCents, 0)).toBe(
      3500,
    );
  });

  it("picks the earliest expiration before receipt order (FEFO)", () => {
    const onHand = layers([
      [4, 100, "2026-01-01T00:00:00.000Z", "2026-12-01"],
      [4, 300, "2026-03-01T00:00:00.000Z", "2026-06-01"],
    ]);
    const issued = consumeLayers(onHand, 4);
    expect(issued.cogsCents).toBe(4 * 300);
    expect(issued.remaining[0]?.expiresOn).toBe("2026-12-01");
  });

  it("recalculates weighted average cost across multi-lot receipts", () => {
    let state = { qty: 0, totalCostCents: 0 };
    state = receiveWac(state, 10, 500);
    state = receiveWac(state, 10, 700);
    expect(wacCents(state)).toBe(600);
    expect(state.totalCostCents).toBe(12000);
    const issued = issueWac(state, 15);
    expect(issued.cogsCents).toBe(9000);
    expect(issued.state).toEqual({ qty: 5, totalCostCents: 3000 });
    expect(wacCents(issued.state)).toBe(600);
  });
});
