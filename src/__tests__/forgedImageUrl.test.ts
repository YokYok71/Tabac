// A forged backup must not be able to BRICK the app.
//
// THE DEFECT, reproduced end to end before it was fixed. A `.json` backup
// carrying `imageUrl: "__proto__"` on any tobacco / pipe / accessory / wishlist
// row survived `migrateData` (its guard-rail only blanked `^https?://` at the
// time — it is an allowlist now, see the reversal at the bottom of
// this file), and the photo lookup every render site uses —
// `(imgLocal && imgLocal[x.imageUrl]) || x.imageUrl` over a PLAIN object —
// then returns `Object.prototype`. `safeBgUrl` called `url.indexOf("blob:")`
// on it and threw `TypeError: url.indexOf is not a function`.
//
// Why that was the worst finding of the pre-launch review rather than a
// cosmetic crash: `save(next)` runs BEFORE the render, so the poisoned row is
// already in `localStorage["pipe-cellar-v6"]`; the inventory list throws
// unconditionally; and NEITHER recovery path clears localStorage —
// `EB.purgeCachesAndReload` and `public/reset.html` both stop at service
// workers and Cache Storage. One imported file therefore made the app show the
// error boundary on every launch, for ever, with the user's own cellar
// stranded behind it.
//
// Two independent guarantees are locked here, because they fail differently:
//   1. `safeBgUrl` is TOTAL. It is the single choke point all 18 render sites
//      funnel through, so this holds even for a caller that hands it a plain
//      map — which is exactly what a test fixture does.
//   2. `imgMap` has no prototype, so the lookup cannot yield a prototype
//      member in the first place, and no future consumer inherits the trap.
//
// Probed: reverting either half reddens this file on its own.

import { describe, it, expect } from "vitest";
import { safeBgUrl, imgMap } from "../utils/imgCache";
import { migrateData } from "../utils";

// Every prototype member reachable by name through a data-controlled key.
const PROTO_KEYS = ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"];

describe("safeBgUrl is total", () => {
  it("does not throw on the value a poisoned lookup actually produces", () => {
    // Not a synthetic object: this is literally what
    // `({})["__proto__"]` returns at the render sites.
    expect(() => safeBgUrl(Object.prototype as unknown)).not.toThrow();
    expect(safeBgUrl(Object.prototype as unknown)).toBe("");
  });

  it("does not throw on any non-string a forged imageUrl can reach", () => {
    for (const v of [Object.prototype, {}, [], 42, true, Object, () => {}]) {
      expect(() => safeBgUrl(v as unknown), String(v)).not.toThrow();
    }
  });

  it("still does its actual job — the URL rules are unchanged", () => {
    expect(safeBgUrl("data:image/png;base64,AAA")).toBe('url("data:image/png;base64,AAA")');
    expect(safeBgUrl("blob:https://x/y")).toBe('url("blob:https://x/y")');
    expect(safeBgUrl("https://example.com/a.jpg")).toBe('url("https://example.com/a.jpg")');
    expect(safeBgUrl("javascript:alert(1)")).toBe("");
    expect(safeBgUrl("http://127.0.0.1/x.png")).toBe("");
    expect(safeBgUrl('https://e.com/a").evil(')).toBe("");
    expect(safeBgUrl("")).toBe("");
    expect(safeBgUrl(null)).toBe("");
    expect(safeBgUrl(undefined)).toBe("");
  });
});

describe("imgMap has no prototype", () => {
  it("returns undefined for a prototype member, not Object.prototype", () => {
    const m = imgMap();
    for (const k of PROTO_KEYS) expect(m[k], k).toBeUndefined();
  });

  it("keeps that property after being rebuilt from a previous map", () => {
    // The nine rebuild sites all do `imgMap(prev, patch)`. A single
    // `Object.assign({}, prev, …)` anywhere throws the prototype back on,
    // which is why the source sweep below exists as well.
    const m = imgMap(imgMap({ "local-photo-1": "data:image/png;base64,AAA" }), { b: "x" });
    expect(m["local-photo-1"]).toBe("data:image/png;base64,AAA");
    expect(m["b"]).toBe("x");
    for (const k of PROTO_KEYS) expect(m[k], k).toBeUndefined();
  });

  it("the poisoned lookup now falls through to the raw value, harmlessly", () => {
    // The render sites' exact expression, with the fixed map.
    const imgLocal = imgMap();
    const photoSrc = (imgLocal && imgLocal["__proto__"]) || "__proto__";
    expect(typeof photoSrc).toBe("string");
    expect(safeBgUrl(photoSrc)).toBe("");   // not a URL → placeholder, no crash
  });
});

