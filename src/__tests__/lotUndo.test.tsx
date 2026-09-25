// DELETING A LOT HAD NO UNDO TOAST, and three places said it had one: the
// help (« juste après chaque suppression, un toast en bas affiche un bouton »),
// the fiche's own comment (« the 8 s undo toast still catches accidents ») and
// CLAUDE.md. `withUndo` wrapped the six other deletes; `removeLot` reached ctx
// raw. Found while adding the Disposed-vs-delete hint the toast now carries.
//
// Two halves are locked here. The WIRING, read from source like
// maintenanceUndo.test.tsx (comments blanked — three earlier checks were
// satisfied by the comment explaining the fix). And the part that source
// reading cannot see: the tobacco fiche renders `detail`, a COPY that
// removeLot rewrote, and nothing resyncs it after `save(snapshot)` — so the
// undo has to put the lot back on the open fiche itself.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderWithCtx } from "./viewTestUtils";
import { CuratorUndoToast } from "../views/curator/Overlays";
import { detailAfterLotUndo } from "../utils/lotUtils";
import { LANGUAGES } from "../i18n/languages.ts";
import { translate, ensureLang } from "../i18n.ts";

const code = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
const APP_CODE = code(readFileSync("src/App.tsx", "utf8"));
const OV_CODE = code(readFileSync("src/views/curator/Overlays.tsx", "utf8"));

describe("deleting a lot can be undone", () => {
  it("removeLot is wrapped in withUndo", () => {
    expect(APP_CODE).toMatch(/withUndo\(removeLot,\s*"lot"/);
  });

  it("and the WRAPPED variant is what views get", () => {
    // InventoryDetailView calls ctx.removeLot from both the lot sheet and the
    // lot form; the raw action on ctx is exactly the defect.
    expect(APP_CODE).toMatch(/removeLot:\s*removeLotU/);
  });

  it("the toast can NAME it — an unknown kind renders no overline", () => {
    expect(OV_CODE).toMatch(/lot:\s*\{\s*kind:\s*"kind_lot",\s*verb:\s*"lbl_deleted"\s*\}/);
  });

  it("the undo puts the lot back on the OPEN fiche (afterRestore is wired)", () => {
    expect(APP_CODE).toMatch(/afterRestore:[\s\S]{0,160}detailAfterLotUndo\(/);
  });
});

describe("the hint: Disposed, not delete, for a tin that was thrown away", () => {
  it("resolves in every language and names the Disposed option", async () => {
    for (const { code: lang } of LANGUAGES) {
      await ensureLang(lang);
      const s = String(translate(lang, "undo_hint_lot_disposed"));
      expect(s, lang).not.toBe("undo_hint_lot_disposed");
      // The same 🚮 the lot form's outcome toggle shows, so the user can find it.
      expect(s, lang).toContain("🚮");
      expect(String(translate(lang, "lot_outcome_disposed")), lang).toContain("🚮");
    }
  });

  it("is rendered under the label, as a sentence that wraps", () => {
    const { container, getByText } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: { kind: "lot", label: "Brackwater — Duskfall · Nº 3", hint: "HINT-TEXT", ts: Date.now(), restoreFn: vi.fn() },
      setUndoToast: vi.fn(),
      lang: "fr",
    });
    const text = container.textContent || "";
    expect(text).toMatch(/kind_lot|Lot/);
    expect(text).toMatch(/Brackwater — Duskfall · Nº 3/);
    const hint = getByText("HINT-TEXT");
    expect(hint.style.whiteSpace).toBe("normal");
  });

  it("is absent when the toast carries none (every other delete)", () => {
    const { container } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: { kind: "tobacco", label: "Brackwater — Duskfall", ts: Date.now(), restoreFn: vi.fn() },
      setUndoToast: vi.fn(),
      lang: "fr",
    });
    expect(container.querySelectorAll("span").length).toBe(2); // overline + label, no third line
  });

  it("is skipped for a lot already disposed — it would say nothing", () => {
    expect(APP_CODE).toMatch(/\.disposed\s*\?\s*""\s*:\s*String\(t\("undo_hint_lot_disposed"\)\)/);
  });
});

describe("detailAfterLotUndo", () => {
  const snapshot = {
    tobaccos: [
      { id: 7, name: "Duskfall", lots: [{ id: "a" }, { id: "b" }, { id: "c", deletedAt: "2026-09-01" }] },
      { id: 8, name: "Other", lots: [{ id: "x" }] },
    ],
  };

  it("restores the lot on the fiche of THAT tobacco, trashed lots stripped", () => {
    const cur = { id: 7, name: "Duskfall", lots: [{ id: "a" }] }; // removeLot left it without "b"
    const out = detailAfterLotUndo(cur, snapshot, 7);
    expect(out.lots.map((l: any) => l.id)).toEqual(["a", "b"]);
  });

  it("leaves ANOTHER open fiche alone — never swaps the user's screen", () => {
    const cur = { id: 8, name: "Other", lots: [] };
    expect(detailAfterLotUndo(cur, snapshot, 7)).toBe(cur);
  });

  it("does nothing with no fiche open, or when the tobacco is not in the snapshot", () => {
    expect(detailAfterLotUndo(null, snapshot, 7)).toBeNull();
    const cur = { id: 9, lots: [] };
    expect(detailAfterLotUndo(cur, snapshot, 9)).toBe(cur);
    expect(detailAfterLotUndo(cur, { tobaccos: "garbage" }, 9)).toBe(cur);
  });

  it("matches ids across number/string, like every other lookup here", () => {
    const cur = { id: "7", lots: [] };
    expect(detailAfterLotUndo(cur, snapshot, 7).lots).toHaveLength(2);
  });
});
