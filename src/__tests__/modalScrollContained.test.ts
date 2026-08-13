import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * EVERY scroll region inside a modal must contain its scroll.
 *
 * The catalogue fiche was fixed after the user reported, from the
 * installed iOS PWA, that swiping on it moved the page underneath. The
 * mechanism: a short scroll port with `overscroll-behavior: auto` above a long
 * document, where the backdrop's own `contain` cannot help because the backdrop
 * is not a scroll port in that layout. That commit then claimed:
 *
 *     "Verified by sweep: no `maxHeight: <n>vh` scroll region remains in any
 *      modal."
 *
 * THE CLAIM WAS FALSE. The sweep was `grep 'maxHeight: "[0-9]*vh"'` — ONE
 * spelling — and both surviving cases are written `maxHeight: "min(60vh,
 * 460px)"` and `"min(78vh, 700px)"`, which that pattern cannot match. Neither
 * carried `overscrollBehavior`. Measured in a browser: Search at 390x844 has a
 * backdrop of 844 = 844 — travel 0, NOT a scroll port — while the results list
 * carries 5295 px of travel; and Settings at 834x1112 has a backdrop of
 * 1112 = 1112 under an 857 px body scroll. On a phone Settings was protected
 * only by an 8 px backdrop overhang, i.e. by accident: the defect hides on the
 * device you test and appears on the tablet.
 *
 * (Those figures replace the ones this header first carried, which came from an
 * audit report rather than from a run of my own. A number written down here has
 * to be one the writer produced — the Search figures are fixture-dependent and
 * the borrowed pair differed by 4x.)
 *
 * That is the repo's oldest failure shape, recorded at the hex-alpha rule:
 * "each survived because every sweep grepped ONE spelling". A grep is not a
 * sweep; this file is.
 *
 * WHAT IS CHECKED, and why it is a property rather than a spelling: any element
 * that declares `overflowY: "auto"` (or `"scroll"`) IS a scroll port, however
 * its height is capped — `vh`, `min()`, `flex: 1`, `calc()`, or nothing at all.
 * A scroll port inside a modal must declare `overscrollBehavior`. The height
 * expression is deliberately NOT inspected: it was the thing the last sweep
 * looked at, and it is the thing that varies.
 */

const VIEWS = "src/views/curator";
const COMPONENTS = "src/components/curator";

/** Files that render inside the shared `Modal` primitive. */
function modalHosts(): string[] {
  const out: string[] = [];
  for (const dir of [VIEWS, COMPONENTS]) {
    for (const f of readdirSync(dir)) {
      if (!/\.tsx$/.test(f)) continue;
      const p = path.join(dir, f);
      const src = readFileSync(p, "utf8");
      // A host either renders <Modal …> or IS the primitive.
      if (/<Modal\b/.test(src) || f === "Modal.tsx") out.push(p);
    }
  }
  return out;
}

/**
 * Every `overflowY: "auto" | "scroll"` declaration, with its inline-style
 * object flattened to one line so a multi-line style block is read as a unit.
 * Comments are stripped first — this file's own subject is a check that was
 * satisfied by looking at the wrong text, and a comment mentioning
 * `overscrollBehavior` must not satisfy it either.
 */
function scrollPorts(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const out: string[] = [];
  const re = /style=\{\{([\s\S]*?)\}\}/g;
  for (const m of code.matchAll(re)) {
    const decl = m[1]!.replace(/\s+/g, " ");
    if (/overflowY:\s*"(auto|scroll)"/.test(decl)) out.push(decl);
  }
  return out;
}

describe("every modal contains its scroll", () => {
  const hosts = modalHosts();
  const withPorts = hosts.filter((h) => scrollPorts(readFileSync(h, "utf8")).length > 0);

  it("finds the modal hosts at all, so the sweep cannot pass vacuously", () => {
    // The previous sweep's real failure was reporting a clean result from a
    // pattern that matched almost nothing.
    expect(hosts.length).toBeGreaterThan(5);
    for (const f of ["SearchModal", "SettingsModal", "CatalogView", "CompareModal"]) {
      expect(hosts.some((h) => h.includes(f)), f).toBe(true);
    }
  });

  it("finds scroll ports to check, in more than one file", () => {
    expect(withPorts.length).toBeGreaterThan(3);
  });

  it("gives every modal that scrolls at least one contained port", () => {
    // THE INVARIANT, and it is deliberately per-FILE rather than per-PORT.
    //
    // The first version of this test required `contain` on EVERY scroll port
    // and reported three more: CompareModal's 240 px picker list and two
    // Settings widgets at 380 and 200 px. Checked before "fixing" them — all
    // three are NESTED inside a body that now contains (CompareModal.tsx:160,
    // SettingsModal.tsx:156), so a gesture exhausting the inner list chains to
    // that body and stops there; the page behind was never reachable.
    //
    // Forcing them would have been the over-strict-guard mistake this repo
    // keeps recording, and not merely useless: it would BREAK the handoff a
    // reader expects, where a short inner list hands its remaining travel to
    // the modal body instead of dead-ending.
    //
    // What actually has to hold is that the chain meets a `contain` somewhere
    // before the document — i.e. that no modal has ZERO containment.
    const naked = withPorts.filter((h) =>
      !scrollPorts(readFileSync(h, "utf8")).some((d) => /overscrollBehavior:\s*"(contain|none)"/.test(d)));
    expect(naked, "a modal whose every scroll port leaves overscroll-behavior at `auto` chains "
      + "its gesture all the way to the page behind — see the measurement on Modal.tsx").toEqual([]);
  });

  it("never declares overscrollBehavior and leaves it at the default", () => {
    // `auto` is the default and would satisfy a presence check while changing
    // nothing — a declaration that says "considered, and declined" needs to be
    // written as `contain` or `none`, or not written at all.
    const offenders: string[] = [];
    for (const h of hosts) {
      for (const decl of scrollPorts(readFileSync(h, "utf8"))) {
        const m = /overscrollBehavior[XY]?:\s*"([a-z]+)"/.exec(decl);
        if (m && m[1] !== "contain" && m[1] !== "none") offenders.push(`${h}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("contains the BODY of each of the four modals that scroll", () => {
    // Named explicitly, because the per-file rule above would be satisfied by a
    // contained inner widget while the body itself chained. The body is the
    // first scroll port in source order in all four — it wraps the widgets.
    for (const [file, dir] of [["SearchModal.tsx", VIEWS], ["SettingsModal.tsx", VIEWS],
      ["CatalogView.tsx", VIEWS], ["CompareModal.tsx", VIEWS]] as const) {
      const ports = scrollPorts(readFileSync(path.join(dir, file), "utf8"));
      expect(ports.length, `${file}: expected a scroll port`).toBeGreaterThan(0);
      expect(/overscrollBehavior:\s*"contain"/.test(ports[0]!), `${file}: the modal BODY must contain`).toBe(true);
    }
  });
});
