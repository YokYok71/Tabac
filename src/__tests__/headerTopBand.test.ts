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
 * produit par cet élément — c'est un voile ancré au bord haut de l'écran.
 *
 * CE QUI DOIT EN SORTIR, ET QUI A ÉTÉ CORRIGÉ APRÈS COUP : les GLYPHES, pas la
 * boîte du bouton. Le premier chiffre livré (40) demandait que le liseré entier
 * échappe au voile — un filet dont le pic de gradient vaut 28 sur 765 — et
 * l'utilisateur a répondu « ça fonctionne mais c'est bien trop bas ». L'encre
 * est 14 px CSS SOUS le haut de sa cible tactile, par le centrage dans la
 * rangée de 44 px : ces 14 px comptent dans le dégagement.
 *
 * CE QU'ELLE NE GARDE PAS, et il faut le dire : aucun test ne peut reproduire
 * l'effet, qui est peint par iOS après toute la composition de la page. La
 * garde tient la DÉCISION (la valeur, et le fait qu'elle soit gatée), pas son
 * résultat visuel. Celui-ci ne se vérifie que sur l'appareil.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

const SRC = "src/theme-curator.ts";

/** LA SEULE MESURE VALIDE du voile : profondeur, sous le haut de la vue web,
 *  en px CSS — et elle vient du SEUL couple de captures où le voile est
 *  DÉMONTRÉ actif, celui des builds 25/26 sur iPad.
 *
 *  26 px de profondeur → 36 % de netteté, 32 px → 50 %, 38 px → 100 %. On prend
 *  le pire cas : 38.
 *
 *  TROIS « RESSERREMENTS » DE CETTE BORNE ONT ÉTÉ ANNULÉS, et il faut savoir
 *  pourquoi pour ne pas les refaire. Des captures ultérieures (iPhone 28 puis
 *  18, iPad 28) montraient le liseré parfaitement net et j'en ai conclu que le
 *  voile était plus court. Or la capture iPad du build 29 place le haut du
 *  liseré à 28 px de profondeur et le trouve à 100 %, quand la mesure ci-dessus
 *  y prédit ~40 % : les deux ne décrivent pas la même bande. L'explication est
 *  dans le voile lui-même — **il n'apparaît qu'après une navigation**, donc une
 *  capture prise sur une app fraîchement ouverte ne contient rien à mesurer.
 *  Une sonde qui ne s'applique pas ne prouve rien, verte comme rouge.
 *
 *  CONFIRMÉ DEPUIS, PAR UNE SECONDE SONDE VALIDE. Capture du build 30
 *  (dégagement 14) : l'encre du mot-symbole monte en RAMPE — `94, 140, 136,
 *  160, 172, 174` — au lieu du plateau `170, 175, 173, 175, 174, 175` du
 *  build 29. Le voile était donc actif. Profondeurs : 28 → 54 %, 32 → 78 %,
 *  36 → 99 %, 38 → 100 %. Même valeur que la paire 25/26, et 54 % à 28 px là
 *  où la capture invalide donnait 100 %.
 *
 *  38 n'est donc plus un pire cas mais LA profondeur, et 24 le dégagement
 *  minimum EXACT — un pixel de moins fait rentrer l'encre dans le voile. */
const VOILE_PX = 38;

/** De combien l'ENCRE descend sous le haut de sa cible tactile — le centrage
 *  dans la rangée de 44 px. MESURÉ sur la capture du build 26 : le bouton
 *  occupe `y = 144..228` px écran, l'encre `y = 172..200`, soit 28 px écran. */
const ENCRE_SOUS_LE_BOUTON_PX = 14;

describe("le plancher d'en-tête dégage la bande floue d'iOS", () => {
  it("aucun GLYPHE n'entre dans le voile, sur CHAQUE classe d'appareil", async () => {
    const m = await import("../theme-curator.ts");
    // UNE TABLE POUR UNE SEULE CLASSE, ET C'EST VOULU. Il y en a eu deux — une
    // valeur plus courte pour le téléphone — retirée avec les sondes qui
    // l'avaient produite : aucune capture iPhone n'a jamais montré le voile
    // ACTIF, donc sa profondeur y est inconnue et la tablette est la borne
    // prudente. La forme reste une table pour qu'une classe mesurée pour de
    // bon s'y ajoute en une ligne, avec sa mesure.
    const classes: Array<[string, number, number]> = [
      ["tous appareils", m.HEADER_BAND_CLEARANCE_PX, VOILE_PX],
    ];
    let vus = 0;
    for (const [nom, degagement, voile] of classes) {
      expect(typeof degagement, `${nom} : le dégagement n'est plus un nombre`).toBe("number");
      // Le critère porte sur l'encre, PAS sur la boîte du bouton : exiger que
      // le liseré entier sorte du voile coûtait 12 px de hauteur pour un filet
      // à contraste 28/765, et c'est ce que l'utilisateur a renvoyé comme
      // « bien trop bas ».
      expect(
        degagement + ENCRE_SOUS_LE_BOUTON_PX,
        `${nom} : l'encre retomberait dans le voile, qui descend jusqu'à ${voile} px CSS dans la vue web`,
      ).toBeGreaterThanOrEqual(voile);
      // L'autre bord, gagné par un retour utilisateur : chaque pixel au-delà du
      // voile est de la hauteur prise pour rien.
      expect(
        degagement,
        `${nom} : au-delà de ${voile} px le dégagement ne protège plus rien, il ne fait que baisser l'en-tête`,
      ).toBeLessThanOrEqual(voile);
      vus++;
    }
    expect(vus, "aucune classe examinée — la garde est vide").toBe(1);
  });

  it("le plancher est GATÉ, et lu depuis la source", () => {
    // Une garde sur la valeur seule resterait verte si quelqu'un aplatissait le
    // ternaire en constante — or c'est précisément la régression coûteuse :
    // Android, le navigateur et le bureau paieraient 34 px de hauteur pour un
    // effet qu'ils n'ont pas.
    const src = readFileSync(SRC, "utf8");
    // Jusqu'au point-virgule, PAS jusqu'au saut de ligne : l'expression est
    // devenue un ternaire sur deux axes et tient sur trois lignes. Une garde
    // qui s'arrête au premier `\n` cesserait de voir la moitié de ce qu'elle
    // vérifie — sans rien dire, ce qui est la forme la plus coûteuse.
    const ligne = (src.match(/export var HEADER_TOP_FLOOR\s*=\s*([^;]+);/) || [])[1];
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
    // Elles passent toutes par `headerTop()` — recensé par docChecks — donc il
    // suffit que l'expression produite porte la valeur.
    const { headerTop, HEADER_TOP_FLOOR } = await import("../theme-curator.ts");
    expect(headerTop(), "l'expression ne porte plus le plancher").toContain(HEADER_TOP_FLOOR);
  });

  /**
   * L'INSET DOUBLE-COMPTE LA BANDE D'ÉTAT, ET C'EST CE QUE CETTE GARDE TIENT.
   *
   * Depuis le build 16, `apple-mobile-web-app-status-bar-style: default` fait
   * RÉSERVER la bande par iOS — et `env(safe-area-inset-top)` continue de la
   * mesurer depuis le haut de l'écran. MESURÉ sur l'iPhone de l'utilisateur
   * (capture du build 27, 1184 × 2576 à 3×) : glyphes système jusqu'à 39 pt,
   * bouton d'icône à 101 pt, encre à 115 pt — contre ~74 pt sur l'iPad, dont
   * l'inset vaut ~0. L'écart, 47 pt, est exactement `59 − 12` : une marge
   * ajoutée pour un espace déjà reçu.
   *
   * La garde exige donc qu'en autonome AUCUN `env()` ne subsiste dans la valeur
   * — c'est la seule chose qui distingue « le plancher gouverne » de « le
   * plancher est un minimum ».
   */
  it("en autonome, l'en-tête n'ajoute PAS l'inset déjà réservé", async () => {
    const src = readFileSync(SRC, "utf8");
    const corps = (src.match(/export function headerTop\(\)[^}]*\}/) || [])[0];
    expect(corps, "headerTop introuvable — la garde ne s'applique plus").toBeTruthy();
    expect(String(corps), "headerTop ne distingue plus l'autonome iOS")
      .toContain("IS_IOS_STANDALONE");
    expect(String(corps), "la branche autonome doit rendre le plancher NU, sans safeTop")
      .toMatch(/\?\s*HEADER_TOP_FLOOR\s*:/);
  });
});
