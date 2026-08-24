// THREE VALUES THAT MADE THE APP NEVER OPEN AGAIN.
//
// All three arrive by the same ordinary door — a JSON import or a cloud
// restore of a file you did not write — and all three are written to disk by
// `save()` BEFORE anything renders, so the next launch fails the same way. And
// neither recovery path helps: `EB.purgeCachesAndReload` and `public/reset.html`
// both clear service workers and Cache Storage and deliberately touch neither
// `localStorage` nor IndexedDB. The only escape was clearing site data or
// deleting the PWA — which loses the cellar.
//
//   (a) an OBJECT in `name` or `brand`. `_coerceStringFields` normalised
//       `number` and `boolean` and let everything else fall through, so the
//       value reached React as a child: "Objects are not valid as a React
//       child". Home mounts on every launch, so this is permanent.
//
//   (b) `rating: 1e999`. `JSON.parse` turns that into `Infinity`, and nothing
//       clamped it: `Stars`' sequenced entry animation registers one timer per
//       star in a `for (i = 1; i <= n; i++)` loop, so opening the fiche locked
//       the main thread outright — the tab had to be force-killed, and every
//       later attempt to open that item did it again. The AUDIT that found it
//       killed a vitest worker after 161 s proving it.
//
//   (c) a prototype member in `ai-provider`. `AI_MODEL_OPTIONS[provider]`
//       resolved to `Object.prototype` — truthy, so the `|| []` fallback never
//       fired — and `.filter` is not a function. Lowest reachability of the
//       three (hand-edited storage only: the `_settings` import path validates
//       this key against a closed set), but it threw on every render of App.
//
// The systemic half of (c) is worth more than the instance: the ESLint rule
// written for exactly this class, `no-dynamic-index-plain-map`, bailed on any
// declaration whose kind was not `const` — and this project declares its
// lookup tables as `export var` throughout, so the rule was blind to nearly
// all of them.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { migrateData } from "../utils.ts";
import { Stars } from "../components/curator/primitives.tsx";
import { AI_MODEL_OPTIONS, AI_MODEL_DEFAULTS } from "../hooks/useAiAutoFill.ts";

function cellar(over: any = {}) {
  return {
    tobaccos: [], pipes: [], accessories: [], wishlist: [], sessions: [],
    nxT: 1, nxP: 1, nxA: 1, nxJ: 1, nxW: 1, ...over,
  } as any;
}

describe("a non-string in a string field cannot reach React", () => {
  // The four launch-blocking fields, measured by sweeping every documented
  // string field × ten hostile values through the real migration and the real
  // views: only these four are rendered by a screen that mounts on EVERY
  // launch, so only these four brick the app rather than one fiche.
  const CASES: [string, any][] = [
    ["object", { fr: "N" }],
    ["array", ["Halvorsen"]],
    ["nested array", [{ a: 1 }]],
  ];

  for (const [what, value] of CASES) {
    it(`coerces ${what} in tobacco.name and .brand`, () => {
      const d = migrateData(cellar({ tobaccos: [{ id: 1, brand: value, name: value, lots: [] }] }));
      expect(typeof d.tobaccos[0].name, "still not a string").toBe("string");
      expect(typeof d.tobaccos[0].brand).toBe("string");
    });

    it(`coerces ${what} in pipe.name and .brand`, () => {
      const d = migrateData(cellar({ pipes: [{ id: 1, brand: value, name: value }] }));
      expect(typeof d.pipes[0].name).toBe("string");
      expect(typeof d.pipes[0].brand).toBe("string");
    });
  }

  it("recovers a plausible value from an array rather than blanking it", () => {
    // `["Halvorsen"]` is a shape a hand-edited or machine-generated file
    // actually produces, and the word in it is the user's data. Blanking would
    // throw away something recoverable; `[object Object]` would leak developer
    // jargon onto a fiche. So: arrays join, objects blank.
    const d = migrateData(cellar({ tobaccos: [{ id: 1, brand: ["Halvorsen"], name: ["Early", "Tide"], lots: [] }] }));
    expect(d.tobaccos[0].brand).toBe("Halvorsen");
    expect(d.tobaccos[0].name).toBe("Early Tide");
  });

  it("blanks an object rather than printing [object Object]", () => {
    const d = migrateData(cellar({ tobaccos: [{ id: 1, brand: { fr: "B" }, name: { fr: "N" }, lots: [] }] }));
    expect(d.tobaccos[0].name).toBe("");
    expect(d.tobaccos[0].brand).toBe("");
  });

  it("leaves ordinary values exactly alone", () => {
    // Non-vacuity: a coercion that rewrote everything would pass all of the
    // above and quietly damage every cellar on load.
    const d = migrateData(cellar({ tobaccos: [{ id: 1, brand: "Vondel", name: "Kade 12", lots: [] }] }));
    expect(d.tobaccos[0].brand).toBe("Vondel");
    expect(d.tobaccos[0].name).toBe("Kade 12");
  });

  it("still coerces the numbers and booleans it always did", () => {
    const d = migrateData(cellar({ tobaccos: [{ id: 1, brand: 12, name: true, lots: [] }] }));
    expect(d.tobaccos[0].brand).toBe("12");
    expect(d.tobaccos[0].name).toBe("true");
  });
});

