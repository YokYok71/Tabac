// driving the REAL hook, because the two fixes that had no
// test here both stayed GREEN under probe.
//
// `userCatalogueSection.test.tsx` is source-level: it locks placement, the
// three-state meta, and which strings the panel renders. What it structurally
// cannot see is what the hook DOES over time — and that is where both of this
// build's silent defects lived:
//
//   • `badCategory` / `badCut` were derived by filtering `issues`, which is
//     capped at MAX_CATALOGUE_ISSUES. `catalogueAudit.test.ts` now covers the
//     PARSER's exact counters, and a probe reverting the HOOK to the filtered
//     derivation stayed green against it — the parser was right and nobody
//     checked the hook read it. The lesson: the wiring is what rots.
//
//   • the audit report survived both « Retirer le catalogue » and loading a
//     DIFFERENT file, so the panel described a catalogue that was gone, or
//     reported the previous file's rows under the new file's name.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// One in-memory catalogue, driven by the tests. `catalogueSave` mirrors the
// real contract closely enough for these cases: it RESOLVES a result object
// (never rejects) and refuses a parse that yields nothing.
let stored: { csv: string; meta: any } | null = null;
vi.mock("../utils/catalogueStore.ts", () => ({
  catalogueSave: (csv: string, name: string, nowMs: number) => {
    const r = parseCatalogueCsv(csv);
    if (!r.db) return Promise.resolve({ ok: false });
    const meta = { name, loadedAt: nowMs, blends: r.blends, brands: r.brands, rows: r.rows };
    stored = { csv, meta };
    return Promise.resolve({ ok: true, meta });
  },
  catalogueClear: () => { stored = null; return Promise.resolve(true); },
  catalogueGetMeta: () => Promise.resolve(stored ? stored.meta : null),
  catalogueGetCsv: () => Promise.resolve(stored ? stored.csv : null),
}));
vi.mock("../utils/tobaccoDb.ts", () => ({ tobaccoDbInvalidate: vi.fn() }));

import { tobaccoDbInvalidate } from "../utils/tobaccoDb";
import { useUserCatalogue } from "../hooks/useUserCatalogue";
import { parseCatalogueCsv, MAX_CATALOGUE_ISSUES } from "../utils/userCatalogue";

const HEAD = "brand_key,brand_name,blend_name,category,cut,force,roomNote,taste";
const row = (o: Record<string, string> = {}) => {
  const b: Record<string, string> = {
    brand_key: "Halvorsen", brand_name: "Halvorsen", blend_name: "Duskfall",
    category: "Anglais", cut: "Ribbon", force: "4", roomNote: "3", taste: "4",
  };
  Object.assign(b, o);
  return HEAD.split(",").map((h) => b[h] ?? "").join(",");
};
const csv = (...rows: string[]) => [HEAD].concat(rows).join("\n") + "\n";

function mount() {
  return renderHook(() => useUserCatalogue({ dlFile: () => true }));
}
/** Put a catalogue in the store without going through the file picker. */
async function seed(text: string) {
  const r = parseCatalogueCsv(text);
  stored = { csv: text, meta: { name: "c.csv", loadedAt: 1, blends: r.blends, brands: r.brands, rows: r.rows } };
}

beforeEach(() => { stored = null; });

describe("the audit reads the parser's EXACT counts", () => {
  it("THE POINT: a cap filled by other issues still reports the bad cuts", async () => {
    // Identical shape to the parser case, driven through the hook — because
    // that is the layer the probe showed to be unguarded.
    const noId = Array.from({ length: MAX_CATALOGUE_ISSUES },
      (_, i) => row({ brand_key: "", brand_name: "", blend_name: "N" + i }));
    const bad = Array.from({ length: 30 }, (_, i) => row({ blend_name: "B" + i, cut: "Zigzag Cut" }));
    await seed(csv(...noId, ...bad));

    const { result } = mount();
    await act(async () => { result.current.auditCatalogue(); });
    await waitFor(() => expect(result.current.catalogueAudit).toBeTruthy());

    const a = result.current.catalogueAudit!;
    expect(a.issues.length, "detail capped").toBe(MAX_CATALOGUE_ISSUES);
    expect(a.issues.some((i: any) => i.kind === "cut"), "no cut row fits").toBe(false);
    expect(a.badCut, "…and the panel reports them anyway").toBe(30);
    expect(a.truncated).toBe(true);
  });

  it("a clean catalogue reports zero, so the case above is not vacuous", async () => {
    await seed(csv(row(), row({ blend_name: "Other" })));
    const { result } = mount();
    await act(async () => { result.current.auditCatalogue(); });
    await waitFor(() => expect(result.current.catalogueAudit).toBeTruthy());
    expect(result.current.catalogueAudit!.badCategory).toBe(0);
    expect(result.current.catalogueAudit!.badCut).toBe(0);
    expect(result.current.catalogueAudit!.issues).toEqual([]);
  });
});

