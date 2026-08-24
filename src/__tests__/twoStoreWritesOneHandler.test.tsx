// Two store mutations in ONE synchronous handler: the first write must not be
// silently discarded by the second.
//
// THE MECHANISM. Every store builds its payload from the `data` it received
// from the CURRENT render, and App's `save` is a `useCallback([])` that does
// `setData(nd)` + a localStorage write. Inside one handler React has not
// re-rendered between the two calls, so mutation #2 builds on the pre-#1
// snapshot and overwrites #1 in React state AND on disk.
//
// The live instance is `SessionFormView.submit`, the only handler in the app
// that calls two store mutations in sequence: it commits the tasting-notes
// draft (`updateTobaccoTastingNotes`) and then saves the session
// (`addSession` / `updateSession`). The session lands, the lot is debited, and
// `tastingNotes` is back to its old value. (Today the textarea's `onBlur`
// usually commits the notes in an EARLIER event, which masks it.)
//
// The fix is a freshest-payload mirror (`latestData()`), owned by App next to
// `save`, that every store mutation builds on instead of the render snapshot.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { useTobaccoStore } from "../hooks/useTobaccoStore";
import { useSessionStore } from "../hooks/useSessionStore";

function initialData() {
  return {
    tobaccos: [
      {
        id: 1,
        brand: "Halvorsen",
        name: "Bright Ribbon",
        tastingNotes: "old notes",
        lots: [{ id: "L1", status: "jar", weightG: "50", weightInitial: "50" }],
      },
    ],
    pipes: [{ id: 7, brand: "Vondel", name: "Bent" }],
    sessions: [],
    nxJ: 1,
  };
}

// A faithful stand-in for App.tsx's wiring: `save` commits to React state AND
// to the "disk" mirror, and records every payload it was handed. `latestData`
// is the freshest committed payload — the thing a second mutation in the same
// handler must build on.
function useCellarHarness() {
  var _d = React.useState<any>(initialData);
  var data = _d[0];
  var setData = _d[1];
  var dataRef = React.useRef<any>(data);
  var disk = React.useRef<any>(data);
  var saves = React.useRef<any[]>([]);
  var save = React.useCallback(function (nd: any) {
    dataRef.current = nd;
    disk.current = nd;
    saves.current.push(nd);
    setData(nd);
    // `setData` is listed only to keep the warning budget at 7 — a setState
    // function is identity-stable, so this is the same empty-dep callback
    // App.tsx has.
  }, [setData]);
  var latestData = React.useCallback(function () {
    return dataRef.current;
  }, []);
  var tob = useTobaccoStore({
    data: data,
    save: save,
    latestData: latestData,
    nav: vi.fn(),
    setSearch: vi.fn(),
    fromWishRef: { current: null } as any,
  });
  var sess = useSessionStore({
    data: data,
    save: save,
    latestData: latestData,
    nav: vi.fn(),
    weightUnit: "g",
  });
  return { data: data, disk: disk, saves: saves, tob: tob, sess: sess };
}

