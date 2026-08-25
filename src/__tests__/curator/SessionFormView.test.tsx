import React from "react";
// Smoke tests for src/views/curator/SessionFormView.tsx.
//
// Coverage focus:
//   - Tobacco dropdown filters to jar lots with weightG > 0 (addJ mode)
//   - Edit mode keeps the currently selected tobacco even if no jar lots
//   - Orphan detection scans ALL tobaccos

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorSessionFormView } from "../../views/curator/SessionFormView";
import { AppCtx, type AppCtxType } from "../../AppContext";

// mock only reverseGeocode (keep the real isValidCoords etc.) so
// the "Mettre à jour l'adresse" button test is deterministic + offline.
vi.mock("../../utils/geo.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/geo.ts")>();
  return {
    ...actual,
    reverseGeocode: vi.fn(() => Promise.resolve({ name: "Café de Flore", city: "Paris", country: "France" })),
  };
});

const tobWithJar = {
  id: "T1", brand: "Brackwater", name: "Duskfall",
  lots: [{ id: "L1", status: "jar", weightG: "50", dateOpened: "2024-01-15" }],
};
const tobNoJar = {
  id: "T2", brand: "G.L. Pease", name: "Westminster",
  lots: [{ id: "L2", status: "cellar", weightG: "100" }],
};
const tobJarEmpty = {
  id: "T3", brand: "Pellworm", name: "HH Old Dark Fired",
  lots: [{ id: "L3", status: "jar", weightG: "0", dateOpened: "2024-01-15" }],
};

const emptyForm = {
  date: "", tobaccoId: "", pipeId: "", lotId: "",
  weightG: "", duration: "", rating: 0, notes: "",
};

describe("SessionFormView — visibility", () => {
  it("returns null when view !== 'addJ' / 'editJ'", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "home",
      sessForm: emptyForm,
    });
    expect(container.firstChild).toBeNull();
  });
});

describe("SessionFormView — tobacco dropdown filter", () => {
  it("addJ: tobaccos with any usable lot (jar OR cellar, weightG>0) are listed", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: emptyForm,
      setSessForm: vi.fn(),
      data: { tobaccos: [tobWithJar, tobNoJar, tobJarEmpty], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const select = container.querySelector("select") as HTMLSelectElement;
    const options = Array.from(select?.querySelectorAll("option") || []).map(o => o.textContent || "");
    // tobWithJar (jar 50g) and tobNoJar (cellar 100g) both present.
    // tobJarEmpty (jar 0g) is excluded — no usable balance.
    expect(options.some(o => o.includes("Brackwater"))).toBe(true);
    expect(options.some(o => o.includes("G.L. Pease"))).toBe(true);
    expect(options.some(o => o.includes("Pellworm"))).toBe(false);
  });

  it("editJ: currently-selected tobacco is always kept in the dropdown", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "editJ",
      sessForm: { ...emptyForm, tobaccoId: "T3", date: "2024-06-01" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobWithJar, tobNoJar, tobJarEmpty], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const select = container.querySelector("select") as HTMLSelectElement;
    const options = Array.from(select?.querySelectorAll("option") || []).map(o => o.textContent || "");
    expect(options.some(o => o.includes("Pellworm"))).toBe(true);
  });
});

