import { describe, it, expect } from "vitest";
import { parseTobaccoCsv } from "../utils/csvImport";

// `numStr` did `String(v).trim().replace(",", ".")` — ONE comma, no other
// separator handled — and then `parseFloat`, which stops at the first character
// it cannot read and reports nothing. So a fr/de spreadsheet's `1 234,5`
// imported as **1**, and an en-locale `1,234.56` as **1.234**: three orders of
// magnitude of stock, silently, on a module whose stated contract is that "an
// export edited in a spreadsheet round-trips".
//
// The row was neither `skipped` nor listed in `issues`, so the import panel
// reported a clean file. That silence is the half that made it costly.

const HEAD = "Marque;Nom;Poids (g);Poids initial (g);Prix";
function parse(...rows: string[]) {
  return parseTobaccoCsv([HEAD].concat(rows).join("\n"));
}

describe("parseTobaccoCsv — group separators do not truncate a number", () => {
  it("reads a space-grouped comma-decimal number (fr/de spreadsheet)", () => {
    const r = parse("Halvorsen;Ansgar;1 234,5;1 234,5;12,50");
    const lot = r.tobaccos[0]!.lots[0];
    expect(lot.weightG).toBe("1234.5");
    expect(lot.price).toBe("12.5");
    // The defect as it landed: 1 g of stock for 1 234,5 g on the tin.
    expect(lot.weightG).not.toBe("1");
  });

  it("reads a NON-BREAKING space group separator", () => {
    // What a spreadsheet actually emits — U+00A0, and U+202F on newer locales.
    const r = parse("Halvorsen;Ansgar;1 234,5;;9 999");
    const lot = r.tobaccos[0]!.lots[0];
    expect(lot.weightG).toBe("1234.5");
    expect(lot.price).toBe("9999");
  });

  it("reads an en-locale comma-grouped dot-decimal number", () => {
    const r = parse("Halvorsen;Ansgar;1,234.56;;2,000");
    const lot = r.tobaccos[0]!.lots[0];
    expect(lot.weightG).toBe("1234.56");
    // Two commas cannot both be a decimal point, so they are grouping.
    expect(lot.weightG).not.toBe("1.234");
    // …but a SINGLE comma stays a DECIMAL mark, so this price reads as 2 and
    // not as 2000. Genuinely ambiguous and deliberately decided that way: it is
    // what this parser has always done and what a French spreadsheet emits, so
    // the other reading would silently multiply every fr-locale weight by a
    // thousand. Pinned so it reads as a decision rather than an oversight.
    expect(lot.price).toBe("2");
  });

  it("reads a Swiss apostrophe group separator", () => {
    const r = parse("Halvorsen;Ansgar;1'234.5;;0");
    expect(r.tobaccos[0]!.lots[0].weightG).toBe("1234.5");
  });

  // NON-VACUITY — the shapes that already worked must be untouched. A parser
  // that started reading grouped numbers by loosening everything would also
  // start accepting garbage, which is the opposite failure.
  it("leaves the plain shapes exactly as they were", () => {
    const r = parse(
      "Halvorsen;Ansgar;50;50;12.50",
      "Vondel;Zesde;2,5;2,5;0",
      "Corvane;Tarn;;;",
    );
    expect(r.tobaccos[0]!.lots[0].weightG).toBe("50");
    expect(r.tobaccos[0]!.lots[0].price).toBe("12.5");
    expect(r.tobaccos[1]!.lots[0].weightG).toBe("2.5"); // single comma = decimal
    expect(r.badNumber).toBe(0);
    expect(r.issues.filter((i) => i.kind === "number")).toEqual([]);
  });
});

describe("parseTobaccoCsv — a value it could not read is REPORTED", () => {
  it("blanks and reports a genuinely unreadable number", () => {
    const r = parse("Halvorsen;Ansgar;50g;;env. 12");
    const lot = r.tobaccos[0]!.lots[0];
    expect(lot.weightG).toBe("");
    expect(lot.price).toBe("");
    expect(r.badNumber).toBe(2);
    const nums = r.issues.filter((i) => i.kind === "number");
    expect(nums.map((i) => i.value).sort()).toEqual(["50g", "env. 12"]);
    // The row number counts the header as line 1, so it matches the gutter of
    // the spreadsheet the reader has open — same rule as the taxonomy kinds.
    expect(nums.every((i) => i.row === 2)).toBe(true);
    expect(nums.every((i) => i.brand === "Halvorsen")).toBe(true);
  });

  it("does not report an EMPTY cell — an absence is not a defect", () => {
    const r = parse("Halvorsen;Ansgar;;;");
    expect(r.badNumber).toBe(0);
    expect(r.issues).toEqual([]);
  });

  it("reports a negative number rather than silently blanking it", () => {
    // Already blanked before this change (a weight cannot be negative), and
    // already silent — the same half of the defect, one branch over.
    const r = parse("Halvorsen;Ansgar;-5;;0");
    expect(r.tobaccos[0]!.lots[0].weightG).toBe("");
    expect(r.badNumber).toBe(1);
    expect(r.issues[0]!.value).toBe("-5");
  });

  it("keeps the COUNT exact while the detail list is capped", () => {
    // The rule this module already applies to `badCategory` / `badCut`: a file
    // with more defects than the cap must not under-report — the panel whose
    // whole job is saying what is wrong would otherwise print a reassuring
    // number. Two bad cells per row, so 600 rows is 1200 against a 500 cap.
    const rows: string[] = [];
    for (let i = 0; i < 600; i++) rows.push("B" + i + ";N" + i + ";50g;;env. 1");
    const r = parse(...rows);
    expect(r.badNumber).toBe(1200);
    expect(r.issues.length).toBe(500);
    expect(r.issuesTruncated).toBe(true);
  });
});
