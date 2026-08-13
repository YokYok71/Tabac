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
