// Reactivating a finished lot had two defects, and they only bite the lot
// that was genuinely SMOKED to zero — which is the ordinary one.
//
// (1) THE TARGET. Both branches read `lot.originalStatus === "jar" ? "jar" :
//     "cellar"`, and `originalStatus` is "cellar" for essentially every lot
//     the app creates (the add-lot form defaults to Cave; `migrateData`'s
//     legacy heuristic sends anything carrying a `dateOpened` to "cellar").
//     So a tin opened in 2023 and smoked down over a hundred grams of
//     sessions came back as SEALED — and `applyLifecycleDates(…, "cellar")`
//     ERASES `dateOpened`, the only record of when it was opened.
//
//     `stepAutoReactivate` — the AUTOMATIC path, when a session credit brings
//     a finished lot back above zero — settles this in its own comment:
//     "the target is ALWAYS 'jar', INTENTIONALLY … a lot that ever hosted a
//     session was necessarily OPENED (you can't smoke from a sealed cellar
//     tin)". It then says the manual button consults `originalStatus`
//     "because it can reactivate a NEVER-smoked lot (a mis-marked finish)".
//
//     NOTE, because an audit got this backwards: that comment does NOT forbid
//     what the manual button does — it endorses it. What the button was
//     missing is the DISCRIMINATOR the comment names. A lot with sessions is
//     the auto path's case and must go back to `jar`; a lot with none is the
//     mis-marked finish and keeps `originalStatus`.
//
// (2) THE WEIGHT. The zero-weight branch pre-filled a hardcoded `"50"` — a
//     number with no relation to that lot, and the same `BL.weightG` literal
//     that was removed from `addTobacco`'s starter lot as invented stock. It
//     survived in this sibling.
//
//     For a lot smoked to zero, Σ(sessions) ALREADY equals `weightInitial`,
//     so `lot-balance-overflow` (`Σ − (initial − current) > 0.5`) fires for
//     ANY positive weight — there is no value the user could type that would
//     be consistent, and the diagnostic would go oxblood permanently with no
//     repair tool. An EMPTY weight is the app's own "untracked" state: the
//     balance check skips a non-finite weight, the session pickers still
//     offer the lot, and nothing is debited. It is also honest — the app does
//     not know what is in that tin.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorInventoryDetailView } from "../../views/curator/InventoryDetailView";
import { checkAllInvariants } from "../../utils/lotInvariants";
import { applyLifecycleDates } from "../../utils/lotUtils";

const FINISHED = {
  id: 101, status: "finished", originalStatus: "cellar",
  weightG: "0", weightInitial: "100",
  datePurchased: "2023-01-10", dateOpened: "2023-04-01", dateFinished: "2026-02-02",
  boxNumber: "1", price: "18", seller: "", disposed: false,
};

function fiche(over: any = {}) {
  const lots = over.lots || [FINISHED];
  const tob: any = {
    id: 1, brand: "Halvorsen", name: "Early Tide", category: "Virginia",
    lots, tags: [],
  };
  const changeLotStatus = vi.fn();
  const r = renderWithCtx(<CuratorInventoryDetailView />, {
    view: "inv", detail: tob,
    data: { tobaccos: [tob], pipes: [], accessories: [], wishlist: [], sessions: over.sessions || [] },
    statusFilter: "all",
    changeLotStatus,
    weightUnit: "g",
    ...over.ctx,
  });
  return { ...r, changeLotStatus, tob };
}

/** Reveal the finished lots, then activate the row's ↻ Réactiver. */
function reactivate(container: HTMLElement) {
  // Finished lots are hidden behind a toggle.
  const show = Array.from(container.querySelectorAll('[role="button"], button'))
    .find((b) => /finished|termin/i.test(b.textContent || "")) as HTMLElement | undefined;
  if (show) fireEvent.click(show);
  const btn = Array.from(container.querySelectorAll('[role="button"], button'))
    .find((b) => /reactivate|réactiver|btn_reactivate/i.test(
      (b.getAttribute("aria-label") || "") + " " + (b.textContent || ""))) as HTMLElement | undefined;
  expect(btn, "no Réactiver control on the finished lot row").toBeTruthy();
  fireEvent.click(btn!);
}

