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

/** Le MAJORANT du voile DANS la vue web sur tablette, en px CSS — resserré deux
 *  fois, comme celui du téléphone.
 *
 *  Build 25, dégagement 6 : le voile agit encore à `y = 128` px écran (contraste
 *  56 contre 113) et plus du tout à `y = 140` (28 contre 28) ; vue web à 64,
 *  donc (140−64)/2 = 38.
 *  Build 29, dégagement 28 : liseré du bouton à 60..103 px CSS (vue web à 32),
 *  profil `48, 48, 49, 48, 48, 47, 48, 48, 49, 49` en haut contre
 *  `48, 48, 48, 47, 49, 48, 47, 48, 50, 49` en bas — aucune atténuation. Un
 *  voile de 38 finirait à 70 et mangerait le haut du liseré → voile ≤ 28.
 *
 *  Comme pour le téléphone, c'est ce que les captures EXCLUENT, pas la
 *  profondeur réelle. */
const VOILE_PX = 28;

/** Le même majorant pour l'iPhone, et il est PLUS COURT — resserré deux fois,
 *  par deux captures du même appareil.
 *
 *  Build 28, dégagement 28 : liseré non atténué (`51, 50, 50, 49, 50, 52, …`
 *  en haut comme en bas), bouton à 89,3 pt, vue web à 61,3 → voile ≤ 28.
 *  Build 29, dégagement 18 : liseré toujours non atténué (`47, 50, 50, 49, …`,
 *  le 47 étant l'angle arrondi), bouton à 78,7 pt, vue web à 60,7 → voile ≤ 18.
 *
 *  C'est un MAJORANT — ce que les captures EXCLUENT, pas la profondeur réelle,
 *  qui reste inconnue et peut être bien moindre. */
const VOILE_PHONE_PX = 18;

/** De combien l'ENCRE descend sous le haut de sa cible tactile — le centrage
 *  dans la rangée de 44 px. MESURÉ sur la capture du build 26 : le bouton
 *  occupe `y = 144..228` px écran, l'encre `y = 172..200`, soit 28 px écran. */
const ENCRE_SOUS_LE_BOUTON_PX = 14;

describe("le plancher d'en-tête dégage la bande floue d'iOS", () => {
  it("aucun GLYPHE n'entre dans le voile, sur CHAQUE classe d'appareil", async () => {
    const m = await import("../theme-curator.ts");
    // UNE TABLE, PAS DEUX CAS RECOPIÉS : la règle est la même des deux côtés
    // (`dégagement + encre ≥ voile`), seule la borne change — et c'est le
    // constat qui a produit la seconde valeur. Une troisième classe d'appareil
    // s'ajoute ici en une ligne, avec sa mesure.
    const classes: Array<[string, number, number]> = [
      ["tablette", m.HEADER_BAND_CLEARANCE_PX, VOILE_PX],
      ["téléphone", m.HEADER_BAND_CLEARANCE_PHONE_PX, VOILE_PHONE_PX],
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
    expect(vus, "aucune classe examinée — la garde est vide").toBe(2);
  });

  it("le téléphone ne paie pas la géométrie de la tablette", async () => {
    // La raison d'être de la seconde valeur. Si les deux redeviennent égales,
    // c'est qu'on a « simplifié » en reperdant les 10 pt que la mesure iPhone
    // a rendus — ou, dans l'autre sens, qu'on a appliqué au iPad une borne qui
    // n'est pas la sienne.
    const m = await import("../theme-curator.ts");
    expect(m.HEADER_BAND_CLEARANCE_PHONE_PX, "les deux classes ont refusionné")
      .toBeLessThan(m.HEADER_BAND_CLEARANCE_PX);
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
    expect(String(ligne), "le plancher ne distingue plus le téléphone de la tablette")
      .toContain("IS_IPHONE");
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
