// THE Home layout (3 zones: Agir / Tableau de bord / Les séances). Sole Home
// layout — the classic HomeView was removed. Name kept as "V2" (there
// is no V1 in the app). Every value is real — derived from the live
// tobaccos/sessions/stats the app already holds; this only restructures the
// rendering.

import React from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F, catColor, CARD_BG, CARD_SHADOW } from "../../theme-curator.ts";
import { CATS_EN, monthsShort } from "../../constants.ts";
import { fmtDate, parseLocalDate, today, softBreakSlashes } from "../../utils.ts";
import { safeBgUrl } from "../../utils/imgCache.ts";
import {
  AnimNum, Stars, Lbl, IconBtn, PressCard, ScreenWash, GrowBarH, Spinner,
} from "../../components/curator/primitives.tsx";
import { Ico, Orn } from "../../components/curator/icons.tsx";
import { CuratorTrashIndicator } from "../../components/curator/TrashIndicator.tsx";
import { computeSmokeSuggestions, suggestRestedPipe, rotateDailyHero, dailyWindow, seededShuffle, FEATURE_ROTATE_MS } from "../../utils/suggest.ts";
import { homeRotationSeed } from "../../utils/homeRotation.ts";
import { computePipeGhostingRisk } from "../../utils/ghosting.ts";
import { computePipeMaintenanceReminders } from "../../utils/pipeMaint.ts";
import type { SuggestionReason } from "../../utils/suggest.ts";
import { computeWatchlist } from "../../utils/watchlist.ts";
import type { WatchItem } from "../../utils/watchlist.ts";
import { computeTasteProfile } from "../../utils/tasteProfile.ts";
import { aromaLabelKey } from "../../utils/aromas.ts";
import {
  computeCellarMaturity, computeYearConsumption, computeActivityHeatmap,
  activityHeatmapMonths, computeCellarDepletion, computeCellarPeaks,
} from "../../utils/cellarInsights.ts";
import { plural } from "../../utils.ts";
import type { Pipe } from "../../types.ts";

function ZoneHead({ title, sub, accent }: { title: string; sub?: string | undefined; accent: string }) {
  return (
    <div style={{ padding: "18px 12px 10px", display: "flex", alignItems: "baseline", gap: 10 }}>
      <span style={{ width: 5, height: 18, background: accent, borderRadius: 1, boxShadow: `0 0 8px ${alpha(accent, "66")}` }} />
      {/* An `<h2>`, like `SectionHead` on every other page — the
          Home's three zones (Agir / Tableau de bord / Les moments) were spans,
          so it had no navigable structure under its title either. */}
      <h2 style={{ fontFamily: F.display, fontSize: fs(24), color: C.ivory, fontStyle: "italic", letterSpacing: -0.3, fontWeight: 400, margin: 0 }}>{title}</h2>
      {sub && <Lbl size={9.5} color={C.tx3} weight={400} style={{ marginLeft: "auto", letterSpacing: 1.4, alignSelf: "center" }}>{sub}</Lbl>}
    </div>
  );
}

function Tile({ value, label, accent, prefix, suffix, delay, onClick }: {
  value: React.ReactNode; label: string; accent: string;
  prefix?: string | undefined; suffix?: string | undefined;
  delay?: number | undefined; onClick?: (() => void) | undefined;
}) {
  return (
    <PressCard onClick={onClick} style={{
      // Recessed "à surveiller" tone — darker inset ground
      // (C.bg2), 8px radius, and a thin left accent bar instead of the
      // old raised card + bright top hairline, so the tiles read as part
      // of the same calm surface as the watch-list rows above them.
      background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
      padding: "12px 13px 12px 15px", position: "relative", overflow: "hidden",
      boxShadow: CARD_SHADOW,
    }}>
      <div style={{ position: "absolute", top: 10, bottom: 10, left: 0, width: 3, borderRadius: "0 2px 2px 0", background: accent }} />
      <div style={{ fontFamily: F.display, fontSize: fs(26), color: C.ivory, fontStyle: "italic", lineHeight: 1 }}>
        {prefix}{typeof value === "number" ? <AnimNum value={value} delay={delay ?? 0} /> : value}{suffix}
      </div>
      {/* The tile is `overflow: hidden`, so a label too wide for it
          was CUT rather than wrapped — « Consommation 2026 » by 2px in French
          at the "L" text size, found by the paint-past-a-clipping-ancestor
          checker rule.
          « CONSOMMATION » is a single 12-character word carrying 19px of
          letter-spacing in a 105px box: it cannot fit and has neither a space
          nor a slash to break at, which is the exact case `anywhere` is reserved
          for as the last resort. It costs a second line only in the
          configuration where the word does not fit. */}
      <div style={{ marginTop: 6 }}>
        <Lbl size={9} color={accent} style={{ overflowWrap: "anywhere" }}>{label}</Lbl>
      </div>
    </PressCard>
  );
}

