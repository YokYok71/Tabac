import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  findById,
  entityLabel,
  sessionEntityLabel,
  entitySnapshot,
  compareByBrandName,
  distinctSortedBrands,
  isWithinDays,
  lotPickerLabel,
  readDefaultGrouped,
  toggleCollapseKey,
} from "../utils.ts";
import { isTrashed, stripDeleted, isPlausibleBackup, safeWeight } from "../utils.ts";
import {
  isUsableLot,
  tobaccoHasUsableLot,
  heldWeight,
  compareLotForPicker,
  lotWillClose,
} from "../utils/lotUtils.ts";
import { topPairings } from "../utils/stats.ts";
import { lsGet, lsSet, lsRemove } from "../utils/appStorage.ts";
import { captureGeoLocation } from "../utils/geo.ts";
import { matchEnum } from "../hooks/useAiAutoFill.ts";
import { findDuplicateEntry } from "../hooks/useImportConfirm.ts";

// ── isUsableLot / tobaccoHasUsableLot (SessionForm ≡ Tasting) ──
describe("isUsableLot", () => {
  it("accepts jar / cellar lots with positive weight", () => {
    expect(isUsableLot({ status: "jar", weightG: "10" })).toBe(true);
    expect(isUsableLot({ status: "cellar", weightG: "50" })).toBe(true);
  });
  it("rejects finished lots even with weight", () => {
    expect(isUsableLot({ status: "finished", weightG: "10" })).toBe(false);
  });
  it("rejects a lot weighed at ZERO — an empty tin", () => {
    expect(isUsableLot({ status: "jar", weightG: "0" })).toBe(false);
  });

  // REVERSED. This case used to assert that an EMPTY weight
  // was rejected too, and that was the defect: a jar the user opened and
  // never weighed vanished from the session picker, so the app refused to log
  // a bowl from a tin sitting open on the desk. Reported from the app.
  //
  // A blank weight is an ABSENCE of data, not a zero — the distinction
  // `checkLotInvariants` has drawn, which was the only place
  // that had it. The zero case above stays: that one really is an empty tin,
  // and it auto-finishes anyway.
  it("ACCEPTS a lot the user never weighed — absence is not zero", () => {
    expect(isUsableLot({ status: "jar", weightG: "" })).toBe(true);
    expect(isUsableLot({ status: "cellar", weightG: "" })).toBe(true);
  });
  it("rejects a forged Infinity weight (safeW hardening)", () => {
    expect(isUsableLot({ status: "jar", weightG: "Infinity" })).toBe(false);
  });
  it("rejects soft-deleted lots", () => {
    expect(isUsableLot({ status: "jar", weightG: "10", deletedAt: "2020" })).toBe(false);
  });
  it("handles null", () => {
    expect(isUsableLot(null)).toBe(false);
  });
});

describe("tobaccoHasUsableLot", () => {
  it("true when any lot is usable", () => {
    expect(tobaccoHasUsableLot({ lots: [{ status: "finished", weightG: "5" }, { status: "jar", weightG: "3" }] })).toBe(true);
  });
  it("false when all lots finished", () => {
    expect(tobaccoHasUsableLot({ lots: [{ status: "finished", weightG: "5" }] })).toBe(false);
  });
  it("false for no lots / null", () => {
    expect(tobaccoHasUsableLot({ lots: [] })).toBe(false);
    expect(tobaccoHasUsableLot(null)).toBe(false);
  });
});

// ── heldWeight ──
describe("heldWeight", () => {
  it("sums non-finished lots only", () => {
    expect(heldWeight({ lots: [
      { status: "jar", weightG: "10" },
      { status: "cellar", weightG: "50" },
      { status: "finished", weightG: "99" },
    ] })).toBe(60);
  });
  it("excludes soft-deleted lots and coerces Infinity to 0", () => {
    expect(heldWeight({ lots: [
      { status: "jar", weightG: "10" },
      { status: "jar", weightG: "5", deletedAt: "x" },
      { status: "jar", weightG: "Infinity" },
    ] })).toBe(10);
  });
  it("returns 0 for null / no lots", () => {
    expect(heldWeight(null)).toBe(0);
    expect(heldWeight({ lots: [] })).toBe(0);
  });
});

