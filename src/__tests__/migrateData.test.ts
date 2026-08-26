import { describe, it, expect } from "vitest";
// import the real migrateData from utils.ts. The file used
// to keep a tiny mirror copy of the early-2024 implementation; the
// real function has grown significantly (snapshot back-fill, lot
// weightInitial reconstruction, AI markup scrubbing, string coercion)
// and the mirror was lying to the tests by claiming "this is a
// verbatim copy". Pointing at the source of truth here means every
// new layer of migration is exercised by these tests automatically.
import { migrateData, bumpCounterPastMaxId } from "../utils";

// ── counter clamping ──────────────────────────────────────────────────────────

describe("migrateData — counter clamping", () => {
  it("passes through valid numeric counters unchanged", () => {
    const d = migrateData({ nxT: 5, nxW: 3, nxP: 7, nxA: 2, nxJ: 10 });
    expect(d.nxT).toBe(5);
    expect(d.nxW).toBe(3);
    expect(d.nxP).toBe(7);
    expect(d.nxA).toBe(2);
    expect(d.nxJ).toBe(10);
  });

  it("clamps counter at 0 to 1", () => {
    const d = migrateData({ nxT: 0, nxW: 0, nxP: 0, nxA: 0, nxJ: 0 });
    expect(d.nxT).toBe(1);
    expect(d.nxW).toBe(1);
    expect(d.nxP).toBe(1);
    expect(d.nxA).toBe(1);
    expect(d.nxJ).toBe(1);
  });

  it("clamps negative counters to 1", () => {
    const d = migrateData({ nxT: -3, nxW: -1, nxP: -10, nxA: -5, nxJ: -2 });
    expect(d.nxT).toBe(1);
    expect(d.nxW).toBe(1);
    expect(d.nxP).toBe(1);
    expect(d.nxA).toBe(1);
    expect(d.nxJ).toBe(1);
  });

  it("converts string numeric counters to integers", () => {
    // nxA carries a NEGATIVE numeric string: it parses, so it takes the
    // numeric branch, and the floor then has to bring it back to 1.
    const d = migrateData({ nxT: "5", nxW: "12", nxP: "3", nxA: "-1", nxJ: "1" });
    expect(d.nxT).toBe(5);
    expect(d.nxW).toBe(12);
    expect(d.nxP).toBe(3);
    expect(d.nxA).toBe(1);
    expect(d.nxJ).toBe(1);
  });

  it("CRITICAL: non-numeric counters are clamped to 1 (prevents string concatenation)", () => {
    // Without clamping, data.nxT + 1 would give "abc1" instead of 2.
    // nxW is the EMPTY string and nxJ an OBJECT — neither is a garbage word,
    // and both are shapes a hand-edited or forged payload really carries.
    const d = migrateData({ nxT: "abc", nxW: "", nxP: "foo", nxA: "bar", nxJ: {} as any });
    expect(d.nxT).toBe(1);
    expect(d.nxW).toBe(1);
    expect(d.nxP).toBe(1);
    expect(d.nxA).toBe(1);
    expect(d.nxJ).toBe(1);
  });

  it("CRITICAL: string '0' is clamped to 1", () => {
    const d = migrateData({ nxT: "0", nxW: "0", nxP: "0", nxA: "0", nxJ: "0" });
    expect(d.nxT).toBe(1);
    expect(d.nxW).toBe(1);
    expect(d.nxP).toBe(1);
    expect(d.nxA).toBe(1);
    expect(d.nxJ).toBe(1);
  });

  it("CRITICAL: float strings are truncated by parseInt (e.g. '2.9' → 2)", () => {
    const d = migrateData({ nxT: "2.9", nxW: "3.1", nxP: "1.9", nxA: "5.7", nxJ: "4.99" });
    expect(d.nxT).toBe(2);
    expect(d.nxW).toBe(3);
    expect(d.nxP).toBe(1);
    expect(d.nxA).toBe(5);
    expect(d.nxJ).toBe(4);
  });

  it("CRITICAL: null counters are clamped to 1", () => {
    const d = migrateData({ nxT: null, nxW: null, nxP: null, nxA: null, nxJ: null });
    expect(d.nxT).toBe(1);
    expect(d.nxW).toBe(1);
    expect(d.nxP).toBe(1);
    expect(d.nxA).toBe(1);
    expect(d.nxJ).toBe(1);
  });

  it("CRITICAL: undefined counters are clamped to 1", () => {
    const d = migrateData({});
    expect(d.nxT).toBe(1);
    expect(d.nxW).toBe(1);
    expect(d.nxP).toBe(1);
    expect(d.nxA).toBe(1);
    expect(d.nxJ).toBe(1);
  });

  it("keeps counter at 1 (already minimum)", () => {
    const d = migrateData({ nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    expect(d.nxT).toBe(1);
    expect(d.nxW).toBe(1);
    expect(d.nxP).toBe(1);
    expect(d.nxA).toBe(1);
    expect(d.nxJ).toBe(1);
  });
});

// ── array initialization ──────────────────────────────────────────────────────

describe("migrateData — array initialization", () => {
  it("initializes accessories to [] when absent", () => {
    const d: any = { nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 };
    delete d.accessories;
    migrateData(d);
    expect(d.accessories).toEqual([]);
  });

  it("initializes sessions to [] when absent", () => {
    const d: any = { nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 };
    delete d.sessions;
    migrateData(d);
    expect(d.sessions).toEqual([]);
  });

  it("does not overwrite existing accessories array", () => {
    const existing = [{ id: 1, name: "Zippo" }];
    const d = migrateData({ accessories: existing, nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    expect(d.accessories).toBe(existing);
    expect(d.accessories).toHaveLength(1);
  });

  it("does not overwrite existing sessions array", () => {
    const existing = [{ id: 1, date: "2024-01-01" }];
    const d = migrateData({ sessions: existing, nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    expect(d.sessions).toBe(existing);
    expect(d.sessions).toHaveLength(1);
  });

  it("coerces a non-array tobacco.lots to [] (forged/corrupt payload)", () => {
    // isPlausibleBackup only checks Array.isArray(tobaccos), so a corrupt
    // lots:"hax" loads; migrateData must normalise it so addLotToTobacco's
    // `tob.lots.push(...)` can't throw on a string.
    const d = migrateData({
      tobaccos: [{ id: 1, name: "N", brand: "B", lots: "hax" as any }],
      nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1,
    } as any);
    expect(Array.isArray(d.tobaccos[0].lots)).toBe(true);
    expect(d.tobaccos[0].lots).toEqual([]);
  });

  it("leaves a valid lots array untouched", () => {
    const d = migrateData({
      tobaccos: [{ id: 1, name: "N", brand: "B", lots: [{ id: 5, status: "jar", weightG: "20" }] }],
      nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1,
    } as any);
    expect(d.tobaccos[0].lots).toHaveLength(1);
  });

  // Every pipe carries a maintenance log array.
  it("defaults pipe.maintenance to [] on a legacy pipe without it", () => {
    const d = migrateData({ pipes: [{ id: 1, name: "P", brand: "B" }], nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    expect(d.pipes[0].maintenance).toEqual([]);
  });

  it("replaces a non-array maintenance value with []", () => {
    const d = migrateData({ pipes: [{ id: 1, name: "P", brand: "B", maintenance: "oops" as any }], nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    expect(d.pipes[0].maintenance).toEqual([]);
  });

  it("preserves an existing maintenance array (same reference)", () => {
    const log = [{ id: 9, date: "2026-01-01", kind: "light", tasks: [], notes: "" }];
    const d = migrateData({ pipes: [{ id: 1, name: "P", brand: "B", maintenance: log }], nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    expect(d.pipes[0].maintenance).toBe(log);
  });

  // legacy single-`type` entries → { kind, tasks } model.
  it("migrates a legacy maintenance entry's type to kind + tasks", () => {
    const log = [
      { id: 1, date: "2026-01-01", type: "Nettoyage", notes: "a" },
      { id: 2, date: "2026-02-01", type: "Alcool + sel", notes: "b" },
      { id: 3, date: "2026-03-01", type: "Alésage", notes: "c" },
      { id: 4, date: "2026-04-01", type: "Cire", notes: "d" },
      { id: 5, date: "2026-05-01", type: "Réparation", notes: "e" },
      { id: 6, date: "2026-06-01", type: "Autre", notes: "f" },
    ];
    const d = migrateData({ pipes: [{ id: 1, name: "P", brand: "B", maintenance: log }], nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    const m = d.pipes[0].maintenance;
    // migrateData now also backfills a `uid` on each entry, so match
    // the kind/tasks migration with toMatchObject (uid asserted separately).
    expect(m[0]).toMatchObject({ id: 1, date: "2026-01-01", kind: "light", tasks: [], notes: "a" });
    expect(m[1]).toMatchObject({ id: 2, date: "2026-02-01", kind: "full", tasks: ["saltalcohol"], notes: "b" });
    expect(m[2]).toMatchObject({ id: 3, date: "2026-03-01", kind: "full", tasks: ["ream"], notes: "c" });
    expect(m[3]).toMatchObject({ id: 4, date: "2026-04-01", kind: "light", tasks: ["wax"], notes: "d" });
    expect(m[4]).toMatchObject({ id: 5, date: "2026-05-01", kind: "light", tasks: ["repair"], notes: "e" });
    expect(m[5]).toMatchObject({ id: 6, date: "2026-06-01", kind: "light", tasks: [], notes: "f" });
    expect(m.every((e: any) => typeof e.uid === "string" && e.uid.length > 0)).toBe(true);
    // `type` must be gone after migration.
    expect(m.every((e: any) => e.type === undefined)).toBe(true);
  });

  it("normalizes an unknown kind + filters unknown task keys", () => {
    const log = [{ id: 1, date: "2026-01-01", kind: "bogus", tasks: ["wax", "nope", 42], notes: "" }];
    const d = migrateData({ pipes: [{ id: 1, name: "P", brand: "B", maintenance: log as any }], nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    expect(d.pipes[0].maintenance[0].kind).toBe("light");
    expect(d.pipes[0].maintenance[0].tasks).toEqual(["wax"]);
  });

  // Data repair: the legacy addMaintenance bug wrote id:0 on
  // every entry. migrateData must re-stamp the duplicates so each entry is
  // uniquely identifiable again (per-pipe uniqueness).
  it("re-stamps duplicate id:0 maintenance entries with unique ids", () => {
    const log = [
      { id: 0, date: "2026-01-01", kind: "light", tasks: [], notes: "a" },
      { id: 0, date: "2026-02-02", kind: "full", tasks: [], notes: "b" },
      { id: 0, date: "2026-03-03", kind: "light", tasks: [], notes: "c" },
    ];
    const d = migrateData({ pipes: [{ id: 1, name: "P", brand: "B", maintenance: log as any }], nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    const ids = d.pipes[0].maintenance.map((m: any) => m.id);
    expect(new Set(ids).size).toBe(3);               // all unique
    expect(ids.every((x: number) => x > 0)).toBe(true); // none left at 0
    // Content order + fields preserved.
    expect(d.pipes[0].maintenance.map((m: any) => m.notes)).toEqual(["a", "b", "c"]);
  });

  it("keeps an already-valid unique maintenance id and only fixes the duplicate", () => {
    const log = [
      { id: 1700000000000, date: "2026-01-01", kind: "light", tasks: [], notes: "keep" },
      { id: 1700000000000, date: "2026-02-02", kind: "full", tasks: [], notes: "dup" },
    ];
    const d = migrateData({ pipes: [{ id: 1, name: "P", brand: "B", maintenance: log as any }], nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    const m = d.pipes[0].maintenance;
    expect(m[0].id).toBe(1700000000000);   // first occurrence kept
    expect(m[1].id).not.toBe(m[0].id);      // duplicate re-stamped
    expect(m[1].id).toBeGreaterThan(0);
  });

  it("re-stamps a missing / empty maintenance id", () => {
    const log = [
      { date: "2026-01-01", kind: "light", tasks: [], notes: "noid" },
      { id: "", date: "2026-02-02", kind: "light", tasks: [], notes: "emptyid" },
    ];
    const d = migrateData({ pipes: [{ id: 1, name: "P", brand: "B", maintenance: log as any }], nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 });
    const ids = d.pipes[0].maintenance.map((m: any) => m.id);
    expect(ids.every((x: any) => typeof x === "number" && x > 0)).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });
});

// ── id dedup repair ───────────────────────────────────────────────

describe("migrateData — duplicate LOT id repair", () => {
  const base = { nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 };
  const mkLot = (over: any) => Object.assign({
    status: "cellar", originalStatus: "cellar", weightG: "50", weightInitial: "50",
    dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false,
  }, over);

  it("re-stamps two live lots sharing an id within a tobacco (the earlier corruption)", () => {
    const d = migrateData(Object.assign({}, base, {
      tobaccos: [{ id: 1, name: "N", brand: "B", lots: [
        mkLot({ id: 5, weightG: "50" }),
        mkLot({ id: 5, weightG: "30" }),
      ] }],
    }));
    const ids = d.tobaccos[0].lots.map((l: any) => l.id);
    expect(new Set(ids.map(String)).size).toBe(2);   // unique now
    expect(String(ids[0])).toBe("5");                 // first kept
  });

  it("does not treat the same lot id across DIFFERENT tobaccos as a duplicate", () => {
    const d = migrateData(Object.assign({}, base, {
      tobaccos: [
        { id: 1, name: "A", brand: "B", lots: [mkLot({ id: 9 })] },
        { id: 2, name: "C", brand: "B", lots: [mkLot({ id: 9 })] },
      ],
    }));
    expect(String(d.tobaccos[0].lots[0].id)).toBe("9");
    expect(String(d.tobaccos[1].lots[0].id)).toBe("9");
  });

  it("still back-fills a missing lot id (deterministically, no Date.now)", () => {
    const d = migrateData(Object.assign({}, base, {
      tobaccos: [{ id: 1, name: "N", brand: "B", lots: [mkLot({ id: undefined })] }],
    }));
    const id = d.tobaccos[0].lots[0].id;
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);
  });
});

// ── sub-record uid backfill (lots + maintenance) ─────────────────
describe("migrateData — lot + maintenance uid backfill", () => {
  const base = { nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 };
  it("backfills a stable uid on a uid-less lot", () => {
    const d = migrateData(Object.assign({}, base, {
      tobaccos: [{ id: 1, name: "N", brand: "B", lots: [
        { id: 5, status: "cellar", weightG: "50", weightInitial: "50" },
      ] }],
    }));
    expect(typeof d.tobaccos[0].lots[0].uid).toBe("string");
    expect(d.tobaccos[0].lots[0].uid.length).toBeGreaterThan(0);
  });
  it("backfills a stable uid on a uid-less maintenance entry", () => {
    const d = migrateData(Object.assign({}, base, {
      pipes: [{ id: 1, name: "P", brand: "B", maintenance: [
        { id: 9, date: "2026-01-01", kind: "light", tasks: [], notes: "" },
      ] }],
    }));
    expect(typeof d.pipes[0].maintenance[0].uid).toBe("string");
    expect(d.pipes[0].maintenance[0].uid.length).toBeGreaterThan(0);
  });
  it("is idempotent: a second pass over the SAME migrated object leaves the uids", () => {
    const d1 = migrateData(Object.assign({}, base, {
      tobaccos: [{ id: 1, name: "N", brand: "B", lots: [{ id: 5, status: "cellar", weightG: "50", weightInitial: "50" }] }],
      pipes: [{ id: 1, name: "P", brand: "B", maintenance: [{ id: 9, date: "2026-01-01", kind: "light", tasks: [], notes: "" }] }],
    }));
    const lotUid = d1.tobaccos[0].lots[0].uid;
    const maintUid = d1.pipes[0].maintenance[0].uid;
    const d2 = migrateData(d1); // same object through a second pass
    expect(d2.tobaccos[0].lots[0].uid).toBe(lotUid);
    expect(d2.pipes[0].maintenance[0].uid).toBe(maintUid);
  });
});

describe("migrateData — duplicate TOP-LEVEL id repair", () => {
  const base = { nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 };

  it("re-stamps duplicate session ids (weight-critical, leaf-safe)", () => {
    const d = migrateData(Object.assign({}, base, {
      sessions: [
        { id: 7, date: "2026-01-01", weightG: "2" },
        { id: 7, date: "2026-02-02", weightG: "3" },
      ],
    }));
    const ids = d.sessions.map((s: any) => s.id);
    expect(new Set(ids.map(String)).size).toBe(2);
    expect(String(ids[0])).toBe("7");                // first kept
    expect(d.nxJ).toBeGreaterThan(Math.max(...ids)); // counter advanced past
  });

  it("re-stamps duplicate tobacco ids and keeps the first occurrence", () => {
    const d = migrateData(Object.assign({}, base, {
      tobaccos: [
        { id: 3, name: "Keep", brand: "B", lots: [] },
        { id: 3, name: "Shadow", brand: "B", lots: [] },
      ],
    }));
    const ids = d.tobaccos.map((t: any) => t.id);
    expect(new Set(ids.map(String)).size).toBe(2);
    expect(d.tobaccos.find((t: any) => t.name === "Keep").id).toBe(3);
    expect(d.nxT).toBeGreaterThan(Math.max(...ids));
  });

  it("leaves already-unique ids and the counter untouched (idempotent)", () => {
    const input = Object.assign({}, base, {
      tobaccos: [{ id: 1, name: "A", brand: "B", lots: [] }, { id: 2, name: "C", brand: "B", lots: [] }],
      nxT: 3,
    });
    const d1 = migrateData(input);
    const ids1 = d1.tobaccos.map((t: any) => t.id);
    expect(ids1).toEqual([1, 2]);
    const d2 = migrateData(d1);
    expect(d2.tobaccos.map((t: any) => t.id)).toEqual([1, 2]);
  });
});

// ── idempotence ───────────────────────────────────────────────────────────────

describe("migrateData — idempotence", () => {
  it("applying migrateData twice gives the same result", () => {
    const d = { nxT: 5, nxW: 3, nxP: 7, nxA: 2, nxJ: 10, accessories: [], sessions: [] };
    const once = migrateData(Object.assign({}, d));
    const twice = migrateData(migrateData(Object.assign({}, d)));
    expect(twice).toEqual(once);
  });
});

// defensive string coercion. Old or imported records can
// land with numeric values in fields the schema documents as strings
// (boxNumber, price, weightG, dates, brand, name, …). Any sort path
// that calls .localeCompare crashes when those numeric values slip
// through. migrateData now coerces them to strings at load.

// ── year truncation for pipe / accessory date fields ─────────
//
// Pipes and accessories store purchase / production dates at year granularity
// Only (`YYYY`). Existing data using full ISO strings is
// truncated in place on every load. The rule: extract the leading 4-digit run
// if present; otherwise leave the value untouched (empty, non-numeric, etc).

describe("migrateData — year truncation", () => {
  it("truncates pipe.datePurchased + dateProduction from full ISO to year", () => {
    const out = migrateData({
      pipes: [
        { id: 1, datePurchased: "2024-03-12", dateProduction: "2017-09-01" },
      ],
    });
    expect(out.pipes[0].datePurchased).toBe("2024");
    expect(out.pipes[0].dateProduction).toBe("2017");
  });

  it("truncates accessory.datePurchased from full ISO to year", () => {
    const out = migrateData({
      accessories: [
        { id: 1, datePurchased: "2024-01-15" },
      ],
    });
    expect(out.accessories[0].datePurchased).toBe("2024");
  });

  it("leaves already-truncated values untouched (idempotent)", () => {
    const out = migrateData({
      pipes: [{ id: 1, datePurchased: "2024", dateProduction: "2017" }],
      accessories: [{ id: 1, datePurchased: "2024" }],
    });
    expect(out.pipes[0].datePurchased).toBe("2024");
    expect(out.pipes[0].dateProduction).toBe("2017");
    expect(out.accessories[0].datePurchased).toBe("2024");
  });

  it("handles YYYY-MM partial dates (truncates to year)", () => {
    const out = migrateData({
      pipes: [{ id: 1, dateProduction: "2017-09" }],
    });
    expect(out.pipes[0].dateProduction).toBe("2017");
  });

  it("leaves empty strings untouched", () => {
    const out = migrateData({
      pipes: [{ id: 1, datePurchased: "", dateProduction: "" }],
      accessories: [{ id: 1, datePurchased: "" }],
    });
    expect(out.pipes[0].datePurchased).toBe("");
    expect(out.pipes[0].dateProduction).toBe("");
    expect(out.accessories[0].datePurchased).toBe("");
  });

  it("leaves non-numeric strings untouched", () => {
    const out = migrateData({
      pipes: [{ id: 1, datePurchased: "vintage", dateProduction: "early 70s" }],
    });
    expect(out.pipes[0].datePurchased).toBe("vintage");
    expect(out.pipes[0].dateProduction).toBe("early 70s");
  });

  it("does NOT touch tobacco lot dates (lots keep full ISO)", () => {
    const out = migrateData({
      tobaccos: [{
        id: 1, lots: [
          { id: 100, status: "cellar",
            datePurchased: "2024-03-12", dateProduction: "2020-06-15",
            dateOpened: "2024-09-01", dateFinished: "" },
        ],
      }],
    });
    expect(out.tobaccos[0].lots[0].datePurchased).toBe("2024-03-12");
    expect(out.tobaccos[0].lots[0].dateProduction).toBe("2020-06-15");
    expect(out.tobaccos[0].lots[0].dateOpened).toBe("2024-09-01");
  });
});

describe("migrateData — string coercion", () => {
  it("coerces numeric tobacco fields (name, brand, blend, …) to strings", () => {
    const d: any = {
      tobaccos: [
        { id: 1, name: 42 as any, brand: 7 as any, category: "Virginia",
          blend: 99 as any, cut: "Flake", lots: [] },
      ],
      pipes: [], accessories: [], sessions: [], wishlist: [],
      nxT: 2, nxW: 1, nxP: 1, nxA: 1, nxJ: 1,
    };
    migrateData(d);
    const t = d.tobaccos[0];
    expect(t.name).toBe("42");
    expect(t.brand).toBe("7");
    expect(t.blend).toBe("99");
    // Already-string fields unchanged.
    expect(t.category).toBe("Virginia");
    expect(t.cut).toBe("Flake");
  });

  it("coerces numeric lot fields (boxNumber, weightG, price, dates) to strings", () => {
    const d: any = {
      tobaccos: [
        {
          id: 1, name: "T", brand: "B", lots: [
            { id: "L1", status: "cellar", weightG: 50 as any,
              boxNumber: 7 as any, price: 12.5 as any,
              dateOpened: "", dateFinished: "", datePurchased: "",
              originalStatus: "cellar" },
          ],
        },
      ],
      pipes: [], accessories: [], sessions: [], wishlist: [],
      nxT: 2, nxW: 1, nxP: 1, nxA: 1, nxJ: 1,
    };
    migrateData(d);
    const lot = d.tobaccos[0].lots[0];
    expect(lot.boxNumber).toBe("7");
    expect(lot.weightG).toBe("50");
    expect(lot.price).toBe("12.5");
    // String() of a number → never an empty string for non-zero values.
    expect(typeof lot.boxNumber).toBe("string");
    expect(typeof lot.weightG).toBe("string");
  });

  it("coerces numeric pipe fields (length, weight, price, dates)", () => {
    const d: any = {
      tobaccos: [], wishlist: [], accessories: [], sessions: [],
      pipes: [
        { id: 1, name: "P", brand: "B", shape: "Billiard",
          length: 145 as any, weight: 38 as any, price: 220 as any,
          chamberDiameter: 19 as any, chamberDepth: 38 as any,
          status: "active" },
      ],
      nxT: 1, nxW: 1, nxP: 2, nxA: 1, nxJ: 1,
    };
    migrateData(d);
    const p = d.pipes[0];
    expect(p.length).toBe("145");
    expect(p.weight).toBe("38");
    expect(p.price).toBe("220");
    expect(p.chamberDiameter).toBe("19");
    expect(p.chamberDepth).toBe("38");
  });

  it("coerces numeric accessory fields (price, dates)", () => {
    const d: any = {
      tobaccos: [], wishlist: [], pipes: [], sessions: [],
      accessories: [
        { id: 1, name: "A", brand: "B", type: "Briquet",
          price: 35 as any, datePurchased: "", status: "active" },
      ],
      nxT: 1, nxW: 1, nxP: 1, nxA: 2, nxJ: 1,
    };
    migrateData(d);
    expect(d.accessories[0].price).toBe("35");
  });

  it("coerces numeric session fields (duration, weightG)", () => {
    const d: any = {
      tobaccos: [{ id: 1, name: "T", brand: "B", lots: [] }],
      pipes: [], accessories: [], wishlist: [],
      sessions: [
        { id: 1, tobaccoId: 1, pipeId: "", date: "2024-06-01",
          duration: 30 as any, weightG: 3 as any, lotId: "",
          rating: 4, notes: "good" },
      ],
      nxT: 2, nxW: 1, nxP: 1, nxA: 1, nxJ: 2,
    };
    migrateData(d);
    const s = d.sessions[0];
    expect(s.duration).toBe("30");
    expect(s.weightG).toBe("3");
    // Numeric fields that aren't documented as strings stay numeric.
    expect(s.rating).toBe(4);
  });

  it("leaves undefined / null fields untouched", () => {
    const d: any = {
      tobaccos: [
        { id: 1, name: "T", brand: undefined, category: null, lots: [] },
      ],
      pipes: [], accessories: [], sessions: [], wishlist: [],
      nxT: 2, nxW: 1, nxP: 1, nxA: 1, nxJ: 1,
    };
    migrateData(d);
    const t = d.tobaccos[0];
    expect(t.brand).toBeUndefined();
    expect(t.category).toBeNull();
  });

  it("idempotent under repeated migration", () => {
    const d: any = {
      tobaccos: [{ id: 1, name: 7 as any, brand: "B", lots: [
        { id: "L1", status: "cellar", weightG: 50 as any, boxNumber: 3 as any,
          weightInitial: "50", originalStatus: "cellar",
          datePurchased: "", dateOpened: "", dateFinished: "" },
      ] }],
      pipes: [], accessories: [], sessions: [], wishlist: [],
      nxT: 2, nxW: 1, nxP: 1, nxA: 1, nxJ: 1,
    };
    // migrateData mints a RANDOM uid for a uid-less entity, so it is
    // no longer deterministic across two independent copies. The property that
    // matters is idempotency: migrating an ALREADY-migrated object is a no-op
    // (the second pass sees the uid and leaves it untouched).
    const once = migrateData(JSON.parse(JSON.stringify(d)));
    const twice = migrateData(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});

// ── counter reconciliation + payload guards ───────────────────────────────────

describe("bumpCounterPastMaxId", () => {
  it("raises a counter below the max existing id past it", () => {
    expect(bumpCounterPastMaxId(1, [{ id: 5 }, { id: 3 }])).toBe(6);
  });
  it("leaves a counter already past the max untouched", () => {
    expect(bumpCounterPastMaxId(10, [{ id: 5 }, { id: 3 }])).toBe(10);
  });
  it("returns the counter verbatim for a non-array collection", () => {
    expect(bumpCounterPastMaxId(4, undefined)).toBe(4);
    expect(bumpCounterPastMaxId(4, null)).toBe(4);
  });
  it("ignores rows with non-numeric / missing ids", () => {
    expect(bumpCounterPastMaxId(1, [{ id: "abc" }, {}, null, { id: 2 }])).toBe(3);
  });
});

describe("migrateData — counter reconciliation past existing ids", () => {
  it("bumps nxT/nxW/nxP/nxA/nxJ past the max id when the counter drifted low", () => {
    const d = migrateData({
      tobaccos: [{ id: 1 }, { id: 9 }],
      wishlist: [{ id: 4 }],
      pipes: [{ id: 12 }],
      accessories: [{ id: 2 }],
      sessions: [{ id: 30 }],
      // Every counter is stale (≤ some existing id).
      nxT: 2, nxW: 1, nxP: 5, nxA: 1, nxJ: 3,
    });
    expect(d.nxT).toBe(10); // past id 9
    expect(d.nxW).toBe(5);  // past id 4
    expect(d.nxP).toBe(13); // past id 12
    expect(d.nxA).toBe(3);  // past id 2
    expect(d.nxJ).toBe(31); // past id 30
  });

  it("does not lower a counter already ahead of the ids", () => {
    const d = migrateData({ tobaccos: [{ id: 2 }], nxT: 50 });
    expect(d.nxT).toBe(50);
  });
});

describe("migrateData — non-object payload guard", () => {
  it("degrades a bare number/string/array to an empty cellar instead of throwing", () => {
    expect(() => migrateData(5 as any)).not.toThrow();
    expect(() => migrateData("nope" as any)).not.toThrow();
    expect(() => migrateData([1, 2, 3] as any)).not.toThrow();
    const d = migrateData(5 as any);
    expect(Array.isArray(d.accessories)).toBe(true);
    expect(Array.isArray(d.sessions)).toBe(true);
    expect(d.nxT).toBe(1);
  });
});

describe("migrateData — back-filled lot ids clear existing ids", () => {
  it("seeds the lot-id counter past a near-future forged lot id so no duplicate is minted", () => {
    const future = Date.now() + 5000;
    const d = migrateData({
      tobaccos: [{ id: 1, lots: [
        { id: future, weightG: "20", weightInitial: "20", status: "cellar", originalStatus: "cellar" },
        { /* missing id → back-filled */ weightG: "10", weightInitial: "10", status: "cellar", originalStatus: "cellar" },
      ] }],
    });
    const ids = d.tobaccos[0].lots.map((l: any) => l.id);
    // Two distinct ids, and the back-filled one is strictly above the forged one.
    expect(new Set(ids).size).toBe(2);
    const backfilled = ids.find((x: any) => x !== future);
    expect(backfilled).toBeGreaterThan(future);
  });
});

describe("migrateData — external-URL image guard-rail", () => {
  it("clears an external http(s) imageUrl on entities (import/restore guard)", () => {
    const d = migrateData({
      tobaccos: [{ id: 1, name: "A", imageUrl: "https://ex.com/a.jpg" }],
      pipes: [{ id: 2, name: "P", imageUrl: "http://ex.com/p.png" }],
      accessories: [{ id: 3, name: "Acc", imageUrl: "https://ex.com/x.gif" }],
      wishlist: [{ id: 4, name: "W", imageUrl: "https://ex.com/w.webp" }],
    });
    expect(d.tobaccos[0].imageUrl).toBe("");
    expect(d.pipes[0].imageUrl).toBe("");
    expect(d.accessories[0].imageUrl).toBe("");
    expect(d.wishlist[0].imageUrl).toBe("");
  });

  it("leaves local-photo keys, data URLs and empty values untouched", () => {
    const d = migrateData({
      tobaccos: [
        { id: 1, name: "A", imageUrl: "local-photo-123-abc" },
        { id: 2, name: "B", imageUrl: "data:image/jpeg;base64,QQ==" },
        { id: 3, name: "C", imageUrl: "" },
      ],
    });
    expect(d.tobaccos[0].imageUrl).toBe("local-photo-123-abc");
    expect(d.tobaccos[1].imageUrl).toBe("data:image/jpeg;base64,QQ==");
    expect(d.tobaccos[2].imageUrl).toBe("");
  });

  it("also clears external URLs on frozen session snapshots", () => {
    const d = migrateData({
      sessions: [{
        id: 9, date: "2025-01-01",
        tobaccoSnapshot: { brand: "X", name: "Y", imageUrl: "https://ex.com/s.jpg" },
        pipeSnapshot: { brand: "P", name: "Q", imageUrl: "local-photo-9" },
      }],
    });
    expect(d.sessions[0].tobaccoSnapshot.imageUrl).toBe("");
    expect(d.sessions[0].pipeSnapshot.imageUrl).toBe("local-photo-9");
  });
});

// ── stable cross-device uid backfill (Tier 2) ──────────────────────
describe("migrateData — uid backfill", () => {
  it("stamps a uid on every top-level entity that lacks one", () => {
    const d = migrateData({
      tobaccos: [{ id: 1, brand: "A", name: "B", lots: [] }],
      pipes: [{ id: 1, brand: "P", name: "Q" }],
      accessories: [{ id: 1, name: "Z" }],
      wishlist: [{ id: 1, name: "W" }],
      sessions: [{ id: 1, tobaccoId: 1, pipeId: 1, date: "2026-01-01", duration: "10" }],
    });
    expect(typeof d.tobaccos[0].uid).toBe("string");
    expect(d.tobaccos[0].uid.length).toBeGreaterThan(0);
    expect(typeof d.pipes[0].uid).toBe("string");
    expect(typeof d.accessories[0].uid).toBe("string");
    expect(typeof d.wishlist[0].uid).toBe("string");
  });

  it("does NOT backfill sessions (they stay uid-less and dedup by sessKey)", () => {
    const d = migrateData({
      tobaccos: [], pipes: [], accessories: [], wishlist: [],
      sessions: [{ id: 1, tobaccoId: 1, pipeId: 1, date: "2026-01-01", duration: "10" }],
    });
    expect(d.sessions[0].uid).toBeUndefined();
  });

  it("preserves an existing uid (idempotent, never re-mints)", () => {
    const d = migrateData({
      tobaccos: [{ id: 1, uid: "FIXED-UID", brand: "A", name: "B", lots: [] }],
      pipes: [], accessories: [], wishlist: [], sessions: [],
    });
    expect(d.tobaccos[0].uid).toBe("FIXED-UID");
  });

  it("gives distinct uids to two same-name blends (so the merge keeps them apart)", () => {
    const d = migrateData({
      tobaccos: [
        { id: 1, brand: "Brackwater", name: "Duskfall", lots: [] },
        { id: 2, brand: "Brackwater", name: "Duskfall", lots: [] },
      ],
      pipes: [], accessories: [], wishlist: [], sessions: [],
    });
    expect(d.tobaccos[0].uid).not.toBe(d.tobaccos[1].uid);
  });
});
