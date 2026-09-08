/**
 * LES COLONNES IGNORÉES — le rapport, et la liste qui l'empêche de crier au loup.
 *
 * Une colonne d'en-tête que le lecteur ne sait pas placer était sautée EN
 * SILENCE : l'import réussissait, le rapport ne disait rien, et l'utilisateur
 * découvrait plus tard que « Blend » ou « Tin date » n'étaient jamais arrivés.
 * C'est la forme de panne que ce dépôt a déjà payée sur le statut non reconnu —
 * une ligne d'apparence parfaite, amputée — et elle frappe précisément le
 * premier peuplement d'une cave, le seul moment où l'utilisateur n'a rien à
 * quoi comparer.
 *
 * DEUX MOITIÉS, et la seconde est la plus fragile :
 *
 *  • le rapport doit VOIR une colonne étrangère ;
 *  • il doit se TAIRE sur les colonnes que l'application écrit elle-même et ne
 *    relit pas volontairement. Sans cela il se déclencherait sur CHAQUE
 *    aller-retour d'un export — l'usage le plus courant de l'import — en
 *    accusant l'app de ses propres colonnes. Un avertissement qui se trompe à
 *    tous les coups est un avertissement qu'on apprend à ne plus lire, ce qui
 *    détruirait la valeur des vrais.
 *
 * `CSV_UNREAD_BY_DESIGN` est écrite à la main, donc c'est la classe de liste
 * figée trouvée six fois dans ce dépôt. La charge est inversée ici : on lit les
 * colonnes que `buildCsvLines` écrit RÉELLEMENT et on exige que chacune soit
 * lisible OU inscrite dans la liste. Une colonne d'export nouvelle et non lue
 * rougit, au lieu de devenir une fausse alerte permanente chez l'utilisateur —
 * c'est-à-dire au seul endroit où personne ne la verrait.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseTobaccoCsv, CSV_UNREAD_BY_DESIGN, MAX_IGNORED_COLUMNS,
  csvHeader, _CSV_COLUMNS_FOR_TESTS,
} from "../utils/csvImport";

const LANGS = ["fr", "en", "es", "de", "it", "pt"];

/** Les colonnes que l'export tabac écrit, lues dans la source de l'export.
 *
 *  RELUES PLUTÔT QUE RECOPIÉES : une liste recopiée s'accorde toujours avec
 *  elle-même et jamais avec l'application. C'est le premier tableau de champs
 *  que `buildCsvLines` pousse, celui du bloc tabacs. */
function colonnesDeLExportTabac(): string[] {
  const src = readFileSync("src/hooks/useExportImport.ts", "utf8");
  const i = src.indexOf("function buildCsvLines");
  expect(i, "buildCsvLines introuvable — le test mesurerait le vide").toBeGreaterThan(0);
  const bloc = /\(\[([\s\S]*?)\] as const\)/.exec(src.slice(i));
  expect(bloc, "premier tableau de champs introuvable").toBeTruthy();
  return [...bloc![1]!.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]!);
}

describe("colonnes ignorées — le rapport", () => {
  it("une colonne étrangère est SIGNALÉE, avec son libellé d'origine", () => {
    // Le cas d'usage : une cave montée dans un tableur personnel.
    //
    // LES LIBELLÉS SONT VÉRIFIÉS ÉTRANGERS CI-DESSOUS, PAS SUPPOSÉS TELS. Ma
    // première version prenait « Blend » pour une colonne inconnue ; c'est
    // l'alias ANGLAIS de « Composition », donc parfaitement lu, et le cas
    // mesurait le contraire de ce qu'il annonçait. La table d'en-têtes couvre
    // six langues : une intuition sur ce qu'elle ignore ne vaut rien.
    const csv = "Marque;Nom;Tin date;Rayon\nHalvorsen;Brackwater;2021;3";
    const r = parseTobaccoCsv(csv);
    expect(r.tobaccos.length, "l'import doit RÉUSSIR — la colonne ignorée n'est pas une erreur").toBe(1);
    expect(r.headers, "« Tin date » serait donc lue — l'échantillon est creux").not.toContain("dateProduction");
    expect(r.badColumn).toBe(2);
    expect(r.ignoredColumns).toEqual(["Tin date", "Rayon"]);
    // Le libellé est rendu BRUT : l'utilisateur doit reconnaître ce qu'il lit
    // dans son tableur, pas une forme repliée qu'il n'a jamais écrite.
    expect(r.ignoredColumns.join(""), "libellés repliés au lieu d'être bruts")
      .not.toContain("tin date");
  });

  it("elles arrivent dans la liste d'anomalies, à la ligne de l'en-tête", () => {
    // C'est ce qui les fait apparaître dans le panneau existant sans qu'on
    // touche à un composant : le panneau groupe par `kind` et affiche `row`.
    const r = parseTobaccoCsv("Marque;Nom;Qté\nHalvorsen;Brackwater;3");
    const cols = r.issues.filter((i) => i.kind === "column");
    expect(cols.length).toBe(1);
    expect(cols[0]!.row, "la ligne 1 EST celle de l'en-tête").toBe(1);
    expect(cols[0]!.value).toBe("Qté");
  });

  it("une colonne VIDE ou DUPLIQUÉE ne compte pas", () => {
    // Les tableurs produisent des en-têtes vides en pagaille (colonne de
    // travail effacée, point-virgule final) : ils ne désignent aucune donnée.
    // Et une colonne répétée est une colonne, pas deux problèmes.
    const r = parseTobaccoCsv("Marque;Nom;;Qté;Qté;\nHalvorsen;Brackwater;;3;3;");
    expect(r.badColumn).toBe(1);
    expect(r.ignoredColumns).toEqual(["Qté"]);
  });

  it("un fichier ILLISIBLE dit quand même ce qu'il a lu", () => {
    // Sans identité, l'import échoue avec « aucun tabac valide trouvé » — un
    // message qui dit ce qui n'a pas marché sans dire pourquoi. C'est le cas
    // où les libellés lus valent le plus cher.
    const r = parseTobaccoCsv("Brand name;Product;Amount\nHalvorsen;Brackwater;50");
    expect(r.tobaccos.length).toBe(0);
    expect(r.badColumn).toBe(3);
    expect(r.ignoredColumns).toEqual(["Brand name", "Product", "Amount"]);
  });

  it("la liste est bornée, le COMPTE reste exact", () => {
    const n = MAX_IGNORED_COLUMNS + 10;
    const head = ["Marque", "Nom"].concat(
      Array.from({ length: n }, (_v, i) => "Inconnue" + i),
    ).join(";");
    const r = parseTobaccoCsv(head + "\nHalvorsen;Brackwater" + ";x".repeat(n));
    expect(r.badColumn, "le compte a été borné avec la liste").toBe(n);
    expect(r.ignoredColumns.length).toBe(MAX_IGNORED_COLUMNS);
  });
});

