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
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "./viewTestUtils";
import { CuratorUndoToast } from "../views/curator/Overlays";
import { detailAfterLotUndo, markLotDisposed } from "../utils/lotUtils";
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
  it("resolves in every language, and the button carries the Disposed 🚮", async () => {
    for (const { code: lang } of LANGUAGES) {
      await ensureLang(lang);
      for (const k of ["undo_hint_lot_disposed", "btn_mark_disposed", "lbl_marked_disposed"]) {
        expect(String(translate(lang, k)), lang + " " + k).not.toBe(k);
      }
      // The same 🚮 the lot form's outcome toggle shows, so the two read as one thing.
      expect(String(translate(lang, "btn_mark_disposed")), lang).toContain("🚮");
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

describe("« Marquer éliminé » — one tap instead of an explanation", () => {
  it("is offered by the lot toast, and built on markLotDisposed", () => {
    expect(APP_CODE).toMatch(/action:\s*function[\s\S]{0,400}markLotDisposed\(d, tobId, lotId\)/);
  });

  it("withUndo actually HANDS the action to the toast", () => {
    // Found by a probe: dropping this one spread left every other case green
    // while the button could never appear — the render cases feed the toast
    // a hand-built object and never go through withUndo.
    expect(APP_CODE).toMatch(/\.\.\.\(action \? \{ action: action \} : \{\}\)/);
  });

  it("is NOT offered for a lot already disposed", () => {
    expect(APP_CODE).toMatch(/if \(!lot \|\| \(lot as any\)\.disposed\) return null;/);
  });

  it("replaces the toast with a confirmation the toast can NAME", () => {
    expect(APP_CODE).toMatch(/kind:\s*"lot_disposed"/);
    expect(OV_CODE).toMatch(/lot_disposed:\s*\{\s*kind:\s*"kind_lot",\s*verb:\s*"lbl_marked_disposed"\s*\}/);
  });

  it("renders as a button that runs the action", () => {
    const run = vi.fn();
    const { getByRole } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: { kind: "lot", label: "X", hint: "H", action: { label: "MARK-IT", run }, ts: Date.now(), restoreFn: vi.fn() },
      setUndoToast: vi.fn(),
      lang: "fr",
    });
    const btn = getByRole("button", { name: "MARK-IT" });
    expect(parseInt(btn.style.minHeight, 10)).toBeGreaterThanOrEqual(36);
    fireEvent.click(btn);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is absent when the toast carries no action", () => {
    const { queryByRole } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: { kind: "lot", label: "X", hint: "H", ts: Date.now(), restoreFn: vi.fn() },
      setUndoToast: vi.fn(),
      lang: "fr",
    });
    expect(queryByRole("button", { name: "MARK-IT" })).toBeNull();
  });
});

describe("markLotDisposed", () => {
  const before = {
    sessions: [{ id: 1 }],
    tobaccos: [
      { id: 7, lots: [
        { id: "a", status: "jar", weightG: "20", dateOpened: "2026-08-01", dateFinished: "" },
        { id: "b", status: "cellar", weightG: "50" },
      ] },
      { id: 8, lots: [{ id: "a", status: "jar", weightG: "5" }] },
    ],
  };

  it("marks THAT lot Finished + Disposed, stamps an end date, keeps its weight", () => {
    const out = markLotDisposed(before, 7, "a");
    const lot = out.tobaccos[0].lots[0];
    expect(lot.status).toBe("finished");
    expect(lot.disposed).toBe(true);
    expect(lot.dateFinished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lot.weightG).toBe("20"); // thrown away is not rewritten as smoked
    expect(lot.dateOpened).toBe("2026-08-01");
    expect("deletedAt" in lot).toBe(false);
  });

  it("keeps an end date already recorded", () => {
    const d = { tobaccos: [{ id: 7, lots: [{ id: "a", status: "finished", dateFinished: "2026-01-02" }] }] };
    expect(markLotDisposed(d, 7, "a").tobaccos[0].lots[0].dateFinished).toBe("2026-01-02");
  });

  it("touches nothing else — not the sibling lot, not the same lot id under another tobacco", () => {
    const out = markLotDisposed(before, 7, "a");
    expect(out.tobaccos[0].lots[1]).toBe(before.tobaccos[0]!.lots[1]);
    expect(out.tobaccos[1]).toBe(before.tobaccos[1]); // lot ids are unique per tobacco only
    expect(out.sessions).toBe(before.sessions);
    expect(before.tobaccos[0]!.lots[0]!.status).toBe("jar"); // input not mutated
  });

  it("returns the input unchanged when the tobacco or the lot is missing", () => {
    expect(markLotDisposed(before, 99, "a")).toBe(before);
    expect(markLotDisposed(before, 7, "zz")).toBe(before);
    expect(markLotDisposed(null, 7, "a")).toBeNull();
  });
});