// ── compareLotForPicker ──
describe("compareLotForPicker", () => {
  it("orders jar before cellar", () => {
    expect(compareLotForPicker({ status: "cellar" }, { status: "jar" })).toBe(1);
    expect(compareLotForPicker({ status: "jar" }, { status: "cellar" })).toBe(-1);
  });
  it("orders jars by ascending dateOpened", () => {
    const r = compareLotForPicker(
      { status: "jar", dateOpened: "2024-01-01" },
      { status: "jar", dateOpened: "2024-06-01" },
    );
    expect(r).toBeLessThan(0);
  });
  it("orders cellars by numeric boxNumber", () => {
    expect(compareLotForPicker(
      { status: "cellar", boxNumber: "2" },
      { status: "cellar", boxNumber: "10" },
    )).toBe(-8);
  });
  it("survives a numeric boxNumber without crashing", () => {
    expect(() => compareLotForPicker(
      { status: "cellar", boxNumber: 3 as any },
      { status: "cellar", boxNumber: "A" },
    )).not.toThrow();
  });
});

// ── lotWillClose ──
describe("lotWillClose", () => {
  it("true when the session drains the lot to <= 0", () => {
    expect(lotWillClose({ status: "jar", weightG: "3" }, 3)).toBe(true);
    expect(lotWillClose({ status: "jar", weightG: "3" }, 5)).toBe(true);
  });
  it("false when a balance remains", () => {
    expect(lotWillClose({ status: "jar", weightG: "10" }, 3)).toBe(false);
  });
  it("adds the restored weight back on an edit", () => {
    // lot 2g + restore 5g − 6g session = 1g left → won't close
    expect(lotWillClose({ status: "jar", weightG: "2" }, 6, 5)).toBe(false);
  });
  it("false for finished lots, zero weight, or null", () => {
    expect(lotWillClose({ status: "finished", weightG: "0" }, 3)).toBe(false);
    expect(lotWillClose({ status: "jar", weightG: "3" }, 0)).toBe(false);
    expect(lotWillClose(null, 3)).toBe(false);
  });
});

// ── lsGet / lsSet / lsRemove (sync localStorage wrapper) ──
describe("lsGet / lsSet / lsRemove", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips a value", () => {
    expect(lsSet("k", "v")).toBe(true);
    expect(lsGet("k")).toBe("v");
  });
  it("returns the fallback on a miss (default null)", () => {
    expect(lsGet("absent")).toBeNull();
    expect(lsGet("absent", "def")).toBe("def");
  });
  it("preserves an explicitly stored empty string (not the fallback)", () => {
    lsSet("empty", "");
    expect(lsGet("empty", "def")).toBe("");
  });
  it("lsRemove deletes the key", () => {
    lsSet("k", "v");
    lsRemove("k");
    expect(lsGet("k")).toBeNull();
  });
});

// ── safeWeight (single-sourced Infinity-hardened coercion) ──
describe("safeWeight", () => {
  it("parses numeric strings and numbers", () => {
    expect(safeWeight("10")).toBe(10);
    expect(safeWeight(2.5)).toBe(2.5);
    expect(safeWeight("3.14")).toBe(3.14);
  });
  it("returns 0 for Infinity / NaN / negatives / junk", () => {
    expect(safeWeight("Infinity")).toBe(0);
    expect(safeWeight(Infinity)).toBe(0);
    expect(safeWeight(-1)).toBe(0);
    expect(safeWeight("-5")).toBe(0);
    expect(safeWeight(NaN)).toBe(0);
    expect(safeWeight(null)).toBe(0);
    expect(safeWeight(undefined)).toBe(0);
    expect(safeWeight("abc")).toBe(0);
    expect(safeWeight({})).toBe(0);
  });
});

