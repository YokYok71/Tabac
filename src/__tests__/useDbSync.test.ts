// useDbSync — the shared "Sync with DB" hook.
// Covers the diff computation, the apply patch, and the ghost-click
// defence latch (`applied`) that keeps a tap-catcher mounted briefly so the
// synthetic tap trailing the Synchroniser release can't pop a form <select>.

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CATALOGUE_COLUMNS } from "../utils/userCatalogue";
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

// ─────────────────────────────────────────────────────────────────────────
// La note personnelle n'entre PAS dans le diff — et le cas voisin
// « preserves tasting notes » ne l'établit qu'à moitié.
//
// Sondé : ajouter `tastingNotes` à `FIELDS` laisse la suite verte. La couche
// qui absorbe n'est PAS ce hook, c'est le CATALOGUE : `CATALOGUE_COLUMNS` ne
// porte pas de colonne de notes, donc la valeur côté catalogue est `undefined`
// et le champ ne diverge jamais. La promesse énoncée deux fois dans l'en-tête
// du hook (« la seule chose que la synchronisation ne touche jamais ») repose
// donc aujourd'hui sur la forme d'un AUTRE module.
//
// Les deux assertions ci-dessous la rendent locale : le jour où le catalogue
// gagnerait une colonne de prose personnelle, `FIELDS` redeviendrait la seule
// protection, et elle serait alors couverte. Quand une sonde reste verte, il
// faut savoir QUELLE couche absorbe — et ici, le dire.
describe("useDbSync — la prose de l'utilisateur", () => {
  beforeEach(async () => { await primeDb(); });

  it("`tastingNotes` n'est pas dans la liste des champs synchronisés", () => {
    const src = readFileSync("src/hooks/useDbSync.ts", "utf8");
    const block = src.slice(src.indexOf("const FIELDS = ["), src.indexOf("];", src.indexOf("const FIELDS = [")));
    expect(block, "la liste doit être trouvée, sinon l'assertion est creuse").toContain("description");
    expect(block).not.toContain("tastingNotes");
  });

  it("le catalogue lui-même ne porte aucune colonne de notes personnelles", () => {
    // La raison pour laquelle la sonde reste verte, écrite noir sur blanc.
    expect(CATALOGUE_COLUMNS.some((c) => /note/i.test(c) && !/roomNote/.test(c))).toBe(false);
  });

  it("appliquer ne réécrit jamais la note, même quand tout le reste change", () => {
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useDbSync({ enabled: true, entryId: 1, form: baseForm, dbReady: true, lang: "fr", setForm }),
    );
    expect(result.current.dbSync, "il doit y avoir un diff à appliquer").toBeTruthy();
    act(() => { result.current.applyDbSync(); });
    expect(setForm).toHaveBeenCalled();
    const patch = setForm.mock.calls[0]![0];
    const next = typeof patch === "function" ? patch(baseForm) : patch;
    expect(next.tastingNotes).toBe("keep me");
  });
});