describe("SessionFormView — orphan detection", () => {
  it("locks the weight field when editing a session whose lotId no longer exists on ANY tobacco", () => {
    // lotId points to a lot that has been removed
    const orphanForm = {
      ...emptyForm,
      tobaccoId: "T1",
      lotId: "DELETED-LOT-ID",
      date: "2024-06-01",
      weightG: "2.5",
    };
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "editJ",
      sessForm: orphanForm,
      setSessForm: vi.fn(),
      data: { tobaccos: [tobWithJar, tobNoJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // The orphan UI shows a read-only div in place of the weight input.
    expect(container.textContent).toMatch(/⚠|orphan|warning|2.5/);
  });
});

describe("SessionFormView — apply default weight", () => {
  it("editJ: the button re-applies the chamber×cut estimate to the weight", () => {
    const setSessForm = vi.fn();
    const pipe = { id: "P1", brand: "Halvorsen", name: "SH", status: "active", chamberDiameter: "19", chamberDepth: "40" };
    const tob = { id: "T1", brand: "Brackwater", name: "Duskfall", cut: "Ribbon", lots: [{ id: "L1", status: "jar", weightG: "50" }] };
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "editJ",
      sessForm: { ...emptyForm, id: "J1", tobaccoId: "T1", pipeId: "P1", lotId: "", date: "2024-06-01", weightG: "9" },
      setSessForm,
      accountingEnabled: true, weightUnit: "g", sessDefaultWeight: "3",
      data: { tobaccos: [tob], pipes: [pipe], accessories: [], sessions: [], wishlist: [] },
    });
    // 19×40 mm Ribbon (0.22) ≈ 2.5 g — button label carries the value.
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent || "").includes("2.5"),
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(setSessForm).toHaveBeenCalled();
    // `set` patches through an UPDATER now, so the argument is a function of
    // the previous form rather than the merged object. The change was made
    // because `handlePhotoUpload`'s callback fires long after the picker
    // closes and was reverting anything typed in between; what this case
    // asserts — the button re-applies the chamber x cut estimate — is unchanged.
    const lastArg = setSessForm.mock.calls[setSessForm.mock.calls.length - 1]![0];
    const merged = typeof lastArg === "function" ? lastArg({}) : lastArg;
    expect(merged.weightG).toBe("2.5");
  });

  it("hides the button when the recorded weight already equals the default", () => {
    const pipe = { id: "P1", brand: "Halvorsen", name: "SH", status: "active", chamberDiameter: "19", chamberDepth: "40" };
    const tob = { id: "T1", brand: "Brackwater", name: "Duskfall", cut: "Ribbon", lots: [{ id: "L1", status: "jar", weightG: "50" }] };
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "editJ",
      // weightG already equals the 19×40 Ribbon estimate (2.5) → no button.
      sessForm: { ...emptyForm, id: "J1", tobaccoId: "T1", pipeId: "P1", lotId: "", date: "2024-06-01", weightG: "2.5" },
      setSessForm: vi.fn(),
      accountingEnabled: true, weightUnit: "g", sessDefaultWeight: "3",
      data: { tobaccos: [tob], pipes: [pipe], accessories: [], sessions: [], wishlist: [] },
    });
    const hasApplyBtn = Array.from(container.querySelectorAll("button")).some(
      (b) => (b.textContent || "").includes("btn_apply_default_weight"),
    );
    expect(hasApplyBtn).toBe(false);
  });

  it("does not render the button in add mode (auto-applied there)", () => {
    const pipe = { id: "P1", brand: "Halvorsen", name: "SH", status: "active", chamberDiameter: "19", chamberDepth: "40" };
    const tob = { id: "T1", brand: "Brackwater", name: "Duskfall", cut: "Ribbon", lots: [{ id: "L1", status: "jar", weightG: "50" }] };
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", pipeId: "P1", date: "2024-06-01", weightG: "2.5" },
      setSessForm: vi.fn(),
      accountingEnabled: true, weightUnit: "g", sessDefaultWeight: "3",
      data: { tobaccos: [tob], pipes: [pipe], accessories: [], sessions: [], wishlist: [] },
    });
    const hasApplyBtn = Array.from(container.querySelectorAll("button")).some(
      (b) => (b.textContent || "").includes("btn_apply_default_weight"),
    );
    expect(hasApplyBtn).toBe(false);
  });
});

describe("SessionFormView — Save gate", () => {
  it("Save disabled when tobaccoId is empty", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, date: "2024-06-01" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const save = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|btn_save|Ajouter|Add|Enregistrer|Save/i.test(b.textContent || ""));
    expect(save?.getAttribute("aria-disabled")).toBe("true");
  });

  it("Save disabled when date is empty", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const save = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|btn_save|Ajouter|Add|Enregistrer|Save/i.test(b.textContent || ""));
    expect(save?.getAttribute("aria-disabled")).toBe("true");
  });

  // The save gate also requires pipeId + a positive weight, not
  // just tobaccoId + date. So we include both here and stick a pipe in
  // ctx.data so the pipe selector resolves.
  it("Save enabled when tobaccoId, pipeId, date, and weightG are all set", () => {
    const pipe = { id: "P1", name: "Shell", brand: "Brackwater", status: "active" };
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: {
        ...emptyForm, tobaccoId: "T1", pipeId: "P1", date: "2024-06-01", weightG: "3",
      },
      setSessForm: vi.fn(),
      pipeIsActive: () => true,
      data: { tobaccos: [tobWithJar], pipes: [pipe], accessories: [], sessions: [], wishlist: [] },
    });
    const save = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|btn_save|Ajouter|Add|Enregistrer|Save/i.test(b.textContent || ""));
    expect(save?.getAttribute("aria-disabled")).toBe("false");
  });
});

