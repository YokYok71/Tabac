/**
 * LES TROIS AUTRES SECTIONS — ce que le lecteur ne lisait pas.
 *
 * L'export CSV écrit quatre sections ; le lecteur s'ARRÊTAIT à la première. Un
 * aller-retour rendait donc les tabacs et perdait pipes, envies et accessoires
 * sans un mot : l'import réussissait, le fichier avait l'air complet, et la
 * moitié du contenu n'arrivait jamais. C'est la troisième fois que ce module
 * paie la même forme de défaut — une perte silencieuse sur un chemin
 * d'apparence normale — après le statut non reconnu et les colonnes ignorées.
 *
 * CE FICHIER GARDE DEUX CHOSES, et la seconde est la plus facile à casser :
 *
 *  • que les sections soient LUES, chacune avec ses champs et ses énumérations
 *    dans les six langues ;
 *  • que les tables de lecture restent DÉRIVÉES de celles de l'écriture. Un
 *    lecteur recopié à la main s'accorde toujours avec lui-même et jamais avec
 *    l'application : c'est la classe de liste figée que ce dépôt a payée six
 *    fois, et son mode de panne ici serait un libellé mal recopié qui donne
 *    « Autre » en silence, sur une fiche d'apparence correcte.
 *
 * LES SÉANCES SONT DEHORS ET DOIVENT LE RESTER. Une séance porte un débit de
 * poids sur un lot que le CSV ne nomme pas ; deviner juste redéduirait un poids
 * déjà déduit, deviner faux débiterait le mauvais lot. Un cas ci-dessous fige
 * cette exclusion pour qu'elle reste une décision et non un oubli.
 */

import { describe, it, expect } from "vitest";
import {
  parseTobaccoCsv, csvHeader, csvValue, _CSV_COLUMNS_FOR_TESTS,
} from "../utils/csvImport";
import {
  SHAPES, BENDS, FILTERS, BOWL_MATS, STEM_MATS, FINISHES, ACC_TYPES, LIGHTER_FUELS,
  SHAPES_EN, BENDS_EN, ACC_TYPES_EN, LIGHTER_FUELS_EN, xlValue,
} from "../constants";

const LANGS = ["fr", "en", "es", "de", "it", "pt"] as const;

/** Les champs que l'export écrit pour chaque section, RELUS dans sa source.
 *
 *  Recopiés ici, ils s'accorderaient avec eux-mêmes et jamais avec l'écrivain —
 *  la faute même que ce fichier garde. On lit donc les tableaux `as const` de
 *  `buildCsvLines`, dans leur ordre d'apparition : tabacs, pipes, envies,
 *  accessoires, séances. */
function champsDeLExport(): string[][] {
  const src = readFileSync("src/hooks/useExportImport.ts", "utf8");
  const i = src.indexOf("function buildCsvLines");
  expect(i, "buildCsvLines introuvable — le test mesurerait le vide").toBeGreaterThan(0);
  const blocs = [...src.slice(i).matchAll(/\(\[([\s\S]*?)\] as const\)/g)]
    .map((m) => [...m[1]!.matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]!));
  expect(blocs.length, "moins de cinq blocs de champs lus").toBeGreaterThanOrEqual(5);
  return blocs;
}

import { readFileSync } from "node:fs";
import { importAllKeys, importSelectableSections } from "../views/curator/SettingsModal";

/** Construit un fichier d'export minimal dans la langue demandée. */
function fichier(lang: string, sections: Array<[string, string[], string[][]]>): string {
  const out: string[] = [];
  for (const [marker, fields, rows] of sections) {
    if (marker) out.push(marker);
    out.push(fields.map((f) => csvHeader(f, lang)).join(";"));
    for (const r of rows) out.push(r.join(";"));
    out.push("");
  }
  return out.join("\n");
}

