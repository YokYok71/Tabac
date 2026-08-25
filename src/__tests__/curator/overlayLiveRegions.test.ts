// TOUTE SURFACE QUI APPARAÎT SEULE DOIT S'ANNONCER — et quatre des neuf ne le
// faisaient pas.
//
// Neuf composants d'`Overlays.tsx` se montrent sans que l'utilisateur les ait
// ouverts : les cinq bannières de `TOP_BANNER_ORDER` et les quatre toasts de
// `BOTTOM_TOAST_ORDER`. Pour quelqu'un qui regarde l'écran, apparaître SUFFIT.
// Pour un lecteur d'écran, un nœud inséré sans région vivante n'existe pas.
//
// MESURÉ avant correctif : `saveError`, `saveWarn` et `photoErr` portaient
// `role="alert"`, `exportReminder` `role="status"` — et `cloudNewer`, seule des
// cinq, RIEN. En bas, seul `importRecap` en avait un : ni l'annulation, ni le
// toast de mise à jour, ni la détection de langue.
//
// LE PLUS COÛTEUX EST L'ANNULATION. Cette app supprime sans jamais demander
// confirmation — un choix assumé, adossé au toast de 8 s et à la corbeille de
// 30 jours. Muet, ce toast laisse un lecteur d'écran sans AUCUN signal que
// quelque chose vient de disparaître, ni que la marche arrière existe et
// qu'elle expire.
//
// POURQUOI UNE RÈGLE SUR L'ENSEMBLE PLUTÔT QUE QUATRE ATTRIBUTS. C'est
// exactement la forme que `bannerStack.ts` et `bottomToast.ts` ont déjà fermée
// deux fois : une décision appliquée à certains frères et pas aux autres, avec
// rien qui regarde le groupe. Les deux listes d'ORDRE existent, donc l'ensemble
// est nommable ; un dixième ajouté demain rougit ici au lieu de partir muet.
//
// CE QUE LA RÈGLE NE JUGE PAS : le registre. `alert` est assertif et coupe la
// parole, `status` attend une pause — le bon choix dépend de ce que la surface
// dit, pas de sa position dans une liste. Les trois échecs gardent `alert`, les
// six informations `status`. La règle exige une région vivante, jamais laquelle.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TOP_BANNER_ORDER } from "../../utils/bannerStack.ts";
import { BOTTOM_TOAST_ORDER } from "../../utils/bottomToast.ts";

const SRC = "src/views/curator/Overlays.tsx";

/**
 * id de la liste d'ordre → composant qui le rend.
 *
 * Prototype nul : `tabac-local/no-dynamic-index-plain-map` a fait rougir la
 * première version, et elle a raison de demander le remède plutôt qu'une
 * exception — la clé vient bien d'une union fermée ici, mais la règle ne peut
 * pas le voir, et un `Object.create(null)` coûte une ligne contre une
 * dérogation qui apprendrait à faire taire la règle.
 */
const COMPONENT: Record<string, string> = Object.assign(Object.create(null), {
  saveError: "CuratorSaveErrorBanner",
  saveWarn: "CuratorSaveWarnBanner",
  photoErr: "CuratorPhotoErrorBanner",
  cloudNewer: "CuratorCloudNewerBanner",
  exportReminder: "CuratorExportReminderBanner",
  undo: "CuratorUndoToast",
  importRecap: "CuratorImportRecapToast",
  justUpdated: "CuratorJustUpdatedToast",
  langDetected: "CuratorLangDetectedToast",
});

/**
 * Le corps d'un composant, commentaires BLANCHIS.
 *
 * Le blanchiment n'est pas une précaution de style : les commentaires de ce
 * fichier CITENT `role="status"` et `role="alert"` pour expliquer le choix, si
 * bien qu'une recherche naïve trouve la prose et déclare la surface couverte.
 * C'est le piège que ce dépôt a déjà rencontré quatre fois. La longueur est
 * préservée pour que les décalages restent lisibles.
 */
function body(src: string, name: string): string {
  const blanked = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
  const start = blanked.indexOf("export function " + name);
  expect(start, name + " est introuvable dans " + SRC).toBeGreaterThan(-1);
  const next = blanked.indexOf("\nexport function ", start + 1);
  return blanked.slice(start, next > 0 ? next : blanked.length);
}

describe("chaque bannière et chaque toast s'annonce", () => {
  const src = readFileSync(SRC, "utf8");
  const ids = [...TOP_BANNER_ORDER, ...BOTTOM_TOAST_ORDER];

  it("les deux listes d'ordre sont couvertes, et l'inverse aussi", () => {
    // Sans ça la table pourrait perdre une entrée en silence et le balayage
    // ci-dessous se réduirait sans rien dire — la vacuité, encore.
    for (const id of ids) {
      expect(COMPONENT[id], "aucun composant déclaré pour « " + id + " »").toBeTruthy();
    }
    expect(Object.keys(COMPONENT).sort()).toEqual([...ids].sort());
    expect(ids.length).toBe(9);
  });

  for (const id of ids) {
    it(`« ${id} » porte une région vivante`, () => {
      const b = body(src, COMPONENT[id]!);
      // LA RÈGLE PORTE SUR LA PROPRIÉTÉ, PAS SUR UNE CONVENTION DE MAISON.
      // `role="alert"` et `role="status"` déclarent chacun une région vivante
      // à eux seuls — la spécification leur associe `assertive` et `polite`
      // implicitement — donc exiger EN PLUS un `aria-live` écrit serait exiger
      // un attribut redondant. Ma première version le faisait et a rougi sur
      // `exportReminder`, qui était juste : c'est la garde trop stricte qui
      // fait réécrire du code correct pour lui plaire, et ce dépôt l'a déjà
      // payée ailleurs. Cinq des six `status` portent l'attribut explicite,
      // hérité de `importRecap` ; c'est inoffensif et ce n'est pas la règle.
      expect(b, COMPONENT[id] + " n'a aucune région vivante")
        .toMatch(/role="(alert|status)"|aria-live="(polite|assertive)"/);
    });
  }

  it("un échec parle assertivement, une information poliment", () => {
    // Le REGISTRE n'est pas jugé par la règle ci-dessus, mais il n'est pas
    // arbitraire non plus : les trois surfaces qui signalent un échec coupent
    // la parole, les six autres attendent.
    for (const id of ["saveError", "saveWarn", "photoErr"]) {
      expect(body(src, COMPONENT[id]!), id).toMatch(/role="alert"/);
    }
    for (const id of ["cloudNewer", "exportReminder", "undo", "importRecap", "justUpdated", "langDetected"]) {
      expect(body(src, COMPONENT[id]!), id).toMatch(/role="status"/);
    }
  });
});