describe("SessionFormView — defensive weight prefill", () => {
  it("seeds weightG to sessDefaultWeight when empty on addJ mount", () => {
    const setSessForm = vi.fn();
    renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, weightG: "" },
      setSessForm,
      data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
      sessDefaultWeight: "3",
      weightUnit: "g",
    });
    expect(setSessForm).toHaveBeenCalled();
    const arg = setSessForm.mock.calls[0]![0];
    expect(arg.weightG).toBe("3");
  });

  it("falls back to '0.1' when sessDefaultWeight is empty and unit is oz", () => {
    const setSessForm = vi.fn();
    renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, weightG: "" },
      setSessForm,
      data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
      sessDefaultWeight: "",
      weightUnit: "oz",
    });
    expect(setSessForm).toHaveBeenCalled();
    const arg = setSessForm.mock.calls[0]![0];
    expect(arg.weightG).toBe("0.1");
  });

  it("falls back to '3' when sessDefaultWeight and weightUnit are both absent", () => {
    const setSessForm = vi.fn();
    renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, weightG: "" },
      setSessForm,
      data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(setSessForm).toHaveBeenCalled();
    const arg = setSessForm.mock.calls[0]![0];
    expect(arg.weightG).toBe("3");
  });

  it("does NOT overwrite an existing non-empty weightG", () => {
    const setSessForm = vi.fn();
    renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, weightG: "5" },
      setSessForm,
      data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
      sessDefaultWeight: "3",
    });
    expect(setSessForm).not.toHaveBeenCalled();
  });

  it("does NOT prefill in editJ mode (existing session)", () => {
    const setSessForm = vi.fn();
    renderWithCtx(<CuratorSessionFormView />, {
      view: "editJ",
      sessForm: { ...emptyForm, weightG: "", tobaccoId: "T1", date: "2024-06-01" },
      setSessForm,
      data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
      sessDefaultWeight: "3",
    });
    expect(setSessForm).not.toHaveBeenCalled();
  });
});

describe("SessionFormView — hook order stability (regression: React #310)", () => {
  it("survives a view transition from 'home' (returns null) to 'editJ' (renders)", () => {
    // React error #310 ("rendered more hooks than during the previous render")
    // fires when a hook is declared AFTER an early return and the component
    // transitions from the null branch to the rendered branch — the hook count
    // grows mid-instance. All hooks must therefore live before any early
    // return. To exercise this end-to-end we render a stateful wrapper that
    // mutates the ctx in place so the same SessionFormView instance sees a
    // view change.
    function Harness() {
      const [view, setView] = React.useState("home");
      const setSessForm = vi.fn();
      const ctxValue: any = {
        view,
        sessForm: { ...emptyForm, tobaccoId: "T1", date: "2024-06-01", weightG: "5" },
        setSessForm,
        data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
        sessDefaultWeight: "3",
        weightUnit: "g",
        t: (k: string) => k,
        nav: vi.fn(),
        BJ: emptyForm,
      };
      return (
        <>
          <button data-testid="toggle" onClick={() => setView("editJ")}>flip</button>
          <AppCtx.Provider value={ctxValue}>
            <CuratorSessionFormView />
          </AppCtx.Provider>
        </>
      );
    }
    const { getByTestId, container } = render(<Harness />);
    // No form rendered yet (view=home → returns null).
    expect(container.querySelector("textarea")).toBeNull();
    // Flip — must NOT throw the dreaded React #310.
    expect(() => {
      fireEvent.click(getByTestId("toggle"));
    }).not.toThrow();
    // And the form is now visible.
    expect(container.querySelector("textarea")).toBeTruthy();
  });
});

