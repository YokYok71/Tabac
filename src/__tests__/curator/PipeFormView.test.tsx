// Smoke tests for src/views/curator/PipeFormView.tsx.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorPipeFormView } from "../../views/curator/PipeFormView";

const emptyPipe = {
  name: "", brand: "", shape: "", courbure: "",
  length: "", weight: "", chamberDiameter: "", chamberDepth: "",
  bowlMaterial: "", stemMaterial: "", finish: "", filterType: "",
  datePurchased: "", dateProduction: "", price: "", seller: "",
  description: "", notes: "", imageUrl: "", rating: 0, status: "active",
};

describe("PipeFormView — visibility", () => {
  it("returns null when view !== 'addP' / 'editP'", () => {
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "home",
      pipeForm: emptyPipe,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders when view === 'addP'", () => {
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP",
      pipeForm: emptyPipe,
      setPipeForm: vi.fn(),
    });
    expect(container.firstChild).toBeTruthy();
  });
});

describe("PipeFormView — required-field gate", () => {
  it("Save disabled when both brand and name empty", () => {
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP",
      pipeForm: emptyPipe,
      setPipeForm: vi.fn(),
    });
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|Ajouter|Add/i.test(b.textContent || ""));
    expect(saveBtn?.getAttribute("aria-disabled")).toBe("true");
  });

  it("Save enabled when both brand and name filled", () => {
    const filled = { ...emptyPipe, brand: "Halvorsen", name: "Sherlock Holmes" };
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP",
      pipeForm: filled,
      setPipeForm: vi.fn(),
    });
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|Ajouter|Add/i.test(b.textContent || ""));
    expect(saveBtn?.getAttribute("aria-disabled")).toBe("false");
  });
});

// ── Finish select ────────────────────────────────────────────
// New "Finition" SelectField in the Materials section. Tight enum
// (Lisse / Rustiquée / Sablée / Autre) wired through xl() + FINISHES_EN
// exactly like the bowl / stem material selects.

describe("PipeFormView — finish field", () => {
  it("renders the finish select with the four FINISHES options", () => {
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP",
      pipeForm: emptyPipe,
      setPipeForm: vi.fn(),
    });
    // The mock xl() returns the FR value as-is, so the option labels are
    // the canonical FR strings.
    const optionTexts = Array.from(container.querySelectorAll("option"))
      .map(o => (o.textContent || "").trim());
    expect(optionTexts).toContain("Lisse");
    expect(optionTexts).toContain("Rustiquée");
    expect(optionTexts).toContain("Sablée");
    expect(optionTexts).toContain("Teintée");
    expect(optionTexts).toContain("Autre");
  });

  it("reflects the current finish value on the select", () => {
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "editP",
      pipeForm: { ...emptyPipe, brand: "Brackwater", name: "Shell", finish: "Sablée" },
      setPipeForm: vi.fn(),
    });
    // Find the select whose current value is the finish.
    const selects = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[];
    const finishSelect = selects.find(s => s.value === "Sablée");
    expect(finishSelect).toBeTruthy();
  });
});

describe("PipeFormView — chamber dims unit", () => {
  it("chamber diameter / depth fields use 'mm' regardless of lengthUnit", () => {
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP",
      pipeForm: emptyPipe,
      setPipeForm: vi.fn(),
      lengthUnit: "in",
    });
    // Labels should contain "(mm)" for chamber dims even when user prefers in.
    const text = container.textContent || "";
    const occurrences = (text.match(/\(mm\)/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

// ── Filter select extension ──────────────────────────────────
// FILTERS extended with Métal + Hybride 6mm + Hybride 9mm. The 3 new
// FR-canonical entries map to English labels in EN mode via FILTERS_EN.

describe("PipeFormView — filter options", () => {
  it("renders the 7 filter options including the new Métal / Hybride entries", () => {
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP",
      pipeForm: emptyPipe,
      setPipeForm: vi.fn(),
    });
    const optionTexts = Array.from(container.querySelectorAll("option"))
      .map(o => (o.textContent || "").trim());
    expect(optionTexts).toContain("9mm");
    expect(optionTexts).toContain("6mm");
    expect(optionTexts).toContain("Balsa");
    expect(optionTexts).toContain("Métal");
    expect(optionTexts).toContain("Hybride 6mm");
    expect(optionTexts).toContain("Hybride 9mm");
    expect(optionTexts).toContain("Autre");
  });

  it("shows English labels in EN mode for Métal / Hybride / Autre", () => {
    // Real-ish xl() that respects both maps — mirrors App.tsx.
    const enXl = (v: any, enMap: any) => {
      if (!v) return v;
      return (enMap && enMap[v]) || v;
    };
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP",
      pipeForm: emptyPipe,
      setPipeForm: vi.fn(),
      lang: "en",
      xl: enXl,
    });
    const optionTexts = Array.from(container.querySelectorAll("option"))
      .map(o => (o.textContent || "").trim());
    // FR-canonical entries get their English labels
    expect(optionTexts).toContain("Metal");
    expect(optionTexts).toContain("Hybrid 6mm");
    expect(optionTexts).toContain("Hybrid 9mm");
    expect(optionTexts).toContain("Other");
    // Universal entries stay as-is
    expect(optionTexts).toContain("9mm");
    expect(optionTexts).toContain("Balsa");
    // No FR slip-through
    expect(optionTexts).not.toContain("Métal");
    expect(optionTexts).not.toContain("Hybride 6mm");
    expect(optionTexts).not.toContain("Autre");
  });
});