/** The `weightG` (CURRENT weight) the reactivate form opened with.
 *
 * Targeted precisely: the modal shows `lbl_initial_weight` AND
 * `lbl_current_weight`, and a loose /poids|weight/ matcher takes the FIRST —
 * which made the "no hardcoded 50" case pass while reading `weightInitial`.
 * It was green for the wrong reason until the balance case contradicted it.
 */
function weightField(container: HTMLElement): string | null {
  const label = Array.from(container.querySelectorAll("label"))
    .find((l) => (l.textContent || "").indexOf("lbl_current_weight") >= 0);
  expect(label, "no current-weight field — the reactivate form did not open").toBeTruthy();
  const el = label!.htmlFor
    ? (container.querySelector("#" + CSS.escape(label!.htmlFor)) as HTMLInputElement | null)
    : (label!.parentElement?.querySelector("input") as HTMLInputElement | null);
  expect(el, "the current-weight label is wired to no input").toBeTruthy();
  return el!.value;
}

// Two bowls of 50 g against a 100 g tin: Σ(sessions) EQUALS weightInitial,
// which is what makes every positive reactivation weight overflow.
const sessions = [
  { id: 1, date: "2024-01-01", tobaccoId: 1, pipeId: 1, lotId: 101, duration: "30", weightG: "50" },
  { id: 2, date: "2025-01-01", tobaccoId: 1, pipeId: 1, lotId: 101, duration: "30", weightG: "50" },
];

describe("reactivating a lot that was SMOKED to zero", () => {
  it("does not pre-fill a hardcoded 50 g", () => {
    const { container } = fiche({ sessions });
    reactivate(container);
    const w = weightField(container);
    expect(w, "the form invented 50 g of stock").not.toBe("50");
  });

  it("the pre-filled state does not break the balance", () => {
    // What the user gets if they accept the form as it opens. Σ(sessions) is
    // 100 and `weightInitial` is 100, so ANY positive weight overflows —
    // permanently, with no repair tool.
    const { container } = fiche({ sessions });
    reactivate(container);
    const w = weightField(container);
    const reactivated = Object.assign({}, FINISHED, {
      status: "jar", weightG: w === null ? "" : w, dateFinished: "", disposed: false,
    });
    const data: any = {
      tobaccos: [{ id: 1, brand: "H", name: "E", lots: [reactivated] }],
      pipes: [], accessories: [], wishlist: [], sessions,
      nxT: 2, nxP: 1, nxA: 1, nxJ: 3, nxW: 1,
    };
    expect(checkAllInvariants(data).map((v: any) => v.rule))
      .not.toContain("lot-balance-overflow");
  });
});

describe("the reactivate target follows the lot's HISTORY, not its origin flag", () => {
  it("a lot that hosted a session comes back OPENED, keeping its dateOpened", () => {
    // The auto path's rule, applied to the manual button: you cannot smoke
    // from a sealed cellar tin, so a lot with sessions was opened.
    // `applyLifecycleDates(lot, "cellar")` erases `dateOpened` — the one
    // record of when the tin was opened, and unrecoverable.
    const kept = applyLifecycleDates(FINISHED as any, "jar", "manual") as any;
    expect(kept.dateOpened, "the opening date must survive").toBe("2023-04-01");
    const lost = applyLifecycleDates(FINISHED as any, "cellar", "manual") as any;
    expect(lost.dateOpened, "premise: the cellar target really does erase it").toBe("");
  });

  it("a NEVER-smoked lot still honours originalStatus — the mis-marked finish", () => {
    // The case the auto path's comment carves out, and the reason the manual
    // button reads `originalStatus` at all. It must keep working.
    const { container, changeLotStatus } = fiche({
      sessions: [],
      lots: [Object.assign({}, FINISHED, { weightG: "40", originalStatus: "cellar" })],
    });
    reactivate(container);
    expect(changeLotStatus).toHaveBeenCalledWith(1, 101, "cellar");
  });

  it("a lot with sessions and stock left goes to jar, not cellar", () => {
    const { container, changeLotStatus } = fiche({
      sessions,
      lots: [Object.assign({}, FINISHED, { weightG: "40" })],
    });
    reactivate(container);
    expect(changeLotStatus).toHaveBeenCalledWith(1, 101, "jar");
  });
});
