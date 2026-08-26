/**
 * L'IDENTITÉ D'UNE *SESSION* DE FORMULAIRE — ce qui distingue deux ouvertures
 * successives du MÊME formulaire d'ajout.
 *
 * POURQUOI. Une réponse d'IA met jusqu'à 60 s, n'est pas annulée à la
 * navigation, et se pose sur la copie de travail courante au moment où elle
 * arrive. La garde existante compare l'`id` de la fiche visée — ce qui règle le
 * cas des fiches en ÉDITION et laisse un trou énoncé : **deux formulaires
 * d'AJOUT successifs portent tous deux `undefined`**, donc ouvrir « nouveau
 * tabac », lancer la recherche, sortir, rouvrir « nouveau tabac » faisait
 * atterrir la première réponse dans le second formulaire.
 *
 * CE QUI A ÉTÉ ESSAYÉ ET REJETÉ, pour que personne ne le retente : se rabattre
 * sur marque + nom. La chaîne scan-photo → auto-remplissage construit sa requête
 * à partir du RÉSULTAT DU SCAN pendant que le formulaire porte encore la valeur
 * précédente, donc cette règle jetterait une réponse que l'utilisateur attend.
 *
 * CE QUI A ÉTÉ ESSAYÉ ET REJETÉ AUSSI : estampiller un jeton DANS la copie de
 * travail. Les stores construisent l'entité par `Object.assign({}, source, …)`,
 * donc le jeton serait PERSISTÉ comme champ fantôme sur la cave — un défaut pire
 * que celui qu'il corrige.
 *
 * D'OÙ UN COMPTEUR DE MODULE, hors des données. Ce n'est PAS de l'état de
 * formulaire : `nav()` a l'interdiction absolue de réinitialiser un `editXxxId`
 * ou une copie de travail — c'est l'invariant dur de cette application — et
 * incrémenter un compteur de navigation ne touche à rien de tout cela.
 *
 * LE SITE D'INCRÉMENT EST `nav()` LUI-MÊME, sans liste de vues. Une liste de
 * noms de vues est exactement la forme qui pourrit dans ce dépôt ; « l'utilisateur
 * a navigué » suffit, et un incrément superflu ne fait que jeter une réponse en
 * vol, ce qui est le côté prudent. Le formulaire d'ENVIE est le seul que `nav`
 * ne voit pas — c'est un calque, pas une vue — donc ses deux ouvreurs
 * l'incrémentent eux-mêmes.
 */

var _n = 0;

/** Ouvre une nouvelle session de formulaire. Rend la valeur pour les tests. */
export function bumpFormSession(): number {
  _n += 1;
  return _n;
}

/** La session courante. Lue au LANCEMENT de l'appel puis à sa RÉSOLUTION :
 *  si elle a changé entre les deux, la réponse ne concerne plus ce qui est à
 *  l'écran. */
export function currentFormSession(): number {
  return _n;
}

/** Tests uniquement — remet le compteur de module à zéro. */
export function _resetFormSessionForTests(): void {
  _n = 0;
}
