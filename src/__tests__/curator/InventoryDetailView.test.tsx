// Smoke tests for src/views/curator/InventoryDetailView.tsx.
//
// Coverage focus:
//   - returns null when view !== "inv" OR detail is null
//   - renders the tobacco brand + name
//   - "Ajouter un lot" button opens the lot form
//   - delete button calls setDelConfirm
//   - Reactivate gate: shown on every finished lot (fix unblocks
//     the path where weightG>0)
//   - Reactivate behaviour for weightG > 0: calls changeLotStatus directly

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { lotAgingStatus } from "../../utils";
import { CuratorInventoryDetailView } from "../../views/curator/InventoryDetailView";

const tobacco = {
  id: "1",
  brand: "Brackwater",
  name: "Duskfall",
  category: "Anglais",
  cut: "Ribbon",
  blend: "Latakia, Virginia",
  description: "A robust English blend",
  force: 4,
  roomNote: 3,
  taste: 4,
  rating: 5,
  rebuy: true,
  imageUrl: "",
  tastingNotes: "Smoky and rich",
  agingMax: "10-15",
  lots: [],
};

describe("InventoryDetailView — visibility", () => {
  it("returns null when view !== 'inv'", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "home",
      detail: tobacco,
    });
    expect(container.firstChild).toBeNull();
  });

  it("returns null when detail is null", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: null,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the tobacco brand and name when view='inv' + detail set", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobacco,
      data: { tobaccos: [tobacco], sessions: [], pipes: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).toContain("Brackwater");
    expect(container.textContent).toContain("Duskfall");
  });

  // addLotToTobacco / updateLotInTobacco /
  // changeLotStatus set `detail` to the RAW tobacco whose lots still contain
  // soft-deleted rows; visibleLots must exclude them defensively.
  it("does not render soft-deleted lots in the fiche", () => {
    const withTrashedLot = {
      ...tobacco,
      lots: [
        { id: 10, status: "cellar", weightG: "50", weightInitial: "50", storageLocation: "SHELF-LIVE",
          datePurchased: "", dateProduction: "", dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
        { id: 11, status: "cellar", weightG: "40", weightInitial: "40", storageLocation: "SHELF-TRASHED",
          datePurchased: "", dateProduction: "", dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false, deletedAt: "2026-07-01T00:00:00.000Z" },
      ],
    };
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: withTrashedLot,
      statusFilter: "all",
      data: { tobaccos: [withTrashedLot], sessions: [], pipes: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).toContain("SHELF-LIVE");
    expect(container.textContent).not.toContain("SHELF-TRASHED");
  });
});

describe("InventoryDetailView — delete", () => {
  // The trash button now calls deleteTobacco directly
  // (soft-delete → Trash + 8 s undo toast). No more confirm modal.
  it("delete button calls deleteTobacco with the tobacco id", () => {
    const deleteTobacco = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobacco,
      data: { tobaccos: [tobacco], sessions: [], pipes: [], accessories: [], wishlist: [] },
      deleteTobacco,
    });
    const buttons = getAllByRole("button");
    const trashBtn = buttons.find(b => /trash|btn_delete|Supprimer|Delete/i.test(b.getAttribute("aria-label") || ""));
    if (trashBtn) {
      fireEvent.click(trashBtn);
      expect(deleteTobacco).toHaveBeenCalledWith("1");
    }
  });
});

