import { describe, it, expect } from "vitest";
import { computeWatchlist } from "../utils/watchlist";

const NOW = new Date("2026-06-12T12:00:00Z").getTime();

function isoMonthsAgo(months: number): string {
  return new Date(NOW - months * 30 * 86400000).toISOString().slice(0, 10);
}

function tob(over: any = {}): any {
  return {
    id: 1, name: "T", brand: "B", rating: 0, agingMax: "",
    lots: [{ status: "jar", weightG: "100", dateOpened: isoMonthsAgo(1) }],
    ...over,
  };
}

describe("computeWatchlist — eligibility & shape", () => {
  it("returns empty for null / empty / all-finished inventories", () => {
    expect(computeWatchlist(null, { now: NOW })).toEqual([]);
    expect(computeWatchlist([], { now: NOW })).toEqual([]);
    expect(computeWatchlist(
      [tob({ lots: [{ status: "finished", weightG: "0" }] })], { now: NOW },
    )).toEqual([]);
  });

  it("a healthy inventory produces no items", () => {
    expect(computeWatchlist([tob()], { now: NOW })).toEqual([]);
  });

  it("caps the list at max (default 5)", () => {
    const tobs = Array.from({ length: 8 }, (_, i) => tob({
      id: i + 1, agingMax: "1",
      lots: [{ status: "cellar", weightG: "50", dateProduction: "2020-01-01" }],
    }));
    expect(computeWatchlist(tobs, { now: NOW })).toHaveLength(5);
    expect(computeWatchlist(tobs, { now: NOW, max: 2 })).toHaveLength(2);
  });
});

describe("computeWatchlist — signals", () => {
  it("flags an overaged lot", () => {
    const items = computeWatchlist([tob({
      agingMax: "2",
      lots: [{ status: "cellar", weightG: "50", dateProduction: "2020-01-01" }],
    })], { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("overaged");
  });

  it("a long-open jar is NOT flagged (stale-jar signal removed)", () => {
    // weightG well above the low-stock threshold so only the (removed)
    // stale-jar signal could apply — and it doesn't.
    expect(computeWatchlist([tob({
      lots: [{ status: "jar", weightG: "150", dateOpened: isoMonthsAgo(14) }],
    })], { now: NOW })).toEqual([]);
  });

  it("flags any tobacco running low, with the remaining weight", () => {
    const items = computeWatchlist([tob({
      rating: 5,
      lots: [{ status: "jar", weightG: "35", dateOpened: isoMonthsAgo(1) }],
    })], { now: NOW, lowWeightThreshold: 50 });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("low_stock");
    expect(items[0]!.value).toBe(35);
  });

  it("flags a low NON-favourite (no rating gate anymore)", () => {
    const items = computeWatchlist([tob({
      rating: 3,
      lots: [{ status: "jar", weightG: "35", dateOpened: isoMonthsAgo(1) }],
    })], { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("low_stock");
  });

  it("skips soft-deleted lots (parity with the other lot engines)", () => {
    // The only low-stock lot is trashed → the tobacco has no live lot → no flag.
    expect(computeWatchlist([tob({
      rating: 5,
      lots: [{ status: "jar", weightG: "35", dateOpened: isoMonthsAgo(1), deletedAt: "2026-01-01T00:00:00Z" }],
    })], { now: NOW })).toEqual([]);
    // A live low lot alongside a trashed one still flags (trashed one ignored).
    const items = computeWatchlist([tob({
      rating: 5,
      lots: [
        { status: "jar", weightG: "5000", dateOpened: isoMonthsAgo(1), deletedAt: "2026-01-01T00:00:00Z" },
        { status: "jar", weightG: "20", dateOpened: isoMonthsAgo(1) },
      ],
    })], { now: NOW, lowWeightThreshold: 50 });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("low_stock");
    expect(items[0]!.value).toBe(20); // only the live lot counts toward stock
  });

  it("does NOT flag a low 'don't rebuy' tobacco (rebuy === false)", () => {
    expect(computeWatchlist([tob({
      rating: 5, rebuy: false,
      lots: [{ status: "jar", weightG: "35", dateOpened: isoMonthsAgo(1) }],
    })], { now: NOW })).toEqual([]);
  });

  it("STILL flags an overaged 'don't rebuy' tobacco (finish it off before it's too old)", () => {
    const items = computeWatchlist([tob({
      rebuy: false, agingMax: "2",
      lots: [{ status: "cellar", weightG: "50", dateProduction: "2020-01-01" }],
    })], { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("overaged");
  });

  it("a tobacco at zero weight is not flagged (nothing left to rebuy from)", () => {
    expect(computeWatchlist([tob({
      rating: 5,
      lots: [{ status: "jar", weightG: "0", dateOpened: isoMonthsAgo(1) }],
    })], { now: NOW })).toEqual([]);
  });
});

describe("computeWatchlist — severity & dedupe", () => {
  it("one entry per tobacco, keeping the most severe signal", () => {
    // Overaged AND low stock — overaged wins. Aging is cellar-only,
    // so the over-aged lot is "cellar".
    const items = computeWatchlist([tob({
      rating: 5, agingMax: "2",
      lots: [
        { status: "cellar", weightG: "20", dateProduction: "2020-01-01" },
      ],
    })], { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("overaged");
  });

  it("sorts by severity across tobaccos", () => {
    const tobs = [
      tob({ id: 1, rating: 5, lots: [{ status: "jar", weightG: "20", dateOpened: isoMonthsAgo(1) }] }),
      tob({ id: 3, agingMax: "2", lots: [{ status: "cellar", weightG: "50", dateProduction: "2020-01-01" }] }),
    ];
    const items = computeWatchlist(tobs, { now: NOW });
    expect(items.map(i => i.kind)).toEqual(["overaged", "low_stock"]);
  });

  it("tolerates malformed dates and hostile weights", () => {
    expect(() => computeWatchlist([tob({
      rating: 5,
      lots: [
        { status: "jar", weightG: "Infinity", dateOpened: "garbage" },
        { status: "jar", weightG: "abc", dateOpened: "" },
      ],
    })], { now: NOW })).not.toThrow();
  });
});

describe("computeWatchlist — configurable thresholds", () => {
  it("honours a custom lowWeightThreshold", () => {
    const t = tob({ rating: 5, lots: [{ status: "jar", weightG: "70", dateOpened: isoMonthsAgo(1) }] });
    expect(computeWatchlist([t], { now: NOW })).toEqual([]);                       // default 50
    const hit = computeWatchlist([t], { now: NOW, lowWeightThreshold: 100 });
    expect(hit).toHaveLength(1);
    expect(hit[0]!.kind).toBe("low_stock");
  });
});
