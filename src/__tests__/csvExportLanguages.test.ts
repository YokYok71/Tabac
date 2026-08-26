// L'app écrit son CSV dans la langue active — et l'aller-retour est le contrat
// que cela met en jeu, donc il est éprouvé DIRECTEMENT plutôt que promis.
//
// Ces cas pilotent le VRAI `buildCsvLines` (via le vrai hook) dans le VRAI
// `parseTobaccoCsv`, pour chaque langue du registre. Ils ne réécrivent aucune
// table : ils DÉRIVENT les en-têtes et les valeurs attendus de `CSV_COLUMNS` /
// `CSV_VALUES`, sans quoi ils en seraient une deuxième copie — précisément la
// panne qui a fait naître `CSV_DELIM`.
//
// L'ORDRE DES DEUX MOITIÉS EST LA GARANTIE, et il vaut d'être dit : le lecteur
// a appris les six langues AVANT que l'écrivain n'en émette une. C'est ce qui
// rend le basculement sûr, et c'est aussi ce que ces cas mesurent — chaque
// cellule émise doit se replier sur le champ qui la porte.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useExportImport } from "../hooks/useExportImport";
import {
  parseTobaccoCsv,
  csvHeader,
  csvValue,
  csvLang,
  _CSV_COLUMNS_FOR_TESTS as CSV_COLUMNS,
  _CSV_VALUES_FOR_TESTS as CSV_VALUES,
} from "../utils/csvImport";
import { LANGUAGES } from "../i18n/languages";
import { INIT } from "../constants";

beforeEach(() => { vi.clearAllMocks(); });

/** Une cave d'un mélange portant les TROIS statuts, pour que chaque valeur
 *  fermée soit réellement émise au moins une fois. Un lot par statut : sans
 *  cela, « Aufgeraucht » ne serait écrit par personne et le cas serait creux. */
function makeCellar() {
  const lot = (id: number, status: string, extra: Record<string, any>) => ({
    id, status, weightG: "50", weightInitial: "50",
    originalStatus: status === "finished" ? "cellar" : status,
    datePurchased: "2024-03-15", dateProduction: "2022",
    boxNumber: String(id), storageLocation: "Armoire A", price: "14.90",
    seller: "smokingpipes.com", sellerUrl: "", disposed: false, ...extra,
  });
  return {
    ...INIT,
    tobaccos: [{
      id: 1, brand: "Brackwater", name: "Duskfall",
      category: "Anglais", cut: "Ribbon", blend: "Virginia, Latakia",
      force: "4", roomNote: "3", taste: "3", rating: "4", rebuy: true,
      tastingNotes: "", description: "", agingMax: "12", imageUrl: "",
      lots: [
        lot(100, "cellar", {}),
        lot(101, "jar", { dateOpened: "2025-06-01" }),
        lot(102, "finished", { dateOpened: "2025-01-02", dateFinished: "2025-06-30", disposed: true }),
      ],
    }],
    nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
  };
}

function exportCsv(data: any, lang: string): string {
  const { result } = renderHook(() =>
    useExportImport({
      data, save: vi.fn(),
      withPhotos: vi.fn().mockImplementation((d: any) => Promise.resolve(d)),
      nav: vi.fn(), t: (k: string) => k, excludeApiKey: false, apiKey: "",
      weightUnit: "g", lengthUnit: "mm", currencySymbol: "€", dateFormat: "fr",
      ageLabel: () => "", stageImport: vi.fn(), lang,
    } as any),
  );
  return result.current.buildCsvLines().join("\r\n");
}

