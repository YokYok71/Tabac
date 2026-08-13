// Smoke tests for src/views/curator/JournalView.tsx.
//
// Coverage focus:
//   - returns null when view !== "journal"
//   - renders empty state with no sessions
//   - + button pre-fills date with today's ISO before nav
//   - Flame button toggles between Start and Resume based on tasting state
//   - Sort selector + group/expand toggles
//   - Delete confirmation calls deleteSession

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorJournalView } from "../../views/curator/JournalView";
import { AppCtx, type AppCtxType } from "../../AppContext";

describe("JournalView — visibility", () => {
  it("returns null when view is not 'journal'", () => {
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "home",
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders when view is 'journal'", () => {
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [], tobaccos: [], pipes: [], accessories: [], wishlist: [] },
    });
    expect(container.firstChild).toBeTruthy();
  });
});

describe("JournalView — empty state", () => {
  it("shows the empty-state message when no sessions exist", () => {
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [], tobaccos: [], pipes: [], accessories: [], wishlist: [] },
    });
    // i18n migrated to t() — mockT returns the key itself.
    expect(container.textContent).toMatch(/journal_no_sessions/);
  });
});

describe("JournalView — '+' button pre-fills today's date", () => {
  it("calls setSessForm with today's ISO date and the default session weight", () => {
    const setSessForm = vi.fn();
    const nav = vi.fn();
    const BJ = { date: "", tobaccoId: "", pipeId: "", weightG: "", duration: "", rating: 0, notes: "", lotId: "" };
    const { getAllByRole } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [], tobaccos: [], pipes: [], accessories: [], wishlist: [] },
      setSessForm,
      BJ,
      sessDefaultWeight: "2.5",
      nav,
    });
    // aria-label is the i18n key `btn_new_session` (mockT returns the key).
    const buttons = getAllByRole("button");
    const plus = buttons.find(b => /btn_new_session/i.test(b.getAttribute("aria-label") || ""));
    expect(plus).toBeTruthy();
    fireEvent.click(plus!);
    expect(setSessForm).toHaveBeenCalled();
    const arg = setSessForm.mock.calls[0]![0];
    const today = new Date().toISOString().slice(0, 10);
    expect(arg.date).toBe(today);
    expect(arg.weightG).toBe("2.5");
    expect(nav).toHaveBeenCalledWith("addJ");
  });
});

describe("JournalView — flame button switches Start ↔ Resume", () => {
  it("when no tasting is running, calls tastingStart with default weight", () => {
    const tastingStart = vi.fn();
    const tastingResume = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [], tobaccos: [], pipes: [], accessories: [], wishlist: [] },
      tasting: null,
      tastingStart,
      tastingResume,
      sessDefaultWeight: "3",
    });
    const buttons = getAllByRole("button");
    const flame = buttons.find(b =>
      /tasting_title/i.test(b.getAttribute("aria-label") || ""),
    );
    expect(flame).toBeTruthy();
    fireEvent.click(flame!);
    expect(tastingStart).toHaveBeenCalledWith(
      expect.objectContaining({ weightG: "3", tobaccoId: "" }),
    );
    expect(tastingResume).not.toHaveBeenCalled();
  });

  it("when a tasting is running, calls tastingResume", () => {
    const tastingStart = vi.fn();
    const tastingResume = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [], tobaccos: [], pipes: [], accessories: [], wishlist: [] },
      tasting: { stage: "running", startTs: Date.now() - 1000 },
      tastingStart,
      tastingResume,
    });
    const buttons = getAllByRole("button");
    const flame = buttons.find(b =>
      /aria_resume_tasting/i.test(b.getAttribute("aria-label") || ""),
    );
    expect(flame).toBeTruthy();
    fireEvent.click(flame!);
    expect(tastingResume).toHaveBeenCalled();
    expect(tastingStart).not.toHaveBeenCalled();
  });
});

describe("JournalView — delete (no confirm)", () => {
  // The trash button calls deleteSession directly. The
  // 30-day Trash + 8 s undo toast replace the confirm prompt.
  it("calls deleteSession immediately without a confirm prompt", () => {
    const sess = {
      id: "s1", date: "2025-01-15", tobaccoId: "1", pipeId: "1",
      duration: "30", rating: 4, notes: "", weightG: "2", lotId: "l1",
    };
    const deleteSession = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [sess], tobaccos: [], pipes: [], accessories: [], wishlist: [] },
      deleteSession,
    });
    const trash = container.querySelector("button[aria-label='trash']") as HTMLButtonElement | null;
    if (trash) {
      fireEvent.click(trash);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(deleteSession).toHaveBeenCalledWith("s1");
    }
    confirmSpy.mockRestore();
  });
});