describe("InventoryDetailView — Reactivate gate", () => {
  // Finished lots are only rendered when statusFilter === "finished" or
  // the local showFinishedLots toggle is on; we surface them via the
  // filter for these tests.
  const tobWithFinishedLot = {
    ...tobacco,
    lots: [
      { id: "L1", status: "finished", weightG: "25", dateProduction: "", datePurchased: "", dateOpened: "2024-01-01", dateFinished: "2024-06-01", boxNumber: "", price: "", seller: "", disposed: false },
    ],
  };

  it("Reactivate button is visible for finished lots regardless of weight", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobWithFinishedLot,
      data: { tobaccos: [tobWithFinishedLot], sessions: [], pipes: [], accessories: [], wishlist: [] },
      statusFilter: "finished",
    });
    // Test ctx mockT returns the key, so we look for the i18n key.
    expect(container.textContent).toMatch(/btn_reactivate/);
  });

  it("Reactivate on weightG > 0 lot calls changeLotStatus('cellar') directly", () => {
    const changeLotStatus = vi.fn();
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobWithFinishedLot,
      data: { tobaccos: [tobWithFinishedLot], sessions: [], pipes: [], accessories: [], wishlist: [] },
      statusFilter: "finished",
      changeLotStatus,
    });
    const reactBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_reactivate/i.test(b.textContent || ""));
    expect(reactBtn).toBeTruthy();
    fireEvent.click(reactBtn!);
    expect(changeLotStatus).toHaveBeenCalledWith("1", "L1", "cellar");
  });

  // "actif" (a un lot non-fini) ≠ "fumable" (a un lot pesé).
  // A tabac whose active lots can't back a session shows a hint explaining it.
  //
  // REVERSAL, recorded here so it isn't "fixed" back. This
  // case used to feed an UNWEIGHED starter lot (`weightG: ""`) and assert the
  // hint. An earlier release settled that an unweighed lot is an ABSENCE of data, not
  // an empty tin: such a lot is usable and the tabac IS offered in both
  // session pickers, so the hint about it had become false. The state that
  // still warrants it is an explicit ZERO — which the pickers do refuse.
  it("shows the no-weight hint when every active lot is weighed at ZERO", () => {
    const tobZeroed = {
      ...tobacco,
      lots: [
        { id: "L1", status: "cellar", weightG: "0", weightInitial: "50", dateProduction: "", datePurchased: "",
          dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
      ],
    };
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobZeroed,
      data: { tobaccos: [tobZeroed], sessions: [], pipes: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).toMatch(/lot_no_weight_hint/);
  });

  // The other half of that reversal: an UNWEIGHED lot must NOT raise it. The
  // session pickers offer this tabac, so a hint saying it can't be used is a
  // statement the rest of the app contradicts.
  it("hides the no-weight hint when the only active lot is UNWEIGHED", () => {
    const tobEmptyStarter = {
      ...tobacco,
      lots: [
        { id: "L1", status: "cellar", weightG: "", weightInitial: "", dateProduction: "", datePurchased: "",
          dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
      ],
    };
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobEmptyStarter,
      data: { tobaccos: [tobEmptyStarter], sessions: [], pipes: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).not.toMatch(/lot_no_weight_hint/);
  });

  it("hides the no-weight hint when an active lot carries a weight", () => {
    const tobWeighed = {
      ...tobacco,
      lots: [
        { id: "L1", status: "cellar", weightG: "50", weightInitial: "50", dateProduction: "", datePurchased: "",
          dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
      ],
    };
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobWeighed,
      data: { tobaccos: [tobWeighed], sessions: [], pipes: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).not.toMatch(/lot_no_weight_hint/);
  });

  it("hides the no-weight hint for an inactive (all-finished) tabac", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobWithFinishedLot,
      data: { tobaccos: [tobWithFinishedLot], sessions: [], pipes: [], accessories: [], wishlist: [] },
      statusFilter: "finished",
    });
    expect(container.textContent).not.toMatch(/lot_no_weight_hint/);
  });

  // A JAR lot (opened) shows the "ouvert depuis N" signal instead
  // of a cellaring maturity chip; a CELLAR lot does not.
  it("shows the 'ouvert depuis' signal on a jar lot, not on a cellar lot", () => {
    const tobJar = {
      ...tobacco,
      lots: [{ id: "L1", status: "jar", weightG: "30", weightInitial: "50", originalStatus: "jar",
        dateProduction: "", datePurchased: "", dateOpened: "2025-01-01", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv", detail: tobJar,
      data: { tobaccos: [tobJar], sessions: [], pipes: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).toMatch(/lot_open_since/);
  });

  it("does NOT show the 'ouvert depuis' signal on a cellar lot", () => {
    const tobCellar = {
      ...tobacco,
      lots: [{ id: "L1", status: "cellar", weightG: "50", weightInitial: "50", originalStatus: "cellar",
        dateProduction: "2024-01-01", datePurchased: "2024-01-01", dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv", detail: tobCellar,
      data: { tobaccos: [tobCellar], sessions: [], pipes: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).not.toMatch(/lot_open_since/);
  });
});

// ── Lot detail modal — same pattern as SessionDetailModal ────────
// Tapping a lot row in the tobacco fiche opens a read-only modal first.
// The Edit button in the modal switches to the lot form (write mode);
// Delete soft-deletes via removeLot (no window.confirm,
// the Trash + 8 s undo toast cover accidents).

describe("InventoryDetailView — lot detail modal", () => {
  const tobWithLot = {
    ...tobacco,
    lots: [{
      id: "L1", status: "jar", weightG: "30", weightInitial: "50",
      originalStatus: "jar",
      datePurchased: "2024-01-10", dateProduction: "", dateOpened: "2024-02-01",
      dateFinished: "", boxNumber: "B1", price: "12", seller: "C&D",
      disposed: false,
    }],
  };

  it("opens the detail modal when a lot row is tapped (not the edit form)", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobWithLot,
      statusFilter: "all",
      data: { tobaccos: [tobWithLot], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // Click the "Nº B1" span — bubbling fires the LotRow outer onClick.
    const numSpan = Array.from(container.querySelectorAll("span"))
      .find(s => (s.textContent || "").trim() === "Nº B1");
    expect(numSpan).toBeTruthy();
    fireEvent.click(numSpan!);
    // The detail modal should now be on screen — the Edit / Delete / Close
    // action buttons appear.
    const text = container.textContent || "";
    expect(text).toMatch(/btn_close|Fermer|Close/);
    expect(text).toMatch(/btn_edit|Modifier|Edit/);
    expect(text).toMatch(/btn_delete|Supprimer|Delete/);
    // Box number echoes inside the modal title as well.
    expect(text).toMatch(/Nº B1/);
  });

  it("shows the lot's maturity chip in the detail modal", () => {
    // agingMax 5, lot produced 2016 → ~10y old → overaged → "⚠ mat_old".
    const tob = {
      ...tobacco, agingMax: "5",
      lots: [{
        id: "L9", status: "cellar", weightG: "50", weightInitial: "50",
        originalStatus: "cellar", datePurchased: "", dateProduction: "2016-01-01",
        dateOpened: "", dateFinished: "", boxNumber: "B9", price: "", seller: "",
        disposed: false,
      }],
    };
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv", detail: tob, statusFilter: "all",
      data: { tobaccos: [tob], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const numSpan = Array.from(container.querySelectorAll("span"))
      .find(s => (s.textContent || "").trim() === "Nº B9");
    fireEvent.click(numSpan!);
    // The maturity chip renders in the modal (and on the row) — assert the
    // overaged band label is present with its ⚠ prefix.
    expect(container.textContent || "").toContain("⚠ mat_old");
  });

  it("Duplicate button in the detail modal calls addLotToTobacco with a fresh full copy", () => {
    const addLotToTobacco = vi.fn();
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobWithLot,
      statusFilter: "all",
      addLotToTobacco,
      data: { tobaccos: [tobWithLot], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const numSpan = Array.from(container.querySelectorAll("span"))
      .find(s => (s.textContent || "").trim() === "Nº B1");
    fireEvent.click(numSpan!);
    // The Duplicate PressCard is present in the detail modal (text = i18n key).
    const dupBtn = Array.from(container.querySelectorAll("[role='button']"))
      .find(b => (b.textContent || "").trim() === "lot_duplicate");
    expect(dupBtn).toBeTruthy();
    fireEvent.click(dupBtn as Element);
    expect(addLotToTobacco).toHaveBeenCalledTimes(1);
    const [tobId, dup, count] = addLotToTobacco.mock.calls[0]!;
    expect(tobId).toBe(tobWithLot.id);
    expect(count).toBe(1);
    // Fresh full copy: weightG reset to the initial weight, no id.
    expect(dup.weightG).toBe("50");
    expect("id" in dup).toBe(false);
  });

  it("Edit button in the detail modal opens the lot form (write mode)", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobWithLot,
      statusFilter: "all",
      data: { tobaccos: [tobWithLot], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const numSpan = Array.from(container.querySelectorAll("span"))
      .find(s => (s.textContent || "").trim() === "Nº B1");
    fireEvent.click(numSpan!);
    // The mock t() returns the i18n key — locate the Edit PressCard by
    // its trimmed text "btn_edit".
    const editBtn = Array.from(container.querySelectorAll("[role='button']"))
      .find(b => (b.textContent || "").trim() === "btn_edit");
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn as Element);
    // The lot edit form (CuratorLotFormModal) renders a Save PressCard
    // (`role="button"`) when open — its presence signals the write
    // mode flipped on. The Edit button on the detail modal also has
    // text "btn_edit" so we filter for an exact match on "btn_save".
    const formSave = Array.from(container.querySelectorAll("[role='button']"))
      .find(b => (b.textContent || "").trim() === "btn_save");
    expect(formSave).toBeTruthy();
  });
});

// ── rebuy badge in hero ───────────────────────────────────────
// The detail view used to silently drop the tri-state `rebuy` field. It now
// surfaces it as a hero badge: null → no badge, true → sage "À reprendre",
// false → oxblood "✕ Pas reprendre". Same colour grammar as TobaccoCard's
// "✕" no-rebuy chip so the cue is consistent across list and detail.

describe("InventoryDetailView — rebuy badge", () => {
  it("shows the 'À reprendre' badge when rebuy === true", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: { ...tobacco, rebuy: true },
    });
    expect((container.textContent || "")).toContain("rebuy_yes");
  });

  it("shows the '✕ Pas reprendre' badge when rebuy === false", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: { ...tobacco, rebuy: false },
    });
    const txt = container.textContent || "";
    expect(txt).toContain("rebuy_no");
    expect(txt).toContain("✕");
  });

  it("shows neither badge when rebuy === null (undecided)", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: { ...tobacco, rebuy: null },
    });
    const txt = container.textContent || "";
    expect(txt).not.toContain("rebuy_yes");
    expect(txt).not.toContain("rebuy_no");
  });
});

