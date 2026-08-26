import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  today,
  parseLocalDate,
  daysSince,
  fmtDate,
  fmtDateTime,
  fmtNum,
  initDateFormat,
  lotAge,
  fmtLotAge,
  oldestAge,
  countByStatus,
  countActive,
  hasActive,
  pipeIsActive,
  accIsActive,
  migrateData,
  computeStats,
  parseAgingMax,
  lotAgingStatus,
  effectiveAgingMax,
  FAMILY_AGING_MAX,
  plural,
  detectUiLang,
  newPhotoSuffix,
  newUid,
  latestSessionMonthSeed,
  latestEditMs,
  monotonicId,
  _resetMonotonicIdForTests,
  nextBoxNumber,
  dedupeIds,
  getStorageBlockedHint,
  nowTime,
} from "../utils";
import * as U from "../utils";
import { sessionStartMs } from "../utils/rotation";
import type { Tobacco, Lot, Pipe, Accessory } from "../types";
import { LANGUAGES } from "../i18n/languages";
import { readFileSync } from "node:fs";

// ── plural ────────────────────────────────────────────────────
describe("plural", () => {
  it("uses the singular only for exactly 1 in en/es/de/it", () => {
    expect(plural(1, "lot", "lots", "en")).toBe("lot");
    expect(plural(2, "lot", "lots", "en")).toBe("lots");
    expect(plural(0, "lot", "lots", "en")).toBe("lots"); // English: 0 → plural
    expect(plural(2, "lotto", "lotti", "it")).toBe("lotti");
  });
  it("treats 0 AND 1 as singular in French", () => {
    expect(plural(0, "pot", "pots", "fr")).toBe("pot"); // French: 0 → singular
    expect(plural(1, "pot", "pots", "fr")).toBe("pot");
    expect(plural(2, "pot", "pots", "fr")).toBe("pots");
  });
  it("defaults to the non-French rule when lang is omitted", () => {
    expect(plural(0, "a", "b")).toBe("b");
    expect(plural(1, "a", "b")).toBe("a");
  });
});

// ── latestEditMs ──────────────────────────────────────────────────
describe("latestEditMs", () => {
  it("returns the max updatedAt (ms) across all collections", () => {
    const data = {
      tobaccos: [{ id: 1, updatedAt: "2026-01-01T00:00:00.000Z" }],
      pipes: [{ id: 1, updatedAt: "2026-06-15T12:00:00.000Z" }],
      accessories: [{ id: 1 }], // no stamp
      wishlist: [],
      sessions: [{ id: 1, updatedAt: "2026-03-01T00:00:00.000Z" }],
    };
    expect(latestEditMs(data)).toBe(Date.parse("2026-06-15T12:00:00.000Z"));
  });
  it("returns 0 when nothing carries a stamp (legacy data)", () => {
    expect(latestEditMs({ tobaccos: [{ id: 1 }], pipes: [], accessories: [], wishlist: [], sessions: [] })).toBe(0);
    expect(latestEditMs(null)).toBe(0);
    expect(latestEditMs({})).toBe(0);
  });
  it("ignores unparseable timestamps", () => {
    expect(latestEditMs({ sessions: [{ id: 1, updatedAt: "not-a-date" }] })).toBe(0);
  });
});

// ── latestSessionMonthSeed ───────────────────────────────────
describe("latestSessionMonthSeed", () => {
  it("expands the month of the MOST RECENT session (y:/m: key format)", () => {
    const seed = latestSessionMonthSeed([
      { date: "2026-05-10" }, { date: "2026-07-02" }, { date: "2026-06-30" },
    ]);
    expect(seed).toEqual({ "y:2026": false, "m:2026-07": false });
  });
  it("returns {} when there are no sessions", () => {
    expect(latestSessionMonthSeed([])).toEqual({});
    expect(latestSessionMonthSeed(null)).toEqual({});
  });
  it("skips soft-deleted and dateless sessions", () => {
    const seed = latestSessionMonthSeed([
      { date: "2026-08-01", deletedAt: "x" }, // trashed → ignored
      { date: "" },                            // dateless → ignored
      { date: "2026-03-15" },
    ]);
    expect(seed).toEqual({ "y:2026": false, "m:2026-03": false });
  });
});