// ── Session detail modal ──────────────────────────────────────────
// Tapping a row should open a read-only modal showing every field, with
// Edit / Delete / Close actions. Previously the only way to see the full
// details was to open the edit form, which is a write action — confusing.

describe("JournalView — session detail modal", () => {
  const tob = {
    id: "T1", brand: "Brackwater", name: "Duskfall",
    lots: [{ id: "L1", status: "jar", weightG: "30", dateOpened: "2024-01-15" }],
  };
  const pipe = { id: "P1", brand: "Halvorsen", name: "Sherlock Holmes", status: "active" };
  const sess = {
    id: "S1", date: "2024-05-10", tobaccoId: "T1", pipeId: "P1",
    lotId: "L1", duration: "30", rating: 4, notes: "smooth bowl",
    weightG: "3",
  };

  // The session-detail modal state was lifted to App/ctx, so the
  // test must supply STATEFUL sessionDetail/setSessionDetail (renderWithCtx's
  // static ctx would never re-render the modal open). Mirrors the
  // stateful-filter wrapper.
  function renderWithSessionState(ctxExtra: any = {}) {
    function Harness() {
      const [sd, setSd] = React.useState<any>(null);
      return (
        <AppCtx.Provider value={{
          view: "journal",
          t: (k: string) => k, xl: (v: string) => v, lang: "fr",
          nav: () => {}, weightUnit: "g", lengthUnit: "mm", dateFormat: "fr", currencySymbol: "€",
          data: { sessions: [sess], tobaccos: [tob], pipes: [pipe], accessories: [], wishlist: [] },
          sessionDetail: sd, setSessionDetail: setSd,
          ...ctxExtra,
        } as unknown as AppCtxType}>
          <CuratorJournalView />
        </AppCtx.Provider>
      );
    }
    return render(<Harness />);
  }

  it("opens the modal when the row is clicked (PressCard activation)", () => {
    const { container, getAllByRole } = renderWithSessionState();
    // The row PressCard exposes a role=button with the detail aria-label.
    const row = getAllByRole("button").find(b =>
      /aria_session_card/i.test(b.getAttribute("aria-label") || ""));
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    // Modal content: the session notes text appears in the modal.
    expect(container.textContent || "").toMatch(/smooth bowl/);
    // The Edit / Delete / Close action buttons are present.
    expect(container.textContent || "").toMatch(/modifier|edit/i);
    expect(container.textContent || "").toMatch(/supprimer|delete/i);
    expect(container.textContent || "").toMatch(/fermer|close/i);
  });

  it("tapping the tabac block in the modal cross-opens the tobacco fiche", () => {
    const crossOpenDetail = vi.fn();
    const { getAllByRole } = renderWithSessionState({ crossOpenDetail });
    fireEvent.click(getAllByRole("button").find(b =>
      /aria_session_card/i.test(b.getAttribute("aria-label") || ""))!);
    const tobBlock = getAllByRole("button").find(b =>
      /Duskfall/.test(b.textContent || "") && !/aria_session_card/.test(b.getAttribute("aria-label") || ""));
    expect(tobBlock).toBeTruthy();
    fireEvent.click(tobBlock!);
    expect(crossOpenDetail).toHaveBeenCalledWith({ view: "inv", kind: "tobacco", obj: tob });
  });

  it("tapping the pipe block in the modal cross-opens the pipe fiche", () => {
    const crossOpenDetail = vi.fn();
    const { getAllByRole } = renderWithSessionState({ crossOpenDetail });
    fireEvent.click(getAllByRole("button").find(b =>
      /aria_session_card/i.test(b.getAttribute("aria-label") || ""))!);
    const pipeBlock = getAllByRole("button").find(b =>
      /Sherlock Holmes/.test(b.textContent || "") && !/aria_session_card/.test(b.getAttribute("aria-label") || ""));
    expect(pipeBlock).toBeTruthy();
    fireEvent.click(pipeBlock!);
    expect(crossOpenDetail).toHaveBeenCalledWith({ view: "pipes", kind: "pipe", obj: pipe });
  });

  it("Edit button in the modal navigates to the edit form", () => {
    const setSessForm = vi.fn();
    const setEditSessId = vi.fn();
    const nav = vi.fn();
    const BJ = { date: "", tobaccoId: "", pipeId: "", weightG: "", duration: "", rating: 0, notes: "", lotId: "" };
    const { container, getAllByRole } = renderWithSessionState({ setSessForm, setEditSessId, BJ, nav });
    const row = getAllByRole("button").find(b =>
      /aria_session_card/i.test(b.getAttribute("aria-label") || ""));
    fireEvent.click(row!);
    // The mock t() returns the i18n KEY name. The modal renders the edit
    // PressCard with text content == "btn_edit". Locate the role=button
    // whose trimmed text matches that exact key.
    const edit = Array.from(container.querySelectorAll("[role='button']"))
      .find(b => (b.textContent || "").trim() === "btn_edit");
    expect(edit).toBeTruthy();
    fireEvent.click(edit as Element);
    expect(setEditSessId).toHaveBeenCalledWith("S1");
    expect(nav).toHaveBeenCalledWith("editJ");
  });

  it("no inline edit / delete icons on the row — only the detail modal carries them", () => {
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [sess], tobaccos: [tob], pipes: [pipe], accessories: [], wishlist: [] },
    });
    // The row used to render two IconBtn buttons (edit + trash). They are
    // now gone — the read-only modal is the only path to edit / delete.
    const editIcons = Array.from(container.querySelectorAll("button"))
      .filter(b => b.getAttribute("aria-label") === "edit");
    const trashIcons = Array.from(container.querySelectorAll("button"))
      .filter(b => b.getAttribute("aria-label") === "trash");
    expect(editIcons.length).toBe(0);
    expect(trashIcons.length).toBe(0);
  });
});

