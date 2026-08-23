// The Home "À fumer rapidement" tile must open the lots it counted.
//
// THE DEFECT, reported from the app with two screenshots: the tile read 7 and
// the list it opened held one card. The tile's value is
// `lotsApproaching + lotsOveraged` — 6 peak + 1 too-old, the same two bands the
// "Cave à maturité" bar shows right above it — while its tap set the status
// filter to `overaged`, which is the 1.
//
// The count was RIGHT for the label: "smoke these soon" covers the window you
// want to be in AND the time past it, and both are urgent for opposite
// reasons. What lied was the destination — a control naming a set and
// selecting a subset of it, which is the same failure recorded for the
// maturity filter chips (a chip reading "At peak" selecting the band before
// it).
//
// So the fix is a slice that holds everything the tile counts, and what is
// locked here is the AGREEMENT between the three places that have to say the
// same thing: the tile's arithmetic, the list filter, and the lot scope the
// card and fiche figures narrow to. Any one of them drifting reproduces the
// report.
//
// NOTE the deliberate asymmetry, asserted below so nobody "fixes" it: the tile
// counts LOTS and the list shows TOBACCOS, so 7 lots may open 3 cards. That is
// the established shape of every tile in that row (128 "Boîtes" likewise opens
// far fewer rows), and the cards carry their own per-band lot counts.

import { describe, it, expect } from "vitest";
import { computeStats, effectiveAgingMax } from "../utils";
import { scopeFromStatusFilter, scopeLabelKey, lotInScope } from "../utils/cellarInsights";

// Two tobaccos, four cellar lots: one peak, one too-old, one young, plus a jar
// lot that must never qualify (aging is cellar-only).
//
// The ages are expressed against a 10-year target, so `peak` is the last year
// before it and `tooOld` is past it — computed from the fixture's own dates
// rather than hardcoded, so a change to the band boundaries fails loudly here
// instead of silently re-classifying the fixture.
// Relative to NOW, not to a fixed epoch: `lotAgingStatus` measures against the
// real clock, so a hardcoded base silently ages every lot by however long ago
// it was written — which is what put this fixture's peak lot into the too-old
// band on the first run.
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function cellar(id: number, days: number) {
  return { id, status: "cellar", weightG: "50", weightInitial: "50", datePurchased: daysAgo(days) };
}

const DATA: any = {
  tobaccos: [
    {
      id: 1, brand: "Halvorsen", name: "Nordlys", agingMax: "10",
      lots: [
        cellar(11, 365 * 9.5),   // peak — inside the last year before the target
        cellar(12, 365 * 12),    // too old — past it
        cellar(13, 365 * 1),     // young
      ],
    },
    {
      id: 2, brand: "Vondel", name: "Kaap", agingMax: "10",
      lots: [
        cellar(21, 365 * 12),    // too old
        { id: 22, status: "jar", weightG: "20", weightInitial: "50", dateOpened: daysAgo(30), datePurchased: daysAgo(365 * 12) },
      ],
    },
  ],
  pipes: [], accessories: [], wishlist: [], sessions: [],
};

// THE FILTER IS NO LONGER TRANSCRIBED HERE, and the reason is the finding.
//
// This file used to carry its own copy of App.tsx's predicate, under a comment
// arguing that "a copy is the wrong shape in production, but here it IS the
// subject". That argument is wrong: what must hold is that APP.TSX's filter
// agrees with the scope — a hand-written copy agreeing with the scope proves
// only that the author can write the scope twice.
//
// PROBED, which is how it was settled: reverting App.tsx's branch to the
// reported defect (`overaged` alone, the exact thing this file is named after)
// left all nine cases GREEN. The tile could go back to opening one card out of
// seven with the guard reporting success.
//
// So App.tsx now DELEGATES to `lotInScope`, and what is locked below is that
// delegation. The behaviour cases keep testing the shared helper, which is now
// the one implementation the app actually runs.

