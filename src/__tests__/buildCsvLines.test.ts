import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExportImport } from "../hooks/useExportImport";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeLot(overrides: Record<string, any> = {}) {
  return {
    id: "L1",
    status: "cellar",
    weightG: "50",
    datePurchased: "2024-01-15",
    dateProduction: "",
    dateOpened: "",
    dateFinished: "",
    boxNumber: "1",
    price: "20",
    seller: "Store",
    disposed: false,
    ...overrides,
  };
}

function makeTobacco(id: number, lots: any[] = [], overrides: Record<string, any> = {}) {
  return {
    id,
    name: "Tobacco " + id,
    brand: "Brand",
    category: "Anglais",
    blend: "Latakia base",
    cut: "Ribbon",
    force: 3,
    roomNote: 2,
    taste: 4,
    rating: 4,
    rebuy: true,
    tastingNotes: "Smoky",
    description: "A classic",
    imageUrl: "",
    lots,
    agingMax: "10",
    ...overrides,
  };
}

function makeDeps(dataOverrides: Record<string, any> = {}, unitOverrides: Record<string, any> = {}) {
  const data = {
    tobaccos: [],
    pipes: [],
    wishlist: [],
    accessories: [],
    sessions: [],
    ...dataOverrides,
  };
  return {
    data,
    save: vi.fn(),
    migrateData: (d: any) => d,
    saveApiKey: vi.fn(),
    withPhotos: (d: any) => Promise.resolve(d),
    nav: vi.fn(),
    t: (k: string) => k,
    setImportModal: vi.fn(),
    setImgLocal: vi.fn(),
    excludeApiKey: false,
    apiKey: "",
    weightUnit: "g",
    lengthUnit: "mm",
    ageLabel: () => "",
    ...unitOverrides,
  };
}

function getLines(deps: any): string[] {
  const { result } = renderHook(() => useExportImport(deps));
  let lines: string[] = [];
  act(() => {
    lines = result.current.buildCsvLines();
  });
  return lines;
}

// ── header line ───────────────────────────────────────────────────────────────

describe("buildCsvLines — header line", () => {
  it("includes a header as the first line", () => {
    const deps = makeDeps();
    const lines = getLines(deps);
    expect(lines.length).toBeGreaterThan(0);
    // First line should contain "Marque" (tobacco section header)
    expect(lines[0]).toContain("Marque");
  });

  it("first line contains expected column names", () => {
    const deps = makeDeps();
    const lines = getLines(deps);
    expect(lines[0]).toContain("Nom");
    expect(lines[0]).toContain("Categorie");
    expect(lines[0]).toContain("Statut");
    expect(lines[0]).toContain("Image URL");
  });

  it("weight column header includes weightUnit", () => {
    const deps = makeDeps({}, { weightUnit: "oz" });
    const lines = getLines(deps);
    expect(lines[0]).toContain("oz");
  });
});

// ── tobacco rows ──────────────────────────────────────────────────────────────

describe("buildCsvLines — tobacco rows", () => {
  it("generates one data line for a tobacco with one lot", () => {
    const lot = makeLot();
    const tob = makeTobacco(1, [lot]);
    const deps = makeDeps({ tobaccos: [tob] });
    const lines = getLines(deps);
    // header + 1 data line + separator lines
    const tobLines = lines.filter(l => l.includes("Tobacco 1"));
    expect(tobLines).toHaveLength(1);
  });

  it("generates two data lines for a tobacco with two lots", () => {
    const lot1 = makeLot({ id: "L1", status: "cellar" });
    const lot2 = makeLot({ id: "L2", status: "jar" });
    const tob = makeTobacco(1, [lot1, lot2]);
    const deps = makeDeps({ tobaccos: [tob] });
    const lines = getLines(deps);
    const tobLines = lines.filter(l => l.includes("Tobacco 1"));
    expect(tobLines).toHaveLength(2);
  });

  it("generates one data line for a tobacco with no lots", () => {
    const tob = makeTobacco(1, []);
    const deps = makeDeps({ tobaccos: [tob] });
    const lines = getLines(deps);
    const tobLines = lines.filter(l => l.includes("Tobacco 1"));
    // tobacco with empty lots still generates one row (lots defaults to [{}])
    expect(tobLines).toHaveLength(1);
  });

  it("encodes tobacco brand and name in the row", () => {
    const lot = makeLot();
    const tob = makeTobacco(1, [lot], { brand: "Brackwater", name: "EMP" });
    const deps = makeDeps({ tobaccos: [tob] });
    const lines = getLines(deps);
    const tobLine = lines.find(l => l.includes("EMP"));
    expect(tobLine).toBeTruthy();
    expect(tobLine).toContain("Brackwater");
  });
});