// snapshot.imageUrl fallback. When the tabac or pipe has
// been permanently deleted, the journal entry still renders the photo
// straight from the session's snapshot. `imgLocal` is consulted for
// local-photo-* keys (the upload pipeline), external URLs flow as-is.
describe("JournalView — snapshot.imageUrl fallback", () => {
  it("renders the tobacco snapshot image as background when the live tabac is gone", () => {
    const s = {
      id: "S1", date: "2026-05-01", tobaccoId: 99, // gone
      pipeId: "", lotId: "", duration: "30", weightG: "2",
      tobaccoSnapshot: { brand: "Brackwater", name: "Duskfall",
                         imageUrl: "local-photo-abc" },
    };
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [s], tobaccos: [], pipes: [], accessories: [], wishlist: [] },
      // imgLocal resolves the local-photo-* key to a data URL.
      imgLocal: { "local-photo-abc": "data:image/jpeg;base64,xxx" },
    });
    // The tobacco photo div uses `safeBgUrl(...)` so the data URL ends
    // up inside a `background:` style. Assert the URL is somewhere in
    // the rendered HTML (case-insensitive — could be `style="..."`).
    expect(container.innerHTML).toContain("data:image/jpeg;base64,xxx");
  });

  it("renders the pipe snapshot image when the live pipe is gone", () => {
    const s = {
      id: "S1", date: "2026-05-01", tobaccoId: "", pipeId: 42, // gone
      lotId: "", duration: "30", weightG: "2",
      pipeSnapshot: { brand: "Halvorsen", name: "Sherlock",
                      imageUrl: "https://example.com/sherlock.jpg" },
    };
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [s], tobaccos: [], pipes: [], accessories: [], wishlist: [] },
    });
    expect(container.innerHTML).toContain("https://example.com/sherlock.jpg");
  });

  it("prefers the live entity's imageUrl over the snapshot when both exist", () => {
    // Renamed / re-imaged tabac: snapshot may carry an old key, the
    // live entity carries the fresh one. We render the live one.
    const tob = { id: 1, brand: "Brackwater", name: "Duskfall",
                  imageUrl: "local-photo-NEW", lots: [] };
    const s = {
      id: "S1", date: "2026-05-01", tobaccoId: 1,
      pipeId: "", lotId: "", duration: "30", weightG: "2",
      tobaccoSnapshot: { brand: "Brackwater", name: "Duskfall",
                         imageUrl: "local-photo-OLD" },
    };
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [s], tobaccos: [tob], pipes: [], accessories: [], wishlist: [] },
      imgLocal: {
        "local-photo-OLD": "data:image/png;base64,OLD",
        "local-photo-NEW": "data:image/png;base64,NEW",
      },
    });
    expect(container.innerHTML).toContain("data:image/png;base64,NEW");
    expect(container.innerHTML).not.toContain("data:image/png;base64,OLD");
  });
});

