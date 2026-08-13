// Smoke tests for src/views/curator/PipesDetailView.tsx.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorPipesDetailView } from "../../views/curator/PipesDetailView";

const pipe = {
  id: "1", brand: "Halvorsen", name: "Sherlock Holmes",
  shape: "Bent Billiard", courbure: "Courbée",
  length: "150", weight: "55",
  chamberDiameter: "22", chamberDepth: "40",
  bowlMaterial: "Bruyère", stemMaterial: "Ébonite", finish: "Sablée",
  filterType: "9mm",
  datePurchased: "2024", dateProduction: "2023",
  price: "180", seller: "Pipe Shop",
  description: "", notes: "Comfortable smoker",
  imageUrl: "",
  rating: 4, status: "active",
};

describe("PipesDetailView — visibility", () => {
  it("returns null when view !== 'pipes'", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "home",
      pipeDet: pipe,
    });
    expect(container.firstChild).toBeNull();
  });

  it("returns null when pipeDet is null", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: null,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the pipe brand + name", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: pipe,
      data: { pipes: [pipe], sessions: [], tobaccos: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).toContain("Halvorsen");
    expect(container.textContent).toContain("Sherlock Holmes");
  });

  it("chamber diameter is rendered with 'mm' suffix (not lengthUnit)", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: pipe,
      data: { pipes: [pipe], sessions: [], tobaccos: [], accessories: [], wishlist: [] },
      lengthUnit: "in", // user prefers inches
    });
    // Chamber is stored in mm; display must keep mm regardless of user pref.
    expect(container.textContent).toMatch(/22 mm/);
    expect(container.textContent).toMatch(/40 mm/);
  });
});

describe("PipesDetailView — delete", () => {
  // The trash button now soft-deletes directly (Trash + undo).
  // No more window.confirm gate — the 30-day Trash + 8 s undo toast
  // is the safety net.
  it("calls deletePipe immediately without a confirm prompt", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const deletePipe = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: pipe,
      data: { pipes: [pipe], sessions: [], tobaccos: [], accessories: [], wishlist: [] },
      deletePipe,
    });
    const buttons = getAllByRole("button");
    const trash = buttons.find(b => /btn_delete|trash|Supprimer|Delete/i.test(b.getAttribute("aria-label") || ""));
    if (trash) {
      fireEvent.click(trash);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(deletePipe).toHaveBeenCalledWith("1");
    }
    confirmSpy.mockRestore();
  });
});

// ── description + notes split ─────────────────────────────────
// Earlier PipesDetailView rendered `« {p.notes || p.description} »` so a
// pipe with BOTH fields filled silently lost its description. An earlier release splits
// them into two distinct sections so both are always visible.

describe("PipesDetailView — description + notes both render", () => {
  it("renders BOTH description and notes when both are present", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: {
        ...pipe,
        description: "Vintage Halvorsen System Standard, 1980s production",
        notes: "Smokes a touch wet — wipe the bowl after each session",
      },
    });
    const txt = container.textContent || "";
    expect(txt).toContain("Vintage Halvorsen System Standard");
    expect(txt).toContain("Smokes a touch wet");
  });

  it("renders only description when notes is empty", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: {
        ...pipe,
        description: "Vintage Halvorsen System Standard",
        notes: "",
      },
    });
    const txt = container.textContent || "";
    expect(txt).toContain("Vintage Halvorsen System Standard");
  });

  it("renders only notes when description is empty (preserves the original italic callout)", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: {
        ...pipe,
        description: "",
        notes: "Smokes a touch wet",
      },
    });
    const txt = container.textContent || "";
    expect(txt).toContain("Smokes a touch wet");
  });

  it("renders neither block when both are empty", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: { ...pipe, description: "", notes: "" },
    });
    const txt = container.textContent || "";
    // Neither description nor notes content appears (the SectionHead
    // "Description" label only renders when p.description is truthy).
    expect(txt).not.toContain("Vintage");
    expect(txt).not.toContain("Smokes a touch wet");
  });
});

