// The app refuses to render inside someone else's frame,
// because the CSP directive that was supposed to stop it is INERT.
//
// `index.html` carries `frame-ancestors 'none'` in a <meta http-equiv> CSP and
// CLAUDE.md claimed it "prevents clickjacking via iframes". CSP Level 3 §3.3
// requires a user agent to REMOVE that directive from a meta-delivered policy,
// so it has never done anything, and GitHub Pages cannot send the header form.
//
// THE DEFENCE IS "DO NOT RENDER", NOT "BUST OUT" — a cross-origin frame is
// blocked from navigating the top window without user activation, so the
// bust-out fails silently in exactly the drive-by case that matters. An app
// that does not render cannot be clicked through.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { isFramed, renderFramedNotice, tryBustOut } from "../utils/frameGuard";

/** Blank comments length-preservingly, so a match is code and not prose. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

describe("isFramed", () => {
  it("false in a top-level document — the ordinary case, and jsdom's", () => {
    expect(window.self === window.top, "fixture sanity").toBe(true);
    expect(isFramed()).toBe(false);
  });

  it("true when self and top differ", () => {
    const top = Object.getOwnPropertyDescriptor(window, "top");
    Object.defineProperty(window, "top", { configurable: true, value: {} as any });
    try { expect(isFramed()).toBe(true); }
    finally { if (top) Object.defineProperty(window, "top", top); }
  });

  it("FAILS CLOSED — an environment that refuses to answer counts as framed", () => {
    // Reading `window.top` cross-origin is permitted and does not throw, so
    // this path is belt-and-braces. It resolves to `true` on purpose: a false
    // positive costs a message with a link out, a false negative is the defect.
    const top = Object.getOwnPropertyDescriptor(window, "top");
    Object.defineProperty(window, "top", {
      configurable: true,
      get() { throw new Error("cross-origin"); },
    });
    try { expect(isFramed()).toBe(true); }
    finally { if (top) Object.defineProperty(window, "top", top); }
  });
});

describe("renderFramedNotice", () => {
  beforeEach(() => { document.body.innerHTML = '<div id="root">the whole app</div>'; });

  it("REPLACES the app — leaving it under the notice would defeat the point", () => {
    renderFramedNotice(document, { title: "not inside another site", open: "open it" }, "https://t-cellar.app/");
    const root = document.getElementById("root")!;
    expect(root.textContent).not.toContain("the whole app");
    expect(root.textContent).toContain("not inside another site");
  });

  it("offers a way OUT, and it targets _top", () => {
    // A user CLICK carries activation, so `target="_top"` works even when the
    // automatic bust-out was blocked. The escape always exists; it just needs
    // the visitor's intent.
    renderFramedNotice(document, { title: "t", open: "open it" }, "https://t-cellar.app/");
    const a = document.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_top");
    expect(a.getAttribute("href")).toBe("https://t-cellar.app/");
    expect(a.textContent).toBe("open it");
  });

  it("survives a document with no #root", () => {
    document.body.innerHTML = "";
    expect(() => renderFramedNotice(document, { title: "t", open: "o" }, "/")).not.toThrow();
  });
});

describe("tryBustOut", () => {
  it("issues the navigation when there is a top to navigate", () => {
    const win: any = { self: { location: { href: "https://t-cellar.app/" } }, top: { location: "" } };
    expect(tryBustOut(win)).toBe(true);
    expect(win.top.location).toBe("https://t-cellar.app/");
  });

  it("does nothing at top level", () => {
    const w: any = {}; w.self = w; w.top = w; w.location = { href: "/" };
    expect(tryBustOut(w)).toBe(false);
  });

  it("swallows a blocked navigation — the notice is the real defence", () => {
    const win: any = {
      self: { location: { href: "/" } },
      get top() { throw new Error("blocked"); },
    };
    expect(() => tryBustOut(win)).not.toThrow();
    expect(tryBustOut(win)).toBe(false);
  });
});

describe("the guard is WIRED, and the inert directive is labelled", () => {
  const main = code("src/main.jsx");

  it("main.jsx computes it once, before anything else runs", () => {
    expect(main).toContain("const FRAMED = isFramed()");
    const decl = main.indexOf("const FRAMED");
    const theme = main.indexOf("applyTheme(");
    expect(decl, "the guard must precede the rest of the boot").toBeLessThan(theme);
  });

  it("the mount is gated on it", () => {
    // The load-bearing one. An earlier draft used `throw` inside the try —
    // whose catch calls `mount()`, so it would have mounted anyway.
    expect(main).toContain("if (!FRAMED) try {");
    expect(main).not.toMatch(/if \(FRAMED\) throw/);
  });

  it("the service worker is gated on it too", () => {
    // Installing the offline machinery for a page the user never chose to open
    // is not something a refused document should do.
    expect(main).toContain("if (!FRAMED && 'serviceWorker' in navigator)");
  });

  it("the notice is rendered, in the user's language, from the ONE boot table", () => {
    expect(main).toContain("renderFramedNotice(document,");
    expect(main).toContain("tryBustOut(window)");
    // Same table as the boot strings: one pre-mount language axis, already
    // covered by doc:check gate 15. A second map is the shape an earlier pass removed.
    expect(main).toMatch(/const BOOT = \{[\s\S]{0,1400}?\bpt:/);
  });

  it("all six languages carry both new strings", () => {
    const raw = readFileSync("src/main.jsx", "utf8");
    const block = raw.slice(raw.indexOf("const BOOT = {"), raw.indexOf("const pair ="));
    for (const c of ["fr", "en", "es", "de", "it", "pt"]) {
      const row = block.match(new RegExp("\\n\\s*" + c + ": \\[([\\s\\S]*?)\\],"));
      expect(row, `${c} missing from BOOT`).toBeTruthy();
      // 4 entries: loading, repair link, framed title, framed link.
      const parts = row![1]!.split(/',\s*(?:'|")|",\s*(?:'|")/);
      expect(parts.length, `${c} does not carry all four boot strings`).toBe(4);
    }
  });

  it("index.html still carries the directive AND says it is inert", () => {
    // Kept on purpose — it is the correct directive the day this is served
    // behind something that can send headers. Labelled so no reader mistakes
    // it for live protection and deletes the guard that actually works.
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain("frame-ancestors 'none'");
    expect(html).toMatch(/INERT[\s\S]{0,600}frameGuard\.ts/);
  });
});