// ── newPhotoSuffix ────────────────────────────────────────────────────────────
describe("newPhotoSuffix", () => {
  it("returns a non-empty alphanumeric string", () => {
    const s = newPhotoSuffix();
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    expect(/^[a-z0-9-]+$/i.test(s)).toBe(true);
  });

  it("produces distinct values across rapid calls (collision guard)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(newPhotoSuffix());
    // Even the base36 fallback (Math.random) should not collide over 200 draws.
    expect(seen.size).toBeGreaterThan(190);
  });

  it("keeps the key's leading Date.now() digits matchable by the gcOrphans age guard", () => {
    // The photo key is `local-photo-<Date.now()>-<suffix>`; gcOrphans extracts
    // the timestamp with /^local-photo-(\d+)/. The suffix must not break that.
    const key = "local-photo-1700000000-" + newPhotoSuffix();
    const m = key.match(/^local-photo-(\d+)/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("1700000000");
  });

  it("falls back to a base36 string when crypto.randomUUID is unavailable", () => {
    try {
      // Simulate an environment without Web Crypto's randomUUID.
      vi.stubGlobal("crypto", {});
      const s = newPhotoSuffix();
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
      expect(/^[a-z0-9]+$/.test(s)).toBe(true); // base36 only
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── newUid (Tier 2 cross-device merge identity) ───────────────────
describe("newUid", () => {
  it("returns a non-empty string", () => {
    const u = newUid();
    expect(typeof u).toBe("string");
    expect(u.length).toBeGreaterThan(0);
  });

  it("produces distinct values across rapid calls (collision guard)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(newUid());
    expect(seen.size).toBe(500);
  });

  it("falls back to a base36 token when crypto.randomUUID is unavailable", () => {
    try {
      vi.stubGlobal("crypto", {});
      const u = newUid();
      expect(typeof u).toBe("string");
      expect(u.startsWith("u-")).toBe(true);
      // Two fallback draws still differ.
      expect(newUid()).not.toBe(u);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


// ── detectUiLang ──────────────────────────────────────────────
describe("detectUiLang", () => {
  const SUPPORTED = LANGUAGES.map((l) => l.code);   // derived, never copied
  it("matches on the primary subtag (fr-FR → fr, en-US → en)", () => {
    expect(detectUiLang(["fr-FR"], SUPPORTED)).toBe("fr");
    expect(detectUiLang(["en-US"], SUPPORTED)).toBe("en");
    expect(detectUiLang(["de-CH"], SUPPORTED)).toBe("de");
  });
  it("respects preference order, returning the first supported entry", () => {
    // This used "pt-BR" as the unsupported head of the list, and
    // deriving SUPPORTED from the registry made that premise false — Portuguese
    // shipped. "nl" carries the meaning the case is actually about.
    expect(detectUiLang(["nl-NL", "es-ES", "en"], SUPPORTED)).toBe("es");
    expect(detectUiLang(["zh-Hans-CN", "it"], SUPPORTED)).toBe("it");
  });
  it("gives a Brazilian browser the European Portuguese it ships", () => {
    // pt-BR primary-subtag-matches pt, and that is the wanted behaviour: the
    // app has one Portuguese, and pt-PT is far closer to a Brazilian reader
    // than the English fallback. Asserted so the consequence of adding "pt" is
    // recorded rather than discovered.
    expect(detectUiLang(["pt-BR"], SUPPORTED)).toBe("pt");
  });
  it("is case-insensitive", () => {
    expect(detectUiLang(["ES"], SUPPORTED)).toBe("es");
    expect(detectUiLang(["EN-us"], SUPPORTED)).toBe("en");
  });
  it("falls back to English for unsupported or empty input", () => {
    expect(detectUiLang(["nl-NL", "zh"], SUPPORTED)).toBe("en");
    expect(detectUiLang([], SUPPORTED)).toBe("en");
    expect(detectUiLang(undefined, SUPPORTED)).toBe("en");
    expect(detectUiLang([""], SUPPORTED)).toBe("en");
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLot(overrides: Partial<Lot> = {}): Lot {
  return {
    status: "cellar",
    originalStatus: "cellar",
    weightG: "50",
    weightInitial: "50",
    datePurchased: "",
    dateProduction: "",
    dateOpened: "",
    dateFinished: "",
    boxNumber: "",
    price: "",
    seller: "",
    disposed: false,
    ...overrides,
  };
}

function makeTobacco(lots: Lot[]): Tobacco {
  return {
    id: 1,
    name: "Test",
    brand: "Brand",
    category: "Virginia",
    blend: "",
    cut: "",
    force: 0,
    roomNote: 0,
    taste: 0,
    rating: 0,
    rebuy: null,
    tastingNotes: "",
    description: "",
    imageUrl: "",
    agingMax: "",
    lots,
  };
}

function makePipe(status: Pipe["status"] = "active"): Pipe {
  return {
    id: 1, name: "", brand: "", shape: "Billiard", courbure: "",
    length: "", weight: "", filterType: "", chamberDiameter: "",
    chamberDepth: "", bowlMaterial: "", stemMaterial: "", finish: "",
    datePurchased: "", dateProduction: "", price: "", seller: "",
    description: "", notes: "", imageUrl: "", rating: 0, status,
  };
}

function makeAccessory(status: Accessory["status"] = "active"): Accessory {
  return {
    id: 1, name: "", brand: "", type: "Briquet", fuel: "",
    datePurchased: "", price: "", seller: "", imageUrl: "",
    rating: 0, notes: "", status,
  };
}

// fixed "today" date for time-sensitive tests
const FIXED_DATE = "2025-06-15";
const FIXED_TS = new Date(FIXED_DATE).getTime();

// ── today() ───────────────────────────────────────────────────────────────────

describe("today", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the LOCAL calendar date (not UTC)", () => {
    const d = new Date();
    const expected = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
    expect(today()).toBe(expected);
  });
});

// ── nowTime() ─────────────────────────────────────────────────────────────────
//
// It had NO test at all. It exists so a maintenance entry and a session are
// stamped by the SAME clock — two copies of "now" is how the two logs would
// come to disagree, and the reminder counter compares them against each other,
// which is precisely where a disagreement would be invisible AND wrong.

describe("nowTime", () => {
  afterEach(() => vi.useRealTimers());

  it("returns a zero-padded HH:MM", () => {
    // Padding is not cosmetic here: the value is compared as a STRING inside
    // `sessionStartMs` (it is concatenated into an ISO datetime), so "9:05"
    // would not parse and the entry would silently fall back to noon.
    vi.setSystemTime(new Date(2026, 4, 19, 9, 5, 0));
    expect(nowTime()).toBe("09:05");
    vi.setSystemTime(new Date(2026, 4, 19, 23, 59, 0));
    expect(nowTime()).toBe("23:59");
    vi.setSystemTime(new Date(2026, 4, 19, 0, 0, 0));
    expect(nowTime()).toBe("00:00");
  });

  it("uses the LOCAL clock, not UTC", () => {
    // Same rule as `today()` below, and for the same reason: the user logs a
    // cleaning at the time their phone shows. A UTC stamp would put a
    // late-evening entry on the wrong side of a bowl smoked minutes earlier.
    //
    // THE RUNTIME HALF CANNOT DISCRIMINATE HERE, and saying so is the point.
    // PROBED: swapping `getHours` for `getUTCHours` left this case GREEN,
    // because CI runs at offset 0 — `new Date().getTimezoneOffset() === 0` —
    // so the two are the same function. The absorbing layer is the
    // ENVIRONMENT, not a missing assertion, which is why the structural half
    // below exists rather than a cleverer fixture. It is kept anyway: it does
    // discriminate for anyone running the suite outside UTC.
    const d = new Date();
    const expected = String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0");
    expect(nowTime()).toBe(expected);
  });

  it("reads the local getters, asserted at source since UTC hides the difference", () => {
    // The half that survives an offset-0 environment. Both stamps must use the
    // same clock as each other AND as the user's phone; `today()` has carried
    // exactly this blind spot for as long, so both are pinned together.
    const src = readFileSync("src/utils.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
    const body = (name: string) => {
      const i = src.indexOf("export var " + name + " =");
      expect(i, `${name} not found`).toBeGreaterThan(-1);
      return src.slice(i, i + 400);
    };
    expect(body("nowTime")).toMatch(/getHours\(\)/);
    expect(body("nowTime"), "a UTC stamp is not the time on the user's phone").not.toMatch(/getUTC/);
    expect(body("today"), "the two stamps must read the same clock").not.toMatch(/getUTC/);
  });

  it("is accepted by sessionStartMs, which is the only thing it is for", () => {
    // The pair, asserted together: a stamp neither log can order is useless,
    // and the two functions live in different modules.
    vi.setSystemTime(new Date(2026, 4, 19, 14, 35, 0));
    const ms = sessionStartMs({ date: "2026-05-19", time: nowTime() });
    expect(Number.isNaN(ms), "the stamp did not parse").toBe(false);
    const noon = sessionStartMs({ date: "2026-05-19" });
    expect(ms, "an afternoon stamp must sort after the noon fallback").toBeGreaterThan(noon);
  });
});

describe("parseLocalDate", () => {
  it("parses a bare YYYY-MM-DD as LOCAL midnight, not UTC", () => {
    // Local midnight of 2026-07-22, whatever the runner's timezone.
    expect(parseLocalDate("2026-07-22")).toBe(new Date("2026-07-22T00:00:00").getTime());
  });
  it("returns NaN for empty / garbage", () => {
    expect(Number.isNaN(parseLocalDate(""))).toBe(true);
    expect(Number.isNaN(parseLocalDate(null))).toBe(true);
    expect(Number.isNaN(parseLocalDate("not-a-date"))).toBe(true);
  });
  it("parses a string that already carries a time as-is", () => {
    expect(parseLocalDate("2026-07-22T08:30:00")).toBe(new Date("2026-07-22T08:30:00").getTime());
  });
});

// ── daysSince() ───────────────────────────────────────────────────────────────

describe("daysSince", () => {
  beforeEach(() => vi.setSystemTime(FIXED_TS));
  afterEach(() => vi.useRealTimers());

  it("returns null for empty string", () => {
    expect(daysSince("")).toBeNull();
  });

  it("returns 0 for today", () => {
    expect(daysSince(FIXED_DATE)).toBe(0);
  });

  it("returns correct days for a past date", () => {
    expect(daysSince("2025-06-05")).toBe(10);
  });

  it("clamps to 0 for future dates", () => {
    expect(daysSince("2026-01-01")).toBe(0);
  });
});

// ── fmtDate() ─────────────────────────────────────────────────────────────────

describe("fmtDate", () => {
  it("returns em-dash for empty string", () => {
    expect(fmtDate("")).toBe("—");
    expect(fmtDate("", "fr")).toBe("—");
    expect(fmtDate("", "en")).toBe("—");
  });

  it("formats ISO YYYY-MM-DD as dd.mm.yyyy in French (default)", () => {
    expect(fmtDate("2024-03-15")).toBe("15.03.2024");
    expect(fmtDate("2024-03-15", "fr")).toBe("15.03.2024");
  });

  it("formats ISO YYYY-MM-DD as 'Mon D, YYYY' in English", () => {
    expect(fmtDate("2024-03-15", "en")).toBe("Mar 15, 2024");
    expect(fmtDate("2024-12-01", "en")).toBe("Dec 1, 2024");
    expect(fmtDate("2024-01-09", "en")).toBe("Jan 9, 2024");
  });

  it("passes through non-standard strings unchanged", () => {
    expect(fmtDate("inconnu")).toBe("inconnu");
    expect(fmtDate("inconnu", "en")).toBe("inconnu");
    expect(fmtDate("2024/03/15")).toBe("2024/03/15");
  });

  it("falls back to FR format when EN month index is out of range", () => {
    expect(fmtDate("2024-13-15", "en")).toBe("15.13.2024");
  });
});

// ── fmtDateTime() ────────────────────────────────────────────────────────────

describe("fmtDateTime", () => {
  it("returns em-dash for null / undefined / NaN", () => {
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtDateTime(undefined)).toBe("—");
    expect(fmtDateTime(NaN)).toBe("—");
    expect(fmtDateTime(new Date("invalid"))).toBe("—");
  });

  it("formats a numeric timestamp in FR (default)", () => {
    // 2024-03-15 14:07:00 local time
    const ts = new Date(2024, 2, 15, 14, 7).getTime();
    expect(fmtDateTime(ts)).toBe("15.03.2024 14:07");
    expect(fmtDateTime(ts, "fr")).toBe("15.03.2024 14:07");
  });

  it("formats a Date object in EN", () => {
    const d = new Date(2024, 2, 15, 9, 5);
    expect(fmtDateTime(d, "en")).toBe("Mar 15, 2024 09:05");
  });
});

// ── fmtNum() ─────────────────────────────────────────────────────────────────

describe("fmtNum", () => {
  it("returns empty string for empty / null / undefined", () => {
    expect(fmtNum("")).toBe("");
    expect(fmtNum(null)).toBe("");
    expect(fmtNum(undefined)).toBe("");
  });

  it("uses comma decimal separator in FR (default)", () => {
    expect(fmtNum("2.5")).toBe("2,5");
    expect(fmtNum("2.5", "fr")).toBe("2,5");
    expect(fmtNum(2.5)).toBe("2,5");
    expect(fmtNum("50")).toBe("50");
  });

  it("uses dot decimal separator in EN", () => {
    expect(fmtNum("2.5", "en")).toBe("2.5");
    expect(fmtNum(2.5, "en")).toBe("2.5");
    expect(fmtNum("50", "en")).toBe("50");
  });

  it("accepts comma decimal input and normalises", () => {
    expect(fmtNum("2,5", "fr")).toBe("2,5");
    expect(fmtNum("2,5", "en")).toBe("2.5");
  });

  it("preserves trailing zeros from the source string", () => {
    expect(fmtNum("2.50", "en")).toBe("2.50");
    expect(fmtNum("2.50", "fr")).toBe("2,50");
  });

  it("rounds float-accumulation noise on a COMPUTED number", () => {
    // Canonical float noise.
    expect(fmtNum(0.1 + 0.2)).toBe("0,3");           // 0.30000000000000004
    expect(fmtNum(0.1 + 0.2, "en")).toBe("0.3");
    // Simulate a summed category stock (2714.1) that accumulates noise like
    // the reported 2714.1000000000001 — built by arithmetic, not a literal.
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += 271.41;
    expect(fmtNum(sum, "fr")).toBe("2714,1");
    expect(fmtNum(200)).toBe("200");                 // whole number, no ",0"
    // A user-typed STRING still keeps its precision (not rounded).
    expect(fmtNum("2.50", "fr")).toBe("2,50");
  });

  it("passes through non-numeric strings unchanged", () => {
    expect(fmtNum("abc")).toBe("abc");
    expect(fmtNum("abc", "en")).toBe("abc");
  });
});

// ── initDateFormat() — the one-shot migration ─────────────────────────────────

describe("initDateFormat", () => {
  beforeEach(() => localStorage.clear());

  it("returns 'fr' and persists it when both keys are absent (fresh install)", () => {
    expect(initDateFormat()).toBe("fr");
    expect(localStorage.getItem("cave-date-format")).toBe("fr");
  });

  it("seeds 'en' from cave-lang='en' for build-≤132 upgraders", () => {
    localStorage.setItem("cave-lang", "en");
    expect(initDateFormat()).toBe("en");
    expect(localStorage.getItem("cave-date-format")).toBe("en");
  });

  it("seeds 'fr' from cave-lang='fr'", () => {
    localStorage.setItem("cave-lang", "fr");
    expect(initDateFormat()).toBe("fr");
    expect(localStorage.getItem("cave-date-format")).toBe("fr");
  });

  it("preserves an explicit cave-date-format='fr' even when cave-lang='en'", () => {
    localStorage.setItem("cave-lang", "en");
    localStorage.setItem("cave-date-format", "fr");
    expect(initDateFormat()).toBe("fr");
    expect(localStorage.getItem("cave-date-format")).toBe("fr");
  });

  it("preserves an explicit cave-date-format='en' even when cave-lang='fr'", () => {
    localStorage.setItem("cave-lang", "fr");
    localStorage.setItem("cave-date-format", "en");
    expect(initDateFormat()).toBe("en");
    expect(localStorage.getItem("cave-date-format")).toBe("en");
  });

  it("ignores garbage values in cave-date-format and re-seeds", () => {
    localStorage.setItem("cave-lang", "en");
    localStorage.setItem("cave-date-format", "nonsense");
    expect(initDateFormat()).toBe("en");
    expect(localStorage.getItem("cave-date-format")).toBe("en");
  });
});

// ── lotAge() ──────────────────────────────────────────────────────────────────

describe("lotAge", () => {
  beforeEach(() => vi.setSystemTime(FIXED_TS));
  afterEach(() => vi.useRealTimers());

  it("uses dateProduction when available", () => {
    const lot = makeLot({ dateProduction: "2025-06-05", datePurchased: "2025-01-01" });
    expect(lotAge(lot)).toBe(10);
  });

  it("falls back to datePurchased when no dateProduction", () => {
    const lot = makeLot({ datePurchased: "2025-06-05" });
    expect(lotAge(lot)).toBe(10);
  });

  it("returns null when both dates are empty", () => {
    expect(lotAge(makeLot())).toBeNull();
  });
});

// ── oldestAge() ───────────────────────────────────────────────────────────────

describe("oldestAge", () => {
  beforeEach(() => vi.setSystemTime(FIXED_TS));
  afterEach(() => vi.useRealTimers());

  it("returns null for tobacco with no lots", () => {
    expect(oldestAge(makeTobacco([]))).toBeNull();
  });

  it("ignores finished lots", () => {
    const tob = makeTobacco([
      makeLot({ status: "finished", datePurchased: "2020-01-01" }),
    ]);
    expect(oldestAge(tob)).toBeNull();
  });

  it("returns max age across active lots", () => {
    const tob = makeTobacco([
      makeLot({ datePurchased: "2025-06-05" }), // 10 days
      makeLot({ datePurchased: "2025-06-10" }), // 5 days
    ]);
    expect(oldestAge(tob)).toBe(10);
  });
});

// ── countByStatus() ───────────────────────────────────────────────────────────

describe("countByStatus", () => {
  it("counts lots matching the given status", () => {
    const tob = makeTobacco([
      makeLot({ status: "cellar" }),
      makeLot({ status: "cellar" }),
      makeLot({ status: "jar" }),
      makeLot({ status: "finished" }),
    ]);
    expect(countByStatus(tob, "cellar")).toBe(2);
    expect(countByStatus(tob, "jar")).toBe(1);
    expect(countByStatus(tob, "finished")).toBe(1);
  });
});

// ── countActive() ─────────────────────────────────────────────────────────────

describe("countActive", () => {
  it("counts cellar + jar lots", () => {
    const tob = makeTobacco([
      makeLot({ status: "cellar" }),
      makeLot({ status: "jar" }),
      makeLot({ status: "finished" }),
    ]);
    expect(countActive(tob)).toBe(2);
  });
});

// ── hasActive() ───────────────────────────────────────────────────────────────

describe("hasActive", () => {
  it("returns true when at least one non-finished lot exists", () => {
    const tob = makeTobacco([
      makeLot({ status: "finished" }),
      makeLot({ status: "jar" }),
    ]);
    expect(hasActive(tob)).toBe(true);
  });

  it("returns false when all lots are finished", () => {
    const tob = makeTobacco([makeLot({ status: "finished" })]);
    expect(hasActive(tob)).toBe(false);
  });

  it("returns false for empty lots", () => {
    expect(hasActive(makeTobacco([]))).toBe(false);
  });
});

// ── pipeIsActive() ────────────────────────────────────────────────────────────

describe("pipeIsActive", () => {
  it("returns true for active pipe", () => {
    expect(pipeIsActive(makePipe("active"))).toBe(true);
  });

  it("returns false for finished pipe", () => {
    expect(pipeIsActive(makePipe("finished"))).toBe(false);
  });

  it("defaults to active when status is missing", () => {
    const pipe = { ...makePipe() };
    delete (pipe as any).status;
    expect(pipeIsActive(pipe)).toBe(true);
  });
});

// ── accIsActive() ─────────────────────────────────────────────────────────────

describe("accIsActive", () => {
  it("returns true for active accessory", () => {
    expect(accIsActive(makeAccessory("active"))).toBe(true);
  });

  it("returns false for retired accessory", () => {
    expect(accIsActive(makeAccessory("retired"))).toBe(false);
  });
});

// ── migrateData() ─────────────────────────────────────────────────────────────

describe("migrateData", () => {
  // The array-initialisation and counter-clamping cases that used to open this
  // block live in migrateData.test.ts, which asserts the same rules more
  // strictly (`toEqual([])` against `Array.isArray`, `toBe(existing)` against
  // `toHaveLength(1)`). The three input values only this block carried —
  // the string "-1", the empty string, and {} — were poured into that file's
  // existing counter tables, so nothing stopped being exercised.
  it("returns the mutated object", () => {
    const d: any = {};
    const result = migrateData(d);
    expect(result).toBe(d);
  });

  it("back-fills missing lot ids so the session form's <option value> stays unique", () => {
    const d: any = {
      tobaccos: [
        {
          id: 1, name: "Duskfall", brand: "Brackwater",
          lots: [
            { status: "cellar", weightG: "100" },          // no id
            { id: 1234, status: "jar", weightG: "30" },    // has id
            { id: "",  status: "cellar", weightG: "50" },  // empty id
            { id: null, status: "cellar", weightG: "20" }, // null id
          ],
        },
      ],
    };
    const out = migrateData(d);
    const lots = out.tobaccos[0].lots;
    // Every lot now has a truthy, distinct id.
    lots.forEach((l: any) => expect(l.id).toBeTruthy());
    const ids = lots.map((l: any) => String(l.id));
    const unique = new Set(ids);
    expect(unique.size).toBe(lots.length);
    // The pre-existing real id is preserved.
    expect(lots[1].id).toBe(1234);
  });

  it("does NOT touch tobaccos without a lots array (defensive)", () => {
    const d: any = { tobaccos: [{ id: 1, name: "x" }] };
    const out = migrateData(d);
    // Identity + the absent lots array are preserved (no defensive `lots: []`
    // injected here). An earlier release additionally backfills a stable `uid`.
    expect(out.tobaccos[0].id).toBe(1);
    expect(out.tobaccos[0].name).toBe("x");
    expect(out.tobaccos[0].lots).toBeUndefined();
    expect(typeof out.tobaccos[0].uid).toBe("string");
  });

  it("back-fills weightInitial from weightG on lots missing it", () => {
    const d: any = {
      tobaccos: [
        {
          id: 1, name: "Duskfall", brand: "Brackwater",
          lots: [
            { id: "L1", status: "cellar", weightG: "50" },                              // no weightInitial
            { id: "L2", status: "jar", weightG: "30", weightInitial: "100" },           // already set, preserved
            { id: "L3", status: "cellar", weightG: "25", weightInitial: "" },           // empty string → backfill
            { id: "L4", status: "finished", weightG: "0", weightInitial: null as any }, // null → backfill
          ],
        },
      ],
    };
    const out = migrateData(d);
    const lots = out.tobaccos[0].lots;
    expect(lots[0].weightInitial).toBe("50");
    expect(lots[1].weightInitial).toBe("100"); // preserved
    expect(lots[2].weightInitial).toBe("25");
    expect(lots[3].weightInitial).toBe("0");
  });

  it("back-fills originalStatus with heuristic based on dateOpened", () => {
    const d: any = {
      tobaccos: [
        {
          id: 1, name: "Duskfall", brand: "Brackwater",
          lots: [
            { id: "L1", status: "cellar", weightG: "50" },                                                  // cellar → cellar
            { id: "L2", status: "jar",    weightG: "30", dateOpened: "2024-02-01" },                        // jar + dateOpened → cellar
            { id: "L3", status: "jar",    weightG: "30" },                                                  // jar, no dateOpened → jar
            { id: "L4", status: "finished", weightG: "0", dateOpened: "2024-02-01", dateFinished: "2024-06-01" }, // finished with open date → cellar
            { id: "L5", status: "finished", weightG: "0", dateFinished: "2024-06-01" },                     // finished, no open date → jar
            { id: "L6", status: "cellar", weightG: "50", originalStatus: "jar" },                           // already set, preserved
          ],
        },
      ],
    };
    const out = migrateData(d);
    const lots = out.tobaccos[0].lots;
    expect(lots[0].originalStatus).toBe("cellar");
    expect(lots[1].originalStatus).toBe("cellar");
    expect(lots[2].originalStatus).toBe("jar");
    expect(lots[3].originalStatus).toBe("cellar");
    expect(lots[4].originalStatus).toBe("jar");
    expect(lots[5].originalStatus).toBe("jar"); // preserved
  });
});

// ── parseAgingMax ─────────────────────────────────────────────────────────────

describe("parseAgingMax", () => {
  it("returns {0,0} for empty/null/undefined", () => {
    expect(parseAgingMax("")).toEqual({ min: 0, max: 0 });
    expect(parseAgingMax(null)).toEqual({ min: 0, max: 0 });
    expect(parseAgingMax(undefined)).toEqual({ min: 0, max: 0 });
  });

  it("parses a single value", () => {
    expect(parseAgingMax("10")).toEqual({ min: 10, max: 10 });
    expect(parseAgingMax("  7  ")).toEqual({ min: 7, max: 7 });
  });

  it("parses a hyphen range", () => {
    expect(parseAgingMax("10-15")).toEqual({ min: 10, max: 15 });
    expect(parseAgingMax("5 - 8")).toEqual({ min: 5, max: 8 });
  });

  it("parses an en-dash range", () => {
    expect(parseAgingMax("10–15")).toEqual({ min: 10, max: 15 });
  });

  it("swaps min/max when given in reverse order", () => {
    expect(parseAgingMax("15-10")).toEqual({ min: 10, max: 15 });
  });

  it("returns {0,0} for unparseable strings", () => {
    expect(parseAgingMax("abc")).toEqual({ min: 0, max: 0 });
  });
});

// ── lotAgingStatus ────────────────────────────────────────────────────────────

function yearsAgo(years: number) {
  // Build a date string that's `years` ago.
  var d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

describe("lotAgingStatus", () => {
  it("returns null when the lot is finished, regardless of age", () => {
    const lot: any = {
      status: "finished",
      dateProduction: yearsAgo(20),
      weightG: "0",
    };
    expect(lotAgingStatus(lot, "5")).toBeNull();
  });

  it("returns null when agingMax is empty", () => {
    const lot: any = { status: "cellar", dateProduction: yearsAgo(20) };
    expect(lotAgingStatus(lot, "")).toBeNull();
    expect(lotAgingStatus(lot, "0")).toBeNull();
  });

  it("returns null when the lot has no production/purchase date", () => {
    const lot: any = { status: "cellar" };
    expect(lotAgingStatus(lot, "10")).toBeNull();
  });

  it("range — returns 'approaching' when age is inside the peak window", () => {
    const lot: any = { status: "cellar", dateProduction: yearsAgo(12) };
    expect(lotAgingStatus(lot, "10-15")).toBe("approaching");
  });

  it("range — returns 'overaged' when age exceeds the upper bound", () => {
    const lot: any = { status: "cellar", dateProduction: yearsAgo(16) };
    expect(lotAgingStatus(lot, "10-15")).toBe("overaged");
  });

  it("range — returns null when age is below the lower bound", () => {
    const lot: any = { status: "cellar", dateProduction: yearsAgo(5) };
    expect(lotAgingStatus(lot, "10-15")).toBeNull();
  });

  it("single value — returns 'approaching' in the last year before the peak", () => {
    // Single value 10, age = 9.5 → approaching
    const lot: any = { status: "cellar", dateProduction: yearsAgo(9.5) };
    expect(lotAgingStatus(lot, "10")).toBe("approaching");
  });

  it("single value — returns 'overaged' when age exceeds the peak", () => {
    const lot: any = { status: "cellar", dateProduction: yearsAgo(11) };
    expect(lotAgingStatus(lot, "10")).toBe("overaged");
  });

  it("single value — returns null well before the peak", () => {
    const lot: any = { status: "cellar", dateProduction: yearsAgo(3) };
    expect(lotAgingStatus(lot, "10")).toBeNull();
  });

  it("aging alerts are CELLAR-only — a jar returns null", () => {
    const cellarLot: any = { status: "cellar", dateProduction: yearsAgo(11) };
    const jarLot: any = { status: "jar", dateProduction: yearsAgo(11) };
    expect(lotAgingStatus(cellarLot, "10")).toBe("overaged");
    // A lot "en pot" is opened → no cellaring alert (it gets the "ouvert
    // depuis N" signal instead).
    expect(lotAgingStatus(jarLot, "10")).toBe(null);
  });

  it("falls back to datePurchased when dateProduction is missing", () => {
    const lot: any = { status: "cellar", datePurchased: yearsAgo(11) };
    expect(lotAgingStatus(lot, "10")).toBe("overaged");
  });
});

// ── effectiveAgingMax ──────────────────────────────────────────────
describe("effectiveAgingMax", () => {
  it("returns the tobacco's own agingMax when set (manual value wins)", () => {
    expect(effectiveAgingMax({ category: "Aromatique", agingMax: "8" })).toBe("8");
    expect(effectiveAgingMax({ category: "Virginia", agingMax: "10-15" })).toBe("10-15");
    // Even a small explicit value overrides the family default.
    expect(effectiveAgingMax({ category: "Virginia", agingMax: "2" })).toBe("2");
  });

  it("falls back to the family default when agingMax is empty", () => {
    // sourced revision of the family defaults.
    expect(effectiveAgingMax({ category: "Aromatique", agingMax: "" })).toBe("3");
    expect(effectiveAgingMax({ category: "Virginia", agingMax: "" })).toBe("15-25");
    expect(effectiveAgingMax({ category: "VaPer", agingMax: "" })).toBe("15-20");
    expect(effectiveAgingMax({ category: "Latakia", agingMax: "" })).toBe("5-8");
    expect(effectiveAgingMax({ category: "Oriental", agingMax: "" })).toBe("6-10");
    expect(effectiveAgingMax({ category: "Perique", agingMax: "" })).toBe("10-15");
    expect(effectiveAgingMax({ category: "Burley", agingMax: "" })).toBe("5-10");
  });

  it("treats agingMax='0' / whitespace as unset and uses the family default", () => {
    expect(effectiveAgingMax({ category: "Aromatique", agingMax: "0" })).toBe("3");
    expect(effectiveAgingMax({ category: "Virginia", agingMax: "   " })).toBe("15-25");
  });

  it("returns '' for an unknown / 'Autre' family with no explicit target", () => {
    expect(effectiveAgingMax({ category: "Autre", agingMax: "" })).toBe("");
    expect(effectiveAgingMax({ category: "", agingMax: "" })).toBe("");
    expect(effectiveAgingMax(null)).toBe("");
  });

  it("makes an aromatic peak years before a Virginia at the same age (via lotAgingStatus)", () => {
    // A 4-year-old lot: overaged for an Aromatic (default 3), still fine for
    // a Virginia (default 15-20) — the type now drives the verdict WITHOUT
    // any agingMax entered by the user.
    const lot: any = { status: "cellar", dateProduction: yearsAgo(4) };
    expect(lotAgingStatus(lot, effectiveAgingMax({ category: "Aromatique", agingMax: "" }))).toBe("overaged");
    expect(lotAgingStatus(lot, effectiveAgingMax({ category: "Virginia", agingMax: "" }))).toBeNull();
  });

  it("the family table mirrors the AI prompt buckets (sanity)", () => {
    expect(FAMILY_AGING_MAX["Aromatique"]).toBe("3");
    expect(FAMILY_AGING_MAX["Cavendish"]).toBe("3");
    expect(FAMILY_AGING_MAX["Virginia"]).toBe("15-25");
    expect(FAMILY_AGING_MAX["Latakia"]).toBe("5-8");
    expect(FAMILY_AGING_MAX["Perique"]).toBe("10-15");
    expect(FAMILY_AGING_MAX["Autre"]).toBeUndefined();
  });
});

describe("migrateData — weightInitial reconstructed from session history", () => {
  it("backfills weightInitial = weightG + Σ(sessions on this lot)", () => {
    const d: any = {
      tobaccos: [{
        id: 1, name: "X", brand: "Y",
        lots: [{ id: "L1", status: "jar", weightG: "20", dateOpened: "2024-01-15", originalStatus: "cellar" }],
      }],
      sessions: [
        { id: "S1", date: "2024-02-01", tobaccoId: 1, lotId: "L1", weightG: "10" },
        { id: "S2", date: "2024-03-01", tobaccoId: 1, lotId: "L1", weightG: "20" },
      ],
    };
    migrateData(d);
    // weightInitial backfilled = 20 (current) + 30 (smoked) = 50
    expect(d.tobaccos[0].lots[0].weightInitial).toBe("50");
  });

  it("falls back to weightG alone when no sessions match the lot", () => {
    const d: any = {
      tobaccos: [{
        id: 1, name: "X", brand: "Y",
        lots: [{ id: "L1", status: "cellar", weightG: "100" }],
      }],
      sessions: [],
    };
    migrateData(d);
    expect(d.tobaccos[0].lots[0].weightInitial).toBe("100");
  });

  it("preserves an explicit weightInitial verbatim", () => {
    const d: any = {
      tobaccos: [{
        id: 1, name: "X", brand: "Y",
        lots: [{ id: "L1", status: "jar", weightG: "20", weightInitial: "75", dateOpened: "2024-01-15", originalStatus: "cellar" }],
      }],
      sessions: [
        { id: "S1", date: "2024-02-01", tobaccoId: 1, lotId: "L1", weightG: "10" },
      ],
    };
    migrateData(d);
    expect(d.tobaccos[0].lots[0].weightInitial).toBe("75");
  });
});

// ── computeStats() ────────────────────────────────────────────────────────────
// Home tile counters (cellar / jars / lotsFinished / lotsOveraged /
// lotsApproaching) are LOT counts — total boxes in cellar, total jars in
// use, etc. Two releases briefly made them tabac-counts to match the
// inventory page chips; the user prefers the raw lot total so Home shows
// "how many physical containers do I have" while the inventory page chip
// answers "how many distinct tobaccos sit in this status".
// `activeRefs` stays as the tabac count for the top mini-stat.

describe("computeStats — lot-based tile counters", () => {
  function tob(id: number, brand: string, name: string, lots: any[], rating = 0, category = "Aromatique") {
    return { id, brand, name, lots, rating, category, agingMax: "" };
  }

  it("returns {} for null/undefined data", () => {
    expect(computeStats(null)).toEqual({});
    expect(computeStats(undefined)).toEqual({});
  });

  it("counts EACH jar lot in `jars` — a tabac with 2 jars contributes 2", () => {
    const data = {
      tobaccos: [tob(1, "Brackwater", "Duskfall", [
        { id: "L1", status: "jar", weightG: "30", originalStatus: "jar", dateOpened: "2024-01-01" },
        { id: "L2", status: "jar", weightG: "20", originalStatus: "jar", dateOpened: "2024-02-01" },
      ])],
      pipes: [],
      wishlist: [],
    };
    const s = computeStats(data);
    expect(s.jars).toBe(2);
    expect(s.total).toBe(1);
    expect(s.activeRefs).toBe(1);
  });

  it("counts EACH cellar lot in `cellar`", () => {
    const data = {
      tobaccos: [tob(1, "Brackwater", "Duskfall", [
        { id: "L1", status: "cellar", weightG: "50", originalStatus: "cellar" },
        { id: "L2", status: "cellar", weightG: "50", originalStatus: "cellar" },
        { id: "L3", status: "cellar", weightG: "50", originalStatus: "cellar" },
      ])],
      pipes: [],
      wishlist: [],
    };
    const s = computeStats(data);
    expect(s.cellar).toBe(3);
  });

  it("activeRefs counts TABACS (not lots) — one entry with multiple active lots is 1", () => {
    const data = {
      tobaccos: [
        tob(1, "A", "Active", [
          { id: "L1", status: "jar",    weightG: "30", originalStatus: "jar" },
          { id: "L2", status: "cellar", weightG: "50", originalStatus: "cellar" },
        ]),
        tob(2, "B", "FinishedOnly", [{ id: "L3", status: "finished", weightG: "0", dateFinished: "2023-12-01", originalStatus: "cellar" }]),
      ],
      pipes: [], wishlist: [],
    };
    const s = computeStats(data);
    expect(s.activeRefs).toBe(1);   // only tabac A has an active lot
    expect(s.total).toBe(2);
    expect(s.cellar).toBe(1);       // one cellar lot
    expect(s.jars).toBe(1);         // one jar lot
    expect(s.lotsFinished).toBe(1); // one finished lot (not disposed)
  });

  it("excludes disposed finished lots from `lotsFinished`", () => {
    // A lot that was THROWN AWAY (disposed=true) should not count as
    // "consumed history" — even though its status is "finished".
    const data = {
      tobaccos: [
        tob(1, "A", "Consumed", [{ id: "L1", status: "finished", weightG: "0", disposed: false, dateFinished: "2023-12-01", originalStatus: "cellar" }]),
        tob(2, "B", "Disposed", [{ id: "L2", status: "finished", weightG: "0", disposed: true,  dateFinished: "2023-12-01", originalStatus: "cellar" }]),
      ],
      pipes: [],
      wishlist: [],
    };
    const s = computeStats(data);
    expect(s.lotsFinished).toBe(1);
  });

  it("counts EACH aging CELLAR lot in lotsApproaching / lotsOveraged", () => {
    // A tabac with two CELLAR lots — one approaching peak, one overaged. Each
    // lot contributes to its own bucket; lotAgingStatus returns one or the
    // other, never both for the same lot, so summing the buckets is safe.
    // aging is cellar-only, so these lots are "cellar" (a jar would
    // count 0).
    const data = {
      tobaccos: [{
        id: 1, brand: "A", name: "Mixed", category: "Anglais", rating: 0,
        agingMax: "5-10",
        lots: [
          { id: "L1", status: "cellar", weightG: "30", originalStatus: "cellar", dateProduction: "2017-01-01" },  // ~9y → approaching
          { id: "L2", status: "cellar", weightG: "10", originalStatus: "cellar", dateProduction: "2010-01-01" },  // 16y → overaged
        ],
      }],
      pipes: [], wishlist: [],
    };
    const s = computeStats(data);
    expect(s.lotsApproaching).toBe(1);
    expect(s.lotsOveraged).toBe(1);
  });

  it("computes pipe + tabac value aggregates correctly", () => {
    const data = {
      tobaccos: [
        { id: 1, brand: "A", name: "X", category: "", rating: 0, agingMax: "", lots: [
          { id: "L1", status: "jar", weightG: "30", originalStatus: "jar", dateOpened: "", price: "12.5" },
          { id: "L2", status: "finished", weightG: "0", originalStatus: "cellar", dateFinished: "2023-12-01", price: "10" },  // excluded
        ]},
      ],
      pipes: [
        { id: 1, brand: "P", name: "X", shape: "Billiard", rating: 5, status: "active", price: "200" },
        { id: 2, brand: "Q", name: "Y", shape: "Apple",    rating: 3, status: "finished", price: "150" }, // excluded
      ],
      wishlist: [],
    };
    const s = computeStats(data);
    expect(s.tobVal).toBeCloseTo(12.5);
    expect(s.pipeVal).toBe(200);
    expect(s.pipesActive).toBe(1);
    expect(s.pipesFinished).toBe(1);
  });
});

describe("monotonicId", () => {
  beforeEach(() => { _resetMonotonicIdForTests(); });

  it("returns a positive number", () => {
    expect(monotonicId()).toBeGreaterThan(0);
  });

  it("is strictly increasing across calls even when Date.now is frozen", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const a = monotonicId();
    const b = monotonicId();
    const c = monotonicId();
    expect(a).toBe(1000);
    expect(b).toBe(1001);
    expect(c).toBe(1002);
    expect(new Set([a, b, c]).size).toBe(3);
    spy.mockRestore();
  });

  it("follows the real clock when it advances past the last id", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(5000);
    expect(monotonicId()).toBe(1000);
    expect(monotonicId()).toBe(5000);
    spy.mockRestore();
  });
});

describe("nextBoxNumber", () => {
  it("returns max numeric box + 1 across all tobaccos' lots", () => {
    const tobs = [
      { lots: [{ boxNumber: "3" }, { boxNumber: "7" }] },
      { lots: [{ boxNumber: "12" }] },
    ];
    expect(nextBoxNumber(tobs)).toBe("13");
  });

  it("returns '' when no lot has a numeric box number (don't impose one)", () => {
    expect(nextBoxNumber([{ lots: [{ boxNumber: "" }, { boxNumber: "B-2017" }] }])).toBe("");
    expect(nextBoxNumber([])).toBe("");
    expect(nextBoxNumber(null as any)).toBe("");
  });

  it("ignores non-strictly-numeric labels like '5abc'", () => {
    expect(nextBoxNumber([{ lots: [{ boxNumber: "5abc" }, { boxNumber: "2" }] }])).toBe("3");
  });

  it("skips soft-deleted tobaccos and lots", () => {
    const tobs = [
      { lots: [{ boxNumber: "4" }] },
      { deletedAt: "x", lots: [{ boxNumber: "99" }] },       // trashed tobacco
      { lots: [{ boxNumber: "50", deletedAt: "x" }] },        // trashed lot
    ];
    expect(nextBoxNumber(tobs)).toBe("5");
  });
});

describe("dedupeIds", () => {
  it("keeps unique ids untouched and returns the next free counter", () => {
    const arr = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const next = dedupeIds(arr, 4);
    expect(arr.map(r => r.id)).toEqual([1, 2, 3]);
    expect(next).toBe(4);
  });

  it("re-stamps duplicate ids, keeping the FIRST occurrence", () => {
    const arr = [{ id: 5, tag: "a" }, { id: 5, tag: "b" }, { id: 5, tag: "c" }];
    const next = dedupeIds(arr, 1);
    const ids = arr.map(r => r.id);
    expect(ids[0]).toBe(5);                 // first kept
    expect(new Set(ids).size).toBe(3);      // all unique
    expect(ids[1]).toBeGreaterThan(5);
    expect(next).toBeGreaterThan(Math.max(...ids as number[]) - 1);
    // Content preserved.
    expect(arr.map(r => r.tag)).toEqual(["a", "b", "c"]);
  });

  it("treats id:0 / negative / missing / empty as bad and re-stamps them", () => {
    const arr = [{ id: 0 }, { id: -3 }, {}, { id: "" }, { id: 10 }];
    dedupeIds(arr, 1);
    const ids = arr.map(r => (r as any).id);
    expect(ids.every(x => typeof x === "number" && x > 0)).toBe(true);
    expect(new Set(ids).size).toBe(5);
    expect(ids[4]).toBe(10);                // the one valid id kept
  });

  it("seeds the counter above the max existing valid id (no collision)", () => {
    const arr = [{ id: 100 }, { id: 100 }];
    dedupeIds(arr, 1);
    expect(arr[0]!.id).toBe(100);
    expect(arr[1]!.id).toBe(101);          // above the existing max, not 1
  });

  it("threads a global counter: uses startAt for new ids and returns the advanced value", () => {
    const arr = [{ id: 2 }, { id: 2 }];    // dup; startAt (counter) = 7
    const next = dedupeIds(arr, 7);
    expect(arr[0]!.id).toBe(2);
    expect(arr[1]!.id).toBe(7);            // minted from the reconciled counter
    expect(next).toBe(8);
  });

  it("leaves a UNIQUE non-numeric id untouched (only dups/bad are re-stamped)", () => {
    const arr = [{ id: "T1" }, { id: "T2" }, { id: "T2" }];
    dedupeIds(arr, 1);
    expect(arr[0]!.id).toBe("T1");
    expect(arr[1]!.id).toBe("T2");
    expect(arr[2]!.id).not.toBe("T2");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const arr = [{ id: 0 }, { id: 0 }, { id: 9 }];
    dedupeIds(arr, 1);
    const snapshot = arr.map(r => r.id);
    dedupeIds(arr, 1);
    expect(arr.map(r => r.id)).toEqual(snapshot);
  });

  it("handles a non-array safely", () => {
    expect(dedupeIds(null as any, 5)).toBe(5);
    expect(dedupeIds(undefined as any)).toBe(1);
  });
});

// ── fmtLotAge moved here from InventoryDetailView ──────────
// It now feeds the list card's "Ouvert · X" line as well as the fiche's, so
// the two surfaces render the SAME string — the reason it stopped being a
// private helper of one view.
describe("fmtLotAge", () => {
  const t = (k: string) => k;   // "12" + "age_d" etc., so the unit is visible

  it("days under a month, months under a year, then years", () => {
    expect(fmtLotAge(0, t)).toBe("0age_d");
    expect(fmtLotAge(29, t)).toBe("29age_d");
    expect(fmtLotAge(30, t)).toBe("1age_mo");
    // REVERSED. This asserted "12age_mo", i.e. it pinned the defect — two
    // lines below sits a case named "caps months at 11", which covered the
    // YEAR branch only, so the suite asserted a rule and its violation side by
    // side. Twelve months is a year: 360-364 days read "12 mois" on the lot
    // row, the card and the fiche, then flipped to "1 an" the following week.
    expect(fmtLotAge(364, t)).toBe("11age_mo");
    expect(fmtLotAge(365, t)).toBe("1age_y");
    expect(fmtLotAge(400, t)).toBe("1age_y 1age_m");
  });

  it("caps months at 11 — no '1 an 12 mois'", () => {
    // The latent bug this helper carries a guard for.
    expect(fmtLotAge(729, t)).toBe("1age_y 11age_m");
    expect(fmtLotAge(730, t)).toBe("2age_y");
  });

  it("renders an em dash for an unknown age", () => {
    expect(fmtLotAge(null, t)).toBe("—");
    expect(fmtLotAge(undefined, t)).toBe("—");
  });
});

/**
 * getStorageBlockedHint — the parity guard nothing guarded.
 *
 * Found by mutation: making it return "" left 3698 of 3698 tests green. That
 * is worse than an ordinary coverage gap, because this helper exists FOR a
 * contract — its own comment says it lives in utils "so the iOS↔Android parity
 * contract is enforced at the helper level — adding a third platform means
 * touching one place, never four" (CLAUDE.md invariant #20). A contract with
 * no test is a comment.
 *
 * It also carries one of the four English-fallback sites that had to be fixed
 * when only English became statically available: a `LANG.fr` here
 * would resolve to `undefined` for anyone whose dictionary has not loaded,
 * and the user would get an empty message on the one screen that tells them
 * how to unblock their own storage.
 */
describe("getStorageBlockedHint", () => {
  it("gives a different path per platform — the parity contract itself", () => {
    const ios = getStorageBlockedHint("fr", true);
    const android = getStorageBlockedHint("fr", false);
    expect(ios).not.toBe("");
    expect(android).not.toBe("");
    expect(ios, "both platforms must not share one breadcrumb").not.toBe(android);
  });

  it("names the right platform on each branch", () => {
    // Asserting the OS word rather than the whole sentence: the wording is
    // free to change, the platform it describes is not.
    expect(getStorageBlockedHint("fr", true)).toMatch(/Safari|Réglages/i);
    expect(getStorageBlockedHint("fr", false)).toMatch(/Chrome|Paramètres/i);
  });

  it("answers in the requested language", () => {
    expect(getStorageBlockedHint("en", true)).not.toBe(getStorageBlockedHint("fr", true));
  });

  it("falls back to ENGLISH, never to empty, for a language not in memory", () => {
    // An earlier release left English the only compiled-in dictionary. "xx" stands for
    // any language whose chunk has not loaded — the case that must not
    // silently produce a blank hint.
    for (const lang of ["xx", "", "constructor"]) {
      for (const ios of [true, false]) {
        expect(getStorageBlockedHint(lang, ios), `lang=${lang} ios=${ios}`)
          .toBe(getStorageBlockedHint("en", ios));
      }
    }
  });

  it("carries both platform breadcrumbs in EVERY shipped language", () => {
    // Invariant #20 is per-language: a platform path that exists only in
    // French leaves the other five readers with the English one, which is the
    // silent-fallback shape this repo keeps finding.
    for (const { code } of LANGUAGES) {
      for (const ios of [true, false]) {
        const hint = getStorageBlockedHint(code, ios);
        expect(hint, `${code} / ${ios ? "iOS" : "Android"}`).not.toBe("");
      }
      expect(getStorageBlockedHint(code, true), `${code} shares one breadcrumb`)
        .not.toBe(getStorageBlockedHint(code, false));
    }
  });
});

// ── the session order + the per-lot filter ───────────────────
// `compareSessionsRecent` was EXTRACTED from JournalView's inline sort when the
// lot fiche needed the same order. These cases pin the two rungs that are not
// re-derivable by eye, because a hand-rewritten comparator would get exactly
// those wrong: an untimed session must sort to the BOTTOM of its own day (not
// by string comparison against a time, which locale collation does not rank
// predictably against punctuation), and the final tie-break is `id` DESCENDING
// so a restore that scrambles `data.sessions` cannot change the displayed order.

describe("compareSessionsRecent", () => {
  const sorted = (a: any[]) => a.slice().sort(U.compareSessionsRecent).map((s) => s.id);

  it("orders by date, most recent day first", () => {
    expect(sorted([
      { id: 1, date: "2024-01-01" },
      { id: 2, date: "2024-03-01" },
      { id: 3, date: "2024-02-01" },
    ])).toEqual([2, 3, 1]);
  });

  it("puts a TIMED session before an untimed one on the same day", () => {
    // The load-bearing rung: "" must not be compared as a string against
    // "08:00" — it is handled explicitly, so the untimed row lands last.
    //
    // The ids are chosen so the LATER tie-break CONTRADICTS the answer: the
    // untimed session has the higher id, so if this rung is removed the
    // id-DESC fallback puts it first and the case fails. A fixture with the
    // ids the other way round passes either way — which is what the first
    // version of this test did, and the probe caught it staying green.
    expect(sorted([
      { id: 9, date: "2024-01-01", time: "" },
      { id: 1, date: "2024-01-01", time: "08:00" },
    ])).toEqual([1, 9]);
  });

  it("orders same-day timed sessions latest-first", () => {
    expect(sorted([
      { id: 1, date: "2024-01-01", time: "08:00" },
      { id: 2, date: "2024-01-01", time: "21:30" },
      { id: 3, date: "2024-01-01", time: "13:05" },
    ])).toEqual([2, 3, 1]);
  });

  it("breaks a full tie on id DESCENDING (newest entry on top)", () => {
    expect(sorted([
      { id: 5, date: "2024-01-01", time: "08:00" },
      { id: 9, date: "2024-01-01", time: "08:00" },
      { id: 7, date: "2024-01-01", time: "08:00" },
    ])).toEqual([9, 7, 5]);
  });
});

describe("sessionsForLot", () => {
  const S = [
    { id: 1, lotId: "L1", date: "2024-01-01", weightG: "2" },
    { id: 2, lotId: "L2", date: "2024-01-02", weightG: "3" },
    { id: 3, lotId: "L1", date: "2024-03-01", weightG: "2.5" },
    { id: 4, lotId: "L1", date: "2024-02-01", weightG: "2", deletedAt: "2024-04-01" },
  ];

  it("returns only that lot's LIVE sessions, most recent first", () => {
    expect(U.sessionsForLot(S, "L1").map((s: any) => s.id)).toEqual([3, 1]);
  });

  it("excludes soft-deleted sessions — their weight was already credited back", () => {
    // deleteSession restores the grams to the lot, so a trashed session listed
    // here would show grams the lot no longer owes.
    expect(U.sessionsForLot(S, "L1").some((s: any) => s.id === 4)).toBe(false);
  });

  it("matches a NUMERIC lot id against the string the session stores", () => {
    // The lot `id` is numeric (monotonicId) and `session.lotId` is a string;
    // a raw === between them matches nothing and would render an empty list
    // on a lot that has been smoked.
    const sess = [{ id: 1, lotId: "1700000000000", date: "2024-01-01" }];
    expect(U.sessionsForLot(sess, 1700000000000).map((s: any) => s.id)).toEqual([1]);
  });

  it("returns nothing for an empty / absent lot id rather than every orphan", () => {
    // An orphaned session carries lotId "". Treating "" as a
    // lookup key would gather every orphan under whichever lot was open.
    const sess = [{ id: 1, lotId: "", date: "2024-01-01" }];
    expect(U.sessionsForLot(sess, "")).toEqual([]);
    expect(U.sessionsForLot(sess, null)).toEqual([]);
  });

  it("does not mutate the array it is given", () => {
    const before = S.map((s) => s.id);
    U.sessionsForLot(S, "L1");
    expect(S.map((s) => s.id)).toEqual(before);
  });
});