describe("InventoryDetailView — aroma fingerprint", () => {
  const withSessions = (sessions: any[]) => ({
    view: "inv",
    detail: tobacco,
    data: { tobaccos: [tobacco], sessions, pipes: [], accessories: [], wishlist: [] },
  });

  it("shows the 'Arômes perçus' section aggregating this tobacco's sessions", () => {
    const { container } = renderWithCtx(
      <CuratorInventoryDetailView />,
      withSessions([
        { id: 1, tobaccoId: "1", aromas: ["vanilla", "leather"] },
        { id: 2, tobaccoId: "1", aromas: ["vanilla"] },
        { id: 3, tobaccoId: "9", aromas: ["fig"] }, // other tobacco → excluded
      ]),
    );
    const txt = container.textContent || "";
    // mockT returns the key, so the section title + aroma labels show as keys
    expect(txt).toContain("sec_tobacco_aromas");
    expect(txt).toContain("aroma_vanilla");
    expect(txt).toContain("2×");            // vanilla counted twice
    expect(txt).toContain("aroma_leather");
    expect(txt).not.toContain("aroma_fig"); // belongs to another tobacco
  });

  it("hides the section when this tobacco has no aroma-tagged sessions", () => {
    const { container } = renderWithCtx(
      <CuratorInventoryDetailView />,
      withSessions([{ id: 1, tobaccoId: "1", aromas: [] }]),
    );
    expect(container.textContent || "").not.toContain("sec_tobacco_aromas");
  });
});