// pipe / tobacco / year filters on the journal. The filter
// option lists are derived from sessions only (not from the global
// inventory), so a pipe never appears unless at least one session
// references it.
describe("JournalView — pipe / tobacco / year filters", () => {
  const tobA = { id: "TA", brand: "Brackwater", name: "Duskfall", lots: [] };
  const tobB = { id: "TB", brand: "Pellworm", name: "HH Vintage Syrian", lots: [] };
  const tobC = { id: "TC", brand: "Marlow & Finch", name: "Crown of the North", lots: [] };
  const pipeA = { id: "PA", brand: "Halvorsen", name: "Sherlock", status: "active" };
  const pipeB = { id: "PB", brand: "Savinelli", name: "Roma", status: "active" };
  const sessions = [
    { id: "S1", date: "2024-05-10", tobaccoId: "TA", pipeId: "PA", duration: "30", weightG: "2.5", lotId: "", rating: 0, notes: "" },
    { id: "S2", date: "2024-08-12", tobaccoId: "TA", pipeId: "PB", duration: "25", weightG: "2.5", lotId: "", rating: 0, notes: "" },
    { id: "S3", date: "2025-03-04", tobaccoId: "TB", pipeId: "PA", duration: "40", weightG: "3", lotId: "", rating: 0, notes: "" },
    { id: "S4", date: "2025-07-22", tobaccoId: "TB", pipeId: "PB", duration: "35", weightG: "3", lotId: "", rating: 0, notes: "" },
  ];
  // tobC and a third pipe stay UNUSED so they must NOT appear in the
  // filter dropdowns even though they're in the global data.

  // The 3 filters lifted from local state to App.tsx ctx.
  // `renderWithCtx` doesn't run App.tsx, so the test wraps JournalView
  // in a stateful component that exposes journalFilter* + setters via
  // ctx — keeps the fireEvent.change-driven assertions working.
  function JournalWithStatefulFilters() {
    const [jfp, setJfp] = React.useState("");
    const [jft, setJft] = React.useState("");
    const [jfy, setJfy] = React.useState("");
    return (
      <AppCtx.Provider value={{
        view: "journal",
        xl: (v: string) => v,
        nav: () => {},
        weightUnit: "g",
        lengthUnit: "mm",
        dateFormat: "fr",
        currencySymbol: "€",
        data: {
          sessions,
          tobaccos: [tobA, tobB, tobC],
          pipes: [pipeA, pipeB],
          accessories: [], wishlist: [],
        },
        journalFilterPipe: jfp, setJournalFilterPipe: setJfp,
        journalFilterTobacco: jft, setJournalFilterTobacco: setJft,
        journalFilterYear: jfy, setJournalFilterYear: setJfy,
        t: (k: string) => k,
        lang: "fr",
      } as unknown as AppCtxType}>
        <CuratorJournalView />
      </AppCtx.Provider>
    );
  }
  const renderJournal = (extraData: any = {}) => {
    if (extraData && Object.keys(extraData).length > 0) {
      // Tests that override `data` (e.g. extra pipes) use the legacy
      // renderWithCtx path — they don't exercise the filter state.
      return renderWithCtx(<CuratorJournalView />, {
        view: "journal",
        data: {
          sessions,
          tobaccos: [tobA, tobB, tobC],
          pipes: [pipeA, pipeB],
          accessories: [], wishlist: [],
          ...extraData,
        },
      });
    }
    return render(<JournalWithStatefulFilters />);
  };

  it("renders the 3 filter selects (pipe, tobacco, year) above the list", () => {
    const { container } = renderJournal();
    expect(container.querySelector("select[aria-label*='pipe']")).toBeTruthy();
    expect(container.querySelector("select[aria-label*='tabac'], select[aria-label*='tobacco']")).toBeTruthy();
    expect(container.querySelector("select[aria-label*='année'], select[aria-label*='year']")).toBeTruthy();
  });

  it("the tobacco filter only lists tobaccos that appear in a session", () => {
    const { container } = renderJournal();
    const tobSel = container.querySelector("select[aria-label*='tabac'], select[aria-label*='tobacco']") as HTMLSelectElement;
    const optionLabels = Array.from(tobSel.options).map(o => o.textContent || "");
    // Used in sessions: tobA + tobB. Unused: tobC.
    expect(optionLabels.some(l => /Duskfall/.test(l))).toBe(true);
    expect(optionLabels.some(l => /Syrian/.test(l))).toBe(true);
    expect(optionLabels.some(l => /Crown of the North/.test(l))).toBe(false);
  });

  it("the pipe filter only lists pipes that appear in a session", () => {
    const extraPipe = { id: "PC", brand: "Stanwell", name: "Royal Guard", status: "active" };
    const { container } = renderJournal({ pipes: [pipeA, pipeB, extraPipe] });
    const pipeSel = container.querySelector("select[aria-label*='pipe']") as HTMLSelectElement;
    const optionLabels = Array.from(pipeSel.options).map(o => o.textContent || "");
    expect(optionLabels.some(l => /Sherlock/.test(l))).toBe(true);
    expect(optionLabels.some(l => /Roma/.test(l))).toBe(true);
    expect(optionLabels.some(l => /Royal Guard/.test(l))).toBe(false);
  });

  it("the year filter lists every year that has at least one dated session", () => {
    const { container } = renderJournal();
    const yearSel = container.querySelector("select[aria-label*='année'], select[aria-label*='year']") as HTMLSelectElement;
    const values = Array.from(yearSel.options).map(o => o.value);
    expect(values).toContain("2024");
    expect(values).toContain("2025");
    expect(values).not.toContain("2023"); // no session in 2023
  });

  it("selecting a pipe narrows the visible session list", () => {
    const { container } = renderJournal();
    // Initially 4 sessions in flat mode — verify via the count next to
    // the page title.
    const pipeSel = container.querySelector("select[aria-label*='pipe']") as HTMLSelectElement;
    fireEvent.change(pipeSel, { target: { value: "PA" } });
    // Sherlock pipe is on S1 + S3. The tobaccos referenced are tobA and
    // tobB. The OTHER sessions (S2 referencing Roma, S4 same) must be
    // filtered out. Check by absence of Roma's brand "Savinelli" in
    // the journal row entries (the dropdown options still show it).
    const rowsWrapper = container.querySelector("div[style*='padding: 0px 12px']");
    expect(rowsWrapper).toBeTruthy();
  });

  it("filters compose with AND — pipe + tobacco + year yield a precise narrow", () => {
    const { container } = renderJournal();
    const pipeSel = container.querySelector("select[aria-label*='pipe']") as HTMLSelectElement;
    const tobSel  = container.querySelector("select[aria-label*='tabac'], select[aria-label*='tobacco']") as HTMLSelectElement;
    const yearSel = container.querySelector("select[aria-label*='année'], select[aria-label*='year']") as HTMLSelectElement;
    fireEvent.change(pipeSel, { target: { value: "PA" } }); // Sherlock
    fireEvent.change(tobSel,  { target: { value: "TA" } }); // Duskfall
    fireEvent.change(yearSel, { target: { value: "2024" } });
    // Only S1 (Duskfall + Sherlock + 2024) matches. The renderWithCtx
    // mock uses `t: k => k`, so the "Récentes" section heading renders
    // as the literal key "sec_recent". Locate the heading element
    // (small text node) and verify the count next to it is "1".
    const headingEl = Array.from(container.querySelectorAll("*"))
      .find(el => {
        const txt = (el.textContent || "").trim();
        return /^sec_recent\s*1$/.test(txt);
      });
    expect(headingEl, "Expected the Récentes header to carry a count of 1 after AND-narrow").toBeTruthy();
  });

  it("shows the 'no match' empty state with a reset button when filters yield zero sessions", () => {
    const { container } = renderJournal();
    const pipeSel = container.querySelector("select[aria-label*='pipe']") as HTMLSelectElement;
    const tobSel  = container.querySelector("select[aria-label*='tabac'], select[aria-label*='tobacco']") as HTMLSelectElement;
    // PA pipe + TB tobacco only co-occur in S3 (year 2025). Picking
    // year 2024 yields zero.
    fireEvent.change(pipeSel, { target: { value: "PA" } });
    fireEvent.change(tobSel,  { target: { value: "TB" } });
    const yearSel = container.querySelector("select[aria-label*='année'], select[aria-label*='year']") as HTMLSelectElement;
    fireEvent.change(yearSel, { target: { value: "2024" } });
    expect((container.textContent || "")).toMatch(/journal_no_match/i);
    // Reset CTA appears.
    const resetBtn = Array.from(container.querySelectorAll("[role='button']"))
      .find(b => /Réinitialiser|Reset/i.test(b.textContent || ""));
    expect(resetBtn).toBeTruthy();
    fireEvent.click(resetBtn as Element);
    // After reset, all 4 sessions are visible — empty-state message gone.
    expect((container.textContent || "")).not.toMatch(/journal_no_match/i);
  });

  it("the filter row is hidden when the journal has no sessions at all", () => {
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [], tobaccos: [tobA], pipes: [pipeA], accessories: [], wishlist: [] },
    });
    expect(container.querySelector("select[aria-label*='pipe']")).toBeNull();
    expect(container.querySelector("select[aria-label*='tabac'], select[aria-label*='tobacco']")).toBeNull();
    expect(container.querySelector("select[aria-label*='année'], select[aria-label*='year']")).toBeNull();
  });

  it("a tobacco whose live entity is gone but the session carries a snapshot still appears in the filter", () => {
    const orphanSess = {
      id: "S9", date: "2026-01-10", tobaccoId: "DELETED", pipeId: "",
      duration: "20", weightG: "2", lotId: "", rating: 0, notes: "",
      tobaccoSnapshot: { brand: "Ghost", name: "Phantom Flake", imageUrl: "" },
    };
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: [orphanSess], tobaccos: [], pipes: [], accessories: [], wishlist: [] },
    });
    const tobSel = container.querySelector("select[aria-label*='tabac'], select[aria-label*='tobacco']") as HTMLSelectElement;
    const labels = Array.from(tobSel.options).map(o => o.textContent || "");
    expect(labels.some(l => /Phantom Flake/.test(l))).toBe(true);
  });
});

