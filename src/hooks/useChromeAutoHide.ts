import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  nextChromeHidden, CHROME_IDLE_REVEAL_MS,
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
  const prevY = useRef(0);
  const rafId = useRef(0);
  const idleId = useRef(0);

  // Ajustement en phase de rendu (voir le point 1).
  if (prevActive !== active) {
    setPrevActive(active);
    setHidden(false);
  }

  useEffect(() => {
    if (!active) return;
    prevY.current = window.scrollY;
    let queued = false;

    const measure = () => {
      queued = false;
      const m = {
        scrollY: window.scrollY,
        prevScrollY: prevY.current,
        viewportH: window.innerHeight,
        docH: document.documentElement.scrollHeight,
      };
      setHidden((h) => nextChromeHidden(h, m));
      prevY.current = window.scrollY;
    };

    const onScroll = () => {
      if (!queued) { queued = true; rafId.current = requestAnimationFrame(measure); }
      window.clearTimeout(idleId.current);
      idleId.current = window.setTimeout(() => setHidden(false), CHROME_IDLE_REVEAL_MS);
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
// CETTE APPLICATION N'HONORE `prefers-reduced-motion` NULLE PART AILLEURS —
// sept transitions dans les primitifs, aucune garde. La traiter ici et pas
// ailleurs n'est pas une incohérence par distraction, c'est une distinction
// assumée : les sept autres sont des micro-mouvements de quelques pixels sur un
// bouton pressé, celle-ci est une bande PLEINE LARGEUR qui traverse l'écran.
// C'est précisément la classe de mouvement que cette préférence existe pour, et
// la seule de l'app à ce jour.
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
// RÉSIDU ÉNONCÉ : généraliser la préférence aux sept autres transitions est un
// chantier à part, non fait ici.
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