describe("…et il se TAIT sur nos propres colonnes", () => {
  it("un aller-retour d'export ne signale RIEN, dans les six langues", () => {
    // LA MOITIÉ QUI PROTÈGE LE RAPPORT DE LUI-MÊME. Si ce cas tombe, chaque
    // réimport d'un export accuse l'application de sa propre colonne « Âge ».
    for (const lg of LANGS) {
      const head = colonnesDeLExportTabac().map((f) => csvHeader(f, lg)).join(";");
      const r = parseTobaccoCsv(head);
      expect(r.badColumn, `${lg} : ${r.ignoredColumns.join(", ")}`).toBe(0);
    }
  });

  it("CHAQUE colonne de l'export est lisible, ou déclarée non lue", () => {
    // LA CHARGE INVERSÉE. On ne redit pas la liste : on parcourt ce que
    // l'export écrit et on exige une justification pour chaque manquante.
    const cols = colonnesDeLExportTabac();
    expect(cols.length, "aucune colonne lue — le cas serait creux").toBeGreaterThan(20);
    expect(cols).toContain("brand");

    // TROIS ÉTATS ET NON DEUX — ma première version de ce cas s'est trompée
    // ici, et la sonde l'a dit. Une colonne peut être LUE, ou non lue et
    // DÉNONCÉE, ou non lue et TUE par la liste ; mesurer « lue » par
    // `badColumn === 0` confond les deux dernières, c'est-à-dire exactement la
    // distinction que ce fichier existe pour garder. C'est `headers` qui dit ce
    // que le lecteur a placé, `badColumn` ce qu'il a dénoncé.
    const nonLues = cols.filter(
      (f) => parseTobaccoCsv(["Marque", "Nom", csvHeader(f, "fr")].join(";")).headers.indexOf(f) < 0,
    );
    expect(nonLues.sort(), "une colonne d'export n'est ni lue ni déclarée")
      .toEqual([...CSV_UNREAD_BY_DESIGN].sort());
  });

  it("aucune entrée MORTE dans la liste des non-lues", () => {
    // Une exemption dormante blanchirait la première colonne qui tomberait
    // dessus. Chaque entrée doit désigner un champ que l'export écrit
    // RÉELLEMENT, que le lecteur ignore RÉELLEMENT, et que la liste tait
    // RÉELLEMENT — les trois, sans quoi elle ne sert à rien ou masque autre
    // chose que ce qu'elle annonce.
    const cols = colonnesDeLExportTabac();
    for (const f of CSV_UNREAD_BY_DESIGN) {
      expect(cols, `« ${f} » n'est plus écrite par l'export`).toContain(f);
      expect(_CSV_COLUMNS_FOR_TESTS[f], `« ${f} » n'a pas de libellé`).toBeTruthy();
      const r = parseTobaccoCsv(["Marque", "Nom", csvHeader(f, "fr")].join(";"));
      expect(r.headers, `« ${f} » est LUE — l'exemption est morte`).not.toContain(f);
      expect(r.badColumn, `« ${f} » n'est pas tue par la liste`).toBe(0);
    }
  });
});