describe("SessionFormView — cellar lot selection", () => {
  // Two usable lots so the dropdown actually renders (>1).
  const tobMixed = {
    id: "T1", brand: "Brackwater", name: "Duskfall",
    lots: [
      { id: "L1", status: "jar",    weightG: "50",  dateOpened: "2024-01-15" },
      { id: "L2", status: "cellar", weightG: "100", datePurchased: "2024-02-01" },
    ],
  };

  it("the lot dropdown is visible even when the tobacco has a single cellar lot", () => {
    const tobOnlyCellar = {
      id: "T9", brand: "G.L. Pease", name: "Westminster",
      lots: [
        { id: "L9", status: "cellar", weightG: "100", datePurchased: "2024-02-01" },
      ],
    };
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T9", lotId: "L9", date: "2024-06-01" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobOnlyCellar], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // Two selects total: tobacco + lot. The previous gate (length > 1) hid
    // the lot picker entirely when there was a single usable lot, which
    // made it feel like cellar selection wasn't possible.
    const selects = container.querySelectorAll("select");
    expect(selects.length).toBeGreaterThanOrEqual(2);
    const lotSelect = selects[1] as HTMLSelectElement;
    const options = Array.from(lotSelect?.querySelectorAll("option") || [])
      .map(o => o.textContent || "");
    expect(options.some(o => /Cave|Cellar|lot_cellar/i.test(o))).toBe(true);
  });

  it("the lot dropdown surfaces BOTH jar and cellar lots with explicit tags", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L1", date: "2024-06-01" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobMixed], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // Lot dropdown is the second <select> (first is tobacco).
    const selects = container.querySelectorAll("select");
    const lotSelect = selects[1] as HTMLSelectElement;
    const options = Array.from(lotSelect?.querySelectorAll("option") || [])
      .map(o => o.textContent || "");
    // Both Pot and Cave appear with their respective tags.
    expect(options.some(o => /Pot|lot_jar/i.test(o))).toBe(true);
    expect(options.some(o => /Cave|lot_cellar/i.test(o))).toBe(true);
  });

  it("shows the cellar advisory note when the selected lot is in cellar status", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L2", date: "2024-06-01" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobMixed], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // The inline note appears under the lot picker.
    expect(container.textContent || "").toMatch(/cave|cellar/i);
    expect(container.textContent || "").toMatch(/ouvrir|open|pot|jar/i);
  });

  it("does NOT show the cellar advisory note when the selected lot is already jar", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L1", date: "2024-06-01" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobMixed], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // The "Ce lot est encore en cave" advisory text should not be present.
    expect(container.textContent || "").not.toMatch(/encore en cave|still sealed in the cellar|session_cellar_save_notice/i);
  });

  it("editJ: cross-lot edit pointing to a cellar lot also surfaces the cellar advisory", () => {
    // Same tobacco, edit moves the session from L1 (jar) to L2 (cellar).
    // The cellar advisory must fire so the user sees they will be asked
    // to open the lot on save.
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "editJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L2", date: "2024-06-01", weightG: "3" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobMixed], pipes: [], accessories: [],
              sessions: [{ id: "S1", date: "2024-05-01", tobaccoId: "T1", pipeId: "", lotId: "L1", weightG: "5", duration: "30", rating: 0, notes: "" }],
              wishlist: [] },
    });
    expect(container.textContent || "").toMatch(/encore en cave|still sealed in the cellar|session_cellar_save_notice/i);
  });
});

// ── Selection cards ──────────────────────────────────────────────
// Photo + brand + name preview under each selector, so the user can confirm
// what they picked without scrolling away from the form.

describe("SessionFormView — tabac/pipe selection cards", () => {
  const tobWithPhoto = {
    id: "T1", brand: "Brackwater", name: "Duskfall",
    imageUrl: "local-photo-tab-1",
    lots: [{ id: "L1", status: "jar", weightG: "50", dateOpened: "2024-01-15" }],
  };
  const pipeWithPhoto = {
    id: "P1", brand: "Halvorsen", name: "Sherlock Holmes",
    imageUrl: "local-photo-pipe-1", status: "active",
  };

  it("renders a tabac selection card with brand + name when a tobacco is picked", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L1", date: "2024-06-01" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobWithPhoto], pipes: [pipeWithPhoto], accessories: [], sessions: [], wishlist: [] },
      imgLocal: { "local-photo-tab-1": "data:image/jpeg;base64,xxx" },
    });
    // Brand + Name appear in the card under the tabac dropdown.
    expect(container.textContent || "").toMatch(/Brackwater/);
    expect(container.textContent || "").toMatch(/Duskfall/);
  });

  it("renders a pipe selection card with brand + name when a pipe is picked", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L1", pipeId: "P1", date: "2024-06-01" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobWithPhoto], pipes: [pipeWithPhoto], accessories: [], sessions: [], wishlist: [] },
      imgLocal: {},
    });
    expect(container.textContent || "").toMatch(/Halvorsen/);
    expect(container.textContent || "").toMatch(/Sherlock Holmes/);
  });

  it("does NOT render the pipe card when no pipe is picked (only the dropdown lists it)", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L1", date: "2024-06-01" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobWithPhoto], pipes: [pipeWithPhoto], accessories: [], sessions: [], wishlist: [] },
    });
    // The pipe brand "Halvorsen" appears once in the <option> of the pipe
    // dropdown, but the SelectionCard (which would add a second occurrence
    // as a label + italic name) must not render when no pipe is picked.
    const occurrences = (container.textContent || "").match(/Halvorsen/g) || [];
    expect(occurrences.length).toBe(1);
  });
});

// ── accounting OFF — weight field hidden, weightG forced "0" ────
// Simpler reincarnation of the old toggle. No per-session flag,
// no special branches in useSessionStore — just hide the field and let
// the existing weight-machinery short-circuit at weight=0.