describe("the smoke-soon tile opens what it counted", () => {
  it("the fixture really carries both bands, so nothing below passes vacuously", () => {
    const s: any = computeStats(DATA);
    expect(s.lotsApproaching).toBe(1);
    expect(s.lotsOveraged).toBe(2);
  });

  it("the tile's value is the two bands, and the scope admits exactly those lots", () => {
    const s: any = computeStats(DATA);
    const soonCount = (s.lotsApproaching || 0) + (s.lotsOveraged || 0);

    const scope = scopeFromStatusFilter("smokesoon");
    expect(scope).toBe("smokeSoon");

    let inScope = 0;
    for (const t of DATA.tobaccos) {
      const eam = effectiveAgingMax(t);
      for (const l of t.lots) if (lotInScope(l, scope, eam)) inScope++;
    }

    // THE assertion the defect failed: every lot the tile counted is reachable
    // through the slice its tap selects.
    expect(inScope).toBe(soonCount);
    expect(inScope).toBe(3);
  });

  it("the OLD destination is the defect, and still is — it holds a subset", () => {
    // Non-vacuity, and a guard against quietly pointing the tile back at a
    // single band: `overaged` admits 2 of the 3 lots the tile counts.
    let overagedOnly = 0;
    for (const t of DATA.tobaccos) {
      const eam = effectiveAgingMax(t);
      for (const l of t.lots) if (lotInScope(l, scopeFromStatusFilter("overaged"), eam)) overagedOnly++;
    }
    expect(overagedOnly).toBe(2);
    expect(overagedOnly).toBeLessThan(3);
  });

  it("the slice reaches exactly two of the fixture's tobaccos", () => {
    // The count the LIST shows, as opposed to the count the TILE shows — the
    // documented asymmetry: 3 lots across 2 cards.
    const scope = scopeFromStatusFilter("smokesoon");
    const owning = DATA.tobaccos.filter((t: any) =>
      (t.lots || []).some((l: any) => lotInScope(l, scope, effectiveAgingMax(t))));
    expect(owning.map((t: any) => t.name)).toEqual(["Nordlys", "Kaap"]);
  });

  it("never admits a jar lot — aging is cellar-only", () => {
    const jar = DATA.tobaccos[1].lots[1];
    expect(jar.status).toBe("jar");
    expect(lotInScope(jar, scopeFromStatusFilter("smokesoon"), "10")).toBe(false);
  });

  it("the slice is labelled with the tile's OWN key, not a band's", () => {
    // The user must be able to see they landed where they tapped. Borrowing
    // `mat_old` here would put the too-old band's word over a total that
    // includes peak lots — the exact wording defect recorded for the chips.
    expect(scopeLabelKey("smokeSoon")).toBe("stat_smoke_soon");
    expect(scopeLabelKey("smokeSoon")).not.toBe(scopeLabelKey("tooOld"));
    expect(scopeLabelKey("smokeSoon")).not.toBe(scopeLabelKey("peak"));
  });
});

describe("the wiring, because the helpers agreeing proves nothing on their own", () => {
  // Comments are BLANKED before every source assertion. This repo has been
  // bitten repeatedly by a check satisfied by the comment explaining the fix,
  // and the paragraph above this describe names `lotInScope` and "smokeSoon"
  // in prose — so without this, the branch could be deleted outright and the
  // assertions would still find their strings.
  const blank = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
     .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
  const home = blank(require("node:fs").readFileSync("src/views/curator/HomeViewV2.tsx", "utf8"));
  const list = blank(require("node:fs").readFileSync("src/views/curator/InventoryListView.tsx", "utf8"));
  const app = blank(require("node:fs").readFileSync("src/App.tsx", "utf8"));

  it("the tile drills to the combined slice", () => {
    const tile = /stat_smoke_soon[\s\S]{0,400}?setStatusFilter\("([a-z]+)"\)/.exec(home);
    expect(tile, "the tile's onClick no longer sets a status filter").toBeTruthy();
    expect(tile![1]).toBe("smokesoon");
  });

  it("App.tsx implements that filter THROUGH the shared scope", () => {
    // The assertion the old version of this file was missing. It checked only
    // that the branch exists, so the branch could select the wrong lots and
    // still pass — which a probe confirmed: putting the reported defect back
    // (`overaged` alone) turned nothing red.
    //
    // Keyed on the DELEGATION rather than on a spelling of the rule: a branch
    // that calls `lotInScope(l, "smokeSoon", …)` cannot disagree with the tile
    // or with the card figures, because there is only one implementation left.
    // Sliced from this branch to the NEXT one rather than by a character
    // budget: blanking a comment preserves its length, and the explanation
    // above the branch is long enough that any fixed window is either too
    // short to reach the code or long enough to spill into the next filter.
    const start = app.indexOf('eff === "smokesoon"');
    expect(start, "no `smokesoon` branch in the filtered memo").toBeGreaterThan(-1);
    const after = app.indexOf('eff === "', start + 20);
    const branch = app.slice(start, after > start ? after : start + 2000);
    expect(branch, "the branch must delegate to lotInScope, not re-spell the rule")
      .toMatch(/lotInScope\([^)]*"smokeSoon"/);
    expect(branch, "no second spelling of the band test alongside the delegation")
      .not.toMatch(/lotAgingStatus/);
  });

  it("the list offers it as a chip, so a narrowed list never looks unfiltered", () => {
    expect(list).toMatch(/id: "smokesoon"/);
    expect(list).toMatch(/STATUS_PILL_IDS[^\]]*"smokesoon"/);
  });
});