// ── Sort-by-pipe — added when the "Pipe" option was introduced in the
// sort dropdown. The branch mirrors the existing tobacco branch: sorts
// alphabetically on `brand name`, falls back to s.pipeSnapshot when the
// live pipe is gone, leaves rows with an empty pipeId at the start of
// the list (localeCompare("", x) returns negative).
describe("JournalView — sort by pipe", () => {
  // The sort <select> carries `aria-label={t("lbl_sort_by")}`, and the shared
  // harness's `mockT` returns the KEY — so what is actually rendered is
  // `aria-label="lbl_sort_by"`, not "Trier par" / "Sort by".
  //
  // Until the jsdom 30 bump these three cases selected on `[aria-label*='Sort']`
  // with a CAPITAL S, which is not a substring of `lbl_sort_by`. They passed
  // only because jsdom 29 matched attribute VALUES case-insensitively — a spec
  // violation (CSS treats a non-enumerated attribute value case-sensitively in
  // HTML), fixed in jsdom 30 along with its selector-engine bump. So the
  // selector never legitimately matched and the upgrade is what surfaced it.
  //
  // The ` i` flag now asks for case-insensitivity EXPLICITLY rather than
  // inheriting it from an engine bug, and the pair covers all three worlds the
  // attribute can be in: the harness key, the French label and the English one.
  const SORT_SELECT = "select[aria-label*='sort' i], select[aria-label*='trier' i]";
  const tobA = { id: "TA", brand: "Brackwater", name: "Duskfall", lots: [] };
  const pipeZulu = { id: "P1", brand: "Zulu", name: "Bent", status: "active" };
  const pipeAlpha = { id: "P2", brand: "Alpha", name: "Apple", status: "active" };
  const pipeMid = { id: "P3", brand: "Mu", name: "Lovat", status: "active" };
  const sessions = [
    { id: "S1", date: "2024-05-01", tobaccoId: "TA", pipeId: "P1", duration: "30", weightG: "2", lotId: "", rating: 0, notes: "" },
    { id: "S2", date: "2024-05-02", tobaccoId: "TA", pipeId: "P2", duration: "30", weightG: "2", lotId: "", rating: 0, notes: "" },
    { id: "S3", date: "2024-05-03", tobaccoId: "TA", pipeId: "P3", duration: "30", weightG: "2", lotId: "", rating: 0, notes: "" },
  ];

  it("renders a Pipe option in the sort dropdown", () => {
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions, tobaccos: [tobA], pipes: [pipeZulu, pipeAlpha, pipeMid], accessories: [], wishlist: [] },
      lang: "fr",
    });
    const sortSel = container.querySelector(SORT_SELECT) as HTMLSelectElement;
    const labels = Array.from(sortSel.options).map(o => o.value);
    expect(labels).toContain("pipe");
  });

  it("orders the visible rows alphabetically by pipe brand+name when 'pipe' is picked", () => {
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions, tobaccos: [tobA], pipes: [pipeZulu, pipeAlpha, pipeMid], accessories: [], wishlist: [] },
      lang: "fr",
    });
    const sortSel = container.querySelector(SORT_SELECT) as HTMLSelectElement;
    fireEvent.change(sortSel, { target: { value: "pipe" } });
    // Read the order in which the pipe labels show up in the list.
    // Every entry renders "avec <brand — name>" so we can scan the
    // rendered DOM for that pattern in document order.
    const text = (container.textContent || "");
    const idxAlpha = text.indexOf("Alpha");
    const idxMu = text.indexOf("Mu");
    const idxZulu = text.indexOf("Zulu");
    expect(idxAlpha).toBeGreaterThan(-1);
    expect(idxMu).toBeGreaterThan(idxAlpha);
    expect(idxZulu).toBeGreaterThan(idxMu);
  });

  it("uses pipeSnapshot when the live pipe is gone", () => {
    const orphanSessions = [
      { id: "S1", date: "2024-05-01", tobaccoId: "TA", pipeId: "P1", duration: "30", weightG: "2", lotId: "", rating: 0, notes: "" },
      {
        id: "S2", date: "2024-05-02", tobaccoId: "TA", pipeId: "DELETED",
        duration: "30", weightG: "2", lotId: "", rating: 0, notes: "",
        pipeSnapshot: { brand: "Alpha", name: "Apple", imageUrl: "" },
      },
    ];
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions: orphanSessions, tobaccos: [tobA], pipes: [pipeZulu], accessories: [], wishlist: [] },
      lang: "fr",
    });
    const sortSel = container.querySelector(SORT_SELECT) as HTMLSelectElement;
    fireEvent.change(sortSel, { target: { value: "pipe" } });
    const text = (container.textContent || "");
    // Alpha (snapshot) must precede Zulu (live).
    expect(text.indexOf("Alpha")).toBeLessThan(text.indexOf("Zulu"));
  });
});

