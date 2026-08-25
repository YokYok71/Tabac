// Smoke tests for src/views/curator/LotFormModal.tsx.
//
// Coverage focus (fix + business logic):
//   - New lot: boxNumber prefilled with max+1 across all existing lots
//   - Edit lot: form pre-filled from data.lot
//   - Status change auto-fills dateOpened / dateFinished

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorLotFormModal } from "../../views/curator/LotFormModal";

function mkLot(over: Partial<any>): any {
  return {
    id: "", status: "cellar", weightG: "50",
    datePurchased: "", dateProduction: "", dateOpened: "", dateFinished: "",
    boxNumber: "", price: "", seller: "", disposed: false,
    ...over,
  };
}
function mkTob(over: Partial<any>): any {
  return {
    id: "", brand: "", name: "", category: "", blend: "", cut: "",
    force: 0, roomNote: 0, taste: 0, rating: 0, rebuy: null,
    tastingNotes: "", description: "", imageUrl: "", agingMax: "",
    lots: [],
    ...over,
  };
}

const tob1 = mkTob({
  id: "1", brand: "Brackwater", name: "Duskfall",
  lots: [
    mkLot({ id: "L1", boxNumber: "3", weightG: "50", status: "cellar" }),
    mkLot({ id: "L2", boxNumber: "7", weightG: "100", status: "cellar" }),
  ],
});
const tob2 = mkTob({
  id: "2", brand: "G.L. Pease", name: "Westminster",
  lots: [
    mkLot({ id: "L3", boxNumber: "12", weightG: "100", status: "jar", dateOpened: "2024-01-15" }),
  ],
});

describe("LotFormModal — visibility", () => {
  it("renders nothing when open is false", () => {
    const { container } = renderWithCtx(
      <CuratorLotFormModal open={false} data={null} onClose={() => {}} onSave={() => {}} />,
      {},
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the dialog when open=true with new-lot data", () => {
    const { container } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1 }}
        onClose={() => {}}
        onSave={() => {}}
      />,
      {
        data: { tobaccos: [tob1, tob2], pipes: [], accessories: [], sessions: [], wishlist: [] },
      },
    );
    expect(container.querySelector("[role='dialog']")).toBeTruthy();
  });
});

describe("LotFormModal — boxNumber prefill", () => {
  it("new lot: boxNumber pre-filled with max+1 across ALL tobaccos", () => {
    const { container } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1 }}
        onClose={() => {}}
        onSave={() => {}}
      />,
      {
        data: { tobaccos: [tob1, tob2], pipes: [], accessories: [], sessions: [], wishlist: [] },
      },
    );
    // Max existing boxNumber is 12 (from tob2), so new should be 13.
    const inputs = container.querySelectorAll("input");
    const boxNumberInput = Array.from(inputs).find(i =>
      /N° de boîte|Box #|lbl_box_num/i.test(
        (i.previousElementSibling?.textContent || "") +
        " " +
        (i.getAttribute("aria-label") || ""),
      ),
    ) as HTMLInputElement | undefined;
    if (boxNumberInput) {
      expect(boxNumberInput.value).toBe("13");
    } else {
      // Fallback: find the box-number value in any input
      const has13 = Array.from(inputs).some(i => (i as HTMLInputElement).value === "13");
      expect(has13).toBe(true);
    }
  });

  it("edit lot: form is pre-filled with the lot's existing values, not max+1", () => {
    const existingLot = tob1.lots[0];
    const { container } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1, lot: existingLot, idx: 0 }}
        onClose={() => {}}
        onSave={() => {}}
      />,
      {
        data: { tobaccos: [tob1, tob2], pipes: [], accessories: [], sessions: [], wishlist: [] },
      },
    );
    // Edit mode should keep boxNumber = "3" (existing value).
    const inputs = container.querySelectorAll("input");
    const has3 = Array.from(inputs).some(i => (i as HTMLInputElement).value === "3");
    expect(has3).toBe(true);
  });
});

