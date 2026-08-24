// A BROWSER THAT REFUSES SITE STORAGE GAVE A BLANK PAGE — NO MESSAGE, AND NOT
// EVEN THE REPAIR LINK.
//
// Safari (macOS and iOS) with "Block all cookies", Chrome or Firefox with site
// data blocked for the origin, and some MDM profiles do not hand back an empty
// store: touching `localStorage` THROWS `SecurityError`. No file, no import, no
// hand-editing — a first visit is enough.
//
// `main.jsx` guards every one of its pre-mount reads and its catch says why.
// `App` did not: its state initialisers read the store raw, so the very first
// render threw. That alone would be survivable — the error boundary exists for
// it — except that **`EB.render()` reads `cave-lang` from the same store**, in
// the branch that only ever runs once something has already crashed. So the
// boundary threw the identical error while rendering the screen meant to
// explain it, React unmounted the whole tree, and `#root` was left EMPTY.
//
// That last detail is what turns an error into a dead end: the boot shell in
// `index.html` — including the "Rien ne se passe ? Réparer l'application →"
// link to `reset.html` — lives INSIDE `#root` and has already been replaced by
// the time React gives up. The user is left with a white page.
//
// THE RULE THIS LOCKS: the error boundary may not depend on anything that can
// be the thing that failed. Storage is exactly that.

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { EB } from "../components/EB.tsx";
import { lsGet } from "../utils/appStorage.ts";

function blockStorage() {
  const err = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
  // Safari throws on the PROPERTY access, not on the method — the harsher of
  // the two shapes, and the one a real blocked-cookies profile produces.
  const ls = Object.getOwnPropertyDescriptor(window, "localStorage");
  const ss = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, get: err });
  Object.defineProperty(window, "sessionStorage", { configurable: true, get: err });
  return () => {
    if (ls) Object.defineProperty(window, "localStorage", ls);
    if (ss) Object.defineProperty(window, "sessionStorage", ss);
  };
}

afterEach(() => { vi.restoreAllMocks(); });

function Boom(): never { throw new Error("boom"); }

describe("the error boundary survives a browser that refuses storage", () => {
  it("renders its fallback instead of throwing a second time", () => {
    const restore = blockStorage();
    try {
      // Without the fix this throws SecurityError out of EB.render, React
      // unmounts everything, and the user is left with an empty #root.
      const { container } = render(<EB><Boom /></EB>);
      expect(container.textContent, "the boundary rendered nothing").not.toBe("");
    } finally { restore(); }
  });

  it("still says something a human can act on", () => {
    // Non-vacuity: a boundary that caught the error and painted an empty div
    // would satisfy the case above.
    const restore = blockStorage();
    try {
      const { container } = render(<EB><Boom /></EB>);
      expect((container.textContent || "").length).toBeGreaterThan(20);
    } finally { restore(); }
  });

  it("and behaves identically when storage merely works", () => {
    // The fix must not change the ordinary path: same fallback, same words.
    const restore = blockStorage();
    let blocked: string;
    try { blocked = render(<EB><Boom /></EB>).container.textContent || ""; } finally { restore(); }
    const normal = render(<EB><Boom /></EB>).container.textContent || "";
    expect(blocked).toBe(normal);
  });
});

describe("lsGet absorbs a throwing store", () => {
  it("returns the fallback rather than propagating SecurityError", () => {
    const restore = blockStorage();
    try {
      expect(lsGet("cave-lang")).toBe(null);
      expect(lsGet("cave-lang", "en")).toBe("en");
    } finally { restore(); }
  });
});

// ── THE SWEEP ──────────────────────────────────────────────────────────────
//
// One guarded call site does not close the class: a read that throws is fatal
// wherever it sits on the render path, and the render path is App plus every
// hook it calls plus every view `CuratorApp` mounts — which is nearly all of
// them. So the rule is the absence of a RAW read outside the two places that
// are allowed one.
//
// WHAT IS DELIBERATELY EXEMPT, and why it is not an oversight:
//   • `utils/appStorage.ts` — it IS the guarded helper.
//   • the OAuth / token domain (`useGdriveAuth`, `useDropboxAuth`,
//     `dropboxAuthCore`, `oauthReturn`) — it keeps its own dedicated guarded
//     accessors, and the `no-storage-read-after-remove` ESLint rule matches a
//     LITERAL `getItem` against a literal `removeItem`. Route those through a
//     helper and that rule goes blind to the read-before-clear invariant it
//     was written to protect, which is the more valuable guarantee of the two.
//     Their reads sit inside a `try` or inside an event handler.
//   • `main.jsx` — every read there is already individually try-wrapped, and
//     it runs before React exists, so it cannot use a boundary at all.
describe("no raw storage read on the render path", () => {
  const EXEMPT = [
    "src/utils/appStorage.ts",
    "src/hooks/useGdriveAuth.ts",
    "src/hooks/useDropboxAuth.ts",
    "src/utils/dropboxAuthCore.ts",
    "src/utils/oauthReturn.ts",
    "src/main.jsx",
  ];
  const files: string[] = [];
  function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = dir + "/" + e.name;
      if (e.isDirectory()) { if (e.name !== "__tests__") walk(p); }
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) files.push(p);
    }
  }
  beforeAll(() => walk("src"));

  // Comments blanked, length-preserving: several of these files EXPLAIN the
  // construct they no longer use.
  function blankComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
  }

  it("every read outside the guarded helper and the OAuth domain goes through lsGet", () => {
    const hits: string[] = [];
    for (const f of files) {
      if (EXEMPT.includes(f)) continue;
      const src = blankComments(readFileSync(f, "utf8"));
      const raw = src.match(/\b(?:local|session)Storage\s*\.\s*getItem\s*\(/g);
      // A read wrapped in its own try/catch is safe; the sweep cannot see the
      // wrapping, so the two `sessionStorage` reads in Overlays.tsx that ARE
      // wrapped are listed by name rather than pattern-matched away.
      if (raw && !(f === "src/views/curator/Overlays.tsx" && raw.length === 2)) {
        hits.push(`${f} (${raw.length})`);
      }
    }
    expect(hits, "a raw storage read can throw on the render path").toEqual([]);
  });

  it("…and the sweep actually walked the tree", () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files).toContain("src/App.tsx");
  });

  it("the exempt list names files that exist and still read storage", () => {
    // An exemption for a file that no longer reads storage is dead licence:
    // the next reader would take it as evidence that the domain is special
    // when it no longer is.
    for (const f of EXEMPT) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, f).toMatch(/\b(?:local|session)Storage\s*\.\s*getItem\s*\(/);
    }
  });
});
