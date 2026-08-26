// Un seul séparateur pour tout ce que l'app ÉCRIT — et la lecture reste
// agnostique.
//
// Les quatre sorties CSV produisaient déjà `;`, mais par TROIS orthographes
// dans deux modules : un `var sep = ";"` local à `buildCsvLines`, un `join(";")`
// littéral quatre-cent lignes plus bas dans le MÊME fichier pour le modèle, et
// un `CATALOGUE_TEMPLATE_DELIM` dans `userCatalogue`. Trois copies d'une
// décision unique, donc trois façons de diverger — c'est la panne que ce dépôt
// paie en boucle (le prédicat de tags en quatre exemplaires, `FAMILY_AGING_MAX`
// recopié dans l'importeur, `CATS` dans le validateur).
//
// CE QUE LE SÉPARATEUR DÉCIDE, et ce n'est pas l'analyse : `detectDelim` renifle
// la ligne d'en-tête, donc un fichier à virgules, à points-virgules ou à
// tabulations s'importe à l'identique. Ce qui change est ce qui se passe quand
// on DOUBLE-CLIQUE le fichier — c'est-à-dire toute la raison d'être d'un modèle.
// Excel prend son séparateur dans la liste système, et dans toute locale à
// virgule décimale c'est `;` ; cinq des six langues de l'app le sont.
//
// Ces cas verrouillent la PROPRIÉTÉ (tous les écrivains s'accordent, le lecteur
// n'est pas contraint), jamais une orthographe : ils lisent `CSV_DELIM` plutôt
// que d'écrire `";"`, sinon ils seraient une quatrième copie.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CSV_DELIM, detectDelim, parseTobaccoCsv } from "../utils/csvImport.ts";
import { buildCatalogueTemplateCsv, parseCatalogueCsv } from "../utils/userCatalogue.ts";

const HOOK = "src/hooks/useExportImport.ts";
const CAT = "src/utils/userCatalogue.ts";

/** Commentaires blanchis : plusieurs d'entre eux CITENT `";"` en prose. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p) => p);
}

describe("un seul séparateur pour tout ce que l'app écrit", () => {
  it("aucun écrivain ne réécrit le séparateur en dur", () => {
    // La forme exacte qui existait : `var sep = ";"` et `join(";")`.
    for (const path of [HOOK, CAT]) {
      const src = code(path);
      expect(src, `${path} : un séparateur littéral est une quatrième copie`)
        .not.toMatch(/join\(\s*"[;,]"\s*\)/);
      expect(src, `${path} : idem pour une variable locale`)
        .not.toMatch(/\bsep\s*=\s*"[;,]"/);
    }
  });

  it("les deux modules passent bien par la constante partagée", () => {
    // Non-vacuité : sans cela, le cas ci-dessus passerait sur un fichier qui
    // aurait cessé d'écrire du CSV.
    expect(code(HOOK)).toContain("CSV_DELIM");
    expect(code(CAT)).toContain("CSV_DELIM");
  });

  it("le modèle du catalogue sort avec ce séparateur", () => {
    const tpl = buildCatalogueTemplateCsv();
    const head = tpl.split(/\r?\n/)[0]!;
    expect(head).toContain(CSV_DELIM);
    expect(detectDelim(head), "un tableur doit l'ouvrir en colonnes").toBe(CSV_DELIM);
  });

  it("une cellule contenant le séparateur est citée, donc ne casse pas la ligne", () => {
    // La garantie qui rend le choix sûr quel qu'il soit. Le modèle porte
    // exprès une ligne d'exemple avec un point-virgule dans sa prose.
    const tpl = buildCatalogueTemplateCsv();
    const parsed = parseCatalogueCsv(tpl);
    expect(parsed.db, "le modèle doit se relire lui-même").toBeTruthy();
    expect(parsed.skippedNoIdentity).toBe(0);
  });
});

describe("la LECTURE reste agnostique — ce n'est pas la même décision", () => {
  const HEAD = "Marque;Nom;Poids (g);Prix (€)";

  it("un fichier à points-virgules s'importe", () => {
    const r = parseTobaccoCsv(`${HEAD}\nVondel;Nº 7;50;12\n`);
    expect(r.tobaccos.length).toBe(1);
    expect(r.tobaccos[0]!.brand).toBe("Vondel");
  });

  it("un fichier à VIRGULES s'importe encore — les anciens exports en vivent", () => {
    // Le point que la constante ne doit jamais mettre en danger : l'app a
    // émis des fichiers à virgules, et l'utilisateur peut en fabriquer un
    // depuis n'importe quel tableur anglophone.
    const r = parseTobaccoCsv("Marque,Nom,Poids (g),Prix (€)\nVondel,Nº 7,50,12\n");
    expect(r.tobaccos.length).toBe(1);
    expect(r.tobaccos[0]!.brand).toBe("Vondel");
  });

  it("un catalogue à virgules se relit à l'identique", () => {
    const csv = "brand_key,brand_name,blend_name,category,cut\nVondel,Vondel,Nº 7,Anglais,Ribbon\n";
    const r = parseCatalogueCsv(csv);
    expect(r.db, "un catalogue déjà chargé ne doit rien perdre").toBeTruthy();
    expect(r.blends).toBe(1);
  });

  it("`detectDelim` n'est jamais contraint par la constante d'écriture", () => {
    // Le sens interdit, épinglé : c'est le renifleur qui décide en LECTURE.
    expect(detectDelim("a,b,c")).toBe(",");
    expect(detectDelim("a;b;c")).toBe(";");
    expect(detectDelim("a\tb\tc")).toBe("\t");
  });
});

describe("la décimale à virgule survit à l'aller-retour", () => {
  it("un poids « 2,5 » traverse l'export et le ré-import", () => {
    // La raison pour laquelle `;` est cohérent et pas seulement préférable :
    // l'app stocke les poids TELS QUE TAPÉS, donc une cave française porte
    // légitimement « 2,5 ». Un fichier dont le séparateur EST la marque
    // décimale est à une erreur d'édition d'une ligne coupée en deux.
    const line = ["Vondel", "Nº 7", "2,5", "12,90"].join(CSV_DELIM);
    const r = parseTobaccoCsv(`Marque${CSV_DELIM}Nom${CSV_DELIM}Poids (g)${CSV_DELIM}Prix (€)\n${line}\n`);
    expect(r.tobaccos.length, "la ligne ne doit pas être coupée").toBe(1);
    expect(r.tobaccos[0]!.lots[0]!.weightG).toBe("2.5");
  });
});