describe("LotFormModal — bulk quantity", () => {
  it("shows a quantity field (default 1) in add mode and passes the count to onSave", () => {
    const onSave = vi.fn();
    const { container, getAllByRole } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1 }}
        onClose={() => {}}
        onSave={onSave}
      />,
      { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
    );
    // The quantity input is the only one capped at max=50.
    const qty = container.querySelector('input[max="50"]') as HTMLInputElement;
    expect(qty).toBeTruthy();
    expect(qty.value).toBe("1");
    fireEvent.change(qty, { target: { value: "3" } });
    const addBtn = getAllByRole("button").find(b => /lot_add_n|btn_add|Ajouter/.test(b.textContent || ""));
    fireEvent.click(addBtn!);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![1]).toBe(3);
  });

  it("lets the user clear the quantity field and retype (no snap-back to 1)", () => {
    const onSave = vi.fn();
    const { container, getAllByRole } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1 }}
        onClose={() => {}}
        onSave={onSave}
      />,
      { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
    );
    const qty = container.querySelector('input[max="50"]') as HTMLInputElement;
    // Clearing the field must leave it EMPTY (the old numeric state snapped it
    // back to "1" so the user "couldn't erase the 1").
    fireEvent.change(qty, { target: { value: "" } });
    expect(qty.value).toBe("");
    // Retype a new value.
    fireEvent.change(qty, { target: { value: "5" } });
    expect(qty.value).toBe("5");
    const addBtn = getAllByRole("button").find(b => /lot_add_n|btn_add|Ajouter/.test(b.textContent || ""));
    fireEvent.click(addBtn!);
    expect(onSave.mock.calls[0]![1]).toBe(5);
  });

  it("an empty quantity at save falls back to 1 lot", () => {
    const onSave = vi.fn();
    const { container, getAllByRole } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1 }}
        onClose={() => {}}
        onSave={onSave}
      />,
      { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
    );
    const qty = container.querySelector('input[max="50"]') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "" } });
    const addBtn = getAllByRole("button").find(b => /lot_add_n|btn_add|Ajouter/.test(b.textContent || ""));
    fireEvent.click(addBtn!);
    expect(onSave.mock.calls[0]![1]).toBe(1);
  });

  it("does NOT show the quantity field in edit mode and passes count 1", () => {
    const onSave = vi.fn();
    const { container, getAllByRole } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1, lot: tob1.lots[0], idx: 0 }}
        onClose={() => {}}
        onSave={onSave}
      />,
      { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
    );
    expect(container.querySelector('input[max="50"]')).toBeNull();
    const saveBtn = getAllByRole("button").find(b => /btn_save|Enregistrer/.test(b.textContent || ""));
    fireEvent.click(saveBtn!);
    expect(onSave.mock.calls[0]![1]).toBe(1);
  });

  // The modal moved Save into a sticky top bar and replaced the
  // "Annuler" secondary button with the top-bar X (close). No cancel button.
  it("has no 'Annuler' / btn_cancel button (X in the top bar replaces it)", () => {
    const { getAllByRole } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1, lot: tob1.lots[0], idx: 0 }}
        onClose={() => {}}
        onSave={() => {}}
      />,
      { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
    );
    const cancel = getAllByRole("button").find(b => /btn_cancel|Annuler/.test(b.textContent || ""));
    expect(cancel).toBeUndefined();
    // The close affordance (X) is present via its aria-label.
    const close = getAllByRole("button").find(b => /btn_close|Fermer/.test(b.getAttribute("aria-label") || ""));
    expect(close).toBeTruthy();
  });
});