// ── isPlausibleBackup (import/restore front door) ──
describe("isPlausibleBackup", () => {
  it("accepts an object carrying a tobaccos array (even empty)", () => {
    expect(isPlausibleBackup({ tobaccos: [] })).toBe(true);
    expect(isPlausibleBackup({ tobaccos: [{ id: 1 }] })).toBe(true);
    expect(isPlausibleBackup({ tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] })).toBe(true);
  });
  it("rejects non-backups: null, primitives, arrays, empty object, {error}", () => {
    expect(isPlausibleBackup(null)).toBe(false);
    expect(isPlausibleBackup(undefined)).toBe(false);
    expect(isPlausibleBackup(42)).toBe(false);
    expect(isPlausibleBackup("nope")).toBe(false);
    expect(isPlausibleBackup([])).toBe(false);
    expect(isPlausibleBackup({})).toBe(false);
    expect(isPlausibleBackup({ error: "quota" })).toBe(false);
  });
  it("rejects a truthy-but-non-array tobaccos (forged)", () => {
    expect(isPlausibleBackup({ tobaccos: "hax" })).toBe(false);
  });
  it("rejects a foreign/partial file lacking tobaccos", () => {
    // Would have reached the interactive Replace picker under the earlier
    // "any of the five collections" form and could wipe the inventory.
    expect(isPlausibleBackup({ sessions: [{ id: 1 }] })).toBe(false);
    expect(isPlausibleBackup({ pipes: [{ id: 1 }] })).toBe(false);
  });
});

// ── isTrashed / stripDeleted (soft-delete boundary) ──
describe("isTrashed / stripDeleted", () => {
  it("isTrashed: true only with a deletedAt stamp", () => {
    expect(isTrashed({ deletedAt: "2020" })).toBe(true);
    expect(isTrashed({})).toBe(false);
    expect(isTrashed(null)).toBe(false);
  });
  it("stripDeleted keeps live rows (and null slots), drops trashed", () => {
    expect(stripDeleted([{ id: 1 }, { id: 2, deletedAt: "x" }, { id: 3 }]))
      .toEqual([{ id: 1 }, { id: 3 }]);
  });
  it("stripDeleted returns [] for non-arrays", () => {
    expect(stripDeleted(null)).toEqual([]);
    expect(stripDeleted(undefined)).toEqual([]);
  });
});

// ── captureGeoLocation (SessionForm ≡ Tasting geo flow) ──
describe("captureGeoLocation", () => {
  const realNav = globalThis.navigator;
  afterEach(() => {
    try { Object.defineProperty(globalThis, "navigator", { value: realNav, configurable: true }); } catch { /* noop */ }
  });
  function stubGeo(impl: any) {
    Object.defineProperty(globalThis, "navigator", {
      value: { geolocation: { getCurrentPosition: impl } },
      configurable: true,
    });
  }
  it("errors when geolocation is unavailable", () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    const status: string[] = []; let err = "x";
    captureGeoLocation({ onStatus: (s) => status.push(s), onError: (m) => { err = m; }, onCoords: () => true });
    expect(status).toContain("error");
    expect(err).toBeTruthy();
  });
  it("persists coords + goes idle on a valid position", () => {
    stubGeo((ok: any) => ok({ coords: { latitude: 48.85, longitude: 2.35 } }));
    const status: string[] = []; let got: any = null;
    captureGeoLocation({
      onStatus: (s) => status.push(s),
      onError: () => {},
      onCoords: (lat, lng) => { got = { lat, lng }; return true; },
    });
    expect(got).toEqual({ lat: 48.85, lng: 2.35 });
    expect(status).toEqual(["loading", "idle"]);
  });
  it("falls to the error branch when onCoords returns false", () => {
    stubGeo((ok: any) => ok({ coords: { latitude: 48.85, longitude: 2.35 } }));
    const status: string[] = [];
    captureGeoLocation({ onStatus: (s) => status.push(s), onError: () => {}, onCoords: () => false });
    expect(status).toContain("error");
  });
  it("maps a permission-denied error (code 1)", () => {
    stubGeo((_ok: any, fail: any) => fail({ code: 1 }));
    let err = ""; const status: string[] = [];
    captureGeoLocation({ onStatus: (s) => status.push(s), onError: (m) => { err = m; }, onCoords: () => true });
    expect(status).toContain("error");
    expect(err).toMatch(/refus|denied|autoris/i);
  });
});

