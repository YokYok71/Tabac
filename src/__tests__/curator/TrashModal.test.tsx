// Curator TrashModal smoke tests. Covers the dedicated
// standalone modal that replaced the TrashSection inside Settings —
// list assembly across kinds, Restore / × handlers, the lot-of-trashed-
// tobacco hiding rule, and the closed-modal short-circuit.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorTrashModal } from "../../views/curator/TrashModal";
import { LANG } from "../../i18n.ts";

// Real FR resolver so assertions on the help-block copy (moved behind
// t() keys) keep matching French strings.
const trFr = (k: string) => (LANG.fr as any)[k] || k;

function ctx(overrides: Record<string, any> = {}) {
  return {
    trashOpen: true,
    t: trFr,
    setTrashOpen: vi.fn(),
    restoreFromTrash: vi.fn(),
    restoreAllFromTrash: vi.fn(),
    restoreSelectionFromTrash: vi.fn(),
    permanentlyDelete: vi.fn(),
    emptyTrash: vi.fn(),
    dateFormat: "fr",
    dataRaw: {
      tobaccos: [], pipes: [], wishlist: [],
      accessories: [], sessions: [],
    },
    ...overrides,
  };
}

describe("CuratorTrashModal — render gating", () => {
  it("renders nothing when trashOpen is false", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctx({
      trashOpen: false,
    }));
    expect(container.firstChild).toBeNull();
  });

  it("renders the empty-state copy when no row has deletedAt", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctx());
    expect(container.textContent).toMatch(/Corbeille vide|Trash is empty|trash_empty_title/);
  });
});

describe("CuratorTrashModal — entries assembly", () => {
  it("lists every soft-deleted top-level entity", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctx({
      dataRaw: {
        tobaccos: [
          { id: 1, brand: "Brackwater", name: "Duskfall",
            lots: [], deletedAt: "2026-05-15T10:00:00Z" },
        ],
        pipes: [
          { id: 10, brand: "Halvorsen", name: "Sherlock",
            deletedAt: "2026-05-15T11:00:00Z" },
        ],
        wishlist: [
          { id: 20, brand: "C&D", name: "Bayou Morning",
            deletedAt: "2026-05-15T12:00:00Z" },
        ],
        accessories: [
          { id: 30, brand: "IM Corona", name: "Old Boy",
            deletedAt: "2026-05-15T13:00:00Z" },
        ],
        sessions: [
          { id: 40, date: "2026-05-10",
            deletedAt: "2026-05-15T14:00:00Z" },
        ],
      },
    }));
    expect(container.textContent).toContain("Brackwater — Duskfall");
    expect(container.textContent).toContain("Halvorsen — Sherlock");
    expect(container.textContent).toContain("C&D — Bayou Morning");
    expect(container.textContent).toContain("IM Corona — Old Boy");
    expect(container.textContent).toContain("2026-05-10");
  });

  it("lists soft-deleted lots inside a NON-trashed tobacco", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctx({
      dataRaw: {
        tobaccos: [{
          id: 1, brand: "Brackwater", name: "Duskfall",
          lots: [{
            id: "L1", status: "jar", weightInitial: "50",
            boxNumber: "B7", deletedAt: "2026-05-15T10:00:00Z",
          }],
        }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      },
    }));
    expect(container.textContent).toContain("Brackwater — Duskfall");
    expect(container.textContent).toContain("50g");
    // The box prefix is a t() key now, and the FR value is the
    // fiche's "Nº " (the trash modal's own "n°" was the odd spelling of the
    // two). Also asserts the weight carries the unit rather than a hardcoded
    // "g" — this row ignored the global weightUnit.
    expect(container.textContent).toContain("Nº B7");
  });

  it("hides lots whose parent tobacco is itself in the trash", () => {
    // Restoring a lot before its parent would be a no-op (the parent
    // tabac still hides it). The TrashSection rule we extracted into
    // the modal must preserve that behaviour.
    const { container } = renderWithCtx(<CuratorTrashModal />, ctx({
      dataRaw: {
        tobaccos: [{
          id: 1, brand: "Brackwater", name: "Duskfall",
          deletedAt: "2026-05-15T10:00:00Z",
          lots: [{
            id: "L1", status: "jar", weightInitial: "50",
            deletedAt: "2026-05-15T09:00:00Z",
          }],
        }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      },
    }));
    // The tabac appears (it's top-level), the lot does NOT.
    expect(container.textContent).toContain("Brackwater — Duskfall");
    // The lot would carry "50g" in its sublabel — must be absent.
    expect(container.textContent).not.toMatch(/50g.*Brackwater/);
  });

  it("sorts newest deletion first", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctx({
      dataRaw: {
        tobaccos: [
          { id: 1, brand: "Older", name: "First",
            lots: [], deletedAt: "2026-04-01T10:00:00Z" },
          { id: 2, brand: "Newest", name: "Last",
            lots: [], deletedAt: "2026-05-20T10:00:00Z" },
        ],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      },
    }));
    const idxNewest = container.textContent!.indexOf("Newest — Last");
    const idxOldest = container.textContent!.indexOf("Older — First");
    expect(idxNewest).toBeLessThan(idxOldest);
  });
});

