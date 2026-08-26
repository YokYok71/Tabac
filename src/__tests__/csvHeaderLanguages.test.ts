// Le lecteur CSV comprend les six langues — et le message d'erreur le
// PROMETTAIT déjà dans cinq d'entre elles.
//
// C'est la forme la plus nette de ce défaut : `csv_import_empty` est traduit
// depuis toujours et nomme, dans chaque langue, les deux colonnes obligatoires
// avec les mots de cette langue — « Marca » et « Nombre » en espagnol, „Marke“
// et „Name“ en allemand. Or `HEADER_ALIASES` ne connaissait que le FRANÇAIS et
// l'ANGLAIS. Un lecteur espagnol suivait donc le message à la lettre et
// obtenait le même message. L'app documentait, en cinq langues, un contrat
// qu'elle n'honorait pas.
//
// L'ÉCRIVAIN était français, et ces lignes disaient qu'il devait le rester : un
// fichier exporté sous une langue doit se ré-importer sous une autre, et cela
// ne tenait que tant qu'il existait UNE forme d'en-tête canonique. La prémisse
// est morte au commit suivant, quand le lecteur a appris les six langues —
// l'écrivain les écrit désormais tous (`CSV_COLUMNS`). La phrase est corrigée
// plutôt que supprimée : ce qui a changé est sa RAISON, pas un avis.
//
// L'ORDRE, lui, reste la garantie : le LECTEUR d'abord, l'écrivain ensuite.
// Un ancien build lisant un fichier neuf ne trouve alors ni marque ni nom et
// échoue BRUYAMMENT, au lieu d'atteindre la colonne Statut où l'échec serait
// silencieux.
//
// Ces cas lient la promesse au comportement : pour chaque langue, les mots que
// le message nomme sont ceux qu'on donne au lecteur.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseTobaccoCsv, CSV_DELIM, csvHeader } from "../utils/csvImport.ts";
import { LANGUAGES } from "../i18n/languages.ts";

/** Les deux colonnes obligatoires, telles que chaque langue les nomme —
 *  DÉRIVÉES de la table que l'écrivain utilise, jamais réécrites. Elles étaient
 *  recopiées ici tant que l'écrivain était français et n'en avait pas ; depuis
 *  qu'il en a une, une copie serait une deuxième source de vérité, c'est-à-dire
 *  exactement la panne que `CSV_DELIM` puis `CSV_COLUMNS` ont fermée. */
const IDENTITY: Record<string, [string, string]> = Object.assign(
  Object.create(null),
  Object.fromEntries(
    LANGUAGES.map((l) => [l.code, [csvHeader("brand", l.code), csvHeader("name", l.code)]]),
  ),
);

/** Le mot que l'app affiche pour un lot OUVERT, par langue (`lot_jar`). */
const JAR: Record<string, string> = Object.assign(Object.create(null), {
  fr: "Pot", en: "Jar", es: "Tarro", de: "Glas", it: "Barattolo", pt: "Frasco",
});

function dictValue(lang: string, key: string): string {
  const src = readFileSync(`src/i18n/${lang}.ts`, "utf8");
  const m = new RegExp(`\\b${key}:"((?:[^"\\\\]|\\\\.)*)"`).exec(src);
  expect(m, `${lang}.${key} doit exister`).toBeTruthy();
  return m![1]!;
}

describe("les deux colonnes obligatoires, dans les six langues", () => {
  it("la table de test couvre exactement le registre", () => {
    // Non-vacuité, et garde pour la septième langue : ajouter un dictionnaire
    // sans enseigner ses en-têtes au lecteur laisserait le message promettre
    // des colonnes que l'import refuse.
    const codes = LANGUAGES.map((l) => l.code).sort();
    expect(Object.keys(IDENTITY).sort()).toEqual(codes);
    expect(Object.keys(JAR).sort()).toEqual(codes);
  });

  for (const { code } of LANGUAGES) {
    const [brandCol, nameCol] = IDENTITY[code]!;

    it(`${code} : le message d'erreur nomme bien ces deux colonnes`, () => {
      // La moitié « promesse ». Sans elle, le cas suivant vérifierait que le
      // lecteur accepte des mots que l'app ne conseille à personne.
      const msg = dictValue(code, "csv_import_empty");
      expect(msg, `${code} doit citer sa colonne marque`).toContain(brandCol);
      expect(msg, `${code} doit citer sa colonne nom`).toContain(nameCol);
    });

    it(`${code} : et un fichier écrit avec ces colonnes s'importe`, () => {
      // La moitié « comportement ». C'est exactement ce qu'un lecteur fait
      // après avoir lu le message.
      const head = [brandCol, nameCol].join(CSV_DELIM);
      const r = parseTobaccoCsv(`${head}\nVondel${CSV_DELIM}Nº 7\n`);
      expect(r.tobaccos.length, `${code} : suivre le message doit marcher`).toBe(1);
      expect(r.tobaccos[0]!.brand).toBe("Vondel");
      expect(r.tobaccos[0]!.name).toBe("Nº 7");
    });

    it(`${code} : un lot « ouvert » n'arrive plus SCELLÉ`, () => {
      // Le défaut silencieux, et le pire des quatre : `normStatus` rendait ""
      // pour un mot qu'il ne plaçait pas, et l'appelant faisait `|| "cellar"`.
      // La ligne était par ailleurs parfaite — un pot ouvert importé en boîte
      // scellée, sans un mot.
      const head = [brandCol, nameCol, "Statut"].join(CSV_DELIM);
      const r = parseTobaccoCsv(`${head}\nVondel${CSV_DELIM}Nº 7${CSV_DELIM}${JAR[code]}\n`);
      expect(r.tobaccos[0]!.lots[0]!.status).toBe("jar");
      expect(r.badStatus, "un mot compris ne doit rien signaler").toBe(0);
    });
  }
});