// ── Finish spec row ──────────────────────────────────────────
// The specs block now surfaces the pipe finish (Lisse / Rustiquée /
// Sablée / Autre) via a SpecRow, translated through xl() + FINISHES_EN.

describe("PipesDetailView — finish spec row", () => {
  it("shows the finish value in the specs block", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: { ...pipe, finish: "Sablée" },
    });
    // The mock xl() returns the FR value as-is.
    expect((container.textContent || "")).toContain("Sablée");
  });

  it("omits the finish value when unset (empty string)", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: { ...pipe, finish: "" },
    });
    // The SpecRow renders the label but no Sablée/Lisse/etc. value.
    const txt = container.textContent || "";
    expect(txt).not.toContain("Sablée");
    expect(txt).not.toContain("Rustiquée");
  });
});

describe("PipesDetailView — maintenance log", () => {
  it("renders the Carnet section + add button", () => {
    const pd = { ...pipe, maintenance: [] };
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: pd,
      data: { pipes: [pd], sessions: [], tobaccos: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).toContain("sec_maintenance");
    expect(container.textContent).toContain("maint_add");
  });

  it("lists existing entries with their kind badge, task pills + notes", () => {
    const pd = { ...pipe, maintenance: [{ id: 1, date: "2026-07-01", kind: "full", tasks: ["ream", "saltalcohol"], notes: "ramonage léger" }] };
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: pd,
      data: { pipes: [pd], sessions: [], tobaccos: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).toContain("maint_kind_full"); // kind badge
    expect(container.textContent).toContain("maint_task_ream"); // task pill
    expect(container.textContent).toContain("maint_task_saltalcohol");
    expect(container.textContent).toContain("ramonage léger");
  });

  it("groups by year/month, expands the latest month, keeps older months collapsed + newest-first within", () => {
    // Deliberately out of order in storage; two same-day entries + an older month.
    const pd = { ...pipe, maintenance: [
      { id: 1000, date: "2026-06-10", kind: "light", tasks: [], notes: "juin" },
      { id: 3000, date: "2026-07-18", kind: "full", tasks: [], notes: "recent-pm" },
      { id: 2000, date: "2026-07-18", kind: "light", tasks: [], notes: "recent-am" },
    ] };
    const { container, getByText } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: pd,
      data: { pipes: [pd], sessions: [], tobaccos: [], accessories: [], wishlist: [] },
    });
    const visibleNotes = () => Array.from(container.querySelectorAll("div"))
      .map((d) => (d.textContent || "").trim())
      .filter((tx) => /^(juin|recent-am|recent-pm)$/.test(tx));
    // Latest month (juillet) is expanded → its two entries show, newest-first
    // (same-day → higher id leads). The older month (juin) is collapsed → hidden.
    expect(visibleNotes()).toEqual(["recent-pm", "recent-am"]);
    // Expanding the older month (its short-month header, fr "Jun") reveals "juin".
    fireEvent.click(getByText("Jun")); // MONTHS_FR_SHORT[5]
    expect(visibleNotes()).toContain("juin");
  });

  it("date column sizes to content + never wraps (no overflow into the kind badge)", () => {
    // A fixed `width: 66` clipped nothing, so a long date (dd.mm.yyyy, worse
    // at the L text-size setting) overflowed onto the NETTOYAGE COMPLET badge.
    const pd = { ...pipe, maintenance: [{ id: 1, date: "2026-07-18", kind: "full", tasks: [], notes: "" }] };
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: pd,
      data: { pipes: [pd], sessions: [], tobaccos: [], accessories: [], wishlist: [] },
    });
    const dateCell = Array.from(container.querySelectorAll("div")).find(
      (d) => /\d{2}\.\d{2}\.\d{4}/.test(d.textContent || "") && (d.textContent || "").trim().length < 12,
    ) as HTMLElement | undefined;
    expect(dateCell).toBeTruthy();
    expect(dateCell!.style.whiteSpace).toBe("nowrap");
    expect(dateCell!.style.width).toBe(""); // no fixed width → column grows with the date
    expect(dateCell!.style.minWidth).toBe("66px");
  });

  it("Add opens the modal and saving calls addMaintenance with today + default kind", () => {
    const addMaintenance = vi.fn();
    const pd = { ...pipe, maintenance: [] };
    const { container, getByText } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: pd, addMaintenance,
      data: { pipes: [pd], sessions: [], tobaccos: [], accessories: [], wishlist: [] },
    });
    fireEvent.click(getByText("maint_add"));
    // Modal is open — the kind-field label is visible.
    expect(container.textContent).toContain("maint_kind_label");
    // The modal's primary action reads "btn_add" (distinct from the section's "maint_add").
    fireEvent.click(getByText("btn_add"));
    expect(addMaintenance).toHaveBeenCalledTimes(1);
    const call = addMaintenance.mock.calls[0]!;
    expect(String(call[0])).toBe("1");
    expect(call[1].kind).toBe("light");   // default kind
    expect(call[1].tasks).toEqual([]);
    expect(call[1].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("PipesDetailView — maintenance reminder", () => {
  it("shows the maintenance-due Notice when the pipe is overdue", () => {
    const pd = { ...pipe, maintenance: [] };
    const sessions = Array.from({ length: 10 }, (_, i) => ({ id: i, pipeId: pipe.id, date: "2026-06-01" }));
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: pd,
      data: { pipes: [pd], sessions, tobaccos: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).toContain("maint_never"); // 10 sessions, never cleaned
  });

  it("does not show the Notice below the threshold", () => {
    const pd = { ...pipe, maintenance: [] };
    const sessions = Array.from({ length: 3 }, (_, i) => ({ id: i, pipeId: pipe.id, date: "2026-06-01" }));
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: pd,
      data: { pipes: [pd], sessions, tobaccos: [], accessories: [], wishlist: [] },
    });
    expect(container.textContent).not.toContain("maint_never");
    expect(container.textContent).not.toContain("maint_since");
  });
});

