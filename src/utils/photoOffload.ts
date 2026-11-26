// The quota fallback of App's save(): move inline `data:` photos out of the
// cellar JSON into IndexedDB so the JSON fits in localStorage again.
//
// A row's imageUrl is swapped for its key ONLY once the write is confirmed.
// `imgCache.put` reports failure by RESOLVING `false` (it never rejects on a
// quota abort); the inline version of this code ignored that result and
// swapped every key up front, so with localStorage full AND IndexedDB refusing
// too — browser-wide storage pressure, private mode — the cellar was saved
// pointing at photos that were never written: shown for the session from
// memory, gone at the next launch. A photo whose write failed keeps its
// `data:` URI. Keys come from `makeKey` (random in the app): the old
// `local-photo-t-<id>` was deterministic, so a merge from another device that
// went through the same path could overwrite this device's photo.

export function offloadDataPhotos(
  slim: any,
  put: (key: string, dataUri: string) => Promise<boolean>,
  makeKey: () => string,
): Promise<Record<string, string>> {
  var tasks: Array<{ obj: any; key: string; du: string }> = [];
  ["tobaccos", "pipes", "accessories", "wishlist"].forEach(function (coll) {
    var arr = slim && Array.isArray(slim[coll]) ? slim[coll] : [];
    arr.forEach(function (obj: any) {
      if (obj && obj.id && typeof obj.imageUrl === "string" && obj.imageUrl.indexOf("data:") === 0) {
        tasks.push({ obj: obj, key: makeKey(), du: obj.imageUrl });
      }
    });
  });
  return Promise.all(tasks.map(function (tk) { return put(tk.key, tk.du); })).then(function (results) {
    var moved: Record<string, string> = {};
    tasks.forEach(function (tk, i) {
      if (results[i] !== true) return;
      tk.obj.imageUrl = tk.key;
      moved[tk.key] = tk.du;
    });
    return moved;
  });
}
