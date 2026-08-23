import React from "react";
import { APP_VERSION, APP_BUILD, APP_GENERATION } from "../constants.ts";
import { lsSet } from "../utils/appStorage.ts";
import { safeJsonParse } from "../utils/safeJson.ts";

var useState = React.useState,
  useEffect = React.useEffect,
  useRef = React.useRef;

// Pure, testable version comparison. Returns <0 / 0 />0
// like a comparator (a older / equal / newer than b). Dotted numeric segments,
// missing segments treated as 0. "1.10" > "1.9".
export function compareVersions(a: string, b: string): number {
  var pa = String(a == null ? "" : a).split(".");
  var pb = String(b == null ? "" : b).split(".");
  var len = Math.max(pa.length, pb.length);
  for (var i = 0; i < len; i++) {
    var x = parseInt(pa[i] || "0", 10) || 0;
    var y = parseInt(pb[i] || "0", 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Decide whether a fetched version.json describes a
// genuinely NEWER build than what's running. The old inline check
// (`d.version !== APP_VERSION || Number(d.build) > Number(APP_BUILD)`) had no
// validity guard and fired on a version DOWNGRADE and a build reset too — a
// malformed / rolled-back / partial-deploy version.json then drove an infinite
// purge-and-reload loop. Rules: reject a payload missing a version string or a
// non-finite build; a strictly-greater version is newer (builds reset per minor
// version, so don't compare builds across versions); the SAME version is newer
// only when its build number is strictly greater.
// The GENERATION, compared before everything else.
//
// The rules above make the display version a one-way ratchet — a lower version
// is never newer — so the app can never be renumbered downward (1.5 → 1.0) or
// restarted at 1.0 without every installed client refusing the release. This
// field is the escape hatch, and it is deliberately NOT a loosening of the
// downgrade guard: a LOWER generation is still refused, so a rolled-back or
// partially-deployed version.json cannot drive the purge-and-reload loop.
//
// The DEFAULT is the load-bearing part — see `remoteGeneration` below.
// A payload that does not carry a usable generation is treated as being on OUR
// epoch, never as generation 0: reading an absent field as 0 would make every
// deploy that predates this field look older than the running app and silently kill the update
// path, i.e. exactly the failure this field exists to prevent.
// `null` is checked explicitly because `Number(null)` is 0, not NaN — the one
// garbage value JS coerces into a plausible-looking generation, and the one a
// hand-written or templated version.json is most likely to carry.
function remoteGeneration(d: any, curGeneration: number): number {
  var raw = d ? d.generation : null;
  if (raw === null || raw === undefined || raw === "") return curGeneration;
  if (typeof raw !== "number" && typeof raw !== "string") return curGeneration;
  var g = Number(raw);
  return isFinite(g) ? g : curGeneration;
}

export function isRemoteNewer(
  d: any, curVersion: string, curBuild: string, curGeneration?: number,
): boolean {
  if (!d || typeof d.version !== "string" || !d.version) return false;
  var rb = Number(d.build);
  if (!isFinite(rb)) return false;
  // An omitted argument means "do not consider the generation" — the original
  // signature, so an unmigrated caller keeps the old behaviour rather than
  // silently comparing against NaN.
  var cg = Number(curGeneration);
  if (isFinite(cg)) {
    var rg = remoteGeneration(d, cg);
    if (rg > cg) return true;
    if (rg < cg) return false;
  }
  var vc = compareVersions(d.version, curVersion);
  if (vc > 0) return true;
  if (vc < 0) return false;
  return rb > Number(curBuild);
}

// Anti-loop latch (partial-deploy backstop). A partial deploy where
// version.json advertises a build the served JS bundle isn't at yet makes the
// client reload, re-detect the same unmet target, and reload again. We cap
// auto-update attempts at UPDATE_MAX_ATTEMPTS per (version/build) target within
// UPDATE_SUPPRESS_MS; past that we stand down (the manual "check for updates"
// in Settings still works). A LEGIT update never accumulates attempts — after
// its reload the client IS at the new build, so isRemoteNewer returns false.
var UPDATE_ATTEMPT_KEY = "cave-update-attempt";
var UPDATE_MAX_ATTEMPTS = 3;
var UPDATE_SUPPRESS_MS = 30 * 60 * 1000;
// How long the data_only silent path may stay invisible before it is
// promoted to the ordinary visible banner.
var SILENT_FALLBACK_MS = 30 * 60 * 1000;
// Last SUCCESSFUL version check, and how long a device may go
// without one before Settings says so. The poll runs every 120 s while the app
// is open, so a healthy device refreshes this within seconds of launching —
// which means a stale value is never "you have not opened the app in a while",
// it is always "the check is failing right now". Self-clearing by construction.
var VERSION_CHECK_OK_KEY = "cave-version-check-ok";
export var VERSION_CHECK_STALE_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * WHY an update that has been detected is not applying, in one word.
 *
 * Reported from the app: "a new version is available, I get
 * that pill and that is all, and it does not start after 10 seconds like you
 * said". The mechanism was right in the code and I could not tell from the
 * outside WHICH brake was holding — deferred behind a form, standing down
 * after a partial deploy, postponed by a tap, or silently waiting to be
 * applied on backgrounding. Neither could the user, and neither could the
 * app: nothing anywhere reported the reason.
 *
 * That is the same disease as the silent version-check failures one level up: the mechanism may
 * refuse to act, but it must say why. Pure so it can be tested and rendered.
 */
export function explainPendingUpdate(st: {
  newerBuild: { build: string } | null;
  countdown: number | null;
  deferred: boolean;
  declinedBuild: string | null;
  silentPending: boolean;
  suppressed: boolean;
}): "none" | "counting" | "deferred" | "declined" | "suppressed" | "silent" | "idle" {
  if (!st.newerBuild) return "none";
  if (st.countdown != null) return "counting";
  if (st.deferred) return "deferred";
  if (st.declinedBuild === st.newerBuild.build) return "declined";
  if (st.suppressed) return "suppressed";
  if (st.silentPending) return "silent";
  return "idle";
}

/** The anti-loop marker's key for a given target build.
 *
 * EXTRACTED because the writer and the reader had each built it by hand and
 * had DRIFTED: `checkVersion` prefixed the generation, `explainPendingUpdate`'s
 * call site did not, so `shouldSuppressUpdate`'s `marker.k === targetKey` could
 * never hold and the "suppressed" verdict was unreachable. One implementation,
 * two callers, so the two cannot disagree again.
 *
 * The generation belongs in the key: after a renumbering, the same
 * version+build on a new epoch is a DIFFERENT artifact and must not inherit
 * the previous epoch's attempt count.
 */
export function attemptKey(version: any, build: any): string {
  return String(APP_GENERATION) + ":" + String(version) + "/" + String(build);
}

export function shouldSuppressUpdate(marker: any, targetKey: string, nowMs: number): boolean {
  return !!(marker && marker.k === targetKey
    && (marker.n || 0) >= UPDATE_MAX_ATTEMPTS
    && nowMs - (marker.ts || 0) < UPDATE_SUPPRESS_MS);
}

export function useAppUpdate(opts?: { deferAutoUpdate?: boolean; deferReason?: string }) {
  var deferAutoUpdate = !!(opts && opts.deferAutoUpdate);
  var deferReason = (opts && opts.deferReason) || "form";
  var _upd = useState<any>(null),
    updateStatus = _upd[0],
    setUpdateStatus = _upd[1];
  var _upa = useState<{ version: string; build: string } | null>(null),
    updateAvailable = _upa[0],
    setUpdateAvailable = _upa[1];
  // Silent-update pending state for data-only releases.
  // When `version.json` carries `"data_only": true` (typically a
  // catalogue refresh without app-code changes), we skip the visible
  // 10 s countdown banner and instead schedule the reload at the next
  // `visibilitychange:hidden` (user backgrounds the app, locks the
  // phone, switches tab). Fallback timer fires after 30 min in case
  // the user never backgrounds. The user returns to a fresh build
  // with no UI interruption.
  var _sup = useState<{ version: string; build: string } | null>(null),
    silentUpdatePending = _sup[0],
    setSilentUpdatePending = _sup[1];
  // "a newer build exists", recorded on EVERY detection and
  // never gated by the anti-loop latch, the data_only branch or a failed
  // localStorage write. Drives the always-visible Settings row, so no failure
  // mode of the automatic paths can leave a user silently stale.
  var _nb = useState<{ version: string; build: string } | null>(null),
    newerBuild = _nb[0],
    setNewerBuild = _nb[1];
  // When the version check last SUCCEEDED, persisted so it
  // survives a relaunch. The fetch's `.catch` is empty by necessity — a
  // transient failure must not be noise — but that made a PERMANENT failure
  // (a broken deploy, a 404, a captive portal, a filtered network) look
  // exactly like a healthy app, for ever, at one silent retry every 120 s.
  // Same principle throughout this hook: the mechanism may fail, it may not hide.
  var _lc = useState<number | null>(function () {
    var raw = Number(localStorage.getItem(VERSION_CHECK_OK_KEY));
    return isFinite(raw) && raw > 0 ? raw : null;
  }),
    lastCheckOkMs = _lc[0],
    setLastCheckOkMs = _lc[1];
  var _upf = useState(false),
    updatePillDismissed = _upf[0],
    setUpdatePillDismissed = _upf[1];
  var _ju = useState(false),
    justUpdated = _ju[0],
    setJustUpdated = _ju[1];
  var _cnt = useState<number | null>(null),
    autoUpdateCountdown = _cnt[0],
    setAutoUpdateCountdown = _cnt[1];
  var countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Countdown counter moved from a closure-captured `var`
  // to a ref so re-runs of the effect can't end up with two intervals
  // ticking against two different `n` values. See the comment in the
  // useEffect below.
  var countdownN = useRef<number>(10);
  // The build the user explicitly declined via "Plus tard".
  // Without this, updateAvailable is never cleared (the Settings pill needs it),
  // so a deferAutoUpdate toggle (a tasting ending) re-ran the countdown effect
  // and RESTARTED the auto-update the user just postponed. Latching the declined
  // build makes the postpone durable until a genuinely-new build is detected.
  var declinedBuildRef = useRef<string | null>(null);
  // The target this session has ALREADY counted an attempt
  // for. See the counter's use in checkVersion — it must count RELOADS, not
  // detections, and only the silent path made the difference visible.
  var countedTargetRef = useRef<string | null>(null);

  useEffect(function () {
    // VERSION DETECTION DOES NOT DEPEND ON THE SERVICE WORKER.
    //
    // Every line below used to live inside `navigator.serviceWorker.ready
    // .then(...)`, which made a plain `fetch("./version.json")` hostage to a
    // precondition it does not need. Three ways that ended in an app which
    // never checks for updates again, silently and for ever:
    //   · no SW support at all (the `if (!navigator.serviceWorker) return`)
    //   · registration failed — Safari private mode, storage blocked, or a
    //     transient network error on the one call in main.jsx
    //   · `ready` never resolves. It does not reject when nothing is
    //     registered, it simply never settles — and `doUpdate()` UNREGISTERS
    //     EVERY SW before reloading, so a single failed re-registration left
    //     the app permanently unable to learn it was behind, by its own hand.
    //
    // The SW-driven trigger is a bonus and is attached separately if and when
    // the registration is ready.
    function checkVersion() {
          fetch("./version.json?_v=" + Date.now())
            .then(function (r) {
              return r.json();
            })
            .then(function (d) {
              // The check REACHED the server and got readable JSON. Record it
              // before any verdict: "is there a newer build" is a different
              // question from "is this device still able to ask".
              var okAt = Date.now();
              lsSet(VERSION_CHECK_OK_KEY, String(okAt));
              setLastCheckOkMs(okAt);
              // Validated + downgrade-safe check.
              if (!isRemoteNewer(d, APP_VERSION, APP_BUILD, APP_GENERATION)) return;
              // RECORD IT FIRST, UNCONDITIONALLY.
              //
              // "A newer build exists" is INFORMATION; "we will auto-reload
              // toward it" is an ACTION. Only the action may be gated. Every
              // gate below used to sit in front of both, so each one had a
              // silent dead-end where the app knew it was behind and told
              // nobody: the anti-loop latch returned, the `data_only` branch
              // set a state NO UI READ, and a failed `lsSet` disabled
              // auto-update outright. In all three the user saw a normal,
              // apparently up-to-date app for ever.
              //
              // `newerBuild` is never gated, and Settings → Application always
              // renders it with a manual "update now". That is the floor: even
              // if every automatic path is refused, the update is one visible
              // tap away instead of a thing only the developer can know.
              setNewerBuild({ version: String(d.version), build: String(d.build) });
              // Anti-loop latch: bail if we've already retried this exact
              // target too many times (partial deploy / bundle not there yet).
              // The generation joins the key. Without it a
              // renumbering that lands on a version+build the app has already
              // attempted would inherit that epoch's attempt count. Changing
              // the format simply orphans the stored marker once, which is
              // harmless — an unmatched marker suppresses nothing.
              var targetKey = attemptKey(d.version, d.build);
              var marker = safeJsonParse(localStorage.getItem(UPDATE_ATTEMPT_KEY), null) as any;
              var now = Date.now();
              if (shouldSuppressUpdate(marker, targetKey, now)) return;
              // COUNT ONCE PER SESSION PER TARGET.
              //
              // The counter means "how many times this device has auto-reloaded
              // toward this build" (see UPDATE_ATTEMPT_KEY above) — but it was
              // incremented on every DETECTION, and checkVersion polls every
              // 120 s. On the VISIBLE path the two are ~the same thing: detect →
              // banner → 10 s countdown → reload, all before the next poll.
              //
              // On the SILENT path (data_only releases) they are not, because
              // that path is DESIGNED to wait for the next backgrounding, up to
              // 30 minutes. Three polls — about six minutes of foreground use —
              // pushed the counter to the cap on a perfectly healthy release.
              // The current session still updated (silentUpdatePending was
              // already set), but the NEXT launch inside the 30-minute window
              // hit shouldSuppressUpdate and returned before arming anything:
              // no banner by design, and now no silent path either, so a
              // catalogue release could sit undelivered while the app looked
              // idle. Reported from the app as "the new build is out and it
              // isn't offering it to me".
              //
              // A reload always ends the session, so "already counted in THIS
              // session" is exactly "not a fresh reload attempt" — the
              // anti-loop guarantee is unchanged (a partial deploy still burns
              // one attempt per real reload-and-redetect cycle, three and out).
              var alreadyCounted = countedTargetRef.current === targetKey;
              if (!alreadyCounted) {
                var n = (marker && marker.k === targetKey) ? (marker.n || 0) + 1 : 1;
                // FAIL-CLOSED. lsSet returns false
                // when the write is swallowed (localStorage quota-full — common on
                // a large cellar, exactly the state a partial deploy would loop in
                // — or Safari private mode). If the attempt marker can't persist,
                // the anti-loop cap can't hold across reloads, so DON'T auto-update
                // (the manual "check for updates" in Settings still works). Without
                // this, the swallowed write left the counter stuck at 1 forever → a
                // purge-caches-and-reload storm every ~10s for the whole partial-
                // deploy window.
                if (!lsSet(UPDATE_ATTEMPT_KEY, JSON.stringify({ k: targetKey, n: n, ts: now }))) return;
                countedTargetRef.current = targetKey;
              }
              // A newly-detected target clears the "declined this build" latch
              // so a genuinely-new release still auto-prompts.
              if (declinedBuildRef.current !== String(d.build)) declinedBuildRef.current = null;
              // Strict `=== true` coercion. A malformed
              // version.json carrying `"data_only": "false"` (string)
              // would be truthy and silently bypass the visible
              // banner — defensive guard so only the literal boolean
              // `true` opts into the silent path.
              if (d.data_only === true) {
                // Silent path. Don't set updateAvailable
                // (would trigger the visible banner); set
                // silentUpdatePending instead so the visibility/timeout
                // effect can reload at a safe moment.
                setSilentUpdatePending({ version: String(d.version), build: String(d.build) });
              } else {
                setUpdateAvailable({ version: String(d.version), build: String(d.build) });
              }
            })
            .catch(function () {});
    }

    // The polling schedule — mount, +3 s, every 120 s, and whenever the app
    // comes back to the foreground. None of it needs the service worker.
    checkVersion();
    var _t = setTimeout(checkVersion, 3000);
    var _fv = setInterval(checkVersion, 120000);
    function onVisible() {
      if (!document.hidden) checkVersion();
    }
    document.addEventListener("visibilitychange", onVisible);

    // …and the SW-driven trigger on top, when there is a registration.
    var _detach: (() => void) | null = null;
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready
      .then(function (reg) {
        function onUpdateFound() {
          var nw = reg.installing;
          if (!nw) return;
          var nwSW = nw;
          // Self-removing listener. Previously the
          // "statechange" listener stayed attached on every newly
          // installing worker — over the lifetime of a long-lived tab
          // that could accumulate one listener per SW update. Now the
          // handler removes itself once the installation completes,
          // which is the only state we care about anyway.
          var onState = function () {
            if (nwSW.state === "installed" && navigator.serviceWorker.controller) {
              checkVersion();
            }
            // "installed" / "activated" / "redundant" are all terminal —
            // detach in every terminal case so the listener never
            // leaks.
            if (nwSW.state === "installed"
                || nwSW.state === "activated"
                || nwSW.state === "redundant") {
              nwSW.removeEventListener("statechange", onState);
            }
          };
          nwSW.addEventListener("statechange", onState);
        }
        reg.addEventListener("updatefound", onUpdateFound);
        _detach = function () { reg.removeEventListener("updatefound", onUpdateFound); };
      })
      .catch(function () {});
    }
    return function () {
      clearTimeout(_t);
      clearInterval(_fv);
      document.removeEventListener("visibilitychange", onVisible);
      if (_detach) _detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-update countdown: starts when a new version is detected.
  // Suspended while `deferAutoUpdate` is true (e.g. a tasting session is
  // running) — the update pill in Settings remains available so the user
  // can trigger the update manually.
  useEffect(function () {
    if (!updateAvailable) return;
    // Honour an explicit "Plus tard" for THIS build — don't
    // let a deferAutoUpdate flip re-arm the countdown the user postponed.
    if (declinedBuildRef.current === updateAvailable.build) {
      setAutoUpdateCountdown(null);
      return;
    }
    if (deferAutoUpdate) {
      setAutoUpdateCountdown(null);
      return;
    }
    // The countdown used to capture `n` as a closure
    // variable on the interval. If `deferAutoUpdate` flipped
    // true / false / true rapidly, the FIRST interval could keep
    // ticking against a stale `n` while a new countdown started with
    // its own `n`, producing wrong displays and an early `doUpdate()`
    // fire. Move the counter into a ref so every tick reads the
    // current value and updates persist across re-runs of this
    // effect — and the cleanup below clears the interval before
    // the next mount cycle can spawn a competing one.
    countdownN.current = 10;
    setAutoUpdateCountdown(countdownN.current);
    countdownRef.current = setInterval(function () {
      countdownN.current -= 1;
      if (countdownN.current <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = null;
        setAutoUpdateCountdown(null);
        doUpdate();
      } else {
        setAutoUpdateCountdown(countdownN.current);
      }
    }, 1000);
    return function () {
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = null;
    };
    // The answer to "if I tap Plus tard, does the pop-up come back?":
    // the dep is the BUILD, not the boolean.
    //
    // It was `!!updateAvailable`, so `updateAvailable: A → B` did not re-run
    // the effect. Combined with the decline latch: tap "Plus tard" on A, build
    // B ships, checkVersion correctly clears the latch and sets B — and no
    // countdown ever starts, because nothing re-ran. One "Plus tard" disabled
    // the countdown for the WHOLE SESSION, including for genuinely newer
    // releases, while `explainPendingUpdate` returned "idle" so Settings
    // printed no reason either. The comment at the latch-clear says "cleared
    // when a newer build is detected" — it is, and nothing acted on it.
    //
    // Keying on the build re-runs exactly when the target changes. It does NOT
    // re-run on the 120 s poll, which re-sets an equal-valued build string.
    //
    // The disable moved DOWN to here. It sat above the comment
    // block, so `disable-next-line` disabled a COMMENT and the warning it was
    // written for stayed live 15 lines below — reported as an unused directive
    // at one end and a missing-deps warning at the other, which reads as two
    // unrelated notes. Adding the deps it names is not the fix: `doUpdate`'s
    // identity changes would restart the countdown, which is the opposite of
    // what this effect is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateAvailable ? updateAvailable.build : null, deferAutoUpdate]);

  // Silent reload scheduler for data-only releases.
  // When `silentUpdatePending` is set, watch for the next
  // `visibilitychange → hidden` event (background, tab switch, lock
  // screen) and fire doUpdate() then so the reload is invisible.
  // Fallback: 30 min absolute timer in case the user never
  // backgrounds. `deferAutoUpdate` still wins (a running tasting
  // session pauses every flavour of auto-update).
  useEffect(function () {
    if (!silentUpdatePending) return;
    if (deferAutoUpdate) return;
    var fired = false;
    function fireSilent() {
      if (fired) return;
      // Do NOT purge-and-reload while OFFLINE.
      // The silent path fires on BACKGROUNDING (visibilitychange/pagehide), not
      // on a fresh network fetch, so firing offline wipes every Cache Storage
      // entry + unregisters the SW and queues a reload the device can't fulfil
      // → the app is an unbootable brick until connectivity returns. Skip
      // WITHOUT latching `fired`, so a later online hidden-event or the fallback
      // timer still applies it; silentUpdatePending is re-detected next launch.
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      fired = true;
      doUpdate();
    }
    function onVisibility() {
      if (document.hidden) fireSilent();
    }
    document.addEventListener("visibilitychange", onVisibility);
    // Also listen for `pagehide`. On iOS Safari
    // standalone PWA, killing the app via the app-switcher does NOT
    // reliably fire `visibilitychange:hidden` (the page is torn down
    // instead of just hidden). `pagehide` is the iOS-friendly
    // terminal-teardown hook — firing the silent reload here gives
    // the SW one last chance to purge before the page goes away.
    // Skip a PERSISTED pagehide (bfcache) — there the page
    // is frozen for a fast restore, so purging caches + reload is both wasted
    // and wrong (a bfcache restore would bring back the old page vs a purged
    // cache). Only fire on a real teardown.
    function onPageHide(e: any) { if (!e || !e.persisted) fireSilent(); }
    // `pagehide` is fired at the WINDOW. An event
    // dispatched at Window has an event path of just [Window], so this
    // listener was never in it — the iOS app-switcher teardown hook, added
    // for the exact case where visibilitychange:hidden is
    // unreliable, had been inert ever since. Both existing tests dispatched at
    // `document` (one at both), so neither could discriminate.
    window.addEventListener("pagehide", onPageHide);
    // THE OLD "PROMOTION" IS REMOVED, AND MUST NOT COME BACK. It could only
    // ever fire in the one case where it must not.
    //
    // It was `fireSilent(); if (!fired) setUpdateAvailable(silentPending);`,
    // on the reasoning that silent must never become an invisible backlog.
    // But fireSilent has exactly ONE decline reason — `navigator.onLine ===
    // false` — so `!fired` is not "it never applied", it is
    // literally "we are offline". The branch therefore promoted to the visible
    // countdown precisely when offline, and the visible path had no offline
    // guard: 10 s later doUpdate unregistered every SW and deleted every Cache
    // Storage entry with no network to refill them. When ONLINE the branch was
    // unreachable, because fireSilent simply applied the update. Harmful in one
    // case, dead code in the other.
    //
    // What made that premise wrong: there IS no invisible backlog to rescue.
    // `newerBuild` is ungated, so a pending silent update is
    // already on the pill and in Settings with its reason. Waiting quietly
    // until the device is online is the correct behaviour, not a dead end.
    var fallback = setTimeout(fireSilent, SILENT_FALLBACK_MS);
    return function () {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!silentUpdatePending, deferAutoUpdate]);

  useEffect(function () {
    var _lb = localStorage.getItem("cave-last-build");
    lsSet("cave-last-build", APP_BUILD);
    if (_lb && _lb !== APP_BUILD) {
      setJustUpdated(true);
      setTimeout(function () {
        setJustUpdated(false);
      }, 5000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cancelAutoUpdate() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    setAutoUpdateCountdown(null);
    // Remember the postpone so a later deferAutoUpdate flip
    // can't silently restart it. Cleared when a newer build is detected.
    if (updateAvailable) declinedBuildRef.current = updateAvailable.build;
    // Also disarm the SILENT path. It never
    // consulted declinedBuildRef, so a user who tapped "Plus tard" and then
    // backgrounded the app had that exact build applied anyway.
    setSilentUpdatePending(null);
  }

  /**
   * Dismiss the countdown for THIS OCCURRENCE only.
   *
   * `cancelAutoUpdate` latches `declinedBuildRef`, which is deliberately
   * durable — the countdown never re-arms for that build. That is
   * right for the explicit "Plus tard" BUTTON and wrong for a backdrop tap,
   * Escape or an edge-swipe, which the shared Modal also routes to `onClose`.
   * The panel is 380px wide, so most of the screen is backdrop: an accidental
   * tap was making the same durable decision, silently.
   */
  function dismissCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    setAutoUpdateCountdown(null);
  }

  function checkUpdate() {
    setUpdateStatus("checking");
    fetch("./version.json?_v=" + Date.now())
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.version || !d.build) {
          setUpdateStatus("error");
          setTimeout(function () {
            setUpdateStatus(null);
          }, 3000);
          return;
        }
        // The manual check goes through the SAME `isRemoteNewer` guard as the
        // auto path. Only a genuinely NEWER valid remote build shows the update
        // pill; an EQUAL build OR a DOWNGRADE/rollback is treated as "up to
        // date" — a bare `else` here used to show a bogus "update available"
        // that reloaded onto the same or an older build. "Up to date" still
        // runs a cache-refresh reload, which is the point of the button:
        // notice.json and any other SW-cached file are refreshed without an
        // APP_BUILD bump. Brief "À jour — rafraîchissement…" toast first so the
        // user knows why it reloads.
        if (isRemoteNewer(d, APP_VERSION, APP_BUILD, APP_GENERATION)) {
          setUpdateStatus({ version: d.version, build: d.build });
        } else {
          setUpdateStatus("ok");
          setTimeout(function () {
            doUpdate();
          }, 1200);
        }
      })
      .catch(function () {
        setUpdateStatus("error");
        setTimeout(function () {
          setUpdateStatus(null);
        }, 3000);
      });
  }

  // Aggressive cache purge before reload. iOS PWA was
  // staying on stale builds even after doUpdate() fired — the waiting-
  // SW + SKIP_WAITING dance is unreliable on Safari standalone (the
  // controllerchange event sometimes never lands, and even after it
  // does the next navigation can still be served by the old cache mid-
  // transition). The fix is to unregister every SW and wipe every
  // Cache Storage entry BEFORE the reload, so the browser is forced
  // to fetch the new HTML / JS / sw.js straight from the network. The
  // SW reinstalls from scratch on the next page load and re-populates
  // its cache. Tradeoff: a brief offline window during the reload —
  // acceptable because the user has just received a new version.json
  // (network was up). IndexedDB (photos) is NOT touched — same
  // contract as the EB chunk-load recovery path.
  async function doUpdate() {
    // NEVER purge while offline. THE guard, at the
    // one place all four paths funnel through.
    //
    // This check once lived on `fireSilent` alone, and a later
    // fallback promoted an unapplied silent update to the visible
    // countdown — and wrote it as `if (!fired) setUpdateAvailable(...)`, where
    // `!fired` is true PRECISELY in the offline case, because fireSilent
    // declines without latching. So being offline became the trigger for the
    // visible path, which had no guard at all: countdown → doUpdate → every SW
    // unregistered, every Cache Storage entry deleted, reload. Offline, nothing
    // can be re-fetched — on an installed iOS PWA that is a dead window until
    // connectivity returns. Verbatim the failure the offline guard's own
    // comment says it prevents.
    //
    // The test for it asserted the promotion happens with `onLine:false` and
    // stopped there, so it locked the first half of the bug in as intended
    // behaviour. It now advances the countdown and asserts nothing is purged.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setUpdateStatus("offline");
      setTimeout(function () { setUpdateStatus(null); }, 4000);
      return;
    }
    // Best-effort SKIP_WAITING so any waiting SW activates cleanly
    // before we tear everything down. Short timeout — if it stalls,
    // we proceed with the purge anyway.
    try {
      if (navigator.serviceWorker) {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>(function (r) { setTimeout(function () { r(null); }, 1000); }),
        ]);
        if (reg && (reg as ServiceWorkerRegistration).waiting) {
          (reg as ServiceWorkerRegistration).waiting!.postMessage({ type: "SKIP_WAITING" });
        }
      }
    } catch (_e) {}
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(function (r) { return r.unregister().catch(function () { return false; }); }));
      }
    } catch (_e) {}
    try {
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k).catch(function () { return false; }); }));
      }
    } catch (_e) {}
    window.location.reload();
  }

  var pendingReason = explainPendingUpdate({
    newerBuild: newerBuild,
    countdown: autoUpdateCountdown,
    deferred: deferAutoUpdate,
    declinedBuild: declinedBuildRef.current,
    silentPending: !!silentUpdatePending,
    // The key MUST carry the generation prefix, exactly as `checkVersion`
    // writes it (`attemptKey`) — `shouldSuppressUpdate` compares `marker.k`
    // for equality, so a reader that builds it any other way can NEVER match
    // and `suppressed` is permanently false. It was, which made
    // `upd_why_suppressed` dead code: a device that had burned its three
    // auto-reload attempts on a partial deploy showed "silent" or "idle" —
    // the wrong brake, or none — in the one hook whose design is "it may
    // refuse to act, but it must say WHICH brake is engaged".
    suppressed: !!newerBuild && shouldSuppressUpdate(
      safeJsonParse(localStorage.getItem(UPDATE_ATTEMPT_KEY), null),
      attemptKey(newerBuild.version, newerBuild.build), Date.now()),
  });

  return {
    updateStatus,
    updateAvailable,
    pendingReason,
    deferReason,
    silentUpdatePending,
    newerBuild,
    lastCheckOkMs,
    updatePillDismissed,
    setUpdatePillDismissed,
    justUpdated,
    setJustUpdated,
    setUpdateStatus,
    checkUpdate,
    doUpdate,
    autoUpdateCountdown,
    cancelAutoUpdate,
    dismissCountdown,
  };
}