// ── imageUrl handling ─────────────────────────────────────────────────────────

describe("buildCsvLines — imageUrl handling", () => {
  it("excludes local-photo- keys from image column", () => {
    const lot = makeLot();
    const tob = makeTobacco(1, [lot], { imageUrl: "local-photo-1747298765432" });
    const deps = makeDeps({ tobaccos: [tob] });
    const lines = getLines(deps);
    const tobLine = lines.find(l => l.includes("Tobacco 1"));
    expect(tobLine).not.toContain("local-photo-");
  });

  it("excludes data: base64 from image column", () => {
    const lot = makeLot();
    const tob = makeTobacco(1, [lot], { imageUrl: "data:image/jpeg;base64,/9j/4AAQ" });
    const deps = makeDeps({ tobaccos: [tob] });
    const lines = getLines(deps);
    const tobLine = lines.find(l => l.includes("Tobacco 1"));
    expect(tobLine).not.toContain("data:image");
  });

  it("preserves external URL in image column", () => {
    const lot = makeLot();
    const tob = makeTobacco(1, [lot], { imageUrl: "https://example.com/img.jpg" });
    const deps = makeDeps({ tobaccos: [tob] });
    const lines = getLines(deps);
    const tobLine = lines.find(l => l.includes("Tobacco 1"));
    expect(tobLine).toContain("https://example.com/img.jpg");
  });
});

// ── section separators ────────────────────────────────────────────────────────

describe("buildCsvLines — section separators", () => {
  it("includes '=== PIPES ===' section header", () => {
    const deps = makeDeps();
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("=== PIPES ==="))).toBe(true);
  });

  it("includes '=== WISHLIST ===' section header", () => {
    const deps = makeDeps();
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("=== WISHLIST ==="))).toBe(true);
  });

  it("includes '=== ACCESSOIRES ===' section header", () => {
    const deps = makeDeps();
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("=== ACCESSOIRES ==="))).toBe(true);
  });

  it("includes '=== SEANCES ===' section header", () => {
    const deps = makeDeps();
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("=== SEANCES ==="))).toBe(true);
  });
});

// ── session rows ──────────────────────────────────────────────────────────────