describe("un export se ré-importe dans chaque langue", () => {
  for (const { code } of LANGUAGES) {
    it(`${code} : l'aller-retour rend les mêmes données`, () => {
      const csv = exportCsv(makeCellar(), code);
      const r = parseTobaccoCsv(csv);

      // La moitié qui compte : chaque cellule émise a été COMPRISE. Si un
      // en-tête ne se repliait pas, la colonne serait muette et le champ vide.
      expect(r.tobaccos.length, `${code} : le mélange doit revenir`).toBe(1);
      const tb = r.tobaccos[0]!;
      expect(tb.brand).toBe("Brackwater");
      expect(tb.name).toBe("Duskfall");
      expect(tb.category).toBe("Anglais");
      expect(tb.cut).toBe("Ribbon");
      expect(tb.blend).toBe("Virginia, Latakia");
      expect(String(tb.force)).toBe("4");
      expect(String(tb.roomNote), `${code} : Room Note est une colonne à donnée`).toBe("3");
      expect(String(tb.taste)).toBe("3");
      expect(String(tb.rating)).toBe("4");
      expect(tb.rebuy, `${code} : le mot « oui » de cette langue`).toBe(true);
      expect(tb.agingMax).toBe("12");

      // Les trois statuts, dans l'ordre où ils ont été écrits. C'est le défaut
      // silencieux qui a motivé tout ceci : un mot non placé retombe en cave.
      expect(tb.lots.map((l: any) => l.status)).toEqual(["cellar", "jar", "finished"]);
      expect(tb.lots[2]!.disposed, `${code} : « éliminé » doit survivre`).toBe(true);
      expect(tb.lots.map((l: any) => l.weightG)).toEqual(["50", "50", "50"]);
      // Le prix est comparé en NOMBRE : le lecteur normalise « 14.90 » en
      // « 14.9 », ce qu'il a toujours fait et qui est juste — la cellule porte
      // un nombre, pas une chaîne. Épingler la chaîne mesurerait le formatage
      // et non l'aller-retour.
      expect(tb.lots.map((l: any) => parseFloat(l.price))).toEqual([14.9, 14.9, 14.9]);
      expect(tb.lots.map((l: any) => l.boxNumber)).toEqual(["100", "101", "102"]);
      expect(tb.lots[0]!.storageLocation).toBe("Armoire A");
      expect(tb.lots[1]!.dateOpened).toBe("2025-06-01");
      expect(tb.lots[2]!.dateFinished).toBe("2025-06-30");

      // …et RIEN n'a été signalé : un en-tête compris de travers se verrait
      // aussi ici, sans quoi le cas ci-dessus pourrait passer par accident.
      expect(r.skipped, `${code} : aucune ligne perdue`).toBe(0);
      expect(r.badStatus, `${code} : aucun statut illisible`).toBe(0);
      expect(r.badCategory + r.badCut, `${code} : la taxonomie reste lisible`).toBe(0);
    });

    it(`${code} : l'en-tête est réellement écrit dans cette langue`, () => {
      // Le contre-cas. Sans lui, un `csvHeader` qui rendrait toujours le
      // français passerait l'aller-retour ci-dessus à la perfection — le
      // lecteur comprend le français — et la fonctionnalité entière serait
      // verte sans exister.
      const head = exportCsv(makeCellar(), code).split(/\r?\n/)[0]!;
      expect(head, `${code} : la colonne marque`).toContain(csvHeader("brand", code));
      expect(head, `${code} : la colonne nom`).toContain(csvHeader("name", code));
      expect(head, `${code} : la colonne statut`).toContain(csvHeader("status", code));
      if (code !== "fr") {
        expect(head, `${code} ne doit pas rendre l'en-tête français`)
          .not.toContain(CSV_COLUMNS["brand"]!["fr"]!);
      }
    });

    it(`${code} : les VALEURS aussi sont écrites dans cette langue`, () => {
      // CE CAS EXISTE PARCE QU'UNE SONDE EST RESTÉE VERTE. Remettre les
      // statuts français en dur dans l'export ne rougissait RIEN : le lecteur
      // comprend le français dans toutes les langues, donc l'aller-retour
      // passait, et le contre-cas ci-dessus ne regarde que les EN-TÊTES.
      // La couche absorbante était le lecteur lui-même.
      // `csvEsc` cite CHAQUE cellule, donc les guillemets se retirent avant de
      // comparer — sans quoi le cas échouerait même en français et
      // accuserait le code au lieu de son propre découpage.
      const rows = exportCsv(makeCellar(), code).split(/\r?\n/).slice(1);
      const cells = rows.join(";").split(";").map((c) => c.replace(/^"|"$/g, ""));
      for (const st of ["cellar", "jar", "finished"] as const) {
        expect(cells, `${code} : « ${csvValue(st, code)} » doit être écrit`)
          .toContain(csvValue(st, code));
      }
      if (code !== "fr") {
        for (const st of ["cellar", "jar", "finished"] as const) {
          const fr = CSV_VALUES[st]!["fr"]!;
          if (fr === csvValue(st, code)) continue; // un mot que les deux partagent
          expect(cells, `${code} ne doit pas écrire le mot français « ${fr} »`).not.toContain(fr);
        }
      }
    });
  }
});

