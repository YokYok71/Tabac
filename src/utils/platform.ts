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

// `IS_IPHONE` A ÉTÉ RETIRÉ PUIS REMIS, ET LES DEUX FOIS COMPTENT.
//
// Il donne au téléphone un dégagement d'en-tête plus court que la tablette,
// parce que le voile d'iOS 26/27 y est moins profond. Une PREMIÈRE version l'a
// été sur des captures iPhone où le voile n'était PAS actif — il n'apparaît
// qu'après une navigation, et rien sur une image ne le dit — donc elle mesurait
// son absence. Elle a été supprimée.
//
// LA SECONDE REPOSE SUR UNE CAPTURE DONT L'APPLICABILITÉ EST ÉTABLIE : celle du
// build 31, dont l'utilisateur confirme avoir quitté l'accueil avant de la
// prendre. Voir `HEADER_BAND_CLEARANCE_PHONE_PX` dans `theme-curator.ts` pour
// la mesure et pour ce qu'elle établit exactement — qui est moins que sur
// l'iPad, et dit comme tel.
//
// La forme est volontairement l'inverse de `IS_IOS` : on ne teste QUE le
// téléphone, parce que l'iPad se déclare « MacIntel » depuis iPadOS 13 et
// qu'une liste qui l'énumère se trompe au premier modèle suivant. Tout ce qui
// n'est pas un iPhone retombe sur la valeur tablette, qui est la prudente.
export var IS_IPHONE =
  typeof navigator !== "undefined" && /iPhone|iPod/.test(navigator.userAgent);
