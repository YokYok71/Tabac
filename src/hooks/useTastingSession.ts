import React from "react";
import { LANG } from "../i18n.ts";
import { findById } from "../utils.ts";
import { lsSet, lsRemove } from "../utils/appStorage.ts";

var useState = React.useState;
var useEffect = React.useEffect;
var useRef = React.useRef;

// Resolve a UI string in the active language (hooks can't reach ctx.t).
// Falls back to ENGLISH: it is the only dictionary compiled in, so
// it is the only one guaranteed present. French was the fallback while all five
// were static; now an un-loaded language would have resolved to `undefined`.
function tr(lang: string | undefined, key: string): string {
  var dict = (LANG as any)[lang || "en"] || LANG.en;
  return dict[key] || (LANG.en as any)[key] || key;
}

export var TASTING_KEY = "cave-tasting-active";
export var OVERTIME_THRESHOLD_MS = 90 * 60 * 1000; // prompt after 90 min of elapsed time
export var OVERTIME_AUTO_END_MS = 5 * 60 * 1000; //  auto-end 5 min after the prompt fires

export type TastingState =
  | {
      stage: "setup";
      tobaccoId: string;
      pipeId: string;
      lotId: string;
      weightG: string;
      rating: number;
      notes: string;
      /** Tapped aroma keys (see src/utils/aromas.ts). */
      aromas?: string[];
      /** Optional capture point (explicit user tap). */
      lat?: number;
      lng?: number;
      /** Reverse-geocoded place parts (spot / commune / country). */
      locationName?: string;
      locationCity?: string;
      locationCountry?: string;
    }
  | {
      stage: "running";
      startTs: number;
      pausedAccumMs: number;
      pauseStartTs: number | null;
      tobaccoId: string;
      pipeId: string;
      lotId: string;
      weightG: string;
      rating: number;
      notes: string;
      /** See setup variant. */
      aromas?: string[];
      overtimeThresholdMs?: number;
      /** See setup variant. */
      lat?: number;
      lng?: number;
      /** See setup variant. */
      locationName?: string;
      locationCity?: string;
      locationCountry?: string;
    };

function readTasting(): TastingState | null {
  try {
    var raw = localStorage.getItem(TASTING_KEY);
    if (!raw) return null;
    var p = JSON.parse(raw);
    if (!p || (p.stage !== "setup" && p.stage !== "running")) return null;
    // Validate the numeric fields. A forged payload with
    // `startTs: Infinity` (or non-number / negative) would otherwise
    // produce a `Date.now() - Infinity = -Infinity` elapsed time, then
    // NaN:NaN in the timer banner, infinite overtime prompt, and a
    // session saved with `duration: Infinity`. Reject the whole record
    // if any of the three numeric fields is bogus — safer than trying
    // to repair (the user can always restart a tasting).
    function isFiniteNonNeg(v: any): boolean {
      return typeof v === "number" && Number.isFinite(v) && v >= 0;
    }
    if (p.stage === "running") {
      if (!isFiniteNonNeg(p.startTs)) return null;
      // Reject a startTs far in the
      // FUTURE (a forged blob or a gross clock skew). tastingElapsedMs
      // clamps a future start to 0, so the timer would freeze at 00:00 and
      // overtime would never fire. A 24 h margin never false-rejects a real
      // small skew (which self-corrects as wall-clock catches up) while
      // killing an absurd/forged value that would freeze the timer forever.
      if (p.startTs > Date.now() + 24 * 60 * 60 * 1000) return null;
      if (p.pausedAccumMs !== undefined && !isFiniteNonNeg(p.pausedAccumMs)) return null;
      if (p.pauseStartTs !== undefined && p.pauseStartTs !== null &&
          !isFiniteNonNeg(p.pauseStartTs)) return null;
      // Symmetric future-value guard for
      // pauseStartTs (the original guard covered startTs alone). A forged blob with a
      // far-future pauseStartTs makes the "paused" elapsed absurd, and the
      // loading-gated auto-end then saves a phantom session with a
      // multi-million-minute duration. Also reject a pause that starts BEFORE
      // the session (incoherent). startTs is already validated finite above.
      if (p.pauseStartTs !== undefined && p.pauseStartTs !== null &&
          (p.pauseStartTs > Date.now() + 24 * 60 * 60 * 1000 || p.pauseStartTs < p.startTs)) return null;
      if (p.overtimeThresholdMs !== undefined &&
          !isFiniteNonNeg(p.overtimeThresholdMs)) return null;
      // The checks above only REJECT a bogus value; an
      // ABSENT field passes but then feeds `endTs - startTs - undefined = NaN`
      // into the elapsed math → NaN:NaN timer forever. Default the optional
      // pause fields so a partial (forged / legacy) running blob still ticks.
      if (p.pausedAccumMs === undefined) p.pausedAccumMs = 0;
      if (p.pauseStartTs === undefined) p.pauseStartTs = null;
    }
    return p;
  } catch (_e) {
    return null;
  }
}

