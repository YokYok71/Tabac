// An UNWEIGHED cellar lot was "too old" to one classifier and invisible to
// the other, so one screen contradicted itself and a Home tile counted lots
// its own drill excluded.
//
// `lotMaturityBucket` bailed on `safeNonNeg(lot.weightG) <= 0`, and
// `safeWeight("")` is 0 — so a lot the user never weighed was treated as an
// EMPTY TIN and got no maturity band at all. `lotAgingStatus` has no weight
// test whatever, and still called the same lot `overaged`.
//
// THE APP ALREADY DRAWS THIS DISTINCTION. `isUntrackedWeight` exists because
// `safeWeight("") === 0` once made unweighed jars vanish from the session
// picker — reported from the app — and its own comment says an empty weight
// is "an ABSENCE of data, not corruption". `addTobacco`'s starter lot is
// created with `weightG: ""` for exactly that reason, and `parseTobaccoCsv`
// blanks an unparsable number, so the state is ORDINARY rather than exotic.
// `cellarInsights.ts` simply did not import that helper.
//
// WHAT THE USER SAW, with a lot carrying a 2016 purchase date and no weight:
//   • the fiche's aging banner said "1 lot trop vieux" while NO lot row wore
//     the TROP ÂGÉ badge — the same screen contradicting itself;
//   • the "Trop âgé" chip listed the card, which then showed 0 g and no band
//     chips: an apparently empty row;
//   • the Home "À fumer rapidement" tile counted it and the list it opens did
//     not — verbatim the defect `smokeSoonDrill.test.ts` was written for,
//     reintroduced through a different door.
//
// The EXPLICIT zero is a different state and must keep bailing: a lot weighed
// at 0 is an empty tin, and an empty tin has nothing to mature.

import { describe, it, expect } from "vitest";
import { lotMaturityBucket } from "../utils/cellarInsights.ts";
import { lotAgingStatus } from "../utils.ts";

const OLD = "2010-01-01"; // comfortably past any agingMax below
const AGING = "5-8";

function lot(over: any = {}) {
  return {
    id: 1, status: "cellar", originalStatus: "cellar",
    weightG: "50", weightInitial: "50",
    datePurchased: OLD, dateProduction: "", dateOpened: "", dateFinished: "",
    boxNumber: "", price: "", seller: "", disposed: false,
    ...over,
  };
}

describe("an unweighed cellar lot is classified, not skipped", () => {
  it("the two classifiers agree that it is overaged", () => {
    const l = lot({ weightG: "" });
    // The premise: the aging rule has no weight test, so it judges this lot.
    expect(lotAgingStatus(l, AGING)).toBe("overaged");
    // And the band classifier must not disagree with it.
    expect(lotMaturityBucket(l, AGING),
      "the fiche banner and the lot badge would contradict each other").toBe("tooOld");
  });

  it("undefined and null weights are the same absence", () => {
    // `isUntrackedWeight` accepts all three, and a hand-edited backup or a
    // CSV can produce any of them.
    for (const w of [undefined, null] as any[]) {
      expect(lotMaturityBucket(lot({ weightG: w }), AGING)).toBe("tooOld");
    }
  });

  it("an unweighed YOUNG lot still lands in a band rather than nowhere", () => {
    const l = lot({ weightG: "", datePurchased: new Date().toISOString().slice(0, 10) });
    expect(lotMaturityBucket(l, AGING)).toBe("young");
  });

  it("an EXPLICIT zero still bails — an empty tin has nothing to mature", () => {
    // The distinction the fix rests on. Widening it to "any falsy weight"
    // would put empty tins back into the maturity bar and the Home tiles.
    expect(lotMaturityBucket(lot({ weightG: "0" }), AGING)).toBeNull();
    expect(lotMaturityBucket(lot({ weightG: 0 }), AGING)).toBeNull();
  });

  it("the other bails are untouched", () => {
    // Cellar-only, live-only — both settled decisions with their own reasons.
    expect(lotMaturityBucket(lot({ weightG: "", status: "jar" }), AGING)).toBeNull();
    expect(lotMaturityBucket(lot({ weightG: "", status: "finished" }), AGING)).toBeNull();
    expect(lotMaturityBucket(lot({ weightG: "", deletedAt: "2026-01-01" }), AGING)).toBeNull();
  });
});

// ── Two silences fixed alongside, both the sibling-miss shape ──────────────
import { readFileSync } from "node:fs";

describe("a file that cannot be READ says so", () => {
  it("both importers wire reader.onerror, like the catalogue loader always did", () => {
    // A FileReader failure — the file moved, unreadable media, permission
    // refused — is not the same as a file that parses badly. With only
    // `onload` wired the button looked dead: nothing on screen, no state
    // change, no message. `useUserCatalogue.loadCatalogueFile` and
    // `handlePhotoUpload` have both handled it all along, which is what makes
    // this an oversight rather than a decision.
    const src = readFileSync("src/hooks/useExportImport.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
    const loads = [...src.matchAll(/reader\.onload\s*=/g)].length;
    const errors = [...src.matchAll(/reader\.onerror\s*=/g)].length;
    expect(loads, "non-vacuity: the readers are still there").toBe(2);
    expect(errors, "an unreadable file produces no message at all").toBe(loads);
  });
});

describe("the catalogue download refuses an HTTP error body", () => {
  it("checks resp.ok, like its three sibling downloads", () => {
    // A `fetch` that receives a 401/404 RESOLVES. Without the check the error
    // BODY reached `parseCatalogueCsv`, which found no `brand_key` header and
    // reported « votre fichier n'est pas un catalogue valide » — sending the
    // user off to inspect a perfectly good CSV.
    const src = readFileSync("src/hooks/useGdriveSync.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
    const downloads = [...src.matchAll(/cloud\.download\(/g)].length;
    expect(downloads, "non-vacuity: the download sites are still there").toBe(4);
    // Every one of them must guard. Sliced per call site so a single guard
    // cannot satisfy the count for all four.
    // Sliced to the NEXT call site rather than a fixed window: blanking a
    // comment preserves its LENGTH, so a long explanatory note pushes the
    // guard past any character count. That cost a round here, and it is the
    // same trap the `smokeSoonDrill` wiring case hit.
    let guarded = 0;
    let at = -1;
    while ((at = src.indexOf("cloud.download(", at + 1)) >= 0) {
      const next = src.indexOf("cloud.download(", at + 1);
      const region = src.slice(at, next > at ? next : at + 4000);
      if (/!\s*(resp|r)\.ok/.test(region)) guarded++;
    }
    expect(guarded, "a download site accepts an HTTP error body").toBe(downloads);
  });
});
