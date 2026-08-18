// A lot date is displayed at the precision it was recorded at.
//
// A lot's PRODUCTION date is free-precision on purpose: a tin is often stamped
// 09/2017 with no day. The form says so — a text input with `2017-09` as its
// placeholder — `daysSince` parses it, and `normDate` preserves it through a
// CSV round-trip. Everything supported it EXCEPT the display: `fmtDate` only
// formatted the three-part form, so a month-precision date reached the fiche as
// a raw ISO string, sitting directly under a purchase date reading
// "23.03.2026". In English the mismatch was starker still: "2017-09" beside
// "Mar 23, 2026".
//
// Reported as « pourquoi afficher le jour également ? Pas logique » — the
// sharper framing, and the rule that follows from it: a day is shown if and
// only if a day was recorded.
//
// The CSV half is not decoration. The export writes dates through `fmtDate`,
// so formatting the month form CHANGED what lands in the file; without teaching
// `normDate` to read it back, a re-import would blank the production date —
// which also moves `lotMergeKey`, so the lot would come back as a DUPLICATE
// rather than merging. That failure has been paid for once already, and is
// recorded on `normDate`'s own YYYY-MM branch.

import { describe, it, expect } from "vitest";
import { fmtDate, daysSince } from "../utils";
import { parseTobaccoCsv } from "../utils/csvImport";

describe("fmtDate renders the precision it was given", () => {
  it("a full date keeps its day, in both formats", () => {
    expect(fmtDate("2025-08-01", "fr")).toBe("01.08.2025");
    expect(fmtDate("2025-08-01", "en")).toBe("Aug 1, 2025");
  });

  it("a month-precision date is FORMATTED and shows no day", () => {
    expect(fmtDate("2017-09", "fr")).toBe("09.2017");
    expect(fmtDate("2017-09", "en")).toBe("Sep 2017");
    // The defect, stated as the thing that must no longer happen: the raw ISO
    // string reaching the screen.
    expect(fmtDate("2017-09", "fr")).not.toBe("2017-09");
    expect(fmtDate("2017-09", "en")).not.toBe("2017-09");
  });

  it("does not invent a day anywhere in the output", () => {
    for (const lang of ["fr", "en"]) {
      const out = fmtDate("2017-09", lang);
      expect(out, lang).not.toMatch(/\b01\b/);
      expect(out, lang).not.toMatch(/\b1,/);
    }
  });

  it("a bare year passes through — it already reads as a year", () => {
    expect(fmtDate("2017", "fr")).toBe("2017");
    expect(fmtDate("2017", "en")).toBe("2017");
  });

  it("free text the user typed is left alone", () => {
    // `daysSince` still dates it, so blanking or mangling it would lose a
    // working value.
    expect(fmtDate("septembre 2017", "fr")).toBe("septembre 2017");
    expect(daysSince("septembre 2017")).toBeGreaterThan(0);
  });

  it("rejects an impossible month instead of formatting it", () => {
    // Untrusted input reaches here: a hand-edited backup, a CSV column.
    expect(fmtDate("2017-13", "fr")).toBe("2017-13");
    expect(fmtDate("2017-00", "fr")).toBe("2017-00");
  });

  it("still returns the em-dash for nothing", () => {
    expect(fmtDate("", "fr")).toBe("—");
  });
});

describe("the CSV round-trip keeps a month-precision production date", () => {
  // The export's own shape: one row per lot, header names the parser matches on.
  function csv(production: string): string {
    return [
      "Marque;Nom;Statut;Poids (g);Date achat;Date production;N° de boîte",
      `Halvorsen;Nordlys;Cave;100;23.03.2026;${production};116`,
    ].join("\n");
  }

  it("reads back the FR export form (mm.yyyy)", () => {
    const out = parseTobaccoCsv(csv("09.2017"));
    expect(out.tobaccos[0]!.lots[0]!.dateProduction).toBe("2017-09");
  });

  it("reads back the EN export form (Mon YYYY)", () => {
    const out = parseTobaccoCsv(csv("Sep 2017"));
    expect(out.tobaccos[0]!.lots[0]!.dateProduction).toBe("2017-09");
  });

  it("blanking it would be the costly failure, so it must not blank", () => {
    // Non-vacuity, and the reason the importer half exists: an empty
    // dateProduction moves `lotMergeKey`, so the lot returns as a duplicate
    // instead of merging.
    const out = parseTobaccoCsv(csv("09.2017"));
    expect(out.tobaccos[0]!.lots[0]!.dateProduction).not.toBe("");
  });

  it("does not mistake a day-precision date for a month one", () => {
    // `23.03.2026` has three groups and must keep taking the older branch.
    const out = parseTobaccoCsv(csv("01.08.2025"));
    expect(out.tobaccos[0]!.lots[0]!.dateProduction).toBe("2025-08-01");
    expect(out.tobaccos[0]!.lots[0]!.datePurchased).toBe("2026-03-23");
  });

  it("refuses an impossible month rather than storing it", () => {
    expect(parseTobaccoCsv(csv("13.2017")).tobaccos[0]!.lots[0]!.dateProduction).toBe("");
  });

  it("what fmtDate writes is what normDate reads — the two halves agree", () => {
    // The property that matters, asserted as a loop rather than as two fixed
    // strings: whatever the formatter emits for a month date, the importer must
    // resolve back to the same stored value.
    for (const lang of ["fr", "en"]) {
      for (const iso of ["2017-09", "2025-01", "2020-12"]) {
        const written = fmtDate(iso, lang);
        const back = parseTobaccoCsv(csv(written));
        expect(back.tobaccos[0]!.lots[0]!.dateProduction, `${lang} ${iso} → ${written}`).toBe(iso);
      }
    }
  });
});