describe("buildCsvLines — session rows", () => {
  it("resolves tobacco name from id in session row", () => {
    const tob = makeTobacco(1, [], { brand: "Brackwater", name: "EMP" });
    const session = {
      id: 1,
      tobaccoId: 1,
      pipeId: "",
      date: "2024-01-15",
      duration: "45",
      weightG: "3",
      rating: 4,
      notes: "",
      lotId: "L1",
    };
    const deps = makeDeps({ tobaccos: [tob], sessions: [session] });
    const lines = getLines(deps);
    // Find session line (after the SEANCES header)
    const seancesIdx = lines.findIndex(l => l.includes("=== SEANCES ==="));
    expect(seancesIdx).toBeGreaterThan(-1);
    const sessionLines = lines.slice(seancesIdx + 2); // skip header row
    // dates in CSV are now formatted lang-aware (FR default → dd.mm.yyyy)
    const sessLine = sessionLines.find(l => l.includes("15.01.2024"));
    expect(sessLine).toBeTruthy();
    // Should contain resolved name, not raw id "1"
    expect(sessLine).toContain("Brackwater EMP");
  });

  it("leaves tobacco column empty when tobaccoId is missing", () => {
    const session = {
      id: 1,
      tobaccoId: "",
      pipeId: "",
      date: "2024-02-20",
      duration: "30",
      weightG: "2",
      rating: 3,
      notes: "",
      lotId: "",
    };
    const deps = makeDeps({ sessions: [session] });
    const lines = getLines(deps);
    const seancesIdx = lines.findIndex(l => l.includes("=== SEANCES ==="));
    const sessionLines = lines.slice(seancesIdx + 2);
    const sessLine = sessionLines.find(l => l.includes("20.02.2024"));
    expect(sessLine).toBeTruthy();
    // Tobacco column should be empty string
    expect(sessLine).toContain('""');
  });

  it("generates one session row per session entry", () => {
    const sess1 = { id: 1, tobaccoId: "", pipeId: "", date: "2024-01-01", duration: "30", weightG: "2", rating: 3, notes: "", lotId: "" };
    const sess2 = { id: 2, tobaccoId: "", pipeId: "", date: "2024-01-02", duration: "45", weightG: "3", rating: 4, notes: "", lotId: "" };
    const deps = makeDeps({ sessions: [sess1, sess2] });
    const lines = getLines(deps);
    const seancesIdx = lines.findIndex(l => l.includes("=== SEANCES ==="));
    const sessionLines = lines.slice(seancesIdx + 2).filter(l => l.trim() !== "");
    expect(sessionLines.length).toBeGreaterThanOrEqual(2);
  });
});

// ── pipes section ─────────────────────────────────────────────────────────────

describe("buildCsvLines — pipes section", () => {
  it("includes pipe data in the pipes section", () => {
    const pipe = {
      id: 1,
      name: "Dublin",
      brand: "Savinelli",
      shape: "Dublin",
      courbure: "Droite",
      length: "140",
      weight: "35",
      filterType: "9mm",
      chamberDiameter: "19",
      chamberDepth: "40",
      bowlMaterial: "Bruyère",
      stemMaterial: "Acrylique",
      datePurchased: "2024-01-01",
      dateProduction: "",
      price: "150",
      seller: "Store",
      rating: 4,
      status: "active",
      description: "Nice pipe",
      notes: "",
      imageUrl: "",
    };
    const deps = makeDeps({ pipes: [pipe] });
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("Savinelli") && l.includes("Dublin"))).toBe(true);
  });
});

// ── wishlist section ──────────────────────────────────────────────────────────

describe("buildCsvLines — wishlist section", () => {
  it("includes wishlist item in the wishlist section", () => {
    const wish = {
      id: 1,
      name: "Duskfall",
      brand: "Brackwater",
      category: "Anglais",
      blend: "",
      cut: "Ribbon",
      force: 4,
      roomNote: 3,
      taste: 5,
      description: "",
      tastingNotes: "",
      imageUrl: "",
      notes: "",
      priority: "medium",
      agingMax: "",
    };
    const deps = makeDeps({ wishlist: [wish] });
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("Duskfall"))).toBe(true);
  });
});

// ── Trash filtering ──────────────────────────────────────────────
// CSV is a working snapshot of the live inventory. Soft-deleted rows stay
// in the JSON / Drive backups (they ride the restore so the user keeps
// the safety net) but must NOT appear in CSV exports. Lots tagged
// `deletedAt` inside a still-live tobacco filter just their own row;
// trashed top-level rows filter the entire block.