describe("SessionFormView — accounting OFF", () => {
  const tobWithJar = {
    id: "T1", brand: "X", name: "Y",
    lots: [{ id: "L1", status: "jar", weightG: "50" }],
  };

  // Locate the weight field via its label text — TextField renders as
  // <input type="text" inputMode="decimal"> for numeric fields (build
  // ~200 iOS Safari fix), so querying by [type="number"] misses it.
  function findWeightInput(container: HTMLElement): HTMLInputElement | null {
    const labels = Array.from(container.querySelectorAll("label"));
    const wl = labels.find(l => /poids|weight/i.test(l.textContent || ""));
    if (!wl) return null;
    const forId = wl.getAttribute("for");
    if (!forId) return null;
    return container.querySelector(`#${forId}`) as HTMLInputElement | null;
  }

  it("hides the weight TextField when accountingEnabled is false", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L1", date: "2024-06-01", weightG: "0" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
      accountingEnabled: false,
    });
    expect(findWeightInput(container)).toBeNull();
    // Replacement Notice mentions "comptabilité désactivée" / "accounting is off".
    expect(container.textContent || "").toMatch(
      /comptabilit[^]{0,5}d[ée]sactiv|accounting is off|accounting_off_notice/i,
    );
  });

  it("the weight field IS visible when accountingEnabled is true (default)", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L1", date: "2024-06-01", weightG: "3" },
      setSessForm: vi.fn(),
      data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(findWeightInput(container)).toBeTruthy();
  });

  it("forces form.weightG to '0' on mount when accountingEnabled is false", () => {
    const setSessForm = vi.fn();
    renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      // Form starts with a non-zero weight (e.g. from a previous on-mode entry).
      sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L1", date: "2024-06-01", weightG: "5" },
      setSessForm,
      data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
      accountingEnabled: false,
    });
    // The defensive prefill effect calls setSessForm to lock weightG to "0".
    const calls = setSessForm.mock.calls;
    const forcedZero = calls.some((c: any) => c[0] && c[0].weightG === "0");
    expect(forcedZero).toBe(true);
  });
});

// regression — the lot picker sort previously crashed with
// "(H.boxNumber||'').localeCompare is not a function" when a lot's
// boxNumber was a number (legacy/imported data). The view now
// String()-coerces both sides before localeCompare.
describe("SessionFormView — lot picker tolerates numeric boxNumber", () => {
  it("renders without crashing when multiple cellar lots carry numeric boxNumbers", () => {
    const tobBadBox = {
      id: "T1", brand: "X", name: "Y",
      lots: [
        // mix: a number AND a string-but-non-numeric value so the sort
        // falls into the localeCompare fallback path (the crash site).
        { id: "L1", status: "cellar", weightG: "50", boxNumber: 7 as any },
        { id: "L2", status: "cellar", weightG: "50", boxNumber: "B12" },
        { id: "L3", status: "cellar", weightG: "50", boxNumber: 3 as any },
      ],
    };
    expect(() => {
      renderWithCtx(<CuratorSessionFormView />, {
        view: "addJ",
        sessForm: { ...emptyForm, tobaccoId: "T1", lotId: "L1", date: "2024-06-01", weightG: "3" },
        setSessForm: vi.fn(),
        data: { tobaccos: [tobBadBox], pipes: [], accessories: [], sessions: [], wishlist: [] },
      });
    }).not.toThrow();
  });
});

// Regression — the prefill effect used to include `form?.weightG` in its
// dep array, which made it re-run on every keystroke. Clearing the
// input (backspace → "") triggered the effect, which immediately
// re-filled with the default value, racing against the next
// keystroke. Result: the user couldn't change the weight with
// accounting ON. The dep array now lists only [view, accountingEnabled];
// the effect must fire ONCE on view enter, not on weight changes.
describe("SessionFormView — weight prefill does NOT fight user typing", () => {
  const tobWithJar = {
    id: "T1", brand: "X", name: "Y",
    lots: [{ id: "L1", status: "jar", weightG: "50" }],
  };

  it("clearing the weight to '' in accounting-ON mode does NOT trigger a refill", () => {
    // Stateful wrapper so setSessForm calls actually mutate form
    // — without it the harness wouldn't observe the re-render that
    // exercises the dep array.
    function Wrap() {
      const [f, setF] = React.useState({
        ...emptyForm, tobaccoId: "T1", lotId: "L1", date: "2024-06-01", weightG: "3",
      });
      return (
        <AppCtx.Provider value={{
          view: "addJ",
          xl: (v: string) => v,
          nav: () => {},
          lengthUnit: "mm",
          dateFormat: "fr",
          currencySymbol: "€",
          sessForm: f,
          setSessForm: (next: any) => setF(next),
          data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
          accountingEnabled: true,
          sessDefaultWeight: "3",
          weightUnit: "g",
          BJ: emptyForm,
          t: (k: string) => k,
          lang: "fr",
        } as unknown as AppCtxType}>
          <CuratorSessionFormView />
        </AppCtx.Provider>
      );
    }
    const { container } = render(<Wrap />);
    const labels = Array.from(container.querySelectorAll("label"));
    const wl = labels.find(l => /poids|weight/i.test(l.textContent || ""));
    const forId = wl?.getAttribute("for");
    const input = container.querySelector(`#${forId}`) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("3");
    // User clears the field (typical iOS/Android flow when replacing
    // the value). Without the fix, the effect re-fires and snaps
    // form.weightG back to "3".
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    // Now type the new value — the input must accept it.
    fireEvent.change(input, { target: { value: "5" } });
    expect(input.value).toBe("5");
  });

  it("entering addJ with an empty weight still prefills with the default (one-shot)", () => {
    function Wrap() {
      const [f, setF] = React.useState({
        ...emptyForm, tobaccoId: "T1", lotId: "L1", date: "2024-06-01", weightG: "",
      });
      return (
        <AppCtx.Provider value={{
          view: "addJ",
          xl: (v: string) => v,
          nav: () => {},
          lengthUnit: "mm",
          dateFormat: "fr",
          currencySymbol: "€",
          sessForm: f,
          setSessForm: (next: any) => setF(next),
          data: { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] },
          accountingEnabled: true,
          sessDefaultWeight: "2.5",
          weightUnit: "g",
          BJ: emptyForm,
          t: (k: string) => k,
          lang: "fr",
        } as unknown as AppCtxType}>
          <CuratorSessionFormView />
        </AppCtx.Provider>
      );
    }
    const { container } = render(<Wrap />);
    const labels = Array.from(container.querySelectorAll("label"));
    const wl = labels.find(l => /poids|weight/i.test(l.textContent || ""));
    const forId = wl?.getAttribute("for");
    const input = container.querySelector(`#${forId}`) as HTMLInputElement;
    expect(input.value).toBe("2.5");
  });
});