describe("un statut illisible est RAPPORTÉ, pas scellé en silence", () => {
  // Le poids est là pour que la ligne produise vraiment un LOT : sans aucune
  // donnée de lot, `hasLot` est faux et le statut n'est même pas lu — ce qui
  // est juste, mais ne mesure rien.
  const head = ["Marque", "Nom", "Poids (g)", "Statut"].join(CSV_DELIM);
  const row = (st: string) => `Vondel${CSV_DELIM}Nº 7${CSV_DELIM}50${CSV_DELIM}${st}`;

  it("il retombe en cave — le repli reste — mais il se compte", () => {
    const r = parseTobaccoCsv(`${head}\n${row("Zigzag")}\n`);
    expect(r.tobaccos[0]!.lots[0]!.status, "le repli est conservé").toBe("cellar");
    expect(r.badStatus, "…mais il ne doit plus être muet").toBe(1);
    const issue = r.issues.find((i) => i.kind === "status");
    expect(issue, "et la ligne doit être nommable").toBeTruthy();
    expect(issue!.value).toBe("Zigzag");
    expect(issue!.row, "la ligne comptée comme dans un tableur").toBe(2);
  });

  it("une cellule VIDE ne se compte pas — elle veut dire « en cave »", () => {
    // Le contre-cas, et il porte la règle : la plupart des fichiers écrits à
    // la main n'ont pas de colonne Statut du tout. Compter l'absence
    // remplirait le panneau d'anomalies sur un import parfaitement sain.
    const r = parseTobaccoCsv(`${head}\n${row("")}\n`);
    expect(r.tobaccos[0]!.lots[0]!.status).toBe("cellar");
    expect(r.badStatus).toBe(0);
    expect(r.issues.filter((i) => i.kind === "status")).toEqual([]);
  });

  it("aucune colonne Statut du tout ne se compte pas non plus", () => {
    const r = parseTobaccoCsv(
      `Marque${CSV_DELIM}Nom${CSV_DELIM}Poids (g)\nVondel${CSV_DELIM}Nº 7${CSV_DELIM}50\n`,
    );
    expect(r.tobaccos[0]!.lots[0]!.status).toBe("cellar");
    expect(r.badStatus).toBe(0);
  });
});

describe("aucun alias n'en écrase un autre", () => {
  it("deux langues peuvent partager un mot, jamais pour des champs différents", () => {
    // La règle qui rend l'élargissement sûr, re-dérivée sur toute la table.
    // Un homographe est réel : l'italien « Note » (les notes) se replie sur
    // `note`, qui est déjà la NOTE française — d'où `Voto` et
    // `Note di degustazione` du côté italien.
    const src = readFileSync("src/utils/csvImport.ts", "utf8");
    const blk = src.slice(src.indexOf("var HEADER_ALIASES"));
    const body = blk.slice(0, blk.indexOf("};"));
    const pairs = [...body.matchAll(/"([^"]+)"\s*:\s*"(\w+)"/g)];
    expect(pairs.length, "la table doit être trouvée").toBeGreaterThan(100);

    const seen: Record<string, string> = Object.create(null);
    const clashes: string[] = [];
    for (const [, label, key] of pairs) {
      const l = label!, k = key!;
      if (seen[l] !== undefined && seen[l] !== k) clashes.push(`${l}: ${seen[l]} vs ${k}`);
      seen[l] = k;
    }
    expect(clashes, "un homographe ferait lire une colonne pour une autre").toEqual([]);
  });

  it("les clés sont déjà repliées — sinon elles ne seraient jamais trouvées", () => {
    // `foldIndex` replie la clé de recherche, pas la table : une entrée avec
    // une majuscule ou un accent serait morte à l'écriture.
    const src = readFileSync("src/utils/csvImport.ts", "utf8");
    const blk = src.slice(src.indexOf("var HEADER_ALIASES"));
    const body = blk.slice(0, blk.indexOf("};"));
    for (const [, label] of body.matchAll(/"([^"]+)"\s*:\s*"\w+"/g)) {
      expect(label, `« ${label} » doit être en minuscules sans accent`)
        .toBe(label!.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
    }
  });
});

