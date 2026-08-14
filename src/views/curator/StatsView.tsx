// Stats view. Pulls chart data from ctx.chartData and draws every section
// using the shared chart helpers in src/components/Charts.jsx.


import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import {
  hBars, vBars, donutChart, calendarHeatmap,
} from "../../components/Charts.jsx";
import {
  CATS, CATS_EN, SHAPES_EN, BOWL_MATS_EN, STEM_MATS_EN,
  monthsShort, heatmapDayInitials,
} from "../../constants.ts";
import { FilterChipSimple, ScrollableChipRow } from "../../components/curator/FilterControls.tsx";
import { fmtNum, fmtDate, plural, softBreakSlashes } from "../../utils.ts";
// The categories come from THE palette (constants.ts, via catColor)
// — this view used to import a SECOND, divergent one aliased to the same name,
// which is exactly why the split went unnoticed for so long.
import { alpha, fs, C, F, CARD_BG, CARD_SHADOW, CURATOR_CHART_COLORS as PIPE_COLORS, catColor } from "../../theme-curator.ts";
import {
  Stars, Lbl, IconBtn, ScreenWash, TopBar, PressCard,
  PageTitle, useEnter,
} from "../../components/curator/primitives.tsx";
import { Ico, Orn } from "../../components/curator/icons.tsx";
import { CuratorTrashIndicator } from "../../components/curator/TrashIndicator.tsx";
import { Notice } from "../../components/curator/Notice.tsx";
import { computeSpendingStats, computeLocationStats, computeAgingSweetSpot, computeAromaProfile, computeCostPerSession } from "../../utils/stats.ts";
import { aromaLabelKey } from "../../utils/aromas.ts";
import { countryNameToFlag, countryNameToIso2, iso2ToCountryName } from "../../utils/geo.ts";