describe("two store writes in one handler", () => {
  it("keeps the FIRST write when a second mutation follows in the same handler", () => {
    const { result } = renderHook(() => useCellarHarness());
    act(() => {
      result.current.sess.setSessForm(function (f: any) {
        return Object.assign({}, f, {
          date: "2026-05-01",
          tobaccoId: "1",
          pipeId: "7",
          lotId: "L1",
          weightG: "2.5",
        });
      });
    });
    // Grab the FUNCTION REFERENCES now. `renderHook` refreshes
    // `result.current` after every `act`, so reading `result.current.x` a
    // second time inside the handler would hand us a closure built on the
    // ALREADY-updated data and mask the very staleness under test — which is
    // exactly what the real handler does NOT get.
    const commitNotes = result.current.tob.updateTobaccoTastingNotes;
    const addSession = result.current.sess.addSession;
    act(() => {
      commitNotes(1, "fresh notes");
      addSession();
    });
    expect(result.current.disk.current.sessions).toHaveLength(1);
    expect(result.current.disk.current.tobaccos[0].tastingNotes).toBe("fresh notes");
    // and the lot debit from the session survived too
    expect(result.current.disk.current.tobaccos[0].lots[0].weightG).toBe("47.5");
  });

  it("keeps the FIRST write in the reverse order too (session then notes)", () => {
    const { result } = renderHook(() => useCellarHarness());
    act(() => {
      result.current.sess.setSessForm(function (f: any) {
        return Object.assign({}, f, {
          date: "2026-05-01",
          tobaccoId: "1",
          pipeId: "7",
          lotId: "L1",
          weightG: "2.5",
        });
      });
    });
    const commitNotes = result.current.tob.updateTobaccoTastingNotes;
    const addSession = result.current.sess.addSession;
    act(() => {
      addSession();
      commitNotes(1, "fresh notes");
    });
    expect(result.current.disk.current.sessions).toHaveLength(1);
    expect(result.current.disk.current.tobaccos[0].tastingNotes).toBe("fresh notes");
    expect(result.current.disk.current.tobaccos[0].lots[0].weightG).toBe("47.5");
  });

  // NON-VACUITY. A single mutation, the ordinary path, must be unaffected:
  // the fix must not make a lone write read from anywhere but the live data.
  it("a single mutation still behaves exactly as before", () => {
    const { result } = renderHook(() => useCellarHarness());
    const commitNotes = result.current.tob.updateTobaccoTastingNotes;
    act(() => {
      commitNotes(1, "solo");
    });
    expect(result.current.saves.current).toHaveLength(1);
    expect(result.current.disk.current.tobaccos[0].tastingNotes).toBe("solo");
    expect(result.current.disk.current.sessions).toHaveLength(0);
  });

  // NON-VACUITY for the fallback: a store handed NO `latestData` (every
  // existing test, and any future caller that forgets) must still work off
  // the render snapshot rather than crashing.
  it("works without latestData (falls back to the render snapshot)", () => {
    const save = vi.fn();
    const { result } = renderHook(() =>
      useTobaccoStore({
        data: initialData(),
        save: save,
        nav: vi.fn(),
        setSearch: vi.fn(),
        fromWishRef: { current: null } as any,
      }),
    );
    act(() => {
      result.current.updateTobaccoTastingNotes(1, "no-ref");
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].tobaccos[0].tastingNotes).toBe("no-ref");
  });
});

// The behavioural test above can only exercise the STORE half: it supplies its
// own `latestData`. The App half — `save` mirroring every committed payload
// into the ref, and that ref reaching both stores — is invisible to it, and a
// store that is never handed `latestData` silently falls back to the buggy
// behaviour. So assert the wiring at source level. Comments are blanked first:
// this file's own explanation names `latestData` repeatedly, and a check that
// reads its own prose as data is the trap this repo has been caught by before.
describe("App wires the freshest-payload mirror", () => {
  const src = (() => {
    const raw = readFileSync(resolve(__dirname, "..", "App.tsx"), "utf8");
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (m: string) => m.replace(/[^\n]/g, " "));
  })();

  it("save() mirrors its payload into latestDataRef", () => {
    expect(src).toMatch(/latestDataRef\.current\s*=\s*nd\s*;/);
  });

  it("every setData site keeps the ref in step", () => {
    const setDataSites = (src.match(/setData\(/g) || []).length;
    const mirrorSites = (src.match(/latestDataRef\.current\s*=/g) || []).length;
    expect(setDataSites).toBeGreaterThan(0);
    expect(mirrorSites).toBeGreaterThanOrEqual(setDataSites);
  });

  it("both mutating stores receive latestData", () => {
    const tob = src.indexOf("useTobaccoStore({");
    const sess = src.indexOf("useSessionStore({");
    expect(tob).toBeGreaterThan(-1);
    expect(sess).toBeGreaterThan(-1);
    expect(src.slice(tob, tob + 600)).toMatch(/latestData/);
    expect(src.slice(sess, sess + 600)).toMatch(/latestData/);
  });
});
