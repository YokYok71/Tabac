// Tests for the pure collection/insurance report builder.

import { describe, it, expect } from "vitest";
import { buildCollectionReport } from "../utils/collectionReport";

const labels = {
  title: "Rapport de collection",
  generated: "Généré le",
  summary: "Résumé",
  totalValue: "Valeur d'achat totale",
  tobaccos: "Tabacs",
  pipes: "Pipes",
  accessories: "Accessoires",
  colBrand: "Marque",
  colName: "Nom",
  colCategory: "Catégorie",
  colLots: "Lots",
  colCellar: "En cave",
  colJar: "En pot",
  colShape: "Forme",
  colType: "Type",
  colValue: "Valeur",
  items: "articles",
  disclaimer: "Valeurs basées sur les prix d'achat saisis.",
};

const opts = { currencySymbol: "€", weightUnit: "g", dateStr: "2026-07-22 10:15", labels };

describe("buildCollectionReport", () => {
  it("produces a self-contained HTML document with the title and date", () => {
    const html = buildCollectionReport({ tobaccos: [], pipes: [], accessories: [] }, opts);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Rapport de collection</title>");
    expect(html).toContain("Généré le 2026-07-22 10:15");
    expect(html).toContain("<style>");
  });

  it("sums lot prices per tobacco and a grand total", () => {
    const data = {
      tobaccos: [
        { brand: "A", name: "Alpha", category: "Virginia", lots: [{ price: "30", weightG: "50", status: "cellar" }, { price: "10", weightG: "20", status: "jar" }] },
      ],
      pipes: [{ brand: "P", name: "Peth", shape: "Billiard", price: "80" }],
      accessories: [{ brand: "Z", name: "Zippo", type: "Briquet", price: "40" }],
    };
    const html = buildCollectionReport(data, opts);
    // tobacco subtotal 40, pipe 80, acc 40 → grand 160
    expect(html).toContain("40.00 €");   // tobacco value
    expect(html).toContain("80.00 €");   // pipe value
    expect(html).toContain("160.00 €");  // grand total
    expect(html).toContain("Alpha");
    // The weight is SPLIT, so this no longer reads "70 g".
    // A single figure said how much you own; it did not say how much is still
    // SEALED, which is the question an inventory document is asked.
    expect(html).toContain("50 g");      // cellar (unopened)
    expect(html).toContain("20 g");      // jar (opened)
    expect(html).not.toContain("70 g");
  });

  // cellar and jar are reported apart.
  describe("cellar / jar split", () => {
    const rep = (lots: any[]) => buildCollectionReport(
      { tobaccos: [{ brand: "A", name: "B", category: "C", lots }], pipes: [], accessories: [] }, opts);

    it("gives the table a column for each, headed with the unit", () => {
      const html = rep([{ price: "1", weightG: "10", status: "cellar" }]);
      expect(html).toContain("En cave (g)");
      expect(html).toContain("En pot (g)");
    });

    it("puts each lot in its own column and never double-counts", () => {
      const html = rep([
        { price: "1", weightG: "100", status: "cellar" },
        { price: "1", weightG: "40", status: "jar" },
        { price: "1", weightG: "7", status: "cellar" },
      ]);
      expect(html).toContain("107 g");   // cellar
      expect(html).toContain("40 g");    // jar
      expect(html).not.toContain("147 g");
    });

    it("counts an UNKNOWN status as cellar rather than dropping it", () => {
      // Splitting on two exact matches would let a hand-edited backup silently
      // REDUCE the reported total. Unopened is both the safer reading and the
      // `BL` template default.
      const html = rep([{ price: "1", weightG: "60", status: "" as any }]);
      expect(html).toContain("60 g");
    });

    it("still excludes a finished lot from BOTH columns", () => {
      // The settled asymmetry below must survive the split.
      const html = rep([
        { price: "20", weightG: "999", status: "finished" },
        { price: "5", weightG: "30", status: "jar" },
      ]);
      expect(html).toContain("30 g");
      expect(html).not.toContain("999 g");
      expect(html).toContain("25.00 €");   // value still counts the finished lot
    });

    it("totals each column on the subtotal row", () => {
      const html = buildCollectionReport({
        tobaccos: [
          { brand: "A", name: "1", category: "C", lots: [{ price: "1", weightG: "100", status: "cellar" }] },
          { brand: "B", name: "2", category: "C", lots: [{ price: "1", weightG: "25", status: "jar" }] },
        ], pipes: [], accessories: [],
      }, opts);
      // The subtotal row carries both weights, then the value.
      expect(html).toMatch(/subtotal[\s\S]*100 g[\s\S]*25 g[\s\S]*2\.00 €/);
    });

    it("keeps the subtotal row spanning the table exactly", () => {
      // The label's colspan shrinks by the number of extra cells; a mismatch
      // renders a visibly broken table in the document the user files.
      const html = rep([{ price: "1", weightG: "10", status: "cellar" }]);
      const cols = (html.match(/<thead><tr>([\s\S]*?)<\/tr>/) || [])[1]!.split("<th").length - 1;
      const span = Number((html.match(/subtotal"><td colspan="(\d+)"/) || [])[1]);
      const extra = (html.match(/subtotal"><td colspan="\d+">[^<]*<\/td>((?:<td[^>]*>[^<]*<\/td>)*)/) || [])[1] || "";
      const cells = extra.split("<td").length - 1;
      expect(span + cells).toBe(cols);
    });
  });

  // SETTLED, do not "fix" this asymmetry.
  // A finished lot leaves the WEIGHT column (the tobacco is gone) and stays in
  // the VALUE column (it was bought, at that price). An audit raised it as an
  // inconsistency: a smoked-through blend reads « 0 g · 120 € », and « Valeur
  // d'achat totale » therefore counts tobacco that no longer exists. The fix is
  // one line and it was deliberately NOT taken — this document is filed with an
  // insurer and the figure it reports is an ACQUISITION COST baseline (the
  // report says so in its own disclaimer), not a live appraisal of what is on
  // the shelf. Under that reading the two columns answer two different
  // questions and the asymmetry is correct. Put to the user, who chose to keep
  // it. Reopen only on a new request, never on a fresh reading of the code.
  it("excludes finished lots from the weight but not the value", () => {
    const data = {
      tobaccos: [{ brand: "A", name: "B", category: "X", lots: [
        { price: "20", weightG: "0", status: "finished" },
        { price: "5", weightG: "30", status: "jar" },
      ] }],
      pipes: [], accessories: [],
    };
    const html = buildCollectionReport(data, opts);
    expect(html).toContain("25.00 €");   // both prices counted
    expect(html).toContain("30 g");      // only the jar weight
  });

  it("omits sections that have no live items", () => {
    const html = buildCollectionReport({ tobaccos: [{ brand: "A", name: "B", category: "X", lots: [] }], pipes: [], accessories: [] }, opts);
    expect(html).toContain(">Tabacs ");
    expect(html).not.toContain(">Pipes ");
    expect(html).not.toContain(">Accessoires ");
  });

  it("skips soft-deleted rows and lots", () => {
    const data = {
      tobaccos: [
        { brand: "Gone", name: "X", category: "C", deletedAt: "t", lots: [{ price: "99" }] },
        { brand: "Live", name: "Y", category: "C", lots: [{ price: "10" }, { price: "10", deletedAt: "t" }] },
      ],
      pipes: [], accessories: [],
    };
    const html = buildCollectionReport(data, opts);
    expect(html).not.toContain("Gone");
    expect(html).toContain("Live");
    expect(html).toContain("10.00 €");   // deleted lot's 10 excluded → subtotal 10
    expect(html).not.toContain("99.00");  // the trashed tobacco's price never rendered
  });

  it("HTML-escapes user-controlled strings", () => {
    const data = {
      tobaccos: [{ brand: "<script>alert(1)</script>", name: "A&B \"q\" 'x'", category: "C", lots: [{ price: "1" }] }],
      pipes: [], accessories: [],
    };
    const html = buildCollectionReport(data, opts);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A&amp;B");
    expect(html).toContain("&quot;q&quot;");
    expect(html).toContain("&#39;x&#39;");
  });

  it("treats garbage / negative prices as zero without throwing", () => {
    const data = {
      tobaccos: [{ brand: "A", name: "B", category: "C", lots: [{ price: "Infinity" }, { price: "-5" }, { price: "abc" }, { price: "12" }] }],
      pipes: [], accessories: [],
    };
    const html = buildCollectionReport(data, opts);
    expect(html).toContain("12.00 €");
  });

  it("never throws on null/garbage top-level data", () => {
    expect(() => buildCollectionReport(null, opts)).not.toThrow();
    expect(() => buildCollectionReport({}, opts)).not.toThrow();
    expect(() => buildCollectionReport({ tobaccos: null, pipes: undefined }, opts)).not.toThrow();
  });
});

// ── Two readers of one field, and a notation nobody can read ──────────────
//
// `num()` coerced with `Number(v)` while every other reader of a price in the
// app uses `parseFloat` (`computeStats`'s `nonNeg`, `stats.safeWeight`). So a
// price stored as "2,5" — a shape the app itself produces, since `fmtNum`
// renders a comma in every language but English — was read as 2 by the
// spending stats and as **0** by the document filed with an insurer. The
// defect is the INCONSISTENCY, so the fix is to read it the way everything
// else does, NOT to invent a third reading: `parseFloat("2,5")` is 2, and a
// comma-normalising `num` would make this module the odd one out again in the
// opposite direction.
describe("buildCollectionReport — a price is read the way the rest of the app reads it", () => {
  it("reads a comma decimal like `computeStats` does, not as zero", () => {
    const data = {
      tobaccos: [{ brand: "A", name: "B", category: "C", lots: [{ price: "2,5" }] }],
      pipes: [], accessories: [],
    };
    const html = buildCollectionReport(data, opts);
    // parseFloat("2,5") === 2 — the same figure the spending stats report.
    expect(html).toContain("2.00 €");
    expect(html).not.toContain("0.00 €");
  });

  it("still rejects garbage and negatives (non-vacuity)", () => {
    // Widening the coercion must not widen what counts as a price.
    const data = {
      tobaccos: [{ brand: "A", name: "B", category: "C", lots: [{ price: "abc" }, { price: "-5" }, { price: "Infinity" }] }],
      pipes: [], accessories: [],
    };
    const html = buildCollectionReport(data, opts);
    expect(html).toContain("0.00 €");
  });

  it("never prints exponential notation in a money figure", () => {
    // `toFixed` switches to exponential at 1e21, so a pasted price rendered
    // "1e+21 €" in the grand total — a value nobody can read, in a document
    // that exists to be read by someone else.
    const data = {
      tobaccos: [], pipes: [{ brand: "P", name: "Q", shape: "Billiard", price: "1e21" }], accessories: [],
    };
    const html = buildCollectionReport(data, opts);
    expect(html).not.toContain("e+21");
    expect(html).toContain("1000000000000000000000.00 €");
  });

  it("leaves an ordinary amount byte-identical (non-vacuity)", () => {
    // The exponential guard must be unreachable below the threshold, or every
    // ordinary report changes for a case nobody will ever hit.
    const data = { tobaccos: [], pipes: [{ brand: "P", name: "Q", shape: "Billiard", price: "123456.789" }], accessories: [] };
    expect(buildCollectionReport(data, opts)).toContain("123456.79 €");
  });
});

// ── The decimal separator ─────────────────────────────────────────────────
//
// Every LABEL in this document is pre-translated by the caller, and its
// numbers were not: a French report read "40.00 €" and "12.5 g". The
// formatter is passed IN, like `xlEnum` beside it, because this module is
// deliberately language-neutral and string-only — importing `fmtNum` here
// would drag the i18n machinery into it, and re-deriving the separator at the
// call site would be the rule written a second time.
describe("buildCollectionReport — the caller owns the decimal separator", () => {
  const data = {
    tobaccos: [{ brand: "A", name: "Alpha", category: "Virginia", lots: [{ price: "40.5", weightG: "12.5", status: "cellar" }] }],
    pipes: [], accessories: [],
  };

  it("routes money AND weight through the supplied formatter", () => {
    const html = buildCollectionReport(data, {
      ...opts,
      formatNumber: (v: string) => String(v).replace(".", ","),
    });
    expect(html).toContain("40,50 €");
    expect(html).toContain("12,5 g");
    expect(html).not.toContain("40.50");
    expect(html).not.toContain("12.5 g");
  });

  it("defaults to the dot form when no formatter is passed (non-vacuity)", () => {
    // The parameter is OPTIONAL so a caller that does not care — and every
    // pre-existing test — behaves exactly as before.
    const html = buildCollectionReport(data, opts);
    expect(html).toContain("40.50 €");
    expect(html).toContain("12.5 g");
  });
});
