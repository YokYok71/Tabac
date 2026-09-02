import { shouldShowDock, type DockGate } from "./dockVisibility.ts";

// Escamotage de la chrome au défilement — la décision, PURE.
//
// Même découpage que `dockVisibility.ts` : la règle vit ici pour être éprouvée
// sans monter un navigateur, le hook (`useChromeAutoHide`) ne fait que lui
// donner des mesures et poser un écouteur.
//
// CE QUI EST ESCAMOTÉ, ET OÙ. La barre du haut et le dock, sur les QUATRE vues
// racines de liste seulement. Le périmètre n'est pas une prudence de principe,
// il vient d'une vérification : sur ces quatre-là, le `leading` de la TopBar
// est une icône DÉCORATIVE (feuille, pipe, livre, flamme), donc l'escamoter ne
// retire aucune sortie. `CatalogView` en est exclue précisément parce que son
// `leading` est un VRAI bouton retour (`nav("inv")`) — masquer la porte de
// sortie pendant qu'on parcourt une longue liste est le défaut que cette
// fonctionnalité ne doit pas introduire. Le Home est exclu aussi : il n'utilise
// pas `TopBar` et ne défile pas assez pour qu'il y ait quoi que ce soit à
// gagner.
//
// LA MESURE `data-topbar` SURVIT, et c'est ce qui a levé la dernière objection.
// `InventoryListView` lit `getBoundingClientRect().height` de la barre pour
// amener une envie sous elle. Une TRANSLATION ne change pas une hauteur (un
// `scaleY` l'aurait changée) : la mesure reste juste, barre visible ou non.

/** La MÊME porte que le dock — c'est tout l'intérêt de dériver : une entrée
 *  ajoutée là-bas vaut ici sans qu'on y touche. */
export type ChromeGate = DockGate;

/** L'escamotage s'applique EXACTEMENT LÀ OÙ LA CHROME EST AFFICHÉE.
 *
 *  C'est `shouldShowDock` — pas une seconde liste. Le critère est de
 *  l'utilisateur, et il est meilleur que le mien : « toutes les pages où se
 *  trouvent les menus ». Si les barres sont là, elles peuvent s'effacer ; si
 *  elles n'y sont pas, la question ne se pose pas.
 *
 *  CE QUE LA DUPLICATION A COÛTÉ, ET POURQUOI ELLE DISPARAÎT. J'ai d'abord
 *  tenu un `AUTO_HIDE_VIEWS` à la main, en parallèle de `NO_DOCK_VIEWS`. En
 *  trois commits, il a produit TROIS chaînes fantômes — `"catalogue"` (la vue
 *  s'appelle `catalog`), puis `"detail"`, `"pipeDet"`, `"accDet"` (des
 *  sous-états, pas des vues) — dont la dernière a livré le défaut même que le
 *  périmètre existait pour empêcher. Une liste d'identifiants recopiée
 *  s'accorde toujours avec elle-même et jamais avec l'application. En dérivant
 *  la décision, la classe entière disparaît : il n'y a plus d'identifiant à
 *  écrire, donc plus d'identifiant à inventer.
 *
 *  MON OBJECTION D'ORIGINE ÉTAIT PLUS FAIBLE QUE JE NE L'AI DITE. J'excluais
 *  les fiches et le catalogue parce que leur barre porte le bouton retour.
 *  Mais ce bouton n'est PAS la seule sortie — `useBackNavigation` câble le
 *  retour système (bouton matériel, geste de bord) et `decideBack` sait fermer
 *  une fiche — et il n'est jamais absent plus d'une demi-seconde, puisque tout
 *  mouvement vers le haut ET l'arrêt le ramènent.
 *
 *  RESTENT DEHORS, sans effort de notre part : la dégustation, les huit
 *  formulaires plein écran, les quatre pages de documentation et la
 *  superposition d'envies. Tous parce que le dock n'y est pas — donc il n'y a
 *  rien à escamoter. */
export function canAutoHideChrome(view: string, gate: ChromeGate = {}): boolean {
  return shouldShowDock(view, gate);
}

/** Zone haute où la chrome est TOUJOURS visible. Sans elle, un défilement
 *  minuscule depuis le sommet ferait disparaître la barre alors que l'on n'a
 *  encore rien gagné en place. */
export var CHROME_REVEAL_TOP_PX = 80;

/** Descente cumulée à partir de laquelle on masque. Assez pour qu'un
 *  tremblement de doigt ou le rebond iOS ne déclenche rien. */
export var CHROME_HIDE_DELTA_PX = 12;

/** Il faut au moins ce multiple de la hauteur d'écran À DÉFILER pour que
 *  masquer ait un sens. Sur une liste de trois lignes, escamoter la navigation
 *  ne gagne rien et la fait seulement clignoter. */
export var CHROME_MIN_OVERFLOW_RATIO = 0.75;

/** Délai d'immobilité au bout duquel la chrome revient d'elle-même.
 *
 *  C'est la moitié « ou à l'arrêt » de la règle, et elle est aussi le filet
 *  d'accessibilité : quoi qu'il arrive, une navigation escamotée réapparaît
 *  seule en moins d'une seconde, sans qu'il faille deviner le geste. */
export var CHROME_IDLE_REVEAL_MS = 500;

export interface ScrollMetrics {
  scrollY: number;
  prevScrollY: number;
  viewportH: number;
  docH: number;
}

/** LA RÈGLE. Rendue par `nextChromeHidden(étatPrécédent, mesures)`.
 *
 *  L'ordre des clauses EST la règle, et chacune l'emporte sur les suivantes :
 *
 *   1. page trop courte  → visible (rien à gagner)
 *   2. près du sommet    → visible (on n'a encore rien gagné)
 *   3. mouvement vers le haut, si petit soit-il → visible, IMMÉDIATEMENT
 *   4. descente franche  → masqué
 *   5. sinon             → on garde l'état, pour ne pas osciller sur le bruit
 *
 *  La clause 3 avant la 4 est ce qui rend la remontée fiable : c'est le geste
 *  par lequel l'utilisateur redemande la recherche et les filtres, et il doit
 *  aboutir avant qu'il n'y arrive. */
export function nextChromeHidden(prevHidden: boolean, m: ScrollMetrics): boolean {
  if (!(m.docH - m.viewportH > m.viewportH * CHROME_MIN_OVERFLOW_RATIO)) return false;
  if (m.scrollY <= CHROME_REVEAL_TOP_PX) return false;
  var delta = m.scrollY - m.prevScrollY;
  if (delta < 0) return false;
  if (delta > CHROME_HIDE_DELTA_PX) return true;
  return prevHidden;
}
