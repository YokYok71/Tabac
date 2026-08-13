// Tests for the pure CSV → tobaccos parser.

import { describe, it, expect } from "vitest";
import { parseTobaccoCsv } from "../utils/csvImport";
import { checkAllInvariants } from "../utils/lotInvariants";

const HEAD = "Marque;Nom;Categorie;Coupe;Force;Room Note;Gout;Note;A reprendre;Age max cave (ans);Statut;Poids (g);Poids initial (g);Date achat;Date production;Prix (€);Vendeur;No boite;Lieu de stockage;Description;Notes degustation";

describe("parseTobaccoCsv", () => {
  it("returns empty on non-string / blank / headerless input", () => {
    expect(parseTobaccoCsv("" as any).tobaccos).toEqual([]);
    expect(parseTobaccoCsv(null as any).tobaccos).toEqual([]);
    expect(parseTobaccoCsv("   \n  ").tobaccos).toEqual([]);
    // header without brand/name → nothing to key on
    expect(parseTobaccoCsv("Prix;Poids\n10;20").tobaccos).toEqual([]);
  });

  it("parses a single tobacco + lot with coercions", () => {
    const csv = HEAD + "\nHalvorsen;Early Tide;Virginia/Burley;Flake;3;2;3;4;Oui;12;Pot;40;50;2024-03-15;2022;14.90;smokingpipes.com;A12;Armoire A;Un flake;Miel";
    const r = parseTobaccoCsv(csv, { idBase: 1 });
    expect(r.rows).toBe(1);
    expect(r.tobaccos).toHaveLength(1);
    const t = r.tobaccos[0];
    expect(t.brand).toBe("Halvorsen");
    expect(t.name).toBe("Early Tide");
    expect(t.category).toBe("Virginia/Burley");
    expect(t.cut).toBe("Flake");
    expect(t.force).toBe(3);
    expect(t.rating).toBe(4);
    expect(t.rebuy).toBe(true);
    expect(t.agingMax).toBe("12");
    expect(t.description).toBe("Un flake");
    expect(t.tastingNotes).toBe("Miel");
    expect(t.lots).toHaveLength(1);
    const lot = t.lots[0];
    expect(lot.status).toBe("jar");
    expect(lot.weightG).toBe("40");
    expect(lot.weightInitial).toBe("50");
    expect(lot.datePurchased).toBe("2024-03-15");
    expect(lot.dateProduction).toBe("2022");
    expect(lot.price).toBe("14.9");
    expect(lot.seller).toBe("smokingpipes.com");
    expect(lot.boxNumber).toBe("A12");
    expect(lot.storageLocation).toBe("Armoire A");
  });

  // A hand-edited row with weightG >
  // weightInitial can't be a real smoked-down lot. Clamp the initial UP to the
  // current so the imported lot is coherent (never a balance-overflow lot).
  it("clamps weightInitial up to weightG when a row has current > initial", () => {
    const csv = HEAD + "\nBrandX;NameX;;;;;;;;;Cave;50;30;;;;;;;;";
    const r = parseTobaccoCsv(csv);
    const lot = r.tobaccos[0].lots[0];
    expect(lot.weightG).toBe("50");
    expect(lot.weightInitial).toBe("50"); // clamped up from 30
  });

  it("groups rows with the same brand+name into one tobacco with several lots", () => {
    const csv = HEAD +
      "\nHalvorsen;Early Tide;;;;;;;;;Pot;40;50;;;;;;;;" +
      "\nhalvorsen;EARLY TIDE;;;;;;;;;Cave;100;100;;;;;;;;";  // case-insensitive dup
    const r = parseTobaccoCsv(csv);
    expect(r.tobaccos).toHaveLength(1);
    expect(r.tobaccos[0].lots).toHaveLength(2);
    expect(r.tobaccos[0].lots.map((l: any) => l.status)).toEqual(["jar", "cellar"]);
    expect(r.lots).toBe(2);
  });

  it("accepts a minimal subset (Marque;Nom only)", () => {
    const r = parseTobaccoCsv("Marque;Nom\nBrackwater;Duskfall");
    expect(r.tobaccos).toHaveLength(1);
    expect(r.tobaccos[0].brand).toBe("Brackwater");
    expect(r.tobaccos[0].lots).toHaveLength(0);   // no lot data → no lot
  });

  it("auto-detects a comma delimiter and EN headers", () => {
    const r = parseTobaccoCsv("Brand,Name,Category,Status,Weight (g),Price\nBrackwater,Duskfall,Latakia,jar,25,13");
    expect(r.tobaccos).toHaveLength(1);
    expect(r.tobaccos[0].category).toBe("Latakia");
    expect(r.tobaccos[0].lots[0].status).toBe("jar");
    expect(r.tobaccos[0].lots[0].weightG).toBe("25");
    expect(r.tobaccos[0].lots[0].price).toBe("13");
  });

  it("snaps unknown category/cut to Autre and clamps ratings", () => {
    const r = parseTobaccoCsv("Marque;Nom;Categorie;Coupe;Force;Note\nX;Y;Bogus;Nope;9;-3");
    expect(r.tobaccos[0].category).toBe("Autre");
    expect(r.tobaccos[0].cut).toBe("Autre");
    expect(r.tobaccos[0].force).toBe(5);   // 9 → 5
    expect(r.tobaccos[0].rating).toBe(0);  // -3 → 0
  });

  it("handles quoted fields with embedded delimiter and newline", () => {
    const csv = 'Marque;Nom;Description\n"Halvorsen";"My, Blend";"line1\nline2"';
    const r = parseTobaccoCsv(csv);
    expect(r.tobaccos).toHaveLength(1);
    expect(r.tobaccos[0].name).toBe("My, Blend");
    expect(r.tobaccos[0].description).toBe("line1\nline2");
  });

  it("strips a BOM and tolerates CRLF", () => {
    const r = parseTobaccoCsv("﻿Marque;Nom\r\nBrackwater;Duskfall\r\n");
    expect(r.tobaccos).toHaveLength(1);
    expect(r.tobaccos[0].brand).toBe("Brackwater");
  });

  it("normalises dd.mm.yyyy dates and blanks garbage numbers", () => {
    const r = parseTobaccoCsv("Marque;Nom;Statut;Poids (g);Prix (€);Date achat\nX;Y;Cave;abc;-5;15.03.2024");
    const lot = r.tobaccos[0].lots[0];
    expect(lot.weightG).toBe("");
    expect(lot.price).toBe("");
    expect(lot.datePurchased).toBe("2024-03-15");
  });

  it("parses À reprendre / Éliminé variants", () => {
    const r = parseTobaccoCsv("Marque;Nom;A reprendre;Statut;Poids (g);Éliminé\nX;Y;Non;Fini;0;Oui");
    expect(r.tobaccos[0].rebuy).toBe(false);
    expect(r.tobaccos[0].lots[0].status).toBe("finished");
    expect(r.tobaccos[0].lots[0].disposed).toBe(true);
  });

  it("skips rows with neither brand nor name and counts them", () => {
    const r = parseTobaccoCsv("Marque;Nom;Poids (g)\n;;40\nBrackwater;Duskfall;25");
    expect(r.tobaccos).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });

  it("assigns unique ids to tobaccos and lots", () => {
    const csv = HEAD.split(";").slice(0, 2).join(";") + ";Statut;Poids (g)\nA;X;Cave;10\nB;Y;Cave;20";
    const r = parseTobaccoCsv(csv, { idBase: 1 });
    const ids = r.tobaccos.map((t: any) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const lotIds = r.tobaccos.flatMap((t: any) => t.lots.map((l: any) => l.id));
    expect(new Set(lotIds).size).toBe(lotIds.length);
  });

  it("never throws on ragged / garbage rows", () => {
    expect(() => parseTobaccoCsv("Marque;Nom\nonlyone\n;;;;;;\nA;B;C;D;E")).not.toThrow();
  });

  it("stops at a === SECTION === marker (multi-section export CSV) and flags it", () => {
    const csv = "Marque;Nom;Statut;Poids (g)\n" +
      "Brackwater;Duskfall;Pot;25\n" +
      "=== PIPES ===\n" +
      "Halvorsen;Sherlock;Billiard;80\n" +   // pipe row — must NOT become a tobacco
      "=== JOURNAL ===\n";
    const r = parseTobaccoCsv(csv);
    expect(r.sectioned).toBe(true);
    expect(r.tobaccos).toHaveLength(1);
    expect(r.tobaccos[0].brand).toBe("Brackwater");
    // no junk tobacco named "=== PIPES ===" or "Halvorsen" from the pipe section
    expect(r.tobaccos.map((t: any) => t.brand)).not.toContain("=== PIPES ===");
    expect(r.tobaccos.map((t: any) => t.brand)).not.toContain("Halvorsen");
  });

  it("sectioned is false for a plain tobacco CSV", () => {
    expect(parseTobaccoCsv("Marque;Nom\nBrackwater;Duskfall").sectioned).toBe(false);
  });

  it("stops at an apostrophe-prefixed section marker (export formula-guard)", () => {
    // The real export writes "'=== PIPES ===" (csvEsc prefixes "'" to cells
    // starting with "="). The parser must still treat it as a section marker.
    const csv = "Marque;Nom;Statut;Poids (g)\n" +
      "Brackwater;Duskfall;Pot;25\n" +
      "'=== PIPES ===\n" +
      "Halvorsen;Sherlock;Billiard;80\n";
    const r = parseTobaccoCsv(csv);
    expect(r.sectioned).toBe(true);
    expect(r.tobaccos.map((t: any) => t.brand)).toEqual(["Brackwater"]);
  });

  it("reads the seller URL column (site vendeur)", () => {
    const r = parseTobaccoCsv("Marque;Nom;Statut;Poids (g);Vendeur;Site vendeur\nX;Y;Cave;10;shop;https://shop.example");
    expect(r.tobaccos[0].lots[0].seller).toBe("shop");
    expect(r.tobaccos[0].lots[0].sellerUrl).toBe("https://shop.example");
  });

  it("parses EN-locale export dates so a CSV from an EN-date user round-trips", () => {
    // fmtDate en-mode produces "Mar 15, 2024" — the parser must read it back.
    const r = parseTobaccoCsv("Marque;Nom;Statut;Poids (g);Date achat;Date production\nX;Y;Cave;10;Mar 15, 2024;Jan 3, 2022");
    const lot = r.tobaccos[0].lots[0];
    expect(lot.datePurchased).toBe("2024-03-15");
    expect(lot.dateProduction).toBe("2022-01-03");
  });

  it("rejects a garbage month name", () => {
    const r = parseTobaccoCsv("Marque;Nom;Statut;Poids (g);Date achat\nX;Y;Cave;10;Zzz 40, 2024");
    expect(r.tobaccos[0].lots[0].datePurchased).toBe("");
  });

  // A partial YYYY-MM production date must round-trip
  // verbatim (fmtDate passes it through), else lotMergeKey changes and a
  // re-import duplicates the lot.
  it("keeps a partial YYYY-MM date verbatim", () => {
    const r = parseTobaccoCsv("Marque;Nom;Statut;Poids (g);Date production\nX;Y;Cave;10;2017-09");
    expect(r.tobaccos[0].lots[0].dateProduction).toBe("2017-09");
  });

  it("ignores prototype-key columns (__proto__ / constructor) without leaking non-strings", () => {
    // A column literally named __proto__ or constructor resolves through the
    // prototype chain of the HEADER_ALIASES literal — must be treated as an
    // unknown (ignored) column, never a recognised one.
    const r = parseTobaccoCsv("__proto__;constructor;Marque;Nom;Poids (g);Statut\npoison;evil;Brackwater;Duskfall;25;Pot");
    expect(r.tobaccos).toHaveLength(1);
    expect(r.tobaccos[0].brand).toBe("Brackwater");
    expect(r.tobaccos[0].name).toBe("Duskfall");
    expect(r.tobaccos[0].lots[0].weightG).toBe("25");
    // headers is declared string[] — no Object.prototype / Object leaked in
    expect(r.headers.every((h) => typeof h === "string")).toBe(true);
    expect(r.headers).not.toContain("__proto__");
    // no prototype pollution of plain objects
    expect(({} as any).poison).toBeUndefined();
  });
});

// row cap (defence-in-depth) + property-based robustness fuzz.
import fc from "fast-check";
import { MAX_ROWS } from "../utils/csvImport";

describe("parseTobaccoCsv — row cap", () => {
  it("caps at MAX_ROWS data rows and flags it", () => {
    // Build a header + (MAX_ROWS + 50) data rows quickly.
    const rows: string[] = ["Marque;Nom;Statut;Poids (g)"];
    for (let i = 0; i < MAX_ROWS + 50; i++) rows.push("B" + i + ";N" + i + ";Cave;10");
    const r = parseTobaccoCsv(rows.join("\n"));
    expect(r.capped).toBe(true);
    expect(r.rows).toBe(MAX_ROWS);
    expect(r.tobaccos.length).toBe(MAX_ROWS);
  });

  it("does not flag capped for a normal-size file", () => {
    expect(parseTobaccoCsv("Marque;Nom\nA;B\nC;D").capped).toBe(false);
  });
});

describe("parseTobaccoCsv — property fuzz", () => {
  it("never throws and always returns a well-typed result on arbitrary strings", () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const r = parseTobaccoCsv(s);
      expect(Array.isArray(r.tobaccos)).toBe(true);
      expect(typeof r.rows).toBe("number");
      expect(typeof r.skipped).toBe("number");
      expect(typeof r.lots).toBe("number");
      expect(Array.isArray(r.headers)).toBe(true);
      expect(typeof r.sectioned).toBe("boolean");
      expect(typeof r.capped).toBe("boolean");
      r.tobaccos.forEach((t: any) => {
        expect(typeof t.brand).toBe("string");
        expect(typeof t.name).toBe("string");
        expect(Array.isArray(t.lots)).toBe(true);
      });
    }), { numRuns: 400 });
  });

  it("never throws on CSV-shaped fuzz (delimiters, quotes, markers, proto keys)", () => {
    const cell = fc.oneof(
      fc.string(),
      fc.constantFrom("", '"', ";", ",", "\t", "\n", "===", "=== PIPES ===",
        "__proto__", "constructor", "Marque", "Nom", "Cave", "Pot", "Termine", "Oui", "Non",
        "Mar 15, 2024", "15.03.2024", "9", "-3", "Infinity"),
    );
    const line = fc.array(cell, { maxLength: 10 }).map((a) => a.join(";"));
    const doc = fc.array(line, { maxLength: 30 }).map((a) => a.join("\n"));
    fc.assert(fc.property(doc, (body) => {
      expect(() => parseTobaccoCsv("Marque;Nom;Statut;Poids (g)\n" + body)).not.toThrow();
    }), { numRuns: 300 });
  });

  // ── CSV formula-guard round-trip ────────────────────────────────
  it("strips the export's formula-guard apostrophe from data cells", () => {
    // csvEsc prepends "'" to a cell starting with = + - @ | ; import undoes it.
    const r = parseTobaccoCsv('Marque;Nom\n"\'=Pellworm";"Duskfall"');
    const t = r.tobaccos[0];
    expect(t.brand).toBe("=Pellworm");
    expect(t.name).toBe("Duskfall");
  });

  it("undoes the guard for a leading-dash name (common tin naming)", () => {
    const r = parseTobaccoCsv('Marque;Nom\nBrackwater;"\'- Limited 2024 -"');
    expect(r.tobaccos[0].name).toBe("- Limited 2024 -");
  });

  it("leaves a genuine leading apostrophe (not a formula guard) intact", () => {
    const r = parseTobaccoCsv("Marque;Nom\n'twas;Special");
    expect(r.tobaccos[0].brand).toBe("'twas");
  });

  it("a user brand starting with === is parsed, not a section stop", () => {
    const r = parseTobaccoCsv('Marque;Nom\n"\'=== rare ===";Special');
    expect(r.sectioned).toBeFalsy();
    expect(r.tobaccos).toHaveLength(1);
    expect(r.tobaccos[0].brand).toBe("=== rare ===");
  });

  it("the real === PIPES === marker still stops the parse", () => {
    const r = parseTobaccoCsv('Marque;Nom\nBrackwater;Duskfall\n"\'=== PIPES ==="');
    expect(r.sectioned).toBe(true);
    expect(r.tobaccos).toHaveLength(1); // only Brackwater, before the marker
  });
});

