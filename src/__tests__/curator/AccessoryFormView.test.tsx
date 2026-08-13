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
