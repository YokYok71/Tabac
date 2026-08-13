// useDbSync — the shared "Sync with DB" hook.
// Covers the diff computation, the apply patch, and the ghost-click
// defence latch (`applied`) that keeps a tap-catcher mounted briefly so the
// synthetic tap trailing the Synchroniser release can't pop a form <select>.

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadCatalogueFixture, resetCatalogueFixture } from "./catalogueFixture";

// The app ships no catalogue — a test that needs one has to
// supply it. The committed excerpt, through the real parser.
vi.mock("../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
}));
import { useDbSync } from "../hooks/useDbSync";
import { _resetTobaccoDbForTests, loadTobaccoDb } from "../utils/tobaccoDb";

async function primeDb() {
  resetCatalogueFixture();
  _resetTobaccoDbForTests();
  await loadTobaccoDb();
}

// Halvorsen Duskfall is "Anglais" / "Ribbon" in the catalog.
const baseForm = {
  id: 1, brand: "Halvorsen", name: "Duskfall",
  category: "Aromatique", // diverges from the catalog's "Anglais"
  cut: "", blend: "", force: 0, roomNote: 0, taste: 0, agingMax: "",
  description: "", tastingNotes: "keep me",
};

describe("useDbSync", () => {
  beforeEach(async () => { await primeDb(); });

  it("surfaces a diff when the form diverges from the catalog", () => {
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useDbSync({ enabled: true, entryId: 1, form: baseForm, dbReady: true, lang: "fr", setForm }),
    );
    expect(result.current.dbSync).toBeTruthy();
    const cat = result.current.dbSync!.diffs.find((d: any) => d.field === "category");
    expect(cat?.db).toBe("Anglais");
    expect(result.current.applied).toBe(false);
  });

  it("applyDbSync patches divergent fields, preserves tasting notes, and flips `applied`", () => {
    vi.useFakeTimers();
    try {
      const setForm = vi.fn();
      const { result } = renderHook(() =>
        useDbSync({ enabled: true, entryId: 1, form: baseForm, dbReady: true, lang: "fr", setForm }),
      );
      act(() => { result.current.applyDbSync(); });
      expect(setForm).toHaveBeenCalledTimes(1);
      const patch = setForm.mock.calls[0]![0];
      expect(patch.category).toBe("Anglais");           // catalog value applied
      expect(patch.tastingNotes).toBe("keep me");       // user prose preserved
      // Ghost-click latch is on immediately after apply…
      expect(result.current.applied).toBe(true);
      // …and clears itself after the defence window.
      act(() => { vi.advanceTimersByTime(500); });
      expect(result.current.applied).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismissDbSync hides the notice for the current entry", () => {
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useDbSync({ enabled: true, entryId: 1, form: baseForm, dbReady: true, lang: "fr", setForm }),
    );
    expect(result.current.dbSync).toBeTruthy();
    act(() => { result.current.dismissDbSync(); });
    expect(result.current.dbSync).toBeNull();
  });

  it("no diff when disabled or the DB isn't ready", () => {
    const setForm = vi.fn();
    const off = renderHook(() =>
      useDbSync({ enabled: false, entryId: 1, form: baseForm, dbReady: true, lang: "fr", setForm }),
    );
    expect(off.result.current.dbSync).toBeNull();
    const notReady = renderHook(() =>
      useDbSync({ enabled: true, entryId: 1, form: baseForm, dbReady: false, lang: "fr", setForm }),
    );
    expect(notReady.result.current.dbSync).toBeNull();
  });
});
