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
import { computeStats, effectiveAgingMax, lotAgingStatus } from "../utils";
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

// The list filter, transcribed from App.tsx's `filtered` memo. A copy is the
// wrong shape in production — that is the four-copies failure this repo keeps
// paying for — but here it IS the subject: what must hold is that the filter
// selects exactly the tobaccos owning a lot the scope admits.
function tobaccoMatchesSmokeSoon(t: any): boolean {
  const eam = effectiveAgingMax(t);
  return (t.lots || []).some((l: any) => {
    const s = lotAgingStatus(l, eam);
    return s === "approaching" || s === "overaged";
  });
}

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

  it("the filter selects exactly the tobaccos that own an in-scope lot", () => {
    const scope = scopeFromStatusFilter("smokesoon");
    for (const t of DATA.tobaccos) {
      const owns = (t.lots || []).some((l: any) => lotInScope(l, scope, effectiveAgingMax(t)));
      expect(tobaccoMatchesSmokeSoon(t), `${t.name}`).toBe(owns);
    }
    expect(DATA.tobaccos.filter(tobaccoMatchesSmokeSoon).length).toBe(2);
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
  const home = require("node:fs").readFileSync("src/views/curator/HomeViewV2.tsx", "utf8");
  const list = require("node:fs").readFileSync("src/views/curator/InventoryListView.tsx", "utf8");
  const app = require("node:fs").readFileSync("src/App.tsx", "utf8");

  it("the tile drills to the combined slice", () => {
    const tile = /stat_smoke_soon[\s\S]{0,400}?setStatusFilter\("([a-z]+)"\)/.exec(home);
    expect(tile, "the tile's onClick no longer sets a status filter").toBeTruthy();
    expect(tile![1]).toBe("smokesoon");
  });

  it("App.tsx implements that filter", () => {
    expect(app).toMatch(/eff === "smokesoon"/);
  });

  it("the list offers it as a chip, so a narrowed list never looks unfiltered", () => {
    expect(list).toMatch(/id: "smokesoon"/);
    expect(list).toMatch(/STATUS_PILL_IDS[^\]]*"smokesoon"/);
  });
});