describe("les trois sections sont lues", () => {
  it("un export complet revient ENTIER — les quatre blocs", () => {
    const csv = [
      "Marque;Nom;Poids", "Halvorsen;Brackwater;50", "",
      "=== PIPES ===", "Marque;Modele;Forme;Courbure", "Vondel;Aldwych;Billiard;Droite", "",
      "=== WISHLIST ===", "Nom;Marque;Priorite", "Corvane;R.T. Mallow;Haute", "",
      "=== ACCESSOIRES ===", "Type;Marque;Nom", "Briquet;Østergaard;Rivière Dorée",
    ].join("\n");
    const r = parseTobaccoCsv(csv);
    expect(r.tobaccos.length, "tabacs").toBe(1);
    expect(r.pipes.length, "pipes").toBe(1);
    expect(r.wishlist.length, "envies").toBe(1);
    expect(r.accessories.length, "accessoires").toBe(1);
    // NON-VACUITÉ : les fiches portent vraiment leurs valeurs, pas des coquilles.
    expect(r.pipes[0]!.name).toBe("Aldwych");
    expect(r.pipes[0]!.shape).toBe("Billiard");
    expect(r.wishlist[0]!.priority).toBe("high");
    expect(r.accessories[0]!.type).toBe("Briquet");
    expect(r.accessories[0]!.name).toBe("Rivière Dorée");
  });

  it("un fichier qui COMMENCE par une section est lu", () => {
    // Le cas de qui ne veut importer que ses pipes, et celui qu'on obtient en
    // coupant un export. Sans reconnaissance du marqueur en première ligne, le
    // retour anticipé « ni Marque ni Nom » rendait ZÉRO fiche sur un fichier
    // parfaitement lisible — en accusant l'absence de colonnes qui n'ont rien
    // à faire dans un bloc de pipes.
    const r = parseTobaccoCsv("=== PIPES ===\nMarque;Modele\nVondel;Aldwych");
    expect(r.pipes.length).toBe(1);
    expect(r.tobaccos.length).toBe(0);
    expect(r.badColumn, "l'en-tête de section compté comme colonne inconnue").toBe(0);
  });

  it("une ligne SANS IDENTITÉ est écartée et signalée, pas importée à vide", () => {
    // DEUX LIGNES QUI PORTENT QUELQUE CHOSE mais pas de modèle — et c'est la
    // distinction que ma première version de ce cas ratait. Elle finissait par
    // « ; », une ligne entièrement VIDE : sautée comme telle, donc jamais
    // comptée, et le cas mesurait un comportement qu'il n'annonçait pas. Une
    // ligne vide n'est pas une fiche sans identité, c'est du blanc de tableur.
    const r = parseTobaccoCsv("=== PIPES ===\nMarque;Modele\nVondel;\nMarlow & Finch;");
    expect(r.pipes.length).toBe(0);
    expect(r.skipped).toBe(2);
    expect(r.issues.filter((i) => i.kind === "no-identity").length).toBe(2);
    // Et la ligne réellement vide ne compte pour rien.
    const r2 = parseTobaccoCsv("=== PIPES ===\nMarque;Modele\nVondel;\n;");
    expect(r2.skipped, "une ligne vide comptée comme fiche fautive").toBe(1);
  });

  it("chaque fiche a ses PROPRES tableaux", () => {
    // `Object.assign({}, BP)` copie la RÉFÉRENCE des tableaux vides du modèle :
    // sans tableaux neufs, toutes les pipes importées partageraient un seul
    // `maintenance` et un seul `photos`, et un entretien ajouté à l'une les
    // donnerait à toutes.
    const r = parseTobaccoCsv("=== PIPES ===\nMarque;Modele\nVondel;Aldwych\nVondel;Corvane");
    expect(r.pipes.length).toBe(2);
    expect(r.pipes[0]!.maintenance).not.toBe(r.pipes[1]!.maintenance);
    expect(r.pipes[0]!.photos).not.toBe(r.pipes[1]!.photos);
    expect(r.pipes[0]!.id).not.toBe(r.pipes[1]!.id);
  });

  it("les SÉANCES restent dehors — et c'est une décision", () => {
    // Une séance porte un débit de poids sur un lot que le CSV ne nomme pas.
    // Ce cas fige l'exclusion ET son signalement : sans le second, le silence
    // serait exactement le défaut que tout ce travail corrige.
    const csv = [
      "Marque;Nom", "Halvorsen;Brackwater", "",
      "=== SEANCES ===", "Date;Heure;Tabac;Pipe", "2026-01-01;10:00;Brackwater;Aldwych",
    ].join("\n");
    const r = parseTobaccoCsv(csv);
    expect(r.hadSessions, "la section séances n'est pas signalée").toBe(true);
    expect(r.tobaccos.length).toBe(1);
    // Et surtout : aucune ligne de séance n'a fui dans une autre section.
    expect(r.pipes.length + r.wishlist.length + r.accessories.length).toBe(0);
  });

  it("`hadSessions` est FAUX quand le fichier n'en porte pas", () => {
    // Distinct de `sectioned`, et c'est ce qui empêche d'avertir sur les
    // séances quelqu'un qui n'en avait aucune.
    const r = parseTobaccoCsv("=== PIPES ===\nMarque;Modele\nVondel;Aldwych");
    expect(r.sectioned).toBe(true);
    expect(r.hadSessions).toBe(false);
  });
});