// ── findById ──
describe("findById", () => {
  const arr = [{ id: 1, v: "a" }, { id: "2", v: "b" }];
  it("matches with string coercion (number vs string)", () => {
    expect(findById(arr, "1")).toEqual({ id: 1, v: "a" });
    expect(findById(arr, 2)).toEqual({ id: "2", v: "b" });
  });
  it("returns undefined when not found or non-array", () => {
    expect(findById(arr, 9)).toBeUndefined();
    expect(findById(null, 1)).toBeUndefined();
    expect(findById(undefined, 1)).toBeUndefined();
  });
});

// ── entityLabel / sessionEntityLabel / entitySnapshot ──
describe("entityLabel", () => {
  it("joins brand — name", () => {
    expect(entityLabel({ brand: "Brackwater", name: "Duskfall" })).toBe("Brackwater — Duskfall");
  });
  it("drops empty parts and falls back to the dash", () => {
    expect(entityLabel({ brand: "", name: "X" })).toBe("X");
    expect(entityLabel({ brand: "", name: "" })).toBe("—");
    expect(entityLabel({ brand: "", name: "" }, "")).toBe("");
    expect(entityLabel(null)).toBe("—");
  });
});

describe("sessionEntityLabel", () => {
  it("prefers the live entity", () => {
    expect(sessionEntityLabel({ brand: "A", name: "B" }, { brand: "S", name: "T" })).toBe("A — B");
  });
  it("falls back to the snapshot when the entity is gone", () => {
    expect(sessionEntityLabel(null, { brand: "S", name: "T" })).toBe("S — T");
  });
  it("uses the dash when neither present", () => {
    expect(sessionEntityLabel(null, null)).toBe("—");
    expect(sessionEntityLabel(null, null, "")).toBe("");
  });
});

describe("entitySnapshot", () => {
  it("captures brand/name/imageUrl with empty-string fallbacks", () => {
    expect(entitySnapshot({ brand: "A", name: "B", imageUrl: "k", extra: 1 })).toEqual({ brand: "A", name: "B", imageUrl: "k" });
    expect(entitySnapshot({})).toEqual({ brand: "", name: "", imageUrl: "" });
    expect(entitySnapshot(null)).toEqual({ brand: "", name: "", imageUrl: "" });
  });
});

// ── compareByBrandName / distinctSortedBrands ──
describe("compareByBrandName", () => {
  it("sorts case-insensitively by brand then name", () => {
    const arr = [
      { brand: "beta", name: "z" },
      { brand: "Alpha", name: "b" },
      { brand: "Alpha", name: "a" },
    ];
    expect(arr.slice().sort(compareByBrandName).map((x) => x.name)).toEqual(["a", "b", "z"]);
  });
  // hardened against non-string brand/name (the crash
  // class — a truthy numeric field survives `x.brand || ""` and used to hit
  // `.toLowerCase is not a function`). String() coercion keeps it sortable.
  it("does not crash on a non-string brand/name slipping in from imported data", () => {
    const arr: any[] = [
      { brand: 12, name: "num" },
      { brand: "Alpha", name: "a" },
      { brand: null, name: "nul" },
    ];
    expect(() => arr.slice().sort(compareByBrandName)).not.toThrow();
    // "12" < "Alpha" (case-insensitively), "" (null) sorts first.
    expect(arr.slice().sort(compareByBrandName).map((x) => x.name)).toEqual(["nul", "num", "a"]);
  });
});

