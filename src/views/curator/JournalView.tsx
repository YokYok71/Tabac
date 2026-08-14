// Curator JournalView — full feature parity (sort, group, expand).

import { useEffect, useMemo, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { safeBgUrl } from "../../utils/imgCache.ts";
import { alpha, fs, C, F, catColor, CARD_BG, CARD_ACCENTS, CARD_SHADOW } from "../../theme-curator.ts";
import { fmtDate, fmtNum, sessionEntityLabel, today, compareSessionsRecent } from "../../utils.ts";
import { CATS_EN, SHAPES_EN, monthsShort } from "../../constants.ts";
import { isValidCoords, osmEmbedUrl, osmLinkUrl, formatCoords, joinPlaceParts, countryNameToIso2 } from "../../utils/geo.ts";
import { sanitizeAromas, aromaLabelKey } from "../../utils/aromas.ts";
import { useFocusRing } from "../../components/curator/FormFields.tsx";
import {
  AnimNum, Stars, Lbl, IconBtn, PressCard, ScreenWash, TopBar,
  PageTitle, SectionHead, StatTile, useEnter, EmptyState,
} from "../../components/curator/primitives.tsx";
import { Modal, ModalHeader } from "../../components/curator/Modal.tsx";
import { ToggleBtn, ScrollableChipRow } from "../../components/curator/FilterControls.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { CuratorTrashIndicator } from "../../components/curator/TrashIndicator.tsx";
import type { Session, Tobacco, Pipe } from "../../types.ts";

// Module-level stable no-op — used as the fallback for the ctx-derived filter
// setters so the aliases keep a STABLE reference across renders (an inline
// `|| (() => {})` minted a fresh function each render, which made the
// stale-filter effect's deps churn). See the lint cleanup that introduced it.
const NOOP = () => {};

export function CuratorJournalView() {
  const ctx = useAppCtx();
  const {
    openHelp,
    view, data, t, lang, dateFormat, nav,
    setSearchOpen, weightUnit = "g",
    setSessForm, setEditSessId, BJ,
    tasting, tastingStart, tastingResume, sessDefaultWeight,
    deleteSession,
    sessGrouped, setSessGrouped,
    collapsedSessGroups, toggleSessGroup,
    expandSessCards, setExpandSessCards,
    // The three composing filters (pipe / tobacco / year)
    // moved from local useState to App.tsx state + ctx so click-thrus
    // from the Statistics page can pre-select them before navigating
    // here. See `navToJournalFiltered(...)` in App.tsx.
    journalFilterPipe = "", setJournalFilterPipe,
    journalFilterTobacco = "", setJournalFilterTobacco,
    journalFilterYear = "", setJournalFilterYear,
    // Day-precise filter wired from the StatsView heatmap
    // click. ISO date "YYYY-MM-DD". Surfaces as a dedicated chip; the
    // year filter is held empty while a date is set (the date already
    // implies the year, see navToJournalFilteredByDate in App.tsx).
    journalFilterDate = "", setJournalFilterDate,
    // Location filters wired from the StatsView "Lieux" bars.
    journalFilterCommune = "", setJournalFilterCommune,
    journalFilterCountry = "", setJournalFilterCountry,
    // The session-detail modal lifted to ctx so system-back /
    // edge-swipe closes it (goBack can't see JournalView-local state).
    sessionDetail, setSessionDetail,
    // Cross-open the tabac / pipe fiche from the session modal.
    crossOpenDetail,
  } = ctx;
  const [sortBy, setSortBy] = useState<"date" | "tobacco" | "pipe" | "duration" | "rating">("date");
  const sortRing = useFocusRing();
  // Aliases so the rest of the view doesn't need a sweeping rename
  // when these were lifted to ctx.
  const filterPipe = journalFilterPipe;
  const setFilterPipe = setJournalFilterPipe || NOOP;
  const filterTobacco = journalFilterTobacco;
  const setFilterTobacco = setJournalFilterTobacco || NOOP;
  const filterYear = journalFilterYear;
  const setFilterYear = setJournalFilterYear || NOOP;
  const pipeFilterRing = useFocusRing();
  const tobFilterRing = useFocusRing();
  const yearFilterRing = useFocusRing();
  // Two more session filters — country + locality (city).
  const countryFilterRing = useFocusRing();
  const cityFilterRing = useFocusRing();
  const setFilterCommune = setJournalFilterCommune || NOOP;
  const setFilterCountry = setJournalFilterCountry || NOOP;
  // Read-only detail modal for a single session (state lives in
  // App/ctx so system-back / edge-swipe closes it — see goBack). Aliased so the
  // rest of the view keeps its short names.
  const detailSession: Session | null = sessionDetail || null;
  const setDetailSession = setSessionDetail || (() => {});

  const tobaccos = (data?.tobaccos || []) as Tobacco[];
  const pipes = (data?.pipes || []) as Pipe[];
  const tobOf = (id: any) => tobaccos.find(x => String(x.id) === String(id));
  const pipeOf = (id: any) => pipes.find(x => String(x.id) === String(id));

  // Memoise so the array identity is stable when nothing
  // changed. The downstream useMemo(filterOptions) declared a `[allSessions]`
  // dep — a fresh slice every render used to invalidate the memo on each
  // pass for nothing.
  const allSessions = useMemo(
    () => ((data?.sessions || []) as Session[]).slice(),
    [data?.sessions],
  );

  // Derive the filter dropdown options from allSessions (NOT
  // from data.tobaccos/pipes). Only entities actually referenced by at
  // least one session show up. Use the snapshot when the live entity is
  // gone (trashed / hard-deleted) so the filter still surfaces the row.
  // Deduplicated by id, sorted alphabetically (pipes/tobaccos) or
  // reverse-chronologically (years).
  const filterOptions = useMemo(() => {
    const pipeMap = new Map<string, string>(); // id → display label
    const tobMap  = new Map<string, string>();
    const yearSet = new Set<string>();
    // Location filters. Cities keyed by their raw string; countries
    // keyed ISO-canonically (so "France"/"Frankreich"/"Francia" collapse to ONE
    // option, label = the first-seen variant) — mirrors computeLocationStats so
    // the dropdown agrees with the Stats "Pays" chart.
    // The locality (city) list is SCOPED to the selected country —
    // picking "Italie" must only offer Italian cities. Countries stay the full
    // set (the country dropdown isn't scoped by city). ISO-canonical match so a
    // country logged in another language still gates its cities.
    const cityMap    = new Map<string, string>(); // city → itself
    const countryMap = new Map<string, string>(); // isoOrRaw → display label
    const fCountryIso = journalFilterCountry ? countryNameToIso2(journalFilterCountry) : "";
    const countryMatchesFilter = (rawCountry: string) => {
      if (!journalFilterCountry) return true;
      const sc = String(rawCountry || "");
      const sIso = countryNameToIso2(sc);
      return (fCountryIso && sIso) ? fCountryIso === sIso : sc === journalFilterCountry;
    };
    for (const s of allSessions) {
      if (s.pipeId) {
        const id = String(s.pipeId);
        if (!pipeMap.has(id)) {
          pipeMap.set(id, sessionEntityLabel(pipeOf(id), s.pipeSnapshot));
        }
      }
      if (s.tobaccoId) {
        const id = String(s.tobaccoId);
        if (!tobMap.has(id)) {
          tobMap.set(id, sessionEntityLabel(tobOf(id), s.tobaccoSnapshot));
        }
      }
      if (s.date && s.date.length >= 4) yearSet.add(s.date.slice(0, 4));
      const country = String(s.locationCountry || "").trim();
      const city = String(s.locationCity || "").trim();
      // Only surface this session's city when it belongs to the selected
      // country (or no country filter is active).
      if (city && countryMatchesFilter(country) && !cityMap.has(city)) cityMap.set(city, city);
      if (country) {
        const iso = countryNameToIso2(country);
        const key = iso || country.toLowerCase();
        if (!countryMap.has(key)) countryMap.set(key, country);
      }
    }
    const cmp = (a: [string, string], b: [string, string]) => String(a[1]).localeCompare(String(b[1]));
    const cmpStr = (a: string, b: string) => String(a).localeCompare(String(b));
    return {
      pipes:    Array.from(pipeMap.entries()).sort(cmp),
      tobaccos: Array.from(tobMap.entries()).sort(cmp),
      years:    Array.from(yearSet).sort().reverse(),
      cities:    Array.from(cityMap.values()).sort(cmpStr),
      countries: Array.from(countryMap.values()).sort(cmpStr),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSessions, tobaccos, pipes, journalFilterCountry]);

  // Clear stale filters when their target option disappears (entity
  // removed, last session of a year deleted, etc.) — otherwise the
  // dropdown shows the placeholder while the underlying state still
  // narrows the list, producing a confusing empty journal.
  useEffect(() => {
    if (filterPipe && !filterOptions.pipes.some(([id]) => id === filterPipe)) setFilterPipe("");
    if (filterTobacco && !filterOptions.tobaccos.some(([id]) => id === filterTobacco)) setFilterTobacco("");
    if (filterYear && !filterOptions.years.includes(filterYear)) setFilterYear("");
    // Same stale-clear for the location filters (last session at a
    // place deleted → drop the now-empty filter). City is exact; country is
    // ISO-canonical so a Stats-set variant still matches its option.
    if (journalFilterCommune && !filterOptions.cities.includes(journalFilterCommune)) setFilterCommune("");
    if (journalFilterCountry) {
      const fIso = countryNameToIso2(journalFilterCountry);
      const present = filterOptions.countries.some((c) => {
        const cIso = countryNameToIso2(c);
        return (fIso && cIso) ? fIso === cIso : c === journalFilterCountry;
      });
      if (!present) setFilterCountry("");
    }
  }, [filterOptions, filterPipe, filterTobacco, filterYear, setFilterPipe, setFilterTobacco, setFilterYear,
      journalFilterCommune, journalFilterCountry, setFilterCommune, setFilterCountry]);

  const sessions = useMemo(() => {
    const arr = allSessions.filter(s => {
      if (filterPipe && String(s.pipeId) !== filterPipe) return false;
      if (filterTobacco && String(s.tobaccoId) !== filterTobacco) return false;
      if (filterYear && !String(s.date || "").startsWith(filterYear)) return false;
      // Exact-day filter from the heatmap click-thru.
      // Compared via String(s.date) so a numeric date field can't
      // sneak through (string-coerce discipline).
      if (journalFilterDate && String(s.date || "") !== journalFilterDate) return false;
      // Location filters from the StatsView "Lieux" click-thru.
      if (journalFilterCommune && String(s.locationCity || "") !== journalFilterCommune) return false;
      // Match the country ISO-canonically so a filter set from
      // the merged Stats row (e.g. "France") also catches sessions logged in
      // another UI language ("Frankreich", "Francia"). Falls back to exact
      // string equality when either side is an unknown/exotic country.
      if (journalFilterCountry) {
        var sc = String(s.locationCountry || "");
        var fIso = countryNameToIso2(journalFilterCountry);
        var sIso = countryNameToIso2(sc);
        var countryOk = (fIso && sIso) ? fIso === sIso : sc === journalFilterCountry;
        if (!countryOk) return false;
      }
      return true;
    });
    if (sortBy === "date") {
      // Full reverse-chronological: newest ALWAYS on top. The rule and the
      // reasoning behind each of its four rungs now live on
      // `compareSessionsRecent` (utils.ts) — extracted when the
      // lot fiche needed the same order, rather than copied.
      arr.sort(compareSessionsRecent);
    } else if (sortBy === "duration") {
      arr.sort((a, b) => (parseFloat(b.duration) || 0) - (parseFloat(a.duration) || 0));
    } else if (sortBy === "rating") {
      arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === "tobacco") {
      arr.sort((a, b) => {
        const ta = tobOf(a.tobaccoId), tb = tobOf(b.tobaccoId);
        // Snapshot fallback so a trashed / hard-deleted tobacco still
        // sorts predictably instead of collapsing to the empty bucket.
        const an = ta
          ? `${ta.brand || ""} ${ta.name || ""}`
          : (a.tobaccoSnapshot
              ? `${a.tobaccoSnapshot.brand || ""} ${a.tobaccoSnapshot.name || ""}`
              : "");
        const bn = tb
          ? `${tb.brand || ""} ${tb.name || ""}`
          : (b.tobaccoSnapshot
              ? `${b.tobaccoSnapshot.brand || ""} ${b.tobaccoSnapshot.name || ""}`
              : "");
        return String(an).localeCompare(String(bn));
      });
    } else if (sortBy === "pipe") {
      // Same shape as the tobacco branch — alphabetical on
      // `brand name`, snapshot fallback for hard-deleted pipes, empty
      // pipeId rows (no pipe set on the session) bubble to the end via
      // localeCompare on "".
      arr.sort((a, b) => {
        const pa = pipeOf(a.pipeId), pb = pipeOf(b.pipeId);
        const an = pa
          ? `${pa.brand || ""} ${pa.name || ""}`
          : (a.pipeSnapshot
              ? `${a.pipeSnapshot.brand || ""} ${a.pipeSnapshot.name || ""}`
              : "");
        const bn = pb
          ? `${pb.brand || ""} ${pb.name || ""}`
          : (b.pipeSnapshot
              ? `${b.pipeSnapshot.brand || ""} ${b.pipeSnapshot.name || ""}`
              : "");
        return String(an).localeCompare(String(bn));
      });
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSessions, sortBy, filterPipe, filterTobacco, filterYear, journalFilterDate, journalFilterCommune, journalFilterCountry]);

  // Quick aggregate kept for the sub-title (sessions count + hours
  // logged). thisMonth / avgRating / rated aggregates and
  // the StatCard row they fed were removed — the row was visually
  // out-of-step with the rest of the app and ate vertical space.
  const totalHours = Math.round(
    sessions.reduce((sum, s) => sum + (parseFloat(s.duration) || 0), 0) / 60
  );

  // Grouped by year → month (2 levels).
  const grouped = useMemo(() => {
    if (!sessGrouped) return null;
    // Object.create(null) at both nesting levels. `year`
    // and `ym` come from `s.date.slice(...)`. In normal flow date is
    // an ISO string from a date input, but a forged import could
    // smuggle `date: "constructor-01-01"` and pollute the lookup.
    const byYear: Record<string, Record<string, Session[]>> = Object.create(null);
    sessions.forEach(s => {
      const date = s.date || "";
      const year = date.slice(0, 4) || (t ? t("journal_undated") : "Sans date");
      const ym = date.slice(0, 7) || year;
      if (!byYear[year]) byYear[year] = Object.create(null);
      (byYear[year]![ym] = byYear[year]![ym] || []).push(s);
    });
    // Namespace collapse keys (`y:YEAR`, `m:YEAR-MM`) so a "Sans date" year and
    // a "Sans date" month don't share the same collapsed-state slot.
    return Object.keys(byYear)
      .sort()
      .reverse()
      .map(year => {
        // Strict-TS narrowing. `byYear[year]` is provably set
        // (we just iterated `Object.keys(byYear)`) but TS sees it as
        // `Record<…> | undefined`. Capture into a local with `|| {}`
        // fallback once.
        const months = byYear[year] || {};
        return {
          year,
          yearKey: "y:" + year,
          months: Object.keys(months)
            .sort()
            .reverse()
            .map(ym => ({ name: ym, monthKey: "m:" + ym, items: months[ym] || [] })),
          total: Object.values(months).reduce((s, arr) => s + arr.length, 0),
        };
      });
    // `t` is used only for the undated-year fallback label; it's re-created
    // every render (a function declaration in App.tsx), so listing it would
    // recompute this memo on every render and defeat it. `lang` is the real
    // signal — it changes exactly when the translated label would.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, sessGrouped, lang]);

  if (view !== "journal") return null;

  const onEditSession = (s: Session) => {
    if (setSessForm && BJ && setEditSessId && nav) {
      setSessForm(Object.assign({}, BJ, s));
      setEditSessId(s.id);
      nav("editJ");
    }
  };
  const onDeleteSession = (s: Session) => {
    // No confirm — soft-delete into Trash + 8 s undo toast.
    if (deleteSession) deleteSession(s.id);
  };

  // Hoisted out of the JSX so the empty state and its reset button
  // read the SAME expression — they were two copies of a six-term disjunction.
  const journalFiltered = !!(
    filterPipe || filterTobacco || filterYear
    || journalFilterDate || journalFilterCommune || journalFilterCountry
  );
  const resetJournalFilters = () => {
    setFilterPipe("");
    setFilterTobacco("");
    setFilterYear("");
    setJournalFilterDate && setJournalFilterDate("");
    setJournalFilterCommune && setJournalFilterCommune("");
    setJournalFilterCountry && setJournalFilterCountry("");
  };

  // ONE seed for the two doors into the session form.
  // `nav("addJ")` alone lands on `BJ`, whose `date` is "", and
  // `SessionFormView`'s `canSave` requires a date — so the empty-state
  // CTA opened a form with a permanently greyed Save button and nothing on
  // screen saying why, for the only audience that empty state has. The `+`
  // button had always seeded date/time/weight; the CTA was written beside it
  // and did not. That is precisely the drift `emptyStateWayForward.test.tsx`
  // was written to prevent for the tasting CTA in the SAME change — the rule
  // applied one component over and missed here, which is the argument for a
  // shared function rather than a second correct copy.
  const openNewSession = () => {
    if (setSessForm && BJ) {
      // LOCAL date, so an evening entry in the Americas does not
      // default to tomorrow (UTC). v1.3: the local start time too.
      const _n = new Date();
      const nowTime = String(_n.getHours()).padStart(2, "0") + ":" + String(_n.getMinutes()).padStart(2, "0");
      setSessForm(Object.assign({}, BJ, {
        date: today(), time: nowTime,
        weightG: sessDefaultWeight || (weightUnit === "oz" ? "0.1" : "3"),
      }));
    }
    nav && nav("addJ");
  };

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ paddingBottom: 130 }}>

        <TopBar
          leading={<IconBtn icon="book" ariaLabel={t("aria_journal")} color={C.sage} />}
          title={t ? t("ttl_session_log") : "Carnet de séances"}
          trailing={<>
            <IconBtn icon="help" onClick={() => openHelp && openHelp("journal")} ariaLabel={t ? t("aria_help_page") : "Aide sur cette page"} />
            <CuratorTrashIndicator />
            <IconBtn icon="search" onClick={() => setSearchOpen && setSearchOpen(true)} ariaLabel={t ? t("btn_search") : "Rechercher"} />
            <IconBtn icon="flame"
              onClick={() => {
                const running = tasting && tasting.stage === "running";
                if (running) tastingResume && tastingResume();
                else if (tastingStart) {
                  tastingStart({ tobaccoId: "", pipeId: "", lotId: "", weightG: sessDefaultWeight || (weightUnit === "oz" ? "0.1" : "3") });
                }
              }}
              bg={C.ember} color={C.bg} border={false} glow={C.ember}
              ariaLabel={tasting && tasting.stage === "running"
                ? t("aria_resume_tasting")
                : t("tasting_title")}
              style={{ borderRadius: 10 }} />
            <IconBtn icon="plus" onClick={openNewSession}
              bg={C.sage} color={C.bg} border={false} glow={C.sage}
              ariaLabel={t("btn_new_session")} style={{ borderRadius: 10 }} />
          </>}
        />

        <PageTitle>
          {t("journal_title_prefix")} <span style={{ fontStyle: "italic", color: C.sage }}>{t("journal_title_word")}</span>
        </PageTitle>

        <div style={{ padding: "0 12px 14px", marginTop: -8, fontSize: fs(15), color: C.tx2 }}>
          <span style={{ fontFamily: F.mono, color: C.sageHi }}>
            <AnimNum value={sessions.length} delay={150} />
          </span> {t("lbl_sessions_word")} ·{" "}
          <span style={{ fontFamily: F.mono, color: C.sageHi }}>
            <AnimNum value={totalHours} delay={300} />h
          </span> {t("lbl_logged")}
        </div>

        {/* Sort + view toggles */}
        {/* `flexWrap` — the status chips carry a min-content floor (their labels are nowrap) and the toggles are `flex: 0 0 44px`, so in German at the "L" text size this row pushed the PAGE 20px past 360. The tobacco list met the same arithmetic and answered it with `minWidth: 0` on a wrapper this row does not have; wrapping costs a line only in the languages where it does not fit, and clips nothing. */}
        <div style={{ padding: "0 12px 14px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 8,
            minHeight: 44, padding: "0 12px",
            background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
          }}>
            <Lbl color={C.tx2} size={9.5}>{t("lbl_sort")}</Lbl>
            <select
              value={sortBy}
              aria-label={t("lbl_sort_by")}
              onChange={(e) => setSortBy(e.target.value as any)}
              onFocus={sortRing.onFocus}
              onBlur={sortRing.onBlur}
              style={{
                flex: 1, minWidth: 0,
                // See the filter selects — stretch so the whole
                // visible control is live.
                alignSelf: "stretch",
                background: "transparent", color: C.ivory,
                border: "none", outline: "none",
                fontFamily: F.body, fontSize: fs(15), appearance: "none",
                borderRadius: 4, transition: "box-shadow 200ms",
                ...(sortRing.focused ? { boxShadow: `0 0 0 2px ${alpha(C.brassHi, "88")}` } : {}),
              }}>
              <option value="date">{t("sort_date")}</option>
              <option value="tobacco">{t("sort_tobacco")}</option>
              <option value="pipe">{t("sort_pipe")}</option>
              <option value="duration">{t("sort_duration")}</option>
              <option value="rating">{t("lbl_rating_lbl")}</option>
            </select>
          </div>
          <ToggleBtn on={!!sessGrouped} icon="more"
            onClick={() => setSessGrouped && setSessGrouped((v: any) => !v)}
            ariaLabel={t("aria_group_by_month")}
            accent={C.sageHi} accentBase={C.sage} />
          <ToggleBtn on={!!expandSessCards} icon="sliders"
            onClick={() => setExpandSessCards && setExpandSessCards((v: any) => !v)}
            ariaLabel={t("aria_expanded_view")}
            accent={C.sageHi} accentBase={C.sage} />
        </div>

        {/* Dedicated chip when the user lands here from
            the StatsView heatmap (a precise day). Stands above the
            three regular filter dropdowns so it's clearly the
            narrowest filter; tapping the × clears just the date and
            falls back to the (currently empty) year filter. */}
        {journalFilterDate && (
          <div style={{ padding: "0 12px 8px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Lbl color={C.sageHi}>{t("lbl_date_colon")}</Lbl>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "3px 8px 3px 10px", borderRadius: 999,
              background: alpha(C.sage, "22"), border: `1px solid ${alpha(C.sage, "55")}`,
              color: C.sageHi, fontFamily: F.mono, fontSize: fs(13.5),
            }}>
              {fmtDate(journalFilterDate, dateFormat)}
              <button type="button"
                onClick={() => setJournalFilterDate && setJournalFilterDate("")}
                aria-label={t("aria_clear_date_filter")}
                style={{
                  background: "transparent", border: "none", color: C.sageHi,
                  fontSize: fs(16), lineHeight: 1, cursor: "pointer",
                  // Review fix (a11y): ≥28px tap target (was 18) — matches the
                  // shared ActiveFilterPill clear button minimum.
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  minWidth: 28, minHeight: 28, padding: 0, margin: "-4px -6px -4px 0",
                }}>×</button>
            </span>
          </div>
        )}

        {/* Location filter chips (commune / country) wired from
            the StatsView "Lieux" bars. Same chip shape as the date filter. */}
        {(journalFilterCommune || journalFilterCountry) && (
          <div style={{ padding: "0 12px 8px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Lbl color={C.sageHi}>📍</Lbl>
            {[
              { v: journalFilterCommune, clear: setJournalFilterCommune },
              { v: journalFilterCountry, clear: setJournalFilterCountry },
            ].filter(c => c.v).map((c, i) => (
              <span key={i} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "3px 8px 3px 10px", borderRadius: 999,
                background: alpha(C.sage, "22"), border: `1px solid ${alpha(C.sage, "55")}`,
                color: C.sageHi, fontFamily: F.mono, fontSize: fs(13.5),
              }}>
                {c.v}
                <button type="button"
                  onClick={() => c.clear && c.clear("")}
                  aria-label={t("aria_clear_location_filter")}
                  style={{
                    background: "transparent", border: "none", color: C.sageHi,
                    fontSize: fs(16), lineHeight: 1, cursor: "pointer",
                    // Review fix (a11y): ≥28px tap target (was 18).
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    minWidth: 28, minHeight: 28, padding: 0, margin: "-4px -6px -4px 0",
                  }}>×</button>
              </span>
            ))}
          </div>
        )}

        {/* Three composing filters (pipe / tabac / year).
            Pipe and tobacco lists only contain entities used in at least
            one session — never an option that yields zero hits. Year
            covers every year that has at least one dated session. AND
            semantics: pick all three to narrow precisely. Hidden when
            the journal has no sessions at all. */}
        {allSessions.length > 0 && (() => {
          const selStyle = (ring: ReturnType<typeof useFocusRing>) => ({
            flex: 1, minWidth: 0,
            // Stretch to the wrapper's full height — see the
            // wrapper below. The control looked 36 px tall and only its middle
            // 18 px opened the list.
            alignSelf: "stretch" as const,
            background: "transparent", color: C.ivory,
            border: "none", outline: "none",
            fontFamily: F.body, fontSize: fs(14.5), appearance: "none" as const,
            borderRadius: 4, transition: "box-shadow 200ms",
            ...(ring.focused ? { boxShadow: `0 0 0 2px ${alpha(C.sageHi, "88")}` } : {}),
          });
          const wrapStyle = {
            display: "flex", alignItems: "center", gap: 6,
            // 44 is this project's own target-size invariant, and
            // the vertical padding moved onto the select so the WHOLE box is
            // live rather than just its middle third.
            minHeight: 44,
            padding: "0 10px",
            background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
          };
          // The three filters no longer squeeze into the width
          // (labels were truncated 3-across); each keeps a comfortable fixed
          // width and the row scrolls, with the shared scroll-affordance
          // chevron (ScrollableChipRow) cueing that more is off-screen.
          return (
            <ScrollableChipRow pad="0 12px 14px" gap={8}>
              <div style={{ ...wrapStyle, flex: "0 0 auto", width: 176 }}>
                <Ico name="pipe" size={14} color={C.oxbloodHi} sw={1.5} />
                <select
                  value={filterPipe}
                  aria-label={t("aria_filter_by_pipe")}
                  onChange={(e) => setFilterPipe(e.target.value)}
                  onFocus={pipeFilterRing.onFocus}
                  onBlur={pipeFilterRing.onBlur}
                  style={selStyle(pipeFilterRing)}>
                  <option value="">{t("f_all_pipes")}</option>
                  {filterOptions.pipes.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
              <div style={{ ...wrapStyle, flex: "0 0 auto", width: 176 }}>
                <Ico name="leaf" size={14} color={C.brassHi} sw={1.5} />
                <select
                  value={filterTobacco}
                  aria-label={t("aria_filter_by_tobacco")}
                  onChange={(e) => setFilterTobacco(e.target.value)}
                  onFocus={tobFilterRing.onFocus}
                  onBlur={tobFilterRing.onBlur}
                  style={selStyle(tobFilterRing)}>
                  <option value="">{t("f_all_tobaccos")}</option>
                  {filterOptions.tobaccos.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
              <div style={{ ...wrapStyle, flex: "0 0 100px" }}>
                <select
                  value={filterYear}
                  aria-label={t("aria_filter_by_year")}
                  onChange={(e) => setFilterYear(e.target.value)}
                  onFocus={yearFilterRing.onFocus}
                  onBlur={yearFilterRing.onBlur}
                  style={selStyle(yearFilterRing)}>
                  <option value="">{t("f_all_years")}</option>
                  {filterOptions.years.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              {/* Country + locality — shown only when at least one
                  session carries that location field, so a user who never
                  captures location sees no empty dropdown. */}
              {filterOptions.countries.length > 0 && (
                <div style={{ ...wrapStyle, flex: "0 0 auto", width: 168 }}>
                  <Ico name="cloud" size={14} color={C.sageHi} sw={1.5} />
                  <select
                    value={journalFilterCountry}
                    aria-label={t("aria_filter_by_country")}
                    onChange={(e) => setFilterCountry(e.target.value)}
                    onFocus={countryFilterRing.onFocus}
                    onBlur={countryFilterRing.onBlur}
                    style={selStyle(countryFilterRing)}>
                    <option value="">{t("f_all_countries")}</option>
                    {filterOptions.countries.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              )}
              {filterOptions.cities.length > 0 && (
                <div style={{ ...wrapStyle, flex: "0 0 auto", width: 168 }}>
                  <Ico name="home" size={14} color={C.brassHi} sw={1.5} />
                  <select
                    value={journalFilterCommune}
                    aria-label={t("aria_filter_by_city")}
                    onChange={(e) => setFilterCommune(e.target.value)}
                    onFocus={cityFilterRing.onFocus}
                    onBlur={cityFilterRing.onBlur}
                    style={selStyle(cityFilterRing)}>
                    <option value="">{t("f_all_cities")}</option>
                    {filterOptions.cities.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              )}
            </ScrollableChipRow>
          );
        })()}

        <SectionHead title={t ? t("sec_recent") : "Récentes"} sub={`${sessions.length}`} accent={C.sage} />

        <div style={{ padding: "0 12px" }}>
          {sessions.length === 0 ? (
            // The journal distinguished "it is empty" from "the filters
            // trimmed everything away" — the ONLY list that did. A later pass
            // moved the block onto the shared primitive and gave the other
            // three the same distinction.
            <EmptyState
              icon="book"
              accent={C.sage}
              label={journalFiltered ? t("journal_no_match") : t("journal_no_sessions")}
              actions={journalFiltered
                ? [{ label: t("btn_reset_filters"), onClick: resetJournalFilters }]
                : [{ label: t("btn_new_session"), onClick: openNewSession }]} />
          ) : sessGrouped && grouped ? (
            grouped.map(yr => {
              const yrCollapsed = collapsedSessGroups?.[yr.yearKey] !== false;
              // Pull from the shared 0-indexed arrays
              // and offset by 1 (the journal uses month-of-year 1-12).
              const monthLabel = (ym: string) => {
                const parts = String(ym).split("-");
                const mi = parseInt(parts[1] || "0", 10);
                const names = monthsShort(lang);
                return (mi >= 1 && mi <= 12) ? names[mi - 1] : ym;
              };
              return (
                <div key={yr.year} style={{ marginBottom: 12 }}>
                  <PressCard onClick={() => toggleSessGroup && toggleSessGroup(yr.yearKey)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 14px", marginBottom: 6, borderRadius: 8,
                      background: C.cardHi, border: `1px solid ${alpha(C.sage, "33")}`,
                    }}>
                    <span style={{
                      fontFamily: F.display, fontSize: fs(24), color: C.sage,
                      fontStyle: "italic", letterSpacing: -0.3,
                    }}>{yr.year}</span>
                    <span style={{ fontFamily: F.mono, fontSize: fs(14.5), color: C.tx3 }}>
                      {yr.total} {yr.total > 1 ? t("lbl_sessions_word") : t("lbl_session_word")}
                    </span>
                    <span style={{
                      marginLeft: "auto",
                      transition: "transform 200ms",
                      transform: yrCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                      color: C.tx3,
                    }}>
                      <Ico name="chevron" size={14} sw={1.7} />
                    </span>
                  </PressCard>
                  {!yrCollapsed && yr.months.map(g => {
                    const collapsed = collapsedSessGroups?.[g.monthKey] !== false;
                    return (
                      <div key={g.monthKey} style={{ marginLeft: 12 }}>
                        <PressCard onClick={() => toggleSessGroup && toggleSessGroup(g.monthKey)}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "8px 12px", marginBottom: 6, borderRadius: 8,
                            background: CARD_BG, border: `1px solid ${C.rule}`,
                          }}>
                          <Lbl color={C.sageHi} size={12}>{monthLabel(g.name)}</Lbl>
                          <span style={{ fontFamily: F.mono, fontSize: fs(14.5), color: C.tx3 }}>
                            {g.items.length}
                          </span>
                          <span style={{
                            marginLeft: "auto",
                            transition: "transform 200ms",
                            transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
                            color: C.tx3,
                          }}>
                            <Ico name="chevron" size={14} sw={1.7} />
                          </span>
                        </PressCard>
                        {!collapsed && g.items.map((s, i) => {
                          const tob = tobOf(s.tobaccoId);
                          const pp = pipeOf(s.pipeId);
                          return (
                            <JournalEntry key={s.id} s={s} idx={i}
                              expanded={!!expandSessCards}
                              tob={tob} pipe={pp}
                              weightUnit={weightUnit}
                              onOpen={() => setDetailSession(s)} />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })
          ) : (
            sessions.map((s, i) => {
              const tob = tobOf(s.tobaccoId);
              const pp = pipeOf(s.pipeId);
              return (
                <JournalEntry key={s.id} s={s} idx={i}
                  expanded={!!expandSessCards}
                  tob={tob} pipe={pp}
                  weightUnit={weightUnit}
                  onOpen={() => setDetailSession(s)} />
              );
            })
          )}
        </div>
      </div>

      {detailSession && (() => {
        const dsTob = tobOf(detailSession.tobaccoId);
        const dsPipe = pipeOf(detailSession.pipeId);
        return (
        <SessionDetailModal
          s={detailSession}
          tob={dsTob}
          pipe={dsPipe}
          weightUnit={weightUnit}
          lang={lang}
          dateFormat={dateFormat}
          t={t}
          imgLocal={ctx.imgLocal}
          onClose={() => setDetailSession(null)}
          onEdit={() => { const cur = detailSession; setDetailSession(null); onEditSession(cur); }}
          onDelete={() => { const cur = detailSession; setDetailSession(null); onDeleteSession(cur); }}
          // Tap the tabac / pipe block to open its fiche. Only when
          // the live entity exists (a hard-deleted one shows via snapshot but
          // has no fiche to open). crossOpenDetail records this session modal on
          // the back stack so system-back / swipe re-opens it.
          onOpenTob={dsTob && crossOpenDetail ? () => crossOpenDetail({ view: "inv", kind: "tobacco", obj: dsTob }) : undefined}
          onOpenPipe={dsPipe && crossOpenDetail ? () => crossOpenDetail({ view: "pipes", kind: "pipe", obj: dsPipe }) : undefined}
        />
        );
      })()}
    </div>
  );
}


function JournalEntry({
  s, idx, expanded, tob, pipe, weightUnit, onOpen,
}: {
  s: Session; idx: number; expanded: boolean;
  tob: Tobacco | undefined; pipe: Pipe | undefined;
  weightUnit: string;
  onOpen: () => void;
}) {
  const e = useEnter(100 + idx * 50, { duration: 420 });
  // Rotate the top accent bar through the shared CARD_ACCENTS
  // palette (like the tobacco/pipe/accessory list cards) instead of a fixed
  // sage bar, so the journal list alternates hues down the page.
  const color = CARD_ACCENTS[idx % CARD_ACCENTS.length]!;
  const { imgLocal, lang, dateFormat, t, xl } = useAppCtx();
  // Detail chips for the "Cartes détaillées" mode.
  // category (with the curator palette dot), pipe shape, exact lot
  // reference. The toggle used to only reveal session notes — if the
  // user didn't write notes (most don't), the toggle did nothing
  // visible. These three signals are always derivable from the live
  // entity, so the toggle now always has an effect.
  // Snapshot doesn't carry category (the refresh covers brand /
   // name / imageUrl); when the live tobacco is gone the chip simply
   // drops out of the row.
  const tobCategory = tob?.category || "";
  const pipeShape = pipe?.shape || "";
  const sessLot = (tob?.lots || []).find((l: any) => String(l.id) === String(s.lotId));
  // boxNumber if set, else the 1-based index inside the live lots
  // array, falling back to nothing when the lot is missing entirely.
  const lotIdx = sessLot ? (tob?.lots || []).indexOf(sessLot) : -1;
  const lotLabel = sessLot
    ? (sessLot.boxNumber || (lotIdx >= 0 ? String(lotIdx + 1) : ""))
    : "";
  const lotStorage = sessLot?.storageLocation || "";
  // Fall back to session.tobaccoSnapshot / pipeSnapshot if
  // the live entity is missing (entity in Trash or already hard-deleted).
  const tobLabel = sessionEntityLabel(tob, s.tobaccoSnapshot, "—");
  const pipeLabel = sessionEntityLabel(pipe, s.pipeSnapshot, "");
  // Fall back to the snapshot's imageUrl when the live
  // entity is gone (permanent delete). Resolution order: live entity
  // → snapshot.imageUrl → null. Local photos (`local-photo-*`) are
  // resolved from `imgLocal`; external URLs flow through as-is.
  const tobImgKey = tob?.imageUrl || s.tobaccoSnapshot?.imageUrl || "";
  const pipeImgKey = pipe?.imageUrl || s.pipeSnapshot?.imageUrl || "";
  const tobPhoto = tobImgKey ? ((imgLocal && imgLocal[tobImgKey]) || tobImgKey) : null;
  const pipePhoto = pipeImgKey ? ((imgLocal && imgLocal[pipeImgKey]) || pipeImgKey) : null;
  return (
    <PressCard
      onClick={onOpen}
      ariaLabel={t("aria_session_card")}
      style={{
        background: CARD_BG, border: `1px solid ${C.rule}`,
        borderRadius: 8, marginBottom: 8, padding: "13px 15px",
        position: "relative", overflow: "hidden",
        boxShadow: CARD_SHADOW,
        ...e,
      }}>
      {/* Top accent bar (matches the tobacco/pipe/acc cards),
          replacing the former full-height left bar. Absolute + full-width
          so it sits flush at the top edge above the card's own padding. */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: color, opacity: 0.65 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
          {tobPhoto ? (
            <div style={{
              width: 44, height: 44, borderRadius: 6,
              background: `${safeBgUrl(tobPhoto)} center/cover no-repeat, ${C.bg2}`,
              border: `1px solid ${C.rule}`,
            }} />
          ) : (
            <div style={{
              width: 44, height: 44, borderRadius: 6,
              background: C.bg, border: `1px solid ${C.rule}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: C.brass,
            }}>
              <Ico name="leaf" size={18} sw={1.4} />
            </div>
          )}
          {/* Also render the pipe slot when the live pipe is
              gone but a snapshot remains. The label block below already
              had the snapshot fallback; the visual slot is
              now consistent. */}
          {(pipe || s.pipeSnapshot) && (pipePhoto ? (
            <div style={{
              width: 44, height: 44, borderRadius: 6,
              background: `${safeBgUrl(pipePhoto)} center/cover no-repeat, ${C.bg2}`,
              border: `1px solid ${C.rule}`,
            }} />
          ) : (
            <div style={{
              width: 44, height: 44, borderRadius: 6,
              background: C.bg, border: `1px solid ${C.rule}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: C.oxbloodHi,
            }}>
              <Ico name="pipe" size={18} sw={1.4} />
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Lbl color={C.sage}>{s.date ? fmtDate(s.date, dateFormat) : "—"}</Lbl>
            {s.time && <>
              <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
              <Lbl color={C.tx3}>{s.time}</Lbl>
            </>}
            {s.duration && <>
              <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
              <Lbl color={C.tx3}>{s.duration} {t ? t("min_short") : "min"}</Lbl>
            </>}
            {s.weightG && parseFloat(s.weightG) > 0 && <>
              <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
              <Lbl color={C.tx3}>{fmtNum(s.weightG, lang)}{weightUnit}</Lbl>
            </>}
          </div>
          <div style={{
            marginTop: 6, fontFamily: F.display, fontSize: fs(20), color: C.ivory,
            letterSpacing: -0.2, lineHeight: 1.2,
          }}>
            <span style={{ fontStyle: "italic" }}>{tobLabel}</span>
          </div>
          {pipeLabel && (
            <div style={{ fontSize: fs(15), color: C.tx2, marginTop: 3 }}>
              {t("lbl_with")}<span style={{ color: C.oxbloodHi }}>{pipeLabel}</span>
            </div>
          )}
          {/* Enriched details row in expanded mode —
              category badge + pipe shape + lot reference. Each chip is
              conditional so the row collapses cleanly when its data
              isn't available. */}
          {expanded && (tobCategory || pipeShape || lotLabel) && (
            <div style={{
              marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap",
              alignItems: "center",
            }}>
              {tobCategory && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "2px 8px", borderRadius: 4,
                  background: alpha(catColor(tobCategory), "22"),
                  color: catColor(tobCategory),
                  fontFamily: F.mono, fontSize: fs(12), fontWeight: 700,
                  letterSpacing: 0.8, textTransform: "uppercase",
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: 3,
                    background: catColor(tobCategory),
                  }} />
                  {xl ? xl(tobCategory, CATS_EN) : tobCategory}
                </span>
              )}
              {pipeShape && (
                <span style={{
                  padding: "2px 8px", borderRadius: 4,
                  background: alpha(C.oxbloodHi, "22"), color: C.oxbloodHi,
                  fontFamily: F.mono, fontSize: fs(12), fontWeight: 700,
                  letterSpacing: 0.8, textTransform: "uppercase",
                }}>
                  {xl ? xl(pipeShape, SHAPES_EN) : pipeShape}
                </span>
              )}
              {lotLabel && (
                <span style={{
                  padding: "2px 8px", borderRadius: 4,
                  background: alpha(C.brassHi, "22"), color: C.brassHi,
                  fontFamily: F.mono, fontSize: fs(12), fontWeight: 700,
                  letterSpacing: 0.8, textTransform: "uppercase",
                }}>
                  {t("lbl_lot")} Nº {lotLabel}
                  {lotStorage && (
                    <span style={{ marginLeft: 5 }}>· 📍 {lotStorage}</span>
                  )}
                </span>
              )}
            </div>
          )}
          {expanded && s.notes && (
            <div style={{
              marginTop: 8, padding: "8px 10px", background: C.bg,
              border: `1px dotted ${C.rule}`, borderRadius: 4,
              fontSize: fs(15), color: C.cream, fontStyle: "italic", lineHeight: 1.5,
              fontFamily: F.display,
            }}>« {s.notes} »</div>
          )}
          {/* The journal list shows only the place NAME (or the
              raw coordinates as a fallback) — not the map. The embedded
              OpenStreetMap map now lives exclusively in the session detail
              fiche (SessionDetailModal), which keeps the list light. */}
          {expanded && isValidCoords(s.lat, s.lng) && (
            <div style={{
              marginTop: 8, display: "flex", alignItems: "center", gap: 6,
              fontSize: fs(13.5), color: C.tx2,
            }}>
              <span style={{ fontSize: fs(14.5) }}>📍</span>
              <span style={{
                minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontFamily: (s.locationName || s.locationCity || s.locationCountry) ? F.body : F.mono,
              }}>
                {joinPlaceParts(s.locationName, s.locationCity, s.locationCountry) || formatCoords(s.lat as number, s.lng as number)}
              </span>
            </div>
          )}
          {/* The tobacco's persistent tastingNotes used to
              appear under the session notes when the card was expanded.
              User feedback: the journal is about the session, not the
              tabac fiche — surfacing both was noisy and made cards feel
              like cross-listings. Tabac notes are still visible on the
              tabac detail; the session card shows only session-specific
              content now. */}
          {s.rating > 0 && <div style={{ marginTop: 8 }}><Stars n={s.rating} size={11} /></div>}
        </div>
        {/* Inline edit / delete icons removed — both actions
            now live exclusively inside the read-only SessionDetailModal,
            mirroring the lot list pattern. Tap a row to open the modal,
            then choose Edit or Delete from there. */}
        <Ico name="chevron" size={16} color={C.tx3} />
      </div>
    </PressCard>
  );
}

// Session detail modal — read-only view shown when the user
// taps a journal entry. The legacy flow forced the user into the edit
// form to inspect a finished session, which was unintuitive: editing is
// a write action, not a read action. The modal now surfaces every field
// at once (photos, dates, weight, lot, rating, notes, tobacco notes)
// and offers Edit + Delete buttons for follow-up.
function SessionDetailModal({
  s, tob, pipe, weightUnit, lang, dateFormat, t, imgLocal, onClose, onEdit, onDelete,
  onOpenTob, onOpenPipe,
}: {
  s: Session;
  tob: Tobacco | undefined;
  pipe: Pipe | undefined;
  weightUnit: string;
  lang?: string;
  dateFormat?: string;
  // t required after i18n cleanup; always provided by ctx.
  t: (k: string) => string;
  imgLocal?: Record<string, string> | undefined;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  // Tap-to-open the tabac / pipe fiche (undefined when the entity
  // is hard-deleted — no fiche to open).
  onOpenTob?: (() => void) | undefined;
  onOpenPipe?: (() => void) | undefined;
}) {
  // Snapshot fallback for the image, same as JournalEntry.
  const tobImgKey = tob?.imageUrl || s.tobaccoSnapshot?.imageUrl || "";
  const pipeImgKey = pipe?.imageUrl || s.pipeSnapshot?.imageUrl || "";
  const tobPhoto = tobImgKey ? ((imgLocal && imgLocal[tobImgKey]) || tobImgKey) : null;
  const pipePhoto = pipeImgKey ? ((imgLocal && imgLocal[pipeImgKey]) || pipeImgKey) : null;
  const lot = tob && s.lotId
    ? (tob.lots || []).find((l: any) => String(l.id) === String(s.lotId))
    : null;
  const lotStatusLbl = lot
    ? lot.status === "cellar"
      ? t("lot_cellar")
      : lot.status === "jar"
        ? t("lot_jar")
        : t("lot_finished_lbl")
    : null;
  return (
    <Modal open={true} onClose={onClose} maxWidth={520}
      ariaLabel={t("aria_session_details")}>
      <ModalHeader
        overline={t("lbl_session_overline")}
        title={(s.date ? fmtDate(s.date, dateFormat) : "—") + (s.time ? " · " + s.time : "")}
        accent={C.sage} />

      <div style={{ padding: "0 12px 18px" }}>
        {/* Tabac block — tappable to open the tabac fiche when it
            still exists (onOpenTob set). */}
        <PressCard
          onClick={onOpenTob || undefined}
          style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 12px", borderRadius: 8,
          background: CARD_BG, border: `1px solid ${C.rule}`, marginBottom: 10,
          cursor: onOpenTob ? "pointer" : "default",
        }}>
          {tobPhoto ? (
            <div style={{
              width: 56, height: 56, borderRadius: 6, flexShrink: 0,
              background: `${safeBgUrl(tobPhoto)} center/cover no-repeat, ${C.bg3}`,
              border: `1px solid ${C.rule}`,
            }} />
          ) : (
            <div style={{
              width: 56, height: 56, borderRadius: 6, flexShrink: 0,
              background: C.bg3, border: `1px solid ${C.rule}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: C.brassHi,
            }}>
              <Ico name="leaf" size={22} sw={1.4} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Fall back to s.tobaccoSnapshot for hard-deleted or
                trashed tobaccos so the modal stays readable. */}
            <Lbl color={C.brassHi}>{
              tob?.brand
                || (s.tobaccoSnapshot?.brand)
                || t("lbl_unknown")
            }</Lbl>
            <div style={{
              fontFamily: F.display, fontSize: fs(20), color: C.ivory,
              marginTop: 2, fontStyle: "italic",
            }}>{tob?.name || s.tobaccoSnapshot?.name || "—"}</div>
            {lotStatusLbl && (
              <div style={{
                marginTop: 4, fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3,
                letterSpacing: 0.4,
              }}>
                {lotStatusLbl}{lot?.weightG ? ` · ${fmtNum(lot.weightG, lang)}${weightUnit}` : ""}
                {lot?.dateOpened ? ` · ${t("lbl_opened")} ${fmtDate(lot.dateOpened, dateFormat)}` : ""}
              </div>
            )}
          </div>
          {onOpenTob && <Ico name="chevron" size={16} sw={2} />}
        </PressCard>

        {/* Pipe block — surface even when the pipe is deleted,
            using the snapshot stamped at session save time. Tappable to
            open the pipe fiche when it still exists. */}
        {(pipe || s.pipeSnapshot) && (
          <PressCard
            onClick={onOpenPipe || undefined}
            style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 12px", borderRadius: 8,
            background: CARD_BG, border: `1px solid ${C.rule}`, marginBottom: 10,
            cursor: onOpenPipe ? "pointer" : "default",
          }}>
            {pipePhoto ? (
              <div style={{
                width: 56, height: 56, borderRadius: 6, flexShrink: 0,
                background: `${safeBgUrl(pipePhoto)} center/cover no-repeat, ${C.bg3}`,
                border: `1px solid ${C.rule}`,
              }} />
            ) : (
              <div style={{
                width: 56, height: 56, borderRadius: 6, flexShrink: 0,
                background: C.bg3, border: `1px solid ${C.rule}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: C.oxbloodHi,
              }}>
                <Ico name="pipe" size={22} sw={1.4} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Lbl color={C.oxbloodHi}>{pipe?.brand || s.pipeSnapshot?.brand || ""}</Lbl>
              <div style={{
                fontFamily: F.display, fontSize: fs(20), color: C.ivory,
                marginTop: 2, fontStyle: "italic",
              }}>{pipe?.name || s.pipeSnapshot?.name || "—"}</div>
            </div>
            {onOpenPipe && <Ico name="chevron" size={16} sw={2} />}
          </PressCard>
        )}

        {/* Stats row */}
        <div style={{
          display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 8,
          marginBottom: 12,
        }}>
          <StatTile label={t("lbl_duration")}
            value={s.duration ? `${s.duration} min` : "—"} accent={C.brassHi} />
          <StatTile label={t("lbl_smoked")}
            value={s.weightG && parseFloat(s.weightG) > 0 ? `${fmtNum(s.weightG, lang)}${weightUnit}` : "—"}
            accent={C.sage} />
          <StatTile label={t("lbl_rating_lbl")}
            value={s.rating > 0 ? "" : "—"} accent={C.amber}
            customValue={s.rating > 0 ? <Stars n={s.rating} size={12} /> : null} />
        </div>

        {/* Notes */}
        {/* Aroma tags captured for this session (read-only chips). */}
        {(() => {
          const aromas = sanitizeAromas((s as any).aromas);
          if (aromas.length === 0) return null;
          return (
            <div style={{ marginBottom: 10 }}>
              <Lbl color={C.tx2}>{t("aroma_section")}</Lbl>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {aromas.map((k) => (
                  <span key={k} style={{
                    padding: "5px 10px",
                    background: alpha(C.brass, "1c"), border: `1px solid ${alpha(C.brass, "55")}`,
                    color: C.brassHi, borderRadius: 8,
                    fontSize: fs(13.5), fontFamily: F.body, fontWeight: 500,
                  }}>{t(aromaLabelKey(k))}</span>
                ))}
              </div>
            </div>
          );
        })()}

        {s.notes && (
          <div style={{ marginBottom: 10 }}>
            <Lbl color={C.tx2}>{t("sec_session_notes_lbl")}</Lbl>
            <div style={{
              marginTop: 4, padding: "10px 12px",
              background: CARD_BG, border: `1px dotted ${C.rule}`, borderRadius: 8,
              fontFamily: F.display, fontSize: fs(16), fontStyle: "italic",
              color: C.cream, lineHeight: 1.55,
            }}>« {s.notes} »</div>
          </div>
        )}

        {/* Tobacco tastingNotes block removed from the
            session detail modal. Journal entries are session-specific —
            the persistent tabac notes belong on the tabac fiche, not
            cross-listed here. */}

        {/* Session location map. The embedded OSM iframe
            makes a network request to openstreetmap.org carrying the
            session coordinates — disclosed in privacy.html. Only renders
            when the session actually carries a valid lat/lng. */}
        {isValidCoords(s.lat, s.lng) && (
          <div style={{ marginBottom: 10 }}>
            <Lbl color={C.tx2}>{t("sec_location")}</Lbl>
            {/* Show the reverse-geocoded place name above the map
                when one was resolved (the list shows the name alone; the
                fiche shows name + map). */}
            {(s.locationName || s.locationCity || s.locationCountry) && (
              <div style={{
                margin: "4px 0 2px", fontFamily: F.body, fontSize: fs(15),
                color: C.tx, fontWeight: 600,
              }}>
                {joinPlaceParts(s.locationName, s.locationCity, s.locationCountry)}
              </div>
            )}
            <div style={{
              marginTop: 4, borderRadius: 8, overflow: "hidden",
              border: `1px solid ${C.rule}`,
            }}>
              <iframe
                title={t("sec_location")}
                src={osmEmbedUrl(s.lat as number, s.lng as number)}
                loading="lazy"
                style={{ width: "100%", height: 180, border: "none", display: "block" }}
              />
            </div>
            <div style={{
              marginTop: 6, display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: 8, flexWrap: "wrap",
            }}>
              <span style={{ fontFamily: F.mono, fontSize: fs(13), color: C.tx3 }}>
                📍 {formatCoords(s.lat as number, s.lng as number)}
              </span>
              <a
                href={osmLinkUrl(s.lat as number, s.lng as number)}
                target="_blank" rel="noopener noreferrer"
                style={{
                  fontFamily: F.mono, fontSize: fs(12.5), fontWeight: 700,
                  letterSpacing: 0.8, textTransform: "uppercase",
                  color: C.oxbloodHi, textDecoration: "none",
                  padding: "5px 10px", borderRadius: 6,
                  border: `1px solid ${alpha(C.oxbloodHi, "44")}`,
                }}>
                {t("btn_open_map")} →
              </a>
            </div>
          </div>
        )}

        {/* Actions.
            `flexWrap`, the fix made to the LOT detail
            modal's identical row and never carried across to this one — same
            three buttons, same shape, same word. In German « BEARBEITEN » was
            painted 27px past the panel and read « BEARBE », cut at the edge, at
            the DEFAULT text size. They are single words, so a flex item at its
            default `min-width: auto` could only clip. Wrapping costs a line ONLY
            where the three do not fit and clips nothing.

            Found by the paint-past-a-clipping-ancestor checker rule rather than by eye, which is the
            point of that rule: the panel is `overflow: hidden`, so the excess
            was swallowed with the page looking perfectly composed. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
          <PressCard onClick={onClose} style={{
            flex: 1, padding: "11px 12px",
            background: CARD_BG, border: `1px solid ${C.rule}`,
            borderRadius: 8, textAlign: "center",
            color: C.tx, fontFamily: F.mono, fontSize: fs(13.5),
            letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
          }}>
            {t("btn_close")}
          </PressCard>
          <PressCard onClick={onDelete} style={{
            flex: 1, padding: "11px 12px",
            background: alpha(C.oxblood, "22"), border: `1px solid ${alpha(C.oxblood, "66")}`,
            borderRadius: 8, textAlign: "center",
            color: C.oxbloodHi, fontFamily: F.mono, fontSize: fs(13.5),
            letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
          }}>
            {t("btn_delete")}
          </PressCard>
          <PressCard onClick={onEdit} style={{
            flex: 1, padding: "11px 12px",
            background: alpha(C.brass, "33"), border: `1px solid ${alpha(C.brass, "88")}`,
            borderRadius: 8, textAlign: "center",
            color: C.brassHi, fontFamily: F.mono, fontSize: fs(13.5),
            letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
          }}>
            {t("btn_edit")}
          </PressCard>
        </div>
      </div>
    </Modal>
  );
}