describe("LotFormModal — duplicate", () => {
  it("shows a Duplicate action in edit mode and fires onDuplicate with the form", () => {
    const onDuplicate = vi.fn();
    const { getAllByRole } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1, lot: tob1.lots[0], idx: 0 }}
        onClose={() => {}}
        onSave={() => {}}
        onDuplicate={onDuplicate}
      />,
      { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
    );
    const dupBtn = getAllByRole("button").find(b => /lot_duplicate|Dupliquer/.test(b.textContent || ""));
    expect(dupBtn).toBeTruthy();
    fireEvent.click(dupBtn!);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    // The current form (the existing lot) is passed.
    expect(onDuplicate.mock.calls[0]![0].boxNumber).toBe("3");
  });

  it("does NOT show the Duplicate action in add mode", () => {
    const { getAllByRole } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1 }}
        onClose={() => {}}
        onSave={() => {}}
        onDuplicate={vi.fn()}
      />,
      { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
    );
    const dupBtn = getAllByRole("button").find(b => /lot_duplicate|Dupliquer/.test(b.textContent || ""));
    expect(dupBtn).toBeFalsy();
  });
});

describe("LotFormModal — close", () => {
  it("clicking the backdrop calls onClose", () => {
    const onClose = vi.fn();
    const { container } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1 }}
        onClose={onClose}
        onSave={() => {}}
      />,
      {
        data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] },
      },
    );
    const dialog = container.querySelector("[role='dialog']");
    const backdrop = dialog?.parentElement;
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("LotFormModal — storage location", () => {
  it("renders the storage-location field and forwards the typed value to onSave", () => {
    const onSave = vi.fn();
    const { container, getAllByRole } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1 }}
        onClose={() => {}}
        onSave={onSave}
      />,
      {},
    );
    const inputs = container.querySelectorAll("input");
    const locInput = Array.from(inputs).find(i =>
      /Armoire|storage_location_placeholder/.test(i.getAttribute("placeholder") || ""),
    ) as HTMLInputElement;
    expect(locInput).toBeTruthy();
    fireEvent.change(locInput, { target: { value: "Armoire B · étagère 1" } });
    const saveBtn = getAllByRole("button").find(b =>
      /btn_add|btn_save|Ajouter|Enregistrer/.test(b.textContent || ""),
    );
    expect(saveBtn).toBeTruthy();
    fireEvent.click(saveBtn!);
    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0]![0].storageLocation).toBe("Armoire B · étagère 1");
  });

  it("edit mode pre-fills the existing storage location", () => {
    const lot = mkLot({ id: "L9", boxNumber: "4", storageLocation: "Cave du garage" });
    const { container } = renderWithCtx(
      <CuratorLotFormModal
        open={true}
        data={{ tobacco: tob1, lot, idx: 0 }}
        onClose={() => {}}
        onSave={() => {}}
      />,
      {},
    );
    const locInput = Array.from(container.querySelectorAll("input")).find(i =>
      (i as HTMLInputElement).value === "Cave du garage",
    );
    expect(locInput).toBeTruthy();
  });
});

