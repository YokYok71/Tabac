import { describe, it, expect } from "vitest";
import { shouldShowDock, NO_DOCK_VIEWS } from "../utils/dockVisibility";

describe("shouldShowDock", () => {
  it("shows the dock on the normal browse views", () => {
    for (const v of ["home", "inv", "pipes", "acc", "journal", "stats", "catalog"]) {
      expect(shouldShowDock(v)).toBe(true);
    }
  });

  // The reading / doc pages MUST hide the floating dock (it
  // overlapped the scrolling text; users reported it as "the doc bug on
  // every page"). This is the regression lock: never let the dock back
  // onto these pages.
  it("hides the dock on every reading / doc page", () => {
    for (const v of ["help", "changelog", "privacy", "licenses"]) {
      expect(shouldShowDock(v)).toBe(false);
      expect(NO_DOCK_VIEWS.has(v)).toBe(true);
    }
  });

  it("hides the dock on tasting + every full-screen form", () => {
    for (const v of ["tasting", "addT", "editT", "addP", "editP", "addA", "editA", "addJ", "editJ"]) {
      expect(shouldShowDock(v)).toBe(false);
    }
  });

  it("hides the dock while the wishlist form is taking over the screen", () => {
    expect(shouldShowDock("inv", { showWishForm: true })).toBe(false);
    expect(shouldShowDock("inv", { editWishId: 42 })).toBe(false);
    expect(shouldShowDock("inv", { showWishForm: false, editWishId: null })).toBe(true);
  });
});