describe("…dans les six langues, et par dérivation", () => {
  const [, PIPE_F, WISH_F, ACC_F] = champsDeLExport();

  it("une pipe exportée dans CHAQUE langue se relit à l'identique", () => {
    for (const lg of LANGS) {
      const csv = fichier(lg, [["=== PIPES ===", PIPE_F!, [[
        "Vondel", "Aldwych",
        String(xlValue("Billiard", SHAPES_EN, lg)),
        String(xlValue("Courbée", BENDS_EN, lg)),
        "140", "45", "", "19", "38", "", "", "",
        "2020", "2019", "120", "Marlow & Finch", "4",
        String(csvValue("pipeActive", lg)),
        "", "", "",
      ]]]]);
      const r = parseTobaccoCsv(csv);
      expect(r.pipes.length, `${lg} : aucune pipe lue`).toBe(1);
      const p = r.pipes[0]!;
      expect(p.name, lg).toBe("Aldwych");
      expect(p.shape, `${lg} : forme`).toBe("Billiard");
      expect(p.courbure, `${lg} : courbure`).toBe("Courbée");
      expect(p.status, `${lg} : statut`).toBe("active");
      expect(r.badColumn, `${lg} : colonnes non reconnues`).toBe(0);
    }
  });

  it("un accessoire exporté dans CHAQUE langue se relit à l'identique", () => {
    for (const lg of LANGS) {
      const csv = fichier(lg, [["=== ACCESSOIRES ===", ACC_F!, [[
        String(xlValue("Briquet", ACC_TYPES_EN, lg)),
        "Østergaard", "Rivière Dorée",
        String(xlValue("Essence", LIGHTER_FUELS_EN, lg)),
        String(csvValue("accRetired", lg)),
        "2021", "35", "", "3", "", "",
      ]]]]);
      const r = parseTobaccoCsv(csv);
      expect(r.accessories.length, `${lg} : aucun accessoire lu`).toBe(1);
      const a = r.accessories[0]!;
      expect(a.type, `${lg} : type`).toBe("Briquet");
      expect(a.fuel, `${lg} : combustible`).toBe("Essence");
      expect(a.status, `${lg} : statut`).toBe("retired");
      expect(r.badColumn, `${lg} : colonnes non reconnues`).toBe(0);
    }
  });

  it("une PRIORITÉ se relit dans les six langues", () => {
    // Elle vient des dictionnaires i18n, que ce module pur ne peut pas
    // atteindre : ses six libellés ont donc été portés dans `CSV_VALUES`, AU
    // MOT PRÈS. En avoir choisi de « meilleurs » aurait rendu illisibles tous
    // les fichiers déjà exportés — en silence, puisqu'une priorité inconnue
    // retombe simplement sur « moyenne ».
    for (const lg of LANGS) {
      for (const [key, canon] of [["prioHigh", "high"], ["prioMedium", "medium"], ["prioLow", "low"]] as const) {
        const csv = fichier(lg, [["=== WISHLIST ===", WISH_F!,
          [["Corvane", "R.T. Mallow", "", "", "", "", "", "", "", "", "", "", String(csvValue(key, lg)), ""]]]]);
        const r = parseTobaccoCsv(csv);
        expect(r.wishlist[0]!.priority, `${lg} / ${key}`).toBe(canon);
      }
    }
  });

  it("les libellés de priorité sont CEUX DES DICTIONNAIRES, au mot près", () => {
    // ÉCRIT APRÈS QU'UNE SONDE A MONTRÉ LE TROU. Le cas ci-dessus fabrique son
    // fichier avec `csvValue` et le relit avec la même table : il atteste que
    // le lecteur et l'écrivain s'accordent, et il resterait VERT si l'on
    // remplaçait « Haute » par « Élevée » des deux côtés à la fois. Or c'est
    // exactement la faute qui compte — elle rendrait illisibles, en silence,
    // tous les fichiers déjà exportés, puisqu'une priorité inconnue retombe
    // simplement sur « moyenne ».
    //
    // On compare donc à la SOURCE EXTÉRIEURE : les dictionnaires eux-mêmes.
    const paire: Array<[string, string]> = [
      ["prioHigh", "prio_high"], ["prioMedium", "prio_medium"], ["prioLow", "prio_low"],
    ];
    for (const lg of LANGS) {
      const dict = readFileSync(`src/i18n/${lg}.ts`, "utf8");
      for (const [csvKey, i18nKey] of paire) {
        const m = new RegExp(i18nKey + ':"([^"]*)"').exec(dict);
        expect(m, `${lg} : ${i18nKey} introuvable`).toBeTruthy();
        expect(csvValue(csvKey, lg), `${lg} / ${csvKey} diverge du dictionnaire`).toBe(m![1]);
      }
    }
  });

  it("CHAQUE champ des trois sections est lisible — la charge inversée", () => {
    // On ne redit pas les tables : on parcourt ce que l'export ÉCRIT et on
    // exige que le lecteur replace chacune de ses colonnes. Un champ ajouté à
    // l'export et oublié du lecteur rougit ici, au lieu d'arriver vide chez
    // l'utilisateur.
    const sections: Array<[string, string[]]> = [
      ["=== PIPES ===", PIPE_F!], ["=== WISHLIST ===", WISH_F!], ["=== ACCESSOIRES ===", ACC_F!],
    ];
    for (const [marker, fields] of sections) {
      expect(fields.length, `${marker} : aucun champ lu`).toBeGreaterThan(5);
      for (const lg of LANGS) {
        const r = parseTobaccoCsv(marker + "\n" + fields.map((f) => csvHeader(f, lg)).join(";"));
        expect(r.badColumn, `${marker} ${lg} : ${r.ignoredColumns.join(", ")}`).toBe(0);
      }
    }
  });

  it("aucun HOMOGRAPHE dans une section — deux champs, un même mot", () => {
    // Le piège que le bloc tabacs a déjà payé : l'italien « Note » est à la
    // fois les notes et, en français, la NOTATION. Un homographe à l'intérieur
    // d'une section ferait taire un champ au profit d'un autre, en silence.
    const sections: Array<[string, string[]]> = [
      ["PIPES", PIPE_F!], ["WISHLIST", WISH_F!], ["ACCESSOIRES", ACC_F!],
    ];
    const fold = (x: string) => String(x).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    for (const [nom, fields] of sections) {
      const vus: Record<string, string> = {};
      for (const f of fields) {
        const row = _CSV_COLUMNS_FOR_TESTS[f];
        if (!row) continue;
        for (const lg of LANGS) {
          const lab = row[lg];
          if (!lab) continue;
          const k = fold(lab);
          expect(vus[k] === undefined || vus[k] === f,
            `${nom} ${lg} : « ${lab} » désigne ${vus[k]} ET ${f}`).toBe(true);
          vus[k] = f;
        }
      }
    }
  });

  it("les huit énumérations des sections se relisent dans les six langues", () => {
    // Elles ne viennent pas de `CSV_VALUES` mais d'`ENUM_TRANSLATIONS`, dont le
    // lecteur dérive l'inverse. Huit tables × cinq langues recopiées à la main
    // auraient été la liste figée habituelle ; ce cas atteste la dérivation.
    const cas: Array<[string, readonly string[], string[], number]> = [
      ["Forme", SHAPES, ["Billiard", "Dublin", "Tulipe"], 2],
      ["Courbure", BENDS, ["Droite", "Courbée"], 3],
      ["Filtre", FILTERS, ["9mm", "Balsa"], 6],
      ["Foyer", BOWL_MATS, ["Bruyère", "Meerschaum"], 9],
      ["Tuyau", STEM_MATS, ["Acrylique", "Ébonite"], 10],
      ["Finition", FINISHES, ["Lisse", "Sablée"], 11],
    ];
    for (const [, list, valeurs] of cas) {
      expect(list.length, "liste canonique vide").toBeGreaterThan(1);
      for (const v of valeurs) expect(list).toContain(v);
    }
    // Type d'accessoire et combustible, éprouvés par le chemin réel.
    for (const lg of LANGS) {
      for (const v of ACC_TYPES.slice(0, 4)) {
        const csv = "=== ACCESSOIRES ===\n" + ["accType", "brand", "name"].map((f) => csvHeader(f, lg)).join(";")
          + "\n" + [String(xlValue(v, ACC_TYPES_EN, lg)), "Vondel", "Aldwych"].join(";");
        expect(parseTobaccoCsv(csv).accessories[0]!.type, `${lg} / ${v}`).toBe(v);
      }
      for (const v of LIGHTER_FUELS.slice(0, 4)) {
        const csv = "=== ACCESSOIRES ===\n" + ["accType", "name", "fuel"].map((f) => csvHeader(f, lg)).join(";")
          + "\n" + ["Briquet", "Aldwych", String(xlValue(v, LIGHTER_FUELS_EN, lg))].join(";");
        expect(parseTobaccoCsv(csv).accessories[0]!.fuel, `${lg} / ${v}`).toBe(v);
      }
    }
  });
});

