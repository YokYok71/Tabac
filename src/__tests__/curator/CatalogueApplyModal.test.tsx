// The confirm modal for the bulk catalogue pass had NO test.
//
// It is the only thing standing between one tap and a write across every
// tobacco and every wishlist row. Two of its branches exist specifically so a
// reassuring message cannot become a misleading one — the `locked`
// counter (a cellar whose every matching fiche is pinned would otherwise read
// « tout est déjà à jour », true of the rows the pass looked at and false about
// The ones it deliberately did not) and the `missing` (a pass with no
// catalogue loaded plans zero changes and would land on the same sentence).
// Both were argued at length in CLAUDE.md and asserted by nothing.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorCatalogueApplyModal } from "../../CuratorApp";

const t = (k: string) => k;

function render(plan: any, over: any = {}) {
  const ctx = {
    catalogueApplyPlan: plan,
    setCatalogueApplyPlan: vi.fn(),
    doCatalogueApply: vi.fn(),
    setImportModal: vi.fn(),
    setSettingsTab: vi.fn(),
    t, lang: "fr",
    ...over,
  };
  return { ctx, ...renderWithCtx(<CuratorCatalogueApplyModal />, ctx) };
}

const PLAN = {
  entries: [{ id: 1 }, { id: 2 }],
  tobaccosChanged: 2, wishesChanged: 0, fieldsChanged: 5,
  unmatched: 0, locked: 0, alreadyCurrent: 0,
};

describe("nothing renders without a plan", () => {
  it("returns null", () => {
    const { container } = render(null);
    expect(container.firstChild).toBeNull();
  });
});

describe("the confirm states the counts BEFORE anything is written", () => {
  it("names how many fiches and how many fields", () => {
    const { container } = render(PLAN);
    const txt = container.textContent || "";
    expect(txt).toContain("cat_apply_plan");
    expect(txt, "the fields it touches").toContain("cat_apply_fields");
    expect(txt, "and what it never touches").toContain("cat_apply_safe");
  });

  it("nothing is written until the user confirms", () => {
    const { ctx, getByText } = render(PLAN);
    expect(ctx.doCatalogueApply).not.toHaveBeenCalled();
    fireEvent.click(getByText("cat_apply_go"));
    expect(ctx.doCatalogueApply).toHaveBeenCalledTimes(1);
  });

  it("the secondary action CANCELS rather than closing a finished job", () => {
    // The wording distinguishes the two, and it is the only signal that the
    // pass has not run yet.
    const { ctx, getByText } = render(PLAN);
    fireEvent.click(getByText("btn_cancel"));
    expect(ctx.setCatalogueApplyPlan).toHaveBeenCalledWith(null);
    expect(ctx.doCatalogueApply, "cancelling must not write").not.toHaveBeenCalled();
  });

  it("reports the unmatched rows, which are not a failure", () => {
    const { container } = render({ ...PLAN, unmatched: 7 });
    expect(container.textContent || "").toContain("cat_apply_unmatched");
  });
});

describe("the locked count appears in BOTH branches", () => {
  // The whole reason that counter exists. A cellar whose every matching fiche
  // carries `catalogueLock` plans nothing — and « tout est déjà à jour » would
  // then be the reassuring answer to a question the pass never asked.
  it("…in the nothing-to-do branch", () => {
    const { container } = render({ entries: [], tobaccosChanged: 0, wishesChanged: 0,
      fieldsChanged: 0, unmatched: 0, locked: 4 });
    const txt = container.textContent || "";
    expect(txt, "the reassuring sentence").toContain("cat_apply_nothing");
    expect(txt, "…qualified by the count").toContain("cat_apply_locked");
  });

  it("…and in the there-is-work branch", () => {
    const { container } = render({ ...PLAN, locked: 4 });
    const txt = container.textContent || "";
    expect(txt).toContain("cat_apply_plan");
    expect(txt).toContain("cat_apply_locked");
  });

  it("and stays quiet when nothing is pinned", () => {
    expect(render({ ...PLAN, locked: 0 }).container.textContent || "")
      .not.toContain("cat_apply_locked");
  });

  it("the nothing-to-do branch offers no way to WRITE", () => {
    const { container } = render({ entries: [], tobaccosChanged: 0, wishesChanged: 0,
      fieldsChanged: 0, unmatched: 0, locked: 0 });
    const txt = container.textContent || "";
    expect(txt).not.toContain("cat_apply_go");
    expect(txt, "only a way out").toContain("btn_close");
  });
});

describe("no catalogue is its own answer, not « already up to date »", () => {
  it("says the catalogue is missing and points at Settings", () => {
    const { container } = render({ missing: true, entries: [], locked: 0 });
    const txt = container.textContent || "";
    expect(txt, "the missing-catalogue hint").toContain("cat_missing_hint");
    expect(txt, "NOT the reassuring sentence").not.toContain("cat_apply_nothing");
    expect(txt, "nor an apply button").not.toContain("cat_apply_go");
  });

  it("the way forward OPENS the tab that can fix it", () => {
    const { ctx, getByText } = render({ missing: true, entries: [], locked: 0 });
    fireEvent.click(getByText("btn_cat_open_settings"));
    expect(ctx.setSettingsTab).toHaveBeenCalledWith("data");
    expect(ctx.setImportModal).toHaveBeenCalledWith(true);
    expect(ctx.setCatalogueApplyPlan, "…and closes itself first").toHaveBeenCalledWith(null);
  });
});

describe("a failed plan is reported, never silently treated as no-op", () => {
  it("shows the error and offers no apply", () => {
    const { container } = render({ error: true, entries: [], locked: 0 });
    const txt = container.textContent || "";
    expect(txt).toContain("cat_apply_err");
    expect(txt).not.toContain("cat_apply_go");
    expect(txt).not.toContain("cat_apply_nothing");
  });
});
