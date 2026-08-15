// A Home row that names a lot slice opens the fiche ON that slice.
//
// Reported from the app, right after the sibling defect on the "À fumer
// rapidement" tile: the "À point" row named Mac Baren Plumcake, the tap opened
// the fiche, and the four lots the row was ABOUT were somewhere in the whole
// list — "tu devrais ouvrir la fiche tabac avec les lots concernés".
//
// The row is built from `computeCellarPeaks`, which selects on the `optimal`
// band, so the tobacco is on the list BECAUSE of those lots. Opening on all of
// them is not wrong the way the tile's drill was wrong — nothing is hidden —
// but on a blend held in a dozen tins it hands you a list and leaves you to
// find the four it meant.
//
// The mechanism is the one the fiche already has: it follows the list's scope,
// names the slice in a chip on "Les lots", and offers "Tout afficher". What was
// missing was the caller passing a value. So what is locked here is that each
// row passes the slice its OWN chip names — and, as much, that a row whose chip
// is NOT a maturity band passes nothing, since those describe the tobacco
// rather than a subset of its lots.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { scopeFromStatusFilter, lotInScope } from "../utils/cellarInsights";

// Blank comments (length-preserving) before any source assertion: a check that
// reads its own explanatory prose as data passes for the wrong reason.
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

const HOME = blankComments(readFileSync("src/views/curator/HomeViewV2.tsx", "utf8"));
const APP = blankComments(readFileSync("src/App.tsx", "utf8"));

describe("crossOpenDetail can narrow the fiche it opens", () => {
  it("accepts a scope and applies it to the tobacco branch", () => {
    expect(APP).toMatch(/crossOpenDetail\(target: \{[^}]*scope\?: string/);
    expect(APP).toMatch(/if \(target\.scope\) setStatusFilter\(target\.scope\)/);
  });

  it("applies it AFTER nav, which resets the filter", () => {
    // nav("inv") sets statusFilter back to "active"; a scope applied before it
    // would be silently discarded and the row would look wired while doing
    // nothing — the failure shape this repo keeps paying for.
    const navAt = APP.indexOf("try { nav(target.view); }");
    const scopeAt = APP.indexOf("if (target.scope) setStatusFilter(target.scope)");
    expect(navAt).toBeGreaterThan(0);
    expect(scopeAt).toBeGreaterThan(navAt);
  });
});

describe("the Home rows pass the slice their own chip names", () => {
  it("À point opens on the optimal band it selects on", () => {
    // computeCellarPeaks selects `optimal`, so the row must not open on
    // anything else.
    const block = /peakActs\.push\(\{[\s\S]{0,400}?\}\);/.exec(HOME);
    expect(block, "the À point row builder moved").toBeTruthy();
    expect(block![0]).toMatch(/scope:\s*"optimal"/);
  });

  it("À surveiller maps its maturity signals, and only those", () => {
    const line = /const wScope = [^;]+;/.exec(HOME);
    expect(line, "the watch-row scope mapping moved").toBeTruthy();
    expect(line![0]).toMatch(/"overaged"\s*\?\s*"overaged"/);
    expect(line![0]).toMatch(/"approaching"\s*\?\s*"approaching"/);
    // low_stock is a tobacco-level judgement — scoping the fiche to it would
    // narrow the lot list on a signal that is not about lots.
    expect(line![0]).toMatch(/undefined/);
    expect(line![0]).not.toMatch(/low_?stock/i);
  });

  it("Ce soir ? passes no scope — its chips describe the tobacco", () => {
    // "jamais fumé" / "favori" / "pot presque vide" are not lot slices, so
    // toActItem must not invent one.
    const block = /const toActItem[\s\S]{0,700}?\n {2}\};/.exec(HOME);
    expect(block, "toActItem moved").toBeTruthy();
    expect(block![0]).not.toMatch(/scope:/);
  });

  it("every row that carries a scope forwards it, hero included", () => {
    // Two render paths open a tobacco fiche from a row: the list row and the
    // big hero card. A scope set on the item and dropped at one of them is
    // invisible except on the screen it fails on.
    const forwards = HOME.match(/crossOpenDetail\(\{ view: "inv", kind: "tobacco", obj: (a\.tob|hero\.tob)[^}]*\}/g) || [];
    expect(forwards.length).toBe(2);
    for (const f of forwards) expect(f, f).toMatch(/scope/);
  });
});

describe("the slice really is the lots the row is about", () => {
  const agingMax = "10";
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const lot = (id: number, yrs: number) =>
    ({ id, status: "cellar", weightG: "100", weightInitial: "100", datePurchased: daysAgo(365 * yrs) });

  it("optimal admits the matured lots and holds back the young ones", () => {
    const scope = scopeFromStatusFilter("optimal");
    const matured = [lot(1, 5), lot(2, 5), lot(3, 5), lot(4, 5)];
    const young = [lot(5, 1), lot(6, 1.5)];
    for (const l of matured) expect(lotInScope(l, scope, agingMax), `lot ${l.id}`).toBe(true);
    for (const l of young) expect(lotInScope(l, scope, agingMax), `lot ${l.id}`).toBe(false);
  });

  it("a jar lot is never in a maturity slice, so opening on one cannot empty the fiche wrongly", () => {
    const jar = { id: 9, status: "jar", weightG: "50", weightInitial: "100", datePurchased: daysAgo(365 * 5) };
    expect(lotInScope(jar, scopeFromStatusFilter("optimal"), agingMax)).toBe(false);
  });
});