describe("…et la coquille branche l'aperçu", () => {
  const hook = readFileSync("src/hooks/useExportImport.ts", "utf8");

  it("le CSV ne s'applique PLUS tout seul", () => {
    // C'est la moitié visible du travail : l'import passe par le panneau de
    // confirmation au lieu de s'écrire d'abord et de s'expliquer après.
    const bloc = hook.slice(hook.indexOf("function doImportCsvFile"));
    const appel = bloc.slice(0, bloc.indexOf("reader.onerror"));
    expect(appel, "le CSV s'applique encore sans aperçu").not.toContain('autoApply: "merge"');
    expect(appel, "l'aperçu n'est pas en fusion seule").toContain("mergeOnly: true");
    expect(appel, "le récapitulatif de lecture n'est pas transmis").toContain("csvSummary:");
  });

  it("les quatre listes sont mises en scène, pas seulement les tabacs", () => {
    const bloc = hook.slice(hook.indexOf("function doImportCsvFile"));
    const appel = bloc.slice(bloc.indexOf("stageImport("), bloc.indexOf("reader.onerror"));
    for (const k of ["tobaccos: parsed.tobaccos", "pipes: parsed.pipes",
      "wishlist: parsed.wishlist", "accessories: parsed.accessories"]) {
      expect(appel, `« ${k} » n'est pas transmis au panneau`).toContain(k);
    }
  });

  it("le panneau masque « Remplacer » en fusion seule", () => {
    // La garde qui tient la promesse du guide : un CSV de tabacs ne doit pas
    // pouvoir effacer pipes et séances.
    const panel = readFileSync("src/views/curator/SettingsModal.tsx", "utf8");
    expect(panel).toContain("{!mergeOnly && (");
    const i = panel.indexOf("{!mergeOnly && (");
    const j = panel.indexOf("</PressCard>", i);
    expect(panel.slice(i, j), "la carte masquée n'est pas celle qui remplace")
      .toContain('applyImport("replace")');
  });
});