describe("migrateData now blanks the forged value too (REVERSED)", () => {
  // ── REVERSAL, recorded on the assertion itself ─────────────────────────
  // This case used to assert that `migrateData` does NOT blank `"__proto__"`,
  // with the stated reason: "if migrateData ever started scrubbing it, these
  // tests would be passing vacuously and this case says so."
  //
  // That is exactly what happened, and it is an improvement rather than a
  // regression. An earlier release turned the guard-rail from an `^https?://` BLOCKLIST
  // into an ALLOWLIST (`isLocalPhotoRef` — a `local-photo-*` key or an allowed
  // `data:image/…` URI), because the blocklist had already missed twice: a
  // protocol-relative `//host/x.png` and a `data:image/svg+xml` both walked
  // past it and reached the form preview's bare `<img src>`. `"__proto__"` is
  // not a local photo ref either, so it is blanked now.
  //
  // The VACUITY CONCERN the old case raised is still answered, and by a better
  // route: every other case in this file feeds the poisoned value DIRECTLY to
  // `imgMap()` and `safeBgUrl`, never through `migrateData`. Those two
  // guarantees are defence in depth — they must hold for a caller that hands
  // over a plain map, which is what every fixture and three form views do —
  // so they are exercised whether or not the source ever produces the value.
  it("blanks a poisoned imageUrl at the source", () => {
    const out: any = migrateData({
      tobaccos: [{ id: 1, brand: "E", name: "B", imageUrl: "__proto__", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    } as any);
    expect(out.tobaccos[0].imageUrl).toBe("");
  });

  it("but an external http(s) URL IS blanked, as the local-photos-only rule requires", () => {
    const out: any = migrateData({
      tobaccos: [{ id: 1, brand: "E", name: "B", imageUrl: "https://evil.example/x.png", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    } as any);
    expect(out.tobaccos[0].imageUrl).toBe("");
  });
});

// The end-to-end reproduction: the real list view, the real migrateData
// output, a PLAIN `imgLocal` (which is what every caller and every fixture
// hands it). Before the fix this threw
// `TypeError: url.indexOf is not a function` and took the whole app to the
// error boundary; the guarantee has to hold here, not just in the helper.
describe("the real view survives a forged imageUrl", () => {
  it("renders the inventory list instead of throwing", async () => {
    const { renderWithCtx } = await import("./viewTestUtils");
    const { CuratorInventoryListView } = await import("../views/curator/InventoryListView");
    const React = await import("react");

    const data: any = migrateData({
      tobaccos: [{ id: 1, brand: "Evil", name: "Blend", imageUrl: "__proto__", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    } as any);

    let container: HTMLElement | null = null;
    expect(() => {
      container = renderWithCtx(React.createElement(CuratorInventoryListView), {
        view: "inv", data, statusFilter: "all",
        imgLocal: {},            // a PLAIN map, exactly as callers pass it
      }).container;
    }).not.toThrow();
    expect(container!.textContent).toContain("Blend");

    // Rendering inside expect(...).not.toThrow() is deliberate — the assertion
    // IS that the render does not throw — and it therefore renders OUTSIDE
    // act(), so React can leave concurrent work queued when this file ends.
    //
    // That once made this file the one a CI run named when it died on an
    // UNHANDLED `ReferenceError: window is not defined`, and an act() flush was
    // appended here in response. It has been REMOVED: the mechanism is React's
    // scheduler yielding through Node's setImmediate, which outlives jsdom, so
    // it belongs to every render and not to this test. `setup.ts` now drains it
    // after every file — see drainScheduler.ts. Do not re-add a local flush;
    // two mechanisms for one guarantee is how the second one rots.
  });
});