describe("distinctSortedBrands", () => {
  it("returns distinct non-empty brands sorted case-insensitively", () => {
    expect(distinctSortedBrands([
      { brand: "Zed" }, { brand: "alpha" }, { brand: "Zed" }, { brand: "" }, {},
    ])).toEqual(["alpha", "Zed"]);
  });
  it("handles null", () => {
    expect(distinctSortedBrands(null)).toEqual([]);
  });
});

// ── isWithinDays ──
describe("isWithinDays", () => {
  it("true for a recent timestamp, false past the window", () => {
    expect(isWithinDays(Date.now() - 2 * 86400000, 7)).toBe(true);
    expect(isWithinDays(Date.now() - 10 * 86400000, 7)).toBe(false);
  });
  it("false for 0 / negative", () => {
    expect(isWithinDays(0, 7)).toBe(false);
    expect(isWithinDays(-1, 7)).toBe(false);
  });
  // A FUTURE stamp used to read as "still within the window", for ever:
  // `Date.now() - future` is NEGATIVE, and negative < days*DAY. A device
  // whose clock was ahead when the value was written therefore kept the
  // storage-full warning (7-day dismissal) and the "you have not backed up
  // in 30 days" reminder suppressed until wall-clock caught up — silently.
  // `EB.getDerivedStateFromError` already carries exactly this guard
  // (`last <= Date.now()`) for exactly this reason; this was the site missed.
  it("false for a FUTURE timestamp (clock skew must not suppress a warning)", () => {
    expect(isWithinDays(Date.now() + 86400000, 7)).toBe(false);
    expect(isWithinDays(Date.now() + 365 * 86400000, 30)).toBe(false);
  });
  // Non-vacuity for that guard: "now" and the ordinary recent past must
  // still read as within, so the fix cannot be a blanket refusal.
  it("still true at now and just-in-the-past (the guard is not a blanket refusal)", () => {
    expect(isWithinDays(Date.now(), 7)).toBe(true);
    expect(isWithinDays(Date.now() - 1000, 7)).toBe(true);
  });
});

// ── toggleCollapseKey ──
describe("toggleCollapseKey", () => {
  it("absent → expanded (false), false → collapsed (removed)", () => {
    expect(toggleCollapseKey({}, "A")).toEqual({ A: false });
    expect(toggleCollapseKey({ A: false }, "A")).toEqual({});
  });
  it("does not mutate the input", () => {
    const prev = { A: false };
    toggleCollapseKey(prev, "B");
    expect(prev).toEqual({ A: false });
  });
  // A group whose KEY is a prototype member ("__proto__") must be
  // toggleable — on a plain object `n["__proto__"] = false` sets [[Prototype]]
  // (ignored for a non-object) instead of an own property, so the expand was a
  // silent no-op. The null-proto map makes it a normal own key.
  it("toggles a prototype-named key ('__proto__')", () => {
    const expanded = toggleCollapseKey({}, "__proto__");
    expect(expanded["__proto__"]).toBe(false);          // expanded, real own key
    const collapsed = toggleCollapseKey(expanded, "__proto__");
    expect("__proto__" in collapsed).toBe(false);        // back to collapsed default
  });
  it("toggles a 'constructor'-named key", () => {
    const expanded = toggleCollapseKey({}, "constructor");
    expect(expanded["constructor"]).toBe(false);
    expect(toggleCollapseKey(expanded, "constructor")["constructor"]).toBeUndefined();
  });
});

