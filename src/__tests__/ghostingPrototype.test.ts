// `ghosting.ts` was the site the prototype-pollution sweep MISSED, and the
// consequence is the harshest failure mode this app has: a forged `category`
// in an imported backup makes the whole UI throw on every screen, for ever.
//
// THE MECHANISM, which is why a plain `{}` is not a style question here:
//
//   counts["__proto__"] = (counts["__proto__"] || 0) + 1;
//
// The read resolves to `Object.prototype` — an OBJECT, and truthy, so the
// `|| 0` never fires — and the write goes through the `__proto__` SETTER,
// which silently ignores a non-object. So the key is never stored: `total` is
// 1, `Object.keys(counts)` is `[]`, and `families[0].count` throws a
// TypeError. `"constructor"` and `"toString"` resolve to functions and poison
// the arithmetic instead.
//
// WHY IT IS A BRICK RATHER THAN A GLITCH. `CuratorApp` mounts
// `CuratorPipesListView` unconditionally, and that view's `pipeFamily` memo
// sits ABOVE its `if (view !== "pipes") return null` — it has to, per the
// documented hook-order rule. So the throw happens on the first render after
// `data` loads, WHATEVER screen the user is on. `_runImport` calls `save()`
// before any render, so the row is already on disk; the error boundary
// replaces the whole tree, so Settings (and "Effacer toutes les données") is
// unreachable; and NEITHER recovery path clears localStorage —
// `EB.purgeCachesAndReload` and `public/reset.html` both stop at service
// workers and Cache Storage. The only way out is clearing site data or
// deleting the PWA, with the user's own cellar stranded.
//
// THE DOOR IS THE JSON IMPORT AND THE CLOUD RESTORE. `migrateData` coerces
// `category` to a string (`_TOB_STR_FIELDS`) and never validates it against
// `CATS`. The CSV importer is NOT a door (`canonEnum` snaps to "Autre") and
// the catalogue is NOT one (`canonCategory` returns null → the value is
// skipped). This is the same shape as the already-fixed `imageUrl:
// "__proto__"` brick, through a different key.
//
// WHAT MAKES THIS A MISSED SITE RATHER THAN AN OVERSIGHT OF PRINCIPLE:
// `utils.ts` builds the SAME kind of tally with `Object.create(null)` and
// carries a comment describing this exact defect, and
// `prototypePollution.test.ts` covers `computeStats`, `computeChartStats`,
// `computeTopTobaccos`, `computeTopPipes`, `refreshSnapshotsForRemoval` and
// `migrateData` — without ever importing this module.
//
// The four maps here are all reachable from user data: `catByTob` is keyed by
// `tobacco.id`, `counts` by `tobacco.category`.

import { describe, it, expect } from "vitest";
import {
  computePipeUsageProfile,
  computePipeGhostingRisk,
  pipeAccordsWithFamily,
} from "../utils/ghosting.ts";

// The three keys that resolve to something truthy on Object.prototype.
// `__proto__` is the dangerous one (its setter swallows the write); the other
// two return functions, which poison the arithmetic instead of throwing.
const POISON = ["__proto__", "constructor", "toString"];

function cellar(cat: string, n: number) {
  const tobaccos = [{ id: 1, brand: "B", name: "N", category: cat }];
  const sessions = Array.from({ length: n }, (_, i) => ({
    id: 100 + i, pipeId: 5, tobaccoId: 1, date: "2026-01-0" + (i + 1), duration: "30",
  }));
  return { tobaccos, sessions };
}

