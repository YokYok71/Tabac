import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  pickBottomToast,
  BOTTOM_TOAST_ORDER,
  BOTTOM_TOAST_OFFSET,
  type BottomToastId,
} from "../utils/bottomToast";

describe("pickBottomToast — one bottom toast at a time", () => {
  it("returns null when nothing is pending", () => {
    expect(pickBottomToast({})).toBeNull();
    expect(pickBottomToast(null)).toBeNull();
    expect(pickBottomToast(undefined)).toBeNull();
  });

  it("gives the undo toast priority over every informational one", () => {
    // It is the only one that EXPIRES: an 8-second window to reverse a
    // deletion. Losing it to a "just updated" notice costs the user data.
    expect(pickBottomToast({
      undoToast: { kind: "tobacco" },
      importRecap: { msg: "…" },
      justUpdated: true,
      langDetected: true,
    })).toBe("undo");
  });

  it("prefers the import recap to the update and language notices", () => {
    // Reachable: a merge import run from Settings while the just-updated
    // toast is still on its timer.
    expect(pickBottomToast({ importRecap: { msg: "…" }, justUpdated: true })).toBe("importRecap");
  });

  it("falls through the declared order", () => {
    expect(pickBottomToast({ justUpdated: true, langDetected: true })).toBe("justUpdated");
    expect(pickBottomToast({ langDetected: true })).toBe("langDetected");
  });

  it("always returns null or exactly ONE declared id, over every combination", () => {
    // The exhaustive sweep bannerStack.test.ts runs, for the same reason: the
    // defect being closed is two toasts rendering into the same rectangle, so
    // "at most one" is the property, not any particular winner.
    const keys = ["undoToast", "importRecap", "justUpdated", "langDetected"] as const;
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      const s: Record<string, unknown> = {};
      keys.forEach((k, i) => { if (mask & (1 << i)) s[k] = true; });
      const got: BottomToastId = pickBottomToast(s);
      if (mask === 0) expect(got).toBeNull();
      else expect(BOTTOM_TOAST_ORDER).toContain(got);
    }
  });

  it("declares every id it can return, and returns every id it declares", () => {
    // A stale entry in BOTTOM_TOAST_ORDER reads as coverage it does not have.
    const reachable = new Set<string>();
    ([
      { undoToast: true }, { importRecap: true }, { justUpdated: true }, { langDetected: true },
    ]).forEach((s) => { const r = pickBottomToast(s); if (r) reachable.add(r); });
    expect([...reachable].sort()).toEqual([...BOTTOM_TOAST_ORDER].sort());
  });
});

describe("the bottom toasts clear the dock, and share ONE offset", () => {
  const src = readFileSync(
    resolve(__dirname, "../views/curator/Overlays.tsx"), "utf8",
  );

  it("has no bottom toast left at the old `bottom: 40`", () => {
    // 40px puts a z500 toast ON TOP of the z30 dock pill, whose top edge sits
    // around 56px from the bottom once the home-indicator safe area is added.
    // Three of the four shipped that way; only the undo toast had clearance,
    // and it had it as a local literal, which is how the others drifted.
    expect(src).not.toMatch(/bottom:\s*40\b/);
  });

  it("routes every bottom toast through the shared offset constant", () => {
    // Four render sites, one constant. A literal reintroduced at any of them
    // is the drift this test exists to catch.
    const n = src.split("BOTTOM_TOAST_OFFSET").length - 1;
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it("keeps the offset inside the safe area rather than a bare pixel value", () => {
    // The clearance depends on env(safe-area-inset-bottom); a plain number
    // cannot be right on both a home-indicator phone and a device without one.
    expect(BOTTOM_TOAST_OFFSET).toContain("safe-area-inset-bottom");
  });

  it("makes all four render sites consult the shared decision", () => {
    const n = src.split("pickBottomToast").length - 1;
    expect(n).toBeGreaterThanOrEqual(4);
  });
});
