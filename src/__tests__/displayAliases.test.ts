/**
 * which catalogue aliases are worth SHOWING on a fiche.
 *
 * The search has matched aliases (they are part of the search
 * blob), so a tin labelled "PDT" already finds Pennsylvania Dutch Treat. What
 * the fiche never did was say WHY it matched. The case that makes it necessary
 * is the merge: `Centenary Pipe Tobacco` carries "50th Anniversary" as
 * an alias precisely because two rows became one, so a user holding a tin
 * labelled that way lands on a differently-titled fiche with nothing on screen
 * accounting for it.
 *
 * THE FILTER IS THE WHOLE DESIGN. Roughly half the shipped alias strings are
 * already contained in "brand + name" — `Boswells Best` under a fiche titled
 * *Boswell — Boswell's Best*, `Apple Streudel` under *Apple Strudel*. As SEARCH
 * keys those spellings earn their place; printed under the title they read as a
 * bug rather than as information, which is why the raw list must not be shown.
 */

import { describe, it, expect } from "vitest";
import { displayAliases } from "../utils/tobaccoDb.ts";
import { loadCatalogueFixture } from "./catalogueFixture.ts";

describe("displayAliases", () => {
  it("keeps a genuinely different name", () => {
    expect(displayAliases({ name: "Pennsylvania Dutch Treat", aliases: ["PDT", "Penn Dutch Treat"] }, "Boswell"))
      .toEqual(["PDT", "Penn Dutch Treat"]);
  });

  it("drops an alias already contained in the heading", () => {
    // The alias IS the title with the brand glued on — nothing to learn.
    expect(displayAliases({ name: "Burley Blend", aliases: ["Amphora Burley Blend"] }, "Amphora"))
      .toEqual([]);
  });

  it("drops a punctuation-only variant, which the title already shows", () => {
    expect(displayAliases({ name: "Boswell's Best", aliases: ["Boswells Best"] }, "Boswell")).toEqual([]);
  });

  it("drops a word already inside a longer title", () => {
    // "Centenary" is visible in "Centenary Pipe Tobacco"; "50th Anniversary" is not.
    expect(displayAliases(
      { name: "Centenary Pipe Tobacco", aliases: ["50th Anniversary", "Centenary"] }, "Aldwych",
    )).toEqual(["50th Anniversary"]);
  });

  it("de-duplicates aliases that normalise alike, keeping the first spelling", () => {
    expect(displayAliases({ name: "X", aliases: ["3 Nuns", "3-Nuns", "Three Nuns"] }, "Bell's"))
      .toEqual(["3 Nuns", "Three Nuns"]);
  });

  it("survives a missing brand, a missing alias list and a non-string entry", () => {
    expect(displayAliases({ name: "X", aliases: ["Y"] })).toEqual(["Y"]);
    expect(displayAliases({ name: "X" }, "B")).toEqual([]);
    expect(displayAliases(null, "B")).toEqual([]);
    expect(displayAliases({ name: "X", aliases: [null as never, "  Y  ", ""] }, "B")).toEqual(["Y"]);
  });

  it("is not fooled by an alias that merely SHARES words with the title", () => {
    // "Black Flake" is not contained in "Flake" — a different product name
    // must survive the filter, or the feature loses exactly the cases it exists
    // for. (The reverse — a title containing the alias — is the drop above.)
    expect(displayAliases({ name: "Flake", aliases: ["Black Flake"] }, "Charatan")).toEqual(["Black Flake"]);
  });
});

// against the FIXTURE excerpt rather than the shipped
// catalogue, which no longer exists — 28 real rows over 26 brands, chosen to
// keep the cases these assertions are about (the Aldwych merge among them).
// The two thresholds below are lowered to match the smaller sample; what they
// assert is unchanged and is a PROPERTY, not a count: both sides must be
// non-trivial, or the filter is either dead or a no-op.
describe("displayAliases against a real catalogue", () => {
  const db = loadCatalogueFixture();
  const brandOf = (key: string) => {
    const bk = key.slice(0, key.indexOf("|"));
    return (db.brands[bk] && db.brands[bk].displayName) || bk;
  };

  it("empties the line on the fiches where it would only echo the title", () => {
    // The measurement that justifies the filter: it must SUPPRESS a real share
    // of the fiches, or it is not earning its complexity. Asserted as a
    // property (both sides non-trivial) rather than as two frozen counts, which
    // would break on every catalogue delivery.
    let shown = 0, hidden = 0;
    for (const k of Object.keys(db.blends)) {
      const e = db.blends[k];
      if (!(e.aliases || []).length) continue;
      if (displayAliases(e, brandOf(k)).length) shown++; else hidden++;
    }
    expect(shown, "some fiche must display an alias, or the feature is dead").toBeGreaterThan(2);
    expect(hidden, "some fiche must suppress its aliases, or the filter is a no-op").toBeGreaterThan(2);
  });

  it("shows the merged name, which is the case the feature exists for", () => {
    const k = "aldwych|centenary pipe tobacco";
    const e = db.blends[k];
    expect(e, "the merged Aldwych row must still be in the catalogue").toBeTruthy();
    // A tin labelled "50th Anniversary" opens this fiche; the fiche must say so.
    expect(displayAliases(e, brandOf(k))).toContain("50th Anniversary");
  });

  it("never prints an alias that is already visible in the fiche heading", () => {
    // Every row of the fixture: one echoed alias reads as a bug.
    const tight = (s: string) => String(s).toLowerCase().normalize("NFD")
      .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
    const offenders: string[] = [];
    for (const k of Object.keys(db.blends)) {
      const e = db.blends[k];
      const title = tight(brandOf(k) + e.name);
      for (const a of displayAliases(e, brandOf(k))) {
        if (title.includes(tight(a))) offenders.push(k + " → " + a);
      }
    }
    expect(offenders).toEqual([]);
  });
});
