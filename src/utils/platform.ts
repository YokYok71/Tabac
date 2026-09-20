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

// IL Y A EU UN `IS_IPHONE` ICI, ET IL A ÉTÉ RETIRÉ — tombstone, pour que la
// prochaine session ne le réinvente pas sur le même raisonnement. Il donnait au
// téléphone un dégagement d'en-tête plus court que la tablette, au motif que le
// voile d'iOS 26/27 y était moins profond. Cette « mesure » venait de captures
// iPhone où le voile n'était pas actif : il n'apparaît qu'après une navigation,
// et rien sur une image ne dit si elle a eu lieu. On n'a donc AUCUNE mesure de
// sa profondeur sur téléphone — voir `HEADER_BAND_CLEARANCE_PX` dans
// `theme-curator.ts` pour l'arithmétique qui a démasqué la contradiction.