describe("le guide ne promet que des mots que le lecteur place", () => {
  // La moitié « promesse » à l'échelle du GUIDE, et pas seulement du message
  // d'erreur. Les six blocs énumèrent désormais les mots acceptés par la
  // colonne Statut (« Pot, Tarro, Glas, Barattolo, Frasco… ») — une phrase que
  // rien ne vérifiait et qui, écrite à la main dans six langues, est exactement
  // le genre de liste qui dérive dès qu'un mot bouge dans `normStatus`.
  //
  // Elle est vérifiable mécaniquement, donc elle l'est : chaque mot cité doit
  // s'importer en pot. Le contraire — l'app comprend un mot que le guide ne
  // cite pas — n'est PAS une faute et n'est pas asserté : la liste se termine
  // par « … » et sert d'exemples, pas d'inventaire.
  const help = readFileSync("public/help.html", "utf8");

  function blockOf(code: string): string {
    const i = help.indexOf(`id="sec-${code}"`);
    expect(i, `le bloc ${code} doit exister`).toBeGreaterThan(-1);
    const j = help.indexOf('id="sec-', i + 10);
    return help.slice(i, j > 0 ? j : help.length);
  }

  for (const { code } of LANGUAGES) {
    it(`${code} : chaque mot cité pour la colonne Statut s'importe en pot`, () => {
      const blk = blockOf(code);
      // La parenthèse suit immédiatement le nom de la colonne, quel qu'il soit
      // dans cette langue (Statut / Status / Estado / Stato).
      const m = /(?:Statut|Status|Estado|Stato)<\/em>[^(]{0,120}\(([^)]+)\)/.exec(blk);
      expect(m, `${code} : la phrase sur la colonne Statut doit exister`).toBeTruthy();
      const words = m![1]!
        .replace(/<[^>]+>/g, "")
        .split(",")
        .map((w) => w.replace(/…/g, "").trim())
        .filter(Boolean);
      expect(words.length, `${code} : la liste ne doit pas être vide`).toBeGreaterThanOrEqual(4);

      const head = ["Marque", "Nom", "Poids (g)", "Statut"].join(CSV_DELIM);
      for (const w of words) {
        const r = parseTobaccoCsv(`${head}\nVondel${CSV_DELIM}Nº 7${CSV_DELIM}50${CSV_DELIM}${w}\n`);
        expect(r.tobaccos[0]!.lots[0]!.status, `${code} : « ${w} » est cité, il doit être compris`).toBe("jar");
        expect(r.badStatus, `${code} : « ${w} » ne doit rien signaler`).toBe(0);
      }
    });
  }

  it("et plus aucun bloc ne prétend ne connaître que le FR/EN", () => {
    // La phrase remplacée. Elle se CONTREDISAIT déjà — elle annonçait des alias
    // FR/EN puis nommait « Marca » et « Nombre » deux mots plus loin — et le
    // lecteur ne la démentait pas encore. Il la dément maintenant.
    expect(help).not.toContain("FR/EN");
  });
});

describe("l'oui/non des six langues", () => {
  const head = ["Marque", "Nom", "A reprendre"].join(CSV_DELIM);
  const rebuy = (v: string) =>
    parseTobaccoCsv(`${head}\nVondel${CSV_DELIM}Nº 7${CSV_DELIM}${v}\n`).tobaccos[0]!.rebuy;

  it("accepte le OUI de chaque langue", () => {
    for (const v of ["Oui", "Yes", "Sí", "Ja", "Sì", "Sim"]) {
      expect(rebuy(v), `« ${v} » doit valoir oui`).toBe(true);
    }
  });

  it("accepte le NON de chaque langue", () => {
    // `no` couvrait déjà es/it/pt par l'alias anglais ; seul « nein » manquait.
    for (const v of ["Non", "No", "Nein", "Não"]) {
      expect(rebuy(v), `« ${v} » doit valoir non`).toBe(false);
    }
  });

  it("un mot inconnu reste indécis — ni oui ni non", () => {
    expect(rebuy("peut-être")).toBeNull();
  });
});