describe("les deux tables couvrent le registre, sans trou", () => {
  it("chaque champ porte les six langues", () => {
    const codes = LANGUAGES.map((l) => l.code).sort();
    for (const [field, row] of Object.entries(CSV_COLUMNS)) {
      expect(Object.keys(row).sort(), `champ ${field}`).toEqual(codes);
      for (const c of codes) {
        expect(String(row[c] || "").trim(), `${field}.${c} ne doit pas être vide`).not.toBe("");
      }
    }
    expect(Object.keys(CSV_COLUMNS).length, "la table ne doit pas être vide").toBeGreaterThan(20);
  });

  it("chaque valeur fermée porte les six langues", () => {
    const codes = LANGUAGES.map((l) => l.code).sort();
    for (const [key, row] of Object.entries(CSV_VALUES)) {
      expect(Object.keys(row).sort(), `valeur ${key}`).toEqual(codes);
    }
  });

  // Le bloc TABACS est le seul que le lecteur analyse : `parseTobaccoCsv`
  // s'arrête au premier marqueur `=== SECTION ===`. Les colonnes des quatre
  // autres blocs sont donc d'affichage pur et ne portent AUCUNE contrainte de
  // repliement — les lister ici serait exiger d'elles une garantie qui n'a pas
  // de sens, c'est-à-dire la garde trop stricte qui fait réécrire du code juste.
  const DISPLAY_ONLY = new Set([
    "age", "pipeModel", "shape", "bend", "length", "filterType", "chamberDiameter",
    "chamberDepth", "bowlMaterial", "stemMaterial", "finish", "notes", "priority",
    "accType", "fuel", "sessDate", "sessTime", "sessTobacco", "sessPipe",
    "duration", "smoked", "aromas", "place", "city", "country", "lat", "lng",
  ]);

  it("chaque en-tête du bloc TABACS se replie bien sur SON champ", () => {
    // La garantie, dérivée plutôt que réécrite : l'écrivain ne peut pas émettre
    // une colonne que le lecteur attribuerait à un autre champ — ce serait pire
    // qu'une colonne muette, la donnée atterrirait ailleurs.
    let checked = 0;
    for (const { code } of LANGUAGES) {
      for (const field of Object.keys(CSV_COLUMNS)) {
        if (DISPLAY_ONLY.has(field)) continue;
        checked++;
        const header = csvHeader(field, code);
        const r = parseTobaccoCsv(
          `${csvHeader("brand", code)};${csvHeader("name", code)};${header}\nBrackwater;Duskfall;x\n`,
        );
        expect(r.headers, `${code}/${field} : « ${header} » doit être reconnu`).toContain(field);
      }
    }
    // Non-vacuité : élargir `DISPLAY_ONLY` par mégarde viderait la boucle sans
    // rien rougir — un contrôle qui a cessé de contrôler.
    expect(checked, "la boucle doit avoir examiné le bloc tabacs").toBeGreaterThan(100);
  });

  it("et les colonnes d'affichage pur portent bien les six langues aussi", () => {
    // Elles échappent au repliement, pas à la traduction : c'est ce qui évite
    // le fichier MIXTE (bloc tabacs traduit, quatre autres en français).
    const codes = LANGUAGES.map((l) => l.code).sort();
    let seen = 0;
    for (const field of DISPLAY_ONLY) {
      const row = CSV_COLUMNS[field];
      expect(row, `${field} doit exister dans la table`).toBeTruthy();
      expect(Object.keys(row!).sort(), `champ ${field}`).toEqual(codes);
      seen++;
    }
    expect(seen).toBe(DISPLAY_ONLY.size);
  });

  it("chaque valeur fermée est un mot que le lecteur place", () => {
    const head = "Marque;Nom;Poids (g);Statut;A reprendre";
    for (const { code } of LANGUAGES) {
      for (const st of ["cellar", "jar", "finished"] as const) {
        const r = parseTobaccoCsv(`${head}\nBrackwater;Duskfall;50;${csvValue(st, code)};\n`);
        expect(r.tobaccos[0]!.lots[0]!.status, `${code} : « ${csvValue(st, code)} »`).toBe(st);
      }
      const yes = parseTobaccoCsv(`${head}\nBrackwater;Duskfall;50;;${csvValue("yes", code)}\n`);
      expect(yes.tobaccos[0]!.rebuy, `${code} : oui`).toBe(true);
      const no = parseTobaccoCsv(`${head}\nBrackwater;Duskfall;50;;${csvValue("no", code)}\n`);
      expect(no.tobaccos[0]!.rebuy, `${code} : non`).toBe(false);
    }
  });
});

