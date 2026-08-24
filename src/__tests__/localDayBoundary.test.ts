// EVERY LOT AGE IN THE APP WAS ONE DAY WRONG FOR PART OF EVERY DAY.
//
// `parseLocalDate` exists in `utils.ts` for exactly this, and its own comment
// spells the mechanism out: `new Date("2026-08-24")` is UTC midnight, so
// diffing it against a local `Date.now()` gives a timezone-dependent off-by-one.
// `pipeRestDays`, `computePipeRest`, `suggest.ts` and `HomeViewV2` all went
// through it. `daysSince` — the ONE helper that feeds every lot age — did not.
//
// MEASURED, at every local hour, on the real function:
//   • America/Los_Angeles  wrong 17:00→23:59  (7 h/day), ages one day too HIGH
//   • Pacific/Auckland     wrong 00:00→11:59 (12 h/day), ages one day too LOW
//   • Europe/Paris         wrong 00:00→01:59  (2 h/day), ages one day too LOW
//
// So it is not a corner case for exotic timezones: the author's own zone is
// affected every night, and the western window is the EVENING — precisely when
// somebody smokes a bowl and logs it. What it drives: `fmtLotAge` on the lot
// row, the card and the fiche; "ouvert depuis N"; `isRecentPurchase` (the
// "Achats récents" chip, which drops a lot a day early); `lotMaturityBucket`'s
// young→optimal split; `scopedOldestAgeDays`; the CSV export's Age column;
// "nettoyée il y a N jours" on the pipe fiche.
//
// THE TEST FORCES A TIMEZONE. The container runs in UTC, where every one of
// these assertions passes on the OLD code — a test that took the runner's zone
// would have been vacuous, which is how the defect survived a suite this size.
// Node re-reads `process.env.TZ` per Date call since v16, so setting it in
// `beforeAll` is enough (verified: it moves `Intl`'s resolved zone too).

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { daysSince, fmtLotAge, today, localDayKey } from "../utils.ts";
import { computeActivityHeatmap, activityHeatmapMonths, heatmapDayKeys } from "../utils/cellarInsights.ts";

const REAL_TZ = process.env.TZ;
afterEach(() => { vi.useRealTimers(); });
afterAll(() => { if (REAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = REAL_TZ; });

function inZone(tz: string, fn: () => void) {
  process.env.TZ = tz;
  try { fn(); } finally { process.env.TZ = REAL_TZ ?? "UTC"; }
}

// Every local hour of one day, so a window of any width is caught wherever it
// sits. A single sampled hour would pass in Paris 22 times out of 24.
function everyHourOf(y: number, mo: number, d: number, fn: (h: number) => void) {
  for (let h = 0; h < 24; h++) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(y, mo, d, h, 30, 0));
    try { fn(h); } finally { vi.useRealTimers(); }
  }
}

describe("daysSince counts CALENDAR days, not UTC ones", () => {
  // West of UTC (over-reports in the evening), east of UTC (under-reports in
  // the morning), and the app's own zone. UTC is included as the control: it
  // is the one zone where the old code was already right, so a fix that broke
  // it would show up here.
  for (const tz of ["America/Los_Angeles", "Pacific/Auckland", "Europe/Paris", "UTC"]) {
    it(`is exact at every local hour — ${tz}`, () => {
      inZone(tz, () => {
        const wrong: string[] = [];
        everyHourOf(2026, 7, 24, (h) => {
          for (const [d, want] of [["2026-08-24", 0], ["2026-08-23", 1], ["2026-08-20", 4]] as [string, number][]) {
            const got = daysSince(d);
            if (got !== want) wrong.push(`${h}h ${d}: ${got} instead of ${want}`);
          }
        });
        expect(wrong).toEqual([]);
      });
    });
  }

  it("still refuses garbage rather than returning NaN", () => {
    // The guard the function already carried: callers type it `number | null`
    // and assume null on a parse failure — NaN would break arithmetic silently.
    expect(daysSince("pas une date")).toBe(null);
    expect(daysSince("")).toBe(null);
  });

  it("still clamps a future date to 0", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 24, 12, 0));
    expect(daysSince("2026-12-25")).toBe(0);
  });
});

describe("fmtLotAge never prints twelve months", () => {
  // The function's own docstring promises months are capped at 11 — and the
  // cap was applied to the YEAR branch only. So a lot between 360 and 364 days
  // old read "12 mois" on the lot row, the card and the fiche, then flipped to
  // "1 an" the following week.
  const t = (k: string) => (k === "age_mo" ? "mois" : k === "age_y" ? "an" : k === "age_m" ? "m" : "j");

  it("caps the sub-year branch too", () => {
    expect([359, 360, 364].map((d) => fmtLotAge(d, t))).toEqual(["11mois", "11mois", "11mois"]);
  });

  it("leaves the rest of the ladder alone", () => {
    expect(fmtLotAge(0, t)).toBe("0j");
    expect(fmtLotAge(29, t)).toBe("29j");
    expect(fmtLotAge(30, t)).toBe("1mois");
    expect(fmtLotAge(365, t)).toBe("1an");
    expect(fmtLotAge(729, t)).toBe("1an 11m");
    expect(fmtLotAge(null, t)).toBe("—");
  });
});

