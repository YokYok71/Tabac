/**
 * LA BANDE FLOUE DU HAUT — pourquoi l'en-tête descend, et seulement sur iOS.
 *
 * CE QUI A ÉTÉ MESURÉ, parce que c'est le chiffre que cette garde protège.
 * Deux captures du même iPad (lancement / retour de navigation), 1640 × 2360 px :
 * 177 lignes diffèrent, TOUTES dans `y = 0..136`, le reste identique au pixel
 * près — dock compris. Sur le liseré gauche d'un bouton d'icône, haut de 44 px,
 * le contraste du bord vaut de haut en bas `0, 5, 9, 52, 56, 28, 28` contre
 * `26, 28, 28, 144, 113, 28, 28` au lancement : le HAUT du bouton est effacé, le
 * BAS du MÊME bouton est intact. Un flou qui varie DANS un élément n'est pas
 * produit par cet élément — c'est un voile ancré au bord haut de l'écran, qui
 * s'annule à ~69 px CSS. La vue web commençant ~32 px sous ce bord, il faut
 * **37 px** de dégagement à l'intérieur pour en sortir.
 *
 * CE QU'ELLE NE GARDE PAS, et il faut le dire : aucun test ne peut reproduire
 * l'effet, qui est peint par iOS après toute la composition de la page. La
 * garde tient la DÉCISION (la valeur, et le fait qu'elle soit gatée), pas son
 * résultat visuel. Celui-ci ne se vérifie que sur l'appareil.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

const SRC = "src/theme-curator.ts";

/** Le dégagement mesuré nécessaire, en px CSS. La valeur livrée doit le
 *  couvrir ; elle a le droit d'être plus grande, jamais plus petite. */
const DEGAGEMENT_MESURE = 37;

describe("le plancher d'en-tête dégage la bande floue d'iOS", () => {
  it("la valeur livrée couvre le dégagement mesuré", async () => {
    const { HEADER_BAND_CLEARANCE_PX } = await import("../theme-curator.ts");
    expect(typeof HEADER_BAND_CLEARANCE_PX, "le dégagement n'est plus un nombre").toBe("number");
    expect(
      HEADER_BAND_CLEARANCE_PX,
      `mesuré sur l'appareil : le voile s'annule à ~69 px CSS du haut de l'écran et la vue web commence ~32 px plus bas, donc ${DEGAGEMENT_MESURE} px sont nécessaires`,
    ).toBeGreaterThanOrEqual(DEGAGEMENT_MESURE);
  });

  it("le plancher est GATÉ, et lu depuis la source", () => {
    // Une garde sur la valeur seule resterait verte si quelqu'un aplatissait le
    // ternaire en constante — or c'est précisément la régression coûteuse :
    // Android, le navigateur et le bureau paieraient 34 px de hauteur pour un
    // effet qu'ils n'ont pas.
    const src = readFileSync(SRC, "utf8");
    const ligne = (src.match(/export var HEADER_TOP_FLOOR\s*=\s*([^\n;]+)/) || [])[1];
    expect(ligne, "HEADER_TOP_FLOOR introuvable — la garde ne s'applique plus").toBeTruthy();
    expect(String(ligne), "le plancher n'est plus conditionné à l'autonome iOS")
      .toContain("IS_IOS_STANDALONE");
    expect(String(ligne), "le plancher n'utilise plus la constante de dégagement mesurée")
      .toContain("HEADER_BAND_CLEARANCE_PX");
  });

  it("hors autonome iOS, le plancher reste compact", async () => {
    // jsdom n'a pas `navigator.standalone` : c'est le régime « tout le reste ».
    const { HEADER_TOP_FLOOR } = await import("../theme-curator.ts");
    expect(HEADER_TOP_FLOOR, "le monde non-iOS paie une marge qu'il n'a aucune raison de payer")
      .toBe("6px");
  });
});

describe("en autonome iOS, le plancher prend le dégagement", () => {
  // `navigator.standalone` est lu UNE FOIS à l'import du module plateforme :
  // il faut donc le poser AVANT, puis recharger les modules.
  let pose = false;

  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    pose = true;
  });

  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(window.navigator as unknown as Record<string, unknown>, "standalone");
  });

  it("le plancher vaut le dégagement, en pixels", async () => {
    expect(pose, "le drapeau n'a pas été posé — le cas ne prouverait rien").toBe(true);
    const { IS_IOS_STANDALONE } = await import("../utils/platform.ts");
    // Non-vacuité : sans ce contrôle, un `standalone` non pris en compte
    // ferait passer le cas pour la MAUVAISE raison (le régime par défaut).
    expect(IS_IOS_STANDALONE, "le drapeau plateforme n'a pas vu `navigator.standalone`").toBe(true);

    const { HEADER_TOP_FLOOR, HEADER_BAND_CLEARANCE_PX } = await import("../theme-curator.ts");
    expect(HEADER_TOP_FLOOR).toBe(`${HEADER_BAND_CLEARANCE_PX}px`);
    expect(HEADER_TOP_FLOOR).not.toBe("6px");
  });

  it("les trois en-têtes reçoivent la valeur gatée par la MÊME constante", async () => {
    // Elles passent toutes par `safeTop(HEADER_TOP_FLOOR)` — recensé par
    // docChecks — donc il suffit que l'expression produite porte la valeur.
    const { safeTop, HEADER_TOP_FLOOR } = await import("../theme-curator.ts");
    const css = safeTop(HEADER_TOP_FLOOR);
    expect(css, "l'expression CSS ne porte plus le plancher").toContain(HEADER_TOP_FLOOR);
    expect(css, "le plancher doit rester un plancher : `max(...)`").toMatch(/^max\(/);
  });
});