describe("SessionFormView — editable coordinates", () => {
  const geoData = { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] };

  it("addJ: renders empty, editable Latitude / Longitude inputs", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ", sessForm: emptyForm, setSessForm: vi.fn(), data: geoData,
    });
    const lat = container.querySelector('input[placeholder="48.8566"]') as HTMLInputElement | null;
    const lng = container.querySelector('input[placeholder="2.3522"]') as HTMLInputElement | null;
    expect(lat).toBeTruthy();
    expect(lng).toBeTruthy();
    expect(lat!.value).toBe("");
    expect(lng!.value).toBe("");
  });

  it("editJ: pre-fills the inputs from an existing session's lat / lng", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "editJ", editSessId: "S1",
      sessForm: { ...emptyForm, tobaccoId: "T1", lat: 48.8566, lng: 2.3522 },
      setSessForm: vi.fn(), data: geoData,
    });
    const lat = container.querySelector('input[placeholder="48.8566"]') as HTMLInputElement;
    const lng = container.querySelector('input[placeholder="2.3522"]') as HTMLInputElement;
    expect(lat.value).toBe("48.8566");
    expect(lng.value).toBe("2.3522");
  });

  it("typing a latitude commits a numeric lat to the form", () => {
    const setForm = vi.fn();
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ", sessForm: emptyForm, setSessForm: setForm, data: geoData,
    });
    const lat = container.querySelector('input[placeholder="48.8566"]') as HTMLInputElement;
    fireEvent.change(lat, { target: { value: "48.85" } });
    // the input keeps the typed string…
    expect(lat.value).toBe("48.85");
    // …and the form receives lat as a real number.
    const committed = setForm.mock.calls.some((c) => {
      // Same reason as above: `set` is an updater now, so resolve it.
      const arg = typeof c[0] === "function" ? (c[0] as any)({}) : c[0];
      return arg && typeof arg === "object" && arg.lat === 48.85;
    });
    expect(committed).toBe(true);
  });

  it("a partial value (lone '-') keeps the field but leaves lat undefined", () => {
    const setForm = vi.fn();
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ", sessForm: emptyForm, setSessForm: setForm, data: geoData,
    });
    const lat = container.querySelector('input[placeholder="48.8566"]') as HTMLInputElement;
    fireEvent.change(lat, { target: { value: "-" } });
    expect(lat.value).toBe("-");
    const committed = setForm.mock.calls.some((c) => {
      const arg = c[0];
      return arg && typeof arg === "object" && arg.lat === undefined;
    });
    expect(committed).toBe(true);
  });
});

