/**
 * MESURE : un ré-import CSV se cumule-t-il sur une cave DÉJÀ dédoublée ?
 *
 * `docs/history.md` portait ce résidu, énoncé et jamais mesuré : « CSV
 * re-import compounds on a cellar that already holds two same-name rows
 * (28/300, announced each time but the recap does not convey that repeating
 * multiplies) ». Il a survécu à plusieurs builds parce qu'il demande un vrai
 * import contre une cave de 300 lignes — ce qu'aucune relecture ne remplace.
 *
 * LE MÉCANISME EST NOMMABLE AVANT D'ÊTRE MESURÉ, et c'est ce qui rend la
 * mesure lisible plutôt qu'anecdotique :
 *   • le CSV ne transporte AUCUN `uid` (vérifié sur les colonnes d'export —
 *     le fichier le dit lui-même : « ni lot ni uid »), donc chaque fiche
 *     entrante est anonyme au sens de la fusion ;
 *   • `resolveMergeMatch` apparie d'abord sur `uid` ; sans uid il retombe sur
 *     `brand|name` ;
 *   • `mergeAmbiguousName` REFUSE cet appariement dès que la cave locale porte
 *     PLUS D'UNE fiche de ce `brand|name` — une ligne anonyme ne peut être
 *     attribuée ni à l'une ni à l'autre, et choisir au hasard serait pire.
 * Donc la fiche est ajoutée comme NEUVE. Le refus est délibéré et correct ;
 * la question ouverte était son CUMUL sur des imports répétés.
 *
 * LE PIPELINE EST LE VRAI, sans rien de simulé au milieu — `buildCsvLines()`
 * (les colonnes d'export réelles) → `parseTobaccoCsv()` (le parseur réel) →
 * `useImportConfirm` en `autoApply:"merge"`. C'est la réserve que j'avais
 * posée en proposant la mesure : une fixture écrite à la main serait ma
 * reconstitution du format, pas le format.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExportImport } from "../hooks/useExportImport";
import { useImportConfirm } from "../hooks/useImportConfirm";
import { parseTobaccoCsv } from "../utils/csvImport";
import { migrateData } from "../utils.ts";
import { INIT } from "../constants";
import { writeFileSync } from "node:fs";

beforeEach(() => { vi.clearAllMocks(); });

/** Vocabulaire inventé — aucune marque réelle dans les fixtures. */
const HOUSES = ["Brackwater", "Halvorsen", "Vondel", "Aldwych", "Corvane", "Østergaard", "Marlow & Finch", "R.T. Mallow"];

function mkTobacco(i: number, uid: string, brand: string, name: string) {
  return {
    id: i, uid, brand, name,
    category: "Anglais", cut: "Ribbon", blend: "", force: "3", roomNote: "3",
    taste: "3", rating: "4", rebuy: true, tastingNotes: "", description: "",
    agingMax: "", imageUrl: "",
    lots: [{
      id: 1000 + i, uid: "lot-" + uid, status: "cellar",
      weightG: "50", weightInitial: "50", originalStatus: "cellar",
      datePurchased: "2024-03-15", dateProduction: "2022",
      boxNumber: String(i), storageLocation: "", price: "14.90",
      seller: "", sellerUrl: "", disposed: false,
    }],
  };
}

/**
 * Une cave de `total` fiches dont `doubled` sont engagées dans des PAIRES de
 * même `brand|name` mais d'uid distincts — exactement l'état « déjà divergé »
 * que la note décrit (deux appareils ayant créé la même fiche séparément, que
 * `mergeRefusedByUid` a refusé de réunir).
 */
function makeCellar(total: number, doubled: number) {
  const tobaccos: any[] = [];
  let i = 1;
  for (let p = 0; p < doubled / 2; p++) {
    const brand = HOUSES[p % HOUSES.length]!;
    const name = "Twinned " + p;
    tobaccos.push(mkTobacco(i, "uid-a-" + p, brand, name)); i++;
    tobaccos.push(mkTobacco(i, "uid-b-" + p, brand, name)); i++;
  }
  while (tobaccos.length < total) {
    tobaccos.push(mkTobacco(i, "uid-u-" + i, HOUSES[i % HOUSES.length]!, "Unique " + i)); i++;
  }
  return { ...INIT, tobaccos, nxT: i, nxP: 1, nxJ: 1, nxW: 1, nxA: 1 };
}