// ── readDefaultGrouped ──
describe("readDefaultGrouped", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to grouped (true) when unset", () => {
    expect(readDefaultGrouped()).toBe(true);
  });
  it("false only when explicitly '0'", () => {
    localStorage.setItem("cave-default-grouped", "0");
    expect(readDefaultGrouped()).toBe(false);
    localStorage.setItem("cave-default-grouped", "1");
    expect(readDefaultGrouped()).toBe(true);
  });
});

// ── lotPickerLabel ──
describe("lotPickerLabel", () => {
  const opts = { lang: "fr", weightUnit: "g", dateFormat: "fr" };
  it("labels a jar lot with weight + opened date + box", () => {
    const s = lotPickerLabel({ status: "jar", weightG: "12", dateOpened: "2024-03-04", boxNumber: "7" }, opts);
    expect(s).toContain("Pot · 12g");
    expect(s).toContain("n°7");
  });
  it("labels a cellar lot", () => {
    expect(lotPickerLabel({ status: "cellar", weightG: "50" }, opts)).toContain("Cave · 50g");
  });
});

// ── topPairings ──
describe("topPairings", () => {
  const sessions = [
    { tobaccoId: 1, pipeId: 10 },
    { tobaccoId: 1, pipeId: 10 },
    { tobaccoId: 1, pipeId: 20 },
    { tobaccoId: 2, pipeId: 30 },
  ];
  const pipes = [{ id: 10, name: "P10" }, { id: 20, name: "P20" }];
  it("counts + ranks + resolves, dropping unresolved", () => {
    const r = topPairings(sessions, "tobaccoId", 1, "pipeId", (id) => pipes.find((p) => String(p.id) === id));
    expect(r).toEqual([
      { entity: { id: 10, name: "P10" }, n: 2 },
      { entity: { id: 20, name: "P20" }, n: 1 },
    ]);
    // pipe 30 belongs to tobacco 2 → not counted here
  });
  it("respects the limit", () => {
    const r = topPairings(sessions, "tobaccoId", 1, "pipeId", (id) => pipes.find((p) => String(p.id) === id), 1);
    expect(r).toHaveLength(1);
  });
});

// ── matchEnum (normCat/normCut/normShape unification) ──
describe("matchEnum", () => {
  const CUTS = ["Flake", "Ribbon", "Ready Rubbed", "Autre"];
  it("returns an exact enum member unchanged", () => {
    expect(matchEnum("Flake", CUTS)).toBe("Flake");
  });
  it("resolves via the alias table", () => {
    expect(matchEnum("Long Cut", CUTS, { "Long Cut": "Ribbon" })).toBe("Ribbon");
  });
  it("resolves a case-insensitive substring (normCut equivalence)", () => {
    expect(matchEnum("broken flake", CUTS)).toBe("Flake");
  });
  it("never returns Autre from the fuzzy pass, and empty on no match", () => {
    expect(matchEnum("zzz", CUTS)).toBe("");
    expect(matchEnum("", CUTS)).toBe("");
  });
});

// ── findDuplicateEntry (literal path — DB cache not loaded in this test) ──
describe("findDuplicateEntry", () => {
  const list = [
    { id: 1, brand: "Brackwater", name: "Duskfall" },
    { id: 2, brand: "Halvorsen", name: "Irish", deletedAt: "x" },
  ];
  it("matches case/whitespace-insensitively on brand+name", () => {
    expect(findDuplicateEntry(list, " brackwater ", "DUSKFALL")).toEqual(list[0]);
  });
  it("skips trashed rows", () => {
    expect(findDuplicateEntry(list, "Halvorsen", "Irish")).toBeNull();
  });
  it("skips the excluded (edited) id", () => {
    expect(findDuplicateEntry(list, "Brackwater", "Duskfall", { excludeId: 1 })).toBeNull();
  });
  it("returns null for empty brand or name", () => {
    expect(findDuplicateEntry(list, "", "Duskfall")).toBeNull();
    expect(findDuplicateEntry(list, "Brackwater", "")).toBeNull();
  });
});