describe("SessionFormView — reverse-geocode address button", () => {
  const geoData2 = { tobaccos: [tobWithJar], pipes: [], accessories: [], sessions: [], wishlist: [] };

  it("'Mettre à jour l'adresse' fills Lieu / Commune / Pays from the entered coords", async () => {
    const setForm = vi.fn();
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "editJ", editSessId: "S1",
      sessForm: { ...emptyForm, tobaccoId: "T1", lat: 48.8566, lng: 2.3522 },
      setSessForm: setForm, data: geoData2, lang: "fr",
    });
    const btn = Array.from(container.querySelectorAll('[role="button"]'))
      .find((el) => /Mettre à jour|Update address|btn_refresh_address/i.test(el.textContent || ""));
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    await waitFor(() => {
      // refreshLocationName commits via a functional setForm updater.
      const fn = setForm.mock.calls.map((c) => c[0]).find((a) => typeof a === "function");
      expect(fn).toBeTruthy();
      const merged = (fn as (p: any) => any)({ lat: 48.8566, lng: 2.3522 });
      expect(merged.locationName).toBe("Café de Flore");
      expect(merged.locationCity).toBe("Paris");
      expect(merged.locationCountry).toBe("France");
    });
  });

  it("the address button is absent until coordinates are valid", () => {
    const { container } = renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ", sessForm: emptyForm, setSessForm: vi.fn(), data: geoData2,
    });
    const btn = Array.from(container.querySelectorAll('[role="button"]'))
      .find((el) => /Mettre à jour|Update address|btn_refresh_address/i.test(el.textContent || ""));
    expect(btn).toBeFalsy();
  });
});