// tapping a "Top pipes utilisées" row must open the pipe fiche
// (it was an inert div before — clicking did nothing).
describe("InventoryDetailView — top-pipes row navigates to the pipe", () => {
  const pipe = { id: "10", brand: "Halvorsen", name: "Sherlock", status: "active" };
  const sessions = [
    { id: 1, tobaccoId: "1", pipeId: "10", weightG: "3" },
    { id: 2, tobaccoId: "1", pipeId: "10", weightG: "3" },
  ];

  it("clicking a top-pipe row cross-opens the pipe fiche", () => {
    const crossOpenDetail = vi.fn();
    const { getByText } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv",
      detail: tobacco,
      data: { tobaccos: [tobacco], pipes: [pipe], accessories: [], wishlist: [], sessions },
      crossOpenDetail,
    });
    // The pipe name appears in the top-pipes row; click its enclosing button.
    const row = getByText("Sherlock").closest("button") || getByText("Sherlock").closest("[role='button']");
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLElement);
    expect(crossOpenDetail).toHaveBeenCalledWith({ view: "pipes", kind: "pipe", obj: pipe });
  });
});

// ── the fiche must not contradict itself ───────────────────
// It ALREADY hid non-matching lots when the list was filtered to jar/cellar,
// while its total weight counted every lot — so it listed one jar lot and
// announced the whole stock. The weight is now scoped identically (the maths
// is locked in cellarInsights.test.ts; the hero number animates from 0 via
// rAF, so asserting it in a synchronous render would be meaningless). What
// this locks is what the VIEW decides: which lots it lists, that it says so,
// and that the user can get the whole tobacco back.
describe("InventoryDetailView — lots scoped to the active filter", () => {
  const yearsAgoISO = (y: number) =>
    new Date(Date.now() - Math.round(y * 365.25 * 86400000)).toISOString().slice(0, 10);
  // Distinctive weights so each lot is identifiable in the rendered list.
  const JAR = "47", YOUNG = "113", OLD = "229";
  const mixed = {
    ...tobacco,
    agingMax: "10",
    lots: [
      { id: 1, status: "jar", weightG: JAR, boxNumber: "1", dateOpened: "2026-01-01", datePurchased: yearsAgoISO(0.1) },
      { id: 2, status: "cellar", weightG: YOUNG, boxNumber: "2", datePurchased: yearsAgoISO(0.5) },
      { id: 3, status: "cellar", weightG: OLD, boxNumber: "3", datePurchased: yearsAgoISO(20) },
    ],
  };
  // A known age format, so the assertions below test the SCOPE and not the
  // rendering of ageLabel.
  const ctx = (statusFilter: string) =>
    ({ view: "inv", detail: mixed, statusFilter, ageLabel: (d: number) => `${d}j` });

  it("unfiltered: lists every lot, and shows no filter chip", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, ctx("all"));
    for (const w of [JAR, YOUNG, OLD]) expect(container.textContent).toContain(w);
    expect(container.textContent).not.toContain("lbl_filtered_on");
  });

  // Reported from the app: the hero label was hardcoded to
  // "En cave", so it announced EN CAVE over a total that includes the jars —
  // and over a jar-only weight when the list was filtered to "En pot".
  it("the hero label follows the scope, and is 'En stock' unfiltered", () => {
    const un = renderWithCtx(<CuratorInventoryDetailView />, ctx("all"));
    expect(un.container.textContent).toContain("lbl_in_stock");
    expect(un.container.textContent).not.toContain("f_cellar");
    un.unmount();

    const jar = renderWithCtx(<CuratorInventoryDetailView />, ctx("jar"));
    expect(jar.container.textContent).toContain("f_jars");
    expect(jar.container.textContent).not.toContain("f_cellar");
    jar.unmount();

    // "En cave" appears ONLY for the cellar slice.
    const cellar = renderWithCtx(<CuratorInventoryDetailView />, ctx("cellar"));
    expect(cellar.container.textContent).toContain("f_cellar");
  });

  it("'En pot': lists the jar lot alone and says it is filtered", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, ctx("jar"));
    expect(container.textContent).toContain(JAR);
    expect(container.textContent).not.toContain(YOUNG);
    expect(container.textContent).not.toContain(OLD);
    expect(container.textContent).toContain("lbl_filtered_on");
  });

  it("'En cave': lists the cellar lots only", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, ctx("cellar"));
    expect(container.textContent).toContain(YOUNG);
    expect(container.textContent).toContain(OLD);
    expect(container.textContent).not.toContain(JAR);
  });

  it("a maturity band filters the lot list too (earlier it did not)", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, ctx("overaged"));
    expect(container.textContent).toContain(OLD);
    expect(container.textContent).not.toContain(YOUNG);
    expect(container.textContent).not.toContain(JAR);
    expect(container.textContent).toContain("mat_old");
  });

  // The fiche must say NOTHING about lots outside the scope — not
  // the oldest-lot age (it came from every active lot, so a jar-filtered fiche
  // could report a CELLAR lot's age) and not the finished-lot tally.
  it("the oldest-lot age is taken from the in-scope lots only", () => {
    // The 20-year cellar lot (~7305 days) must not set the age of a
    // jar-filtered fiche, whose only lot was bought weeks ago.
    const OLD_DAYS = /7[23]\d\dj/;
    const jar = renderWithCtx(<CuratorInventoryDetailView />, ctx("jar"));
    expect(jar.container.textContent).toContain("lbl_oldest");
    expect(jar.container.textContent).not.toMatch(OLD_DAYS);
    jar.unmount();
    // Filtered to the cellar, that lot IS in scope.
    const cellar = renderWithCtx(<CuratorInventoryDetailView />, ctx("cellar"));
    expect(cellar.container.textContent).toMatch(OLD_DAYS);
    cellar.unmount();
    // Unfiltered, the oldest across everything.
    const all = renderWithCtx(<CuratorInventoryDetailView />, ctx("all"));
    expect(all.container.textContent).toMatch(OLD_DAYS);
  });

  it("no finished-lot tally while a scope is active", () => {
    const withFinished = {
      ...mixed,
      lots: [...mixed.lots, { id: 4, status: "finished", weightG: "0", boxNumber: "9" }],
    };
    const un = renderWithCtx(<CuratorInventoryDetailView />, { view: "inv", detail: withFinished, statusFilter: "all" });
    expect(un.container.textContent).toContain("btn_show_finished_count");
    un.unmount();
    const scoped = renderWithCtx(<CuratorInventoryDetailView />, { view: "inv", detail: withFinished, statusFilter: "jar" });
    expect(scoped.container.textContent).not.toContain("btn_show_finished_count");
  });

  // The fiche used a hand-written copy of the scope predicate, which
  // had to be kept in step with every new scope by hand — and silently wasn't:
  // "Achats récents" fell through to its maturity branch and matched nothing,
  // so the fiche would have listed ZERO lots. Both now share one predicate.
  it("'Achats récents' lists the recent lots, not an empty fiche", () => {
    const daysAgoISO = (d: number) =>
      new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const withRecent = {
      ...mixed,
      lots: [
        { id: 1, status: "cellar", weightG: "61", boxNumber: "1", datePurchased: daysAgoISO(5) },
        { id: 2, status: "cellar", weightG: "402", boxNumber: "2", datePurchased: daysAgoISO(500) },
      ],
    };
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv", detail: withRecent, statusFilter: "recent",
      ageLabel: (d: number) => `${d}j`,
    });
    expect(container.textContent).toContain("61");
    expect(container.textContent).not.toContain("402");
    expect(container.textContent).toContain("f_recent");
  });

  // Reported with a screenshot: the fiche's top banner announced
  // "1 lot trop vieux" while filtered to "En pot" — an alert about a CELLAR
  // lot, on a screen showing only jars. Aging is cellar-only by construction,
  // so under a jar scope the banner must be absent entirely.
  it("no aging banner about out-of-scope lots", () => {
    const withOld = {
      ...mixed,
      agingMax: "5",
      lots: [
        { id: 1, status: "jar", weightG: JAR, boxNumber: "1", dateOpened: "2026-01-01", datePurchased: yearsAgoISO(0.1) },
        { id: 3, status: "cellar", weightG: OLD, boxNumber: "3", datePurchased: yearsAgoISO(20) },
      ],
    };
    // The fiche reads lotAgingStatus from ctx — pass the real one.
    const base = { detail: withOld, view: "inv", ageLabel: (d: number) => `${d}j`, lotAgingStatus };

    // Unfiltered: the cellar lot IS over-aged, the banner belongs there.
    const all = renderWithCtx(<CuratorInventoryDetailView />, { ...base, statusFilter: "all" });
    expect(all.container.textContent).toContain("aging_too_old");
    all.unmount();

    // Filtered to the jars: no aging statement at all.
    const jar = renderWithCtx(<CuratorInventoryDetailView />, { ...base, statusFilter: "jar" });
    expect(jar.container.textContent).not.toContain("aging_too_old");
    expect(jar.container.textContent).not.toContain("aging_nearing_peak");
  });

  it("'Tout afficher' reveals the whole tobacco, in place", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, ctx("jar"));
    const all = Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => /btn_show_all_lots/.test(b.textContent || ""));
    expect(all, "the escape hatch must be offered").toBeTruthy();
    fireEvent.click(all!);
    for (const w of [JAR, YOUNG, OLD]) expect(container.textContent).toContain(w);
    // The chip goes away with it — and the GLOBAL filter was never touched, so
    // going back to the list keeps it.
    expect(container.textContent).not.toContain("lbl_filtered_on");
  });
});