describe("the activity strip walks CALENDAR days, not fixed 24-hour steps", () => {
  // Three copies of one geometry walked backwards in fixed 86 400 000 ms steps
  // (the grid builder, the month ticks, and the view's tap handler). Across a
  // DST transition that skips a local day outright, or emits one twice — so a
  // day's smoking vanishes from the calendar, and tapping the affected cell
  // filters the journal by the wrong date.
  //
  // Both directions are covered: spring forward LOSES a day, autumn back
  // DUPLICATES one. A test on one transition alone passes on half a fix.
  const CASES: [string, string, string][] = [
    ["Europe/Paris", "2026-03-30T00:30:00", "spring forward"],
    ["Europe/Paris", "2026-11-01T23:30:00", "autumn back"],
    ["America/Los_Angeles", "2026-03-08T23:30:00", "spring forward"],
    ["America/Los_Angeles", "2026-11-01T23:30:00", "autumn back"],
  ];

  for (const [tz, at, which] of CASES) {
    it(`covers each day exactly once — ${tz}, ${which}`, () => {
      inZone(tz, () => {
        const nowMs = new Date(at).getTime();
        const keys = heatmapDayKeys(10, nowMs);
        expect(keys).toHaveLength(70);
        expect(new Set(keys).size, "a local day appears twice").toBe(70);
        // Contiguous: each key is exactly one calendar day after the last.
        const gaps: string[] = [];
        for (let i = 1; i < keys.length; i++) {
          const prev = new Date(String(keys[i - 1]) + "T12:00:00");
          prev.setDate(prev.getDate() + 1);
          if (localDayKey(prev.getTime()) !== keys[i]) gaps.push(`${keys[i - 1]} → ${keys[i]}`);
        }
        expect(gaps, "a local day was skipped").toEqual([]);
        // …and the last cell is today.
        expect(keys[keys.length - 1]).toBe(localDayKey(nowMs));
      });
    });
  }

  it("no session disappears from the grid across a transition", () => {
    // The consequence, stated as the user meets it: the total says three, the
    // cells add up to two, and one evening of smoking is simply not on screen.
    inZone("Europe/Paris", () => {
      const nowMs = new Date("2026-03-30T00:30:00").getTime();
      const hm = computeActivityHeatmap(
        [{ date: "2026-03-29" }, { date: "2026-03-28" }, { date: "2026-03-27" }] as never,
        10, nowMs,
      );
      expect(hm.total).toBe(3);
      expect(hm.grid.flat().reduce((a, b) => a + b, 0), "a day of activity is missing").toBe(3);
    });
  });

  it("the month ticks stay aligned with the columns they label", () => {
    // Non-vacuity for the pair: the labels are derived separately, so a fix
    // applied to the grid alone would leave the ticks drifting against it.
    inZone("Europe/Paris", () => {
      const nowMs = new Date("2026-03-30T00:30:00").getTime();
      const keys = heatmapDayKeys(10, nowMs);
      const months = activityHeatmapMonths(10, nowMs);
      expect(months).toHaveLength(10);
      for (let c = 0; c < 10; c++) {
        const lastDayOfColumn = String(keys[c * 7 + 6]);
        expect(months[c], `column ${c}`).toBe(Number(lastDayOfColumn.slice(5, 7)) - 1);
      }
    });
  });
});

describe("no display date is built from the UTC day", () => {
  // `today()` was introduced because `toISOString().slice(0,10)` returns the
  // UTC day — a western user logging an evening session got TOMORROW. Four
  // sites survived that sweep, and each of them either WRITES a date into the
  // cellar or PRINTS one the user reads as a fact:
  //
  //   • the CSV importer's lifecycle back-fill  → a lot "mis en pot" tomorrow
  //   • the collection report's "Généré le"     → an insurance document dated
  //                                               tomorrow, disagreeing with
  //                                               its own filename
  //   • "Catalogue chargé le {d}" in Settings
  //   • the stale-version-check date in Settings
  //
  // Keyed on the PROPERTY (a day-granularity slice of an ISO string) rather
  // than on any one spelling, and swept over the whole of `src/` so the fifth
  // site cannot be added quietly. A full ISO stamp is untouched: `updatedAt`,
  // `deletedAt` and the OAuth markers are instants, and UTC is right for those.
  const files: string[] = [];
  function walk(dir: string) {
    for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
      const p = dir + "/" + e.name;
      if (e.isDirectory()) { if (e.name !== "__tests__") walk(p); }
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) files.push(p);
    }
  }
  beforeAll(() => walk("src"));

  // Comments blanked (length-preserving) first. Both fixed sites EXPLAIN
  // themselves by naming the construct they replaced, so a check that reads
  // its own prose as data would report them for ever — this repo has been
  // caught by that four times now.
  function blankComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
  }

  it("src/ contains no `toISOString().slice(0, 10)`", () => {
    const hits = files.filter((f) =>
      /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/.test(blankComments(readFileSync(f, "utf8"))));
    expect(hits, "a UTC day is being used where a local one is meant").toEqual([]);
  });

  it("…and the blanker did not simply blank the whole file", () => {
    // Non-vacuity for the blanking itself: a greedy or broken blanker would
    // silence the rule entirely and the sweep would pass on any codebase.
    const src = blankComments(readFileSync("src/utils.ts", "utf8"));
    expect(src).toContain("export function localDayKey");
    expect(src).not.toContain("returned the UTC day");
  });

  it("…and the sweep actually looked at the files", () => {
    // Non-vacuity: an empty list satisfies `toEqual([])` just as well.
    expect(files.length).toBeGreaterThan(60);
  });
});

describe("localDayKey is the one local-day formatter", () => {
  it("today() is localDayKey(now)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 24, 23, 30));
    expect(today()).toBe(localDayKey(Date.now()));
  });

  it("pads month and day", () => {
    expect(localDayKey(new Date(2026, 0, 5, 12, 0).getTime())).toBe("2026-01-05");
  });
});
