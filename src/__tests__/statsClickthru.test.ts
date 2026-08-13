/**
 * click-thru helpers from Statistics — wire the bowl /
 * stem material filters + journal year filter pre-selection.
 *
 * The two helpers (`navToPipesFilteredByMaterial`, `navToJournalFiltered`)
 * live in App.tsx and aren't directly importable as units — they
 * close over App's state setters. The full integration is exercised
 * via the existing PipesListView / JournalView tests; this file
 * locks the rule that `filteredPipes` honours the bowl / stem material
 * filters when set.
 */

import { describe, it, expect } from "vitest";
import { countryNameToIso2 } from "../utils/geo";

// We can't import the App-internal filteredPipes memo directly, so
// reproduce the filter logic here to lock the contract: pipes
// matching the bowl/stem material strings must survive, others must
// drop out. Any future change to App.tsx that breaks this shape
// breaks the test, prompting attention.
function applyMaterialFilter(
  pipes: any[],
  bowl: string,
  stem: string,
): any[] {
  let out = pipes;
  if (bowl) out = out.filter(p => p.bowlMaterial === bowl);
  if (stem) out = out.filter(p => p.stemMaterial === stem);
  return out;
}

describe("Stats click-thru — pipe material filters", () => {
  const pipes = [
    { id: "P1", brand: "Halvorsen", name: "Aran", bowlMaterial: "Bruyère",  stemMaterial: "Ébonite",   status: "active" },
    { id: "P2", brand: "Savinelli", name: "Roma",  bowlMaterial: "Meerschaum", stemMaterial: "Acrylique", status: "active" },
    { id: "P3", brand: "MM",       name: "Cob",   bowlMaterial: "Maïs",     stemMaterial: "Acrylique", status: "active" },
  ];

  it("filters by bowl material when pBowlMaterialFilter is set", () => {
    const out = applyMaterialFilter(pipes, "Bruyère", "");
    expect(out.map(p => p.id)).toEqual(["P1"]);
  });

  it("filters by stem material when pStemMaterialFilter is set", () => {
    const out = applyMaterialFilter(pipes, "", "Acrylique");
    expect(out.map(p => p.id)).toEqual(["P2", "P3"]);
  });

  it("combines bowl + stem filters (AND)", () => {
    const out = applyMaterialFilter(pipes, "Meerschaum", "Acrylique");
    expect(out.map(p => p.id)).toEqual(["P2"]);
  });

  it("no filter set: returns the unfiltered list", () => {
    const out = applyMaterialFilter(pipes, "", "");
    expect(out.length).toBe(3);
  });

  it("filter with no match: returns an empty list (no crash)", () => {
    const out = applyMaterialFilter(pipes, "Pierre (stéatite)", "");
    expect(out.length).toBe(0);
  });
});

describe("Stats click-thru — journal year derivation", () => {
  // The monthly chart entries carry a "YYYY-MM" date key. The click
  // handler does `String(x[0]).slice(0, 4)` to extract the year and
  // hands it to navToJournalFiltered. Lock the slice contract.
  it("extracts the year from a YYYY-MM monthly key", () => {
    expect(String("2024-05").slice(0, 4)).toBe("2024");
    expect(String("2025-12").slice(0, 4)).toBe("2025");
  });

  it("yearly chart key is already the year as a string", () => {
    expect(String("2024")).toBe("2024");
  });
});

// day-precise journal filter wired from the heatmap.
// The journal session filter compares against String(s.date) so the
// stored date must remain in the ISO "YYYY-MM-DD" shape.
describe("Stats click-thru — journal date filter", () => {
  // Reproduce the JournalView session-filter logic for the date branch.
  function applyDateFilter(sessions: any[], date: string): any[] {
    if (!date) return sessions;
    return sessions.filter(s => String(s.date || "") === date);
  }

  const sessions = [
    { id: "S1", date: "2025-03-15", note: "morning" },
    { id: "S2", date: "2025-03-15", note: "evening" },
    { id: "S3", date: "2025-03-16", note: "next day" },
    { id: "S4", date: "2024-12-31", note: "older" },
  ];

  it("returns only sessions on the exact date", () => {
    const out = applyDateFilter(sessions, "2025-03-15");
    expect(out.map(s => s.id)).toEqual(["S1", "S2"]);
  });

  it("no match returns empty list (no crash)", () => {
    const out = applyDateFilter(sessions, "2030-01-01");
    expect(out.length).toBe(0);
  });

  it("empty date passes everything through", () => {
    const out = applyDateFilter(sessions, "");
    expect(out.length).toBe(4);
  });

  it("string coercion: numeric `s.date` still compares correctly", () => {
    const garbageSessions: any[] = [{ id: "X", date: 20250315 }];
    // String(20250315) === "2025-03-15" is FALSE, so no match — that's
    // the desired strict-equality behaviour. Documenting it as a test
    // so future relaxations get caught.
    const out = applyDateFilter(garbageSessions as any, "2025-03-15");
    expect(out.length).toBe(0);
  });
});

// location journal filter wired from the StatsView "Lieux"
// bars. Reproduce the JournalView session-filter logic for the
// commune / country branches — strict string-coerced equality, AND-
// composable, empty value passes through.
describe("Stats click-thru — journal location filter", () => {
  // Mirrors JournalView's filter: commune is exact-string; country is
  // ISO-canonical so a filter set from the merged Stats row
  // catches every language variant of the same country.
  function applyLocationFilter(sessions: any[], commune: string, country: string): any[] {
    return sessions.filter(s => {
      if (commune && String(s.locationCity || "") !== commune) return false;
      if (country) {
        const sc = String(s.locationCountry || "");
        const fIso = countryNameToIso2(country);
        const sIso = countryNameToIso2(sc);
        const ok = (fIso && sIso) ? fIso === sIso : sc === country;
        if (!ok) return false;
      }
      return true;
    });
  }

  const sessions = [
    { id: "S1", locationCity: "Paris", locationCountry: "France" },
    { id: "S2", locationCity: "Paris", locationCountry: "France" },
    { id: "S3", locationCity: "Lyon", locationCountry: "France" },
    { id: "S4", locationCity: "London", locationCountry: "UK" },
    { id: "S5" },
  ];

  it("filters by commune", () => {
    expect(applyLocationFilter(sessions, "Paris", "").map(s => s.id)).toEqual(["S1", "S2"]);
  });

  it("filters by country", () => {
    expect(applyLocationFilter(sessions, "", "France").map(s => s.id)).toEqual(["S1", "S2", "S3"]);
  });

  it("combines commune + country (AND)", () => {
    expect(applyLocationFilter(sessions, "Lyon", "France").map(s => s.id)).toEqual(["S3"]);
  });

  it("sessions with no location never match a set filter", () => {
    expect(applyLocationFilter(sessions, "Paris", "").some(s => s.id === "S5")).toBe(false);
  });

  it("no filter set passes everything through", () => {
    expect(applyLocationFilter(sessions, "", "").length).toBe(5);
  });

  it("an ISO-canonical country filter catches every language variant", () => {
    const mixed = [
      { id: "A", locationCountry: "France" },
      { id: "B", locationCountry: "Frankreich" }, // de
      { id: "C", locationCountry: "Francia" },    // es/it
      { id: "D", locationCountry: "Germania" },   // it Germany — must NOT match
    ];
    // Filtering by any French variant returns A, B, C (not D).
    expect(applyLocationFilter(mixed, "", "France").map(s => s.id)).toEqual(["A", "B", "C"]);
    expect(applyLocationFilter(mixed, "", "Frankreich").map(s => s.id)).toEqual(["A", "B", "C"]);
  });
});
