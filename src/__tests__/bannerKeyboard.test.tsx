import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "./viewTestUtils";
import {
  CuratorSaveErrorBanner,
  CuratorSaveWarnBanner,
  CuratorExportReminderBanner,
  CuratorPhotoErrorBanner,
} from "../views/curator/Overlays";

// A top banner's ACTION must be a real button.
//
// All four `position: fixed; top: 0` banners were a bare `<div onClick>` whose
// ENTIRE surface was the action: no role="button", no tabIndex, no key handler.
// The announcement worked (role="alert"), so a screen-reader user was told
// there was a save failure, a full disk, a failed photo or an overdue
// backup — and given no way whatsoever to act on it. Three of the four
// then offered a properly-labelled dismiss ×, so the ONLY thing reachable
// from the keyboard was making the warning go away.
//
// That is precisely the defect already fixed on the update pill, where it
// was written up as "a keyboard or screen-reader user could DISMISS an update
// but never ACT on one". Four more instances of it survived in the same file.
//
// The container keeps role="alert" (the announcement is unchanged) and the
// action moves onto a <button>, which is also why the container cannot simply
// BECOME a button: three of them nest the dismiss ×, and nested interactive
// elements are invalid.

const CASES: {name: string; Comp: any; ctx: (fn: any) => any; role?: string}[] = [
  {
    name: "save error",
    Comp: CuratorSaveErrorBanner,
    ctx: (fn: any) => ({ saveError: "Échec de sauvegarde", setSaveError: vi.fn(), setImportModal: fn, modalOpenTs: { current: 0 }, lang: "fr" }),
  },
  {
    name: "save warn",
    Comp: CuratorSaveWarnBanner,
    ctx: (fn: any) => ({ saveWarn: "Stockage à 85%", setSaveWarn: vi.fn(), setImportModal: fn, modalOpenTs: { current: 0 }, lang: "fr" }),
  },
  {
    name: "export reminder",
    Comp: CuratorExportReminderBanner,
    ctx: (fn: any) => ({ exportReminder: true, setImportModal: fn, modalOpenTs: { current: 0 }, lang: "fr" }),
    // NOT "alert": an overdue backup is routine news, and `alert` is the
    // assertive class that interrupts. An earlier release drew exactly this line for
    // The Settings update notice. It carried NO role at all,
    // so its appearance was silent to a screen reader; `status` announces it
    // politely. The distinction is asserted, not assumed, so a future sweep
    // cannot "complete" the set by making this one assertive.
    role: "status",
  },
  {
    name: "photo error",
    Comp: CuratorPhotoErrorBanner,
    // No dismiss × on this one: its whole job is to be dismissed, and before
    // the keyboard fix that was possible only by tapping.
    ctx: (fn: any) => ({ photoErr: "Image trop lourde (> 20 Mo)", setPhotoErr: fn, lang: "fr" }),
  },
];

describe("top banners — the action is reachable from the keyboard", () => {
  CASES.forEach(({ name, Comp, ctx, role }) => {
    it(`${name}: the action is a real <button>, not the container`, () => {
      // ctx() wires this spy to whichever setter THIS banner's action calls
      // (setImportModal for three of them, setPhotoErr for the fourth).
      const action$ = vi.fn();
      const { container } = renderWithCtx(<Comp />, ctx(action$) as any);
      const root = container.firstChild as HTMLElement;

      // The announcement survives (see the per-case `role` note).
      expect(root.getAttribute("role")).toBe(role || "alert");
      // The container is no longer the tap target.
      expect(root.getAttribute("onclick")).toBeNull();
      expect((root.style as any).cursor).not.toBe("pointer");

      // The action button exists, is a real BUTTON element (so Enter and
      // Space work with no key handler of our own), and is focusable.
      const action = container.querySelector("button:not([aria-label])") as HTMLElement;
      expect(action).toBeTruthy();
      expect(action.tagName).toBe("BUTTON");
      expect(action.getAttribute("type")).toBe("button");
      expect(action.hasAttribute("disabled")).toBe(false);

      // And it still does the thing.
      fireEvent.click(action);
      expect(action$).toHaveBeenCalled();
    });

    it(`${name}: clicking the CONTAINER does nothing`, () => {
      // THE load-bearing case, and the one the first version of this file got
      // wrong. Every other assertion here passes just as happily when the
      // handler is ALSO on the container — probed by putting `onClick` and
      // `cursor: "pointer"` back on the photo-error banner, which left all
      // eight cases green. A source-text check was tried first and was worse:
      // it sliced the style block from `position: "fixed"` onward, so a
      // `cursor` declared one line ABOVE that was invisible to it.
      //
      // Clicks bubble child → parent, never parent → child, so firing on the
      // container reaches the action button only if the container itself is
      // still a tap target. That is exactly the property, stated directly.
      const fn = vi.fn();
      const { container } = renderWithCtx(<Comp />, ctx(fn) as any);
      const root = container.firstChild as HTMLElement;
      expect((root.style as any).cursor).not.toBe("pointer");
      fireEvent.click(root);
      expect(fn).not.toHaveBeenCalled();
    });

    it(`${name}: the action button carries an accessible name`, () => {
      // The banner text IS the name; an empty one would announce as a
      // nameless button, which is worse than the div it replaced.
      const { container } = renderWithCtx(<Comp />, ctx(vi.fn()) as any);
      const action = container.querySelector("button:not([aria-label])") as HTMLElement;
      expect((action.textContent || "").trim().length).toBeGreaterThan(3);
    });
  });
});