export function CuratorHomeViewV2() {
  const ctx = useAppCtx();
  const {
    view, t, xl, lang, nav, stats, data,
    tasting, tastingResume, tastingStart, sessDefaultWeight,
    setStatusFilter, setSearchOpen, setImportModal, setSettingsTab,
    navToInvFiltered, navToInvByAroma, navToJournalFilteredByDate,
    crossOpenDetail,
    dateFormat, pipeIsActive, weightUnit = "g",
    imgLocal, watchLowWeight,
    maintReminderThreshold, maintRemindersEnabled,
    autoSaveDrive, lastAutoSaveTs, pendingSync, gdriveStatus,
    cloudNewerBackup, dismissCloudNewerBackup, restoreCloudNewerBackup, cloudRestoreBusy,
  } = ctx;

  // Drive-sync indicator (same logic as the classic HomeView): sage = ok,
  // amber = stale, oxblood = error, hidden when the user never engaged Drive.
  const driveStatus = ((): null | "ok" | "stale" | "err" => {
    let hasFid = false;
    try { hasFid = !!(localStorage.getItem("gdrive-fid") || localStorage.getItem("gdrive-auto-fid")); } catch (_e) { /* ignore */ }
    if (!(autoSaveDrive || lastAutoSaveTs || hasFid)) return null;
    const statusStr = gdriveStatus ? String(gdriveStatus).toLowerCase() : "";
    if (/erreur|error|fehler|expir|échec|invalid/.test(statusStr)) return "err";
    if (pendingSync) return "stale";
    if (!lastAutoSaveTs) return "stale";
    if (Date.now() - lastAutoSaveTs > 24 * 3600 * 1000) return "stale";
    return "ok";
  })();
  const driveColor = driveStatus === "err" ? C.oxbloodHi : driveStatus === "stale" ? C.amber : C.sage;
  const driveTip = !driveStatus ? "" : driveStatus === "err"
    ? (t ? t("drive_err_open_settings") : "Erreur sauvegarde cloud — ouvrir les paramètres")
    : driveStatus === "stale" ? (t ? t("drive_sync_delayed") : "Synchro en retard — ouvrir les paramètres")
    : (t ? t("drive_synced") : "Synchronisé avec le cloud");

  const tonight = React.useMemo(
    () => computeSmokeSuggestions(data?.tobaccos || [], data?.sessions || [], {
      lowLotThreshold: weightUnit === "oz" ? 0.35 : 10,
      // "Ce soir ?" is a RANDOM draw over every OPEN tobacco (jar lot
      // with weight left), excluding "à ne pas reprendre" (handled in the
      // engine), ignoring rating — per user request. Pull the WHOLE open pool
      // (no score cap) so the seeded shuffle in the render body has everything
      // to draw from; the reason chips (trop âgé / jamais fumé / …) still show
      // on whatever gets drawn.
      openOnly: true,
      ignoreRating: true,
      max: 500,
    }),
    [data?.tobaccos, data?.sessions, weightUnit],
  );
  const watchlist = React.useMemo(
    () => computeWatchlist(data?.tobaccos || [], {
      lowWeightThreshold: parseFloat(watchLowWeight) || (weightUnit === "oz" ? 0.9 : 25),
      // Pull the FULL watch pool (severity-ordered) so the "À
      // surveiller" list can rotate a window of 3 through ALL of them over
      // time, instead of the display just capping at the top few.
      max: 200,
    }),
    [data?.tobaccos, weightUnit, watchLowWeight],
  );
  // "À point" — tobaccos matured into their optimal window, ready to
  // enjoy at their best. Positive counterpart to the watchlist, disjoint from
  // it by construction (see computeCellarPeaks).
  const peaks = React.useMemo(
    () => computeCellarPeaks(data?.tobaccos || [], { max: 200 }),
    [data?.tobaccos],
  );
  const taste = React.useMemo(
    () => computeTasteProfile(data?.tobaccos || [], data?.sessions || []),
    [data?.tobaccos, data?.sessions],
  );
  const maturity = React.useMemo(
    () => computeCellarMaturity(data?.tobaccos || []),
    [data?.tobaccos],
  );
  // Estimated cellar autonomy — stock ÷ recent smoking rate.
  const depletion = React.useMemo(
    () => computeCellarDepletion(data?.tobaccos || [], data?.sessions || []),
    [data?.tobaccos, data?.sessions],
  );
  const yearCons = React.useMemo(
    () => computeYearConsumption(data?.sessions || [], new Date().getFullYear()),
    [data?.sessions],
  );
  const heatmap = React.useMemo(
    () => {
      const nowMs = Date.now();
      const hm = computeActivityHeatmap(data?.sessions || [], 10, nowMs);
      // Month index per column, aligned with hm.grid, so the strip
      // can print month ticks like the Stats calendar.
      // byDay (date → session count) + cellKey(col,row) → ISO date,
      // using the SAME geometry as computeActivityHeatmap, so tapping a cell
      // resolves the exact day + its session count.
      const byDay: Record<string, number> = {};
      (data?.sessions || []).forEach((s: any) => {
        if (!s || !s.date || s.deletedAt) return;
        const k = String(s.date).slice(0, 10);
        byDay[k] = (byDay[k] || 0) + 1;
      });
      const DAY = 86400000;
      const span = 10 * 7;
      const cellKey = (c: number, d: number) => {
        const dt = new Date(nowMs - (span - 1 - (c * 7 + d)) * DAY);
        const m = String(dt.getMonth() + 1).padStart(2, "0");
        const dd = String(dt.getDate()).padStart(2, "0");
        return dt.getFullYear() + "-" + m + "-" + dd;
      };
      return Object.assign(hm, { months: activityHeatmapMonths(10, nowMs), byDay, cellKey });
    },
    [data?.sessions],
  );
  const [calSel, setCalSel] = React.useState<{ date: string; count: number } | null>(null);
  // Pipes due for maintenance (sessions since last cleaning ≥
  // threshold), most-overdue first — the "À entretenir" reminder at page end.
  const maintReminders = React.useMemo(
    () => maintRemindersEnabled === false
      ? []
      : computePipeMaintenanceReminders(data?.pipes || [], data?.sessions || [], maintReminderThreshold, 5, today()),
    [data?.pipes, data?.sessions, maintReminderThreshold, maintRemindersEnabled],
  );
  // Per-launch rotation shift. The 12 h time bucket is stable WITHIN
  // its window, so reopening / reloading the app inside the same 12 h shows the
  // identical picks (it looked "toujours les mêmes" to anyone checking on
  // demand). `homeRotationSeed()` bumps a persisted counter once per app launch;
  // adding `seed × FEATURE_ROTATE_MS` to the rotation clock steps every Home
  // rotation (hero, secondary list, both "du moment" picks) forward by one each
  // time the app is opened, while the time bucket keeps them moving over the
  // day. Constant across in-session navigation (memoised for the JS-context
  // lifetime; HomeViewV2 never unmounts), so it doesn't churn as the user moves
  // between tabs.
  const rotShift = homeRotationSeed() * FEATURE_ROTATE_MS;
  // Featured pipe + tobacco of the moment (30-day window), same logic as the
  // classic HomeView.
  const LAST_DAYS_MS = 30 * 24 * 3600 * 1000;
  const recentCutoff = Date.now() - LAST_DAYS_MS;
  const featNow = Date.now() + rotShift;
  const pipeRecent: Record<string, number> = Object.create(null);
  const tobRecent: Record<string, number> = Object.create(null);
  ((data?.sessions || []) as any[]).forEach((sess) => {
    if (!sess || !sess.date) return;
    const ts = parseLocalDate(sess.date); // LOCAL-anchored (TZ off-by-one)
    if (isNaN(ts) || ts < recentCutoff) return;
    if (sess.pipeId) { const k = String(sess.pipeId); pipeRecent[k] = (pipeRecent[k] || 0) + 1; }
    if (sess.tobaccoId) { const k = String(sess.tobaccoId); tobRecent[k] = (tobRecent[k] || 0) + 1; }
  });
  // Both "du moment" picks used to take sort()[0] — a fixed
  // deterministic winner, so with several candidates tied on the same recent
  // session-count + rating the SAME one showed every day. For a stretch of 42
  // releases they used pickDailyTie, which rotates only among the TOP TIE-GROUP
  // and PINS a unique leader. A user with a genuinely most-used pick (e.g. Autumn
  // Evening at 3 recent sessions, nothing else at 3) therefore saw the SAME
  // "du moment" forever — a size-1 tie group never rotates, and neither the 12 h
  // bucket nor the per-launch rotShift can move a modulo-1 pick. Since the user
  // wants VARIETY over a strict "single most-used" reading, both picks now
  // rotate among the TOP TIER via rotateDailyHero (like the "Ce soir ?" hero):
  // the pool is the recently-smoked set (count > 0) when ≥ 2 exist — so the
  // "N séances · 30 j" subtitle stays truthful — else the whole active
  // collection (fresh cellar with no recent sessions). The pool is
  // ranked by number of sessions ONLY (rating dropped, per user request), so a
  // launch still surfaces one of the most-smoked, and the others cycle in on
  // the 12 h + per-launch clock.
  const featPipe: Pipe | undefined = (() => {
    const actives = ((data?.pipes || []) as Pipe[]).filter((p) => !pipeIsActive || pipeIsActive(p));
    if (actives.length === 0) return undefined;
    const sorted = actives.slice().sort((a, b) => {
      const ca = pipeRecent[String(a.id)] || 0, cb = pipeRecent[String(b.id)] || 0;
      if (ca !== cb) return cb - ca;
      // Rating dropped from the ordering — "du moment" is ranked by
      // number of sessions ONLY (per user request). Stable date/id tiebreak.
      return String(a.dateProduction || a.datePurchased || "").localeCompare(String(b.dateProduction || b.datePurchased || ""));
    });
    const recent = sorted.filter((p) => (pipeRecent[String(p.id)] || 0) > 0);
    const pool = recent.length >= 2 ? recent : sorted;
    return rotateDailyHero(pool, featNow, Math.min(5, pool.length), FEATURE_ROTATE_MS)[0];
  })();
  const featTob: any | undefined = (() => {
    const lives = ((data?.tobaccos || []) as any[]).filter((tb) => {
      const lots = Array.isArray(tb?.lots) ? tb.lots : [];
      return lots.length === 0 || lots.some((l: any) => l && l.status !== "finished");
    });
    if (lives.length === 0) return undefined;
    const sorted = lives.slice().sort((a, b) => {
      const ca = tobRecent[String(a.id)] || 0, cb = tobRecent[String(b.id)] || 0;
      if (ca !== cb) return cb - ca;
      // Rating dropped — ranked by number of sessions ONLY.
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    const recent = sorted.filter((tb) => (tobRecent[String(tb.id)] || 0) > 0);
    const pool = recent.length >= 2 ? recent : sorted;
    return rotateDailyHero(pool, featNow, Math.min(5, pool.length), FEATURE_ROTATE_MS)[0];
  })();

  if (view !== "home") return null;
  const s = stats || {};
  // ANY pending tasting, not just a running one.
  //
  // A tasting abandoned at the "setup" stage (tobacco/pipe still being picked)
  // persists in cave-tasting-active across relaunches — and it
  // blocks every automatic update, because a silent reload mid-setup was a real
  // bug. But NOTHING showed it: TastingBanner renders only for `running`, and
  // this CTA said "Démarrer une dégustation". So the app could sit for days
  // holding a forgotten half-started tasting, refusing to update, with no
  // sign anywhere — which is exactly what a user hit, and it took the
  // "why is it waiting" line in Settings to make it findable.
  //
  // A state that changes how the app behaves has to be visible. Resuming also
  // gives the way out: the tasting view can cancel it.
  const tastingRunning = tasting && (tasting.stage === "running" || tasting.stage === "setup");

  // Merged "Agir" stream: tonight suggestions + watchlist, hero = first item.
  const reasonMeta = (r: SuggestionReason, days: number | null): { label: string; color: string } | null => {
    switch (r) {
      case "aging_overaged": return { label: t ? t("mat_old") : "Trop âgé", color: C.oxbloodHi };
      case "aging_approaching": return { label: t ? t("mat_peak") : "Pic proche", color: C.amber };
      case "lot_low": return { label: t ? t("sugg_lot_low") : "pot presque vide", color: C.amber };
      case "never_smoked": return { label: t ? t("sugg_never") : "jamais fumé", color: C.sage };
      case "not_recent": return { label: String(t ? t("sugg_not_recent") : "pas fumé depuis {n} j").replace("{n}", String(days ?? 0)), color: C.sage };
      case "favorite": return { label: t ? t("sugg_favorite") : "favori", color: C.brassHi };
      default: return null;
    }
  };
  const watchMeta = (w: WatchItem): { label: string; color: string } => {
    switch (w.kind) {
      case "overaged": return { label: t ? t("mat_old") : "Trop âgé", color: C.oxbloodHi };
      case "approaching": return { label: t ? t("mat_peak") : "Pic proche", color: C.amber };
      default: return { label: String(t ? t("watch_low_stock") : "stock bas · {w}").replace("{w}", String(w.value) + weightUnit), color: C.brassHi };
    }
  };
  const tobOf = (id: any) => (data?.tobaccos || []).find((tt: any) => String(tt.id) === String(id));
  type ActItem = { tob: any; tag: string; tagColor: string; chip: string | null; chipColor: string };
  const toActItem = (sug: any): ActItem | null => {
    const tob = tobOf(sug.tobaccoId); if (!tob) return null;
    const m = sug.reasons.map((r: SuggestionReason) => reasonMeta(r, sug.daysSinceSmoked)).filter(Boolean)[0] as { label: string; color: string } | undefined;
    return { tob, tag: t ? t("home_tonight_title") : "Ce soir ?", tagColor: C.brassHi, chip: m ? m.label : null, chipColor: m ? m.color : C.tx3 };
  };
  // The most-recently smoked tobacco is not head-lined again until
  // the next session (it STAYS in the list, just isn't the big-photo pick).
  // The "Ce soir ?" draw also folds the session count into its
  // shuffle seed, so ANY logged session reshuffles the proposals on top of the
  // per-launch + 12 h axes.
  const liveSessions = (data?.sessions || []) as any[];
  const lastSmokedTobId = (() => {
    let bestKey = "", bestId: string | null = null;
    liveSessions.forEach((s) => {
      if (!s || !s.tobaccoId) return;
      const key = String(s.date || "") + "T" + String(s.time || "") + "#" + String(s.id || "");
      if (key > bestKey) { bestKey = key; bestId = String(s.tobaccoId); }
    });
    return bestId;
  })();
  // The "Ce soir ?" picks are a RANDOM draw over the whole open pool
  // (see the `tonight` memo — open jar lots, minus "à ne pas reprendre", rating
  // ignored). A seeded shuffle keeps it stable within a render/session yet
  // reshuffles each app launch (`homeRotationSeed`) and each 12 h bucket, so a
  // user with many open tins finally sees genuine variety instead of the same
  // score-ranked few. Seed folds in the per-launch counter + the 12 h bucket +
  // the session count so any of those advancing reorders the draw.
  const shuffleSeed = homeRotationSeed() * 100003
    + Math.floor(Date.now() / FEATURE_ROTATE_MS)
    + liveSessions.length;
  const tonightActs: ActItem[] = seededShuffle(tonight, shuffleSeed)
    .map(toActItem).filter(Boolean) as ActItem[];
  const watchActs: ActItem[] = [];
  watchlist.forEach((w) => {
    const tob = tobOf(w.tobaccoId); if (!tob) return;
    const m = watchMeta(w);
    watchActs.push({ tob, tag: t ? t("home_watch_title") : "À surveiller", tagColor: C.amber, chip: m.label, chipColor: m.color });
  });
  // Hero: the first drawn tobacco, EXCLUDING the just-smoked one (fallback to
  // the full draw if excluding empties it); fall back to a watch item only if
  // the cellar has nothing open to smoke tonight.
  const heroCand = tonightActs.filter((a) => String(a.tob.id) !== lastSmokedTobId);
  const hero = (heroCand[0] || tonightActs[0]) || watchActs[0];

  // Two DISTINCT lists below the hero.
  //  • "Ce soir ?" secondary — the next 3 from the same random draw, EXCLUDING
  //    the hero (may still include the just-smoked tobacco).
  //  • "À surveiller" — the watchlist, with its own rotating window of 3
  //    (severity-ordered pool), kept IN ADDITION to the 3 "Ce soir" ones — only
  //    the hero is removed (to avoid repeating the big photo). A tobacco may
  //    legitimately be both suggested tonight AND watched; the two distinct,
  //    clearly-headed sections make that read.
  const heroId = hero ? String(hero.tob.id) : null;
  const ceSoirSecondary = tonightActs.filter((a) => String(a.tob.id) !== heroId).slice(0, 3);
  const watchPool = watchActs.filter((a) => String(a.tob.id) !== heroId);
  const watchSecondary = dailyWindow(watchPool, Date.now(), 3);
  // "À point" acts — matured tobaccos ready to enjoy. Sage/positive
  // chip. Excludes the hero (no duplicate big photo); rotates a window of 3.
  const peakActs: ActItem[] = [];
  peaks.forEach((p) => {
    const tob = tobOf(p.tobaccoId); if (!tob) return;
    if (String(tob.id) === heroId) return;
    peakActs.push({
      tob,
      tag: t ? t("home_peak_title") : "À point",
      tagColor: C.sage,
      chip: t ? t("home_peak_chip") : "à point",
      chipColor: C.sage,
    });
  });
  const peakSecondary = dailyWindow(peakActs, Date.now(), 3);
  // The paired rested-pipe now avoids ghosting the featured
  // tobacco — exclude pipes clearly dedicated to a conflicting ghosting-prone
  // family (never-smoked pipes have no history, so they're never excluded and
  // stay the safest pairing). Computed after the hero so we know tonight's
  // tobacco; if every pipe would ghost, suggestRestedPipe keeps them all.
  const heroTobId = hero ? hero.tob.id : null;
  const ghostExclude = new Set<string>(
    heroTobId != null
      ? ((data?.pipes || []) as any[])
          .filter((p) => computePipeGhostingRisk(p.id, heroTobId, data?.sessions || [], data?.tobaccos || []))
          .map((p) => String(p.id))
      : [],
  );
  // Pass the per-launch-shifted clock (`featNow` = Date.now() +
  // homeRotationSeed()×FEATURE_ROTATE_MS) + the 12 h cadence so the suggested
  // pipe rotates on the SAME rhythm as the "Ce soir ?" tobacco — it was pinned
  // to the single most-rested pipe and repeated on every relaunch.
  // Audit: measure rest with the REAL clock (Date.now()) so the
  // displayed "repos N j" is correct; rotate the pick with the shifted featNow.
  const restedPipe = suggestRestedPipe(data?.pipes || [], data?.sessions || [], Date.now(), ghostExclude, FEATURE_ROTATE_MS, featNow);
  const restedPipeObj = restedPipe ? (data?.pipes || []).find((p: any) => String(p.id) === restedPipe.pipeId) : null;

  const kgWeight = weightUnit === "oz"
    ? ((s.wt as number) || 0).toFixed(0)
    : (((s.wt as number) || 0) / 1000).toFixed(1);
  const wtUnitLabel = weightUnit === "oz" ? weightUnit : "kg";
  const soonCount = (s.lotsApproaching || 0) + (s.lotsOveraged || 0);
  const catCounts: any[] = Array.isArray(s.cats) ? s.cats : [];
  const catMax = catCounts.reduce((m, c) => Math.max(m, c[1] || 0), 1);
  const catTotal = catCounts.reduce((a, c) => a + (c[1] || 0), 0) || 1;

  // 44px touch targets (WCAG 2.5.5 + the app's own IconBtn default),
  // consistent with the dock and every other view's TopBar. The glyph stays
  // 17px — only the tap box grows, so the header reads the same, just tappable.
  const ib = { width: 44, height: 44, borderRadius: 12 } as const;

  // Shared secondary-list row (used by both the "Ce soir ?" and
  // "À surveiller" lists). Whole row → tobacco fiche.
  const actRow = (a: ActItem, i: number) => {
    const cc = catColor(a.tob.category || "");
    const photo = a.tob.imageUrl ? ((imgLocal && imgLocal[a.tob.imageUrl]) || a.tob.imageUrl) : null;
    return (
      <PressCard key={i} onClick={() => { if (crossOpenDetail) crossOpenDetail({ view: "inv", kind: "tobacco", obj: a.tob }); }}
        style={{
          padding: "9px 12px", display: "flex", alignItems: "center", gap: 12,
          background: CARD_BG, borderRadius: 8, border: `1px solid ${C.rule}`,
          // The soft card lift, now app-wide (see CARD_SHADOW).
          boxShadow: CARD_SHADOW,
        }}>
        {photo ? (
          <div style={{
            width: 42, height: 42, borderRadius: 8, flexShrink: 0,
            border: `1px solid ${C.rule2}`,
            background: `${safeBgUrl(photo)} center/cover no-repeat, ${C.bg2}`,
          }} />
        ) : (
          <div style={{
            width: 42, height: 42, borderRadius: 8, flexShrink: 0,
            background: alpha(cc, "18"), border: `1px solid ${alpha(cc, "44")}`, color: cc,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Ico name="leaf" size={18} sw={1.3} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {a.chip && (
            <div style={{ marginBottom: 2 }}>
              <span style={{ padding: "1px 6px", borderRadius: 4, background: alpha(a.chipColor, "22"), color: a.chipColor, fontFamily: F.mono, fontSize: fs(10.5), letterSpacing: 0.6, textTransform: "uppercase", fontWeight: 700, whiteSpace: "nowrap" }}>{a.chip}</span>
            </div>
          )}
          <div style={{ fontFamily: F.display, fontStyle: "italic", color: C.ivory, fontSize: fs(17), lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.tob.name || "—"}</div>
          <div style={{ fontSize: fs(13), color: C.tx2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.tob.brand || "—"}</div>
        </div>
        <Ico name="chevron" size={16} sw={2} />
      </PressCard>
    );
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: C.bg, fontFamily: F.body, color: C.tx }}>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ paddingBottom: 130 }}>

        {/* TopBar — status-bar safe-area-aware (matches the shared TopBar
            primitive), so the row never slides under the iOS notch. It is
            STICKY (same frosted recipe as the shared TopBar / FormScreen) so
            the masthead stays visible while the Home scrolls under it. */}
        <div style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 14px)", paddingLeft: 18, paddingRight: 14, paddingBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 20, background: `linear-gradient(180deg, ${C.bg}, ${alpha(C.bg, "cc")})`, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Orn color={C.brass} />
            <span style={{ fontFamily: F.display, fontStyle: "italic", fontSize: fs(17), color: C.title, letterSpacing: 0.2 }}>{t ? t("app_name") : "Ma Cave à Tabac"}</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <CuratorTrashIndicator />
            {/* The shopping-list cart lives ONLY on the tobacco
                inventory top bar now (removed from the Home per user request). */}
            {/* Cloud / backup access — always present top-right. Coloured by
                Drive-sync status when engaged, neutral otherwise. */}
            <IconBtn icon="cloud" size={ib.width} color={driveStatus ? driveColor : C.tx2}
              onClick={() => { if (setSettingsTab) setSettingsTab("data"); if (setImportModal) setImportModal(true); }}
              ariaLabel={driveTip || (t ? t("sec_cloud") : "☁️ Sauvegarde cloud")} />
            <IconBtn icon="search" size={ib.width} onClick={() => setSearchOpen && setSearchOpen(true)} ariaLabel={t ? t("btn_search") : "Rechercher"} />
            <IconBtn icon="settings" size={ib.width} onClick={() => { if (setSettingsTab) setSettingsTab("prefs"); if (setImportModal) setImportModal(true); }} ariaLabel={t ? t("btn_settings") : "Paramètres"} />
          </div>
        </div>

        {/* Cloud-newer banner (data-safety — kept from the classic home) */}
        {cloudNewerBackup && (
          <div style={{ padding: "4px 12px 6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: alpha(C.brass, "14"), border: `1px solid ${alpha(C.brass, "40")}` }}>
              <Ico name="cloud" size={16} color={C.brassHi} />
              {/* Substitute the {date} placeholder the i18n value
                  carries (the global Overlays twin does; this inline copy was
                  rendering "({date})" literally). */}
              <span style={{ flex: 1, fontSize: fs(13.5), color: C.cream, lineHeight: 1.4 }}>{
                String(t ? t("cloud_newer_banner") : "Un autre appareil a une version plus récente ({date}). La restaurer efface les données de cet appareil et les remplace par celles de la sauvegarde.")
                  .replace("{date}", (() => {
                    try { const d = new Date(cloudNewerBackup.ts); return dateFormat === "en" ? d.toLocaleString("en-US") : d.toLocaleString("fr-FR"); }
                    catch (_e) { return ""; }
                  })())
              }</span>
              <button type="button" disabled={!!cloudRestoreBusy} onClick={() => restoreCloudNewerBackup && restoreCloudNewerBackup()}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 44, padding: "5px 12px", borderRadius: 8, border: `1px solid ${C.brassHi}`, background: "transparent", color: C.brassHi, fontSize: fs(12.5), fontWeight: 700, cursor: "pointer" }}>
                {cloudRestoreBusy && <Spinner size={11} />}{t ? t("btn_restore_short") : "Restaurer"}
              </button>
              {/* A gutter between the destructive action and
                  the way out, matching the Overlays twin. Here both are
                  already 44, so only the separation was missing. The rule the
                  two copies now share: the DISMISS is never smaller than
                  « Restaurer », and they are never adjacent. */}
              <div style={{ width: 14, flexShrink: 0 }} aria-hidden="true" />
              <button type="button" onClick={() => dismissCloudNewerBackup && dismissCloudNewerBackup()} aria-label={t ? t("btn_close") : "Fermer"}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: 44, height: 44, background: "transparent", border: "none", color: C.tx3, fontSize: fs(20), cursor: "pointer" }}>×</button>
            </div>
          </div>
        )}

        {/* Title + mini strip */}
        {/* This is the page's `<h1>`, and it is the only
            heading the Home had. `PageTitle` renders an h1 on every other
            page; the Home builds its masthead by hand and rendered a bare
            `<div>`, so a screen-reader user landing on the app's FIRST screen
            could not navigate it by heading at all — there was not one to
            jump to. Inline `style` keeps the browser's own h1 sizing out,
            exactly as `PageTitle` does. */}
        <div style={{ padding: "6px 12px 0" }}>
          <h1 style={{ fontFamily: F.display, fontSize: fs(44), color: C.title, fontStyle: "italic", lineHeight: 1, letterSpacing: -0.8, fontWeight: 400, margin: 0 }}>
            {t ? t("sec_library") : "Bibliothèque"}
          </h1>
        </div>
        <div style={{ margin: "16px 12px 4px", paddingTop: 14, borderTop: `1px solid ${C.rule}`, display: "flex", justifyContent: "space-between" }}>
          {[
            // The count shown is s.activeRefs (owned tobaccos, "47"),
            // so the drill must land on the OWNED list — statusFilter "active",
            // not "all" (which adds fully-finished tabacs). nav("inv") already
            // resets every list filter (including the tobacco rating
            // filter) so no stale N-star filter narrows the result.
            { v: s.activeRefs || 0, l: t ? t("nav_tobaccos") : "Tabacs", c: C.brass, onClick: () => { nav("inv"); setStatusFilter && setStatusFilter("active"); } },
            { v: s.pipesActive || 0, l: t ? t("stat_pipes_word") : "Pipes", c: C.oxbloodHi, onClick: () => nav("pipes") },
            { v: (data?.sessions || []).length, l: t ? t("stat_sessions") : "Séances", c: C.sage, onClick: () => nav("journal") },
            // The average rating drills to the Statistics page
            // (its natural home — rating distribution, top-rated) instead of
            // being an inert number.
            { v: (typeof s.avg === "string" ? s.avg : (s.avg || "—")), l: t ? t("stat_avg") : "Moyenne", c: C.brassHi, onClick: () => nav("stats") },
          ].map((x, i, a) => (
            <React.Fragment key={x.l}>
              <PressCard onClick={x.onClick || undefined} style={{ flex: 1 }}>
                <div style={{ fontFamily: F.display, fontSize: fs(26), color: x.c, lineHeight: 1, fontStyle: i === 3 ? "italic" : "normal" }}>
                  {typeof x.v === "number" ? <AnimNum value={x.v} delay={150 + i * 70} /> : x.v}
                </div>
                <Lbl size={9.5} color={C.tx2}>{x.l}</Lbl>
              </PressCard>
              {i < a.length - 1 && <div style={{ width: 1, background: C.rule, alignSelf: "stretch", margin: "2px 8px" }} />}
            </React.Fragment>
          ))}
        </div>

        {/* ══ ZONE 1 · AGIR ══ */}
        <ZoneHead title={t ? t("home_zone_act") : "Agir"} sub={t ? t("home_zone_act_sub") : "maintenant"} accent={C.ember} />
        <div style={{ padding: "0 12px 8px" }}>
          <PressCard onClick={() => { if (tastingRunning) { tastingResume && tastingResume(); nav("tasting"); } else if (tastingStart) { tastingStart({ tobaccoId: "", pipeId: "", lotId: "", weightG: sessDefaultWeight || (weightUnit === "oz" ? "0.1" : "3") }); nav("tasting"); } }}
            style={{ background: `linear-gradient(135deg, ${C.ctaFrom}, ${C.ctaTo})`, borderRadius: 14, padding: "13px 15px", display: "flex", alignItems: "center", gap: 12, color: C.ctaInk, boxShadow: `0 8px 24px ${alpha(C.ctaFrom, "55")}` }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center" }}><Ico name="flame" size={19} sw={1.8} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F.display, fontSize: fs(18), fontWeight: 600, fontStyle: "italic" }}>
                {tastingRunning ? (t ? t("tasting_resume_home") : "▶ Reprendre la séance") : (t ? t("tasting_title") : "Démarrer une dégustation")}
              </div>
              <div style={{ fontSize: fs(13.5), opacity: 0.85, marginTop: 1 }}>
                {tastingRunning ? (t ? t("home_tasting_resume_hint") : "Reprenez où vous en êtes") : (t ? t("home_tasting_start_hint") : "Choisir tabac + pipe · chronomètre")}
              </div>
            </div>
            <Ico name="chevron" size={18} sw={2.2} />
          </PressCard>
        </div>

        {/* ══ ZONE · CE SOIR ══ — the suggestion hero + its
            rotating list of 3, split out of "Agir" (which now holds only the
            "Démarrer une dégustation" CTA). The section header replaces the
            old "✦ Ce soir ?" chip that sat on the hero photo. */}
        {hero && (
          <ZoneHead title={t ? t("home_tonight_title") : "Ce soir ?"} sub={t ? t("home_tonight_sub") : "suggestions"} accent={C.brassHi} />
        )}

        {/* Hero suggestion */}
        {hero && (() => {
          const cc = catColor(hero.tob.category || "");
          const heroPhoto = hero.tob.imageUrl ? ((imgLocal && imgLocal[hero.tob.imageUrl]) || hero.tob.imageUrl) : null;
          return (
            <div style={{ padding: "6px 12px 0" }}>
              <PressCard onClick={() => { if (crossOpenDetail) crossOpenDetail({ view: "inv", kind: "tobacco", obj: hero.tob }); }}
                style={{ borderRadius: 16, overflow: "hidden", position: "relative", border: `1px solid ${C.rule2}`, background: `linear-gradient(155deg, ${C.card}, ${C.bg2})`, boxShadow: "0 14px 34px rgba(0,0,0,0.4)" }}>
                <div style={{ height: heroPhoto ? 160 : 92, position: "relative", background: heroPhoto ? `${safeBgUrl(heroPhoto)} center/cover no-repeat, ${C.bg2}` : `radial-gradient(circle at 28% 45%, ${alpha(cc, "44")}, transparent 62%), linear-gradient(135deg, ${C.bg3}, ${C.bg})` }}>
                  {!heroPhoto && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: cc, opacity: 0.5 }}><Ico name="leaf" size={44} sw={1} /></div>}
                  <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, transparent 40%, ${C.card} 98%)` }} />
                </div>
                {/* The "✦ Ce soir ?" tag is gone (the section header
                    carries it now); the STATUS chip (jamais fumé / trop âgé) now
                    sits inline AFTER the tobacco name, off the photo. */}
                <div style={{ padding: "0 12px 14px", marginTop: -10, position: "relative" }}>
                  <Lbl color={cc}>{hero.tob.brand || "—"}</Lbl>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                    <span style={{ fontFamily: F.display, fontSize: fs(24), color: C.ivory, fontStyle: "italic", lineHeight: 1.1 }}>{hero.tob.name || "—"}</span>
                    {hero.chip && <span style={{ padding: "2px 8px", borderRadius: 999, background: alpha(hero.chipColor, "22"), color: hero.chipColor, fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, whiteSpace: "nowrap" }}>{hero.chip}</span>}
                  </div>
                  {restedPipeObj && (
                    <div style={{ marginTop: 6, fontSize: fs(13.5), color: C.tx2, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                      <span>{t ? t("home_pair_with") : "À accorder avec"}</span>
                      {/* Tapping the pipe name opens the PIPE fiche
                          (the rest of the card opens the tobacco). PressCard
                          fires on pointerUp, not just click, so we stop BOTH
                          pointer + click propagation — a click-only
                          stopPropagation leaked and opened the tobacco.
                          It was a padding:0 text-only target (too hard
                          to tap on the hero photo). Now a real chip — inline-
                          flex, oxblood tint + border, generous padding — so the
                          hit area is a comfortable tap size. */}
                      <button type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); if (crossOpenDetail) crossOpenDetail({ view: "pipes", kind: "pipe", obj: restedPipeObj }); }}
                        style={{
                          display: "inline-flex", alignItems: "center", minHeight: 32,
                          padding: "5px 11px", borderRadius: 999,
                          background: alpha(C.oxbloodHi, "1e"), border: `1px solid ${alpha(C.oxbloodHi, "55")}`,
                          font: "inherit", fontWeight: 600, color: C.oxbloodHi, cursor: "pointer",
                        }}>
                        {[restedPipeObj.brand, restedPipeObj.name].filter(Boolean).join(" ")}
                      </button>
                      {restedPipe && restedPipe.restDays !== null
                        ? <span>· {String(t ? t("rest_chip") : "repos {n} j").replace("{n}", String(restedPipe.restDays))}</span>
                        : null}
                    </div>
                  )}
                </div>
              </PressCard>
            </div>
          );
        })()}

        {/* "Ce soir ?" secondary — a rotating window of 3 more
            suggestions (excludes the hero, alternates day-to-day). */}
        {ceSoirSecondary.length > 0 && (
          <div style={{ padding: "8px 12px 4px" }}>
            {/* No outer card chrome — the bg2 rows sit directly on
                the page as recessed panels (uniform with the tiles/cards). */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ceSoirSecondary.map(actRow)}
            </div>
          </div>
        )}

        {/* "À surveiller" — the watchlist, distinct section (own
            header + amber accent), NO rotation (severity order), no repeats of
            what's shown above. */}
        {watchSecondary.length > 0 && (
          <>
            {/* Use the shared ZoneHead so the header matches every
                other section's size/weight (was a smaller custom header). */}
            <ZoneHead title={t ? t("home_watch_title") : "À surveiller"} sub={t ? t("home_watch_sub") : "rappels"} accent={C.amber} />
            <div style={{ padding: "0 12px 4px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {watchSecondary.map(actRow)}
              </div>
            </div>
          </>
        )}

        {/* "À point" — the POSITIVE maturity list. Tobaccos that
            have matured into their optimal window, ready to enjoy at their
            best. Sage accent, own header, disjoint from "À surveiller". */}
        {peakSecondary.length > 0 && (
          <>
            <ZoneHead title={t ? t("home_peak_title") : "À point"} sub={t ? t("home_peak_sub") : "prêts à déguster"} accent={C.sage} />
            <div style={{ padding: "0 12px 4px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {peakSecondary.map(actRow)}
              </div>
            </div>
          </>
        )}

        {/* ══ ZONE 2 · TABLEAU DE BORD ══ */}
        <ZoneHead title={t ? t("home_zone_dash") : "Tableau de bord"} sub={t ? t("home_section_tobacco_sub") : "inventaire"} accent={C.brass} />

        {/* Maturity window */}
        {maturity.total > 0 && (
          <div style={{ padding: "0 12px 10px" }}>
            <div style={{ position: "relative", overflow: "hidden", background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8, padding: "12px 14px", boxShadow: CARD_SHADOW }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <Lbl size={9} color={C.brass}>{t ? t("home_maturity_title") : "Cave à maturité"}</Lbl>
                <span style={{ fontFamily: F.display, fontStyle: "italic", fontSize: fs(17), color: C.brassHi }}>{maturity.optimalPct} %</span>
              </div>
              <div style={{ marginTop: 8, height: 8, background: C.bg, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                {[[maturity.young, C.sage], [maturity.optimal, C.brass], [maturity.peak, C.amber], [maturity.tooOld, C.oxblood]].map((seg, i) => (
                  <div key={i} style={{ width: ((seg[0] as number) / maturity.total * 100) + "%", background: seg[1] as string }} />
                ))}
              </div>
              <div style={{ marginTop: 7, display: "flex", gap: 12, flexWrap: "wrap", fontFamily: F.mono, fontSize: fs(11), color: C.tx3, letterSpacing: 0.4, textTransform: "uppercase" }}>
                {[
                  { dot: C.sage, label: t ? t("home_mat_young") : "jeune", n: maturity.young, filter: "young" },
                  { dot: C.brass, label: t ? t("home_mat_optimal") : "optimale", n: maturity.optimal, filter: "optimal" },
                  { dot: C.amber, label: t ? t("home_mat_peak") : "pic", n: maturity.peak, filter: "approaching" },
                  { dot: C.oxblood, label: t ? t("home_mat_old") : "âgé", n: maturity.tooOld, filter: "overaged" },
                ].map((m) => (
                  <button key={m.label} type="button"
                    onClick={() => { nav("inv"); setStatusFilter && setStatusFilter(m.filter); }}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "inherit", letterSpacing: "inherit", textTransform: "inherit" }}>
                    <span style={{ color: m.dot }}>●</span> {m.label} {m.n}
                  </button>
                ))}
              </div>
              {/* Estimated autonomy — how long the stock lasts at the
                  recent smoking pace. Hidden when unmeasurable (no recent
                  consumption / accounting off). */}
              {depletion && (() => {
                const d = depletion.daysRemaining;
                const months = d / 30.44;
                let value: string;
                if (months < 1.5) {
                  const w = Math.max(1, Math.round(d / 7));
                  value = "≈ " + w + " " + plural(w, t ? t("unit_week_one") : "semaine", t ? t("unit_week_other") : "semaines", lang);
                } else if (months < 24) {
                  const mo = Math.round(months);
                  value = "≈ " + mo + " " + plural(mo, t ? t("unit_month_one") : "mois", t ? t("unit_month_other") : "mois", lang);
                } else {
                  const y = Math.round(months / 12);
                  value = "≈ " + y + " " + plural(y, t ? t("unit_year_one") : "an", t ? t("unit_year_other") : "ans", lang);
                }
                return (
                  <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${C.rule}`, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <Lbl size={9} color={C.tx3} weight={400} style={{ letterSpacing: 0.4 }}>
                      {t ? t("home_cellar_autonomy") : "Autonomie estimée"}
                    </Lbl>
                    <span style={{ fontFamily: F.display, fontStyle: "italic", fontSize: fs(15), color: C.sageHi }}>{value}</span>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Bento tiles — counts only (monetary values live in Stats) */}
        <div style={{ padding: "8px 12px 0", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}>
          <Tile value={s.cellar || 0} label={t ? t("stat_tins") : "Boîtes"} accent={C.brass} delay={120} onClick={() => { nav("inv"); setStatusFilter && setStatusFilter("cellar"); }} />
          <Tile value={s.jars || 0} label={t ? t("stat_jars") : "Pots"} accent={C.amber} delay={170} onClick={() => { nav("inv"); setStatusFilter && setStatusFilter("jar"); }} />
          <Tile value={kgWeight} suffix={" " + wtUnitLabel} label={t ? t("lbl_weight_simple") : "Poids"} accent={C.brassHi} delay={220} onClick={() => { nav("inv"); setStatusFilter && setStatusFilter("all"); }} />
          <Tile value={soonCount} label={t ? t("stat_smoke_soon") : "À fumer rapidement"} accent={C.oxbloodHi} delay={270} onClick={soonCount > 0 ? () => { nav("inv"); setStatusFilter && setStatusFilter("smokesoon"); } : undefined} />
          <Tile value={yearCons.thisYear} suffix={" " + weightUnit} label={(t ? t("lbl_consumption") : "Consommation") + " " + new Date().getFullYear()} accent={C.brassHi} delay={320} onClick={() => nav("journal")} />
          <Tile value={s.wish || 0} label={t ? t("lbl_wishes") : "envies"} accent={C.oxbloodHi} delay={370} onClick={() => { if (crossOpenDetail) crossOpenDetail({ view: "inv", kind: "wishlist" }); }} />
        </div>


        {/* Familles — all of them, 2 per row */}
        {catCounts.length > 0 && (
          <div style={{ padding: "8px 12px 0" }}>
            <div style={{ position: "relative", overflow: "hidden", background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8, padding: "12px 14px", boxShadow: CARD_SHADOW }}>
              <Lbl size={9} color={C.amber}>{t ? t("sec_families") : "Familles"}</Lbl>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", columnGap: 16, rowGap: 9 }}>
                {catCounts.map((c, i) => {
                  const pct = Math.round(((c[1] || 0) / catTotal) * 100);
                  const bar = Math.round(((c[1] || 0) / catMax) * 100);
                  const col = catColor(c[0]);
                  return (
                    <PressCard key={c[0]} onClick={() => navToInvFiltered && navToInvFiltered(c[0], "")}
                      style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: col, flexShrink: 0 }} />
                      {/* WRAPS instead of ellipsizing. This is a
                          2-column grid at 360px, and the row spends 86px of its
                          ~146px on a 6px dot, a 26px bar and a 26px percentage —
                          leaving the label, which is the actual content, 66px.
                          MEASURED against a real cellar: "Aromatique" needs 71px
                          and "Virginia/Burley" 88px at the DEFAULT text size in
                          French (77px / 98px for the German pair at "L"), so six
                          of the fifteen canonical categories were being cut on
                          every user's home screen. It took a real export to see
                          it — the committed fixture happened to use only short
                          category names, which is why a long one is now seeded.
                          Wrapping costs a second line on those rows and loses
                          nothing; the alternative (dropping the % to buy 33px)
                          would still not fit the longest label. */}
                      {/* A ZERO-WIDTH SPACE after the slash, so
                          the wrap happens at "Virginia/" + "Burley" instead of
                          mid-word. Wrapping stopped the label being CLIPPED by
                          letting it wrap, and `overflow-wrap: anywhere` does
                          guarantee that — but "anywhere" means literally
                          anywhere, so the one category with no space in it broke
                          as "Virginia/Burle" + "y". Reported from the app with a
                          screenshot. MEASURED: the column is 81px and the label
                          needs 88px at the default text size, 98px at "L" — so
                          it cannot fit on one line and the question is only
                          where it breaks. `break-word` is not the fix: "/" is
                          not a break opportunity of its own (UAX #14 class SY),
                          so it would overflow instead. `anywhere` STAYS as the
                          last resort, for a future category with neither space
                          nor slash. U+200B is ignored by screen readers and by
                          copy/paste, and this is the only place the value is
                          rendered — the stored enum is untouched. */}
                      <span style={{ flex: 1, minWidth: 0, fontSize: fs(13), color: C.ivory, overflowWrap: "anywhere" }}>{softBreakSlashes(xl ? xl(c[0], CATS_EN) : c[0])}</span>
                      <span style={{ width: 26, height: 4, background: C.bg, borderRadius: 2, overflow: "hidden", display: "inline-block", flexShrink: 0 }}>
                        <GrowBarH pct={bar} color={col} delay={500 + i * 40} />
                      </span>
                      <span style={{ fontFamily: F.mono, fontSize: fs(11), color: C.tx3, width: 26, textAlign: "right", flexShrink: 0 }}>{pct}%</span>
                    </PressCard>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Votre profil — full width so families / aromas read as flowing
            lines without mid-word breaks. */}
        {(taste.families.length > 0 || taste.aromas.length > 0) && (
          <div style={{ padding: "8px 12px 0" }}>
            <div style={{ position: "relative", overflow: "hidden", background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8, padding: "13px 15px", boxShadow: CARD_SHADOW }}>
              <Lbl size={9} color={C.sage}>{t ? t("home_profile_title") : "Votre profil"}</Lbl>
              {taste.families.length > 0 && (
                <div style={{ marginTop: 7, fontFamily: F.display, fontStyle: "italic", fontSize: fs(17), lineHeight: 1.4 }}>
                  {taste.families.slice(0, 3).map((f, i) => (
                    <React.Fragment key={f.category}>
                      {i > 0 && <span style={{ color: C.tx3, margin: "0 8px", fontStyle: "normal" }}>·</span>}
                      {/* Clickable → inventory filtered on this family
                          (like the "Familles" section). */}
                      <button type="button"
                        onClick={() => navToInvFiltered && navToInvFiltered(f.category, "")}
                        aria-label={(t ? t("sec_families") : "Familles") + " · " + (xl ? xl(f.category, CATS_EN) : f.category)}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontStyle: "italic", color: catColor(f.category), whiteSpace: "nowrap" }}>
                        {xl ? xl(f.category, CATS_EN) : f.category}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}
              {taste.aromas.length > 0 && (
                <div style={{ marginTop: 7, fontSize: fs(14.5), color: C.sageHi, fontStyle: "italic", fontFamily: F.display, lineHeight: 1.45 }}>
                  {taste.aromas.map((a, i) => (
                    <React.Fragment key={a.key}>
                      {i > 0 && <span style={{ color: C.tx3, margin: "0 6px", fontStyle: "normal" }}>·</span>}
                      {/* Clickable → inventory filtered on this aroma. */}
                      <button type="button"
                        onClick={() => navToInvByAroma && navToInvByAroma(a.key)}
                        aria-label={t ? t(aromaLabelKey(a.key)) : a.key}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontStyle: "italic", color: C.sageHi, whiteSpace: "nowrap" }}>
                        {t ? t(aromaLabelKey(a.key)) : a.key}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ ZONE 3 · MOMENTS ══ */}
        <ZoneHead title={t ? t("home_zone_moments") : "Les séances"} sub={t ? t("home_zone_moments_sub") : "activité récente"} accent={C.brassHi} />

        {/* Activité — smoking calendar. Month ticks, and
            each cell is tappable ("toucher une case") → shows that day's
            date + session count and links into the journal filtered on it,
            matching the Stats calendar. The card no longer navigates on tap
            (a cell tap must select, not jump), so the info line is the journal
            entry point — same interaction model as Stats. */}
        <div style={{ padding: "8px 12px 0" }}>
          <div style={{ position: "relative", overflow: "hidden", background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8, padding: "12px 14px", boxShadow: CARD_SHADOW }}>
            <Lbl size={9} color={C.brass}>{t ? t("home_activity_title") : "Activité"} · {String(t ? t("home_activity_weeks") : "{n} sem.").replace("{n}", "10")}</Lbl>
            {/* Month ticks aligned with the week columns — the label prints on
                the first column of each month, so the strip reads "mai · juin". */}
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              {heatmap.months.map((mo, w) => {
                const show = w === 0 || heatmap.months[w - 1] !== mo;
                return (
                  <div key={w} style={{ flex: 1, minWidth: 0, fontFamily: F.mono, fontSize: fs(10.5), color: C.tx3, letterSpacing: 0.2, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "visible" }}>
                    {show ? monthsShort(lang)[mo] : ""}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 5, display: "flex", gap: 4 }}>
              {heatmap.grid.map((col, w) => (
                <div key={w} style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                  {col.map((lvl, d) => {
                    const bg = lvl === 0 ? C.bg : lvl === 1 ? alpha(C.amber, "55") : lvl === 2 ? C.amberHi : C.oxbloodHi;
                    const key = heatmap.cellKey(w, d);
                    const cnt = heatmap.byDay[key] || 0;
                    const selected = calSel != null && calSel.date === key;
                    return (
                      // DECIDED, do not "fix": these cells are
                      // 27x11 px tap targets, under the 24px floor of WCAG
                      // 2.5.8 (AA), and the spacing exception does not apply
                      // (3px apart). Both AA-compliant variants were BUILT and
                      // photographed at 360px before deciding: a 24px target
                      // with the bar left at 11px turns the grid into floating
                      // dashes, and a 24px target with an 18px bar keeps the
                      // density but both cost +73px — the card goes 206 -> 279,
                      // a third taller, at the top of the home screen.
                      // Kept as-is under 2.5.8's "essential" exception: a
                      // heatmap showing 10 weeks at a glance is the same class
                      // as a chart or a map, where density IS the presentation.
                      // The same reading covers the Stats bars. Note this is
                      // NOT the excuse used elsewhere in the app: the TagEditor
                      // × was raised 20 -> 24 for this very rule, because a
                      // close button has no density argument.
                      <button key={d} type="button"
                        onClick={() => setCalSel({ date: key, count: cnt })}
                        aria-label={fmtDate(key, dateFormat) + " · " + cnt}
                        style={{
                          width: "100%", height: 11, borderRadius: 2, background: bg,
                          padding: 0, cursor: "pointer",
                          border: selected ? `1px solid ${C.ivory}` : "1px solid transparent",
                        }} />
                    );
                  })}
                </div>
              ))}
            </div>
            {/* Selection / hint line — mirrors the Stats calendar. */}
            <div style={{ marginTop: 9, fontSize: fs(13.5), minHeight: 16, fontFamily: F.body, color: calSel ? C.ivory : C.tx2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {calSel ? (() => {
                const dn = fmtDate(calSel.date, dateFormat);
                // Was `count === 1 ? …`, i.e. the en/es/de/it rule
                // applied to all five. French treats 0 AND 1 as singular
                // (utils.plural), and tapping an EMPTY calendar day is
                // reachable — it read "0 séances" instead of "0 séance".
                const ses = plural(calSel.count,
                  t ? t("lbl_session_word") : "séance",
                  t ? t("lbl_sessions_word") : "séances", lang);
                const txt = `${dn} · ${calSel.count} ${ses}`;
                if (calSel.count > 0 && navToJournalFilteredByDate) {
                  return (
                    <button type="button"
                      onClick={() => navToJournalFilteredByDate(calSel.date)}
                      aria-label={t ? String(t("aria_journal_filter_date")).replace("{d}", dn) : `Journal · ${dn}`}
                      style={{ background: "transparent", border: "none", padding: 0, color: C.ivory, fontFamily: F.body, fontSize: fs(13.5), cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, textAlign: "left" }}>
                      {txt}<span style={{ color: C.brass, fontWeight: 700 }}>→</span>
                    </button>
                  );
                }
                return txt;
              })() : (
                <Lbl color="inherit" size={10.5} weight={400} style={{ letterSpacing: 0.3 }}>
                  <span style={{ color: C.brassHi }}>{heatmap.total}</span> {t ? t("home_activity_total") : "séances au total"} · {t ? t("hint_heatmap_tap") : "Touche une case pour voir le détail"}
                </Lbl>
              )}
            </div>
          </div>
        </div>
        {/* 8px top so the "du moment" tiles don't touch the calendar
            card above (which has 0 bottom padding). */}
        <div style={{ padding: "8px 12px 0", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
          {[
            { obj: featTob, color: catColor(featTob?.category || ""), tag: t ? t("home_tobacco_of_moment") : "Tabac du moment", icon: "leaf" as const, n: featTob ? (tobRecent[String(featTob.id)] || 0) : 0, onClick: () => { if (featTob && crossOpenDetail) crossOpenDetail({ view: "inv", kind: "tobacco", obj: featTob }); } },
            { obj: featPipe, color: C.oxbloodHi, tag: t ? t("home_pipe_of_moment") : "Pipe du moment", icon: "pipe" as const, n: featPipe ? (pipeRecent[String(featPipe.id)] || 0) : 0, onClick: () => { if (featPipe && crossOpenDetail) crossOpenDetail({ view: "pipes", kind: "pipe", obj: featPipe }); } },
          ].filter((m) => m.obj).map((m, i) => {
            const photo = m.obj.imageUrl ? ((imgLocal && imgLocal[m.obj.imageUrl]) || m.obj.imageUrl) : null;
            return (
              <PressCard key={i} onClick={m.onClick} style={{ borderRadius: 8, overflow: "hidden", background: CARD_BG, border: `1px solid ${C.rule}`, boxShadow: CARD_SHADOW }}>
                <div style={{ height: 100, position: "relative", background: photo ? `${safeBgUrl(photo)} center/cover no-repeat, ${C.bg2}` : `radial-gradient(circle at 45% 40%, ${alpha(m.color, "33")}, ${C.bg2})`, display: "flex", alignItems: "center", justifyContent: "center", color: m.color }}>
                  {!photo && <Ico name={m.icon} size={32} sw={1} />}
                </div>
                <div style={{ padding: "9px 12px 12px" }}>
                  {/* Label enlarged (was size 8). Letter-spacing
                      tightened + wrap allowed so the longer languages
                      ("Tobacco of the moment") stay fully visible (the label
                      never clips — no nowrap/overflow — so it wraps instead
                      of truncating). */}
                  {/* DECIDED, do not "fix": the name below
                      ellipsizes in these tiles and that is intended. Measured
                      against a real 58-tobacco cellar at 360px: the tile gives
                      the name a 137px box, so a real 33-char pipe name
                      ("Savinelli Marte Rusticated 320 KS") loses ~41%. Raised
                      with the user, who chose to leave it: these are teasers in
                      a 2-column grid and the fiche one tap away carries the
                      full name. Wrapping here would make the two tiles
                      different heights for a name nobody is reading in full.
                      The audit will surface it again — this note is the answer. */}
                  <div style={{ marginBottom: 5 }}><Lbl size={11} color={m.color} style={{ letterSpacing: 0.6, lineHeight: 1.25, display: "block" }}>★ {m.tag}</Lbl></div>
                  <div style={{ fontSize: fs(13), color: C.tx2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.obj.brand || "—"}</div>
                  <div style={{ fontFamily: F.display, fontSize: fs(17), color: C.ivory, fontStyle: "italic", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.obj.name || "—"}</div>
                  <div style={{ marginTop: 6 }}><Stars n={m.obj.rating || 0} size={11} /></div>
                  <Lbl size={9} color={C.tx3} weight={400} style={{ display: "block", marginTop: 6, letterSpacing: 0.4 }}>
                    {/* The session noun goes through plural(): a "du moment"
                        pick very often has exactly ONE recent session, and all
                        six dictionaries hardcoded the PLURAL — it read
                        "1 séances" / "1 Sitzungen" / "1 sessões" on the home
                        screen of every language. */}
                    {String(t ? t("home_moment_sessions") : "{n} {s} · 30 j")
                      .replace("{n}", String(m.n))
                      .replace("{s}", plural(m.n,
                        t ? t("lbl_session_word") : "séance",
                        t ? t("lbl_sessions_word") : "séances", lang))}
                  </Lbl>
                </div>
              </PressCard>
            );
          })}
        </div>

        {/* À entretenir — usage-based pipe maintenance reminder, page end. */}
        {maintReminders.length > 0 && (
          <>
            <ZoneHead title={t ? t("maint_due") : "À entretenir"} sub={t ? t("maint_due_sub") : "rappel"} accent={C.amber} />
            <div style={{ padding: "0 12px 4px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {maintReminders.map((r) => {
                  const photo = r.pipe && r.pipe.imageUrl
                    ? ((imgLocal && imgLocal[r.pipe.imageUrl]) || r.pipe.imageUrl)
                    : null;
                  return (
                  <PressCard key={r.pipeId}
                    onClick={() => { if (r.pipe && crossOpenDetail) crossOpenDetail({ view: "pipes", kind: "pipe", obj: r.pipe }); }}
                    style={{
                      padding: "10px 12px", display: "flex", alignItems: "center", gap: 12,
                      background: CARD_BG, borderRadius: 8, border: `1px solid ${C.rule}`,
                      boxShadow: CARD_SHADOW,
                    }}>
                    {photo ? (
                      <div style={{
                        width: 42, height: 42, borderRadius: 8, flexShrink: 0,
                        border: `1px solid ${C.rule2}`,
                        background: `${safeBgUrl(photo)} center/cover no-repeat, ${C.bg2}`,
                      }} />
                    ) : (
                      <div style={{
                        width: 42, height: 42, borderRadius: 8, flexShrink: 0,
                        background: alpha(C.amber, "18"), border: `1px solid ${alpha(C.amber, "44")}`, color: C.amber,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <Ico name="pipe" size={18} sw={1.5} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: fs(13), color: C.tx2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.pipe.brand || "—"}</div>
                      <div style={{ fontFamily: F.display, fontStyle: "italic", color: C.ivory, fontSize: fs(17), lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.pipe.name || "—"}</div>
                      <div style={{ marginTop: 3, fontFamily: F.mono, fontSize: fs(11), color: C.amber, letterSpacing: 0.3 }}>
                        {String(r.everMaintained
                          ? (t ? t("maint_since") : "{n} {s} depuis l'entretien")
                          : (t ? t("maint_never") : "{n} {s}, jamais nettoyée")
                        ).replace("{n}", String(r.sessionsSince))
                         .replace("{s}", plural(r.sessionsSince,
                           t ? t("lbl_session_word") : "séance",
                           t ? t("lbl_sessions_word") : "séances", lang))}
                      </div>
                    </div>
                    <Ico name="chevron" size={16} sw={2} />
                  </PressCard>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Privacy link on the Home. It was carried by the
            classic HomeView footer and dropped when HomeViewV2 became the sole
            home, then restored. Google OAuth verification requires a privacy policy
            link reachable from the app, so this must stay on the Home page.
            Locked by the "privacy link" test in HomeViewV2.test.tsx. */}
        <div style={{ marginTop: 18, paddingBottom: 8, textAlign: "center" }}>
          <button type="button" onClick={() => nav && nav("privacy")}
            style={{
              minHeight: 44, fontSize: fs(14.5), color: C.tx3, textDecoration: "none",
              fontFamily: F.mono, letterSpacing: 1,
              background: "transparent", border: "none", cursor: "pointer", padding: "0 12px",
            }}>
            {t ? t("btn_privacy") : "Confidentialité"}
          </button>
        </div>

      </div>
    </div>
  );
}