// ── the finished-lot row is legible ──────────────────────────
// The row carried `opacity: lot.disposed ? 0.4 : 0.6` while being a fully
// active control (tabIndex, onClick, Enter/Space, cursor:pointer), so no WCAG
// 1.4.3 "inactive component" exemption would apply. The correction: it was
// never RENDERING — `...e` (useEnter) is spread last in the same object literal
// and always carries an opacity, so the later key won. This test is what
// disproved my "measured 2.56:1" claim, within a minute of being written.
// It therefore asserts the SETTLED opacity rather than the absence of the
// declaration: that is what fails if someone reintroduces the fade in the form
// that would actually render (after the spread), which is the live defect.
describe("InventoryDetailView — finished lots stay readable", () => {
  const finishedAndDisposed = {
    ...tobacco,
    lots: [
      { id: "F1", status: "finished", weightG: "0", datePurchased: "2024-01-01", dateFinished: "2024-06-01", boxNumber: "1", disposed: false },
      { id: "F2", status: "finished", weightG: "0", datePurchased: "2024-01-01", dateFinished: "2024-06-02", boxNumber: "2", disposed: true },
    ],
  };
  const ctx51 = {
    view: "inv",
    detail: finishedAndDisposed,
    data: { tobaccos: [finishedAndDisposed], sessions: [], pipes: [], accessories: [], wishlist: [] },
    statusFilter: "finished",
    ageLabel: (d: number) => `${d}j`,
  };
  // Selected on `data-lot-row`, not on text: the previous selector matched
  // "Nº " inside the aria-label, i.e. a hardcoded French literal in production
  // code. Translating that literal emptied the selection and the
  // test failed with "expected 0 to be 2" — a failure about the selector, not
  // about opacity. A test may not depend on a string staying untranslated.
  const lotRows = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("[data-lot-row]")) as HTMLElement[];

  it("both rows settle at full opacity — neither the consumed nor the disposed one fades", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWithCtx(<CuratorInventoryDetailView />, ctx51);
      const rows = lotRows(container);
      expect(rows.length, "both finished lots must render").toBe(2);
      // Let every staggered useEnter delay elapse (500 + idx*80).
      act(() => { vi.advanceTimersByTime(2000); });
      for (const row of lotRows(container)) {
        expect(row.style.opacity, `row ${row.getAttribute("aria-label")} is dimmed`).toBe("1");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("the finished state is still signalled — by a tag, not by fading", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, ctx51);
    // The cue the opacity was duplicating: an explicit status label per row,
    // plus a dedicated pill on the disposed one. Removing the fade cost nothing.
    expect(container.textContent).toContain("lot_finished");
    expect(container.textContent).toContain("lot_disposed");
  });
});