// tapping a "Top tabacs fumés ici" row must open the tobacco
// fiche (mirror of the tobacco-detail top-pipes fix — was an inert div).
describe("PipesDetailView — top-tobaccos row navigates to the tobacco", () => {
  const tob = { id: "5", brand: "Brackwater", name: "Duskfall", category: "Anglais", lots: [] };
  const sessions = [
    { id: 1, tobaccoId: "5", pipeId: "1", weightG: "3" },
    { id: 2, tobaccoId: "5", pipeId: "1", weightG: "3" },
  ];

  it("clicking a top-tobacco row cross-opens the tobacco fiche", () => {
    const crossOpenDetail = vi.fn();
    const { getByText } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: pipe,
      data: { pipes: [pipe], tobaccos: [tob], accessories: [], wishlist: [], sessions },
      crossOpenDetail,
    });
    const row = getByText("Duskfall").closest("button") || getByText("Duskfall").closest("[role='button']");
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLElement);
    expect(crossOpenDetail).toHaveBeenCalledWith({ view: "inv", kind: "tobacco", obj: tob });
  });
});

// tapping a "Familles fumées" bar opens the tobacco inventory
// filtered to that category (was an inert div). navToInvFiltered
// now owns the state clearing + back-origin recording, so the handler only
// calls it (no separate setPipeDet(null)).
describe("PipesDetailView — family bar filters the tobacco inventory", () => {
  const tobA = { id: "9", brand: "Pellworm", name: "Vanilla", category: "Aromatique", lots: [] };
  const sessions = [
    { id: 1, tobaccoId: "9", pipeId: "1", weightG: "3" },
    { id: 2, tobaccoId: "9", pipeId: "1", weightG: "3" },
    { id: 3, tobaccoId: "9", pipeId: "1", weightG: "3" },
  ];

  it("clicking a family bar calls navToInvFiltered(category)", () => {
    const navToInvFiltered = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes",
      pipeDet: pipe,
      data: { pipes: [pipe], tobaccos: [tobA], accessories: [], wishlist: [], sessions },
      navToInvFiltered,
    });
    const famRow = getAllByRole("button").find(b => /Aromatique/.test(b.textContent || ""));
    expect(famRow).toBeTruthy();
    fireEvent.click(famRow!);
    expect(navToInvFiltered).toHaveBeenCalledWith("Aromatique", null);
  });
});

