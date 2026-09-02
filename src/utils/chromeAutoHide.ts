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

/** Descente CUMULÉE, sur une même course, à partir de laquelle on masque.
 *  Assez pour qu'un tremblement de doigt ou le rebond iOS ne déclenche rien.
 *
 *  « CUMULÉE » EST LE MOT QUI MANQUAIT, ET SON ABSENCE ÉTAIT UN DÉFAUT LIVRÉ.
 *  Le commentaire disait déjà « cumulée » ; le code comparait le déplacement
 *  d'UNE TRAME. Or `useChromeAutoHide` ne mesure qu'une fois par trame, donc le
 *  seuil était devenu, sans que rien ne le dise, une VITESSE : 12 px par trame,
 *  soit ~720 px/s. Un geste vif la dépasse, un glissement posé — celui qu'on
 *  fait en lisant — ne l'atteint jamais. D'où le rapport « quand je swipe vers
 *  le haut ça ne se masque pas » : la fonctionnalité marchait pour qui jetait
 *  la liste et restait absente pour qui la lisait. Le seuil est maintenant
 *  mesuré depuis le début de la course en cours (voir `nextChromeState`), donc
 *  quatre trames à 3 px masquent comme une trame à 13 px. */
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

/** Ce qu'une trame MESURE. Aucune position antérieure ici : le passé est dans
 *  l'état, pas dans la mesure. */
export interface ScrollMetrics {
  scrollY: number;
  viewportH: number;
  docH: number;
}

/** Ce que la règle RETIENT d'une trame à l'autre.
 *
 *  DEUX REPÈRES, ET IL EN FAUT BIEN DEUX — c'est là qu'était le défaut. Avec la
 *  seule position précédente, on ne peut lire qu'une VITESSE ; avec le seul
 *  point d'ancrage, on ne peut plus lire un RETOURNEMENT (descendu de 100 px
 *  puis remonté de 5, le cumul reste +95 et la barre ne reviendrait pas, alors
 *  que la remontée immédiate est la moitié de la règle sur laquelle
 *  l'utilisateur compte). Donc :
 *
 *   - `lastY`   : la dernière position mesurée. Sert à lire la DIRECTION.
 *   - `anchorY` : l'endroit où la course en cours a commencé. Sert à lire la
 *                 QUANTITÉ parcourue depuis, dans cette direction. Il est
 *                 remis à `lastY` à chaque retournement — ce qui fait
 *                 exactement du cumul « depuis le dernier changement de sens ». */
export interface ChromeScrollState {
  hidden: boolean;
  anchorY: number;
  lastY: number;
}

/** État de départ, et aussi état de RETOUR : révéler, c'est repartir d'ici.
 *  Le minuteur d'immobilité s'en sert pour que la course suivante se mesure
 *  depuis la position actuelle et non depuis un ancrage périmé. */
export function initialChromeScrollState(scrollY: number): ChromeScrollState {
  return { hidden: false, anchorY: scrollY, lastY: scrollY };
}

/** LA RÈGLE. Rendue par `nextChromeState(étatPrécédent, mesures)`.
 *
 *  L'ordre des clauses EST la règle, et chacune l'emporte sur les suivantes :
 *
 *   1. page trop courte  → visible (rien à gagner)
 *   2. près du sommet    → visible (on n'a encore rien gagné)
 *   3. course vers le haut, si courte soit-elle → visible, IMMÉDIATEMENT
 *   4. course vers le bas au-delà du seuil → masqué
 *   5. sinon             → on garde l'état, pour ne pas osciller sur le bruit
 *
 *  La clause 3 avant la 4 est ce qui rend la remontée fiable : c'est le geste
 *  par lequel l'utilisateur redemande la recherche et les filtres, et il doit
 *  aboutir avant qu'il n'y arrive.
 *
 *  Les clauses 1 et 2 REPARTENT DE ZÉRO plutôt que de simplement rendre
 *  `false` : une course entamée dans une zone où l'on ne masque pas ne doit pas
 *  compter pour la suivante, sinon revenir au sommet puis redescendre de 2 px
 *  masquerait d'un coup. */
export function nextChromeState(s: ChromeScrollState, m: ScrollMetrics): ChromeScrollState {
  if (!(m.docH - m.viewportH > m.viewportH * CHROME_MIN_OVERFLOW_RATIO)) {
    return initialChromeScrollState(m.scrollY);
  }
  if (m.scrollY <= CHROME_REVEAL_TOP_PX) return initialChromeScrollState(m.scrollY);

  var step = m.scrollY - s.lastY;
  var anchorY = s.anchorY;
  // Retournement : la course précédente est close, la nouvelle part d'ici.
  if (step > 0 && s.anchorY > s.lastY) anchorY = s.lastY;
  if (step < 0 && s.anchorY < s.lastY) anchorY = s.lastY;

  var run = m.scrollY - anchorY;
  var hidden = s.hidden;
  if (run < 0) hidden = false;
  else if (run > CHROME_HIDE_DELTA_PX) hidden = true;

  return { hidden: hidden, anchorY: anchorY, lastY: m.scrollY };
}