// ── the lot fiche lists the sessions charged against it ──────
// The lot said how much was LEFT and never what became of the rest, and the
// journal could be filtered by tobacco but never by LOT — so "where did those
// grams go" had no answer on the screen that raises the question.

describe("InventoryDetailView — sessions on the lot detail modal", () => {
  const lot = {
    id: "L1", status: "jar", weightG: "30", weightInitial: "50",
    originalStatus: "jar", datePurchased: "2024-01-10", dateProduction: "",
    dateOpened: "2024-02-01", dateFinished: "", boxNumber: "B1",
    price: "", seller: "", disposed: false,
  };
  const tob = { ...tobacco, lots: [lot] };
  const sessions = [
    { id: 1, lotId: "L1", tobaccoId: tob.id, date: "2024-03-02", time: "21:00", weightG: "2.5" },
    { id: 2, lotId: "L1", tobaccoId: tob.id, date: "2024-04-11", time: "", weightG: "3" },
    // Another lot's session must NOT leak into this list.
    { id: 3, lotId: "L2", tobaccoId: tob.id, date: "2024-05-01", time: "", weightG: "9.75" },
  ];

  const openModal = (extra: any = {}) => {
    const r = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv", detail: tob, statusFilter: "all",
      data: { tobaccos: [tob], pipes: [], accessories: [], sessions, wishlist: [] },
      ...extra,
    });
    const numSpan = Array.from(r.container.querySelectorAll("span"))
      .find((s) => (s.textContent || "").trim() === "Nº B1");
    fireEvent.click(numSpan!);
    return r;
  };

  // The rows are selected by their accessible NAME, not by their text: the
  // An earlier release lesson is that a text selector silently retargets when a label
  // moves, and `aria_session_card` is the stable contract for this row.
  const sessionRows = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('[aria-label="aria_session_card"]')) as HTMLElement[];

  it("lists this lot's sessions, most recent first, and no other lot's", () => {
    const { container } = openModal();
    const rows = sessionRows(container);
    expect(rows.length).toBe(2);
    // Newest first: the untimed 11.04 before the timed 02.03. Asserted in the
    // RENDERED form — the row goes through fmtDate, so an ISO expectation
    // would fail on correct output (and pass only if the date stopped being
    // formatted at all).
    expect(rows[0]!.textContent).toContain("11.04.2024");
    expect(rows[1]!.textContent).toContain("02.03.2024");
    expect(rows[1]!.textContent).toContain("21:00");
    // The 9.75 g belongs to lot L2 and must not appear anywhere in the modal.
    expect(container.textContent).not.toContain("9.75");
  });

  it("shows the grams smoked on each row", () => {
    const { container } = openModal();
    const rows = sessionRows(container);
    // fmtLotWeight — the app's ONE weight rendering — so the
    // decimal separator is the locale's: "2,5g" under the fr default, not
    // "2.5". Asserting the raw value would be asserting that the weight is
    // NOT formatted like every other weight in the app.
    expect(rows[0]!.textContent).toContain("3g");
    expect(rows[1]!.textContent).toMatch(/2[.,]5g/);
  });

  it("opens the session through crossOpenSession, which records the origin", () => {
    // Not a bare nav(): the helper pushes the CURRENT screen as a drill origin
    // so system-back returns to this fiche (and re-opens this very lot, whose
    // state is deliberately left armed). A plain nav would strand the user on
    // the journal.
    const crossOpenSession = vi.fn();
    const { container } = openModal({ crossOpenSession });
    fireEvent.click(sessionRows(container)[0]!);
    expect(crossOpenSession).toHaveBeenCalledTimes(1);
    expect(crossOpenSession.mock.calls[0]![0].id).toBe(2);
  });

  it("says so when the lot has no session, instead of showing an empty block", () => {
    const { container } = renderWithCtx(<CuratorInventoryDetailView />, {
      view: "inv", detail: tob, statusFilter: "all",
      data: { tobaccos: [tob], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const numSpan = Array.from(container.querySelectorAll("span"))
      .find((s) => (s.textContent || "").trim() === "Nº B1");
    fireEvent.click(numSpan!);
    expect(container.textContent).toContain("lot_sessions_none");
    expect(sessionRows(container).length).toBe(0);
  });

  it("lets the Close/Delete/Edit row WRAP rather than clip a label", () => {
    // A PRE-EXISTING clip, found by rendering this modal while adding the list
    // above it and measured identical at HEAD, so it is not from that change:
    // in German the three labels needed 349 px in a 340 px box at the DEFAULT
    // text size (375 at "L"), and the third button read « BEARBE », cut at the
    // panel edge. They are single words, so a flex item at its default
    // `min-width: auto` could only clip. Verified in a browser after the fix:
    // one line in fr / en / pt, two only in German, and no overflow anywhere.
    //
    // Neither `i18n:layout` nor `theme:contrast` could see it — the screen IS
    // in their list (`modal-lot`), but the checkers fail on a page-level
    // scrollWidth, on `nowrap`/ellipsis text, or on a draggable scroller, and
    // this is none of the three: content simply painted past a hidden-overflow
    // panel. The gap is recorded in CLAUDE.md; do not remove this wrap.
    const { container } = openModal();
    const closeBtn = Array.from(container.querySelectorAll("[aria-label], div"))
      .find((e) => (e.textContent || "").trim() === "btn_close") as HTMLElement | undefined;
    expect(closeBtn, "the Close action must be findable").toBeTruthy();
    const row = closeBtn!.parentElement as HTMLElement;
    expect(row.style.display).toBe("flex");
    expect(row.style.flexWrap).toBe("wrap");
    expect(row.children.length).toBe(3);
  });

  it("caps the modal height and contains its scroll", () => {
    // The list is unbounded — a 100 g tin can carry forty bowls — so this
    // modal can now exceed the screen. `capHeight` + an inner
    // `overflow-y:auto; overscroll-behavior:contain` region is the required
    // shape; a `vh` cap cannot know the backdrop's padding and safe areas,
    // and an uncontained port chains the swipe to the page behind.
    const { container } = openModal();
    const dialogs = Array.from(container.querySelectorAll('[role="dialog"]')) as HTMLElement[];
    const panel = dialogs[dialogs.length - 1]!;
    expect(panel.style.maxHeight).toBe("100%");
    expect(panel.style.flexDirection).toBe("column");
    const body = Array.from(panel.querySelectorAll("div"))
      .find((d) => (d as HTMLElement).style.overflowY === "auto") as HTMLElement | undefined;
    expect(body, "the modal body must be the scroll port").toBeTruthy();
    expect(body!.style.overscrollBehavior).toBe("contain");
    expect(body!.style.minHeight).toBe("0px");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Où revient un lot réactivé — et les deux portes qui le suppriment.
//
// LE RETOUR. Le commentaire au-dessus du bouton « Réactiver » énonce le dégât
// mot pour mot : `originalStatus` vaut « cellar » pour à peu près tout lot que
// l'app crée, donc un pot ouvert en 2023 et fumé sur cent grammes revenait
// SCELLÉ — et la branche cave d'`applyLifecycleDates` EFFACE `dateOpened`, le
// seul témoin de sa date d'ouverture. La règle est donc `wasSmoked ||
// originalStatus === "jar"` → jar. Sondée, elle passait au vert dans les deux
// sens : le seul cas existant nourrit `sessions: []`, donc il exerce la moitié
// « cellar » et jamais celle qui répare quelque chose. Un fixture qui ne peut
// produire qu'une des deux réponses ne teste ni l'une ni l'autre.
//
// LES DEUX PORTES. Le lot se supprime depuis la modale d'ÉDITION et depuis la
// modale de DÉTAIL, chacune appelant `removeLot(tob.id, lotId)`, et aucune des
// deux n'était assertée — alors qu'un id de lot n'est PAS unique globalement
// (c'est écrit sur `useTrashOps` : c'est la paire `tobaccoId|lotId` qui est une
// identité). Une suppression qui vise le mauvais couple porte sur un autre lot
// que celui affiché.
describe("réactivation et suppression d'un lot", () => {
  const finishedLot = {
    id: "L1", status: "finished", weightG: "25",
    dateProduction: "", datePurchased: "", dateOpened: "2024-01-01",
    dateFinished: "2024-06-01", boxNumber: "", price: "", seller: "", disposed: false,
  };
  const tobFin = { ...tobacco, lots: [finishedLot] };

  function renderFiche(over: Record<string, any> = {}) {
    const ctx: Record<string, any> = {
      view: "inv",
      detail: tobFin,
      statusFilter: "finished",
      data: { tobaccos: [tobFin], sessions: [], pipes: [], accessories: [], wishlist: [] },
      changeLotStatus: vi.fn(),
      removeLot: vi.fn(),
      ...over,
    };
    return { ctx, ...renderWithCtx(<CuratorInventoryDetailView />, ctx) };
  }

  function reactivate(container: HTMLElement) {
    const btn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_reactivate/i.test(b.textContent || ""));
    expect(btn, "le bouton Réactiver doit être rendu sur un lot fini").toBeTruthy();
    fireEvent.click(btn!);
  }

  it("un lot qui a HÉBERGÉ des séances revient EN POT, pas en cave", () => {
    // On ne peut pas fumer d'une boîte scellée : une séance prouve
    // l'ouverture, quoi que dise `originalStatus`.
    const { ctx, container } = renderFiche({
      data: {
        tobaccos: [tobFin],
        sessions: [{ id: 1, tobaccoId: "1", pipeId: 1, lotId: "L1", date: "2024-03-02", duration: "30", weightG: "2.5" }],
        pipes: [], accessories: [], wishlist: [],
      },
    });
    reactivate(container as HTMLElement);
    expect(ctx.changeLotStatus).toHaveBeenCalledWith("1", "L1", "jar");
  });

  it("un lot NÉ en pot y revient, même sans séance", () => {
    const born = { ...tobFin, lots: [{ ...finishedLot, originalStatus: "jar" }] };
    const { ctx, container } = renderFiche({
      detail: born,
      data: { tobaccos: [born], sessions: [], pipes: [], accessories: [], wishlist: [] },
    });
    reactivate(container as HTMLElement);
    expect(ctx.changeLotStatus).toHaveBeenCalledWith("1", "L1", "jar");
  });

  it("un lot JAMAIS fumé et né en cave y revient — la moitié qui doit rester", () => {
    // Contre-cas : sans lui, répondre « jar » systématiquement passerait les
    // deux cas ci-dessus, et le bouton cesserait de distinguer quoi que ce
    // soit. C'est aussi le cas d'origine de ce fichier, conservé ici en regard
    // de ses jumeaux pour que les trois réponses se lisent ensemble.
    const { ctx, container } = renderFiche();
    reactivate(container as HTMLElement);
    expect(ctx.changeLotStatus).toHaveBeenCalledWith("1", "L1", "cellar");
  });

  // Les deux portes de suppression du lot. `data-lot-row` est le point
  // d'accroche que la ligne expose exprès, et l'activation est au CLAVIER :
  // `PressCard` installe un écouteur de capture à usage unique qui avale le
  // clic programmatique suivant, donc un `click()` ne prouverait rien.
  function openLotDetail(container: HTMLElement) {
    const row = container.querySelector('[data-lot-row="L1"]') as HTMLElement | null;
    expect(row, "la ligne du lot doit être rendue et porter son point d'accroche").toBeTruthy();
    row!.focus();
    fireEvent.keyDown(row!, { key: "Enter" });
  }

  // SCOPÉ À LA MODALE, et c'est le piège : la barre du haut de la fiche porte
  // elle aussi un `btn_delete` (celui du TABAC), donc une recherche globale
  // prend le premier et un cas qui croit éprouver la suppression d'un LOT
  // éprouve la suppression du tabac — vert pour la mauvaise raison.
  // On ne cherche QUE dans les modales, et c'est le piège : la barre du haut
  // de la fiche porte elle aussi un `btn_delete` (celui du TABAC), donc une
  // recherche globale prend le premier et un cas qui croit éprouver la
  // suppression d'un LOT éprouve la suppression du tabac — vert pour la
  // mauvaise raison. Les deux modales nomment leur bouton différemment
  // (`btn_delete` pour la lecture, `aria_delete_lot` pour l'édition), ce qui
  // est une raison de plus de ne pas se fier au premier venu.
  function tapDelete(container: HTMLElement) {
    const dialogs = Array.from(container.querySelectorAll('[role="dialog"]'));
    expect(dialogs.length, "une modale doit être ouverte").toBeGreaterThan(0);
    const del = dialogs
      .flatMap(d => Array.from(d.querySelectorAll("button, [role=button]")))
      .find(b => /btn_delete|aria_delete_lot/i.test(
        b.getAttribute("aria-label") || b.textContent || ""));
    expect(del, "la modale doit offrir une suppression nommée").toBeTruthy();
    fireEvent.click(del as Element);
  }

  it("la modale de DÉTAIL supprime le couple tabac|lot affiché", () => {
    // Un id de lot n'est PAS unique globalement — c'est la paire
    // `tobaccoId|lotId` qui est une identité (voir useTrashOps) — donc viser
    // le mauvais couple porte sur un autre lot que celui à l'écran.
    const { ctx, container } = renderFiche();
    openLotDetail(container as HTMLElement);
    tapDelete(container as HTMLElement);
    expect(ctx.removeLot).toHaveBeenCalledTimes(1);
    expect(ctx.removeLot).toHaveBeenCalledWith("1", "L1");
  });

  it("la modale d'ÉDITION supprime le même couple — la seconde porte", () => {
    const { ctx, container } = renderFiche();
    openLotDetail(container as HTMLElement);
    const edit = Array.from(container.querySelectorAll('[role="dialog"] button, [role="dialog"] [role=button]'))
      .find(b => /btn_edit/i.test(b.getAttribute("aria-label") || b.textContent || ""));
    expect(edit, "la modale de détail doit mener à l'édition").toBeTruthy();
    fireEvent.click(edit as Element);
    tapDelete(container as HTMLElement);
    expect(ctx.removeLot).toHaveBeenCalledTimes(1);
    expect(ctx.removeLot).toHaveBeenCalledWith("1", "L1");
  });
});