describe("ghosting.ts survives a forged category", () => {
  for (const key of POISON) {
    it(`computePipeUsageProfile does not throw on category "${key}"`, () => {
      const { tobaccos, sessions } = cellar(key, 4);
      // The assertion that matters is that it RETURNS. Before the fix this
      // line threw `Cannot read properties of undefined (reading 'count')`
      // and every screen of the app went to the error boundary.
      const prof = computePipeUsageProfile(5, sessions, tobaccos);
      expect(prof.total).toBe(4);
      expect(prof.dominant).toBe(key);
      // The count must be a NUMBER, not a string built by concatenating onto
      // `Object.prototype.toString`. `"[object Object]1"` is truthy and would
      // pass a bare toBeTruthy.
      expect(typeof prof.families[0]!.count).toBe("number");
      expect(prof.families[0]!.count).toBe(4);
      expect(prof.dominantShare).toBe(1);
    });

    it(`computePipeGhostingRisk does not throw on category "${key}"`, () => {
      const { tobaccos, sessions } = cellar(key, 4);
      // A second tobacco in a real family, so the "same family" early return
      // does not hide the arithmetic.
      tobaccos.push({ id: 2, brand: "B", name: "M", category: "Latakia" });
      const risk = computePipeGhostingRisk(5, 2, sessions, tobaccos);
      expect(risk).not.toBeNull();
      expect(risk!.dominant).toBe(key);
      expect(typeof risk!.count).toBe("number");
      expect(risk!.count).toBe(4);
    });

    it(`pipeAccordsWithFamily does not throw on category "${key}"`, () => {
      const { tobaccos, sessions } = cellar(key, 4);
      expect(pipeAccordsWithFamily(5, key, sessions, tobaccos)).toBe(true);
      expect(pipeAccordsWithFamily(5, "Latakia", sessions, tobaccos)).toBe(false);
    });
  }

  it("a forged tobacco ID cannot invent a family", () => {
    // The OTHER map: `catByTob` is keyed by `String(tobacco.id)`. On a plain
    // object a session whose `tobaccoId` is "toString" resolves to
    // `Object.prototype.toString` — a FUNCTION — and the pipe fiche then
    // displays a family literally rendered as
    // `function toString() { [native code] }`.
    const tobaccos = [{ id: 1, brand: "B", name: "N", category: "Virginia" }];
    const sessions = [
      { id: 1, pipeId: 5, tobaccoId: "toString", date: "2026-01-01", duration: "30" },
      { id: 2, pipeId: 5, tobaccoId: "__proto__", date: "2026-01-02", duration: "30" },
      { id: 3, pipeId: 5, tobaccoId: 1, date: "2026-01-03", duration: "30" },
    ];
    const prof = computePipeUsageProfile(5, sessions, tobaccos);
    // Only the REAL session counts: the two forged ids resolve to nothing.
    expect(prof.total).toBe(1);
    expect(prof.families.map((f) => f.category)).toEqual(["Virginia"]);
  });

  it("a mixed pipe is still counted correctly when one family is forged", () => {
    // The non-crashing half of the same defect: with a plain map the forged
    // key is silently dropped from `counts` while `total` still counts it, so
    // `dominantShare` came out too LOW and a genuinely dedicated pipe stopped
    // being reported as dedicated.
    const tobaccos = [
      { id: 1, brand: "B", name: "N", category: "__proto__" },
      { id: 2, brand: "B", name: "M", category: "Latakia" },
    ];
    const sessions = [
      { id: 1, pipeId: 5, tobaccoId: 1, date: "2026-01-01", duration: "30" },
      { id: 2, pipeId: 5, tobaccoId: 2, date: "2026-01-02", duration: "30" },
      { id: 3, pipeId: 5, tobaccoId: 2, date: "2026-01-03", duration: "30" },
      { id: 4, pipeId: 5, tobaccoId: 2, date: "2026-01-04", duration: "30" },
    ];
    const prof = computePipeUsageProfile(5, sessions, tobaccos);
    expect(prof.total).toBe(4);
    expect(prof.families.length).toBe(2);
    expect(prof.dominant).toBe("Latakia");
    expect(prof.dominantShare).toBe(0.75);
    expect(prof.ghosted).toBe(true);
  });
});

// ── The same class, one door over ──────────────────────────────────────────
//
// `buildCsvLines`' label maps are keyed by entity id on the WRITE and by
// `session.tobaccoId` / `session.pipeId` on the READ — both from an imported
// backup. A forged id resolving to a prototype member is truthy, so it is
// returned as the label AND it short-circuits the snapshot fallback that
// exists so a session whose entity is gone still exports something
// identifiable.
import { renderHook } from "@testing-library/react";
import { useExportImport } from "../hooks/useExportImport.ts";

describe("the CSV export survives a forged session reference", () => {
  it("falls back to the snapshot instead of exporting a prototype member", () => {
    const data: any = {
      tobaccos: [{ id: 1, brand: "Halvorsen", name: "Early Tide", lots: [] }],
      pipes: [], accessories: [], wishlist: [],
      sessions: [{
        id: 9, date: "2026-01-05", duration: "30", weightG: "2", rating: 4,
        // The entity is gone; the snapshot is what the journal shows.
        tobaccoId: "toString", pipeId: "__proto__",
        tobaccoSnapshot: { brand: "Aldwych", name: "Night Ferry" },
        pipeSnapshot: { brand: "Vondel", name: "Kade 12" },
      }],
      nxT: 2, nxP: 1, nxA: 1, nxJ: 10, nxW: 1,
    };
    const { result } = renderHook(() => useExportImport({
      data, t: (k: string) => k, lang: "fr", weightUnit: "g", dateFormat: "fr",
    } as any));
    // No argument: it closes over the `data` handed to the hook.
    const csv = result.current.buildCsvLines().join("\n");
    expect(csv, "a prototype member reached the exported file").not.toMatch(/native code/);
    // And the snapshot label survived rather than being shadowed by it.
    expect(csv).toContain("Aldwych Night Ferry");
    expect(csv).toContain("Vondel Kade 12");
  });
});