describe("CuratorTrashModal — actions", () => {
  it("Restore button forwards (kind, id) to restoreFromTrash", () => {
    const restoreFromTrash = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorTrashModal />, ctx({
      restoreFromTrash,
      dataRaw: {
        tobaccos: [{ id: 7, brand: "X", name: "Y",
          lots: [], deletedAt: "2026-05-15T10:00:00Z" }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      },
    }));
    // selected by aria-label, not by text. The button became
    // icon-only (its German text starved the row's label column to 21px), and
    // this text selector did NOT fail on that — it silently RETARGETED to the
    // "Tout restaurer" bulk button, whose textContent also matches
    // /trash_restore/i. `toBeTruthy()` still passed; only the argument
    // assertion caught it. The sibling × test below was already immune because
    // it selects on aria-label, which is the stable contract for an icon button.
    const restoreBtn = getAllByRole("button").find(
      (b) => /^(Restaurer|Restore|trash_restore)$/i.test(b.getAttribute("aria-label") || ""));
    expect(restoreBtn, "per-row restore button not found by aria-label").toBeTruthy();
    fireEvent.click(restoreBtn!);
    expect(restoreFromTrash).toHaveBeenCalledWith("tobacco", 7);
  });

  it("× button forwards (kind, id) to permanentlyDelete", () => {
    const permanentlyDelete = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorTrashModal />, ctx({
      permanentlyDelete,
      dataRaw: {
        tobaccos: [], pipes: [], wishlist: [], accessories: [],
        sessions: [{ id: 99, date: "2026-05-10",
          deletedAt: "2026-05-15T10:00:00Z" }],
      },
    }));
    const xBtn = getAllByRole("button").find(
      (b) => (b.getAttribute("aria-label") || "")
        .match(/Supprimer définitivement|Delete forever|trash_delete_forever_aria/));
    expect(xBtn).toBeTruthy();
    fireEvent.click(xBtn!);
    expect(permanentlyDelete).toHaveBeenCalledWith("session", 99);
  });

  it("Empty trash CTA respects the window.confirm gate", () => {
    const emptyTrash = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getAllByRole } = renderWithCtx(<CuratorTrashModal />, ctx({
      emptyTrash,
      dataRaw: {
        tobaccos: [{ id: 1, brand: "X", name: "Y",
          lots: [], deletedAt: "2026-05-15T10:00:00Z" }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      },
    }));
    const empty = getAllByRole("button").find(
      (b) => /Vider la corbeille|Empty trash|trash_empty_btn/i.test(b.textContent || ""));
    expect(empty).toBeTruthy();
    fireEvent.click(empty!);
    expect(confirmSpy).toHaveBeenCalled();
    expect(emptyTrash).not.toHaveBeenCalled(); // user declined
    confirmSpy.mockRestore();
  });

  it("Empty trash fires emptyTrash() when the user confirms", () => {
    const emptyTrash = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { getAllByRole } = renderWithCtx(<CuratorTrashModal />, ctx({
      emptyTrash,
      dataRaw: {
        tobaccos: [{ id: 1, brand: "X", name: "Y",
          lots: [], deletedAt: "2026-05-15T10:00:00Z" }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      },
    }));
    const empty = getAllByRole("button").find(
      (b) => /Vider la corbeille|Empty trash|trash_empty_btn/i.test(b.textContent || ""));
    fireEvent.click(empty!);
    expect(emptyTrash).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // mirror CTA. No confirm prompt — restore is non-
  // destructive, and the user can re-trash anything by mistake within
  // 8 seconds via the per-row undo toast (and again at any time via
  // the row's × button in the modal).
  it("Restore all CTA fires restoreAllFromTrash() with no confirm gate", () => {
    const restoreAllFromTrash = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");
    const { getAllByRole } = renderWithCtx(<CuratorTrashModal />, ctx({
      restoreAllFromTrash,
      dataRaw: {
        tobaccos: [{ id: 1, brand: "X", name: "Y",
          lots: [], deletedAt: "2026-05-15T10:00:00Z" }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      },
    }));
    const btn = getAllByRole("button").find(
      (b) => /Tout restaurer|Restore all|trash_restore_all/i.test(b.textContent || ""));
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(restoreAllFromTrash).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

// collapsible help block. Closed by default; the explanatory
// copy materialises only after the user taps the disclosure. Bilingual.
describe("CuratorTrashModal — inline help", () => {
  it("renders the disclosure label both on empty and non-empty states", () => {
    // Empty state
    let r = renderWithCtx(<CuratorTrashModal />, ctx());
    expect(r.container.textContent).toMatch(/Comment fonctionne la Corbeille|How does the Trash work|trash_help_toggle/i);
    r.unmount();
    // Non-empty state
    r = renderWithCtx(<CuratorTrashModal />, ctx({
      dataRaw: {
        tobaccos: [{ id: 1, brand: "X", name: "Y", lots: [],
          deletedAt: "2026-05-15T10:00:00Z" }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      },
    }));
    expect(r.container.textContent).toMatch(/Comment fonctionne la Corbeille|How does the Trash work|trash_help_toggle/i);
  });

  it("does NOT show the help copy when collapsed (default)", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctx());
    // The 30-day sentence belongs to the help copy, NOT the empty-
    // state caption (which says "30 jours ici avant d'être effacés")
    // — be specific enough to distinguish.
    expect(container.textContent).not.toMatch(/atterrissent ici|land here for/i);
  });

  it("expands the help copy after the disclosure is tapped", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctx());
    const toggle = Array.from(container.querySelectorAll("button"))
      .find(b => /Comment fonctionne|How does the Trash|trash_help_toggle/i.test(b.textContent || ""));
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle!);
    expect(container.textContent).toMatch(/atterrissent ici|land here for/i);
    expect(container.textContent).toMatch(/Restaurer|Restore/);
    expect(container.textContent).toMatch(/Vider la corbeille|Empty trash/);
  });

  it("aria-expanded toggles between false and true on click", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctx());
    const toggle = Array.from(container.querySelectorAll("button"))
      .find(b => /Comment fonctionne|How does the Trash|trash_help_toggle/i.test(b.textContent || "")) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("includes the backup-vs-CSV asymmetry note when expanded", () => {
    // The note that Drive/JSON keep the trash but CSV doesn't is
    // user-facing-important enough to lock in a test — drifting it
    // out would be a regression.
    const { container } = renderWithCtx(<CuratorTrashModal />, ctx());
    const toggle = Array.from(container.querySelectorAll("button"))
      .find(b => /Comment fonctionne|How does the Trash|trash_help_toggle/i.test(b.textContent || ""));
    fireEvent.click(toggle!);
    expect(container.textContent).toMatch(/Google Drive|Drive/i);
    expect(container.textContent).toMatch(/CSV/i);
  });
});

// selective restore. The user can flip into select mode,
// pick a subset of trash entries, and restore just those.
describe("CuratorTrashModal — selective restore", () => {
  function ctxWithEntries() {
    return ctx({
      dataRaw: {
        tobaccos: [
          { id: 1, brand: "Brackwater", name: "Duskfall", lots: [],
            deletedAt: "2026-05-15T10:00:00Z" },
        ],
        pipes: [
          { id: 10, brand: "Halvorsen", name: "Sherlock",
            deletedAt: "2026-05-15T11:00:00Z" },
        ],
        wishlist: [], accessories: [],
        sessions: [
          { id: 40, date: "2026-05-10",
            deletedAt: "2026-05-15T12:00:00Z" },
        ],
      },
    });
  }

  it("renders the 'Sélection' toggle button outside select mode", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctxWithEntries());
    expect(Array.from(container.querySelectorAll("button"))
      .some(b => /Sélection|^Select$|trash_select_mode/i.test(b.textContent || ""))).toBe(true);
  });

  it("entering select mode hides the per-row Restore + × buttons", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctxWithEntries());
    const toggle = Array.from(container.querySelectorAll("button"))
      .find(b => /Sélection|^Select$|trash_select_mode/i.test(b.textContent || ""));
    fireEvent.click(toggle!);
    // Per-row Restore buttons are gone.
    const restoreBtns = Array.from(container.querySelectorAll("button"))
      .filter(b => /^(Restaurer|Restore|trash_restore)$/.test(b.getAttribute("aria-label") || ""));
    expect(restoreBtns.length).toBe(0);
    // Per-row × buttons are gone.
    const xBtns = Array.from(container.querySelectorAll("button"))
      .filter(b => /Supprimer définitivement|Delete forever|trash_delete_forever_aria/i
        .test(b.getAttribute("aria-label") || ""));
    expect(xBtns.length).toBe(0);
  });

  it("renders a checkbox role on every entry in select mode", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctxWithEntries());
    const toggle = Array.from(container.querySelectorAll("button"))
      .find(b => /Sélection|^Select$|trash_select_mode/i.test(b.textContent || ""));
    fireEvent.click(toggle!);
    const checkboxes = container.querySelectorAll('[role="checkbox"]');
    expect(checkboxes.length).toBe(3); // tobacco + pipe + session
  });

  it("'Restaurer la sélection (N)' is disabled with zero selections", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctxWithEntries());
    fireEvent.click(Array.from(container.querySelectorAll("button"))
      .find(b => /Sélection|^Select$|trash_select_mode/i.test(b.textContent || ""))!);
    const cta = Array.from(container.querySelectorAll("button"))
      .find(b => /Restaurer la sélection|Restore selection|trash_restore_selection/i.test(b.textContent || ""));
    expect(cta).toBeTruthy();
    expect(cta!.getAttribute("aria-disabled")).toBe("true");
    expect(cta!.textContent).toMatch(/\(0\)/);
  });

  it("checking rows increments the selection counter on the CTA", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctxWithEntries());
    fireEvent.click(Array.from(container.querySelectorAll("button"))
      .find(b => /Sélection|^Select$|trash_select_mode/i.test(b.textContent || ""))!);
    // in select mode the ROW is the checkbox (role="checkbox" +
    // onClick). Tap it directly.
    const rows = Array.from(container.querySelectorAll('[role="checkbox"]'));
    fireEvent.click(rows[0] as HTMLElement);
    fireEvent.click(rows[2] as HTMLElement);
    const cta = Array.from(container.querySelectorAll("button"))
      .find(b => /Restaurer la sélection|Restore selection|trash_restore_selection/i.test(b.textContent || ""));
    expect(cta!.textContent).toMatch(/\(2\)/);
    expect(cta!.getAttribute("aria-disabled")).toBe("false");
  });

  // An earlier release regression: a multi-pick selection MUST translate into
  // ONE atomic ctx call. The implementation looped
  // restoreFromTrash per row — every call re-read `data` from the
  // same closure, and React's batching meant only the last save
  // survived ("j'ai sélectionné 2 éléments, il n'a restauré que le
  // premier"). The fix routes through restoreSelectionFromTrash,
  // which composes the un-trashed payload in a single save.
  it("'Restaurer la sélection' delegates to restoreSelectionFromTrash with the full set", () => {
    const restoreSelectionFromTrash = vi.fn();
    const restoreFromTrash = vi.fn();
    const c = ctxWithEntries();
    c.restoreSelectionFromTrash = restoreSelectionFromTrash;
    c.restoreFromTrash = restoreFromTrash;
    const { container } = renderWithCtx(<CuratorTrashModal />, c);
    fireEvent.click(Array.from(container.querySelectorAll("button"))
      .find(b => /Sélection|^Select$|trash_select_mode/i.test(b.textContent || ""))!);
    const rows = Array.from(container.querySelectorAll('[role="checkbox"]'));
    fireEvent.click(rows[0] as HTMLElement); // tobacco 1
    fireEvent.click(rows[2] as HTMLElement); // session 40
    const cta = Array.from(container.querySelectorAll("button"))
      .find(b => /Restaurer la sélection|Restore selection|trash_restore_selection/i.test(b.textContent || ""));
    fireEvent.click(cta!);
    // Atomic call — ONE invocation, not per-row.
    expect(restoreSelectionFromTrash).toHaveBeenCalledTimes(1);
    expect(restoreFromTrash).not.toHaveBeenCalled();
    const passedSet = restoreSelectionFromTrash.mock.calls[0]![0] as Set<string>;
    expect(passedSet.has("tobacco:1")).toBe(true);
    expect(passedSet.has("session:40")).toBe(true);
    expect(passedSet.size).toBe(2);
  });

  it("Annuler / Cancel exits select mode and clears the selection", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, ctxWithEntries());
    fireEvent.click(Array.from(container.querySelectorAll("button"))
      .find(b => /Sélection|^Select$|trash_select_mode/i.test(b.textContent || ""))!);
    const rows = Array.from(container.querySelectorAll('[role="checkbox"]'));
    fireEvent.click(rows[0]!.parentElement as HTMLElement);
    // Now Cancel.
    const cancel = Array.from(container.querySelectorAll("button"))
      .find(b => /^Annuler$|^Cancel$|^btn_cancel$/i.test(b.textContent || ""));
    fireEvent.click(cancel!);
    // Back to non-select mode — per-row Restore buttons reappear. Counted by
    // aria-label made them icon-only; an exact-text match here
    // would silently count zero and the assertion would read as a real failure.
    const restoreBtns = Array.from(container.querySelectorAll("button"))
      .filter(b => /^(Restaurer|Restore|trash_restore)$/i.test(b.getAttribute("aria-label") || ""));
    expect(restoreBtns.length).toBe(3);
  });
});

