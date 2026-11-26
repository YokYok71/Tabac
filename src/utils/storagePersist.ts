// Ask the browser to keep this site's storage (the cellar in localStorage and
// the photos in IndexedDB) instead of treating it as best-effort.
//
// The app never asked. Without it, Chromium and Firefox may evict a site's
// storage under disk pressure — cellar and photos together — and an installed
// PWA is not exempt by default. Asked once per launch after the cellar has
// loaded; a refusal or a missing API is not an error (Safari, older engines),
// the result is only returned for the caller and its test. Resolves:
//   true  — persistent (already, or granted now)
//   false — the browser said no
//   null  — the API is not available
export function requestPersistentStorage(nav?: any): Promise<boolean | null> {
  try {
    var n = nav || (typeof navigator !== "undefined" ? navigator : null);
    var st = n && n.storage;
    if (!st || typeof st.persist !== "function") return Promise.resolve(null);
    var already = typeof st.persisted === "function" ? st.persisted() : Promise.resolve(false);
    return Promise.resolve(already)
      .then(function (p: any) { return p === true ? true : st.persist(); })
      .then(function (r: any) { return r === true; })
      .catch(function () { return null; });
  } catch (_e) {
    return Promise.resolve(null);
  }
}