export function CuratorStatsView() {
  const ctx = useAppCtx();
  const {
    openHelp,
    view, t, lang, dateFormat, xl, chartData = {}, weightUnit = "g", data,
    currencySymbol = "€",
    setSearchOpen,
    navToInvFiltered, navToPipesFiltered,
    // New click-thru helpers — pipe material filter +
    // journal year filter pre-selection.
    navToPipesFilteredByMaterial, navToJournalFiltered,
    navToJournalFilteredByDate, navToJournalFilteredByLocation,
    // Rating drill + cross-open helpers (record the Stats origin so
    // system-back returns to Stats). Aroma drill (aroma-profile bars).
    navToInvByRating, navToInvByAroma, crossOpenDetail,
    accountingEnabled = true,
  } = ctx;
  // Every clickable chart row carries a native `title` tooltip whose
  // suffix used to be hardcoded French inside Charts.jsx ("— clic pour
  // filtrer"), shown as-is in all five languages. hBars now takes the hint as a
  // parameter; this wrapper supplies it once for all 19 call sites in this view
  // rather than threading a third argument through each.
  const bars = (items: any, w: number) =>
    hBars(items, w, t ? t("chart_tap_to_filter") : " — clic pour filtrer");
  const calScrollRef = useRef<HTMLDivElement | null>(null);
  const [calSel, setCalSel] = useState<{ date: string; count: number } | null>(null);
  // Aging-curve family filter ("" = all families).
  const [agingCat, setAgingCat] = useState<string>("");
  // Aroma-profile family filter ("" = all families).
  const [aromaCat, setAromaCat] = useState<string>("");

  useEffect(() => {
    if (view !== "stats") return;
    const el = calScrollRef.current;
    if (!el) return;
    const scroll = () => {
      const node = calScrollRef.current;
      if (node) node.scrollLeft = node.scrollWidth;
    };
    requestAnimationFrame(() => { scroll(); requestAnimationFrame(scroll); });
  }, [chartData?.calByDay, view]);

  // useCallback + lang dep so the ci / spend memos below can list
  // `monthLabel` itself as a dep instead of proxying via `lang`. The
  // Audit follow-up: the proxy worked but the eslint-
  // disable on the dep arrays was unexplained — a future maintainer
  // could remove `lang` from the deps without realising it gated the
  // monthLabel closure. Locking the chain makes the deps honest.
  const monthLabel = useCallback((ym: string) => {
    const parts = String(ym).split("-");
    const mi = parseInt(parts[1] || "0", 10) - 1;
    const names = monthsShort(lang);
    const name = (mi >= 0 && mi < 12) ? names[mi] : parts[1];
    const yy = (parts[0] || "").slice(-2);
    return name + (yy ? " " + yy : "");
  }, [lang]);

  const ci = useMemo(() => {
    const catW = (chartData.catW || []).map((x: any) => ({
      label: xl ? xl(x[0], CATS_EN) : x[0], value: x[1] as number,
      color: catColor(String(x[0])),
      onClick: () => navToInvFiltered && navToInvFiltered(x[0], ""),
    }));
    const brandW = (chartData.brandW || []).map((x: any, i: number) => ({
      label: x[0], value: x[1] as number,
      color: PIPE_COLORS[i % PIPE_COLORS.length], unit: weightUnit,
      onClick: () => navToInvFiltered && navToInvFiltered("", x[0]),
    }));
    const ratings = [1, 2, 3, 4, 5].map((s, i) => ({
      label: "★" + s,
      value: (chartData.ratings || [])[i] || 0,
      color: PIPE_COLORS[i],
      // Go through navToInvByRating (records the Stats origin so
      // back returns to Stats, and uses setView so the rating filter survives —
      // the old bare nav("inv") let nav()'s ratingFilter reset wipe it, AND
      // lost Stats on back). The histogram is active-only, so the helper lands
      // on the "active" list to match.
      onClick: ((chartData.ratings || [])[i] || 0) > 0
        ? () => navToInvByRating && navToInvByRating(s)
        : undefined,
    }));
    const pShapes = (chartData.pShapes || []).map((x: any, i: number) => ({
      label: xl ? xl(x[0], SHAPES_EN) : x[0], value: x[1] as number,
      color: PIPE_COLORS[i % PIPE_COLORS.length],
      onClick: () => navToPipesFiltered && navToPipesFiltered(x[0], ""),
    }));
    // Every chart row gets an `onClick` that navigates to
    // the relevant list view with the matching filter pre-selected.
    // `x[0]` is the raw FR key (e.g. "Bruyère") — the filter compares
    // on the raw stored field, so pass the raw value to the helper.
    const pBowl = (chartData.pBowl || []).map((x: any, i: number) => ({
      label: xl ? xl(x[0], BOWL_MATS_EN) : x[0], value: x[1] as number,
      color: PIPE_COLORS[i % PIPE_COLORS.length],
      onClick: () => navToPipesFilteredByMaterial && navToPipesFilteredByMaterial(x[0], "bowl"),
    }));
    const pStem = (chartData.pStem || []).map((x: any, i: number) => ({
      label: xl ? xl(x[0], STEM_MATS_EN) : x[0], value: x[1] as number,
      color: PIPE_COLORS[i % PIPE_COLORS.length],
      onClick: () => navToPipesFilteredByMaterial && navToPipesFilteredByMaterial(x[0], "stem"),
    }));
    // Monthly: x[0] is "YYYY-MM" — slice the year for the journal filter.
    const monthlyDur = (chartData.monthlyDur || [])
      .filter((x: any) => (x[1] as number) > 0)
      .map((x: any) => ({
        label: monthLabel(x[0]), value: x[1] as number, color: C.brassHi, unit: "h",
        onClick: () => navToJournalFiltered && navToJournalFiltered(String(x[0]).slice(0, 4)),
      }));
    const monthlyWeight = (chartData.monthlyWeight || [])
      .filter((x: any) => (x[1] as number) > 0)
      .map((x: any) => ({
        label: monthLabel(x[0]), value: x[1] as number, color: C.sage, unit: weightUnit,
        onClick: () => navToJournalFiltered && navToJournalFiltered(String(x[0]).slice(0, 4)),
      }));
    const yearlyDur = (chartData.yearlyDur || []).map((x: any) => ({
      label: x[0] as string, value: x[1] as number, color: C.brassHi, unit: "h",
      onClick: () => navToJournalFiltered && navToJournalFiltered(x[0]),
    }));
    const yearlyWeight = (chartData.yearlyWeight || [])
      .filter((x: any) => (x[1] as number) > 0)
      .map((x: any) => ({
        label: x[0] as string, value: x[1] as number, color: C.sage, unit: weightUnit,
        onClick: () => navToJournalFiltered && navToJournalFiltered(x[0]),
      }));
    const topTobaccos = (chartData.topTobaccos || []).map((x: any, i: number) => ({
      // The session count travels as `note`, not concatenated into
      // the label — see the hBars label row. The right-hand value here is the
      // WEIGHT, so this parenthetical is a distinct metric, not a duplicate.
      label: x.name,
      ...(x.sessions > 0 ? { note: "(" + x.sessions + "×)" } : {}),
      value: x.weight, color: PIPE_COLORS[i % PIPE_COLORS.length], unit: weightUnit,
      // Cross-open the fiche so system-back returns to Stats. The
      // old nav("inv")+setDetail opened the fiche over the inventory LIST, so
      // back closed to that list (losing Stats). crossOpenDetail records the
      // Stats origin → back pops to Stats.
      onClick: () => {
        const tob = (data?.tobaccos || []).find((tb: any) => String(tb.id) === x.id);
        if (tob && crossOpenDetail) crossOpenDetail({ view: "inv", kind: "tobacco", obj: tob });
      },
    }));
    const topPipes = (chartData.topPipes || []).map((x: any, i: number) => ({
      // Total hours as `note` (see topTobaccos above) — the
      // right-hand value is the session COUNT, so the two differ.
      label: x.name,
      ...(x.duration >= 6 ? { note: "(" + Math.round(x.duration / 6) / 10 + "h)" } : {}),
      value: x.sessions, color: PIPE_COLORS[i % PIPE_COLORS.length],
      // Leading space so the count sits separately from the
      // unit ("3 séances" instead of "3séances"). Singular when the
      // count is exactly 1 ("1 séance" / "1 session").
      unit: " " + (x.sessions === 1
        ? (t ? t("lbl_session_word") : "séance")
        : (t ? t("lbl_sessions_word") : "séances")),
      // Cross-open the fiche so system-back returns to Stats
      // (see the topTobaccos note above).
      onClick: () => {
        const pipe = (data?.pipes || []).find((p: any) => String(p.id) === x.id);
        if (pipe && crossOpenDetail) crossOpenDetail({ view: "pipes", kind: "pipe", obj: pipe });
      },
    }));
    // Session counts by commune + by country (the spot/POI is
    // ignored on purpose — only commune + country are aggregated). Pure,
    // top 10 each. Display-only (no drill-down filter for location yet).
    const _loc = computeLocationStats(data?.sessions || [], 10);
    const locCommunes = _loc.byCommune.map((x: any, i: number) => ({
      label: x.label, value: x.count, color: PIPE_COLORS[i % PIPE_COLORS.length],
      onClick: () => navToJournalFilteredByLocation && navToJournalFilteredByLocation("commune", x.label),
    }));
    const locCountries = _loc.byCountry.map((x: any, i: number) => {
      // Display the country in the ACTIVE UI language when it
      // resolves to a known ISO code (so a German user sees "Frankreich",
      // not the "France" that was stored at capture time). Unknown/exotic
      // countries keep their raw captured label. The click-thru still passes
      // the raw representative label — the JournalView filter is ISO-aware.
      const iso = countryNameToIso2(x.label);
      const display = iso ? (iso2ToCountryName(iso, lang) || x.label) : x.label;
      const flag = countryNameToFlag(x.label);
      return {
        label: (flag ? flag + " " : "") + display, value: x.count,
        color: PIPE_COLORS[i % PIPE_COLORS.length],
        // Pass the localised name so the journal filter chip reads the same
        // as what the user tapped; the ISO-aware filter still catches every
        // language variant (countryNameToIso2(display) === the row's ISO).
        onClick: () => navToJournalFilteredByLocation && navToJournalFilteredByLocation("country", display),
      };
    });
    return { catW, brandW, ratings, pShapes, pBowl, pStem,
      monthlyDur, monthlyWeight, yearlyDur, yearlyWeight, topTobaccos, topPipes,
      locCommunes, locCountries };
    // `lang` is here as the proxy for `xl` (a closure created on
    // every App render that depends on `lang`); listing `xl` directly
    // would defeat the memo. Ctx setters (setDetail / setPipeDet /
    // nav / navTo*) are also closures over App state — listing them
    // would recompute every render too; they're stable enough in
    // practice (App.tsx never recreates them with new identity unless
    // its own state changes). `monthLabel` is in useCallback([lang])
    // so it can stand on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, weightUnit, monthLabel, lang, data?.sessions]);

  // Spending charts. Monthly = tobacco lots only (full
  // ISO purchase dates); yearly = per kind (tobacco / pipes /
  // accessories as three series). Pure off liveData.
  const spend = useMemo(() => {
    const s = computeSpendingStats(data?.tobaccos || [], data?.pipes || [], data?.accessories || []);
    const series = (rows: [string, number][], color: string) => rows
      .filter((x) => x[1] > 0)
      .map((x) => ({ label: x[0], value: x[1], color, unit: " " + currencySymbol }));
    return {
      raw: s,
      monthly: s.monthly
        .filter((x) => x[1] > 0)
        .map((x) => ({ label: monthLabel(x[0]), value: x[1], color: C.amber, unit: " " + currencySymbol })),
      yearlyTobacco: series(s.yearlyTobacco, C.amber),
      yearlyPipes: series(s.yearlyPipes, C.oxbloodHi),
      yearlyAccessories: series(s.yearlyAccessories, C.ember),
    };
  }, [data?.tobaccos, data?.pipes, data?.accessories, currencySymbol, monthLabel]);

  // Real per-bowl cost of each blend = spent on its lots ÷ its
  // sessions. Rows are clickable → the tobacco fiche (crossOpenDetail records
  // the Stats origin so system-back returns here).
  const cps = useMemo(() => {
    const s = computeCostPerSession(data?.tobaccos || [], data?.sessions || [], { max: 8 });
    return {
      raw: s,
      bars: s.items.map((x, i) => ({
        label: x.name + " (" + x.sessions + "×)",
        value: x.costPerSession,
        color: PIPE_COLORS[i % PIPE_COLORS.length],
        unit: " " + currencySymbol,
        onClick: () => {
          const tob = (data?.tobaccos || []).find((tb: any) => String(tb.id) === x.id);
          if (tob && crossOpenDetail) crossOpenDetail({ view: "inv", kind: "tobacco", obj: tob });
        },
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.tobaccos, data?.sessions, currencySymbol]);

  // Tobacco families present in the journal (ordered by CATS),
  // driving the aging-curve family filter. Computed from ALL sessions so
  // the chip list stays stable regardless of the selected filter.
  const agingCats = useMemo(() => {
    const tobs = (data?.tobaccos || []) as any[];
    const sessions = (data?.sessions || []) as any[];
    const catByTob: Record<string, string> = {};
    tobs.forEach((tb: any) => {
      if (tb && tb.id !== undefined) catByTob[String(tb.id)] = String(tb.category || "");
    });
    const present = new Set<string>();
    sessions.forEach((s: any) => {
      if (!s) return;
      const c = catByTob[String(s.tobaccoId)];
      if (c) present.add(c);
    });
    return (CATS as readonly string[]).filter((c) => present.has(c));
  }, [data?.tobaccos, data?.sessions]);

  // Aging sweet-spot — average rating per tobacco-age bucket.
  const aging = useMemo(() => {
    // Ignore a stale filter whose family no longer appears in the data.
    const cat = agingCat && agingCats.includes(agingCat) ? agingCat : "";
    const a = computeAgingSweetSpot(data?.tobaccos || [], data?.sessions || [], cat);
    const ageLabel = (b: { key: string; minYears: number; maxYears: number | null }) => {
      if (b.key === "lt1") return t ? t("stat_age_lt1") : "< 1 an";
      if (b.maxYears === null) {
        return String(t ? t("stat_age_plus") : "{a} ans+").replace("{a}", String(b.minYears));
      }
      return String(t ? t("stat_age_range") : "{a}–{b} ans")
        .replace("{a}", String(b.minYears)).replace("{b}", String(b.maxYears));
    };
    const items = a.buckets.map((b) => ({
      label: ageLabel(b),
      value: b.avg,
      unit: "★",
      // Highlight the sweet-spot bucket; mute the rest.
      color: b.key === a.peakKey ? C.brassHi : C.brassDim,
    }));
    const peak = a.peakKey ? a.buckets.find((b) => b.key === a.peakKey) : null;
    // `a.total` = usable sessions (a dated lot + a valid age +
    // a rating from the session or, failing that, from the tobacco). Shown
    // in the empty-state hint so the user can see the count grow.
    return {
      total: a.total, buckets: a.buckets, items,
      peakLabel: peak ? ageLabel(peak) : null, peakAvg: peak ? peak.avg : null,
      ready: a.total >= 3 && a.buckets.length >= 2,
    };
  }, [data?.tobaccos, data?.sessions, t, agingCat, agingCats]);

  // Tobacco families present among ARO­MA-tagged sessions — drives
  // the aroma-profile family filter (a family only appears once it has at
  // least one aroma-tagged session).
  const aromaCats = useMemo(() => {
    const tobs = (data?.tobaccos || []) as any[];
    const sessions = (data?.sessions || []) as any[];
    const catByTob: Record<string, string> = {};
    tobs.forEach((tb: any) => {
      if (tb && tb.id !== undefined) catByTob[String(tb.id)] = String(tb.category || "");
    });
    const present = new Set<string>();
    sessions.forEach((s: any) => {
      if (!s || !Array.isArray(s.aromas) || s.aromas.length === 0) return;
      const c = catByTob[String(s.tobaccoId)];
      if (c) present.add(c);
    });
    return (CATS as readonly string[]).filter((c) => present.has(c));
  }, [data?.tobaccos, data?.sessions]);

  // Aroma profile — most-tapped aroma tags. Optional
  // per-family narrowing (families age/taste differently), mirroring the
  // aging curve's filter just above.
  const aromaProfile = useMemo(() => {
    const tobs = (data?.tobaccos || []) as any[];
    let sessions = (data?.sessions || []) as any[];
    const cat = aromaCat && aromaCats.includes(aromaCat) ? aromaCat : "";
    if (cat) {
      const catByTob: Record<string, string> = {};
      tobs.forEach((tb: any) => {
        if (tb && tb.id !== undefined) catByTob[String(tb.id)] = String(tb.category || "");
      });
      sessions = sessions.filter((s: any) => s && catByTob[String(s.tobaccoId)] === cat);
    }
    const p = computeAromaProfile(sessions);
    const items = p.items.map((it) => ({
      label: t ? t(aromaLabelKey(it.key)) : it.key,
      value: it.count,
      color: C.sage,
      // Tap an aroma → inventory filtered on that aroma (records the
      // Stats origin so system-back returns to Stats).
      onClick: it.key && navToInvByAroma ? () => navToInvByAroma(it.key) : undefined,
    }));
    return { items, taggedSessions: p.taggedSessions };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.tobaccos, data?.sessions, t, aromaCat, aromaCats]);

  if (view !== "stats") return null;

  const empty =
    (chartData.catW || []).length === 0 &&
    (chartData.brandW || []).length === 0 &&
    (chartData.pShapes || []).length === 0;

  const heroYear = new Date().getFullYear();
  const yearTotal = (chartData.monthlyWeight || [])
    .filter((x: any) => String(x[0]).startsWith(String(heroYear)))
    .reduce((sum: number, x: any) => sum + (x[1] || 0), 0);

  const chartWidth = () =>
    Math.min(560, (typeof window !== "undefined" ? window.innerWidth : 480) - 80);

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ paddingBottom: 130 }}>

        <TopBar
          leading={<Orn color={C.brass} />}
          title={t ? t("sec_stats") : "Statistiques"}
          trailing={<>
            <IconBtn icon="help" onClick={() => openHelp && openHelp("stats")} ariaLabel={t ? t("aria_help_page") : "Aide sur cette page"} />
            <CuratorTrashIndicator />
            <IconBtn icon="search"
              onClick={() => setSearchOpen && setSearchOpen(true)}
              ariaLabel={t ? t("btn_search") : "Rechercher"} />
          </>}
        />

        <PageTitle>
          {t ? t("stats_title_prefix") : "Les"} <span style={{ fontStyle: "italic", color: C.title }}>{t ? t("stats_title_word") : "chiffres"}</span>
        </PageTitle>

        {/* Contextual heads-up when accounting is currently
            disabled — new sessions are recorded with weightG=0 so they
            naturally don't feed any weight aggregate on this page. The
            charts themselves stay accurate (they only see what's
            actually recorded) but the user might wonder why curves
            stop climbing — this banner explains it. */}
        {accountingEnabled === false && (
          <div style={{ padding: "0 12px 12px" }}>
            <Notice tone="info">
              {t ? t("stats_accounting_off_notice") : "La comptabilité est actuellement désactivée. Les nouvelles séances sont enregistrées sans grammage et n'alimentent donc pas les graphes de poids fumé de cette page."}
            </Notice>
          </div>
        )}

        {empty ? (
          <div style={{ textAlign: "center", color: C.tx3, padding: "40px 24px" }}>
            <Ico name="chart" size={40} sw={1.2} />
            <div style={{
              marginTop: 12, fontFamily: F.display, fontStyle: "italic", fontSize: fs(20),
            }}>{t ? t("no_data_chart") : "Pas encore de données"}</div>
          </div>
        ) : (
          <>
            {/* Hero — year-to-date consumption. Clickable → opens the
                journal filtered on that year (records the Stats origin so
                system-back returns to Stats). */}
            {yearTotal > 0 && (
              <button type="button"
                onClick={() => navToJournalFiltered && navToJournalFiltered(String(heroYear))}
                aria-label={String(t ? t("aria_stats_year_sessions") : "Voir les séances de {y}").replace("{y}", String(heroYear))}
                style={{
                  display: "block", width: "calc(100% - 24px)",
                  margin: "0 12px 16px", padding: "20px 20px",
                  background: `linear-gradient(135deg, ${C.card}, ${C.bg2})`,
                  border: `1px solid ${C.rule}`, borderRadius: 8,
                  textAlign: "center", cursor: "pointer", color: "inherit", font: "inherit",
                }}>
                <Lbl color={C.tx2}>{(t ? t("lbl_consumption") : "Consommation") + " " + heroYear}</Lbl>
                <div style={{
                  fontFamily: F.display, fontSize: fs(56), color: C.brassHi,
                  lineHeight: 1, marginTop: 10, letterSpacing: -2.2, fontStyle: "italic",
                }}>
                  {fmtNum(Math.round(yearTotal), lang)}
                  <span style={{ fontSize: fs(24), color: C.tx2, fontStyle: "normal" }}>{weightUnit}</span>
                </div>
              </button>
            )}

            {/* Categories donut + legend */}
            {ci.catW.length > 0 && (
              <Card title={(t ? t("stat_chart_cat") : "Stock par catégorie") + ` (${weightUnit})`} accent={C.amber}>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
                  {donutChart(ci.catW, 160, weightUnit, t ? t("chart_total_active") : "total actif")}
                  <div style={{
                    flex: 1, minWidth: 110,
                    display: "flex", flexDirection: "column", gap: 5,
                    justifyContent: "center",
                  }}>
                    {ci.catW.map((item: any, i: number) => (
                      <button key={i} type="button" onClick={item.onClick}
                        aria-label={`${item.label}: ${fmtNum(chartData.catW[i][1], lang)}${weightUnit}`}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          cursor: "pointer", background: "transparent",
                          border: "none", padding: 0, textAlign: "left",
                          color: "inherit", font: "inherit",
                        }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: 2,
                          background: item.color, flexShrink: 0,
                        }} />
                        {/* `minWidth: 0` + a slash break, the
                            shape HomeViewV2's "Familles" row already carries
                            for this very list of labels.

                            A flex item defaults to `min-width: auto`, so
                            `flex: 1` alone refuses to shrink below its content:
                            at 360px the donut (160) + gap (14) leaves the legend
                            ~132px, and « Virginia/Burley » needs more, so the
                            VALUE beside it was pushed past the card's
                            `overflow: hidden` edge and silently cut — 13px in
                            German. The min-width:auto trap, a fourth time.

                            softBreakSlashes because `/` is UAX #14 class SY and
                            is not a break opportunity of its own, so without it
                            the label would overflow rather than wrap; DISPLAY
                            ONLY, never stored. */}
                        <span style={{
                          fontSize: fs(15), color: C.ivory,
                          flex: 1, minWidth: 0, overflowWrap: "anywhere",
                        }}>{softBreakSlashes(String(item.label))}</span>
                        <span style={{ fontSize: fs(15), color: C.tx2, fontFamily: F.mono, flexShrink: 0 }}>
                          {fmtNum(chartData.catW[i][1], lang) + weightUnit}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {/* Top brands */}
            {ci.brandW.length > 0 && (
              <Card title={(t ? t("stat_chart_brands") : "Top marques · poids actif") + ` (${weightUnit})`} accent={C.brass}>
                {bars(ci.brandW, chartWidth())}
              </Card>
            )}

            {/* Ratings distribution */}
            {ci.ratings.some(r => r.value > 0) && (
              <Card title={t ? t("stat_chart_ratings") : "Distribution des notes"} accent={C.brassHi}>
                {vBars(ci.ratings, chartWidth(), 90)}
              </Card>
            )}

            {/* Aging sweet-spot — rating vs. tobacco age. Display-only
                (age bands don't map to a journal filter). Needs 3+
                rated sessions on 2+ age bands to draw the curve. The
                Card is ALWAYS shown so the feature is discoverable — when the
                data isn't ready it explains exactly what's missing (and how
                many sessions are usable) instead of vanishing. */}
            <Card title={t ? t("stat_aging_title") : "Note par âge du tabac"} accent={C.brass}>
              <div style={{ fontSize: fs(13.5), color: C.tx3, marginBottom: 10, lineHeight: 1.45 }}>
                {t ? t("stat_aging_hint") : "Note moyenne selon l'âge du tabac au moment où vous l'avez fumé — votre courbe de vieillissement personnelle."}
              </div>
              {/* Per-family filter. Families age very differently, so
                  a global curve mixes contradictory behaviours — narrow to one
                  tobacco family. Shown only when 2+ families appear in the
                  journal (a single family makes the filter pointless). */}
              {agingCats.length >= 2 && (
                <div style={{ marginBottom: 10 }}>
                  <ScrollableChipRow fadeColor={CARD_BG} pad="0 0 6px" gap={6}>
                    <FilterChipSimple on={agingCat === ""} label={t ? t("f_all") : "Tous"}
                      onClick={() => setAgingCat("")} accent={C.brass} />
                    {agingCats.map((c) => (
                      <FilterChipSimple key={c} on={agingCat === c}
                        label={xl ? xl(c, CATS_EN) : c}
                        onClick={() => setAgingCat(c)} accent={C.brass} />
                    ))}
                  </ScrollableChipRow>
                </div>
              )}
              {aging.ready ? (
                <>
                  {bars(aging.items, chartWidth())}
                  {aging.peakLabel && (
                    <div style={{
                      marginTop: 12, fontSize: fs(15), color: C.brassHi,
                      fontFamily: F.body, display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <span>★</span>
                      <span>{String(t ? t("stat_aging_peak") : "Meilleur vers {age}").replace("{age}", aging.peakLabel)}
                        {" · " + String(aging.peakAvg) + "★"}</span>
                    </div>
                  )}
                </>
              ) : (
                <div style={{
                  fontSize: fs(14.5), color: C.tx2, lineHeight: 1.5,
                  padding: "10px 12px", background: C.bg,
                  border: `1px solid ${C.rule}`, borderRadius: 8,
                }}>
                  {String(t ? t("stat_aging_empty") : "Il faut au moins 3 séances sur des lots datés (production ou achat), réparties sur 2 tranches d'âge. La note vient de la séance, ou à défaut du tabac. Actuellement : {usable} séance(s) exploitable(s).")
                    .replace("{usable}", String(aging.total))}
                </div>
              )}
            </Card>

            {/* Aroma profile — the aroma wheel aggregated across
                all sessions. Always shown (like the aging card) with an
                empty state so the feature is discoverable. */}
            <Card title={t ? t("aroma_profile_title") : "Profil aromatique"} accent={C.sage}>
              <div style={{ fontSize: fs(13.5), color: C.tx3, marginBottom: 10, lineHeight: 1.45 }}>
                {t ? t("aroma_profile_hint") : "Vos arômes les plus notés, toutes séances confondues."}
              </div>
              {/* Per-family filter, mirroring the aging curve. Shown
                  only when 2+ families have aroma-tagged sessions. */}
              {aromaCats.length >= 2 && (
                <div style={{ marginBottom: 10 }}>
                  <ScrollableChipRow fadeColor={CARD_BG} pad="0 0 6px" gap={6}>
                    <FilterChipSimple on={aromaCat === ""} label={t ? t("f_all") : "Tous"}
                      onClick={() => setAromaCat("")} accent={C.sage} />
                    {aromaCats.map((c) => (
                      <FilterChipSimple key={c} on={aromaCat === c}
                        label={xl ? xl(c, CATS_EN) : c}
                        onClick={() => setAromaCat(c)} accent={C.sage} />
                    ))}
                  </ScrollableChipRow>
                </div>
              )}
              {aromaProfile.items.length > 0 ? (
                bars(aromaProfile.items, chartWidth())
              ) : (
                <div style={{
                  fontSize: fs(14.5), color: C.tx2, lineHeight: 1.5,
                  padding: "10px 12px", background: C.bg,
                  border: `1px solid ${C.rule}`, borderRadius: 8,
                }}>
                  {t ? t("aroma_profile_empty") : "Ajoutez des arômes à vos séances pour dessiner votre profil gustatif."}
                  {/* The copy is an imperative — "add aromas to your
                      sessions" — and the sessions are on a different page. This
                      card is deliberately kept VISIBLE when empty so the feature
                      is discoverable (see the comment on the aging card above);
                      discoverable and unreachable is half a job.

                      navToJournalFiltered("") rather than a bare nav: it records
                      the Stats origin, so system-back comes back HERE. A plain
                      nav would fall through to Home — the defect that had to be
                      fixed across every other Stats drill. */}
                  <div style={{ marginTop: 10 }}>
                    <PressCard onClick={() => navToJournalFiltered && navToJournalFiltered("")} style={{
                      display: "inline-flex", padding: "7px 13px",
                      background: alpha(C.sage, "22"), border: `1px solid ${alpha(C.sage, "66")}`,
                      borderRadius: 8, color: C.sage,
                      fontFamily: F.mono, fontSize: fs(13), letterSpacing: 1.1,
                      textTransform: "uppercase", fontWeight: 700,
                    }}>{t ? t("btn_see_journal") : "Voir le journal"}</PressCard>
                  </div>
                </div>
              )}
            </Card>

            {/* Pipe shapes */}
            {ci.pShapes.length > 0 && (
              <Card title={t ? t("stat_chart_shapes") : "Pipes par forme"} accent={C.oxbloodHi}>
                {bars(ci.pShapes, chartWidth())}
              </Card>
            )}

            {/* Bowl + Stem materials */}
            {(ci.pBowl.length > 0 || ci.pStem.length > 0) && (
              <div style={{
                display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
                gap: 10, margin: "0 12px 16px",
              }}>
                {ci.pBowl.length > 0 && (
                  <MiniCard title={t ? t("stat_chart_bowl") : "Matière du foyer"} accent={C.sage}>
                    {bars(ci.pBowl, Math.max(60, Math.floor((typeof window !== "undefined" ? window.innerWidth : 480) / 2) - 44))}
                  </MiniCard>
                )}
                {ci.pStem.length > 0 && (
                  <MiniCard title={t ? t("stat_chart_stem") : "Matière du bec"} accent={C.brassHi}>
                    {bars(ci.pStem, Math.max(60, Math.floor((typeof window !== "undefined" ? window.innerWidth : 480) / 2) - 44))}
                  </MiniCard>
                )}
              </div>
            )}

            {/* Avg session duration. Clickable → opens the journal
                (all sessions — it's a session stat). Records the Stats origin. */}
            {chartData.avgSessionDuration > 0 && (
              <Card title={t ? t("stat_avg_duration") : "Durée moyenne par séance"} accent={C.brassHi}>
                <button type="button"
                  onClick={() => navToJournalFiltered && navToJournalFiltered("")}
                  aria-label={t ? t("stat_sessions") : "Séances"}
                  style={{
                    display: "flex", alignItems: "center", gap: 14, width: "100%",
                    background: "transparent", border: "none", padding: 0,
                    cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left",
                  }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 14,
                    background: `linear-gradient(135deg, ${alpha(C.brass, "22")}, ${alpha(C.brass, "11")})`,
                    border: `1px solid ${alpha(C.brass, "44")}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: C.brassHi, flexShrink: 0,
                  }}>
                    <Ico name="clock" size={26} sw={1.5} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: F.display, fontSize: fs(34), color: C.ivory,
                      lineHeight: 1, fontStyle: "italic", letterSpacing: -1,
                    }}>
                      {chartData.avgSessionDuration}
                      <span style={{ fontSize: fs(17), color: C.tx2, fontStyle: "normal", marginLeft: 4 }}>
                        {t ? t("min_short") : "min"}
                      </span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: fs(15), color: C.tx3 }}>
                      {chartData.totalSessions + " " + String(t ? t("stat_sessions") : "Séances").toLowerCase()}
                    </div>
                  </div>
                </button>
              </Card>
            )}

            {/* Taste profile. Clickable → the owned tobaccos this
                profile is derived from (active inventory). Records the Stats
                origin so system-back returns to Stats. */}
            {chartData.tasteProfile && (
              <Card title={t ? t("stat_taste_profile") : "Profil gustatif"} accent={C.oxbloodHi}>
                <button type="button"
                  onClick={() => navToInvFiltered && navToInvFiltered("", "")}
                  aria-label={t ? t("nav_tobaccos") : "Tabacs"}
                  style={{
                    display: "block", width: "100%", background: "transparent",
                    border: "none", padding: 0, cursor: "pointer",
                    color: "inherit", font: "inherit", textAlign: "left",
                  }}>
                  <div style={{ fontSize: fs(14.5), color: C.tx3, marginBottom: 10, fontFamily: F.body }}>
                    {/* count can be exactly 1 (stats.ts gates on
                        `tpRated.length > 0`), and every dictionary hardcoded
                        the plural noun — "Moyenne sur 1 tabacs notés ≥4". */}
                    {String(t ? t("stat_taste_profile_hint") : "Moyenne sur {n} {s} notés ≥4 — ton style préféré.")
                      .replace("{n}", String(chartData.tasteProfile.count))
                      .replace("{s}", plural(chartData.tasteProfile.count,
                        t ? t("lbl_tobacco_word") : "tabac",
                        t ? t("lbl_tobaccos_word") : "tabacs", lang))}
                  </div>
                  {[
                    [t ? t("lbl_force") : "Force",         chartData.tasteProfile.force,    C.oxbloodHi],
                    [t ? t("lbl_room_note") : "Room Note", chartData.tasteProfile.roomNote, C.sageHi],
                    [t ? t("lbl_taste") : "Goût",          chartData.tasteProfile.taste,    C.brassHi],
                  ].map(([lbl, val, col]: any) => (
                    <div key={lbl} style={{
                      display: "flex", alignItems: "center", gap: 10, marginBottom: 6,
                    }}>
                      <div style={{
                        fontFamily: F.mono, fontSize: fs(11.5), color: C.tx2,
                        letterSpacing: 1.4, textTransform: "uppercase",
                        width: 90, flexShrink: 0,
                      }}>{lbl}</div>
                      <div style={{ flex: 1 }}>
                        <Stars n={Math.round(val)} size={12} color={col} />
                      </div>
                      <div style={{
                        fontFamily: F.display, fontStyle: "italic", fontSize: fs(20),
                        color: col, minWidth: 36, textAlign: "right",
                      }}>{Number(val).toFixed(1)}</div>
                    </div>
                  ))}
                </button>
              </Card>
            )}

            {/* Calendar heatmap */}
            {Object.keys(chartData.calByDay || {}).length > 0 && (
              <Card title={t ? t("stat_calendar_heatmap") : "Calendrier de fumage (12 derniers mois)"} accent={C.brass}>
                <div ref={calScrollRef} data-hscroll="" style={{ overflowX: "auto", marginBottom: 6 }}>
                  {calendarHeatmap(
                    chartData.calByDay,
                    null,
                    { months: monthsShort(lang), days: heatmapDayInitials(lang) },
                    (date: string, count: number) => setCalSel({ date, count }),
                    {
                      // Amber ramp matching the Home activity
                      // calendar; oxblood kept for the 4+/day "attention"
                      // level so a heavy day still reads as a warning.
                      empty: C.bg,
                      low:   alpha(C.amber, "55"),
                      mid:   C.amberHi,
                      high:  C.oxbloodHi,
                    },
                  )}
                </div>
                <div style={{
                  fontSize: fs(15), color: calSel ? C.ivory : C.tx2,
                  minHeight: 16, fontFamily: F.body,
                  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                }}>
                  {calSel ? (() => {
                    // Route through fmtDate so the heatmap day
                    // selection honours the user's date-format preference
                    // (was hardcoded toLocaleDateString on `lang`).
                    const dn = fmtDate(calSel.date, dateFormat);
                    const ses = calSel.count === 1
                      ? (t ? t("lbl_session_word") : "séance")
                      : (t ? t("lbl_sessions_word") : "séances");
                    const txt = `${dn} · ${calSel.count} ${ses}`;
                    if (calSel.count > 0 && navToJournalFilteredByDate) {
                      // Clickable info line — opens the journal
                      // pre-filtered on this exact date. Visually the line
                      // gets the same hover treatment as the other Stats
                      // click-thrus (label brightens on hover, arrow hint).
                      return (
                        <button type="button"
                          onClick={() => navToJournalFilteredByDate(calSel.date)}
                          style={{
                            background: "transparent", border: "none", padding: 0,
                            color: C.ivory, fontFamily: F.body, fontSize: fs(15),
                            cursor: "pointer", display: "inline-flex",
                            alignItems: "center", gap: 6, textAlign: "left",
                          }}
                          // Kept inline — interpolation around a date.
                          aria-label={t
                            ? String(t("aria_journal_filter_date")).replace("{d}", dn)
                            : `Ouvrir le journal filtré sur ${dn}`}>
                          {txt}
                          <span style={{ color: C.sage, fontWeight: 700 }}>→</span>
                        </button>
                      );
                    }
                    return txt;
                  })() : (t ? t("hint_heatmap_tap") : "Touche une case pour voir le détail")}
                </div>
              </Card>
            )}

            {/* Session location — commune + country (counts),
                placed under the smoking calendar (it's session-derived).
                Tap a bar → journal filtered on that commune / country. */}
            {(ci.locCommunes.length > 0 || ci.locCountries.length > 0) && (
              <div style={{
                display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
                gap: 10, margin: "0 12px 16px",
              }}>
                {ci.locCommunes.length > 0 && (
                  <MiniCard title={t ? t("stat_chart_commune") : "Communes"} accent={C.sage}>
                    {bars(ci.locCommunes, Math.max(60, Math.floor((typeof window !== "undefined" ? window.innerWidth : 480) / 2) - 44))}
                  </MiniCard>
                )}
                {ci.locCountries.length > 0 && (
                  <MiniCard title={t ? t("stat_chart_country") : "Pays"} accent={C.brassHi}>
                    {bars(ci.locCountries, Math.max(60, Math.floor((typeof window !== "undefined" ? window.innerWidth : 480) / 2) - 44))}
                  </MiniCard>
                )}
              </div>
            )}

            {/* Monthly duration */}
            {ci.monthlyDur.length > 0 && (
              <Card title={t ? t("stat_chart_session_month") : "Durée séances par mois (h)"} accent={C.brassHi}>
                {bars(ci.monthlyDur, chartWidth())}
              </Card>
            )}

            {/* Monthly weight */}
            {ci.monthlyWeight.length > 0 && (
              <Card title={(t ? t("stat_chart_month_weight") : "Tabac fumé par mois") + ` (${weightUnit})`} accent={C.sage}>
                {bars(ci.monthlyWeight, chartWidth())}
              </Card>
            )}

            {/* Yearly duration */}
            {ci.yearlyDur.length > 0 && (
              <Card title={t ? t("stat_chart_session_year") : "Durée séances par année (h)"} accent={C.brassHi}>
                {bars(ci.yearlyDur, chartWidth())}
              </Card>
            )}

            {/* Yearly weight */}
            {ci.yearlyWeight.length > 0 && (
              <Card title={(t ? t("stat_chart_year_weight") : "Tabac fumé par année") + ` (${weightUnit})`} accent={C.sage}>
                {bars(ci.yearlyWeight, chartWidth())}
              </Card>
            )}

            {/* Spending, split per kind —
                two headline totals + per-kind breakdown + monthly
                histogram (tobacco lots, full ISO dates) + one yearly
                histogram per kind. */}
            {(spend.raw.totalAllTime > 0) && (
              <Card title={(t ? t("stat_chart_spending") : "Dépenses") + ` (${currencySymbol})`} accent={C.amber}>
                <div style={{
                  display: "flex", gap: 18, flexWrap: "wrap",
                  padding: "2px 0 6px",
                  fontFamily: F.mono, fontSize: fs(14.5), color: C.tx2,
                }}>
                  <span>
                    {t ? t("lbl_spend_total") : "Total"}{" : "}
                    <span style={{ color: C.amber, fontWeight: 700 }}>
                      {fmtNum(spend.raw.totalAllTime, lang)} {currencySymbol}
                    </span>
                  </span>
                  <span>
                    {t ? t("lbl_spend_this_year") : "Cette année"}{" : "}
                    <span style={{ color: C.amber, fontWeight: 700 }}>
                      {fmtNum(spend.raw.totalThisYear, lang)} {currencySymbol}
                    </span>
                  </span>
                </div>
                {/* Per-kind breakdown chips */}
                <div style={{
                  display: "flex", gap: 14, flexWrap: "wrap",
                  padding: "0 0 10px",
                  fontFamily: F.mono, fontSize: fs(13.5), color: C.tx3,
                }}>
                  {spend.raw.totalTobacco > 0 && (
                    <span>
                      {t ? t("nav_tobaccos") : "Tabacs"}{" "}
                      <span style={{ color: C.amber }}>{fmtNum(spend.raw.totalTobacco, lang)} {currencySymbol}</span>
                    </span>
                  )}
                  {spend.raw.totalPipes > 0 && (
                    <span>
                      {t ? t("stat_pipes_word") : "Pipes"}{" "}
                      <span style={{ color: C.oxbloodHi }}>{fmtNum(spend.raw.totalPipes, lang)} {currencySymbol}</span>
                    </span>
                  )}
                  {spend.raw.totalAccessories > 0 && (
                    <span>
                      {t ? t("nav_acc") : "Accessoires"}{" "}
                      <span style={{ color: C.ember }}>{fmtNum(spend.raw.totalAccessories, lang)} {currencySymbol}</span>
                    </span>
                  )}
                </div>
                {spend.monthly.length > 0 && (
                  <>
                    <Lbl color={C.tx3} size={10}>{t ? t("lbl_spend_monthly") : "Par mois (tabacs, 12 derniers mois)"}</Lbl>
                    <div style={{ marginTop: 6 }}>{bars(spend.monthly, chartWidth())}</div>
                  </>
                )}
                {spend.yearlyTobacco.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Lbl color={C.tx3} size={10}>{t ? t("lbl_spend_yearly_tobacco") : "Tabacs par année"}</Lbl>
                    <div style={{ marginTop: 6 }}>{bars(spend.yearlyTobacco, chartWidth())}</div>
                  </div>
                )}
                {spend.yearlyPipes.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Lbl color={C.tx3} size={10}>{t ? t("lbl_spend_yearly_pipes") : "Pipes par année"}</Lbl>
                    <div style={{ marginTop: 6 }}>{bars(spend.yearlyPipes, chartWidth())}</div>
                  </div>
                )}
                {spend.yearlyAccessories.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Lbl color={C.tx3} size={10}>{t ? t("lbl_spend_yearly_acc") : "Accessoires par année"}</Lbl>
                    <div style={{ marginTop: 6 }}>{bars(spend.yearlyAccessories, chartWidth())}</div>
                  </div>
                )}
              </Card>
            )}

            {/* Cost per session — the real per-bowl cost of each
                blend (spent on its lots ÷ its sessions). Global headline +
                a clickable ranking. Shown only once at least one blend has
                both a priced lot and a session. */}
            {cps.raw.items.length > 0 && (
              <Card title={(t ? t("stat_cps_title") : "Coût par séance") + ` (${currencySymbol})`} accent={C.sage}>
                {cps.raw.globalSessions > 0 && (
                  <div style={{
                    display: "flex", gap: 18, flexWrap: "wrap",
                    padding: "2px 0 10px",
                    fontFamily: F.mono, fontSize: fs(14.5), color: C.tx2,
                  }}>
                    <span>
                      {t ? t("stat_cps_global") : "Moyenne générale"}{" : "}
                      <span style={{ color: C.sage, fontWeight: 700 }}>
                        {fmtNum(cps.raw.globalCostPerSession, lang)} {currencySymbol}
                      </span>
                    </span>
                  </div>
                )}
                {bars(cps.bars, chartWidth())}
              </Card>
            )}

            {/* Top tobaccos */}
            {ci.topTobaccos.length > 0 && (
              <Card title={(t ? t("stat_chart_top_tobaccos") : "Top tabacs fumés") + ` (${weightUnit})`} accent={C.brass}>
                {bars(ci.topTobaccos, chartWidth())}
              </Card>
            )}

            {/* Top pipes */}
            {ci.topPipes.length > 0 && (
              <Card title={t ? t("stat_chart_top_pipes") : "Top pipes utilisées"} accent={C.oxbloodHi}>
                {bars(ci.topPipes, chartWidth())}
              </Card>
            )}

          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Curator-styled card wrapper
// ─────────────────────────────────────────────────────────────
function Card({
  title, accent = C.brass, children,
}: { title: string; accent?: string; children: React.ReactNode }) {
  const e = useEnter(0, { duration: 420 });
  return (
    <div style={{
      margin: "0 12px 14px",
      background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 10,
      overflow: "hidden", boxShadow: CARD_SHADOW, ...e,
    }}>
      <div style={{
        padding: "12px 14px 8px",
        borderBottom: `1px solid ${C.rule}`,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{
          width: 4, height: 14, background: accent, borderRadius: 1,
          boxShadow: `0 0 8px ${alpha(accent, "66")}`,
        }} />
        <span style={{
          fontFamily: F.display, fontSize: fs(18), color: C.ivory,
          fontStyle: "italic", letterSpacing: -0.2,
        }}>{title}</span>
      </div>
      <div style={{ padding: "12px 14px" }}>{children}</div>
    </div>
  );
}

function MiniCard({
  title, accent = C.brass, children,
}: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
      padding: "10px 12px", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ width: 3, height: 10, background: accent, borderRadius: 1 }} />
        <Lbl color={accent} size={9.5}>{title}</Lbl>
      </div>
      {children}
    </div>
  );
}