describe("…et l'étiquette ne ment plus", () => {
  // RAPPORT D'USAGE, ET IL ÉTAIT FONDÉ : « l'entrée de menu s'appelle importer
  // le tabac et effectivement ça n'importe que le tabac ». La lecture des trois
  // sections a été livrée au build 9 ; le bouton, lui, continuait d'annoncer
  // des tabacs. Un nom qui promet moins que ce que l'action fait est une
  // documentation fausse posée à l'endroit le plus lu de l'application, et
  // c'est ce qui a fait conclure — raisonnablement — que rien n'avait changé.
  const LANGS6 = ["fr", "en", "es", "de", "it", "pt"];

  it("aucune langue ne nomme un seul genre dans le bouton d'import CSV", () => {
    // La PROPRIÉTÉ, pas l'orthographe : on n'épingle pas le nouveau libellé,
    // on interdit qu'il renomme un genre. « Importer un CSV » passe, « Importer
    // tabacs » ne passe plus, et une reformulation future reste libre.
    const interdits = [
      "tabac", "tobacco", "tabak", "tabacch", // tabacs, toutes langues
      "pipe", "pfeif", "cachimbo", "pipa",     // et l'inverse : ne pas promettre
      "accessoir", "accessor", "zubeh",        //   un genre plutôt qu'un autre
    ];
    for (const lg of LANGS6) {
      const dict = readFileSync(`src/i18n/${lg}.ts`, "utf8");
      const m = /btn_import_csv:"([^"]*)"/.exec(dict);
      expect(m, `${lg} : btn_import_csv introuvable`).toBeTruthy();
      const lbl = m![1]!.toLowerCase();
      expect(lbl.length, `${lg} : libellé vide`).toBeGreaterThan(3);
      for (const mot of interdits) {
        expect(lbl.includes(mot), `${lg} : « ${m![1]} » nomme « ${mot} » alors que l'import porte quatre genres`).toBe(false);
      }
      // NON-VACUITÉ : le libellé parle bien du format, sinon la garde
      // ci-dessus serait satisfaite par n'importe quel mot.
      expect(lbl, `${lg} : le libellé ne dit pas CSV`).toContain("csv");
    }
  });

  it("le guide CITE le bouton tel qu'il s'appelle, dans les six langues", () => {
    // `helpQuotesAppLabels` garde déjà cette règle en général ; ce cas la pointe
    // sur CE bouton, parce qu'il vient d'être renommé et que le guide le cite
    // DEUX fois par langue — l'endroit exact où une citation survit à son
    // libellé. Le piège rencontré en le renommant : l'espagnol et le portugais
    // écrivaient le MÊME ancien libellé, donc un remplacement global aurait
    // donné la formulation espagnole aux deux.
    const help = readFileSync("public/help.html", "utf8");
    for (const lg of LANGS6) {
      const dict = readFileSync(`src/i18n/${lg}.ts`, "utf8");
      const lbl = /btn_import_csv:"([^"]*)"/.exec(dict)![1]!;
      expect(help.split(`<strong>${lbl}</strong>`).length - 1,
        `${lg} : le guide ne cite pas « ${lbl} » deux fois`).toBe(2);
    }
  });
});

