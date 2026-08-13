import React from "react";
import { isWithinDays } from "../utils.ts";
import { lsGet, lsSet, lsRemove } from "../utils/appStorage.ts";

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
export function useStorageQuotaWarning(
  data: any,
  lang: string,
  t: ((k: string) => string) | undefined,
  setSaveWarn: (msg: string) => void,
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
    if (typeof navigator === "undefined") return;
    var nav: any = navigator;
    if (!nav.storage || typeof nav.storage.estimate !== "function") return;
    var cancelled = false;
    nav.storage.estimate().then(function (est: any) {
      if (cancelled) return;
      var usage = Number(est && est.usage) || 0;
      var quota = Number(est && est.quota) || 0;
      if (!quota) return;
      var ratio = usage / quota;
      var dismissedAt = parseInt(lsGet("cave-quota-warn-dismissed", "0") || "0") || 0;
      var stillSuppressed = isWithinDays(dismissedAt, 7);
      if (ratio >= 0.8 && !stillSuppressed) {
        var pct = Math.round(ratio * 100);
        var usedMb = (usage / (1024 * 1024)).toFixed(1);
        var quotaMb = (quota / (1024 * 1024)).toFixed(0);
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
    }).catch(function () { /* permission denied / private mode — silent */ });
    return function () { cancelled = true; };
  }, [data, lang, setSaveWarn]);

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