function exportCsv(data: any): string {
  const { result } = renderHook(() => useExportImport({
    data, save: vi.fn(), withPhotos: (d: any) => Promise.resolve(d), nav: vi.fn(),
    t: (k: string) => k, excludeApiKey: false, apiKey: "", weightUnit: "g",
    lengthUnit: "mm", currencySymbol: "€", dateFormat: "fr", ageLabel: () => "",
    stageImport: vi.fn(),
  } as any));
  return result.current.buildCsvLines().join("\r\n");
}

/** Un tour complet export → parse → fusion. Rend la cave d'après + le récap. */
function reimportOnce(cellar: any) {
  const parsed = parseTobaccoCsv(exportCsv(cellar));
  const save = vi.fn();
  let summary: any = null;
  const { result } = renderHook(() => useImportConfirm({
    data: cellar, save, migrateData, saveApiKey: vi.fn(), setImgLocal: vi.fn(),
    setImportModal: vi.fn(), nav: vi.fn(), t: (k: string) => k,
  } as any));
  act(() => {
    result.current.stageImport({ tobaccos: parsed.tobaccos }, "file", {
      autoApply: "merge", onMerged: (s: any) => { summary = s; },
    });
  });
  return { next: save.mock.calls[0]![0], summary, parsedCount: parsed.tobaccos.length };
}

describe("ré-import CSV répété sur une cave déjà dédoublée", () => {
  it("MESURE : trois imports successifs, 300 fiches dont 28 dédoublées", () => {
    let cellar: any = makeCellar(300, 28);
    expect(cellar.tobaccos).toHaveLength(300);

    const trail: Array<{ pass: number; before: number; after: number; added: number; identity: number }> = [];
    for (let pass = 1; pass <= 3; pass++) {
      const before = cellar.tobaccos.length;
      const r = reimportOnce(cellar);
      cellar = r.next;
      trail.push({
        pass, before, after: cellar.tobaccos.length,
        added: cellar.tobaccos.length - before,
        identity: r.summary?.identityConflicts ?? 0,
      });
    }
    if (process.env["COMPOUND_TRAIL_OUT"]) {
      // La sortie console est supprimée par la configuration du run, et la
      // MESURE est le produit de ce test — pas seulement son assertion. Écrite
      // sur demande, pour que le chiffre puisse être lu et reporté.
      writeFileSync(process.env["COMPOUND_TRAIL_OUT"]!, JSON.stringify(trail, null, 2));
    }

    // Ce que la note affirmait : chaque passe ajoute, et répéter multiplie.
    expect(trail[0]!.added).toBeGreaterThan(0);
    expect(trail[1]!.added).toBeGreaterThan(0);
    expect(trail[2]!.added).toBeGreaterThan(0);
  });

  it("CONTRÔLE : une cave SANS doublon ne se cumule pas", () => {
    // Sans cette moitié, la mesure ci-dessus ne distingue pas « le doublon
    // préexistant est la cause » de « tout ré-import CSV ajoute ».
    const cellar: any = makeCellar(300, 0);
    const before = cellar.tobaccos.length;
    const r1 = reimportOnce(cellar);
    const r2 = reimportOnce(r1.next);
    expect(r1.next.tobaccos.length).toBe(before);
    expect(r2.next.tobaccos.length).toBe(before);
  });
});

describe("pourquoi 14 et non 28", () => {
  it("le parseur COLLAPSE les lignes par brand+name : 28 lignes = 14 noms", () => {
    // La note disait « 28/300 ». 28 est le nombre de LIGNES engagées dans un
    // doublon ; ce sont 14 PAIRES, donc 14 `brand|name` distincts. Comme
    // `parseTobaccoCsv` regroupe les lignes par nom, le fichier rend 286 fiches
    // et non 300 — et c'est une fiche ambiguë PAR NOM qui est ajoutée, pas une
    // par ligne. D'où 14 ajouts par passe. La distinction n'est pas cosmétique :
    // elle dit que la croissance suit les NOMS dédoublés, pas les fiches.
    const cellar = makeCellar(300, 28);
    const parsed = parseTobaccoCsv(exportCsv(cellar));
    expect(cellar.tobaccos).toHaveLength(300);
    expect(parsed.tobaccos).toHaveLength(286); // 272 uniques + 14 noms jumelés
  });
});