// DEUX SURVIVANTES DE MUTATION, dont une qui viole un invariant à CHAQUE
// création de lot et une qui double le stock au lieu de le supprimer.
//
// (1) LE MIROIR `weightG ← weightInitial`. À la création, le champ « poids
// actuel » est caché : seul le poids INITIAL est demandé, et le solde doit être
// mis à la même valeur. Le garde aval ne rattrape PAS — `addLotToTobacco` ne
// recopie que `if (!base.weightG && base.weightInitial)`, or `BL.weightG` vaut
// « 50 », donc toujours vrai. Sans le miroir, tout nouveau lot naît avec un
// poids déclaré et un solde de 50 g : violation `lot-balance` immédiate à
// chaque création, plus un stock inventé.
//
// (2) LE BOUTON SUPPRIMER. Ce fichier ne passait JAMAIS de prop `onDelete` —
// vingt-huit mentions d'`onSave`/`onDuplicate`, zéro d'`onDelete` — donc le
// recâbler sur `onDuplicate` ne rougissait nulle part. L'utilisateur croit
// supprimer un lot et double son stock.
describe("LotFormModal — les deux boutons du bas et le miroir du poids", () => {
  const openAdd = (onSave: any) => renderWithCtx(
    <CuratorLotFormModal open={true} data={{ tobacco: tob1 }} onClose={() => {}} onSave={onSave} />,
    { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
  );

  it("à la création, le poids initial saisi devient AUSSI le solde", () => {
    const onSave = vi.fn();
    const { container, getAllByRole } = openAdd(onSave);
    // Le champ « poids initial » est le seul champ de poids rendu en création
    // (celui du solde est caché), donc il est identifiable sans s'accrocher à
    // un libellé.
    // `TextField` rend un `type="text"` avec `inputMode`, pas un
    // `type="number"` — on s'accroche donc au `step`, qui lui est bien posé.
    // Le champ de quantité porte `step="1"`, il ne peut pas être confondu.
    const weight = container.querySelector('input[step="0.1"]') as HTMLInputElement;
    expect(weight, "champ de poids introuvable").toBeTruthy();
    fireEvent.change(weight, { target: { value: "42" } });
    fireEvent.click(getAllByRole("button").find((b) => (b.textContent || "").includes("btn_add"))!);
    expect(onSave).toHaveBeenCalledTimes(1);
    const lot = onSave.mock.calls[0]![0];
    expect(lot.weightInitial).toBe("42");
    expect(lot.weightG, "le solde ne suit pas le poids initial").toBe("42");
  });

  it("en édition, le poids initial ne touche PLUS au solde", () => {
    // Le miroir est réservé à la création : en édition les deux champs sont
    // visibles et distincts, et corriger le poids d'origine ne doit pas
    // réécrire un solde que des séances ont déjà entamé.
    const onSave = vi.fn();
    const lot = tob1.lots[0];
    const { container, getAllByRole } = renderWithCtx(
      <CuratorLotFormModal open={true} data={{ tobacco: tob1, lot, idx: 0 }}
        onClose={() => {}} onSave={onSave} />,
      { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
    );
    const weights = Array.from(container.querySelectorAll('input[step="0.1"]')) as HTMLInputElement[];
    expect(weights.length, "les deux champs de poids doivent être visibles").toBeGreaterThanOrEqual(2);
    fireEvent.change(weights[0]!, { target: { value: "80" } });
    fireEvent.click(getAllByRole("button").find((b) => (b.textContent || "").includes("btn_save"))!);
    expect(onSave.mock.calls[0]![0].weightG).toBe("50");
  });

  it("Supprimer appelle onDelete, jamais onDuplicate", () => {
    const onDelete = vi.fn(); const onDuplicate = vi.fn();
    const { getByRole } = renderWithCtx(
      <CuratorLotFormModal open={true} data={{ tobacco: tob1, lot: tob1.lots[0], idx: 0 }}
        onClose={() => {}} onSave={() => {}} onDelete={onDelete} onDuplicate={onDuplicate} />,
      { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
    );
    const dlg = getByRole("dialog") as HTMLElement;
    const del = (Array.from(dlg.querySelectorAll("[role='button'], button")) as HTMLElement[])
      .find((b) => b.getAttribute("aria-label") === "aria_delete_lot");
    expect(del, "le bouton Supprimer est introuvable").toBeTruthy();
    fireEvent.click(del!);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it("Dupliquer appelle onDuplicate, jamais onDelete", () => {
    // Le miroir : les deux boutons sont voisins dans la même barre du bas, et
    // c'est précisément l'adjacence qui rend l'échange indolore à écrire.
    const onDelete = vi.fn(); const onDuplicate = vi.fn();
    const { getByRole } = renderWithCtx(
      <CuratorLotFormModal open={true} data={{ tobacco: tob1, lot: tob1.lots[0], idx: 0 }}
        onClose={() => {}} onSave={() => {}} onDelete={onDelete} onDuplicate={onDuplicate} />,
      { data: { tobaccos: [tob1], pipes: [], accessories: [], sessions: [], wishlist: [] } },
    );
    const dlg = getByRole("dialog") as HTMLElement;
    const dup = (Array.from(dlg.querySelectorAll("[role='button'], button")) as HTMLElement[])
      .find((b) => /lot_duplicate|aria_duplicate/.test((b.textContent || "") + (b.getAttribute("aria-label") || "")));
    expect(dup, "le bouton Dupliquer est introuvable").toBeTruthy();
    fireEvent.click(dup!);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