describe("the report must not outlive the catalogue it describes", () => {
  it("removing the catalogue clears the audit panel", async () => {
    await seed(csv(row({ category: "Pipeweed" })));
    const { result } = mount();
    await act(async () => { result.current.auditCatalogue(); });
    await waitFor(() => expect(result.current.catalogueAudit).toBeTruthy());
    expect(result.current.catalogueAudit!.badCategory).toBe(1);

    await act(async () => { result.current.clearCatalogue(); });
    await waitFor(() => expect(result.current.catalogueMeta).toBeNull());
    expect(result.current.catalogueAudit, "a report about a file that is gone").toBeNull();
  });

  it("clearing the audit by hand still works — the fix is not the only route", async () => {
    await seed(csv(row({ category: "Pipeweed" })));
    const { result } = mount();
    await act(async () => { result.current.auditCatalogue(); });
    await waitFor(() => expect(result.current.catalogueAudit).toBeTruthy());
    act(() => { result.current.clearCatalogueAudit(); });
    expect(result.current.catalogueAudit).toBeNull();
  });

  it("WORSE THAN STALE: loading another file must not report the old one's rows", async () => {
    // A second catalogue is loaded through the real picker path. Without the
    // reset the panel keeps the previous file's issues while the section header
    // above it names the NEW file.
    await seed(csv(row({ category: "Pipeweed" }), row({ blend_name: "B", cut: "Zigzag Cut" })));
    const { result } = mount();
    await act(async () => { result.current.auditCatalogue(); });
    await waitFor(() => expect(result.current.catalogueAudit).toBeTruthy());
    expect(result.current.catalogueAudit!.issues.length).toBe(2);

    // Drive loadCatalogueFile: it builds its own <input>, so intercept the
    // click and hand it a file.
    const clean = csv(row(), row({ blend_name: "Other" }));
    const realCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el: any = realCreate(tag as any);
      if (tag === "input") {
        el.click = () => {
          Object.defineProperty(el, "files", { value: [new File([clean], "new.csv", { type: "text/csv" })] });
          if (el.onchange) el.onchange({} as any);
        };
      }
      return el;
    }) as any);
    await act(async () => { result.current.loadCatalogueFile(); });
    spy.mockRestore();

    await waitFor(() => expect(result.current.catalogueMeta?.name).toBe("new.csv"));
    expect(result.current.catalogueAudit,
      "the old file's rows under the new file's name").toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Le cache de `tobaccoDb` est invalidé à CHAQUE changement — et les deux
// appels étaient assertés par rien.
//
// `loadTobaccoDb` garde le catalogue en mémoire de module pour toute la
// session : sans l'invalidation, l'app continue de répondre depuis le
// PRÉCÉDENT catalogue jusqu'au prochain rechargement complet. L'utilisateur
// charge son fichier, voit l'ancien contenu, et conclut que l'import n'a pas
// marché. Au RETRAIT, c'est pire dans l'autre sens : le catalogue est effacé du
// stockage et les recherches continuent de le servir, donc le bouton paraît
// mort alors qu'il a bien supprimé.
//
// Sondé une porte à la fois : neutraliser l'un des deux appels laissait la
// suite entièrement verte. Le mock du module en tête de fichier est déjà un
// `vi.fn()`, donc il n'y avait qu'à le regarder.
describe("le cache du catalogue est invalidé aux deux portes", () => {
  function pickFile(text: string, name: string) {
    const realCreate = document.createElement.bind(document);
    return vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el: any = realCreate(tag as any);
      if (tag === "input") {
        el.click = () => {
          Object.defineProperty(el, "files", { value: [new File([text], name, { type: "text/csv" })] });
          if (el.onchange) el.onchange({} as any);
        };
      }
      return el;
    }) as any);
  }

  it("CHARGER un catalogue invalide le cache", async () => {
    const inv = vi.mocked(tobaccoDbInvalidate);
    inv.mockClear();
    const { result } = mount();
    const spy = pickFile(csv(row(), row({ blend_name: "Other" })), "new.csv");
    await act(async () => { result.current.loadCatalogueFile(); });
    spy.mockRestore();
    await waitFor(() => expect(result.current.catalogueMeta?.name).toBe("new.csv"));
    expect(inv, "sinon les recherches servent encore l'ancien fichier").toHaveBeenCalled();
  });

  it("RETIRER le catalogue invalide le cache aussi", async () => {
    await seed(csv(row()));
    const inv = vi.mocked(tobaccoDbInvalidate);
    const { result } = mount();
    await waitFor(() => expect(result.current.catalogueMeta).toBeTruthy());
    inv.mockClear();
    await act(async () => { result.current.clearCatalogue(); });
    await waitFor(() => expect(result.current.catalogueMeta).toBeNull());
    expect(inv, "un catalogue retiré doit cesser de répondre").toHaveBeenCalled();
  });

  it("un écran qui ne change RIEN n'invalide pas — la moitié qui doit rester", async () => {
    // Contre-cas : invalider à chaque rendu viderait le cache en boucle et
    // ferait repayer la lecture IndexedDB sur chaque surface du catalogue.
    await seed(csv(row()));
    const inv = vi.mocked(tobaccoDbInvalidate);
    const { result } = mount();
    await waitFor(() => expect(result.current.catalogueMeta).toBeTruthy());
    inv.mockClear();
    await act(async () => { result.current.auditCatalogue(); });
    await waitFor(() => expect(result.current.catalogueAudit).toBeTruthy());
    expect(inv).not.toHaveBeenCalled();
  });
});