function writeTasting(s: TastingState | null) {
  try {
    if (s === null) lsRemove(TASTING_KEY);
    else lsSet(TASTING_KEY, JSON.stringify(s));
  } catch (_e) {}
}

export function useTastingSession({
  addSessionFromTasting,
  nav,
  data,
  loading,
  setSaveError,
  setSaveWarn,
  lang,
  accountingEnabled,
}: {
  addSessionFromTasting: (form: any, opts?: { navigate?: boolean }) => boolean;
  nav: (v: string) => void;
  data?: any;
  // The App-level load() flag. The
  // auto-end effect MUST NOT fire while this is true — see its guard below.
  loading?: boolean;
  setSaveError?: (msg: string | null) => void;
  // The auto-end is a DESIGNED outcome, not a failure, so it says so
  // on the amber channel. Only the degraded case (the lot vanished, no weight
  // could be charged) keeps the oxblood one.
  setSaveWarn?: (msg: string | null) => void;
  lang?: string;
  // The global accounting toggle. When
  // OFF, tastingEnd forces weightG="" so a tasting IGNITED while accounting was
  // ON (carrying a non-zero weight) can't silently deduct after the user
  // disables accounting mid-session — the running-stage weight field is hidden
  // in off-mode, so the user has no way to zero it otherwise.
  accountingEnabled?: boolean;
}) {
  var _t = useState<TastingState | null>(readTasting),
    tasting = _t[0],
    setTasting = _t[1];
  var _k = useState(0),
    tick = _k[0],
    setTick = _k[1];
  var wakeLockRef = useRef<any>(null);

  // 1s tick when running and not paused — only for re-render
  useEffect(
    function () {
      if (!tasting) return;
      if (tasting.stage !== "running") return;
      // The tick used to STOP while paused, on the reasoning that a
      // frozen timer has nothing to re-render. That reason died with the
      // pause-overtime rule: the prompt, its countdown and the auto-end all now
      // advance during a pause, and with no tick nothing re-fires the effect —
      // a session paused with the app left OPEN would never close. The deps
      // still key on stage + pauseStartTs, so a keystroke in the notes field
      // does not churn the interval (the finding this gate came with).
      var iv = setInterval(function () {
        setTick(function (x) {
          return (x + 1) & 0xffff;
        });
      }, 1000);
      return function () {
        clearInterval(iv);
      };
    },
    // Key on the two fields that actually
    // decide whether the interval should run, NOT the whole `tasting` object.
    // Typing in the live notes/weight field mutates `tasting` on every
    // keystroke; keying on `[tasting]` tore down + recreated the interval each
    // time. stage + pauseStartTs are the only inputs the effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasting?.stage, (tasting as any)?.pauseStartTs],
  );

  // Wake lock while actively running. Re-acquires when the page becomes
  // visible again (browsers release the lock when the tab is hidden).
  useEffect(
    function () {
      var navAny: any = navigator;
      var docAny: any = typeof document !== "undefined" ? document : null;
      function shouldHaveLock(): boolean {
        return !!(
          tasting &&
          tasting.stage === "running" &&
          tasting.pauseStartTs === null
        );
      }
      function release() {
        if (wakeLockRef.current && wakeLockRef.current.release) {
          wakeLockRef.current.release().catch(function () {});
        }
        wakeLockRef.current = null;
      }
      var cancelled = false;
      function acquire() {
        if (cancelled) return;
        if (!shouldHaveLock()) return;
        if (!navAny.wakeLock || !navAny.wakeLock.request) return;
        if (wakeLockRef.current) return;
        navAny.wakeLock
          .request("screen")
          .then(function (l: any) {
            if (cancelled || !shouldHaveLock()) {
              if (l && l.release) l.release().catch(function () {});
              return;
            }
            wakeLockRef.current = l;
            // The browser may release the lock when the tab is hidden.
            // Drop the ref so a later visibilitychange can re-acquire.
            // Self-detach the listener once it fires —
            // previously it stayed attached on the released sentinel
            // forever (the WakeLock object itself is GC'd with the
            // lock, but a long-lived `l` ref through a closure could
            // keep it alive). Cheap defensive cleanup.
            if (l && l.addEventListener) {
              var onRelease = function () {
                if (wakeLockRef.current === l) wakeLockRef.current = null;
                if (l.removeEventListener) {
                  l.removeEventListener("release", onRelease);
                }
              };
              l.addEventListener("release", onRelease);
            }
          })
          .catch(function () {});
      }

      if (!shouldHaveLock()) {
        release();
        return;
      }

      acquire();

      function onVis() {
        if (
          docAny &&
          docAny.visibilityState === "visible" &&
          shouldHaveLock() &&
          !wakeLockRef.current
        ) {
          acquire();
        }
      }
      if (docAny && docAny.addEventListener) {
        docAny.addEventListener("visibilitychange", onVis);
      }
      return function () {
        cancelled = true;
        if (docAny && docAny.removeEventListener) {
          docAny.removeEventListener("visibilitychange", onVis);
        }
        release();
      };
    },
    // Re-run only when the running/paused
    // state changes, not on every keystroke-driven `tasting` mutation — which
    // released + re-requested the screen wake lock per character typed.
    // shouldHaveLock() reads only stage + pauseStartTs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasting?.stage, (tasting as any)?.pauseStartTs],
  );

  function update(s: TastingState | null) {
    writeTasting(s);
    setTasting(s);
  }

  function tastingStart(setup: {
    tobaccoId: string;
    pipeId: string;
    lotId: string;
    weightG: string;
  }) {
    var s: TastingState = {
      stage: "setup",
      tobaccoId: setup.tobaccoId || "",
      pipeId: setup.pipeId || "",
      lotId: setup.lotId || "",
      weightG: setup.weightG || "",
      rating: 0,
      notes: "",
      aromas: [],
    };
    update(s);
    nav("tasting");
  }

  function tastingResume() {
    // Re-enter the tasting view from a background banner / Home button.
    if (tasting) nav("tasting");
  }

  function tastingSetupUpdate(patch: {
    tobaccoId?: string;
    pipeId?: string;
    lotId?: string;
    weightG?: string;
  }) {
    if (!tasting || tasting.stage !== "setup") return;
    update(Object.assign({}, tasting, patch));
  }

  // Dedicated location setter so the user can attach
  // (or clear) the spot on either stage — including while the timer
  // is running. Kept separate from tastingSetupUpdate so the latter's
  // strict setup-only contract (locked by the existing test suite)
  // stays intact: nobody can use it to mutate inventory fields mid-
  // running through this new attribute path.
  function tastingSetLocation(
    lat: number | undefined,
    lng: number | undefined,
    parts?: { name?: string; city?: string; country?: string } | undefined,
  ) {
    if (!tasting) return;
    if (tasting.stage !== "setup" && tasting.stage !== "running") return;
    var hasGeo = typeof lat === "number" && typeof lng === "number";
    // Also carry the optional reverse-geocoded place parts
    // (spot / commune / country). Clearing the location wipes them; a bare
    // coords update (no parts) preserves whatever's already on the tasting
    // state so a late-arriving geocode can't clobber a name being typed.
    var patch: any;
    if (!hasGeo) {
      patch = { lat: undefined, lng: undefined, locationName: undefined, locationCity: undefined, locationCountry: undefined };
    } else if (parts) {
      patch = { lat: lat, lng: lng, locationName: parts.name || "", locationCity: parts.city || "", locationCountry: parts.country || "" };
    } else {
      patch = { lat: lat, lng: lng };
    }
    update(Object.assign({}, tasting, patch));
  }

  function tastingIgnite() {
    if (!tasting || tasting.stage !== "setup") return;
    // Spread the setup state so optional fields
    // (lat / lng) survive the setup→running
    // transition. Hand-rolling the field list silently dropped any
    // new optional field — the geo coords were lost between capture
    // and session save.
    var s: TastingState = Object.assign({}, tasting, {
      stage: "running" as const,
      startTs: Date.now(),
      pausedAccumMs: 0,
      pauseStartTs: null as number | null,
    });
    update(s);
  }

  function tastingPause() {
    if (!tasting || tasting.stage !== "running") return;
    if (tasting.pauseStartTs !== null) return;
    update(Object.assign({}, tasting, { pauseStartTs: Date.now() }));
  }

  function tastingUnpause() {
    if (!tasting || tasting.stage !== "running") return;
    if (tasting.pauseStartTs === null) return;
    var add = Date.now() - tasting.pauseStartTs;
    update(
      Object.assign({}, tasting, {
        pausedAccumMs: tasting.pausedAccumMs + add,
        pauseStartTs: null,
      }),
    );
  }

  function tastingUpdate(patch: { rating?: number; notes?: string; weightG?: string; aromas?: string[] }) {
    if (!tasting) return;
    update(Object.assign({}, tasting, patch));
  }

  function tastingElapsedMs(): number {
    if (!tasting || tasting.stage !== "running") return 0;
    var endTs = tasting.pauseStartTs !== null ? tasting.pauseStartTs : Date.now();
    return Math.max(0, endTs - tasting.startTs - tasting.pausedAccumMs);
  }

  function tastingEnd(opts?: { auto?: boolean }) {
    if (!tasting || tasting.stage !== "running") return;
    var auto = !!(opts && opts.auto);
    // Guard against the referenced lot disappearing while the tasting
    // was running (e.g. user deleted the lot through the inventory).
    // Without this check, addSessionFromTasting would fall through
    // pickJarLot and silently deduct from a different jar of the
    // same tobacco — comptably wrong.
    //
    // BOTH paths now record the session with an EMPTY
    // weightG + lotId (no deduction — there's no live lot to charge) instead
    // of the manual path REFUSING. Refusing trapped the user: a genuinely
    // smoked session could only be salvaged by restoring the lot from trash
    // or discarding it via Cancel. Recording an honest untracked session is
    // the better outcome; the journal still shows the smoke happened.
    var tastingLotId = tasting.lotId;
    var tastingTobId = tasting.tobaccoId;
    var lotMissing = false;
    var lotSealed = false;
    if (data && tastingLotId && tastingTobId) {
      var refTob = findById<any>(data.tobaccos, tastingTobId);
      var refLot = refTob && findById<any>(refTob.lots, tastingLotId);
      // A lot soft-deleted from the
      // inventory mid-session is still present in RAW data (deletedAt set),
      // so findById locates it and the "lot missing" safety net silently
      // wouldn't fire — the session would debit a lot the user believes is
      // gone. Treat a trashed lot as missing.
      // BOTH paths now save an untracked session (weightG ""
      // + lotId "" below) instead of the manual path REFUSING — refusing
      // trapped the user (a legitimately-smoked session could only be recovered
      // by restoring the lot or discarded via Cancel). No deduction happens
      // (there's no live lot to charge), which is the honest outcome.
      if (!refLot || refLot.deletedAt) {
        lotMissing = true;
      } else if (refLot.status === "cellar") {
        // The lot was re-sealed (promoted jar → cellar)
        // mid-session. `_persistSession` REFUSES a cellar lot when weight > 0
        // (the useSessionStore cellar guard), so the AUTO-end path would fail
        // persistence and then clear the zombie tasting state anyway (`auto`
        // overrides the "keep on failure" safety) — LOSING the session. Record
        // it untracked (weightG "" → no deduction, no cellar refusal), exactly
        // like a missing lot; the smoke genuinely happened. Not flagged as
        // `lotMissing` so the auto-end "lot missing" notice stays accurate.
        lotSealed = true;
      }
    }
    var ms = tastingElapsedMs();
    // The auto-end must record the duration it WOULD have recorded
    // had the app been awake, not the wall-clock time it slept through.
    //
    // Reported: « la dernière a duré plus de 10 heures ». The auto-end had in
    // fact fired — it simply recorded 600 minutes. The check can only run while
    // JS runs, and an installed PWA is suspended outright once the phone is
    // locked; a session forgotten overnight is therefore only noticed on the
    // next launch, hours after the moment it was due to close. Recording that
    // wall-clock span states as fact something the user demonstrably did not do,
    // pollutes « Durée moyenne par séance », and contradicts the app's own
    // notice, which has always said « clôturée automatiquement après 95 min ».
    //
    // The cap is the threshold ACTUALLY in force, so a user who postponed the
    // prompt twice gets 90+90+5, not 95 — the postpone is a deliberate act and
    // the app must honour it. The MANUAL path is untouched: there the user was
    // present, and the elapsed time is the truth.
    if (auto) ms = Math.min(ms, tastingOvertimeThresholdMs() + OVERTIME_AUTO_END_MS);
    var minutes = Math.max(1, Math.round(ms / 60000));
    // Use the LOCAL date of when the tasting STARTED, not when the user
    // taps "Terminer". A session that crosses midnight, or was forgotten
    // for hours, must still be recorded on the day the user lit up.
    // Local components (not toISOString) so the date aligns with the
    // calendar heatmap and with the date input in the manual form.
    var s = new Date(tasting.startTs);
    var y = s.getFullYear();
    var m = s.getMonth() + 1;
    var day = s.getDate();
    var todayStr = y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
    // The tasting's actual start time (HH:MM, local) becomes the
    // session's start hour — this is the truest "heure de début" we have.
    var hh = s.getHours();
    var mi = s.getMinutes();
    var startTime = (hh < 10 ? "0" : "") + hh + ":" + (mi < 10 ? "0" : "") + mi;
    var form: any = {
      date: todayStr,
      time: startTime,
      tobaccoId: tasting.tobaccoId,
      pipeId: tasting.pipeId,
      // Preserve the original lotId even when the lot is missing —
      // if the user restores it from trash later the session re-links cleanly.
      // weightG "" below means no deduction happens against the gone lot, and
      // deleteSession's restore is a no-op for a 0/empty weight. (This
      // preservation is kept on BOTH paths, for parity with the auto path.)
      lotId: tasting.lotId,
      duration: String(minutes),
      rating: tasting.rating || 0,
      notes: tasting.notes || "",
      // Carry the tapped aromas into the saved session.
      aromas: Array.isArray((tasting as any).aromas) ? (tasting as any).aromas : [],
      // Auto-end + missing lot → skip the deduction. Without a live
      // lot we can't reliably charge weight to anything; recording
      // weightG="" keeps the journal entry honest. A re-sealed
      // (cellar) lot is treated the same — a deduction would be refused.
      // Accounting OFF → no deduction, ever (the toggle may have
      // been flipped off mid-tasting, after ignite recorded a weight).
      weightG: (lotMissing || lotSealed || accountingEnabled === false) ? "" : (tasting.weightG || ""),
    };
    // Forward the optional capture location so the saved
    // session carries it through addSessionFromTasting.
    if (typeof (tasting as any).lat === "number" && typeof (tasting as any).lng === "number") {
      form.lat = (tasting as any).lat;
      form.lng = (tasting as any).lng;
      // Carry the reverse-geocoded place parts through too.
      if ((tasting as any).locationName) form.locationName = (tasting as any).locationName;
      if ((tasting as any).locationCity) form.locationCity = (tasting as any).locationCity;
      if ((tasting as any).locationCountry) form.locationCountry = (tasting as any).locationCountry;
    }
    // Persist the session FIRST and only clear the tasting state if it
    // succeeded. `_persistSession` (via `addSessionFromTasting`) refuses
    // a few cases — most notably a lot that ended up in cellar status
    // mid-tasting. Wiping the tasting state before knowing the outcome
    // would leave the user with no record of an in-flight session and
    // only a transient saveError banner to explain it.
    //
    // Auto path overrides this safety: if persistence fails too, clear
    // the zombie state anyway. The journal entry is lost, but a stuck
    // tasting state for hours is worse — and the user already lost the
    // accurate duration the moment they forgot to end it.
    // The AUTO path does not navigate — see the reasoning on
    // `addSessionFromTasting`. It fires from a timer while the user is
    // elsewhere, possibly mid-form, and a direct nav() bypasses the
    // unsaved-changes guard.
    var ok = addSessionFromTasting(form, { navigate: !auto });
    if (ok || auto) update(null);
    // An auto-end used to be SILENT unless the lot had vanished. The
    // tasting simply disappeared and a session appeared in the journal, which
    // is indistinguishable from « the auto-stop does not work » — and that is
    // exactly how it was reported. Say it happened, and say how long was kept.
    if (auto && lotMissing && setSaveError) {
      setSaveError(tr(lang, "tasting_err_autoend_lot_missing"));
    } else if (auto && !ok && setSaveError) {
      // The auto path clears the tasting state whether the
      // save SUCCEEDED or not (a stuck zombie tasting is worse than a lost
      // entry), and it then announced « clôturée automatiquement après N min »
      // regardless: a success sentence for a session that no longer exists
      // anywhere. The only reachable cause is `_persistSession` refusing a
      // positive weight with no resolvable lot — which is also made
      // unreachable at the source, by requiring a lot before ignite. Both
      // halves are needed: the gate stops it happening, this stops the app
      // lying about it if it ever does.
      setSaveError(tr(lang, "tasting_err_autoend_failed"));
    } else if (auto && setSaveWarn) {
      setSaveWarn(String(tr(lang, "tasting_autoend_notice")).replace("{n}", String(minutes)));
    }
  }

  function tastingCancel() {
    update(null);
    nav("journal");
  }

  function tastingPostponeOvertime() {
    if (!tasting || tasting.stage !== "running") return;
    var base = (tasting as any).overtimeThresholdMs || OVERTIME_THRESHOLD_MS;
    update(Object.assign({}, tasting, { overtimeThresholdMs: base + OVERTIME_THRESHOLD_MS }));
  }

  function tastingOvertimeThresholdMs(): number {
    if (!tasting || tasting.stage !== "running") return OVERTIME_THRESHOLD_MS;
    return (tasting as any).overtimeThresholdMs || OVERTIME_THRESHOLD_MS;
  }

  /**
   * THE overtime clock, and there is only one.
   *
   * A PAUSED session used never to auto-end: `tastingElapsedMs`
   * freezes at `pauseStartTs`, so the threshold is never crossed and a tasting
   * paused and forgotten stays for ever. The frozen countdown was recorded as
   * intentional — « a paused user is engaged with the app » — which is true of a
   * five-minute pause and false of a ten-hour one. Decided: the same 90 + 5 rule
   * applies to the pause itself.
   *
   * The clock is the LONGER of the two: the elapsed smoking time, and how long
   * the pause has lasted. One value read by the prompt, the countdown and the
   * auto-end, because three readers computing their own would be free to
   * disagree — and a banner that never appears before a close the user did not
   * ask for is the harsher rule, not the same one.
   *
   * What gets RECORDED is untouched: `tastingEnd` still caps on
   * `tastingElapsedMs()`, which for a paused session is the frozen elapsed —
   * i.e. the truth. A 20-minute session paused and forgotten overnight is saved
   * as 20 minutes, not as 95.
   */
  function tastingOvertimeMs(): number {
    if (!tasting || tasting.stage !== "running") return 0;
    var paused = tasting.pauseStartTs !== null ? Math.max(0, Date.now() - tasting.pauseStartTs) : 0;
    return Math.max(tastingElapsedMs(), paused);
  }

  // True while the overtime clock sits in [threshold, threshold + 5min]
  function tastingOvertimePrompt(): boolean {
    if (!tasting || tasting.stage !== "running") return false;
    var v = tastingOvertimeMs();
    var threshold = tastingOvertimeThresholdMs();
    return v >= threshold && v < threshold + OVERTIME_AUTO_END_MS;
  }

  // Remaining ms before the auto-end fires (0 when prompt isn't active)
  function tastingOvertimeRemainingMs(): number {
    if (!tastingOvertimePrompt()) return 0;
    return Math.max(0, tastingOvertimeThresholdMs() + OVERTIME_AUTO_END_MS - tastingOvertimeMs());
  }

  // Auto-end once elapsed crosses threshold + 5 min. Re-checked on
  // every tick AND on every `data` change — the cold-start path needs
  // the latter: if the user opens the app long after the session
  // should have ended, the tick-based useEffect fires on mount but
  // tastingEnd() then calls addSessionFromTasting() which silently
  // fails when `data` is still null (App.tsx's load() is async). At
  // that point the auto-end would only re-attempt at the next tick
  // (up to 1 s later) — or never if iOS killed the setInterval in
  // background. Listing `data` in the deps re-fires the effect as
  // soon as load() completes, which is when addSessionFromTasting()
  // can actually succeed and update(null) clears the zombie session.
  useEffect(
    function () {
      // DO NOT
      // auto-end while App.tsx's load() is still in flight. The
      // initial `data` is `INIT` (empty cellar, not null) and `tastingEnd`
      // always sets `form.date`, so `_persistSession` no longer bails on an
      // empty payload — a cold start with an overtime zombie tasting would
      // fire `tastingEnd({auto})` against `INIT`, and the resulting
      // `save(INIT + phantom session)` OVERWRITES localStorage with an empty
      // cellar BEFORE load()'s `.then(setData(realData))` microtask runs.
      // The three sibling startup effects (useOrphanPhotoGC,
      // useLotIntegrityProbe, the trash purge) are all `loading`-gated; this
      // was the lone un-gated one — exactly the regression class CLAUDE.md
      // warns about. The `data` dep still re-fires the effect the instant
      // load() completes (loading flips false), so a genuine zombie session
      // is auto-ended one render later, against the REAL cellar.
      if (loading) return;
      if (!tasting || tasting.stage !== "running") return;
      // Reads the SAME clock as the prompt and the countdown, so a
      // paused-and-forgotten session closes on the same 90 + 5 rule as a
      // running one. It used to inline its own elapsed computation.
      if (tastingOvertimeMs() >= tastingOvertimeThresholdMs() + OVERTIME_AUTO_END_MS) {
        tastingEnd({ auto: true });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasting, tick, data, loading],
  );

  // visibilitychange / focus: force a tick when the app comes back to
  // the foreground. iOS Safari freezes (or throttles to 1/min) the
  // setInterval that drives `tick` when the screen is locked or the
  // PWA is backgrounded. Without this listener the auto-end check
  // would wait up to a full second (or longer under throttling) after
  // the user reopens the app — long enough for a 6 h zombie session
  // to still display "in progress" momentarily. Bumping tick on
  // visibilitychange re-triggers the auto-end useEffect immediately.
  useEffect(
    function () {
      if (!tasting || tasting.stage !== "running") return;
      function onVis() {
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          setTick(function (x) { return (x + 1) & 0xffff; });
        }
      }
      if (typeof document !== "undefined" && document.addEventListener) {
        document.addEventListener("visibilitychange", onVis);
      }
      if (typeof window !== "undefined" && window.addEventListener) {
        window.addEventListener("focus", onVis);
        window.addEventListener("pageshow", onVis);
      }
      return function () {
        if (typeof document !== "undefined" && document.removeEventListener) {
          document.removeEventListener("visibilitychange", onVis);
        }
        if (typeof window !== "undefined" && window.removeEventListener) {
          window.removeEventListener("focus", onVis);
          window.removeEventListener("pageshow", onVis);
        }
      };
    },
    // Only the running-stage matters for
    // attaching the visibility/focus listeners; keying on the whole `tasting`
    // re-attached them on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasting?.stage],
  );

  return {
    tasting,
    tastingStart,
    tastingResume,
    tastingSetupUpdate,
    tastingIgnite,
    tastingPause,
    tastingUnpause,
    tastingUpdate,
    tastingEnd,
    tastingCancel,
    tastingElapsedMs,
    tastingOvertimePrompt,
    tastingOvertimeRemainingMs,
    tastingPostponeOvertime,
    tastingSetLocation,
  };
}

export function formatTastingTime(ms: number): string {
  var s = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  var pad = function (n: number) {
    return n < 10 ? "0" + n : String(n);
  };
  if (h > 0) return h + ":" + pad(m) + ":" + pad(sec);
  return pad(m) + ":" + pad(sec);
}