// ── Same-day ordering: newest first (descending time, then entry order) ───────
// Full reverse-chronological: newest always on top. Within a day the journal
// sorts by the optional start `time` DESCENDING (latest session first);
// sessions with no hour sort to the END of their day; ties fall back to `id`
// DESCENDING (nxJ = save order, newest entry first), robust to a Drive/Dropbox
// restore or import merge scrambling the raw `data.sessions` array.
describe("JournalView — same-day sort newest first (time desc, then id desc)", () => {
  const mk = (id: number, date: string, name: string, time?: string) => ({
    id, date, tobaccoId: 0, pipeId: 0, duration: "", rating: 0,
    notes: "", weightG: "0", lotId: "",
    ...(time ? { time } : {}),
    tobaccoSnapshot: { brand: "", name },
  });

  it("untimed same-day sessions fall back to descending id order", () => {
    // Array order scrambled (30, 10, 20); a lower-id session on a NEWER day
    // proves day beats id. Within the day: highest id (newest entry) first.
    const sessions = [
      mk(30, "2026-06-01", "Gamma"),
      mk(10, "2026-06-01", "Alpha"),
      mk(20, "2026-06-01", "Beta"),
      mk(5, "2026-06-02", "Newer"),
    ];
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions, tobaccos: [], pipes: [], accessories: [], wishlist: [] },
      lang: "fr",
    });
    const text = container.textContent || "";
    expect(text.indexOf("Newer")).toBeLessThan(text.indexOf("Gamma"));
    // Descending id → Gamma(30) < Beta(20) < Alpha(10).
    expect(text.indexOf("Gamma")).toBeLessThan(text.indexOf("Beta"));
    expect(text.indexOf("Beta")).toBeLessThan(text.indexOf("Alpha"));
  });

  it("same-day sessions sort by descending start time, untimed last", () => {
    // Array order scrambled; times prove reverse-chronological ordering wins
    // over id and array order. "NoTime" (no hour) lands at the bottom.
    const sessions = [
      mk(1, "2026-06-01", "Evening", "20:00"),
      mk(2, "2026-06-01", "NoTime"),          // untimed → bottom
      mk(3, "2026-06-01", "Morning", "08:00"),
      mk(4, "2026-06-01", "Afternoon", "14:00"),
    ];
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: { sessions, tobaccos: [], pipes: [], accessories: [], wishlist: [] },
      lang: "fr",
    });
    const text = container.textContent || "";
    // Latest first: Evening(20:00) < Afternoon(14:00) < Morning(08:00).
    expect(text.indexOf("Evening")).toBeLessThan(text.indexOf("Afternoon"));
    expect(text.indexOf("Afternoon")).toBeLessThan(text.indexOf("Morning"));
    // Untimed session sorts after every timed one on the same day.
    expect(text.indexOf("Morning")).toBeLessThan(text.indexOf("NoTime"));
  });
});

