/**
 * end-to-end CSV round-trip: export → simulated spreadsheet edit
 * → re-import (merge). Exercises the REAL pipeline with no mocks in the middle:
 *
 *   buildCsvLines()  (useExportImport, the real export columns)
 *      → parseTobaccoCsv()  (the real header-matched parser)
 *         → useImportConfirm merge (the real lot-level merge)
 *
 * Verifies that a lot added to an existing blend in the spreadsheet lands on
 * that blend on re-import (no duplicate tobacco, the pre-existing lot is not
 * re-added), and that re-importing an UNEDITED export is idempotent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExportImport } from "../hooks/useExportImport";
import { useImportConfirm } from "../hooks/useImportConfirm";
import { parseTobaccoCsv } from "../utils/csvImport";
import { migrateData } from "../utils";
import { INIT } from "../constants";

beforeEach(() => { vi.clearAllMocks(); });

// A cellar with one blend carrying one fully-specified lot (so lotMergeKey
// round-trips through the CSV columns).
function makeCellar() {
  return {
    ...INIT,
    tobaccos: [{
      id: 1, brand: "Brackwater", name: "Duskfall",
      category: "Anglais", cut: "Ribbon", blend: "", force: "4", roomNote: "3",
      taste: "3", rating: "4", rebuy: true, tastingNotes: "", description: "",
      agingMax: "", imageUrl: "",
      lots: [{
        id: 100, status: "cellar", weightG: "50", weightInitial: "50",
        originalStatus: "cellar", datePurchased: "2024-03-15", dateProduction: "2022",
        boxNumber: "1", storageLocation: "", price: "14.90", seller: "smokingpipes.com",
        sellerUrl: "", disposed: false,
      }],
    }],
    nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
  };
}

function exportProps(data: any) {
  return {
    data,
    save: vi.fn(),
    withPhotos: vi.fn().mockImplementation((d: any) => Promise.resolve(d)),
    nav: vi.fn(),
    t: (k: string) => k,
    excludeApiKey: false,
    apiKey: "",
    weightUnit: "g",
    lengthUnit: "mm",
    currencySymbol: "€",
    dateFormat: "fr",
    ageLabel: () => "",
    stageImport: vi.fn(),
  };
}

function importProps(data: any, save: any) {
  return {
    data,
    save,
    migrateData,          // the REAL migrate (runs the lot dedup pre-pass)
    saveApiKey: vi.fn(),
    setImgLocal: vi.fn(),
    setImportModal: vi.fn(),
    nav: vi.fn(),
    t: (k: string) => k,
  };
}

// Build the exported CSV text for `data`, keeping only the tabac section (the
// parser stops at the first === SECTION === marker anyway).
function exportCsv(data: any): string {
  const { result } = renderHook(() => useExportImport(exportProps(data) as any));
  return result.current.buildCsvLines().join("\r\n");
}

describe("CSV round-trip: export → edit → re-import", () => {
  it("adds a lot edited into the spreadsheet onto the existing blend, without duplicating it", () => {
    const cellar = makeCellar();
    const csv = exportCsv(cellar);

    // Simulate a spreadsheet edit: clone the blend's single data row and give
    // the clone a new box number + weights + purchase date (a genuinely new
    // lot of the same blend). Column matched by HEADER NAME so this is robust
    // to column reordering.
    // buildCsvLines quotes every cell ("a";"b"…) — strip the outer quotes to
    // work with plain cell values (the fixture has no embedded quotes/;).
    const unquote = (line: string) => line.split(";").map((c) => c.replace(/^"|"$/g, ""));
    const rows = csv.split("\r\n");
    const header = unquote(rows[0]!);
    const boxIdx = header.indexOf("No boite");
    const wIdx = header.indexOf("Poids (g)");
    const wiIdx = header.indexOf("Poids initial (g)");
    const dpIdx = header.indexOf("Date achat");
    expect(boxIdx).toBeGreaterThanOrEqual(0);
    // rows[1] is the blend's only lot row (rows[2+] start the === PIPES === section).
    const dataRow = unquote(rows[1]!);
    const newRow = dataRow.slice();
    newRow[boxIdx] = "2";
    newRow[wIdx] = "100";
    newRow[wiIdx] = "100";
    newRow[dpIdx] = "10.01.2025"; // fr display format (parser reads dd.mm.yyyy)
    // Emit just the tabac section (parser stops at the first === marker anyway):
    // header + original row + the injected new lot, plain (unquoted) cells.
    const edited = [header.join(";"), dataRow.join(";"), newRow.join(";")].join("\r\n");

    const parsed = parseTobaccoCsv(edited);
    // One blend (rows collapsed by brand+name), two lots.
    expect(parsed.tobaccos).toHaveLength(1);
    expect(parsed.tobaccos[0]!.lots).toHaveLength(2);

    // Re-import (merge) into the ORIGINAL cellar.
    const save = vi.fn();
    let summary: any = null;
    const { result } = renderHook(() => useImportConfirm(importProps(cellar, save) as any));
    act(() => {
      result.current.stageImport({ tobaccos: parsed.tobaccos }, "file", {
        autoApply: "merge",
        onMerged: (s: any) => { summary = s; },
      });
    });

    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos).toHaveLength(1);         // no duplicate blend
    const lots = saved.tobaccos[0].lots;
    expect(lots).toHaveLength(2);                    // original box 1 + new box 2
    expect(lots.map((l: any) => l.boxNumber).sort()).toEqual(["1", "2"]);
    // The recap reports exactly one lot topped up onto one existing blend.
    expect(summary).toBeTruthy();
    expect(summary.lotsAppended).toBe(1);
    expect(summary.blendsToppedUp).toBe(1);
    expect(summary.tobaccosAdded).toBe(0);
  });

  it("is idempotent: re-importing an UNEDITED export adds no lot", () => {
    const cellar = makeCellar();
    const csv = exportCsv(cellar);
    const parsed = parseTobaccoCsv(csv);
    expect(parsed.tobaccos).toHaveLength(1);
    expect(parsed.tobaccos[0]!.lots).toHaveLength(1);

    const save = vi.fn();
    let summary: any = null;
    const { result } = renderHook(() => useImportConfirm(importProps(cellar, save) as any));
    act(() => {
      result.current.stageImport({ tobaccos: parsed.tobaccos }, "file", {
        autoApply: "merge",
        onMerged: (s: any) => { summary = s; },
      });
    });

    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos).toHaveLength(1);
    expect(saved.tobaccos[0].lots).toHaveLength(1); // no re-added lot
    expect(summary.lotsAppended).toBe(0);
    expect(summary.blendsToppedUp).toBe(0);
  });
});
