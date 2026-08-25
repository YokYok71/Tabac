// LES BANNIÈRES ET LES TOASTS N'ONT JAMAIS ÉTÉ VUS PAR AUCUN VÉRIFICATEUR.
//
// `i18n:layout` et `theme:contrast` partagent une liste d'ÉCRANS, et aucune des
// cinq bannières du haut ni des quatre toasts du bas n'y figure : elles sont
// pilotées par de l'état React qu'une graine de stockage ne peut pas atteindre.
// Un build venait d'ajouter la plus longue phrase de l'app sur l'une d'elles,
// donc la question méritait d'être posée.
//
// MESURÉ AVANT DE CONSTRUIRE QUOI QUE CE SOIT, et la mesure retourne la
// question : les CINQ bannières du haut ne portent ni `nowrap`, ni ellipsis, ni
// `overflow: hidden`. Ce sont des barres pleine largeur en flux normal — elles
// ENVELOPPENT, donc elles ne peuvent structurellement pas tronquer, quelle que
// soit la longueur de la traduction. Aucun des quatre modes d'échec de
// `i18n:layout` ne s'y applique.
//
// D'où ce fichier plutôt que trois écrans de plus dans le harnais : ce qui rend
// ces surfaces sûres est une PROPRIÉTÉ DÉCLARÉE, pas un rendu. Un test jsdom la
// tient sur chaque commit, là où une vérification optionnelle qui a besoin d'un
// navigateur peut rester des mois sans tourner — c'est exactement ce qui est
// arrivé à `prune`. Et il couvre les cinq d'un coup, y compris celles qu'aucune
// graine ne saurait faire apparaître.
//
// L'AUTRE MOITIÉ EST AUSSI IMPORTANTE : trois des quatre toasts du bas
// tronquent VOLONTAIREMENT, et chacun est BORNÉ. Les épingler ici est ce qui
// empêche un balayage futur de « corriger » une décision — le piège que ce
// dépôt consigne sous « une garde trop stricte fait réécrire du code juste ».

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = "src/views/curator/Overlays.tsx";

/** Le corps d'un composant, commentaires blanchis (longueur préservée). */
function bodyOf(name: string): string {
  const raw = readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
  const i = raw.indexOf("function " + name);
  expect(i, name + " est introuvable — a-t-il été renommé ?").toBeGreaterThan(-1);
  const j = raw.indexOf("\nfunction ", i + 10);
  const k = raw.indexOf("\nexport function ", i + 10);
  const ends = [j, k].filter((x) => x > 0);
  return raw.slice(i, ends.length ? Math.min(...ends) : raw.length);
}

// Les cinq occupants du même rectangle `top: 0` — voir `bannerStack.ts`.
const TOP_BANNERS = [
  "CuratorSaveErrorBanner",
  "CuratorSaveWarnBanner",
  "CuratorPhotoErrorBanner",
  "CuratorCloudNewerBanner",
  "CuratorExportReminderBanner",
];

describe("une bannière du haut enveloppe, donc elle ne peut pas tronquer", () => {
  it("aucune des cinq ne déclare nowrap, ellipsis ou overflow caché", () => {
    for (const name of TOP_BANNERS) {
      const b = bodyOf(name);
      expect(b, name + " a acquis un nowrap : sa phrase peut désormais être coupée")
        .not.toMatch(/whiteSpace:\s*["']nowrap["']/);
      expect(b, name + " a acquis une ellipsis").not.toMatch(/textOverflow/);
      expect(b, name + " a acquis un overflow caché : le texte peut être rogné")
        .not.toMatch(/overflow(X)?:\s*["'](hidden|clip)["']/);
    }
  });

  it("le cas ne peut pas passer à vide — les cinq sont bien trouvées et non vides", () => {
    // Sans ça, un renommage viderait la boucle et le fichier resterait vert en
    // ne vérifiant plus rien.
    expect(TOP_BANNERS.length).toBe(5);
    for (const name of TOP_BANNERS) {
      expect(bodyOf(name).length, name + " a un corps vide").toBeGreaterThan(200);
    }
  });

  it("les cinq sont exactement celles que `bannerStack` ordonne", () => {
    // Une sixième bannière ajoutée à TOP_BANNER_ORDER sans être ajoutée ici
    // reviendrait à ne pas la couvrir — la moitié qui pourrit.
    const stack = readFileSync("src/utils/bannerStack.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const m = stack.match(/TOP_BANNER_ORDER[^=]*=\s*\[([^\]]*)\]/);
    expect(m, "TOP_BANNER_ORDER est introuvable").toBeTruthy();
    const ids = (m![1]!.match(/"([a-zA-Z]+)"/g) || []).map((x) => x.replace(/"/g, ""));
    expect(ids.length, "l'ordre des bannières n'a pas été lu").toBe(5);
    // Les identifiants du décideur ("saveWarn") et les noms des composants
    // ("CuratorSaveWarnBanner") sont deux vocabulaires : on compare le NOMBRE,
    // qui est ce qui doit rester en phase.
    expect(TOP_BANNERS.length,
      "une bannière a été ajoutée à TOP_BANNER_ORDER sans être couverte ici")
      .toBe(ids.length);
  });
});

describe("un toast du bas qui tronque est BORNÉ, et c'est une décision", () => {
  it("l'étiquette de l'annulation est un SUJET : ellipsis assumée, largeur bornée", () => {
    // Cette ellipsis est délibérée et documentée : le nom d'un élément supprimé
    // peut être de n'importe quelle longueur, donc la fente est `maxWidth: 240`
    // + nowrap. Un build a mis une PHRASE entière dedans et l'utilisateur a lu
    // « 29 fiche(s) mises à jour depui… » ; c'est l'étiquette qui a été
    // corrigée, pas la fente. L'épingler ici évite qu'un balayage « répare »
    // la fente et rouvre le vrai défaut.
    const b = bodyOf("CuratorUndoToast");
    expect(b, "l'ellipsis de l'étiquette a disparu").toMatch(/textOverflow/);
    expect(b, "la fente n'est plus bornée — un nom long pousserait le toast hors écran")
      .toMatch(/maxWidth:\s*240/);
  });

  it("le toast « à jour » ne porte qu'un identifiant de version", () => {
    // `nowrap` sans `maxWidth` serait un risque si le contenu était une phrase
    // traduite. Il ne l'est pas : « Build NN », borné par construction.
    const b = bodyOf("CuratorJustUpdatedToast");
    expect(b).toMatch(/whiteSpace:\s*["']nowrap["']/);
    expect(b, "le toast « à jour » contient désormais autre chose qu'un numéro de build — " +
      "avec nowrap et sans maxWidth, une phrase traduite déborderait")
      .not.toMatch(/\bt\(["'][a-z_]+["']\)/);
  });

  it("le récapitulatif d'import enveloppe et reste dans l'écran", () => {
    const b = bodyOf("CuratorImportRecapToast");
    expect(b, "le récapitulatif ne préserve plus ses retours à la ligne")
      .toMatch(/whiteSpace:\s*["']pre-line["']/);
    expect(b, "le récapitulatif n'est plus borné à la largeur de l'écran")
      .toMatch(/maxWidth:\s*["']calc\(100vw/);
    expect(b, "le récapitulatif a acquis un nowrap")
      .not.toMatch(/whiteSpace:\s*["']nowrap["']/);
  });

  it("le toast de langue détectée enveloppe comme les bannières du haut", () => {
    const b = bodyOf("CuratorLangDetectedToast");
    expect(b).not.toMatch(/whiteSpace:\s*["']nowrap["']/);
    expect(b).not.toMatch(/textOverflow/);
  });
});
