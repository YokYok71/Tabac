import React from "react";
import { isWithinDays } from "../utils.ts";
import { lsGet, lsSet, lsRemove } from "../utils/appStorage.ts";
import { LOCALSTORAGE_BUDGET_CHARS } from "../constants.ts";

var useEffect = React.useEffect;

// Proactive storage-quota warning extracted verbatim from
// App.tsx. The browser silently rejects writes that would push localStorage /
// IndexedDB past the origin's quota; on mobile (especially iOS) that quota can
// be as low as ~50 MB and gets evicted under memory pressure. Probes
// `navigator.storage.estimate()` at mount and on every `data` change (~1 ms),
// and when usage/quota >= 80 % raises the existing `saveWarn` banner with an
// actionable message. A 7-day dismissal flag (`cave-quota-warn-dismissed`)
// suppresses re-warning, auto-cleared when usage drops back below 80 %.
// Wrapped in try/catch — browsers without storage.estimate skip silently.
//
// ── TWO BUDGETS, NOT ONE ────────────────────────────────────────────────────
//
// The origin probe above is the right measurement for the PHOTO store, and it
// is the only one this hook ever made. The CELLAR lives in `localStorage`,
// which has its own ~5 MB sub-quota that the StorageManager commonly does not
// account for — the comment below has conceded that for a long time, and what
// was never measured is how close a real collection already is. MEASURED in
// Chromium: the ceiling is 5 200 000 chars, a serious collector's cellar is
// 2 899 338 of them (55.8 %), and `estimate()` reports 0.112 % at the moment
// `setItem` throws. So the guard was watching a budget three orders of
// magnitude away from the one that fails.
//
// `cellarChars` is the length of the string `save()` was about to write — it
// already has it in hand, and re-stringifying here would double a cost
// measured at 13-15 ms on a large cellar, on every data change. The hook warns
// on WHICHEVER RATIO IS WORSE and reports the numbers that go with it:
// telling the user about the milder of the two would understate the risk and
// point at the wrong remedy.
export function useStorageQuotaWarning(
  data: any,
  lang: string,
  t: ((k: string) => string) | undefined,
  setSaveWarn: (msg: string) => void,
  cellarChars?: number,
): () => void {
  // `lang` is a dep so the warning message re-localises on a language switch.
  void lang;
  // Remember whether the CURRENT banner was
  // raised by THIS hook, so the "usage came back down" branch only clears a
  // warning we own — never the save() QuotaExceeded migration warning, which
  // shares `setSaveWarn`. That migration fires when localStorage (its own small
  // ~5 MB sub-quota) overflows, independent of the origin StorageManager quota
  // this hook measures (estimate() commonly excludes localStorage). Its setData
  // re-fires this effect with the origin ratio < 0.8, so a blanket clear wiped
  // the just-raised, actionable "back up before writes fail" prompt in the same
  // tick — exactly when the user most needed it.
  var raisedRef = React.useRef(false);
  useEffect(function () {
    var cancelled = false;

    function apply(ratio: number, usedBytes: number, quotaBytes: number) {
      if (cancelled) return;
      var dismissedAt = parseInt(lsGet("cave-quota-warn-dismissed", "0") || "0") || 0;
      var stillSuppressed = isWithinDays(dismissedAt, 7);
      if (ratio >= 0.8 && !stillSuppressed) {
        var pct = Math.round(ratio * 100);
        var usedMb = (usedBytes / (1024 * 1024)).toFixed(1);
        var quotaMb = (quotaBytes / (1024 * 1024)).toFixed(0);
        var _tpl = t ? t("warn_storage_high")
          : "Stockage à {pct}% ({used} Mo / {quota} Mo). Pensez à exporter ou sauvegarder dans le cloud avant que le navigateur ne refuse d'écrire.";
        setSaveWarn(String(_tpl).replace("{pct}", String(pct)).replace("{used}", usedMb).replace("{quota}", quotaMb));
        raisedRef.current = true;
      } else if (ratio < 0.8) {
        // Usage came back under the threshold (export-then-reset, or the
        // browser garbage-collected the image cache). Clear the dismissal so
        // a future spike re-warns instead of staying silent forever.
        if (dismissedAt) lsRemove("cave-quota-warn-dismissed");
        // Also clear a banner already RAISED this session —
        // the original code only cleared the dismissal flag, so a live warning
        // lingered after the condition cleared until manually dismissed.
        // ONLY clear it if WE raised it (raisedRef) — otherwise the
        // save() migration warning would be wiped in the same tick (see above).
        if (raisedRef.current) { setSaveWarn(""); raisedRef.current = false; }
      }
    }

    // The cellar's own budget. Computed FIRST and applied even when the origin
    // probe is unavailable — the effect used to `return` before doing anything
    // on a browser without `storage.estimate`, so there nothing was measured
    // at all.
    var chars = Number(cellarChars) || 0;
    var localRatio = chars > 0 ? chars / LOCALSTORAGE_BUDGET_CHARS : 0;
    function applyLocal() { apply(localRatio, chars, LOCALSTORAGE_BUDGET_CHARS); }

    var nav: any = typeof navigator === "undefined" ? null : navigator;
    if (!nav || !nav.storage || typeof nav.storage.estimate !== "function") {
      applyLocal();
      return function () { cancelled = true; };
    }
    nav.storage.estimate().then(function (est: any) {
      if (cancelled) return;
      var usage = Number(est && est.usage) || 0;
      var quota = Number(est && est.quota) || 0;
      var originRatio = quota ? usage / quota : 0;
      if (originRatio >= localRatio) apply(originRatio, usage, quota);
      else applyLocal();
    }).catch(function () {
      // permission denied / private mode — the origin figure is unavailable,
      // but the cellar's own budget is still knowable and still matters.
      applyLocal();
    });
    return function () { cancelled = true; };
  }, [data, lang, setSaveWarn, cellarChars]);

  // The DISMISSAL is owned here for the same reason the
  // clearing branch has `raisedRef`: `saveWarn` is a SHARED channel, and
  // the banner's × used to write `cave-quota-warn-dismissed` unconditionally.
  // The tasting auto-end notice rides that channel too, so
  // closing « Dégustation clôturée automatiquement après 95 min » SILENCED the
  // "storage is 80 % full, back up before writes fail" warning for SEVEN DAYS
  // — a protection disarmed by a gesture that has nothing to do with it, with
  // nothing said. The same applies to the save() QuotaExceeded migration
  // warning, which has shared this channel since long before.
  //
  // The hook is the only place that knows whether the banner on screen is
  // ITS banner, so the write belongs here and nowhere else.
  return React.useCallback(function () {
    if (!raisedRef.current) return;
    raisedRef.current = false;
    lsSet("cave-quota-warn-dismissed", String(Date.now()));
  }, []);
}