// ── country + locality (city) session filters ────────────────────
describe("JournalView — country / locality filters", () => {
  const tobA = { id: "TA", brand: "Brackwater", name: "Duskfall", lots: [] };
  const pipeA = { id: "PA", brand: "Halvorsen", name: "Sherlock", status: "active" };
  // Two countries (one logged in FR + DE spelling — must collapse to ONE
  // ISO-canonical option) and two cities.
  const sessions = [
    { id: "S1", date: "2025-05-10", tobaccoId: "TA", pipeId: "PA", duration: "30", weightG: "2", lotId: "", rating: 0, notes: "", locationCity: "Paris", locationCountry: "France" },
    { id: "S2", date: "2025-06-11", tobaccoId: "TA", pipeId: "PA", duration: "25", weightG: "2", lotId: "", rating: 0, notes: "", locationCity: "Lyon", locationCountry: "Frankreich" },
    { id: "S3", date: "2025-07-12", tobaccoId: "TA", pipeId: "PA", duration: "40", weightG: "2", lotId: "", rating: 0, notes: "", locationCity: "Berlin", locationCountry: "Deutschland" },
  ];

  function JournalWithLocationState() {
    const [commune, setCommune] = React.useState("");
    const [country, setCountry] = React.useState("");
    return (
      <AppCtx.Provider value={{
        view: "journal",
        xl: (v: string) => v,
        nav: () => {},
        weightUnit: "g", lengthUnit: "mm", dateFormat: "fr", currencySymbol: "€",
        data: { sessions, tobaccos: [tobA], pipes: [pipeA], accessories: [], wishlist: [] },
        journalFilterCommune: commune, setJournalFilterCommune: setCommune,
        journalFilterCountry: country, setJournalFilterCountry: setCountry,
        t: (k: string) => k,
        lang: "fr",
      } as unknown as AppCtxType}>
        <CuratorJournalView />
      </AppCtx.Provider>
    );
  }

  const countrySelect = (c: HTMLElement) => c.querySelector("select[aria-label='aria_filter_by_country']") as HTMLSelectElement | null;
  const citySelect = (c: HTMLElement) => c.querySelector("select[aria-label='aria_filter_by_city']") as HTMLSelectElement | null;

  it("renders the country + locality selects when sessions carry location", () => {
    const { container } = render(<JournalWithLocationState />);
    expect(countrySelect(container)).toBeTruthy();
    expect(citySelect(container)).toBeTruthy();
  });

  it("countries collapse ISO-canonically (France/Frankreich = one option)", () => {
    const { container } = render(<JournalWithLocationState />);
    const opts = Array.from(countrySelect(container)!.querySelectorAll("option")).map(o => o.textContent);
    // placeholder + France(+Frankreich→1) + Deutschland = 3 options.
    expect(opts).toHaveLength(3);
    expect(opts).toContain("France");
    expect(opts).toContain("Deutschland");
    expect(opts).not.toContain("Frankreich"); // merged into "France"
  });

  it("the locality select lists every distinct city", () => {
    const { container } = render(<JournalWithLocationState />);
    const opts = Array.from(citySelect(container)!.querySelectorAll("option")).map(o => o.textContent);
    expect(opts).toEqual(expect.arrayContaining(["Paris", "Lyon", "Berlin"]));
  });

  // selecting a country scopes the locality dropdown to that
  // country's cities only (ISO-canonical, so the German-spelled "Frankreich"
  // session's Lyon still counts as French).
  it("scopes the locality options to the selected country", () => {
    const { container } = render(<JournalWithLocationState />);
    fireEvent.change(countrySelect(container)!, { target: { value: "France" } });
    const cityOpts = Array.from(citySelect(container)!.querySelectorAll("option")).map(o => o.textContent);
    expect(cityOpts).toContain("Paris"); // France
    expect(cityOpts).toContain("Lyon");  // Frankreich → same ISO
    expect(cityOpts).not.toContain("Berlin"); // Deutschland — excluded
  });

  // NB: city/country names also appear as <option> labels in the dropdowns,
  // so we discriminate the rendered session LIST by each card's formatted date
  // (list-only): S1=10.05.2025 Paris/France, S2=11.06.2025 Lyon/Frankreich,
  // S3=12.07.2025 Berlin/Deutschland.
  it("selecting a country narrows the list ISO-canonically (catches both spellings)", () => {
    const { container } = render(<JournalWithLocationState />);
    fireEvent.change(countrySelect(container)!, { target: { value: "France" } });
    const text = container.textContent || "";
    // S1 (France) + S2 (Frankreich → same ISO) shown; S3 (Deutschland) gone.
    expect(text).toContain("10.05.2025");
    expect(text).toContain("11.06.2025");
    expect(text).not.toContain("12.07.2025");
  });

  it("selecting a locality narrows to that city", () => {
    const { container } = render(<JournalWithLocationState />);
    fireEvent.change(citySelect(container)!, { target: { value: "Berlin" } });
    const text = container.textContent || "";
    expect(text).toContain("12.07.2025");   // Berlin session
    expect(text).not.toContain("10.05.2025"); // Paris
    expect(text).not.toContain("11.06.2025"); // Lyon
  });

  it("hides the location selects when no session carries location", () => {
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: {
        sessions: [{ id: "N1", date: "2025-01-01", tobaccoId: "TA", pipeId: "PA", duration: "10", weightG: "1", lotId: "", rating: 0, notes: "" }],
        tobaccos: [tobA], pipes: [pipeA], accessories: [], wishlist: [],
      },
    });
    expect(countrySelect(container)).toBeFalsy();
    expect(citySelect(container)).toBeFalsy();
  });
});
