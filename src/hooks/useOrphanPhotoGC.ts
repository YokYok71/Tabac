import React from "react";
import { gcOrphans } from "../utils/imgCache.ts";

var useRef = React.useRef,
  useEffect = React.useEffect;

// Orphan-photo garbage collector extracted verbatim from
// App.tsx. Runs once on mount, after a 4 s delay so the initial data has
// settled into state. Walks the live `data` for every `local-photo-*`
// reference (entities + session snapshots) and asks `gcOrphans` to drop any
// IndexedDB key that doesn't appear. The util has its own age guard (skips
// keys < 5 min old) so a photo taken in a form mid-session isn't killed
// during the same session. Failures are silent — IndexedDB might be missing
// (private mode, jsdom, very old browsers) and there's nothing actionable.
//
// A closure bug once captured `data` at
// effect-mount time (always `null` because `load()` is async and setData
// hasn't applied yet) and `gcOrphans` received an EMPTY referenced set every
// launch. Combined with the 5-minute age guard, that quietly nuked every
// local-photo-* older than 5 minutes on every cold start.
//
// Then the initial `data` state was switched from `null`
// to `INIT` (empty inventory, for the instant shell). That re-broke it —
// `data` was truthy from frame 0, the effect flipped `ranRef` immediately
// with empty arrays, and the 4 s timer fired before `load()` finished on
// slow devices. The fix gates the effect on `loading === false` (the signal
// that `load()` has completed) so the timer only schedules once the real
// inventory is in state, and reads the LATEST data through `dataRef` inside
// the deferred callback (never a stale mount-time snapshot).
//
// INVARIANTS (locked by src/__tests__/imgGcGating.test.tsx): the dep array
// MUST stay `[loading]` and the guard MUST stay `if (loading) return`.
// Changing either back to a `data`-based form fails the "does NOT call
// gcOrphans while loading=true" assertion.
export function useOrphanPhotoGC(data: any, loading: boolean): void {
  var ranRef = useRef(false);
  var dataRef = useRef(data);
  useEffect(function () {
    dataRef.current = data;
  });
  useEffect(function () {
    if (ranRef.current) return;
    if (loading) return;
    ranRef.current = true;
    var timer = setTimeout(function () {
      var d = dataRef.current;
      if (!d) return;
      var referenced = new Set<string>();
      function collect(arr: any) {
        (arr || []).forEach(function (it: any) {
          if (it && typeof it.imageUrl === "string" && it.imageUrl.indexOf("local-photo-") === 0) {
            referenced.add(it.imageUrl);
          }
          // Additional pipe photos — must stay referenced or the GC
          // would delete their blobs.
          if (it && Array.isArray(it.photos)) {
            it.photos.forEach(function (ph: any) {
              if (typeof ph === "string" && ph.indexOf("local-photo-") === 0) referenced.add(ph);
            });
          }
        });
      }
      collect(d.tobaccos);
      collect(d.pipes);
      collect(d.wishlist);
      collect(d.accessories);
      // Also walk session snapshots — `tobaccoSnapshot` and
      // `pipeSnapshot` carry a frozen `imageUrl` that may point
      // at a `local-photo-*` key still needed long after the parent entity
      // was permanently deleted (the "journal keeps the entity photo even
      // after purge" promise). Walk both live and trashed sessions.
      (d.sessions || []).forEach(function (s: any) {
        if (!s) return;
        var sk = s.tobaccoSnapshot && s.tobaccoSnapshot.imageUrl;
        if (typeof sk === "string" && sk.indexOf("local-photo-") === 0) {
          referenced.add(sk);
        }
        var pk = s.pipeSnapshot && s.pipeSnapshot.imageUrl;
        if (typeof pk === "string" && pk.indexOf("local-photo-") === 0) {
          referenced.add(pk);
        }
      });
      try { gcOrphans(referenced).catch(function () {}); } catch (_e) {}
    }, 4000);
    return function () { clearTimeout(timer); };
  }, [loading]);
}