// additional pipe photos.
describe("PipeFormView — additional photos", () => {
  it("renders the 'add photo' control", () => {
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP", pipeForm: { ...emptyPipe, photos: [] }, setPipeForm: vi.fn(),
    });
    const add = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.getAttribute("aria-label") || "").includes("lbl_pipe_add_photo"));
    expect(add).toBeTruthy();
  });

  it("shows a remove control per existing photo and drops it from photos on click", () => {
    const setPipeForm = vi.fn();
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "editP", editPipeId: 1,
      pipeForm: { ...emptyPipe, id: 1, photos: ["local-photo-1", "local-photo-2"] },
      setPipeForm,
    });
    const removeBtns = Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.getAttribute("aria-label") || "").includes("btn_remove_photo"));
    expect(removeBtns.length).toBe(2);
    fireEvent.click(removeBtns[0]!);
    // setPipeForm is called with an updater; apply it to check the result.
    const calls = setPipeForm.mock.calls;
    const updater = calls[calls.length - 1]![0];
    const next = typeof updater === "function"
      ? updater({ ...emptyPipe, id: 1, photos: ["local-photo-1", "local-photo-2"] })
      : updater;
    expect(next.photos).toEqual(["local-photo-2"]);
  });
});

// tag / collection editor on pipes.
describe("PipeFormView — tag editor", () => {
  it("adds a typed tag through setPipeForm (sanitised)", () => {
    const setPipeForm = vi.fn();
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP", pipeForm: { ...emptyPipe, tags: [] }, setPipeForm,
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const input = Array.from(container.querySelectorAll("input"))
      .find((i) => (i.getAttribute("aria-label") || "").includes("tag_add_label")) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "  Vitrine  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    const c = setPipeForm.mock.calls; const patch = c[c.length - 1]![0];
    const next = typeof patch === "function" ? patch({ ...emptyPipe, tags: [] }) : patch;
    expect(next.tags).toEqual(["Vitrine"]);
  });
});

// An extra pipe photo whose IndexedDB write failed (handlePhotoUpload
// returns a data-URL as the key) must NOT be added to photos[] (it would vanish
// on reload) — instead an error is surfaced.
describe("PipeFormView — extra photo persistence guard", () => {
  it("does not add a non-local key and surfaces the error", () => {
    const setPipeForm = vi.fn();
    const setPhotoErr = vi.fn();
    // Simulate the IndexedDB-failure path: cb(du, du) with a data-URL key.
    const handlePhotoUpload = vi.fn((cb: any) => cb("data:image/jpeg;base64,AAA", "data:image/jpeg;base64,AAA"));
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP", pipeForm: { ...emptyPipe, photos: [] }, setPipeForm,
      handlePhotoUpload, setPhotoErr,
    });
    const add = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.getAttribute("aria-label") || "").includes("lbl_pipe_add_photo"))!;
    fireEvent.click(add);
    // photos[] not mutated (no setPipeForm call that adds the data-URL)
    const addedDataUrl = setPipeForm.mock.calls.some((c: any[]) => {
      const patch = c[0];
      const next = typeof patch === "function" ? patch({ ...emptyPipe, photos: [] }) : patch;
      return Array.isArray(next?.photos) && next.photos.some((k: string) => k.indexOf("data:") === 0);
    });
    expect(addedDataUrl).toBe(false);
    expect(setPhotoErr).toHaveBeenCalled();
  });

  it("adds a real local-photo key normally", () => {
    const setPipeForm = vi.fn();
    const handlePhotoUpload = vi.fn((cb: any) => cb("local-photo-123", "data:image/jpeg;base64,AAA"));
    const { container } = renderWithCtx(<CuratorPipeFormView />, {
      view: "addP", pipeForm: { ...emptyPipe, photos: [] }, setPipeForm,
      handlePhotoUpload, setPhotoErr: vi.fn(),
    });
    const add = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.getAttribute("aria-label") || "").includes("lbl_pipe_add_photo"))!;
    fireEvent.click(add);
    const c = setPipeForm.mock.calls; const patch = c[c.length - 1]![0];
    const next = typeof patch === "function" ? patch({ ...emptyPipe, photos: [] }) : patch;
    expect(next.photos).toEqual(["local-photo-123"]);
  });
});
