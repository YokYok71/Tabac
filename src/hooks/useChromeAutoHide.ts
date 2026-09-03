import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  nextChromeState, initialChromeScrollState, CHROME_IDLE_REVEAL_MS,
  type ChromeScrollState,
} from "../utils/chromeAutoHide.ts";

// Le CÂBLAGE de l'escamotage : la règle vit dans `utils/chromeAutoHide.ts`,
// ce hook ne fait que lui apporter des mesures et poser un écouteur.
//
// TROIS CHOIX QUI NE SONT PAS DES DÉTAILS.
//
// (1) LA REMISE À ZÉRO SE FAIT EN PHASE DE RENDU, PAS DANS UN EFFET. Quitter
//     une liste doit oublier l'escamotage, sinon un aller-retour ramènerait la
//     vue avec sa navigation déjà invisible. La première version appelait
//     `setHidden(false)` dans le corps de l'effet ; `react-hooks/set-state-in-effect`
//     l'a refusé, et à raison — c'est un rendu en cascade. Le motif correct est
//     l'ajustement d'état quand une entrée change : comparer à la valeur
//     précédente PENDANT le rendu et corriger sur place. React le traite sans
//     rendu supplémentaire, là où l'effet en imposait un.
//
// (2) ÉCOUTEUR PASSIF + UNE SEULE MESURE PAR TRAME. `passive: true` parce
//     qu'on ne préviendra jamais le défilement et que le promettre coûte de la
//     fluidité sur mobile ; `requestAnimationFrame` parce qu'un défilement émet
//     bien plus d'événements qu'il n'y a de trames, et que `useProgressiveList`
//     charge déjà des lignes sur ce même flux. Les `setHidden` de l'effet sont
//     tous ASYNCHRONES (rappel de trame, minuteur) : c'est ce qui les distingue
//     de celui du point (1) et les rend légitimes.
//
// (3) LE RETOUR À L'ARRÊT EST UN MINUTEUR, PAS UNE MESURE. Il n'existe pas
//     d'événement « le défilement s'est arrêté » : on le déduit de l'absence
//     d'événement. Le minuteur est relancé à chaque tick et n'aboutit que si
//     plus rien ne bouge. C'est aussi le filet d'accessibilité — une navigation
//     escamotée revient seule en moins d'une seconde, sans qu'il faille deviner
//     le geste qui la ramène.
export function useChromeAutoHide(active: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  const [prevActive, setPrevActive] = useState(active);
  // La mémoire de la règle vit dans une ref, pas dans l'état : elle change à
  // chaque trame alors que seul `hidden` a besoin d'un rendu.
  const scroll = useRef<ChromeScrollState>(initialChromeScrollState(0));
  const rafId = useRef(0);
  const idleId = useRef(0);

  // Ajustement en phase de rendu (voir le point 1).
  if (prevActive !== active) {
    setPrevActive(active);
    setHidden(false);
  }

  useEffect(() => {
    if (!active) return;
    scroll.current = initialChromeScrollState(window.scrollY);
    let queued = false;

    const measure = () => {
      queued = false;
      const next = nextChromeState(scroll.current, {
        scrollY: window.scrollY,
        viewportH: window.innerHeight,
        docH: document.documentElement.scrollHeight,
      });
      scroll.current = next;
      setHidden(next.hidden);
    };

    // Révéler REMET LA RÈGLE À ZÉRO, sans quoi la trame suivante retrouverait
    // son ancrage d'avant l'arrêt et remasquerait aussitôt : le minuteur
    // paraîtrait ne rien faire.
    const reveal = () => { scroll.current = initialChromeScrollState(window.scrollY); setHidden(false); };

    const onScroll = () => {
      if (!queued) { queued = true; rafId.current = requestAnimationFrame(measure); }
      window.clearTimeout(idleId.current);
      idleId.current = window.setTimeout(reveal, CHROME_IDLE_REVEAL_MS);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId.current);
      window.clearTimeout(idleId.current);
    };
  }, [active]);

  // La conjonction plutôt que l'état seul : entre le changement de `active` et
  // l'ajustement, un rendu intermédiaire rendrait encore `true` et ferait
  // clignoter la chrome d'une vue qui n'escamote pas.
  return active && hidden;
}

// ── prefers-reduced-motion ────────────────────────────────────────────────
//
// LA PRÉFÉRENCE EST HONORÉE À DEUX ENDROITS, ET LES DEUX SONT NÉCESSAIRES.
// `index.html` porte une media query globale qui neutralise toutes les durées
// de transition et d'animation ; ce hook fait la même chose ici, en JavaScript,
// parce que la durée de l'escamotage passe par une VARIABLE CSS (`--chrome-ms`)
// qu'il faut poser depuis React — une feuille de style ne peut pas la calculer
// à notre place. Les deux visent le même résultat par deux chemins, et aucun ne
// rend l'autre inutile.
//
// CE PARAGRAPHE A LONGTEMPS DIT LE CONTRAIRE, ET IL FAUT SAVOIR POURQUOI. Il
// affirmait que l'application n'honorait la préférence « nulle part ailleurs —
// sept transitions dans les primitifs », et présentait cette exception comme
// une distinction assumée. Le chiffre était faux : il comptait un seul fichier.
// Le compte réel est de 68 transitions, dont 33 comportent un mouvement. Une
// exception défendable pour sept l'était beaucoup moins pour trente-trois, et
// c'est ce recomptage qui a produit la règle globale. Quand un commentaire
// justifie une exception par une quantité, la quantité est la première chose à
// vérifier.
//
// LA FONCTION EST CONSERVÉE, SEULE L'ANIMATION TOMBE. « Moins de mouvement » ne
// veut pas dire « moins de fonctionnalités » : la chrome s'escamote et revient
// de la même façon, elle le fait d'un coup au lieu de glisser.
//
// `useSyncExternalStore` PLUTÔT QU'UN EFFET : une media query EST un magasin
// extérieur, et c'est le hook prévu pour s'y abonner. Il évite le `setState`
// synchrone que la première version faisait dans un effet — refusé par
// `react-hooks/set-state-in-effect`, à raison.
//
// LE RÉSIDU QUI ÉTAIT ÉNONCÉ ICI EST FERMÉ : la généralisation existe, sous la
// forme d'une règle CSS globale dans `index.html` plutôt que d'un hook porté
// dans trente-trois composants. La forme compte autant que le fait — une règle
// couvre aussi les transitions qui n'existent pas encore, là où trente-trois
// sites d'appel sont trente-trois occasions d'oublier le trente-quatrième.
// Gardée par `useChromeAutoHide.test.ts`, qui exige la PROPRIÉTÉ (une media
// query `reduce`, un sélecteur universel, les deux durées neutralisées, aucune
// à zéro) et non l'orthographe de la règle.
const RM_QUERY = "(prefers-reduced-motion: reduce)";

function rmMatchMedia(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(RM_QUERY);
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = rmMatchMedia();
  if (!mq) return () => {};
  // `addEventListener` sur un MediaQueryList manque sur les Safari anciens,
  // qui n'ont que `addListener` — et c'est une plateforme cible.
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }
  return () => {};
}

/** Instantané. Un booléen est une primitive, donc `useSyncExternalStore` peut
 *  le comparer d'un rendu à l'autre sans piège d'identité. L'absence de
 *  `matchMedia` rend « pas de préférence », jamais une exception. */
function getReducedMotion(): boolean {
  const mq = rmMatchMedia();
  return mq ? mq.matches : false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
}