describe("SessionFormView — accounting-off weight handling", () => {
  const tob = { id: "T1", brand: "Brackwater", name: "Duskfall", cut: "Ribbon", lots: [{ id: "L1", status: "jar", weightG: "50" }] };

  it("editJ: does NOT zero an existing session's recorded weight when accounting is off", () => {
    const setSessForm = vi.fn();
    renderWithCtx(<CuratorSessionFormView />, {
      view: "editJ",
      sessForm: { ...emptyForm, id: "J1", tobaccoId: "T1", pipeId: "", lotId: "L1", date: "2024-06-01", weightG: "3" },
      setSessForm,
      accountingEnabled: false, weightUnit: "g", sessDefaultWeight: "3",
      data: { tobaccos: [tob], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // zeroing on edit would reverse the lot deduction + wipe the
    // recorded weight on a notes-only edit — must not happen.
    const zeroed = setSessForm.mock.calls.some((c) => c[0] && c[0].weightG === "0");
    expect(zeroed).toBe(false);
  });

  it("addJ: still forces weightG to 0 when accounting is off", () => {
    const setSessForm = vi.fn();
    renderWithCtx(<CuratorSessionFormView />, {
      view: "addJ",
      sessForm: { ...emptyForm, tobaccoId: "T1", pipeId: "", lotId: "L1", date: "2024-06-01", weightG: "3" },
      setSessForm,
      accountingEnabled: false, weightUnit: "g", sessDefaultWeight: "3",
      data: { tobaccos: [tob], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const zeroed = setSessForm.mock.calls.some((c) => c[0] && c[0].weightG === "0");
    expect(zeroed).toBe(true);
  });
});

// LE BOUTON ENREGISTRER N'ÉTAIT JAMAIS TAPÉ — ce fichier ne contenait AUCUNE
// occurrence d'`addSession` ni d'`updateSession`.
//
// Une campagne de mutation sur les vues l'a mis en évidence : `SessionFormView`
// a rendu 0 mise à mort sur 10. Les cas existants rendent la vue, vérifient des
// pré-remplissages et des états `aria-disabled`, et n'exercent jamais l'écriture
// — d'où douze survivantes sur les trois formulaires, dont l'inversion
// ajout/édition, qui fait qu'éditer CRÉE un doublon et qu'ajouter ÉCRASE.
//
// Ce bloc tape le bouton.
describe("SessionFormView — le chemin d'écriture", () => {
  const dataWith = (tobs: any[]) => ({
    tobaccos: tobs, pipes: [{ id: "P1", brand: "Vondel", name: "Corvane", status: "active" }],
    sessions: [], accessories: [], wishlist: [],
  });
  const ready = { date: "2026-06-01", tobaccoId: "T1", pipeId: "P1", lotId: "L1", weightG: "2.5", duration: "40", rating: 4, notes: "" };

  const renderForm = (over: any) => renderWithCtx(<CuratorSessionFormView />, {
    view: "addJ",
    sessForm: ready,
    data: dataWith([tobWithJar]),
    accountingEnabled: true,
    ...over,
  } as any);

  it("Ajouter appelle addSession, jamais updateSession", () => {
    const add = vi.fn(); const upd = vi.fn();
    const { getByText } = renderForm({ view: "addJ", editSessId: null, addSession: add, updateSession: upd });
    fireEvent.click(getByText("btn_add"));
    expect(add).toHaveBeenCalledTimes(1);
    expect(upd).not.toHaveBeenCalled();
  });

  it("Enregistrer appelle updateSession, jamais addSession", () => {
    // L'inversion des deux est la survivante la plus coûteuse des trois
    // formulaires : en édition elle mint un nouvel `id` ET un nouvel `uid`,
    // donc la séance existe en double et son grammage est déduit une seconde
    // fois du lot.
    const add = vi.fn(); const upd = vi.fn();
    const { getByText } = renderForm({ view: "editJ", editSessId: "S1", addSession: add, updateSession: upd });
    fireEvent.click(getByText("btn_save"));
    expect(upd).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  // CHANGER DE TABAC ET LE LOT — un constat d'agent que j'ai VÉRIFIÉ et qui ne
  // tient pas, ce qui vaut d'être écrit ici.
  //
  // Le rapport de mutation présentait la suppression de `lotId: ""` dans le
  // patch comme une dérive de stock permanente et silencieuse : le lot du tabac
  // PRÉCÉDENT survivrait, la séance serait orpheline, les grammes ne sortiraient
  // d'aucune boîte. La conséquence est juste — c'est ce que produirait un
  // `lotId` étranger — mais l'état ne s'atteint pas.
  //
  // La couche absorbante est celle que CLAUDE.md documente déjà : `tobOptions`
  // n'inscrit un tabac que s'il a un lot UTILISABLE (ou, en édition, s'il est
  // celui déjà choisi), et `pickSessionLot` choisit précisément parmi ces
  // lots-là. Donc tout tabac qu'on peut ATTEINDRE dans la liste se voit
  // réattribuer un lot à lui dans la même passe, et la remise à zéro initiale
  // est écrasée avant d'avoir servi. C'est exactement la garantie « par
  // construction » pour laquelle `pickSessionLot` a été extrait.
  //
  // Il reste UNE différence observable, et c'est elle qui est épinglée : le
  // choix VIDE, où la branche `if (v)` ne s'exécute pas. Sans la remise à zéro,
  // le formulaire porterait un lot sans tabac. Le dégât reste borné —
  // `canSave` exige un tabac — mais l'état est incohérent et la ligne le ferme.
  it("choisir « aucun tabac » remet aussi le lot à zéro", () => {
    const setForm = vi.fn();
    const { container } = renderForm({ setSessForm: setForm });
    const select = container.querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    const calls = setForm.mock.calls.map((c) => c[0]).filter((p: any) => p && p.tobaccoId === "");
    expect(calls.length, "le choix vide n'a rien écrit").toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({ tobaccoId: "", lotId: "" });
  });

  it("changer de tabac réattribue un lot DU NOUVEAU tabac", () => {
    // La vraie garantie, celle qui empêche la dérive décrite plus haut : le lot
    // retenu appartient au tabac qu'on vient de choisir, jamais au précédent.
    const setForm = vi.fn();
    const other = {
      id: "T9", brand: "Aldwych", name: "Rivière Dorée",
      lots: [{ id: "L9", status: "jar", weightG: "30", dateOpened: "2025-02-01" }],
    };
    const { container } = renderForm({
      data: dataWith([tobWithJar, other]), setSessForm: setForm,
    });
    const select = container.querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "T9" } });
    const withTob = setForm.mock.calls.map((c) => c[0]).filter((p: any) => p && p.tobaccoId === "T9");
    expect(withTob.length, "le changement de tabac n'a rien écrit").toBe(1);
    expect(withTob[0]).toMatchObject({ tobaccoId: "T9", lotId: "L9" });
    // Et surtout : jamais le lot de l'ancien.
    expect(withTob[0].lotId).not.toBe("L1");
  });

  it("comptabilité activée, un poids nul interdit l'enregistrement", () => {
    // Le commentaire du garde nomme `pipeId` et le poids positif ; aucun cas
    // ne faisait varier ni l'un ni l'autre seul. Une séance à 0 g enregistrée
    // comptabilité activée ne fait bouger aucun stock.
    const add = vi.fn();
    const { getByText } = renderForm({ sessForm: { ...ready, weightG: "0" }, addSession: add });
    fireEvent.click(getByText("btn_add"));
    expect(add).not.toHaveBeenCalled();
  });

  it("comptabilité désactivée, le même poids nul l'autorise", () => {
    // Non-vacuité : en mode hors comptabilité le poids est forcé à « 0 » et le
    // champ est caché, donc bloquer là-dessus enfermerait l'utilisateur.
    const add = vi.fn();
    const { getByText } = renderForm({
      sessForm: { ...ready, weightG: "0" }, accountingEnabled: false, addSession: add,
    });
    fireEvent.click(getByText("btn_add"));
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("sans pipe, l'enregistrement est refusé", () => {
    const add = vi.fn();
    const { getByText } = renderForm({ sessForm: { ...ready, pipeId: "" }, addSession: add });
    fireEvent.click(getByText("btn_add"));
    expect(add).not.toHaveBeenCalled();
  });
});
