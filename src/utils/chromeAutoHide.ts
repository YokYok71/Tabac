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

/** Les vues où la chrome s'escamote : les SIX racines, celles que le dock
 *  atteint. Le critère n'est pas « une liste » mais « la barre du haut ne porte
 *  aucune sortie » — et il a fallu un retour d'usage pour que je l'applique
 *  vraiment. La première version disait « les quatre racines de LISTE » et
 *  laissait dehors `stats` et `home` sans autre raison que ce mot : or le
 *  `leading` de `StatsView` est un ornement décoratif, exactement comme les
 *  quatre autres, et le Home a son propre en-tête collant bâti sur la même
 *  recette. Énoncer un critère puis appliquer un autre est la façon la plus
 *  discrète de se tromper.
 *
 *  RESTE DEHORS, ET POUR LE CRITÈRE : `catalog` — sa barre porte un vrai
 *  `IconBtn icon="back"` vers l'inventaire. Ainsi que les formulaires, les
 *  fiches, la dégustation et les pages de documentation. */
export const AUTO_HIDE_VIEWS: ReadonlySet<string> = new Set([
  "home", "inv", "pipes", "acc", "journal", "stats",
]);

export interface ChromeGate {
  showWishForm?: boolean | undefined;
  editWishId?: unknown;
}

/** La vue courante autorise-t-elle l'escamotage ?
 *
 *  La superposition de la liste d'envies recouvre l'écran comme un formulaire :
 *  tant qu'elle est ouverte, la chrome dessous ne doit pas bouger. C'est la
 *  même garde que `shouldShowDock`, et pour la même raison. */
export function canAutoHideChrome(view: string, gate: ChromeGate = {}): boolean {
  return AUTO_HIDE_VIEWS.has(view) && !gate.showWishForm && !gate.editWishId;
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