describe("buildCsvLines — trash filtering", () => {
  it("skips tobaccos tagged with deletedAt", () => {
    const trashed = makeTobacco(1, [makeLot({ id: "L1" })], {
      brand: "TrashedBrand", name: "TrashedName",
      deletedAt: "2026-05-15T10:00:00Z",
    });
    const alive = makeTobacco(2, [makeLot({ id: "L2" })], {
      brand: "AliveBrand", name: "AliveName",
    });
    const deps = makeDeps({ tobaccos: [trashed, alive] });
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("AliveBrand"))).toBe(true);
    expect(lines.some(l => l.includes("TrashedBrand"))).toBe(false);
  });

  it("skips lots tagged with deletedAt inside a live tobacco", () => {
    const tob = makeTobacco(1, [
      makeLot({ id: "L1", boxNumber: "kept" }),
      makeLot({ id: "L2", boxNumber: "gone", deletedAt: "2026-05-15T10:00:00Z" }),
    ]);
    const deps = makeDeps({ tobaccos: [tob] });
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("kept"))).toBe(true);
    expect(lines.some(l => l.includes("gone"))).toBe(false);
  });

  it("skips pipes tagged with deletedAt", () => {
    const deps = makeDeps({
      pipes: [
        { id: 1, brand: "AlivePipe", name: "Trevi", shape: "Billiard" },
        { id: 2, brand: "TrashedPipe", name: "Gone", shape: "Apple",
          deletedAt: "2026-05-15T10:00:00Z" },
      ],
    });
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("AlivePipe"))).toBe(true);
    expect(lines.some(l => l.includes("TrashedPipe"))).toBe(false);
  });

  it("skips wishlist items tagged with deletedAt", () => {
    const deps = makeDeps({
      wishlist: [
        { id: 1, brand: "LiveWish", name: "OnList" },
        { id: 2, brand: "TrashedWish", name: "Off",
          deletedAt: "2026-05-15T10:00:00Z" },
      ],
    });
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("LiveWish"))).toBe(true);
    expect(lines.some(l => l.includes("TrashedWish"))).toBe(false);
  });

  it("skips accessories tagged with deletedAt", () => {
    const deps = makeDeps({
      accessories: [
        { id: 1, brand: "LiveAcc", name: "Old Boy", type: "Briquet" },
        { id: 2, brand: "TrashedAcc", name: "Gone", type: "Briquet",
          deletedAt: "2026-05-15T10:00:00Z" },
      ],
    });
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("LiveAcc"))).toBe(true);
    expect(lines.some(l => l.includes("TrashedAcc"))).toBe(false);
  });

  it("skips sessions tagged with deletedAt", () => {
    const tob = makeTobacco(1, [makeLot()], { brand: "TobBrand", name: "TobName" });
    const deps = makeDeps({
      tobaccos: [tob],
      sessions: [
        { id: 1, date: "2026-04-01", tobaccoId: 1, pipeId: "",
          duration: "30", rating: 4, notes: "kept-session" },
        { id: 2, date: "2026-04-02", tobaccoId: 1, pipeId: "",
          duration: "20", rating: 3, notes: "trashed-session",
          deletedAt: "2026-05-15T10:00:00Z" },
      ],
    });
    const lines = getLines(deps);
    expect(lines.some(l => l.includes("kept-session"))).toBe(true);
    expect(lines.some(l => l.includes("trashed-session"))).toBe(false);
  });
});

// ── session label fallback to snapshot ──────────────────────
// When the referenced tabac/pipe was hard-deleted, the live lookup map
// returns nothing — but the session carries a snapshot of brand/name at
// save time. The CSV used to end up with empty cells; it now falls
// back to the snapshot so the spreadsheet stays identifiable.

describe("buildCsvLines — session label fallback to snapshot", () => {
  it("falls back to tobaccoSnapshot when the live tabac is gone", () => {
    const session = {
      id: 1, tobaccoId: 999, pipeId: "", date: "2026-06-19",
      duration: "30", weightG: "2", rating: 3, notes: "",
      lotId: "",
      tobaccoSnapshot: { brand: "GoneBrand", name: "GoneName", imageUrl: "" },
    };
    // No matching tabac in the inventory.
    const deps = makeDeps({ tobaccos: [], sessions: [session] });
    const lines = getLines(deps);
    const sessLine = lines.find(l => l.includes("19.06.2026"))!;
    expect(sessLine).toContain("GoneBrand GoneName");
  });

  it("falls back to pipeSnapshot when the live pipe is gone", () => {
    const session = {
      id: 1, tobaccoId: "", pipeId: 999, date: "2026-06-19",
      duration: "30", weightG: "2", rating: 3, notes: "",
      lotId: "",
      pipeSnapshot: { brand: "OldPipeBrand", name: "OldDublin", imageUrl: "" },
    };
    const deps = makeDeps({ pipes: [], sessions: [session] });
    const lines = getLines(deps);
    const sessLine = lines.find(l => l.includes("19.06.2026"))!;
    expect(sessLine).toContain("OldPipeBrand OldDublin");
  });

  it("prefers the live tabac label over the snapshot when both exist", () => {
    const tob = { id: 5, brand: "LiveBrand", name: "LiveName", lots: [] };
    const session = {
      id: 1, tobaccoId: 5, pipeId: "", date: "2026-06-19",
      duration: "30", weightG: "2", rating: 3, notes: "",
      lotId: "",
      tobaccoSnapshot: { brand: "OldBrand", name: "OldName", imageUrl: "" },
    };
    const deps = makeDeps({ tobaccos: [tob], sessions: [session] });
    const lines = getLines(deps);
    const sessLine = lines.find(l => l.includes("19.06.2026"))!;
    expect(sessLine).toContain("LiveBrand LiveName");
    expect(sessLine).not.toContain("OldBrand");
  });
});

