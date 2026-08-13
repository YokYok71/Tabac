import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorApp } from "../../CuratorApp";

afterEach(cleanup);

// runtime proof that the BottomDock is PORTALED to document.body,
// so it can't float mid-page on the installed iOS PWA when an ancestor gains a
// containing-block property (transform / filter / backdrop-filter / …). This
// complements the source-invariant assertions in iosPwaDockGuard.test.ts: this
// one verifies the portal actually renders the dock OUTSIDE the app column.
describe("BottomDock portal — iOS-PWA float immunity", () => {
  it("renders the dock under document.body, not inside the app container", () => {
    const { container } = renderWithCtx(<CuratorApp />, {
      loading: false,
      // Unknown view: every real view returns null (no heavy view mounts),
      // but the dock still shows (not a no-dock view, no wish form open).
      view: "__docktest__",
      visibleSections: {},
      showWishForm: false,
      editWishId: null,
      importModal: false,
      trashOpen: false,
      detail: null, pipeDet: null, accDet: null,
      tasting: null,
    });

    // The dock buttons carry labels "dock_home" / "dock_inv" / … (mockT
    // returns the key). Find one anywhere in the document.
    const dockBtn = [...document.body.querySelectorAll("button")]
      .find((b) => (b.textContent || "").startsWith("dock_"));
    expect(dockBtn, "the bottom dock should render").toBeTruthy();

    // THE invariant: the dock is portaled to <body>, so it lives OUTSIDE the
    // React render container (the app column). If someone un-portals it, it
    // falls back inside the container and this fails.
    expect(container.contains(dockBtn!), "dock must be portaled to document.body, not inside the app column").toBe(false);
    expect(document.body.contains(dockBtn!)).toBe(true);
  });
});
