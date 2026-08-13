import React from "react";
import { assertLotInvariants, checkAllInvariants } from "../utils/lotInvariants.ts";
import { getDiagnosticSnapshot, clearDiagnostic } from "../utils/diagnostic.ts";

var useEffect = React.useEffect;
var useRef = React.useRef;

// Startup integrity probe extracted from App.tsx.
// `assertLotInvariants` runs on every save(), but a user who opens the app
// with already-corrupted data (external import, surviving a buggy older
// build) gets no save event until they edit — the diagnostic counter stays
// silent. This runs once after load() to feed the counter with the current
// state when the persisted snapshot is empty (so past saves aren't
// double-counted), and clears a stale counter when a fresh
// checkAllInvariants on the current state comes back empty.
//
// Critical fix: this was `useEffect(fn, [])` reading `data` from the
// mount-time closure. The initial state is `INIT` (empty) and
// `load()` is async, so the 1.5s timer always saw the EMPTY snapshot — the
// probe never surfaced real corruption AND, worse, when a persisted counter
// existed it ran checkAllInvariants(INIT) → [] → clearDiagnostic() on EVERY
// launch, wrongly standing down a live diagnostic. Same closure fix as
// useOrphanPhotoGC: gate on `loading === false`, read the latest data via a
// ref. Do NOT revert the `[loading]` dep or the ref.
export function useLotIntegrityProbe(data: any, loading: boolean): void {
  var ranRef = useRef(false);
  var dataRef = useRef(data);
  useEffect(function () { dataRef.current = data; });
  useEffect(function () {
    if (ranRef.current) return;
    if (loading) return;
    ranRef.current = true;
    var id = setTimeout(function () {
      var d = dataRef.current;
      if (!d) return;
      try {
        // Pass the current `data` so cross-ref lookups include
        // trashed entities (see save()). If a fresh run returns empty while
        // the persisted counter is non-zero, clear it so the diagnostic can
        // stand down.
        if (getDiagnosticSnapshot().count > 0) {
          var fresh = checkAllInvariants(d);
          if (fresh.length === 0) {
            try { clearDiagnostic(); } catch (_e) {}
          }
          return;
        }
        assertLotInvariants(d);
      } catch (_e) {}
    }, 1500);
    return function () { clearTimeout(id); };
  }, [loading]);
}
