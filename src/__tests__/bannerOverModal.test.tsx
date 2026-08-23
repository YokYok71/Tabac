// A top banner painted over a VIEW-LOCAL modal, and the gate could not see it.
//
// `pickTopBanner` stands every banner down while a modal is open — that rule
// was written for exactly this reason, and its own comment states it: the five
// banners sit at z489-492 while the shared `Modal` is z200, so a banner raised
// over one covers its header INCLUDING the 44 px close X, and sits OUTSIDE the
// modal's focus trap.
//
// But the gate listed FOUR App-level states by name — `importModal`,
// `searchOpen`, `trashOpen`, `lightbox` — and every OTHER modal in the app is
// invisible to it: the lot form, the maintenance form, the catalogue fiche and
// its QuickAdd, the comparison, the shopping list, the encryption prompt, the
// unsaved-changes confirm, the auto-update countdown dialog, the welcome and
// startup-notice pop-ups. `modalStack` has known about all of them all along —
// `goBack` closes the top-most one on a swipe — and the banners were never
// wired to it.
//
// REACHABLE, and by the most ordinary route there is. The export reminder
// appears on any device that has not backed up in 30 days; it MEASURES 110 px
// tall at 390 px, while the modal backdrop pads 8 % (≈ 68 px) from the top —
// so the panel's first ~42 px, where its title and its close X live, are under
// the banner. Nothing about that requires an unusual state.
//
// The worst instance is the same one the original fix named: « Restaurer » on
// the cloud-newer banner calls `stageImport(…, {autoApply:"replace"})`, and it
// lands where the user is reaching to close the modal.
//
// ENUMERATING THE MODALS IS THE MISTAKE THIS MODULE EXISTS TO END. The header
// of `bannerStack.ts` says so about pairwise yields; a hand-listed set of
// modal states is the same shape. The gate now asks the ONE registry that
// every `Modal` reports to, which is also the one `goBack` consults, so the
// two can never disagree about whether a modal is open.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Modal } from "../components/curator/Modal.tsx";
import {
  hasOpenModal, subscribeModalStack, _resetModalStack, pushModalClose,
} from "../utils/modalStack.ts";
import { pickTopBanner, anyModalOpen, TOP_BANNER_ORDER } from "../utils/bannerStack.ts";

beforeEach(() => { _resetModalStack(); });
afterEach(() => { _resetModalStack(); });

describe("the banner gate asks the modal REGISTRY, not a list of names", () => {
  it("every banner stands down while any registered modal is open", () => {
    // The exhaustive form: whichever banner would have won, the gate wins.
    for (const id of TOP_BANNER_ORDER) {
      const s: any = { stackModalOpen: true };
      s[id === "cloudNewer" ? "cloudNewerBackup" : id] = "x";
      expect(pickTopBanner(s), `${id} painted over an open modal`).toBeNull();
    }
  });

  it("…and each one still renders once that modal closes", () => {
    // Non-vacuity: the gate must not be a permanent off switch.
    for (const id of TOP_BANNER_ORDER) {
      const s: any = { stackModalOpen: false };
      s[id === "cloudNewer" ? "cloudNewerBackup" : id] = "x";
      expect(pickTopBanner(s)).toBe(id);
    }
  });

  it("anyModalOpen accepts the registry flag alongside the four named states", () => {
    expect(anyModalOpen({ stackModalOpen: true } as any)).toBe(true);
    // The four originals are untouched — this widens the gate, it does not
    // replace it. `importModal` in particular gates a LAZY chunk whose modal
    // may not have mounted (and therefore not registered) yet.
    expect(anyModalOpen({ importModal: true } as any)).toBe(true);
    expect(anyModalOpen({ searchOpen: true } as any)).toBe(true);
    expect(anyModalOpen({ trashOpen: true } as any)).toBe(true);
    expect(anyModalOpen({ lightbox: "k" } as any)).toBe(true);
    expect(anyModalOpen({} as any)).toBe(false);
  });
});

describe("a real Modal reaches the gate", () => {
  it("mounting one notifies subscribers, and closing it notifies again", () => {
    // Drives the REAL `Modal`, not a hand-pushed handler: what has to hold is
    // that the component every view uses actually reports itself. A test that
    // called `pushModalClose` directly would pass even if `Modal` stopped
    // registering.
    const seen: boolean[] = [];
    const stop = subscribeModalStack((open) => { seen.push(open); });
    expect(seen, "a subscriber learns the CURRENT state immediately").toEqual([false]);

    const { rerender, unmount } = render(
      <Modal open onClose={() => {}} ariaLabel="lot"><div>body</div></Modal>,
    );
    expect(hasOpenModal()).toBe(true);
    expect(seen[seen.length - 1], "the banner gate never heard about it").toBe(true);

    act(() => { rerender(<Modal open={false} onClose={() => {}} ariaLabel="lot"><div>body</div></Modal>); });
    expect(seen[seen.length - 1], "the banner never came back").toBe(false);

    stop();
    unmount();
  });

  it("unsubscribing stops the notifications", () => {
    const fn = vi.fn();
    const stop = subscribeModalStack(fn);
    fn.mockClear();
    stop();
    pushModalClose(() => {});
    expect(fn).not.toHaveBeenCalled();
  });

  it("a nested modal keeps the gate closed until the LAST one goes", () => {
    // Two modals stacked (the encryption prompt over Settings) must not let a
    // banner through when only the top one closes.
    const seen: boolean[] = [];
    const stop = subscribeModalStack((open) => { seen.push(open); });
    const a = pushModalClose(() => {});
    const b = pushModalClose(() => {});
    expect(seen[seen.length - 1]).toBe(true);
    b();
    expect(seen[seen.length - 1], "one of two closing opened the gate").toBe(true);
    a();
    expect(seen[seen.length - 1]).toBe(false);
    stop();
  });
});

describe("App wires the registry to the banner gate", () => {
  it("subscribes once and puts the flag on ctx", () => {
    // The WIRING is what rots: the gate and the registry can both be perfect
    // while nothing joins them, and every test above would still pass. Source
    // level because reproducing it needs the whole App.
    const src = readFileSync("src/App.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
    expect(src, "App never subscribes, so the flag never changes")
      .toMatch(/subscribeModalStack\s*\(/);
    expect(src, "the flag is not exposed, so the banners cannot read it")
      .toMatch(/stackModalOpen[,:]/);
  });
});