// ──────────────────────────────────────────────────────────────────────────
// A status IMPLIES a date. A hand-built CSV saying "Pot" with no opening date
// used to import as opened-with-no-opening-date and trip `jar-has-dateOpened` at
// the next save. The app fabricates this date everywhere else on purpose
// (applyLifecycleDates stamps today when the user promotes a lot in the form);
// the guess here is the narrowest available — a tin cannot have been opened
// before it was bought — falling back to the import date, which is the form's
// own guess. `todayIso` is injected so the module stays pure.
describe("lifecycle dates a status implies", () => {
  const parse = (csv: string) => parseTobaccoCsv(csv, { todayIso: "2026-07-30" });
  const lot = (csv: string) => parse(csv).tobaccos[0]!.lots[0]! as any;

  it("back-fills a jar's opening date from the purchase date", () => {
    const l = lot("Marque;Nom;Statut;Date achat\nHalvorsen;Duskfall;Pot;2024-03-15");
    expect(l.status).toBe("jar");
    expect(l.dateOpened).toBe("2024-03-15");
  });

  it("falls back to the import date when there is no purchase date", () => {
    const l = lot("Marque;Nom;Statut\nHalvorsen;Duskfall;Pot");
    expect(l.dateOpened).toBe("2026-07-30");
  });

  it("back-fills a finished lot's end date, preferring the opening date", () => {
    const l = lot("Marque;Nom;Statut;Date achat;Date mise en pot\nHalvorsen;Duskfall;Fini;2024-01-01;2024-06-01");
    expect(l.dateFinished).toBe("2024-06-01");
  });

  it("NEVER overwrites a date the file supplied", () => {
    const l = lot("Marque;Nom;Statut;Date achat;Date mise en pot\nHalvorsen;Duskfall;Pot;2024-01-01;2025-05-05");
    expect(l.dateOpened).toBe("2025-05-05");
  });

  it("leaves a CELLAR lot alone — a sealed tin has no opening date", () => {
    const l = lot("Marque;Nom;Statut;Date achat\nHalvorsen;Duskfall;Cave;2024-03-15");
    expect(l.dateOpened).toBe("");
    expect(l.dateFinished).toBe("");
  });

  it("stays deterministic with no clock injected", () => {
    // Pure module: without todayIso there is nothing to invent, so the field
    // stays empty rather than the parser reaching for Date.now().
    const l = parseTobaccoCsv("Marque;Nom;Statut\nHalvorsen;Duskfall;Pot").tobaccos[0]!.lots[0]! as any;
    expect(l.dateOpened).toBe("");
  });

  it("produces no lot-invariant violation for either status", () => {
    const p = parse("Marque;Nom;Statut;Poids (g);Poids initial (g)\nA;B;Pot;20;50\nA;B;Fini;0;50");
    const v = checkAllInvariants({
      tobaccos: p.tobaccos, pipes: [], accessories: [], wishlist: [], sessions: [],
      nxT: 2, nxP: 1, nxA: 1, nxW: 1, nxJ: 1,
    });
    expect(v.map((x: any) => x.rule), JSON.stringify(v)).toEqual([]);
  });
});
