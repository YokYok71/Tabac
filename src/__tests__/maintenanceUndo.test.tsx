// The maintenance log was the app's ONLY delete with no
// safety net.
//
// Every other delete is a soft-delete + an 8 s undo toast + the 30-day trash.
// `usePipeStore.removeMaintenance` hard-filters the entry out — no `deletedAt`,
// no trash — it was NOT wrapped in `withUndo` (which wraps the five top-level
// deletes), and `MaintFormModal` fires it straight from the bottom bar with no
// confirm.
//
// CLAUDE.md justifies the hard delete ("a log entry is minor") and that part
// still holds: a `deletedAt` + trash entry for a maintenance row would be
// machinery out of proportion. What did not hold is the ASYMMETRY IN FEEDBACK
// — the one delete you cannot get back was also the only one that said
// nothing, on an entry carrying a free-text `notes` field.
//
// `withUndo` snapshots the whole cellar and restores it wholesale, so it needs
// nothing from the store. That is why this is the cheap fix.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages.ts";
import { translate, ensureLang } from "../i18n.ts";

const APP = readFileSync("src/App.tsx", "utf8");
const OVERLAYS = readFileSync("src/views/curator/Overlays.tsx", "utf8");
// length-preserving comment blanking — three earlier releases each shipped a check
// that was satisfied by the comment explaining the fix.
const code = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
const APP_CODE = code(APP);
const OV_CODE = code(OVERLAYS);

describe("deleting a maintenance entry can be undone", () => {
  it("removeMaintenance is wrapped in withUndo", () => {
    expect(APP_CODE, "the wrapper is what produces the toast")
      .toMatch(/withUndo\(removeMaintenance,\s*"maintenance"/);
  });

  it("and the WRAPPED variant is what views get", () => {
    // The whole fix is inert if ctx still exposes the raw store action —
    // `MaintFormModal` calls `ctx.removeMaintenance`, so the key must carry
    // the wrapper. Same shape as `deleteTobacco: deleteTobaccoU`.
    expect(APP_CODE).toMatch(/removeMaintenance:\s*removeMaintenanceU/);
  });

  it("the toast can NAME it — an unknown kind renders no overline at all", () => {
    // `UNDO_KIND` is the one table giving both halves of the
    // overline, and a kind absent from it deliberately renders NOTHING rather
    // than a guess. So a new undoable action without a row loses information
    // silently — which is exactly what would have happened here.
    expect(OV_CODE).toMatch(/maintenance:\s*\{\s*kind:\s*"kind_maintenance",\s*verb:\s*"lbl_deleted"\s*\}/);
  });

  it("kind_maintenance resolves in every language", async () => {
    for (const { code: lang } of LANGUAGES) {
      await ensureLang(lang);
      const s = translate(lang, "kind_maintenance");
      expect(s, lang).not.toBe("kind_maintenance");
      expect(String(s).length, lang).toBeGreaterThan(3);
    }
  });

  it("the label is a SUBJECT, not a sentence", () => {
    // That slot is maxWidth 240 + nowrap + ellipsis, so the label
    // must stay short. Date first, like _sessLabel.
    expect(APP_CODE).toMatch(/function _maintLabel/);
    expect(APP_CODE).toMatch(/\[dateStr, pipeName\]\.filter\(Boolean\)\.join\(" · "\)/);
  });
});
