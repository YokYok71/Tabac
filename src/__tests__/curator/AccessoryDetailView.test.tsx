// Smoke tests for src/views/curator/AccessoryDetailView.tsx.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorAccessoryDetailView } from "../../views/curator/AccessoryDetailView";

const briquet = {
  id: "1", brand: "IM Corona", name: "Old Boy",
  type: "Briquet", fuel: "Gaz",
  rating: 4, status: "active", imageUrl: "",
  datePurchased: "2024-01-15", price: "120", seller: "Pipe Shop",
  notes: "Reliable pipe lighter",
};

describe("AccessoryDetailView — visibility", () => {
  it("returns null when view !== 'acc'", () => {
    const { container } = renderWithCtx(<CuratorAccessoryDetailView />, {
      view: "home", accDet: briquet,
    });
    expect(container.firstChild).toBeNull();
  });

  it("returns null when accDet is null", () => {
    const { container } = renderWithCtx(<CuratorAccessoryDetailView />, {
      view: "acc", accDet: null,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the brand + name + type", () => {
    const { container } = renderWithCtx(<CuratorAccessoryDetailView />, {
      view: "acc", accDet: briquet,
    });
    expect(container.textContent).toContain("IM Corona");
    expect(container.textContent).toContain("Old Boy");
  });

  it("renders notes when present", () => {
    const { container } = renderWithCtx(<CuratorAccessoryDetailView />, {
      view: "acc", accDet: briquet,
    });
    expect(container.textContent).toContain("Reliable pipe lighter");
  });
});

describe("AccessoryDetailView — Edit", () => {
  it("Edit button pre-fills accForm + sets editAccId + nav('editA')", () => {
    const setAccForm = vi.fn();
    const setEditAccId = vi.fn();
    const nav = vi.fn();
    const BA = { name: "", brand: "", type: "Autre", fuel: "", datePurchased: "", price: "", seller: "", imageUrl: "", rating: 0, notes: "", status: "active" };
    const { getAllByRole } = renderWithCtx(<CuratorAccessoryDetailView />, {
      view: "acc",
      accDet: briquet,
      setAccForm,
      setEditAccId,
      nav,
      BA,
    });
    const editBtn = getAllByRole("button").find(b =>
      /btn_edit|Modifier|Edit/i.test(b.getAttribute("aria-label") || ""),
    );
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn!);
    expect(setAccForm).toHaveBeenCalled();
    expect(setEditAccId).toHaveBeenCalledWith("1");
    expect(nav).toHaveBeenCalledWith("editA");
  });
});

// The in-detail status toggle was removed — retiring or
// reactivating an accessory now happens exclusively in the edit form
// (AccessoryFormView's status SegmentedField). The detail view stays
// strictly read-only on status.
describe("AccessoryDetailView — no in-detail status toggle", () => {
  it("does NOT render a 'tap to retire' / 'tap to reactivate' PressCard", () => {
    const changeAccStatus = vi.fn();
    const { container } = renderWithCtx(<CuratorAccessoryDetailView />, {
      view: "acc",
      accDet: briquet,
      changeAccStatus,
    });
    const presses = Array.from(container.querySelectorAll("[role='button']"));
    const toggle = presses.find(el =>
      /toucher pour retirer|tap to retire|toucher pour réactiver|tap to reactivate/i
        .test(el.textContent || ""),
    );
    expect(toggle, "Status toggle in the detail view was removed — only the edit form exposes it.").toBeFalsy();
    expect(changeAccStatus).not.toHaveBeenCalled();
  });
});

// ── status badge in hero ──────────────────────────────────────
// An earlier release removed the status TOGGLE from the detail view (only the edit
// form can flip it), and a code comment claimed the status was "still
// visible via a badge next to the title" — but no badge was actually
// rendered. An earlier release adds the missing badge, mirroring PipesDetailView.

describe("AccessoryDetailView — status badge", () => {
  it("shows the 'Actif' badge when status === 'active'", () => {
    const { container } = renderWithCtx(<CuratorAccessoryDetailView />, {
      view: "acc", accDet: { ...briquet, status: "active" },
    });
    expect((container.textContent || "")).toContain("acc_active");
  });

  it("shows the 'Retiré' badge when status === 'retired'", () => {
    const { container } = renderWithCtx(<CuratorAccessoryDetailView />, {
      view: "acc", accDet: { ...briquet, status: "retired" },
    });
    expect((container.textContent || "")).toContain("acc_retired");
  });
});
