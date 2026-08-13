import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, fireEvent } from "@testing-library/react";
import { Modal } from "../components/curator/Modal";

// focus must never move the viewport.
//
// Reported with the swipe defect, as one complaint: "quand je la
// ferme (swype ou croix) je ne me retrouve pas au même endroit". An earlier
// pass fixed the swipe half — the browser restoring the history entry's scroll — and
// declared the × half sound on the strength of a Chromium measurement. That was
// half an answer to a two-part report.
//
// Chromium cannot arbitrate the × case: there, a tap focuses a
// `div[tabindex=0]`, so `lastActive` is the row and restoring focus lands back
// on it; and `document.body.focus()` is a no-op. iOS Safari does neither — it
// does not focus non-form elements on tap, so `lastActive` is <body>. The app's
// own rule is that this engine cannot settle iOS focus/scroll behaviour, so the
// fix is justified on its own terms instead: none of these four focus moves is
// a navigation the user asked for.

const SRC = readFileSync(
  resolve(__dirname, "../components/curator/Modal.tsx"), "utf8",
);
// Comments blanked, length-preserving — the note at the fix site quotes
// `focus()` while explaining it, and a check that reads prose as data reports
// itself (the lesson doc:check's gate 15 recorded, relearned).
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

describe("Modal — every focus() is non-scrolling", () => {
  it("leaves no bare .focus() call in the file", () => {
    // Four sites: open (container mode), open (first focusable), close
    // (restore), and both ends of the Tab trap. A new one added without
    // preventScroll is the drift this catches.
    const all = CODE.match(/\.focus\(/g) || [];
    const guarded = CODE.match(/\.focus\(\{\s*preventScroll:\s*true\s*\}\)/g) || [];
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(guarded.length).toBe(all.length);
  });
});

describe("Modal — focus behaviour still works", () => {
  it("moves focus into the dialog on open, without scrolling", async () => {
    // preventScroll must not become "no focus at all": the a11y invariant is
    // that opening a dialog moves focus into it so screen readers announce it.
    const spy = vi.spyOn(HTMLElement.prototype, "focus");
    render(
      <Modal open={true} onClose={() => {}} ariaLabel="test">
        <button type="button">Action</button>
      </Modal>,
    );
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(spy).toHaveBeenCalled();
    // …and every call opted out of scrolling.
    spy.mock.calls.forEach((args) => {
      expect(args[0]).toEqual({ preventScroll: true });
    });
    spy.mockRestore();
  });

  it("restores focus to the trigger on close, without scrolling", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { rerender } = render(
      <Modal open={true} onClose={() => {}} ariaLabel="test">
        <button type="button">Action</button>
      </Modal>,
    );
    const spy = vi.spyOn(trigger, "focus");
    rerender(
      <Modal open={false} onClose={() => {}} ariaLabel="test">
        <button type="button">Action</button>
      </Modal>,
    );
    expect(spy).toHaveBeenCalledWith({ preventScroll: true });
    spy.mockRestore();
    trigger.remove();
  });

  it("still closes on Escape", () => {
    // The focus edits sit in the same effects as the key handling; a regression
    // there would be silent.
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} ariaLabel="test">
        <button type="button">Action</button>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