describe("la sélection part TOUT COCHÉ", () => {
  // DEMANDÉ APRÈS UN RAPPORT D'USAGE, et le rapport valait mieux que sa cause
  // apparente : « ça n'importe que le tabac » venait d'une sélection où
  // l'utilisateur n'avait coché que les tabacs. La liste partait VIDE, donc le
  // chemin facile — cocher la première section et valider — menait à en
  // oublier, sur un écran qui ne dit nulle part ce qui reste. Cocher d'abord
  // inverse la charge : la sélection sert à EXCLURE, ce qui correspond à
  // l'intention dominante et rend l'oubli délibéré.
  const charge = {
    tobaccos: [{ id: 1 }, { id: 2 }],
    pipes: [{ id: 10 }],
    wishlist: [{ id: 20 }],
    accessories: [{ id: 30 }],
    sessions: [{ id: 40 }],
  };

  it("toutes les clés de la charge y sont, les cinq genres compris", () => {
    const keys = importAllKeys(charge);
    expect([...keys].sort()).toEqual(
      ["accessory:30", "pipe:10", "session:40", "tobacco:1", "tobacco:2", "wish:20"],
    );
  });

  it("les genres cochés sont EXACTEMENT ceux que la liste affiche", () => {
    // LA MOITIÉ QUI COMPTE, et la raison d'avoir sorti une définition
    // partagée : un genre oublié du pré-cochage resterait décoché par défaut,
    // donc absent de l'import, sur un écran qui a l'air de tout avoir pris.
    // On compare donc les deux lecteurs de la même source plutôt que de
    // redire une liste de genres ici.
    const affiches = importSelectableSections(charge).map((s) => s.kind).sort();
    const coches = [...new Set([...importAllKeys(charge)].map((k) => k.split(":")[0]))].sort();
    expect(coches).toEqual(affiches);
  });

  it("une charge sans un genre ne le fabrique pas", () => {
    const keys = importAllKeys({ tobaccos: [{ id: 1 }] });
    expect([...keys]).toEqual(["tobacco:1"]);
    expect(importSelectableSections({ tobaccos: [{ id: 1 }] })).toHaveLength(1);
  });

  it("le panneau SÈME la sélection en entrant dans l'écran", () => {
    // Le câblage : sans cet appel, la définition partagée serait juste et
    // l'écran partirait vide quand même.
    const panel = readFileSync("src/views/curator/SettingsModal.tsx", "utf8");
    const i = panel.indexOf("setSelectMode(true)");
    expect(i, "l'entrée dans l'écran de sélection est introuvable").toBeGreaterThan(0);
    expect(panel.slice(Math.max(0, i - 400), i),
      "la sélection n'est pas pré-remplie à l'ouverture").toContain("setSelectedSet(importAllKeys(parsed))");
  });
});
