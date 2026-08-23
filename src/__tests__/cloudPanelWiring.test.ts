// Two wiring defects the panel merge left behind, neither of which any test
// could see — both live BETWEEN modules, which is the seam that rots.
//
// These are source-level assertions on purpose. The first guards a JSX render
// condition that only manifests when two independent pieces of state are set
// at once (a rendering test would have to drive the whole Settings modal
// through a restore); the second guards a string handed to a remote API, whose
// effect is invisible to any fixture that builds rows by hand — which is
// exactly what the existing panel tests do.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
// Comments are blanked before every source assertion: this repo has been
// bitten three times by a check satisfied by the comment EXPLAINING the fix.
// Length-preserving, so reported offsets still point at the real file.
const blank = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
   .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

describe("the cloud panel and the restore picker never show together", () => {
  it("both SyncDiagView renders are gated on !gdriveConfirm", () => {
    // The merge dropped the guard the old BackupsListPanel carried, while the
    // comment fifty lines above went on promising it. Both panels list the
    // SAME files with their own delete button, and the two delete actions
    // update DIFFERENT state — `gdriveDeleteOption` touches only
    // `gdriveConfirm`, `gdriveDeleteBackupById` only `syncDiag` — so a row
    // removed from one survives in the other, and its bin then 404s into a
    // swallowing `.catch`.
    const src = blank(read("src/views/curator/SettingsModal.tsx"));
    const renders = src.match(/<SyncDiagView\b/g) || [];
    expect(renders.length, "expected the two source-scoped renders").toBe(2);
    // Every render must carry the guard in its own condition.
    const guarded = src.match(/syncDiagSource === "(?:check|diag)" && syncDiag && !gdriveConfirm &&/g) || [];
    expect(guarded.length, "each SyncDiagView render must yield to the restore picker").toBe(2);
  });
});

describe("the diagnostic listings ask Drive for the file size", () => {
  it("the shared mask requests `size`, and all three listings use it", () => {
    // Drive applies the `fields` mask VERBATIM, so a mask without `size`
    // yields `f.size === undefined` and the panel renders every row sizeless
    // with a "—" total. Dropbox's adapter ignores the mask, so the feature
    // worked there throughout — which is how the gap survived a reading.
    //
    // Asserted on the CONSTANT rather than on each call site: the mask was
    // written out three times and all three forgot the field, so the fix is
    // one source of truth, and this checks that it stays one. Listings that
    // only need identity keep their own narrower mask on purpose.
    const src = blank(read("src/hooks/useGdriveSync.ts"));
    const decl = src.match(/var SYNC_DIAG_FIELDS = "([^"]+)";/);
    expect(decl, "expected a single named mask for the diagnostic listings").toBeTruthy();
    expect(decl![1], "the diagnostic mask must request the file size").toContain("size");
    const uses = src.match(/fields:\s*SYNC_DIAG_FIELDS\b/g) || [];
    expect(uses.length, "all three diagnostic listings must use the shared mask").toBe(3);
    // …and none of them may have drifted back to a literal carrying size.
    expect(src, "a diagnostic listing wrote its own mask again")
      .not.toMatch(/fields:\s*"files\([^"]*size[^"]*\)"/);
  });

  it("the row builder still reads what the mask now provides", () => {
    // The two halves must move together: asking for `size` buys nothing if the
    // row stops carrying it, and carrying it buys nothing unasked.
    const api = blank(read("src/utils/gdriveApi.ts"));
    expect(api).toMatch(/size:\s*f\.size === undefined/);
  });
});