describe("le MODÈLE se remplit et se ré-importe dans chaque langue", () => {
  // Le parcours réel de l'utilisateur non francophone, et la raison d'être de
  // tout ceci : on télécharge le modèle PARCE QU'ON NE SAIT PAS quelles
  // colonnes écrire. Le vérifier sur l'export seul laisserait la porte
  // d'entrée — la seule que personne ne relit avant de s'en servir — couverte
  // par rien.
  function templateCsv(lang: string): string {
    let text = "";
    const RealBlob = (globalThis as any).Blob;
    (globalThis as any).Blob = class extends RealBlob {
      constructor(parts: any[], o: any) { super(parts, o); text = String(parts[0]); }
    };
    (globalThis as any).URL.createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const { result } = renderHook(() =>
      useExportImport({
        data: { ...INIT }, save: vi.fn(),
        withPhotos: vi.fn().mockImplementation((d: any) => Promise.resolve(d)),
        nav: vi.fn(), t: (k: string) => k, excludeApiKey: false, apiKey: "",
        weightUnit: "g", lengthUnit: "mm", currencySymbol: "€", dateFormat: "fr",
        ageLabel: () => "", stageImport: vi.fn(), lang,
      } as any),
    );
    result.current.doDownloadCsvTemplate();
    (globalThis as any).Blob = RealBlob;
    return text;
  }

  for (const { code } of LANGUAGES) {
    it(`${code} : le modèle téléchargé s'importe tel quel`, () => {
      const r = parseTobaccoCsv(templateCsv(code));
      // Deux lignes d'exemple pour UN mélange, donc deux lots.
      expect(r.tobaccos.length, `${code} : le modèle doit produire un mélange`).toBe(1);
      expect(r.tobaccos[0]!.lots.length, `${code} : ses deux lots d'exemple`).toBe(2);
      // Les deux statuts d'exemple, dans l'ordre — c'est ce que le modèle
      // DÉMONTRE au lecteur : le mot que l'app attend dans sa langue.
      expect(r.tobaccos[0]!.lots.map((l: any) => l.status)).toEqual(["jar", "cellar"]);
      expect(r.tobaccos[0]!.rebuy, `${code} : le « oui » d'exemple`).toBe(true);
      expect(r.badStatus, `${code} : rien à signaler sur notre propre modèle`).toBe(0);
      expect(r.skipped, `${code} : aucune ligne perdue`).toBe(0);
    });
  }

  it("et son en-tête est bien celui de la langue demandée", () => {
    // Contre-cas : sans lui, un modèle resté français passerait les six cas
    // ci-dessus sans faillir, puisque le lecteur comprend le français.
    for (const { code } of LANGUAGES) {
      const head = templateCsv(code).split(/\r?\n/)[0]!;
      expect(head, `${code} : la colonne marque`).toContain(csvHeader("brand", code));
      if (code !== "fr") {
        expect(head, `${code} ne doit pas rendre l'en-tête français`)
          .not.toContain(CSV_COLUMNS["brand"]!["fr"]!);
      }
    }
  });

  it("et ses VALEURS d'exemple aussi — c'est ce que le modèle démontre", () => {
    // DEUXIÈME fois que la même sonde reste verte pour la même raison :
    // remettre « Pot » et « Oui » en dur dans les lignes d'exemple ne
    // rougissait rien, le lecteur comprenant le français. Or le modèle existe
    // pour MONTRER à un lecteur le mot que l'app attend dans SA langue — un
    // modèle qui montre le mot français ne remplit pas son office même si le
    // fichier s'importe. La couche absorbante est, encore, le lecteur.
    for (const { code } of LANGUAGES) {
      const rows = templateCsv(code).split(/\r?\n/).slice(1);
      const cells = rows.join(";").split(";").map((c) => c.replace(/^"|"$/g, ""));
      for (const key of ["jar", "cellar", "yes"] as const) {
        expect(cells, `${code} : le modèle doit montrer « ${csvValue(key, code)} »`)
          .toContain(csvValue(key, code));
        if (code === "fr") continue;
        const fr = CSV_VALUES[key]!["fr"]!;
        if (fr === csvValue(key, code)) continue;
        expect(cells, `${code} ne doit pas montrer le mot français « ${fr} »`).not.toContain(fr);
      }
    }
  });
});

describe("un code inconnu retombe sur la forme CANONIQUE", () => {
  it("csvLang rend « fr » et non « en » pour une langue que l'app n'écrit pas", () => {
    // Le repli est le FRANÇAIS ici, à l'inverse du reste de l'app. Ce module
    // produit la forme que tout build a toujours sue lire : un code inconnu
    // doit donner le fichier le plus ré-importable, pas le plus lisible.
    expect(csvLang("zz")).toBe("fr");
    expect(csvLang("")).toBe("fr");
    expect(csvLang(undefined)).toBe("fr");
    expect(csvLang("__proto__"), "une clé forgée ne doit pas traverser").toBe("fr");
    expect(csvLang("de")).toBe("de");
  });

  it("et l'export d'une langue inconnue se ré-importe quand même", () => {
    const r = parseTobaccoCsv(exportCsv(makeCellar(), "zz"));
    expect(r.tobaccos.length).toBe(1);
    expect(r.tobaccos[0]!.lots.map((l: any) => l.status)).toEqual(["cellar", "jar", "finished"]);
  });
});
