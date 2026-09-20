// Single source of truth for the two platform-detection flags,
// previously DUPLICATED in App.tsx and useGdriveAuth.ts (which each declared
// their own IS_IOS_STANDALONE). Pure module-level constants, evaluated once
// at import. The `typeof window` / `typeof navigator` guards are SSR-safe
// (harmless in the browser, needed for any non-DOM import path).
// `window.navigator.standalone` is declared in src/globals.d.ts.
//
// Intentional asymmetry (see CLAUDE.md "iOS / Android parity"):
// IS_IOS_STANDALONE gates the iOS-standalone OAuth redirect flow — do NOT
// widen it to Android PWA display-mode, that would break Android Drive auth.
export var IS_IOS_STANDALONE =
  typeof window !== "undefined" && window.navigator.standalone === true;
export var IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// IS_IPHONE distingue le TÉLÉPHONE de la tablette, et n'a qu'un seul client :
// le dégagement d'en-tête (`HEADER_TOP_FLOOR`). Le voile que peint iOS 26/27 au
// bord haut n'a PAS la même profondeur sur les deux — mesuré 38 px CSS sur
// l'iPad, borné à ≤ 28 sur l'iPhone — donc une valeur unique fait payer à l'un
// la géométrie de l'autre. C'est une asymétrie MESURÉE, pas une préférence.
//
// La forme est volontairement l'inverse de `IS_IOS` : on ne teste QUE le
// téléphone, parce que l'iPad se déclare « MacIntel » depuis iPadOS 13 et
// qu'une liste qui l'énumère se trompe au premier modèle suivant. Tout ce qui
// n'est pas un iPhone retombe sur la valeur tablette, qui est la prudente.
export var IS_IPHONE =
  typeof navigator !== "undefined" && /iPhone|iPod/.test(navigator.userAgent);