// The additional-photos gallery (loaded on demand). Renders one
// tappable thumbnail per photo key; tapping opens the lightbox.
describe("PipesDetailView — additional photos gallery", () => {
  it("renders a thumbnail per photo and opens the lightbox on tap", () => {
    const setLightbox = vi.fn();
    const withPhotos = { ...pipe, photos: ["local-photo-a", "local-photo-b"] };
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: withPhotos, setLightbox,
      data: { pipes: [withPhotos], tobaccos: [], accessories: [], wishlist: [], sessions: [] },
    });
    const thumbs = Array.from(container.querySelectorAll("button"))
      // was the hardcoded "Photo"; now t("lbl_image") (mockT → key).
      .filter((b) => (b.getAttribute("aria-label") || "") === "lbl_image");
    expect(thumbs.length).toBe(2);
    fireEvent.click(thumbs[0]!);
    expect(setLightbox).toHaveBeenCalledWith("local-photo-a");
  });

  it("renders no gallery when the pipe has no extra photos", () => {
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: pipe,
      data: { pipes: [pipe], tobaccos: [], accessories: [], wishlist: [], sessions: [] },
    });
    const thumbs = Array.from(container.querySelectorAll("button"))
      // was the hardcoded "Photo"; now t("lbl_image") (mockT → key).
      .filter((b) => (b.getAttribute("aria-label") || "") === "lbl_image");
    expect(thumbs.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// The HERO photo must be a real control.
//
// It was a bare `<div onClick>`: no role, no tabIndex, no key handler. The small
// extra-photo thumbnails one scroll below have always been real <button>s, so a
// keyboard or switch user could open every SMALL photo and not the big one, and
// a screen reader was never told the hero was actionable. Three fiches shared
// the defect (pipe / accessory / tobacco).
//
// jest-axe has no rule for `div[onClick]`, which is exactly how this survived a
// hand a11y audit — hence an explicit test.
// ─────────────────────────────────────────────────────────────
describe("PipesDetailView — hero photo is keyboard-operable", () => {
  const withPhoto = { ...pipe, imageUrl: "local-photo-hero" };

  it("exposes the hero as a focusable button and opens the lightbox with Enter", () => {
    const setLightbox = vi.fn();
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: withPhoto, setLightbox,
      data: { pipes: [withPhoto], tobaccos: [], accessories: [], wishlist: [], sessions: [] },
    });
    const hero = Array.from(container.querySelectorAll('[role="button"]'))
      .find((el) => (el as HTMLElement).style.height === "220px");
    expect(hero, "the 220px hero should be a role=button").toBeTruthy();
    expect(hero!.getAttribute("tabindex")).toBe("0");
    // Keyboard activation — the whole point of the fix.
    fireEvent.keyDown(hero!, { key: "Enter" });
    expect(setLightbox).toHaveBeenCalledWith("local-photo-hero");
  });

  it("stays inert (not a button) when the pipe has no photo", () => {
    const setLightbox = vi.fn();
    const { container } = renderWithCtx(<CuratorPipesDetailView />, {
      view: "pipes", pipeDet: { ...pipe, imageUrl: "" }, setLightbox,
      data: { pipes: [pipe], tobaccos: [], accessories: [], wishlist: [], sessions: [] },
    });
    const hero = Array.from(container.querySelectorAll("*"))
      .find((el) => (el as HTMLElement).style && (el as HTMLElement).style.height === "220px");
    expect(hero, "the hero placeholder still renders").toBeTruthy();
    expect(hero!.getAttribute("role"), "no photo → not a button").toBeNull();
  });
});