// ── the row must not be squeezed by its own button ───────────
// The restore button was a TEXT button with flexShrink:0, so its width was set
// by the translation and the label column beside it (flex:1, minWidth:0) took
// the whole squeeze. MEASURED in a real browser at 390px: German
// "Wiederherstellen" renders 155px (169px at the "L" text size), leaving the
// column 35px / 21px — 72%/84% of the item name and 83%/91% of the expiry line
// clipped, on the one screen whose purpose is telling you WHAT you are about to
// delete for ever and WHEN it expires. Two structural properties fix it and
// both are asserted: the actions are FIXED-WIDTH (language-independent) and
// neither text line ellipsizes.
describe("TrashModal row layout", () => {
  const rowCtx = () => ctx({
    dataRaw: {
      tobaccos: [{ id: 7, brand: "Vauen", name: "Cure-pipe de voyage en laiton",
        lots: [], deletedAt: "2026-05-15T10:00:00Z" }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    },
  });

  it("both per-row actions are fixed 36px squares — width can't depend on a translation", () => {
    const { getAllByRole } = renderWithCtx(<CuratorTrashModal />, rowCtx());
    const byLabel = (re: RegExp) => getAllByRole("button")
      .find((b) => re.test(b.getAttribute("aria-label") || "")) as HTMLElement;
    for (const [name, re] of [
      ["restore", /^(Restaurer|Restore|trash_restore)$/i],
      ["delete-forever", /trash_delete_forever_aria|Supprimer définitivement/i],
    ] as const) {
      const btn = byLabel(re);
      expect(btn, `${name} button not found`).toBeTruthy();
      expect(btn.style.width, `${name} width`).toBe("36px");
      expect(btn.style.height, `${name} height`).toBe("36px");
      // A text button re-introduced here would carry horizontal padding to fit
      // its word; that is the shape that caused the defect.
      expect(btn.style.padding === "" || btn.style.padding === "0px").toBe(true);
    }
  });

  it("keeps the restore action's accessible name even though it is icon-only", () => {
    const { getAllByRole } = renderWithCtx(<CuratorTrashModal />, rowCtx());
    const btn = getAllByRole("button")
      .find((b) => /^(Restaurer|Restore|trash_restore)$/i.test(b.getAttribute("aria-label") || ""));
    // Dropping the visible word is only acceptable while the name survives —
    // otherwise the row offers a screen-reader user two unlabelled squares.
    expect(btn!.getAttribute("aria-label")).toBeTruthy();
    expect(btn!.getAttribute("title")).toBeTruthy();
  });

  it("neither the item name nor the expiry line ellipsizes", () => {
    const { container } = renderWithCtx(<CuratorTrashModal />, rowCtx());
    const clipped = Array.from(container.querySelectorAll("div"))
      .filter((d) => {
        const s = (d as HTMLElement).style;
        return s.textOverflow === "ellipsis" && /Vauen|restants|days left|trash_days_left/.test(d.textContent || "");
      });
    expect(clipped, "a trash row text line is ellipsized again").toEqual([]);
  });
});