// ── session location columns ────────────────────────────────
// Sessions can carry optional WGS84 coordinates; the CSV exposes them as
// the trailing two columns so downstream consumers (spreadsheets, GIS
// imports) can map them. Missing values export as empty cells.

describe("buildCsvLines — session location", () => {
  it("session header has Latitude and Longitude as the last two columns", () => {
    const deps = makeDeps();
    const lines = getLines(deps);
    const seancesIdx = lines.findIndex(l => l.includes("=== SEANCES ==="));
    const header = lines[seancesIdx + 1]!;
    const cols = header.split(";");
    expect(cols[cols.length - 2]).toBe('"Latitude"');
    expect(cols[cols.length - 1]).toBe('"Longitude"');
  });

  it("populated lat / lng land in the session row", () => {
    const session = {
      id: 1, tobaccoId: "", pipeId: "", date: "2026-06-19",
      duration: "30", weightG: "2", rating: 3, notes: "",
      lotId: "", lat: 48.8566, lng: 2.3522,
    };
    const deps = makeDeps({ sessions: [session] });
    const lines = getLines(deps);
    const sessLine = lines.find(l => l.includes("19.06.2026"))!;
    expect(sessLine).toContain("48.8566");
    expect(sessLine).toContain("2.3522");
  });

  it("missing lat / lng export as empty cells (legacy sessions)", () => {
    const session = {
      id: 1, tobaccoId: "", pipeId: "", date: "2026-06-19",
      duration: "30", weightG: "2", rating: 3, notes: "no-loc",
      lotId: "",
    };
    const deps = makeDeps({ sessions: [session] });
    const lines = getLines(deps);
    const sessLine = lines.find(l => l.includes("no-loc"))!;
    // Last two columns should be empty quoted strings.
    expect(sessLine.endsWith('"";""')).toBe(true);
  });
});

// ── storage location column ───────────────────────────────────

describe("buildCsvLines — storage location", () => {
  it("header includes 'Lieu de stockage' and the lot value lands in the row", () => {
    const lot = makeLot({ storageLocation: "Armoire A" });
    const deps = makeDeps({ tobaccos: [makeTobacco(1, [lot])] });
    const { result } = renderHook(() => useExportImport(deps as any));
    const lines = result.current.buildCsvLines();
    expect(lines[0]).toContain("Lieu de stockage");
    const row = lines.find(l => l.includes("Tobacco 1"));
    expect(row).toBeTruthy();
    expect(row).toContain("Armoire A");
    // The column sits right after "No boite" — verify relative order.
    const headers = lines[0]!.split(";");
    expect(headers.indexOf('"Lieu de stockage"')).toBe(headers.indexOf('"No boite"') + 1);
  });

  it("legacy lots without the field export an empty cell (no crash)", () => {
    const deps = makeDeps({ tobaccos: [makeTobacco(1, [makeLot()])] });
    const { result } = renderHook(() => useExportImport(deps as any));
    expect(() => result.current.buildCsvLines()).not.toThrow();
  });
});