describe("a rating of Infinity cannot lock the main thread", () => {
  it("migrateData clamps a rating to 0-5", () => {
    const d = migrateData(cellar({
      // Through `JSON.parse`, which is the real door: a backup literally
      // containing `1e999` arrives as `Infinity`. (Writing the literal inline
      // is a lint error in its own right — "will lose precision at runtime".)
      tobaccos: [{ id: 1, brand: "B", name: "N", rating: JSON.parse('{"r":1e999}').r, lots: [] }],
      pipes: [{ id: 1, brand: "B", name: "N", rating: -4 }],
      accessories: [{ id: 1, brand: "B", name: "N", rating: 100000000 }],
      sessions: [{ id: 1, date: "2026-01-01", rating: Infinity }],
    }));
    expect(d.tobaccos[0].rating).toBe(5);
    expect(d.pipes[0].rating).toBe(0);
    expect(d.accessories[0].rating).toBe(5);
    expect(d.sessions[0].rating).toBe(5);
  });

  it("leaves a legitimate rating untouched", () => {
    const d = migrateData(cellar({ tobaccos: [{ id: 1, brand: "B", name: "N", rating: 3, lots: [] }] }));
    expect(d.tobaccos[0].rating).toBe(3);
  });

  it("Stars refuses to schedule more timers than it draws", () => {
    // Defence in depth, and the one that matters: `n` is a PROP, so a value
    // that reached the component by any route other than the migration — a
    // computed average, a future field — must not be able to hang the tab.
    // Only five stars are ever drawn, so more than five timers is waste on any
    // input, hostile or not.
    const spy = vi.spyOn(globalThis, "setTimeout");
    render(<Stars n={Infinity} sequenced />);
    expect(spy.mock.calls.length, "one timer per unit of `n`").toBeLessThanOrEqual(5);
    spy.mockRestore();
  });

  it("…and still animates an ordinary rating", () => {
    // Non-vacuity: clamping to zero would pass the case above and silently
    // kill the entry animation on every fiche in the app.
    const spy = vi.spyOn(globalThis, "setTimeout");
    render(<Stars n={4} sequenced />);
    expect(spy.mock.calls.length).toBe(4);
    spy.mockRestore();
  });
});

describe("a forged provider cannot resolve to Object.prototype", () => {
  for (const forged of ["__proto__", "constructor", "toString", "valueOf"]) {
    it(`AI_MODEL_OPTIONS[${forged}] is undefined, not a prototype member`, () => {
      expect((AI_MODEL_OPTIONS as any)[forged]).toBeUndefined();
    });
    it(`AI_MODEL_DEFAULTS[${forged}] is undefined too`, () => {
      expect((AI_MODEL_DEFAULTS as any)[forged]).toBeUndefined();
    });
  }

  it("the real providers still resolve", () => {
    // Non-vacuity: a map that returned undefined for everything would pass the
    // cases above and break the model picker outright.
    for (const p of ["anthropic", "openai", "gemini"]) {
      expect(Array.isArray((AI_MODEL_OPTIONS as any)[p]), p).toBe(true);
      expect(typeof (AI_MODEL_DEFAULTS as any)[p], p).toBe("string");
    }
  });
});
