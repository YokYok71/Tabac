// Smoke tests for src/views/curator/AccessoryFormView.tsx.

import { describe, it, expect, vi } from "vitest";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorAccessoryFormView } from "../../views/curator/AccessoryFormView";

const emptyAcc = {
  name: "", brand: "", type: "Autre", fuel: "",
  datePurchased: "", price: "", seller: "",
  imageUrl: "", rating: 0, notes: "", status: "active",
};

describe("AccessoryFormView — visibility", () => {
  it("returns null when view !== 'addA' / 'editA'", () => {
    const { container } = renderWithCtx(<CuratorAccessoryFormView />, {
      view: "home",
      accForm: emptyAcc,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders when view === 'addA'", () => {
    const { container } = renderWithCtx(<CuratorAccessoryFormView />, {
      view: "addA",
      accForm: emptyAcc,
      setAccForm: vi.fn(),
    });
    expect(container.firstChild).toBeTruthy();
  });
});

describe("AccessoryFormView — fuel field gating", () => {
  it("shows the fuel select only when type === 'Briquet'", () => {
    const { container, rerender } = renderWithCtx(<CuratorAccessoryFormView />, {
      view: "addA",
      accForm: { ...emptyAcc, type: "Bourre-pipe" },
      setAccForm: vi.fn(),
    });
    // No "Combustible" label visible
    expect(container.textContent).not.toMatch(/Combustible|Fuel|lbl_fuel/);
    rerender(<CuratorAccessoryFormView />);
  });

  it("shows the fuel select when type === 'Briquet'", () => {
    const { container } = renderWithCtx(<CuratorAccessoryFormView />, {
      view: "addA",
      accForm: { ...emptyAcc, type: "Briquet" },
      setAccForm: vi.fn(),
    });
    expect(container.textContent).toMatch(/Combustible|Fuel|lbl_fuel/);
  });
});

describe("AccessoryFormView — Save gate", () => {
  it("Save enabled when at least brand or name is filled", () => {
    const { container } = renderWithCtx(<CuratorAccessoryFormView />, {
      view: "addA",
      accForm: { ...emptyAcc, brand: "Zippo" },
      setAccForm: vi.fn(),
    });
    const save = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|Ajouter|Add/i.test(b.textContent || ""));
    expect(save?.getAttribute("aria-disabled")).toBe("false");
  });
});

// tag / collection editor on accessories.
import { fireEvent } from "@testing-library/react";
describe("AccessoryFormView — tag editor", () => {
  it("adds a typed tag through setAccForm (sanitised)", () => {
    const setAccForm = vi.fn();
    const { container } = renderWithCtx(<CuratorAccessoryFormView />, {
      view: "addA", accForm: { ...emptyAcc, tags: [] }, setAccForm,
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const input = Array.from(container.querySelectorAll("input"))
      .find((i) => (i.getAttribute("aria-label") || "").includes("tag_add_label")) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "  Bureau  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    const c = setAccForm.mock.calls; const patch = c[c.length - 1]![0];
    const next = typeof patch === "function" ? patch({ ...emptyAcc, tags: [] }) : patch;
    expect(next.tags).toEqual(["Bureau"]);
  });

  it("suggests an existing accessory tag", () => {
    const { container } = renderWithCtx(<CuratorAccessoryFormView />, {
      view: "addA", accForm: { ...emptyAcc, tags: [] }, setAccForm: vi.fn(),
      data: { tobaccos: [], pipes: [], accessories: [{ id: 1, tags: ["voyage"] }], sessions: [], wishlist: [] },
    });
    // The reuse suggestions fold away by default — open the
    // disclosure first. The suggestion itself is what this test is about.
    fireEvent.click(container.querySelector("[aria-expanded]") as HTMLElement);
    const sugg = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.textContent || "").includes("voyage"));
    expect(sugg).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Le bouton Enregistrer n'était jamais tapé — pour la QUATRIÈME fois.
//
// Une campagne antérieure a fermé exactement ce trou dans trois formulaires
// (séance, tabac, pipe) : ces suites rendaient la vue, vérifiaient des
// pré-remplissages et des états `aria-disabled`, et n'exerçaient jamais
// l'écriture. Les DEUX qui restaient — accessoire et envie — sont ici, et le
// fichier ne contenait aucune occurrence d'`addAccessory` ni
// d'`updateAccessory`.
//
// Ce que cela laissait passer tient en une ligne : `(isEdit ? updateAccessory
// : addAccessory)()` inversé. **Modifier CRÉE un doublon** — nouvel `id`,
// nouvel `uid`, donc une seconde identité de fusion inter-appareils — et
// **ajouter ÉCRASE**. Aucun invariant ne le voit : les deux résultats sont des
// données parfaitement valides.
describe("AccessoryFormView — l'écriture", () => {
  const filled = { ...emptyAcc, brand: "Marlow & Finch", name: "Bourre-pipe" };

  function form(over: Record<string, any> = {}) {
    const ctx: Record<string, any> = {
      view: "addA",
      accForm: filled,
      setAccForm: vi.fn(),
      BA: emptyAcc,
      addAccessory: vi.fn(),
      updateAccessory: vi.fn(),
      nav: vi.fn(),
      currencySymbol: "€",
      ...over,
    };
    return { ctx, ...renderWithCtx(<CuratorAccessoryFormView />, ctx) };
  }

  function saveBtn(container: HTMLElement) {
    return Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|btn_save/.test(b.textContent || ""));
  }

  it("en AJOUT, le bouton crée — il ne met pas à jour", () => {
    const { ctx, container } = form();
    const btn = saveBtn(container as HTMLElement);
    expect(btn, "le bouton d'enregistrement doit être rendu").toBeTruthy();
    fireEvent.click(btn!);
    expect(ctx.addAccessory).toHaveBeenCalledTimes(1);
    expect(ctx.updateAccessory, "écraser une autre fiche").not.toHaveBeenCalled();
  });

  it("en ÉDITION, le bouton met à jour — il ne crée pas", () => {
    const { ctx, container } = form({ view: "editA" });
    fireEvent.click(saveBtn(container as HTMLElement)!);
    expect(ctx.updateAccessory).toHaveBeenCalledTimes(1);
    expect(ctx.addAccessory,
      "créer ici duplique la fiche ET son uid de fusion").not.toHaveBeenCalled();
  });

  it("sans identité, le bouton est inerte et l'ANNONCE", () => {
    // `canSave` est `brand || name` : le contre-cas qui empêche de « corriger »
    // les deux précédents en appelant l'écriture inconditionnellement.
    const { ctx, container } = form({ accForm: emptyAcc });
    const btn = saveBtn(container as HTMLElement);
    expect(btn!.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn!);
    expect(ctx.addAccessory).not.toHaveBeenCalled();
    expect(ctx.updateAccessory).not.toHaveBeenCalled();
  });
});
