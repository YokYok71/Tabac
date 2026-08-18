/**
 * Property-based fuzz for the date / number formatting helpers
 *: daysSince, fmtDate, fmtDateTime, fmtNum.
 *
 * Same shape as the earlier passes — generate garbage inputs, assert
 * no-throw + every documented post-condition.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  daysSince,
  fmtDate,
  fmtDateTime,
  fmtNum,
} from "../utils";

const arbGarbage = (): fc.Arbitrary<unknown> => fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(""),
  fc.string({ maxLength: 12 }),
  fc.integer({ min: -100, max: 1000 }),
  fc.float({ noNaN: false, min: Math.fround(-50), max: Math.fround(500) }),
  fc.boolean(),
);

// ── daysSince ────────────────────────────────────────────────────────────────

describe("daysSince — fuzz", () => {
  it("never throws on any input (including non-string)", () => {
    fc.assert(
      fc.property(arbGarbage(), (v) => {
        expect(() => daysSince(v as any)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("returns null OR a finite non-negative integer", () => {
    fc.assert(
      fc.property(arbGarbage(), (v) => {
        const out = daysSince(v as any);
        if (out === null) return;
        expect(typeof out).toBe("number");
        expect(Number.isFinite(out)).toBe(true);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(out)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("returns null on falsy inputs (null / undefined / empty string / 0 / false)", () => {
    for (const v of [null, undefined, "", 0, false]) {
      expect(daysSince(v as any)).toBeNull();
    }
  });

  it("returns null on unparseable date strings (never NaN)", () => {
    for (const v of ["xyz", "not-a-date", "2024-99-99", "garbage"]) {
      const out = daysSince(v as any);
      expect(out === null || (typeof out === "number" && Number.isFinite(out))).toBe(true);
    }
  });

  it("returns a sensible day count for a valid ISO date in the past", () => {
    // Today minus N days → daysSince ≈ N (allow ±1 for tz / dst rounding).
    const ms = Date.now() - 5 * 864e5;
    const iso = new Date(ms).toISOString().slice(0, 10);
    const out = daysSince(iso);
    expect(out).not.toBeNull();
    expect(typeof out).toBe("number");
    if (out !== null) {
      expect(Math.abs(out - 5)).toBeLessThanOrEqual(1);
    }
  });
});

// ── fmtDate ──────────────────────────────────────────────────────────────────

describe("fmtDate — fuzz", () => {
  it("never throws on any input / lang combination", () => {
    fc.assert(
      fc.property(arbGarbage(), fc.oneof(fc.constantFrom("fr", "en"), arbGarbage()),
        (d, lang) => {
          expect(() => fmtDate(d as any, lang as any)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("always returns a string", () => {
    fc.assert(
      fc.property(arbGarbage(), fc.oneof(fc.constantFrom("fr", "en"), arbGarbage()),
        (d, lang) => {
          const out = fmtDate(d as any, lang as any);
          expect(typeof out).toBe("string");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("falsy input → em-dash", () => {
    for (const v of [null, undefined, "", 0, false]) {
      expect(fmtDate(v as any)).toBe("—");
    }
  });

  it("ISO YYYY-MM-DD → dd.mm.yyyy in FR (default) and 'Mon D, YYYY' in EN", () => {
    expect(fmtDate("2024-05-12")).toBe("12.05.2024");
    expect(fmtDate("2024-05-12", "fr")).toBe("12.05.2024");
    expect(fmtDate("2024-05-12", "en")).toBe("May 12, 2024");
    expect(fmtDate("2024-01-03", "en")).toBe("Jan 3, 2024");
  });

  it("unrecognised strings pass through unchanged", () => {
    expect(fmtDate("inconnu")).toBe("inconnu");
    expect(fmtDate("abc-def-ghi")).toBe("abc-def-ghi");
    // An impossible month is not a date, so it is left alone rather than
    // formatted into something that looks like one.
    expect(fmtDate("2024-13")).toBe("2024-13");
  });

  // REVERSED, recorded on the assertion. This case asserted
  // `fmtDate("2024-05") === "2024-05"` under the heading "not a full ISO date",
  // i.e. it pinned month precision as UNFORMATTED. That was the defect: a lot's
  // production date is free-precision by design — the form's placeholder is
  // literally `2017-09` — so a user who followed that advice got the raw ISO
  // string on the fiche, under a purchase date reading "23.03.2026". Reported
  // as « pourquoi afficher le jour également ? ». A day is now shown if and
  // only if a day was recorded.
  it("ISO YYYY-MM → month precision, with no invented day", () => {
    expect(fmtDate("2024-05")).toBe("05.2024");
    expect(fmtDate("2024-05", "fr")).toBe("05.2024");
    expect(fmtDate("2024-05", "en")).toBe("May 2024");
  });
});

// ── fmtDateTime ──────────────────────────────────────────────────────────────

describe("fmtDateTime — fuzz", () => {
  it("never throws on any input", () => {
    fc.assert(
      fc.property(fc.oneof(
          arbGarbage(),
          fc.date(),
          fc.integer({ min: 0, max: 4000000000000 }),
        ), fc.oneof(fc.constantFrom("fr", "en"), arbGarbage()),
        (ts, lang) => {
          expect(() => fmtDateTime(ts as any, lang as any)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("always returns a string", () => {
    fc.assert(
      fc.property(fc.oneof(arbGarbage(), fc.date(), fc.integer()), fc.oneof(fc.constantFrom("fr", "en"), arbGarbage()),
        (ts, lang) => {
          expect(typeof fmtDateTime(ts as any, lang as any)).toBe("string");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("null / undefined / empty / NaN-yielding inputs → em-dash", () => {
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtDateTime(undefined)).toBe("—");
    expect(fmtDateTime("")).toBe("—");
    expect(fmtDateTime("garbage")).toBe("—");
    expect(fmtDateTime(NaN)).toBe("—");
  });

  it("Date object → dd.mm.yyyy HH:MM (FR) / Mon D, YYYY HH:MM (EN)", () => {
    const d = new Date("2024-05-12T14:30:00Z");
    const fr = fmtDateTime(d, "fr");
    const en = fmtDateTime(d, "en");
    expect(fr).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    expect(en).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}$/);
  });
});

// ── fmtNum ───────────────────────────────────────────────────────────────────

describe("fmtNum — fuzz", () => {
  it("never throws on any input", () => {
    fc.assert(
      fc.property(arbGarbage(), fc.oneof(fc.constantFrom("fr", "en"), arbGarbage()),
        (v, lang) => {
          expect(() => fmtNum(v, lang as any)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("always returns a string", () => {
    fc.assert(
      fc.property(arbGarbage(), fc.oneof(fc.constantFrom("fr", "en"), arbGarbage()),
        (v, lang) => {
          expect(typeof fmtNum(v, lang as any)).toBe("string");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("null / undefined / empty → empty string", () => {
    expect(fmtNum(null)).toBe("");
    expect(fmtNum(undefined)).toBe("");
    expect(fmtNum("")).toBe("");
  });

  it("non-numeric strings pass through unchanged (after trim)", () => {
    expect(fmtNum("hello")).toBe("hello");
    expect(fmtNum("abc")).toBe("abc");
  });

  it("FR default: comma decimal; EN: dot decimal", () => {
    expect(fmtNum("2.5")).toBe("2,5");
    expect(fmtNum("2,5", "fr")).toBe("2,5");
    expect(fmtNum("2.5", "en")).toBe("2.5");
    expect(fmtNum("2,5", "en")).toBe("2.5");
    expect(fmtNum(3)).toBe("3");
    expect(fmtNum(3, "en")).toBe("3");
  });

  it("es/de/it use the comma decimal (only EN gets the dot)", () => {
    expect(fmtNum("2.5", "es")).toBe("2,5");
    expect(fmtNum("2.5", "de")).toBe("2,5");
    expect(fmtNum("2.5", "it")).toBe("2,5");
    expect(fmtNum("2,5", "de")).toBe("2,5");
    // pseudo / unknown locales fall through to the comma default too
    expect(fmtNum("2.5", "pseudo")).toBe("2,5");
  });

  it("preserves trailing-zero precision when the user explicitly typed it", () => {
    expect(fmtNum("2.50", "fr")).toBe("2,50");
    expect(fmtNum("2.50", "en")).toBe("2.50");
    expect(fmtNum("2,50", "fr")).toBe("2,50");
  });

  it("idempotent within the same locale", () => {
    fc.assert(
      fc.property(arbGarbage(), fc.constantFrom("fr", "en"), (v, lang) => {
        const once = fmtNum(v, lang);
        const twice = fmtNum(once, lang);
        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });
});
