import React from "react";
import type { AppData } from "./types.ts";
import {
  countByStatus,
  countActive,
  pipeIsActive,
  accIsActive,
  migrateData,
  initDateFormat,
  lotAgingStatus,
  effectiveAgingMax,
  computeStats,
  getStorageBlockedHint,
  sweepExpiredTrash,
  restoreScrollY,
  findById,
  entityLabel,
  isWithinDays,
  readDefaultGrouped,
  isTrashed,
  stripDeleted,
  newPhotoSuffix,
  convertWeightUnit,
} from "./utils.ts";
import {
  SK,
  BT,
  BL,
  BW,
  BA,
  BJ,
  BP,
  INIT,
  TRASH_RETENTION_DAYS,
  GDRIVE_PENDING_STALE_MS,
  ENUM_TRANSLATIONS,
} from "./constants.ts";
import { applyTheme, THEMES, THEME_COLOR_META } from "./theme-curator.ts";
import { pickJarLot } from "./utils/lotUtils.ts";
import { buildTobaccoAromaIndex, tobaccoMatchesAromas } from "./utils/aromas.ts";
import { lotMaturityBucket, isRecentPurchase, scopeFromStatusFilter, lotInScope, scopedHeldWeight, scopedOldestAgeDays } from "./utils/cellarInsights.ts";
import { isLowStock } from "./utils/shopping.ts";
import { assertLotInvariants } from "./utils/lotInvariants.ts";
import { imgCache, imgMap } from "./utils/imgCache.ts";
import { processOAuthReturn } from "./utils/oauthReturn.ts";
import { computeTopTobaccos, computeTopPipes, computeChartStats } from "./utils/stats.ts";
import { useAppUpdate } from "./hooks/useAppUpdate.ts";
import { useBackNavigation } from "./hooks/useBackNavigation.ts";
import { nextStackOnNav, decideBack, pushDrillOrigin, type NavLoc } from "./utils/navHistory.ts";
import { hasOpenModal, closeTopModal, subscribeModalStack } from "./utils/modalStack.ts";
import { IS_IOS, IS_IOS_STANDALONE } from "./utils/platform.ts";
import { appStorage, lsGet, lsSet, lsRemove } from "./utils/appStorage.ts";
import { makeEncryptionVerifier } from "./utils/cryptoBackup.ts";
import { useOrphanPhotoGC } from "./hooks/useOrphanPhotoGC.ts";
import { useStorageQuotaWarning } from "./hooks/useStorageQuotaWarning.ts";
import { useLotIntegrityProbe } from "./hooks/useLotIntegrityProbe.ts";
import { useTrashOps } from "./hooks/useTrashOps.ts";
import { planCatalogueApply, applyCataloguePlan } from "./utils/catalogueApply.ts";
import { loadTobaccoDb, tobaccoDbLookupSync } from "./utils/tobaccoDb.ts";
import { useAiAutoFill } from "./hooks/useAiAutoFill.ts";
import { useGdriveSync } from "./hooks/useGdriveSync.ts";
import { useExportImport } from "./hooks/useExportImport.ts";
import { useUserCatalogue } from "./hooks/useUserCatalogue.ts";
import { useImportConfirm, APIKEY_REPLACED_KEY } from "./hooks/useImportConfirm.ts";
import { useAccessoryStore } from "./hooks/useAccessoryStore.ts";
import { useWishStore } from "./hooks/useWishStore.ts";
import { usePipeStore } from "./hooks/usePipeStore.ts";
import { useTobaccoStore } from "./hooks/useTobaccoStore.ts";
import { useSessionStore } from "./hooks/useSessionStore.ts";
import { useTastingSession } from "./hooks/useTastingSession.ts";
import { LANG, translate, ensureLang, isLangLoaded, isKnownLang } from "./i18n.ts";
import { tobaccoHasTag } from "./utils/tags.ts";
import { compareByBrandThenName, sortByBrandThenName } from "./utils/sortBrandName.ts";
import { AppCtx } from "./AppContext.tsx";
import { CuratorTermsGate } from "./views/curator/TermsGate.tsx";
import { CuratorApp } from "./CuratorApp.tsx";

var useState = React.useState,
  useEffect = React.useEffect,
  useCallback = React.useCallback,
  useMemo = React.useMemo,
  useRef = React.useRef;

// IS_IOS / IS_IOS_STANDALONE moved to src/utils/platform.ts
// (imported above) — they were duplicated with useGdriveAuth.ts.
window.__PENDING_GDRIVE_TOKEN__ = null;
window.__PENDING_GDRIVE_ACTION__ = null;
window.__PENDING_GDRIVE_CODE__ = null;
window.__PENDING_GDRIVE_VERIFIER__ = null;
window.__PENDING_GDRIVE_REDIRECT__ = null;
// OAuth-return handling lives in src/utils/oauthReturn.ts
// (pure, takes a window arg, fully unit-tested). The IIFE runs once at
// module load — same lifecycle as before, just no longer inline.
processOAuthReturn();

// Stale-pending sweep on cold start. The OAuth dispatcher
// above only clears `gdrive-pending` when a token or error came back in
// the URL. If the redirect chain died silently (user closed the OAuth
// tab, network blip after the redirect, Google decided not to bounce),
// the key stayed set forever and every future save-tap auto-save bailed
// at the in-flight guard. On mount, if pending is set with a timestamp
// older than 60 s AND there is no OAuth payload in the URL, treat it
// as dead and clean up.
(function () {
  try {
    var p = lsGet("gdrive-pending");
    if (!p) return;
    var hasPayload =
      (window.location.hash && /access_token=|error=/.test(window.location.hash)) ||
      (window.location.search && /[?&]code=|[?&]error=/.test(window.location.search));
    if (hasPayload) return;
    var pts = parseInt(lsGet("gdrive-pending-ts") || "0", 10);
    if (pts === 0 || Date.now() - pts > GDRIVE_PENDING_STALE_MS) {
      // eslint-disable-next-line tabac-local/no-raw-storage-write -- OAuth pending key keeps its guarded path (read-before-clear)
      localStorage.removeItem("gdrive-pending");
      // eslint-disable-next-line tabac-local/no-raw-storage-write -- OAuth pending key keeps its guarded path (read-before-clear)
      localStorage.removeItem("gdrive-pending-ts");
    }
  } catch (_e) {}
})();

function App() {
  // Initialise with INIT (empty inventory) instead of null so
  // CuratorApp can render the shell (TopBar, Dock, empty Home) immediately
  // while load() resolves localStorage asynchronously. The `loading` flag
  // is now consumed by CuratorApp itself (loading overlay) instead of
  // gating the whole tree. Distinguishes "still loading" from "truly empty
  // cellar" — without it, returning users would see a 300-800ms flash of
  // "Add your first tobacco" before their real inventory appears.
  var _s = useState<AppData>(INIT),
    data = _s[0],
    setData = _s[1];
  var _l = useState(true),
    loading = _l[0],
    setLoading = _l[1];
  var _v = useState("home"),
    view = _v[0],
    setView = _v[1];
  var _sr = useState(""),
    search = _sr[0],
    setSearch = _sr[1];
  var _so = useState("name"),
    sortBy = _so[0],
    setSortBy = _so[1];
  // Default the inventory tab to "Actifs" instead of "Tous".
  // The user almost never wants finished lots in their face when they
  // open the catalogue — "active" matches the natural mental model of
  // "what I currently have", and the chip is one tap away to broaden.
  // Persists via the nav() reset path below (same default applied on
  // every navigation into the inv view).
  var _sf = useState("active"),
    statusFilter = _sf[0],
    setStatusFilter = _sf[1];
  // DelConfirm state removed — deletes go straight to the
  // Trash (30 d retention) with an 8 s undo toast as the safety net.
  var _im = useState(false),
    importModal = _im[0],
    setImportModal = _im[1];
  var _vs = useState<Record<string, any>>(function () {
      try {
        return JSON.parse(lsGet("cave-sections") || "{}");
      } catch (_e) {
        return {};
      }
    }),
    visibleSections = _vs[0],
    setVisibleSections = _vs[1];
  var _lb = useState<string | null>(null),
    lightbox = _lb[0],
    setLightbox = _lb[1];
  // Detailed cards ON by default — tobacco + pipe (+ accessory)
  // lists show the description/notes expanded at launch; the sliders toggle
  // still collapses them. Shared across the three lists.
  var _ex = useState(true),
    expandCards = _ex[0],
    setExpandCards = _ex[1];
  var _exs = useState(false),
    expandSessCards = _exs[0],
    setExpandSessCards = _exs[1];
  var _ic = useState<Record<string, any>>(imgMap()),
    imgLocal = _ic[0],
    setImgLocal = _ic[1];
  var _cf = useState(""),
    catFilter = _cf[0],
    setCatFilter = _cf[1];
  var _bf = useState(""),
    brandFilter = _bf[0],
    setBrandFilter = _bf[1];
  var _rfi = useState(0),
    ratingFilter = _rfi[0],
    setRatingFilter = _rfi[1];
  var _cutf = useState(""),
    cutFilter = _cutf[0],
    setCutFilter = _cutf[1];
  // User-tag / collection filter (single tag, case-insensitive).
  // Empty = inactive. Reset on nav() like every other list filter.
  var _tgf = useState(""),
    tagFilter = _tgf[0],
    setTagFilter = _tgf[1];
  // Aroma filter (keys from the aroma wheel). AND semantics —
  // a tobacco matches only if its aggregated session aromas include EVERY
  // selected aroma. Empty = inactive.
  var _arf = useState<string[]>([]),
    aromaFilter = _arf[0],
    setAromaFilter = _arf[1];
  var _psf = useState(""),
    pShapeFilter = _psf[0],
    setPShapeFilter = _psf[1];
  var _pbf = useState(""),
    pBrandFilter = _pbf[0],
    setPBrandFilter = _pbf[1];
  var _pff = useState(""),
    pFilterFilter = _pff[0],
    setPFilterFilter = _pff[1];
  // Bowl + stem material filters for the pipe list — gate
  // click-thrus from the StatsView "Matière du bol" / "Matière du bec"
  // charts. Same shape as pShapeFilter / pBrandFilter (empty string =
  // no filter). Reset on `nav()` like every other list filter.
  var _pbmf = useState(""),
    pBowlMaterialFilter = _pbmf[0],
    setPBowlMaterialFilter = _pbmf[1];
  var _psmf = useState(""),
    pStemMaterialFilter = _psmf[0],
    setPStemMaterialFilter = _psmf[1];
  // Rating filter for the pipes list — matches the tabac
  // rating filter pattern (0 = no filter, 1..5 = match rounded rating).
  var _prf = useState(0),
    pRatingFilter = _prf[0],
    setPRatingFilter = _prf[1];
  // Brand filter for the accessories list — same shape as
  // pBrandFilter (empty string = no filter). Reset on nav() like every
  // other list filter; applied locally by AccListView (there is
  // no ctx memo for accessories — see the note where it used to live).
  var _abf = useState(""),
    aBrandFilter = _abf[0],
    setABrandFilter = _abf[1];
  // Accessory TYPE filter (genre) — composes with the brand
  // filter + the active/retired toggle. Same shape as aBrandFilter
  // (empty string = no filter); reset on nav().
  var _atf = useState(""),
    aTypeFilter = _atf[0],
    setATypeFilter = _atf[1];
  // User-tag / collection filters for the pipes + accessories lists
  // (single tag, case-insensitive; empty = inactive). Reset on nav() like every
  // other list filter; applied in the filteredPipes memo / locally by AccListView.
  var _ptgf = useState(""),
    pTagFilter = _ptgf[0],
    setPTagFilter = _ptgf[1];
  var _atgf = useState(""),
    aTagFilter = _atgf[0],
    setATagFilter = _atgf[1];
  // Three composing journal filters lifted from JournalView.tsx
  // local state so click-thrus from StatsView (e.g. tapping a bar in the
  // "Tabac fumé par année" chart) can pre-select them before navigating
  // here. Reset on `nav()` like the other list filters. Wired in
  // JournalView via ctx aliases (filterPipe / filterTobacco / filterYear)
  // so the rest of the view stayed untouched.
  var _jfp = useState(""),
    journalFilterPipe = _jfp[0],
    setJournalFilterPipe = _jfp[1];
  var _jft = useState(""),
    journalFilterTobacco = _jft[0],
    setJournalFilterTobacco = _jft[1];
  var _jfy = useState(""),
    journalFilterYear = _jfy[0],
    setJournalFilterYear = _jfy[1];
  // Day-precise journal filter wired from the StatsView
  // calendar heatmap click. Stored as "YYYY-MM-DD" (ISO date). Composes
  // AND with the other journal filters but overrides year visually
  // (setting a date implies the year — the helper clears year on set).
  var _jfd = useState(""),
    journalFilterDate = _jfd[0],
    setJournalFilterDate = _jfd[1];
  // Location journal filters, wired from the StatsView "Lieux"
  // section (commune / country bars). Each composes AND with the other
  // journal filters; shown as removable chips in JournalView.
  var _jfc = useState(""),
    journalFilterCommune = _jfc[0],
    setJournalFilterCommune = _jfc[1];
  var _jfco = useState(""),
    journalFilterCountry = _jfco[0],
    setJournalFilterCountry = _jfco[1];
  var _ps = useState(lsGet("cave-pending-sync") === "1"),
    pendingSync = _ps[0],
    setPendingSync = _ps[1];
  // Non-blocking import/merge recap message (shown as a Notice toast
  // in Overlays instead of a native window.alert). Set by the CSV + JSON merge
  // paths via ctx.setImportRecap; auto-dismissed by the toast.
  var _ir = useState<{ msg: string; view?: string; tobId?: number } | null>(null),
    importRecap = _ir[0],
    setImportRecap = _ir[1];
  // User-chosen friendly name for THIS device ("iPhone", "MacBook").
  // Device-local (never in backups); surfaced in the multi-device sync diagnostic
  // so the opaque device id is readable.
  var _dn = useState<string>(lsGet("cave-device-name") || ""),
    deviceName = _dn[0],
    setDeviceNameState = _dn[1];
  function saveDeviceName(v: string) {
    var s = String(v == null ? "" : v).slice(0, 40);
    setDeviceNameState(s);
    lsSet("cave-device-name", s);
  }
  // Active cloud-backup destination. Display+routing only —
  // switching does NOT migrate existing backups; both providers keep
  // their own files and file-id namespaces.
  var _cpv = useState(
      (function () {
        // Dropbox is now the default destination. But we MUST
        // not flip pre-existing Google Drive users: any explicit choice
        // (cave-cloud-provider set) wins, and an absent setting + ANY
        // sign of past Drive usage (fid stored, auto-save timestamp)
        // means the user was on Drive before the destination selector
        // existed → keep them on Drive.
        var explicit = lsGet("cave-cloud-provider");
        if (explicit === "gdrive" || explicit === "dropbox") return explicit;
        var hadDrive = !!(lsGet("gdrive-fid") ||
          lsGet("gdrive-auto-fid") ||
          lsGet("cave-autosave-ts"));
        return hadDrive ? "gdrive" : "dropbox";
      })() as "gdrive" | "dropbox",
    ),
    cloudProviderId = _cpv[0],
    setCloudProviderId = _cpv[1];
  function saveCloudProviderId(v: "gdrive" | "dropbox") {
    setCloudProviderId(v);
    lsSet("cave-cloud-provider", v);
  }
  var _wu = useState(lsGet("cave-weight-unit") || "g"),
    weightUnit = _wu[0],
    setWeightUnit = _wu[1];
  var _lu = useState(lsGet("cave-length-unit") || "mm"),
    lengthUnit = _lu[0],
    setLengthUnit = _lu[1];
  // Global "Taille du texte" (S/M/L). Drives the CSS variable
  // --cave-font-scale that every fs()-based font-size multiplies by, so the
  // whole app rescales live with no React re-render. Default "m" (the
  // baseline type-scale uplift). Persisted in localStorage["cave-font-scale"].
  var _fsc = useState(lsGet("cave-font-scale") || "m"),
    fontScale = _fsc[0],
    setFontScale = _fsc[1];
  // Colour theme (brass default / steel-blue). Persisted in
  // localStorage["cave-theme"]; applied to <html> CSS vars (see effect below).
  var _thm = useState(lsGet("cave-theme") || "brass"),
    themeId = _thm[0],
    setThemeId = _thm[1];
  // Light/dark mode (parchment vs vault), orthogonal to the colour
  // theme. Persisted in localStorage["cave-theme-mode"]; default dark.
  var _thmMode = useState(lsGet("cave-theme-mode") || "dark"),
    themeMode = _thmMode[0],
    setThemeMode = _thmMode[1];
  // Currency symbol — display-only suffix on every price
  // field. Picked from a fixed preset list (€ / $ / £ / CHF / JPY)
  // via a Segmented control in Settings → Préférences. Default "€"
  // matches the value that used to be hardcoded.
  // Stored verbatim in localStorage["cave-currency"]; the saver is
  // permissive (accepts any string) so a future preset extension or
  // a user dictionary edit doesn't get blocked.
  var _curRaw = (function () {
    try {
      var v = lsGet("cave-currency");
      return v && v.length > 0 ? v : "€";
    } catch (_e) { return "€"; }
  })();
  var _cur = useState(_curRaw),
    currencySymbol = _cur[0],
    setCurrencySymbolState = _cur[1];
  function saveCurrencySymbol(s: string) {
    var clean = (s || "").slice(0, 4) || "€";
    lsSet("cave-currency", clean);
    setCurrencySymbolState(clean);
  }
  // Pipe maintenance-reminder threshold — a pipe is flagged
  // "à entretenir" after this many sessions since its last maintenance.
  // Stored in localStorage["cave-maint-threshold"], default 5, clamped ≥ 1.
  var _mtRaw = (function () {
    try {
      // One-time forced reset to 5. A device that stored an
      // earlier value (e.g. 3) never picked up the default bump — the
      // stored value always wins. This runs ONCE per device (guarded by
      // cave-maint-threshold-reset68), rewrites the stored value to 5,
      // then hands control back: the user's own choice is honoured for
      // ever after and this branch never re-fires.
      if (lsGet("cave-maint-threshold-reset68") !== "1") {
        lsSet("cave-maint-threshold", "5");
        lsSet("cave-maint-threshold-reset68", "1");
        return 5;
      }
      var n = parseInt(lsGet("cave-maint-threshold") || "", 10); return n >= 1 ? n : 5;
    }
    catch (_e) { return 5; }
  })();
  var _mt = useState(_mtRaw),
    maintReminderThreshold = _mt[0],
    setMaintReminderThresholdState = _mt[1];
  function saveMaintReminderThreshold(v: any) {
    var n = parseInt(String(v), 10);
    var clean = n >= 1 ? n : 5;
    lsSet("cave-maint-threshold", String(clean));
    setMaintReminderThresholdState(clean);
  }
  // Master switch for the pipe maintenance-reminder indicator.
  // Default ON (absent or "1"); "0" turns OFF every reminder surface (Home
  // "À entretenir" section, PipesListView card chip, PipesDetailView Notice).
  // The threshold value is kept editable + untouched while OFF.
  var _mreRaw = (function () {
    try { return lsGet("cave-maint-reminders-enabled") !== "0"; }
    catch (_e) { return true; }
  })();
  var _mre = useState(_mreRaw),
    maintRemindersEnabled = _mre[0],
    setMaintRemindersEnabledState = _mre[1];
  function saveMaintRemindersEnabled(v: any) {
    var on = v !== false;
    lsSet("cave-maint-reminders-enabled", on ? "1" : "0");
    setMaintRemindersEnabledState(on);
  }
  // Date display format preference, decoupled from UI lang.
  // Defaults to "fr" (dd.mm.yyyy) for backward compatibility — most of
  // the user base is francophone. Switching to "en" renders dates as
  // "Mon D, YYYY" everywhere fmtDate is used. The native <input type="date">
  // controls remain controlled by the OS locale and are not affected.
  // `initDateFormat()` runs the one-shot migration from
  // `cave-lang` for users upgrading from build ≤132 (no explicit
  // date-format choice yet).
  var _df = useState(initDateFormat),
    dateFormat = _df[0],
    setDateFormat = _df[1];
  // Default list grouping preference. When false, every
  // list (tobaccos, pipes, wishlist, accessories, sessions) opens
  // flat at first mount. The user can still toggle per-list within
  // a session via the existing Étendre / Grouper button.
  var _dlg = useState(readDefaultGrouped()),
    defaultListGrouped = _dlg[0],
    setDefaultListGrouped = _dlg[1];
  // The `cave-show-drive-expired-banner` preference + its
  // toggle in Settings were removed. With the pendingSync gate
  // the banner only fires on a real unsynced change + expired token, so
  // letting users silence it would hide a genuine risk. The localStorage
  // key is left abandoned (not actively cleared on existing installs —
  // unused without a reader, harmless).
  var _sdw = useState(
      lsGet("cave-session-default-weight") || "3",
    ),
    sessDefaultWeight = _sdw[0],
    setSessDefaultWeight = _sdw[1];
  // User-configurable "À surveiller" threshold.
  // - cave-watch-low-weight: remaining-weight threshold under which a
  //   tobacco counts as "low stock" (any tobacco except one marked
  //   "à ne pas reprendre" / rebuy===false — the rating≥4 gate was
  //   dropped from the watchlist). Stored in the user's display unit
  //   and CONVERTED on unit toggle like sessDefaultWeight — see
  //   saveWeightUnit.
  // (The stale-open-jar signal + its cave-watch-stale-months
  //  threshold were removed — the Home alert was noise.)
  // Default low-stock threshold is 25 g (≈ 0.9 oz) — was 50 g.
  var _wlw = useState(
      lsGet("cave-watch-low-weight") ||
        (lsGet("cave-weight-unit") === "oz" ? "0.9" : "25"),
    ),
    watchLowWeight = _wlw[0],
    setWatchLowWeight = _wlw[1];
  function saveWatchLowWeight(v: string) {
    var n = parseFloat(String(v).replace(",", "."));
    var clamped = Number.isFinite(n) && n > 0 ? String(Math.min(10000, n)) : (weightUnit === "oz" ? "0.9" : "25");
    lsSet("cave-watch-low-weight", clamped);
    setWatchLowWeight(clamped);
  }
  // Global "accounting" toggle, simpler reincarnation of
  // an earlier experiment. When OFF, the session / tasting forms
  // hide the weight field and force `weightG = "0"` on save. The whole
  // weight machinery (deduction, auto-finish, stats, the "lot reaches
  // 0" heads-up) is naturally inert at weight=0 — no per-session flag,
  // no special branches in useSessionStore / utils / stats memos. The
  // cellar→jar confirm fires from lot status, not weight, so the
  // physical "I'm opening this tin" event keeps being recorded.
  // Default true; stored in `cave-accounting-enabled` ("0" = off).
  var _ae = useState(
      lsGet("cave-accounting-enabled") !== "0",
    ),
    accountingEnabled = _ae[0],
    setAccountingEnabledState = _ae[1];
  function saveAccountingEnabled(v: boolean) {
    lsSet("cave-accounting-enabled", v ? "1" : "0");
    setAccountingEnabledState(v);
  }
  // Preferred source for the AI auto-fill button.
  //  - "local" (the DEFAULT): check the catalogue the user loaded first, fall
  //    back to the provider API on miss. Instant, offline, and needs no key.
  //  - "ai": call the configured AI provider first, fall back to the
  //    catalogue only if the API errors out.
  //
  // The catalogue is the DEFAULT because it is the user's OWN file: someone
  // who took the trouble to load one certainly wants it consulted before a
  // paid API call. With none loaded the branch costs nothing — the lookup
  // misses, the provider is called if a key exists, and the error names the
  // real cause ("no catalogue loaded", not "no match in the catalogue").
  //
  // Only devices with NO stored value take the default: `saveAutofillSource`
  // writes on change, so anyone who has ever picked a source keeps their pick.
  // (Same rule as `ai-model-auto-migrated`: a default may move, a deliberate
  // choice may not.)
  //
  // "ai" only reaches the provider WHEN A KEY IS CONFIGURED — `runAutoFill`'s
  // AI-first branch goes straight to `tobaccoDbLookup` when `!apiKey`. That is
  // LOCKED rather than assumed (`autofillSourceDefault.test.ts`), because the
  // catalogue-offer defect it enables survived for months with the underlying
  // behaviour correct.
  //
  // Persisted in `cave-autofill-source`. The pipe form bypasses the catalogue
  // entirely (no pipe entries in it).
  var _afs = useState<"local" | "ai">(
      (lsGet("cave-autofill-source") === "ai" ? "ai" : "local"),
    ),
    autofillSource = _afs[0],
    setAutofillSourceState = _afs[1];
  function saveAutofillSource(v: "local" | "ai") {
    lsSet("cave-autofill-source", v);
    setAutofillSourceState(v);
  }
  // The no-value default is "en", not "fr". main.jsx seeds `cave-lang`
  // from the phone before React mounts, so this branch is only reached when
  // localStorage is unreadable — and English is then the one dictionary
  // guaranteed to be in memory, as well as the app's stated fallback.
  // And the STARTUP failure has to be reflected here too. main.jsx
  // awaits `ensureLang(stored)` but mounts either way, so a dictionary that
  // failed to download left `lang` on the stored code while `translate` served
  // English — the UI was English, the Settings picker highlighted DE, and no
  // notice explained it. Read what is ACTUALLY loaded: the picker then tells
  // the truth and the same `langErr` notice as the switch path says why.
  var _storedLng = lsGet("cave-lang") || "en";
  // "pseudo" is a real, usable language here even though it has no
  // dictionary — `t()` builds it from EN at call time. The
  // `isLangLoaded` guard did not know that, so `lang` fell to "en", the
  // `lang === "pseudo"` branch below became unreachable and a spurious langErr
  // was raised. Pseudo-loc is the ONE check that finds un-t()-ed strings
  // without anyone guessing the right grep, and it was dead for three releases
  // while CLAUDE.md kept recommending it. MEASURED: a DOM scan reported
  // 0 of 938 marked nodes before this line, 1706 of 3650 after.
  var _langUsable = (c: string) => c === "pseudo" || isLangLoaded(c);
  var _lng = useState(_langUsable(_storedLng) ? _storedLng : "en"),
    lang = _lng[0],
    setLang = _lng[1];
  // Language-switch UI state. `langPending` is the code being fetched
  // (a spinner in Settings); `langErr` is the code that could NOT be fetched —
  // the notice renders in the language still active, the only loaded one.
  var _lp = useState(""),
    langPending = _lp[0],
    setLangPending = _lp[1];
  // Raise it ONLY for a language the app actually HAS. A stored
  // code that is not a language at all (corrupt storage, a language dropped
  // from the registry, a profile carried over from another release) is not a
  // download failure, so "reconnect, then reload the app" is both false and
  // unactionable — and it rendered on the terms gate and in Settings on every
  // launch, for ever. English serving silently is the documented rule for an
  // unknown code; only a KNOWN language that failed to arrive gets the notice.
  var _le = useState(
    (_langUsable(_storedLng) || !isKnownLang(_storedLng)) ? "" : _storedLng),
    langErr = _le[0],
    setLangErr = _le[1];
  // Generation counter for concurrent language switches (see saveLang).
  var langGenRef = useRef(0);
  var _ta = useState(lsGet("cave-terms-accepted") === "1"),
    termsAccepted = _ta[0],
    setTermsAccepted = _ta[1];
  // Optional Drive backup encryption (Phase 1).
  // - `driveEncryptionEnabled`: persistent flag (localStorage). When ON,
  //   gdriveSave wraps the JSON in an AES-GCM envelope before upload.
  // - `drivePassphrase`: memory ONLY. Never persisted. Lost on reload —
  //   the user re-enters it via the unlock modal on next Drive op.
  // - `encryptionPrompt`: ephemeral { mode, resolve } pair; the
  //   PassphrasePromptModal reads it and calls resolve(pw|null) on
  //   submit / cancel, then the caller's Promise unblocks.
  var _de = useState<boolean>(lsGet("cave-drive-encryption-enabled") === "1"),
    driveEncryptionEnabled = _de[0],
    setDriveEncryptionEnabledState = _de[1];
  var _dpp = useState<string | null>(null),
    drivePassphrase = _dpp[0],
    setDrivePassphrase = _dpp[1];
  var _ep = useState<{ mode: "setup" | "unlock"; resolve: (pw: string | null) => void } | null>(null),
    encryptionPrompt = _ep[0],
    setEncryptionPrompt = _ep[1];
  function resolveEncryptionPrompt(pw: string | null) {
    if (encryptionPrompt) {
      // On a fresh SETUP, store a passphrase verifier so a
      // later unlock/save can reject a typo'd passphrase instead of silently
      // minting an unrecoverable backup (see cryptoBackup.makeEncryptionVerifier).
      // Fire-and-forget: the same-session save uses the cached passphrase (no
      // verify needed); the verifier matters only after a reload.
      if (pw && encryptionPrompt.mode === "setup") {
        makeEncryptionVerifier(pw)
          .then(function (m) { lsSet("cave-drive-enc-verifier", m); })
          .catch(function () { /* crypto unavailable → skip; unlock stays lenient */ });
      }
      encryptionPrompt.resolve(pw);
      setEncryptionPrompt(null);
    }
  }
  // Returns a Promise that resolves with the entered passphrase, or null
  // if the user cancels. Used by gdriveSave / gdriveRestore to fetch the
  // passphrase on-demand when memory is empty.
  function requestDrivePassphrase(mode: "setup" | "unlock"): Promise<string | null> {
    return new Promise(function (ok) {
      setEncryptionPrompt({ mode: mode, resolve: ok });
    });
  }
  function saveDriveEncryptionEnabled(v: boolean) {
    lsSet("cave-drive-encryption-enabled", v ? "1" : "0");
    setDriveEncryptionEnabledState(v);
    if (!v) {
      setDrivePassphrase(null); // disabling clears the memory passphrase
      // Drop the verifier too — a later re-enable sets a new
      // passphrase, and a stale verifier would reject it.
      lsRemove("cave-drive-enc-verifier");
    }
  }
  function acceptTerms() {
    lsSet("cave-terms-accepted", "1");
    setTermsAccepted(true);
  }
  var _se = useState<string | null>(null),
    saveError = _se[0],
    setSaveError = _se[1];
  var _sop = useState<boolean>(false),
    searchOpen = _sop[0],
    setSearchOpen = _sop[1];
  // Seed the Catalogue search from a global-search catalog hit.
  // SearchModal sets it + nav("catalog"); CatalogView consumes it once to
  // prefill its search box, then clears it.
  var _cseed = useState<string>(""),
    catalogSeed = _cseed[0],
    setCatalogSeed = _cseed[1];
  // Which wishlist item the user asked to be taken to.
  // Same consumed-once shape as catalogSeed: SearchModal sets it alongside
  // nav("inv") + statusFilter "wish", InventoryListView reveals that card
  // (expanding its brand group if collapsed) and clears it.
  //
  // A wish has no fiche — the CARD is the read-only detail — so "open this
  // wish" can only mean "show me this card". It must NOT open the edit form:
  // an earlier release deliberately removed whole-card tap-to-edit from WishCard
  // because users expected the read-only behaviour of the other cards and got
  // a form ("No surprise edits"), and a search result is the same expectation.
  var _wfocus = useState<any>(null),
    wishFocusId = _wfocus[0],
    setWishFocusId = _wfocus[1];
  // Dedicated Trash modal (was a section inside Settings).
  // Toggled by the Home top-bar trash icon when the user has anything
  // soft-deleted.
  var _trsh = useState<boolean>(false),
    trashOpen = _trsh[0],
    setTrashOpen = _trsh[1];
  // "Liste de courses" modal (restock + wishlist), opened from the
  // inventory top bar cart icon.
  var _shop = useState<boolean>(false),
    shoppingOpen = _shop[0],
    setShoppingOpen = _shop[1];
  // Settings active tab lives in App.tsx (not inside
  // the modal) so external callers — the update pill, the export-
  // reminder banner, the save-error banner — can pre-position the
  // user on the right tab BEFORE opening the modal. Persisted in
  // localStorage so the user returns to the same tab between sessions;
  // defaults to "prefs" (Préférences, which sits first).
  var _stab = useState<"data" | "prefs" | "app" | "help">(function () {
    try {
      var saved = lsGet("cave-settings-tab");
      if (saved === "data" || saved === "prefs" || saved === "app" || saved === "help") return saved;
    } catch (_e) {}
    return "prefs";
  });
  var settingsTab = _stab[0];
  function setSettingsTab(t: "data" | "prefs" | "app" | "help") {
    _stab[1](t);
    lsSet("cave-settings-tab", t);
  }

  // In-app help view state — which sections are
  // collapsed. Default state (key absent) is EXPANDED so the user lands
  // on a fully readable manual; collapsing a section is the explicit
  // action ({key: true}). Persisted in localStorage so the user returns
  // to the same layout between sessions.
  var _chs = useState<Record<string, true>>(function () {
    try {
      var saved = lsGet("cave-help-sections");
      if (saved) {
        var parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (_e) {}
    return {};
  });
  var collapsedHelpSections = _chs[0];
  function persistCollapsedHelp(next: Record<string, true>) {
    _chs[1](next);
    lsSet("cave-help-sections", JSON.stringify(next));
  }
  function toggleHelpSection(key: string) {
    var next = Object.assign({}, collapsedHelpSections);
    if (next[key]) delete next[key];
    else next[key] = true;
    persistCollapsedHelp(next);
  }
  function setAllHelpSectionsCollapsed(collapsed: boolean, keys: string[]) {
    if (collapsed) {
      var next: Record<string, true> = {};
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k) next[k] = true;
      }
      persistCollapsedHelp(next);
    } else {
      persistCollapsedHelp({});
    }
  }
  var _sw = useState<string | null>(null),
    saveWarn = _sw[0],
    setSaveWarn = _sw[1];
  var _pe = useState(""),
    photoErr = _pe[0],
    setPhotoErr = _pe[1];
  // Android Chrome `beforeinstallprompt` capture. Chrome
  // fires this event when the PWA is installable; intercepting it
  // (preventDefault + stash) lets us surface a proper "Install"
  // affordance from Settings instead of relying on Chrome's throttled
  // mini-infobar. iOS Safari does not fire this event — iOS users
  // still install via the help.html instructions (Share → Add to Home
  // Screen). The event is cleared on `appinstalled` and after the
  // user accepts / dismisses the prompt (Chrome won't re-fire BIP for
  // a while after a dismissal, so we don't try to keep stale events).
  var _ip = useState<any>(null),
    installPromptEvent = _ip[0],
    setInstallPromptEvent = _ip[1];
  // Undo-after-delete toast state. `null` when no pending
  // undo, otherwise a snapshot-driven restore handle. The wrapper that
  // populates this is defined further down (`withUndo`); the
  // auto-clear effect below dismisses the toast 8 s after `ts`.
  var _ut = useState<null | { kind: string; label: string; ts: number; restoreFn: () => void }>(null),
    undoToast = _ut[0],
    setUndoToast = _ut[1];
  // Export-reminder banner. Raised when the user has data
  // and hasn't saved (Drive or local file) for > 30 days, OR has 5+
  // entries and has never exported. Dismissal is suppressed for 7
  // days via `cave-export-reminder-dismissed`. The actual probe runs
  // in the effect below; success paths of every export/save call
  // `markExported()` to bump the timestamp and clear the banner.
  var _er = useState<boolean>(false),
    exportReminder = _er[0],
    setExportReminder = _er[1];
  function markExported() {
    lsSet("cave-last-export-ts", String(Date.now()));
    setExportReminder(false);
  }
  // The earlier `<html lang>` sync effect was REMOVED, and must NOT come back.
  // Mutating document.documentElement in an iOS standalone PWA recomputed
  // the fixed-position layer and made the bottom dock float mid-page (only
  // in the installed PWA — Safari was fine; it appeared the day the effect
  // shipped). The a11y/SEO benefit (screen-reader pronunciation) does not
  // justify a broken nav bar; index.html still ships a static lang="fr".
  // If we ever re-add it, set the attribute ONCE before React mounts (in
  // main.jsx), never in a React effect that re-runs on every lang change.

  useEffect(function () {
    if (!undoToast) return;
    var id = setTimeout(function () { setUndoToast(null); }, 8000);
    return function () { clearTimeout(id); };
    // setUndoToast is a useState setter — stable, listed only to
    // silence react-hooks/exhaustive-deps.
  }, [undoToast, setUndoToast]);

  // Reflect the "Taille du texte" (S/M/L) preference onto the
  // <html> CSS variable that every fs()-based font-size multiplies by. No
  // React re-render needed elsewhere — the browser rescales live. Runs on
  // mount and whenever the preference changes.
  useEffect(function () {
    var factor = fontScale === "s" ? 0.9 : fontScale === "l" ? 1.12 : 1;
    try { document.documentElement.style.setProperty("--cave-font-scale", String(factor)); } catch (_e) { /* ignore */ }
  }, [fontScale]);

  // Reflect the colour theme onto the brass CSS vars on <html>
  // (same live, no-re-render mechanism as --cave-font-scale). main.jsx seeds
  // it before first paint; this keeps it in sync on change.
  useEffect(function () {
    try { applyTheme(themeId, themeMode); } catch (_e) { /* ignore */ }
    // Keep the status-bar / letterbox tint in step with the mode (the meta
    // is a non-layout element, so this is safe unlike an <html> attribute).
    try {
      var m = document.querySelector('meta[name="theme-color"]');
      // Derived from theme-curator (THEME_COLOR_META) — the light
      // value was this file's own copy of MODE_LIGHT["--c-bg"].
      if (m) m.setAttribute("content", themeMode === "light" ? THEME_COLOR_META.light : THEME_COLOR_META.dark);
    } catch (_e) { /* ignore */ }
  }, [themeId, themeMode]);

  // Clear the EB chunk-recovery timestamp on successful
  // mount when it's older than 5 min — we got past render so whatever
  // triggered the previous purge-and-reload was a one-off (probably
  // an SW cache race), and we want a future failure to auto-recover
  // again instead of being suppressed by a stale flag. Done in a
  // mount-only effect (no deps) so it runs exactly once per launch.
  useEffect(function () {
    try {
      var raw = lsGet("cave-eb-recovery-ts");
      if (!raw) return;
      var ts = parseInt(raw, 10);
      if (isFinite(ts) && Date.now() - ts > 5 * 60_000) {
        lsRemove("cave-eb-recovery-ts");
      }
    } catch (_e) {}
  }, []);

  // Proactive storage-quota warning → useStorageQuotaWarning.
  var dismissQuotaWarn = useStorageQuotaWarning(data, lang, t, setSaveWarn);

  useEffect(function () {
    function onBIP(e: any) {
      // Stop Chrome's default mini-infobar; we'll surface our own CTA.
      e.preventDefault();
      setInstallPromptEvent(e);
    }
    function onInstalled() {
      setInstallPromptEvent(null);
    }
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return function () {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
    // setInstallPromptEvent is a useState setter — stable across renders,
    // so listing it is just to silence react-hooks/exhaustive-deps.
  }, [setInstallPromptEvent]);
  function triggerInstall() {
    if (!installPromptEvent || typeof installPromptEvent.prompt !== "function") return;
    try { installPromptEvent.prompt(); } catch (_e) {}
    var uc = installPromptEvent.userChoice;
    if (uc && typeof uc.then === "function") {
      uc.then(function () { setInstallPromptEvent(null); })
        .catch(function () { setInstallPromptEvent(null); });
    } else {
      setInstallPromptEvent(null);
    }
  }
  // The dictionary must be IN MEMORY before the language state
  // flips, because `t()` is synchronous — switching first would render one frame
  // of English (or of raw keys) before the chunk arrives. English is compiled
  // in, so picking it is instant; the other four are fetched here.
  //
  // FAILURE (offline, and that language never downloaded): `ensureLang` resolves
  // false and we DO NOT switch. Staying on the current language beats dropping a
  // German user to English for a choice that did not take effect. `langErr`
  // carries the notice — rendered in the language they still have, which is the
  // only one guaranteed loaded.
  function saveLang(l: string) {
    if (isLangLoaded(l)) {
      lsSet("cave-lang", l);
      // An explicit language choice (terms gate or Settings) cancels
      // the pending "auto-detected" toast — the pick was deliberate.
      lsRemove("cave-lang-auto");
      setLangErr("");
      setLang(l);
      return;
    }
    // Last tap wins. Two switches can be in flight at once (tap DE on
    // a slow connection, then IT), and without a generation guard whichever
    // request RESOLVED last applied — so tapping IT after DE could leave the app
    // in German. The counter also stops the first resolution from clearing the
    // spinner while a later fetch is still running.
    var gen = ++langGenRef.current;
    setLangPending(l);
    ensureLang(l).then(function (ok) {
      if (gen !== langGenRef.current) return;   // superseded by a later tap
      setLangPending("");
      if (!ok) { setLangErr(l); return; }
      lsSet("cave-lang", l);
      lsRemove("cave-lang-auto");
      setLangErr("");
      setLang(l);
    });
  }
  function saveFontScale(v: string) {
    // Accept only the three known steps; anything else falls back to "m".
    var next = (v === "s" || v === "l") ? v : "m";
    lsSet("cave-font-scale", next);
    setFontScale(next);
  }
  function saveThemeId(v: string) {
    // Accept only a known theme id; anything else falls back to "brass".
    var next = THEMES[v] ? v : "brass";
    lsSet("cave-theme", next);
    setThemeId(next);
  }
  function saveThemeMode(v: string) {
    var next = v === "light" ? "light" : "dark";
    lsSet("cave-theme-mode", next);
    setThemeMode(next);
  }
  function saveWeightUnit(u: string) {
    // Convert the two unit-scoped weights
    // (sessDefaultWeight + watchLowWeight) via the pure, finite-guarded
    // convertWeightUnit — see its doc. The old inline `|| N` fallback +
    // 1-dp oz rounding corrupted small values (a 1 g default → 85 g, a 1 g
    // low-stock threshold → 1418 g on a g→oz→g round-trip). A `null` return
    // means "leave the stored value untouched" (empty/garbage → the read-site
    // display default keeps applying).
    var nd = convertWeightUnit(sessDefaultWeight, weightUnit, u);
    if (nd !== null) {
      lsSet("cave-session-default-weight", nd);
      setSessDefaultWeight(nd);
    }
    var nw = convertWeightUnit(watchLowWeight, weightUnit, u);
    if (nw !== null) {
      lsSet("cave-watch-low-weight", nw);
      setWatchLowWeight(nw);
    }
    lsSet("cave-weight-unit", u);
    setWeightUnit(u);
  }
  function saveLengthUnit(u: string) {
    lsSet("cave-length-unit", u);
    setLengthUnit(u);
  }
  function saveDateFormat(f: string) {
    lsSet("cave-date-format", f);
    setDateFormat(f);
  }
  function saveDefaultListGrouped(v: boolean) {
    // Persist the preference and propagate to every live store so the
    // current page reflects the change immediately. The stores' init
    // closures only read localStorage on first mount; without these
    // setters, the toggle would only take effect on next reload.
    lsSet("cave-default-grouped", v ? "1" : "0");
    setDefaultListGrouped(v);
    setTobGrouped(v);
    setPipesGrouped(v);
    setWishGrouped(v);
    setAccsGrouped(v);
    // The JOURNAL grouping is intentionally NOT driven by the global
    // setting anymore — it always defaults to grouped so the "collapse all but
    // the latest month" default works. The journal keeps its own toggle.
  }
  function t(k: string): string {
    // Pseudo-localization mode. Activate via DevTools:
    //   localStorage.setItem("cave-lang", "pseudo"); location.reload();
    // Wraps every EN string in ⟦ … ⁂⟧ and replaces vowels/some consonants
    // with accented variants. Reveals truncation, overflow, missing t()
    // calls and brittle layout assumptions BEFORE adding a real 3rd
    // language. {placeholder} syntax is preserved so interpolation
    // still works. Not exposed in the language switcher UI on purpose.
    if (lang === "pseudo") {
      // A key with an intentional empty-string value ("") must stay empty,
      // NOT fall back to the raw key — translate() handles the nullish case.
      var enSrc = translate("en", k);
      return enSrc === "" ? "" : pseudoize(enSrc);
    }
    return translate(lang, k);
  }
  function pseudoize(s: string): string {
    if (typeof s !== "string") return s;
    var map: Record<string, string> = {
      a: "å", e: "é", i: "î", o: "ø", u: "ú", y: "ý",
      A: "Å", E: "É", I: "Î", O: "Ø", U: "Ú", Y: "Ý",
      c: "ç", n: "ñ", s: "š", N: "Ñ", S: "Š",
    };
    // Preserve {…} placeholders so interpolation keeps working.
    var parts = String(s).split(/(\{[^}]+\})/g);
    var out = parts.map(function (p, i) {
      return i % 2 === 1 ? p : String(p).replace(/[a-zA-Z]/g, function (ch) { return map[ch] || ch; });
    }).join("");
    return "⟦ " + out + " ⁂⟧";
  }
  function xl(v: any, map: any) {
    // Translate a canonical (French) enum value to the active language.
    // French is canonical → returned as-is. Every other language resolves
    // its map from ENUM_TRANSLATIONS (keyed by the passed English map), so
    // call sites stay `xl(value, XXX_EN)` and adding a language is a
    // constants.ts-only edit. Falls back to the canonical value when a
    // translation is missing.
    // `hasOwnProperty`, not a bare index. Every `_XX` enum map
    // is a plain object literal, so `m["__proto__"]` resolves to
    // `Object.prototype` — TRUTHY, so `|| v` never fires — and `m["toString"]`
    // to a FUNCTION. Both are rendered as a React child at the call sites, and
    // an object child THROWS ("Objects are not valid as a React child"), which
    // the error boundary turns into the full-screen failure page.
    // Reachable since the catalogue became the user's own file:
    // `parseCatalogueCsv` keeps an unrecognised taxonomy label VERBATIM on
    // purpose, so a row saying `category: __proto__` reaches here — and only in
    // a NON-French UI, since French returns early, which is precisely the kind
    // of asymmetry nobody stumbles on by testing.
    // Guarded at this ONE choke point rather than by null-prototyping ~50 maps
    // in constants.ts: the map arrives as a PARAMETER, so every caller and
    // every future map is covered by the same three lines (the
    // `safeBgUrl` argument — the source is many sites and the sink is one).
    // `effectiveAgingMax` and `CUT_DENSITY` got this guard earlier; `xl`
    // and `catColor` are the two sites that pass was missing.
    if (!v || lang === "fr") return v;
    var byLang = ENUM_TRANSLATIONS.get(map);
    var m = byLang ? byLang[lang] : map; // unregistered map → use as-is (legacy)
    if (!m || !Object.prototype.hasOwnProperty.call(m, v)) return v;
    var out = m[v];
    return typeof out === "string" && out ? out : v;
  }
  function ageLabel(d: any) {
    if (d === null || d === undefined) return "\u2014";
    if (d < 30) return d + t("age_d");
    if (d < 365) return Math.floor(d / 30) + t("age_mo");
    var y = Math.floor(d / 365),
      // Latent-bug fix: cap the months component at 11. The
      // remainder `d % 365` reaches 364, and 364/30 = 12 \u2192 floor 12, so an
      // age like 729 days rendered "1 an 12 mois" instead of ~"2 ans". A
      // 12-month component is never valid \u2014 clamp it to 11.
      mo = Math.min(11, Math.floor((d % 365) / 30));
    return mo > 0 ? y + t("age_y") + " " + mo + t("age_m") : y + t("age_y");
  }

  var load = useCallback(function () {
    appStorage
      .get(SK)
      .then(function (r) {
        var parsed: any = null;
        if (r && r.value) {
          try {
            parsed = JSON.parse(r.value);
          } catch (_e) {}
        }
        // ONE "has any data" predicate across all three
        // checks (emptiness → restore acceptance → clear-bkp). They once
        // used inconsistent collection sets — restore only accepted a snapshot
        // with tobaccos/pipes (so a wishlist-/accessory-/sessions-only cellar
        // whose SK was lost across an iOS OAuth redirect was dropped), and the
        // clear-bkp check omitted accessories (stale -bkp lingered).
        var _hasAnyData = function (o: any) {
          return !!(o && ((o.tobaccos || []).length || (o.pipes || []).length
            || (o.accessories || []).length || (o.wishlist || []).length
            || (o.sessions || []).length));
        };
        if (!_hasAnyData(parsed)) {
          var bkpTs = parseInt(lsGet(SK + "-bkp-ts") || "0");
          if (bkpTs && Date.now() - bkpTs < 600000) {
            var bkpVal = lsGet(SK + "-bkp");
            if (bkpVal) {
              try {
                var bd = JSON.parse(bkpVal);
                if (_hasAnyData(bd)) {
                  parsed = bd;
                  appStorage.set(SK, bkpVal).catch(function () {});
                }
              } catch (_e) {}
            }
          }
        }
        if (_hasAnyData(parsed)) {
          lsRemove(SK + "-bkp");
          lsRemove(SK + "-bkp-ts");
        }
        // If migrateData is about to BACKFILL a uid
        // on any uid-less top-level entity, persist the result immediately —
        // otherwise a browse-only session (which never calls save()) keeps the
        // uid-less rows in localStorage and re-mints FRESH uids on every launch,
        // so an export taken before the first save carries ephemeral uids and
        // re-importing it later can duplicate same-name blends. A direct write
        // (not save()) avoids pendingSync / auto-save / invariant side effects;
        // it fires once (next load sees uids present → no backfill → no write).
        var _needUidPersist = false;
        try {
          var _checkUidArr = function (arr: any) {
            if (Array.isArray(arr)) arr.forEach(function (r: any) {
              if (r && typeof r === "object" && !(typeof r.uid === "string" && r.uid)) _needUidPersist = true;
            });
          };
          ["tobaccos", "pipes", "accessories", "wishlist"].forEach(function (kk) {
            _checkUidArr(parsed && (parsed as any)[kk]);
          });
          // Also detect uid-less LOTS (per tobacco) + MAINTENANCE
          // entries (per pipe) so the sub-record backfill persists too (same
          // one-time direct-write rationale as the entities).
          var _puTobs = parsed && (parsed as any).tobaccos;
          if (Array.isArray(_puTobs)) _puTobs.forEach(function (t: any) { if (t) _checkUidArr(t.lots); });
          var _puPipes = parsed && (parsed as any).pipes;
          if (Array.isArray(_puPipes)) _puPipes.forEach(function (p: any) { if (p) _checkUidArr(p.maintenance); });
        } catch (_e) { /* noop */ }
        var _migrated = migrateData(parsed || Object.assign({}, INIT));
        setData(_migrated);
        if (_needUidPersist) {
          try { appStorage.set(SK, JSON.stringify(_migrated)).catch(function () {}); } catch (_e) { /* noop */ }
        }
        setLoading(false);
      })
      .catch(function () {
        setData(Object.assign({}, INIT));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Ref-mirror of triggerIosAutosaveReauth so the
  // useCallback `save` (which is `[]`-deps for stability) can reach the
  // latest function without going stale.
  var triggerIosAutosaveReauthRef = useRef<(() => void) | null>(null);
  useEffect(function () {
    triggerIosAutosaveReauthRef.current = triggerIosAutosaveReauth || null;
  });
  var save = useCallback(function (nd: any) {
    // Runtime invariants check. In dev this surfaces lot
    // lifecycle violations via console.error; in prod it stays as a
    // warning so the user's data is never blocked by a transient
    // inconsistency. Tests can call checkLotInvariants directly.
    // Pass the raw `nd` (not liveData): the check functions skip rows with
    // `deletedAt` internally so trashed rows aren't validated. (A later
    // policy dropped the session→tobacco/pipe cross-ref invariants entirely —
    // dangling refs are now an expected state rendered via the snapshot — so
    // this no longer guards against a "pipeId not found" false positive; it
    // just keeps the lot/session/balance invariants running on every persist.)
    assertLotInvariants(nd);
    setData(nd);
    setPendingSync(true);
    lsSet("cave-pending-sync", "1");
    try {
      lsRemove(SK + "-bkp");
      lsRemove(SK + "-bkp-ts");
    } catch (_e) {}
    var json = JSON.stringify(nd);
    appStorage.set(SK, json).catch(function (e) {
      console.error("Save error:", e.name, e.message);
      var isQuota =
        e.name === "QuotaExceededError" ||
        e.name === "NS_ERROR_DOM_QUOTA_REACHED";
      if (isQuota) {
        var slim = JSON.parse(json);
        var oldVals: Record<string, any> = {};
        var promises: any[] = [];
        function migrateArr(arr: any, type: any) {
          (arr || []).forEach(function (obj: any) {
            if (
              obj &&
              obj.id &&
              obj.imageUrl &&
              obj.imageUrl.indexOf("data:") === 0
            ) {
              var key = "local-photo-" + type + "-" + obj.id;
              oldVals[key] = obj.imageUrl;
              obj.imageUrl = key;
              promises.push(imgCache.put(key, oldVals[key]));
            }
          });
        }
        migrateArr(slim.tobaccos, "t");
        migrateArr(slim.pipes, "p");
        migrateArr(slim.accessories, "a");
        migrateArr(slim.wishlist, "w");
        Promise.all(promises)
          .then(function () {
            return appStorage.set(SK, JSON.stringify(slim));
          })
          .then(function () {
            setData(slim);
            // Read the language directly from storage so the message
            // tracks the current preference even though save() is a
            // useCallback bound at mount time (its deps list doesn't
            // include `lang` on purpose — see closure note above).
            var _lng = lsGet("cave-lang") || "en";
            if (Object.keys(oldVals).length) {
              setImgLocal(function (prev) {
                return imgMap(prev, oldVals);
              });
              setSaveWarn(((LANG as any)[_lng] || (LANG as any).en)?.warn_storage_full_cache
                || "⚠️ Stockage plein — photos déplacées vers le cache local. Sauvegardez sur Drive.");
            } else {
              setSaveError(((LANG as any)[_lng] || (LANG as any).en)?.warn_storage_too_full
                || "⚠️ Stockage trop plein. Exportez vos données.");
            }
          })
          .catch(function () {
            var _lng = lsGet("cave-lang") || "en";
            setSaveError(((LANG as any)[_lng] || (LANG as any).en)?.warn_storage_too_full_urgent
              || "⚠️ Stockage trop plein — exportez vos données immédiatement.");
          });
      } else {
        var _lng = lsGet("cave-lang") || "en";
        // Delegated to `getStorageBlockedHint` so the iOS↔Android
        // breadcrumb pair lives in one place (utils.ts).
        var _hint = getStorageBlockedHint(_lng, IS_IOS);
        var _prefix = String(((LANG as any)[_lng] || (LANG as any).en)?.warn_backup_failed_prefix
          || "⚠️ Sauvegarde impossible ({name}) — ").replace("{name}", e.name);
        setSaveError(_prefix + _hint);
      }
    });
    // Centralized iOS auto-save piggyback. Fires once per
    // save() — the helper short-circuits on non-iOS, on programmatic
    // contexts (no recent user gesture), when the token is still good,
    // when an OAuth round-trip is already in flight, etc. So this is
    // essentially free outside the narrow "iOS + recent user save +
    // expired token + previously engaged with Drive" window.
    if (triggerIosAutosaveReauthRef.current) triggerIosAutosaveReauthRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    function () {
      load();
    },
    [load],
  );
  useEffect(
    function () {
      if (!data) return;
      var keys: string[] = [];
      function chk(obj: any) {
        if (obj && obj.imageUrl && obj.imageUrl.indexOf("local-photo-") === 0)
          keys.push(obj.imageUrl);
      }
      (data.tobaccos || []).forEach(chk);
      (data.pipes || []).forEach(chk);
      (data.accessories || []).forEach(chk);
      (data.wishlist || []).forEach(chk);
      // Also resolve the photos referenced ONLY by a
      // session snapshot (tobaccoSnapshot / pipeSnapshot). Once the parent
      // entity is permanently purged, the snapshot is the sole reference; the
      // blob still exists (gcOrphans + gatherLocalImages walk snapshots), but
      // without this the journal rendered the raw `local-photo-X` string as a
      // broken <img>. Mirrors what the GC + backup already do.
      (data.sessions || []).forEach(function (s: any) {
        if (s) { chk(s.tobaccoSnapshot); chk(s.pipeSnapshot); }
      });
      if (!keys.length) return;
      Promise.all(
        keys.map(function (k) {
          return imgCache.get(k).then(function (v) {
            return { k: k, v: v };
          });
        }),
      )
        .then(function (res) {
          var upd: Record<string, any> = {};
          res.forEach(function (r) {
            if (r.v) upd[r.k] = r.v;
          });
          if (Object.keys(upd).length)
            setImgLocal(function (prev) {
              return imgMap(prev, upd);
            });
        })
        .catch(function () {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );
  useEffect(
    function () {
      if (!data) return;
      // Crypto.randomUUID() — collision-resistant, supported on every
      // target browser (Safari 15.4+ / Chrome 92+ / Firefox 95+); the fallback
      // keeps older runtimes working.
      function _rnd() {
        return (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2, 12);
      }
      // Collect every legacy inline-base64 imageUrl to migrate into IndexedDB.
      var _tasks: { item: any; key: string; du: string }[] = [];
      var _collect = function (arr: any) {
        (arr || []).forEach(function (item: any) {
          if (item && typeof item.imageUrl === "string" && item.imageUrl.indexOf("data:") === 0) {
            _tasks.push({ item: item, key: "local-photo-" + Date.now() + "-" + _rnd(), du: item.imageUrl });
          }
        });
      };
      _collect(data.tobaccos); _collect(data.pipes);
      _collect(data.accessories); _collect(data.wishlist);
      if (_tasks.length === 0) return;
      // Only swap imageUrl → key for photos that ACTUALLY
      // persisted to IndexedDB. imgCache.put resolves false (and open() can
      // reject) under quota pressure / Safari private mode; the original code
      // swapped + saved unconditionally, so a failed write left the entity
      // pointing at a key with no blob → permanently broken photo on reload.
      // A failed write keeps the base64 inline (renders + retries next load) —
      // mirrors handlePhotoUpload's fallback.
      var _okKeys: Record<string, true> = Object.create(null);
      Promise.all(_tasks.map(function (tk) {
        return imgCache.put(tk.key, tk.du).then(function (ok: any) {
          if (ok !== false) {
            _okKeys[tk.key] = true;
            setImgLocal(function (prev) { var n = imgMap(prev); n[tk.key] = tk.du; return n; });
          }
        }).catch(function () { /* open() rejected → keep base64 inline */ });
      })).then(function () {
        if (Object.keys(_okKeys).length === 0) return; // nothing persisted → don't rewrite
        var _swap = function (arr: any) {
          return (arr || []).map(function (item: any) {
            var tk = _tasks.find(function (x) { return x.item === item; });
            return (tk && _okKeys[tk.key]) ? Object.assign({}, item, { imageUrl: tk.key }) : item;
          });
        };
        var _nd = Object.assign({}, data, {
          tobaccos: _swap(data.tobaccos), pipes: _swap(data.pipes),
          accessories: _swap(data.accessories), wishlist: _swap(data.wishlist),
        });
        save(_nd);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );
  useEffect(
    function () {
      if (!data) return;
      var urls: string[] = [];
      (data.tobaccos || []).forEach(function (t) {
        if (t.imageUrl) urls.push(t.imageUrl);
      });
      (data.pipes || []).forEach(function (p) {
        if (p.imageUrl) urls.push(p.imageUrl);
      });
      (data.accessories || []).forEach(function (a) {
        if (a.imageUrl) urls.push(a.imageUrl);
      });
      (data.wishlist || []).forEach(function (w) {
        if (w.imageUrl) urls.push(w.imageUrl);
      });
      if (!urls.length) return;
      // Replaced the hand-rolled `pending--` counter with a
      // proper `Promise.all`. The counter was shared mutable state
      // between every .then() / .catch() callback in the forEach loop;
      // if two cache hits resolved in the same micro-task the counter
      // could be decremented "concurrently" (well, interleaved) and
      // setImgLocal could either fire twice with partial state OR not
      // fire at all if both branches saw `pending > 0` on the same
      // read. Promise.allSettled guarantees we collect every result
      // before the single setImgLocal call. Same behaviour on the
      // happy path, no race in degenerate timings.
      Promise.allSettled(
        urls.map(function (u: string) {
          return imgCache.get(u).then(function (cached) {
            return { url: u, cached };
          });
        }),
      ).then(function (results) {
        var newLocal: Record<string, any> = {};
        results.forEach(function (r) {
          if (r.status === "fulfilled" && r.value && r.value.cached) {
            newLocal[r.value.url] = r.value.cached;
          }
        });
        setImgLocal(function (prev) {
          return imgMap(prev, newLocal);
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  function nav(v: string, opts?: { restoreScroll?: boolean }) {
    // Push the screen we're LEAVING onto the back-history stack —
    // UNLESS this nav() is itself a goBack restore (guarded) or a no-op to the
    // same view. captureLoc reads the live state BEFORE the resets below, so
    // an open detail fiche is captured too (back from an edit form returns to
    // the fiche, not just the list). Forms + tasting are filtered out by
    // pushLoc so they're never a back TARGET.
    // A MAIN page (dock tab) is a ROOT, not a history cran —
    // landing on one CLEARS the back stack so back from any main page goes to
    // Home. Only a drill into a SUB-screen (form / catalog / doc / fiche-via-
    // nav) records the screen we're leaving. This kills the "back always
    // returns to the last-open fiche" bug (navigating away from an open fiche
    // via a dock tab used to push that fiche as a drill state).
    if (!restoringBackRef.current && v !== view) {
      navHistoryRef.current = nextStackOnNav(navHistoryRef.current, v, captureLoc());
    }
    // Default: forward navigation scrolls to top. Callers that mean
    // "going back to a previous list / closing a sub-form" pass
    // { restoreScroll: true } so the useEffect lets scrollSaveRef
    // restore the previous position instead.
    if (!opts || !opts.restoreScroll) {
      scrollToTopRef.current = true;
    }
    // Auto-save the CURRENT list-view scroll position
    // before navigating away. Previously this was only done on detail
    // open (ctxSetDetail / ctxSetPipeDet / ctxSetAccDet), so going from
    // a list directly to a form via the "+" button or to the journal
    // editor never had the scroll snapshotted — coming back with
    // restoreScroll:true read 0 and snapped to the top.
    // Skip the save when a detail panel is currently open.
    // In that case window.scrollY belongs to the detail view (which
    // scrolled to top on open), NOT the underlying list — overwriting
    // with 0 wiped the position saved by ctxSetDetail / ctxSetPipeDet /
    // ctxSetAccDet, so the post-save restore landed at the top.
    var _hasDetail = !!(detail || pipeDet || accDet);
    if (!_hasDetail) {
      if (view === "inv")     scrollSaveRef.current["inv"]     = window.scrollY || 0;
      if (view === "pipes")   scrollSaveRef.current["pipes"]   = window.scrollY || 0;
      if (view === "acc")     scrollSaveRef.current["acc"]     = window.scrollY || 0;
      if (view === "journal") scrollSaveRef.current["journal"] = window.scrollY || 0;
    }
    fromWishRef.current = null;
    setView(v);
    setDetail(null);
    setPipeDet(null);
    // Clear the session-detail modal on any nav so it can't leak
    // across a view change (JournalView only renders it while view==="journal").
    setSessionDetail(null);
    // BUG FIX: do NOT reset editXxxId / xxxForm here.
    // The edit handlers (in InventoryDetailView / PipesDetailView /
    // AccessoryDetailView / JournalView) call:
    //     setXxxForm({...BX, p}); setEditXxxId(p.id); nav("editX")
    // React batches all setStates in the same event handler and
    // applies them in order — so resetting editXxxId / xxxForm
    // inside nav() (which runs AFTER the handler's setXxxForm /
    // setEditXxxId calls) silently wiped the user's intent. Save
    // then matched no row (`p.id === null` never true) and the edit
    // was lost. The clean lifecycle for these states is:
    //   - set by the edit handler
    //   - cleared by the form's cancel() or by the store's
    //     updateXxx()/addXxx() success path
    // Nothing else should touch them.
    setSearch("");
    // Nav defaults to "Actifs" (matches the useState default
    // above). Charts-driven entries via navToInvFiltered explicitly set
    // "active" too, so every entry point converges to the same view.
    setStatusFilter("active");
    setAddLotMode(false);
    setEditLotIdx(null);
    setLotDet(null);
    setShowFinished(false);
    setShowFinishedPipes(false);
    setShowWishForm(false);
    setCatFilter("");
    setCutFilter("");
    setBrandFilter("");
    setTagFilter("");
    setAromaFilter([]);
    // Reset the TOBACCO rating filter too. nav() reset every other
    // tobacco filter (cat/cut/brand/aroma) + the PIPE rating filter, but the
    // tobacco `ratingFilter` was missing — so a lingering N-star filter (set in
    // the inventory list) survived a nav() and silently narrowed the "Tabacs"
    // top-bar drill (e.g. the reported "click 47 tabacs → only 5★ shown").
    setRatingFilter(0);
    setPShapeFilter("");
    setPBrandFilter("");
    setPFilterFilter("");
    setPRatingFilter(0);
    // Any forward nav() lands on a fresh screen — the current
    // overlay (if any) is closed below, so it's no longer a drill target.
    drillOverlayRef.current = false;
    // New pipe material filters + journal filters lifted
    // from JournalView local state. Reset alongside the rest so a
    // forward nav() lands on a clean filter slate.
    setPBowlMaterialFilter("");
    setPStemMaterialFilter("");
    setJournalFilterPipe("");
    setJournalFilterTobacco("");
    setJournalFilterYear("");
    setJournalFilterDate("");
    setJournalFilterCommune("");
    setJournalFilterCountry("");
    setAccDet(null);
    setShowRetiredAcc(false);
    setABrandFilter("");
    setATypeFilter("");
    // Pipe + accessory tag filters reset alongside the rest.
    setPTagFilter("");
    setATagFilter("");
    // Do NOT wipe scrollSaveRef on every nav. We used to,
    // which silently killed the restoreScroll path: edit form's
    // save handler calls nav("inv", { restoreScroll: true }) expecting
    // the previously-saved list scroll to be applied — but the wipe
    // ran first, leaving an empty ref. The keys are per-list (inv /
    // pipes / acc) so they don't interfere with one another, and
    // forward-nav already overrides via scrollToTopRef (the effect
    // skips the restore branch when scrollToTopRef.current is true).

    // Reset pinch-to-zoom on navigation. Pinch zoom is deliberately
    // enabled (no user-scalable=no in the viewport meta) for accessibility,
    // but the zoom level then persists across nav — zooming into a
    // card and then opening a form left the form at a weird zoom.
    // Trick: briefly flip the viewport meta to non-scalable so iOS
    // Safari resets the visual viewport, then restore the original
    // content in the next frame so pinch-to-zoom stays available.
    // The flicker is imperceptible and works on iOS Safari + Android
    // Chrome equally. Skip on the initial mount (view stays "home").
    //
    // Fix (lost to a revert once, restored since — do NOT drop it again):
    // SKIP this in the iOS STANDALONE PWA.
    // Mutating the viewport meta there forces iOS to recompute the visual
    // viewport, which dislodges the `position:fixed` bottom dock — it detaches
    // and floats to the middle on the next scroll ("le menu du bas qui flotte").
    // A standalone PWA has no URL bar and its zoom doesn't persist the same
    // way, so the reset isn't needed there anyway.
    if (!IS_IOS_STANDALONE) {
      try {
        var _vm = document.querySelector('meta[name=viewport]') as HTMLMetaElement | null;
        if (_vm) {
          var _orig = _vm.getAttribute('content') || 'width=device-width, initial-scale=1.0, viewport-fit=cover';
          _vm.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
          requestAnimationFrame(function () { if (_vm) _vm.setAttribute('content', _orig); });
        }
      } catch (_e) {}
    }
  }
  function navToInvFiltered(cat: any, brand: any) {
    // Record the ORIGIN screen (Home, Stats, or an open fiche) so
    // system-back returns to WHERE THE DRILL STARTED — captureLoc reads the
    // still-current screen (the setDetail/setPipeDet/setAccDet(null) below are
    // queued, not yet applied). pushDrillOrigin keeps bare-root origins (Home /
    // Stats), so back from a Stats "Top tabacs" bar returns to Stats, not Home.
    // We land on a LIST (no overlay), so clear drillOverlayRef — a fiche later
    // opened from this list must close IN PLACE, not pop to the origin.
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    setCatFilter(cat || "");
    setCutFilter("");
    setBrandFilter(brand || "");
    setAromaFilter([]);
    setRatingFilter(0);
    // Clear the user-tag filter too (every sibling drill —
    // navToInvByAroma / navToInvByTag / navToInvByRating — does). Without it a
    // lingering tag filter silently narrowed the family/brand chart drill.
    setTagFilter("");
    scrollToTopRef.current = true;
    setView("inv");
    setDetail(null);
    setPipeDet(null);
    setAccDet(null);
    setSearch("");
    // The Home "Familles" chart only counts active tabacs
    // (computeStats → hasActive filter), so navigating to "all"
    // surfaced finished tabacs the user wasn't expecting from the
    // chart. Align the destination filter with the chart's scope.
    setStatusFilter("active");
  }
  // Jump to the inventory filtered on one aroma-wheel key — powers
  // the clickable aromas in the Home "Votre profil" block. Clears the other
  // tabac filters so the aroma stands alone; scopes to active like the
  // families click-thru (navToInvFiltered).
  function navToInvByAroma(key: any) {
    // Record origin (Home/Stats/fiche) so back returns there.
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    setCatFilter("");
    setCutFilter("");
    setBrandFilter("");
    setTagFilter("");
    setRatingFilter(0);
    setAromaFilter(key ? [key] : []);
    setSearch("");
    setStatusFilter("active");
    scrollToTopRef.current = true;
    setView("inv");
    setDetail(null);
    setPipeDet(null);
    setAccDet(null);
  }
  // Jump to the inventory filtered on a user tag / collection —
  // powers the tap-a-tag drill from the tobacco fiche. Records the origin
  // (fiche) so system-back returns there; uses setView so the tag survives.
  function navToInvByTag(tag: any) {
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    setCatFilter("");
    setCutFilter("");
    setBrandFilter("");
    setRatingFilter(0);
    setAromaFilter([]);
    setTagFilter(String(tag == null ? "" : tag));
    setSearch("");
    setStatusFilter("active");
    scrollToTopRef.current = true;
    setView("inv");
    setDetail(null);
    setPipeDet(null);
    setAccDet(null);
  }
  // Tap-a-tag drills from the pipe / accessory fiches. Record the
  // origin (fiche) so system-back returns there; setView so the tag survives.
  function navToPipesByTag(tag: any) {
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    setPShapeFilter(""); setPBrandFilter(""); setPFilterFilter(""); setPRatingFilter(0);
    setPBowlMaterialFilter(""); setPStemMaterialFilter("");
    setPTagFilter(String(tag == null ? "" : tag));
    setShowFinishedPipes(false);
    scrollToTopRef.current = true;
    setView("pipes");
    setDetail(null); setPipeDet(null); setAccDet(null);
  }
  function navToAccByTag(tag: any) {
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    setABrandFilter(""); setATypeFilter("");
    setATagFilter(String(tag == null ? "" : tag));
    setShowRetiredAcc(false);
    scrollToTopRef.current = true;
    setView("acc");
    setDetail(null); setPipeDet(null); setAccDet(null);
  }
  // Jump to the inventory filtered on a star rating — powers the
  // Stats "Répartition des notes" histogram drill. Uses setView (NOT nav) so
  // the rating survives (nav() RESETS ratingFilter, which
  // silently wiped this drill when it went through a bare nav("inv")). Records
  // the origin (Stats) so system-back returns there.
  function navToInvByRating(rating: any) {
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    setCatFilter("");
    setCutFilter("");
    setBrandFilter("");
    setTagFilter("");
    setAromaFilter([]);
    setRatingFilter(Number(rating) || 0);
    setSearch("");
    setStatusFilter("active");
    scrollToTopRef.current = true;
    setView("inv");
    setDetail(null);
    setPipeDet(null);
    setAccDet(null);
  }
  function navToPipesFiltered(shape: any, brand: any) {
    // Record origin (Home/Stats) so back returns there, not Home.
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    setPShapeFilter(shape || "");
    setPBrandFilter(brand || "");
    // Clear the REST of the pipe filter set (rating / filter-type /
    // bowl+stem material / tag) — a lingering one silently narrowed this
    // shape/brand chart drill. Matches navToPipesByTag / …ByMaterial. Locked by
    // navHelperSymmetry.test.ts.
    setPFilterFilter("");
    setPRatingFilter(0);
    setPBowlMaterialFilter("");
    setPStemMaterialFilter("");
    setPTagFilter("");
    scrollToTopRef.current = true;
    setView("pipes");
    setDetail(null);
    setPipeDet(null);
    setAccDet(null);
    setShowFinishedPipes(false);
    if (brand && pipesGrouped) {
      setCollapsedPipeGroups(function (prev) {
        var n = Object.assign({}, prev);
        n[brand] = false;
        return n;
      });
    }
  }
  // Click-thru helpers from the Statistics page. Each helper
  // mirrors navToInvFiltered / navToPipesFiltered: clears every other
  // filter that might shadow the target, sets the relevant ones, and
  // jumps to the destination view via setView (NOT nav() — which would
  // wipe the filters we just set).
  function navToPipesFilteredByMaterial(material: any, kind: "bowl" | "stem") {
    // Record origin (Stats) so back returns there, not Home.
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    setPShapeFilter("");
    setPBrandFilter("");
    setPFilterFilter("");
    setPRatingFilter(0);
    // Clear the tag filter too (symmetry with the other pipe
    // drills — a lingering tag would narrow this material drill).
    setPTagFilter("");
    if (kind === "bowl") {
      setPBowlMaterialFilter(material || "");
      setPStemMaterialFilter("");
    } else {
      setPBowlMaterialFilter("");
      setPStemMaterialFilter(material || "");
    }
    scrollToTopRef.current = true;
    setView("pipes");
    setDetail(null);
    setPipeDet(null);
    setAccDet(null);
    setShowFinishedPipes(false);
  }
  function navToJournalFiltered(year: any, pipeId: any = "", tobaccoId: any = "") {
    // Record origin (Home/Stats) so back returns there, not Home.
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    setJournalFilterYear(year ? String(year) : "");
    setJournalFilterPipe(pipeId ? String(pipeId) : "");
    setJournalFilterTobacco(tobaccoId ? String(tobaccoId) : "");
    // Year-level filter clears the more-specific date filter so the
    // two don't fight each other in the JournalView memo.
    setJournalFilterDate("");
    // Clear the location filters too (both sibling drills —
    // navToJournalFilteredByDate / …ByLocation — do). A lingering commune /
    // country filter would otherwise silently narrow this year/pipe/tobacco
    // drill.
    setJournalFilterCommune("");
    setJournalFilterCountry("");
    scrollToTopRef.current = true;
    setView("journal");
    setDetail(null);
    setPipeDet(null);
    setAccDet(null);
  }
  // Day-precise click-thru from the StatsView heatmap.
  // Setting a date implicitly defines the year so we clear `year` to
  // avoid two filters fighting each other in the JournalView memo
  // (and to keep the active-filter chip row uncluttered).
  function navToJournalFilteredByDate(date: any) {
    // Record origin (Stats heatmap) so back returns there, not Home.
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    setJournalFilterDate(date ? String(date) : "");
    setJournalFilterYear("");
    setJournalFilterPipe("");
    setJournalFilterTobacco("");
    setJournalFilterCommune("");
    setJournalFilterCountry("");
    scrollToTopRef.current = true;
    setView("journal");
    setDetail(null);
    setPipeDet(null);
    setAccDet(null);
  }
  // Click-thru from the StatsView "Lieux" section. `kind` is
  // "commune" or "country". Sets just the chosen location filter and
  // clears every other journal filter for a clean drill-down.
  function navToJournalFilteredByLocation(kind: any, value: any) {
    // Record origin (Stats "Lieux") so back returns there, not Home.
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    drillOverlayRef.current = false;
    var v = value ? String(value) : "";
    setJournalFilterCommune(kind === "commune" ? v : "");
    setJournalFilterCountry(kind === "country" ? v : "");
    setJournalFilterPipe("");
    setJournalFilterTobacco("");
    setJournalFilterYear("");
    setJournalFilterDate("");
    scrollToTopRef.current = true;
    setView("journal");
    setDetail(null);
    setPipeDet(null);
    setAccDet(null);
  }
  // GoBack + the popstate/swipe listeners moved to
  // src/hooks/useBackNavigation.ts. The hook is called below (search
  // useBackNavigation) once `detail` / `pipeDet` / `view` / `nav` /
  // setters are in scope.

  // Wrap the detail setters so opening a list item (set to a non-null value)
  // saves the current list-scroll position AND scrolls the detail view to
  // top. Setting to null (back-arrow) leaves the scroll flag alone so the
  // existing useEffect restores the saved position.
  // Opening a fiche NORMALLY from its own list is NOT a drill — clear
  // drillOverlayRef so system-back closes it IN PLACE (returns to the list),
  // even when a Stats/Home filtered-list origin sits on the back stack.
  function ctxSetDetail(t: any) {
    if (t) {
      scrollSaveRef.current["inv"] = window.scrollY || 0;
      scrollToTopRef.current = true;
      drillOverlayRef.current = false;
    }
    setDetail(t);
  }
  function ctxSetPipeDet(p: any) {
    if (p) {
      scrollSaveRef.current["pipes"] = window.scrollY || 0;
      scrollToTopRef.current = true;
      drillOverlayRef.current = false;
    }
    setPipeDet(p);
  }
  function ctxSetAccDet(a: any) {
    if (a) {
      scrollSaveRef.current["acc"] = window.scrollY || 0;
      scrollToTopRef.current = true;
      drillOverlayRef.current = false;
    }
    setAccDet(a);
  }

  // Open a fiche by cross-navigating FROM another fiche (the
  // "Top pipes utilisées" / "Top tabacs fumés ici" pairing rows). Records the
  // CURRENT fiche on the back stack BEFORE navigating so system-back / swipe
  // returns to it (decideBack pops when a fiche is open + the stack top is a
  // fiche). We push manually then guard nav() with restoringBackRef so nav's
  // own root-target stack RESET doesn't wipe the push we just made. Uses raw
  // setDetail/setPipeDet (not the ctx* variants) so no wrong list-scroll
  // snapshot is taken — we're leaving a fiche, not a list.
  // `scope` narrows the OPENED FICHE to a lot slice, for a caller whose row
  // named one. A Home row reading "à point" is about a tobacco's OPTIMAL lots,
  // and the fiche was opening on all of them — so on a blend held in a dozen
  // tins you arrive at a list and have to find the four the row meant. The
  // fiche already follows the list's scope (`scopeFromStatusFilter`), names the
  // slice in a chip on "Les lots" and offers "Tout afficher", so this is that
  // machinery being handed the right value rather than a new mechanism.
  //
  // It MUST be applied after `nav()`, which resets `statusFilter` to "active".
  function crossOpenDetail(target: { view: string; kind: "tobacco" | "pipe" | "accessory" | "wishlist"; obj?: any; scope?: string }) {
    if (!target) return;
    if (target.kind !== "wishlist" && !target.obj) return;
    // Record the ORIGIN even when it's bare-root Home (pushLoc skips
    // bare roots; pushDrillOrigin keeps them) so system-back from a Home-tile
    // drill returns to Home instead of closing the overlay to its list. Guarded
    // nav() so its root-target stack RESET can't wipe the push we just made.
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    restoringBackRef.current = true;
    try { nav(target.view); }
    finally { restoringBackRef.current = false; }
    if (target.kind === "tobacco") {
      setDetail(target.obj);
      if (target.scope) setStatusFilter(target.scope);
    }
    else if (target.kind === "pipe") setPipeDet(target.obj);
    else if (target.kind === "accessory") setAccDet(target.obj);
    else if (target.kind === "wishlist") { setDetail(null); setStatusFilter("wish"); }
    // Mark this overlay as DRILL-opened so system-back pops to the
    // origin we just recorded, instead of closing it to the underlying list.
    // (nav() above cleared the flag; set it AFTER.)
    drillOverlayRef.current = true;
  }

  // Open ONE session's read-only fiche from anywhere, recording
  // the origin so system-back returns there. The counterpart of
  // crossOpenDetail, for the one overlay that is not an entity fiche.
  //
  // It does NOT set `drillOverlayRef`, and that is deliberate: that latch means
  // "the currently-open OVERLAY was drill-opened", and `decideBack`'s pop branch
  // lists only detail/pipe/acc/wishlist — a session modal is not in it. The back
  // sequence falls out of the existing engine with no change to it: the first
  // back hits `close-session`, the second finds a non-empty stack and pops to
  // the origin we record here. Setting the latch would claim something about an
  // overlay the branch cannot see.
  function crossOpenSession(sess: any) {
    if (!sess) return;
    navHistoryRef.current = pushDrillOrigin(navHistoryRef.current, captureLoc());
    restoringBackRef.current = true;
    try { nav("journal"); }
    finally { restoringBackRef.current = false; }
    setSessionDetail(sess);
  }

  function handlePhotoUpload(cb: any) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = function (e) {
      var file = (e.target as HTMLInputElement).files![0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) {
        setPhotoErr(t("err_photo_size"));
        setTimeout(function () { setPhotoErr(""); }, 4000);
        return;
      }
      var reader = new FileReader();
      reader.onload = function (ev) {
        var img2 = new Image();
        img2.onload = function () {
          var mx = 800,
            w = img2.width,
            h = img2.height;
          if (w > mx || h > mx) {
            if (w > h) {
              h = Math.round((h * mx) / w);
              w = mx;
            } else {
              w = Math.round((w * mx) / h);
              h = mx;
            }
          }
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")!.drawImage(img2, 0, 0, w, h);
          var du = canvas.toDataURL("image/jpeg", 0.8);
          // Collision-resistant key — two uploads in the
          // same millisecond would otherwise mint the same key and one blob
          // would overwrite the other (an entity ends up on the wrong photo).
          var key = "local-photo-" + Date.now() + "-" + newPhotoSuffix();
          imgCache
            .put(key, du)
            .then(function (ok) {
              // ImgCache.put RESOLVES `false` on a
              // transaction failure (quota-exceeded / private mode) — it only
              // REJECTS when open() fails. The earlier `.catch` fallback
              // therefore never fired for the actual near-quota write failure:
              // `.then` ran with ok===false and still confirmed `key`, whose
              // blob was never persisted → the photo renders this session then
              // vanishes on reload (silent cover-photo loss). Inspect the value
              // and fall back to inline base64 (persists in localStorage; the
              // save() QuotaExceeded migration re-homes it to IndexedDB later).
              if (ok === false) cb(du, du);
              else cb(key, du);
            })
            .catch(function () {
              // open() rejection (IndexedDB unavailable) — same inline fallback.
              cb(du, du);
            });
        };
        img2.onerror = function () {
          setPhotoErr(t("err_photo_read"));
          setTimeout(function () { setPhotoErr(""); }, 4000);
        };
        img2.src = (ev.target as FileReader).result as string;
      };
      reader.onerror = function () {
        setPhotoErr(t("err_photo_read"));
        setTimeout(function () { setPhotoErr(""); }, 4000);
      };
      reader.readAsDataURL(file);
    };
    inp.click();
  }

  var fromWishRef = useRef<any>(null);
  var scrollSaveRef = useRef<Record<string, any>>({});
  var scrollToTopRef = useRef(false);
  // Dynamic back-navigation history. `navHistoryRef` is the back
  // STACK of screens the user visited (utils/navHistory.ts); nav() pushes the
  // leaving screen, goBack() pops it. `restoringBackRef` is set while goBack
  // applies a popped location so nav()'s push is suppressed (a restore must
  // not itself grow the stack).
  var navHistoryRef = useRef<NavLoc[]>([]);
  var restoringBackRef = useRef(false);
  // True while the CURRENTLY-open overlay (fiche / wishlist) was
  // reached by a recorded DRILL (crossOpenDetail from a Home/Stats tile, a
  // paired-fiche row, or the session modal). Only then does system-back POP to
  // the recorded origin instead of closing the overlay to its underlying list.
  // A fiche opened NORMALLY from a list (ctxSet*Detail) leaves this false, so
  // back closes it in place — even when a filtered-list origin (Stats/Home) is
  // sitting on the stack. Reset by nav() + every navTo* drill (they land on a
  // LIST, not a cross-opened overlay); set true by crossOpenDetail + applyLoc
  // when it restores an overlay location.
  var drillOverlayRef = useRef(false);
  // The JournalView read-only session-detail modal, lifted to App
  // state so system-back / edge-swipe closes it in place (was JournalView-local
  // useState, invisible to goBack, so swipe-back navigated away from Journal).
  var _sd = useState<any>(null),
    sessionDetail = _sd[0],
    setSessionDetail = _sd[1];
  // Unsaved-changes guard. The active EDIT form registers
  // { isDirty, onSave, onDiscard } here (via ctx.setFormGuard); goBack opens
  // the `unsavedConfirm` modal when a modified form is being left.
  var formGuardRef = useRef<{ isDirty: () => boolean; onSave: () => void; onDiscard: () => void } | null>(null);
  // The pipe maintenance modal is local state inside
  // PipesDetailView, so App cannot see it. It reports itself here purely so
  // `deferAutoUpdate` can protect its unsaved input from an auto-reload.
  var _mfo = useState(false), maintFormOpen = _mfo[0], setMaintFormOpen = _mfo[1];
  // The LOT modal reports itself the same way, and for a sharper reason than
  // the maintenance one. `useTobaccoStore` also exposes a `lotForm`, seeded
  // `Object.assign({}, BL)` — a POPULATED object that is never set to null —
  // and `InventoryDetailView` SHADOWS that name with its own local state. So
  // the deferral clause read a value that was permanently truthy and
  // collapsed to "a tobacco fiche is open", which is not a form.
  var _lfo = useState(false), lotFormOpen = _lfo[0], setLotFormOpen = _lfo[1];
  // App's React mirror of `modalStack.hasOpenModal()`. The five `top: 0`
  // banners must stand down while ANY modal is open (they sit at z489-492
  // against the modal's z200, so one covers its header and its 44 px close X,
  // outside the focus trap) — and `pickTopBanner` could only see four
  // App-level states listed by name, so every view-local modal was invisible
  // to it. The registry knows them all; module state does not re-render, hence
  // the subscription. Mount-once: `subscribeModalStack` reports the current
  // state on subscribe, so nothing is missed if a modal is already up.
  var _smo = useState(false), stackModalOpen = _smo[0], setStackModalOpen = _smo[1];
  useEffect(function () { return subscribeModalStack(setStackModalOpen); }, [setStackModalOpen]);
  function setFormGuard(g: any) { formGuardRef.current = g; }
  var _uc = useState<any>(null),
    unsavedConfirm = _uc[0],
    setUnsavedConfirm = _uc[1];
  // A doc page (help/changelog/privacy/licenses) opened FROM the
  // Settings modal must return to Settings on back / X, not Home. This holds
  // the view that was underneath Settings when the doc page was opened (null
  // when the doc page was reached from anywhere else — Home footer, TermsGate).
  var settingsReturnRef = useRef<string | null>(null);
  var modalOpenTs = useRef(0);
  var {
    form,
    setForm,
    editId: _editId,
    setEditId,
    detail,
    setDetail,
    // Kept only for `nav()`'s transient-state reset below. NONE of these is
    // exposed on ctx any more — see the note at the appCtx literal.
    setAddLotMode,
    setEditLotIdx,
    setLotDet,
    showFinished,
    setShowFinished,
    tobGrouped,
    setTobGrouped,
    collapsedTobGroups,
    setCollapsedTobGroups,
    addTobacco,
    updateTobacco,
    updateTobaccoTastingNotes,
    deleteTobacco,
    addLotToTobacco,
    updateLotInTobacco,
    removeLot,
    changeLotStatus,
    toggleTobGroup,
  } = useTobaccoStore({
    data,
    save,
    nav,
    setSearch,
    fromWishRef,
  });
  var {
    pipeForm,
    setPipeForm,
    pipeDet,
    setPipeDet,
    editPipeId: _editPipeId,
    setEditPipeId,
    showFinishedPipes,
    setShowFinishedPipes,
    pipesGrouped,
    setPipesGrouped,
    collapsedPipeGroups,
    setCollapsedPipeGroups,
    addPipe,
    updatePipe,
    deletePipe,
    changePipeStatus,
    togglePipeGroup,
    addMaintenance,
    updateMaintenance,
    removeMaintenance,
  } = usePipeStore({
    data,
    save,
    nav,
  });
  var {
    sessForm,
    setSessForm,
    editSessId: _editSessId,
    setEditSessId,
    sessGrouped,
    setSessGrouped,
    collapsedSessGroups,
    setCollapsedSessGroups,
    addSession,
    addSessionFromTasting,
    updateSession,
    deleteSession,
    toggleSessGroup,
  } = useSessionStore({
    data,
    save,
    nav,
    weightUnit,
    setSaveError,
    lang,
  });
  var {
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
  } = useTastingSession({ addSessionFromTasting, nav, data, loading, setSaveError, setSaveWarn, lang, accountingEnabled });
  var {
    accForm,
    setAccForm,
    accDet,
    setAccDet,
    editAccId: _editAccId,
    setEditAccId,
    showRetiredAcc,
    setShowRetiredAcc,
    accsGrouped,
    setAccsGrouped,
    collapsedAccGroups,
    setCollapsedAccGroups,
    addAccessory,
    updateAccessory,
    deleteAccessory,
    changeAccStatus,
    toggleAccGroup,
  } = useAccessoryStore({
    data,
    save,
    nav,
  });
  var {
    wishForm,
    setWishForm,
    editWishId,
    setEditWishId,
    showWishForm,
    setShowWishForm,
    wishGrouped,
    setWishGrouped,
    collapsedWishGroups,
    setCollapsedWishGroups,
    addWish,
    updateWish,
    delWish,
    wishToInv,
    toggleWishGroup,
  } = useWishStore({
    data,
    save,
    nav,
    setForm,
    fromWishRef,
    scrollSaveRef,
  });
  var {
    updateStatus,
    updateAvailable,
    newerBuild,
    lastCheckOkMs,
    updatePillDismissed,
    setUpdatePillDismissed,
    justUpdated,
    setJustUpdated: _setJustUpdated,
    setUpdateStatus,
    checkUpdate,
    doUpdate,
    autoUpdateCountdown,
    pendingReason,
    deferReason,
    cancelAutoUpdate,
    dismissCountdown,
  } = useAppUpdate({
    // Defer the (visible + silent) auto-update for ANY active
    // tasting, not just the running stage — a silent data-only update firing on
    // visibilitychange during the "setup" stage reloaded the app mid-setup.
    // ALSO defer while a full-screen add/edit FORM is open —
    // an auto-reload (especially the silent data-only path, which has NO
    // countdown the user can cancel) would discard unsaved form input. The
    // update simply waits until the user leaves the form.
    // ALSO defer while the LOT add/edit modal is open — it holds unsaved
    // weight/price/date input, the exact discard-on-auto-reload class already
    // fixed for the full-screen forms.
    //
    // THROUGH `lotFormOpen`, WHICH THE MODAL REPORTS, and not through the
    // store's `lotForm`. That one is seeded `Object.assign({}, BL)`, a
    // POPULATED object, and is never set to null — so the clause was
    // permanently true and collapsed to `view === "inv" && !!detail`: any
    // open tobacco FICHE deferred every update, and Settings told the user to
    // close a lot modal that was not open. The real modal is local state in
    // `InventoryDetailView` that shadows the ctx name, which is exactly why
    // the ctx one looked wired. Same shape as the maintenance modal below.
    // The two residuals the comment above used to accept are
    // now covered, and the reason they were accepted turned out to be wrong.
    //
    // The WISHLIST overlay was excluded because "showWishForm/editWishId are
    // composed after this hook" — true, but nothing between the two hooks
    // consumed useAppUpdate's return, so the call simply moved below
    // useWishStore. It is a full add/edit form like the other five (it even
    // registers with useUnsavedFormGuard); being an overlay rather than a
    // `view` key is a routing detail, not a reason to reload underneath it.
    //
    // The MAINTENANCE modal reaches ctx via `maintFormOpen`. It is small —
    // a date, a kind, task checkboxes, a note — but "lower-stakes" is not the
    // test. A reload discards it just as completely, and the SILENT path has
    // no countdown to cancel, so the user gets no chance to object at all.
    //
    // THE RULE: this list is "the user has typed something a reload would
    // destroy". Add every new form-bearing surface to it. Nothing else about
    // the update is gated on the user agreeing — the visible banner is a
    // 10-second veto window that fires by itself — so this predicate IS the
    // protection for unsaved work.
    deferAutoUpdate: !!(
      (tasting && (tasting.stage === "running" || tasting.stage === "setup"))
      || ["addT", "editT", "addP", "editP", "addA", "editA", "addJ", "editJ"].indexOf(view) !== -1
      // These two only block WHILE THEIR HOST FICHE IS ON
      // SCREEN. Both are modals rendered INSIDE a detail view that returns null
      // as soon as you leave it — `InventoryDetailView` on `view !== "inv" ||
      // !detail`, `PipesDetailView` likewise — and nothing clears their state on
      // navigation (the standing invariant forbids nav() from resetting form
      // state, correctly). So tapping a lot and then tapping the dock left
      // `lotForm` armed for ever: the modal vanished from the screen and the
      // update stayed blocked with no way to see it, let alone clear it. An
      // entirely ordinary sequence.
      //
      // Same class as the invisible setup-tasting: a state that changes how the
      // app behaves must be visible. There it was fixable by making the state
      // visible; here the state is genuinely gone from the screen, so it must
      // stop blocking. THE RULE: this predicate describes what is ON SCREEN.
      || (lotFormOpen && view === "inv" && !!detail)
      || showWishForm || editWishId
      || (maintFormOpen && view === "pipes" && !!pipeDet)
    ),
    // The EXACT source, not a category.
    //
    // Splitting this into tasting-vs-form was already better than
    // "formulaire ou dégustation" — but "form" still covers FIVE distinct
    // states (a full-screen add/edit view, the lot modal, the wishlist overlay,
    // the maintenance modal), and after several rounds of me guessing which one
    // was stuck on a user's device, the honest move is to make the app say it
    // rather than to advance a sixth hypothesis. The string is a stable code the
    // Settings line maps to copy, and it is the last one that falls through, so
    // the order is deliberate: the surfaces that can persist INVISIBLY come
    // first, because those are the ones nobody thinks to look for.
    deferReason:
      (tasting && (tasting.stage === "running" || tasting.stage === "setup")) ? "tasting"
      : (maintFormOpen && view === "pipes" && !!pipeDet) ? "maint"
      : (showWishForm || editWishId) ? "wish"
      : (lotFormOpen && view === "inv" && !!detail) ? "lot"
      : ["addT", "editT", "addP", "editP", "addA", "editA", "addJ", "editJ"].indexOf(view) !== -1 ? "form"
      : "none",
  });

  var {
    aiLoad,
    aiErr,
    setAiErr: _setAiErr,
    apiKey,
    setApiKey: _setApiKey,
    aiProvider,
    setAiProvider: _setAiProvider,
    excludeApiKey,
    setExcludeApiKey,
    saveApiKey,
    saveAiProvider,
    aiModel,
    aiModelResolved,
    modelProbe,
    probeModel,
    saveAiModel,
    aiAutoFill,
    aiScanLabel,
    aiSource,
    setAiSource,
    aiCompare,
    aiCompareCheck,
    applyAiCompare,
    dismissAiCompare,
  } = useAiAutoFill({ lang, form, setForm, pipeForm, setPipeForm, wishForm, setWishForm, weightUnit, lengthUnit, t, autofillSource });
  // Shared import-confirm picker — owns the Replace / Merge /
  // Cancel modal that BOTH `doImportFile` (local JSON) and the Drive
  // restore flow stage their parsed payload into. Wired BEFORE the two
  // sibling hooks so `stageImport` can be passed down to either.
  var {
    importConfirm,
    stageImport,
    applyImport,
    cancelImport,
  } = useImportConfirm({
    data, save, migrateData, saveApiKey, setImgLocal, setImportModal, nav, t, setImportRecap,
    setPhotoErr,
  });
  var {
    gdriveStatus,
    setGdriveStatus,
    gdriveConfirm,
    setGdriveConfirm,
    autoSaveDrive,
    setAutoSaveDrive,
    lastAutoSaveTs,
    gdriveSave,
    gdriveRestore,
    doGdriveConfirm,
    gdriveLoadOptionPayload,
    gatherLocalImages: _gatherLocalImages,
    withPhotos,
    tkClear,
    tkGet,
    gdriveDeleteBackupById,
    catalogueCloudSave,
    catalogueCloudRestore,
    catalogueCloudStatus,
    gdriveReconnect,
    triggerIosAutosaveReauth,
    dropboxDisconnect,
    cloudNewerBackup,
    dismissCloudNewerBackup,
    restoreCloudNewerBackup,
    cloudRestoreBusy,
    checkCloudNewerNow,
    runSyncDiagnostic,
    dismissSyncDiag,
    syncDiag,
    syncDiagBusy,
    syncDiagErr,
    syncDiagSource,
  } = useGdriveSync({
    data,
    loading,
    t,
    setImportModal,
    pendingSync,
    setPendingSync,
    excludeApiKey,
    apiKey,
    aiProvider,
    stageImport,
    markExported,
    // Optional Drive backup encryption (Phase 1).
    driveEncryptionEnabled,
    drivePassphrase,
    setDrivePassphrase,
    requestDrivePassphrase,
    cloudProviderId,
  });
  // Export-reminder probe (placed after useGdriveSync so the
  // `lastAutoSaveTs` destructured above is in scope at the deps array).
  // Cheap — pure localStorage reads. Raises `exportReminder` when:
  //   1. There's at least one tobacco or pipe (no point reminding an
  //      empty cellar to back up), AND
  //   2. Either:
  //      a. The last save (any kind — JSON / CSV / ZIP / Drive manual /
  //         Drive auto) was > 30 days ago, OR
  //      b. The user has 5+ entries and has NEVER exported.
  //   3. Dismissal isn't currently snoozed (7 days after × on the banner).
  useEffect(function () {
    var dataCount = ((data && data.tobaccos && data.tobaccos.length) || 0)
                  + ((data && data.pipes && data.pipes.length) || 0);
    if (dataCount === 0) { setExportReminder(false); return; }
    var lastExportTs = 0;
    var dismissedAt = 0;
    try {
      lastExportTs = parseInt(lsGet("cave-last-export-ts") || "0") || 0;
      dismissedAt = parseInt(lsGet("cave-export-reminder-dismissed") || "0") || 0;
    } catch (_e) {}
    var lastAnySave = Math.max(lastExportTs, lastAutoSaveTs || 0);
    if (isWithinDays(dismissedAt, 7)) { setExportReminder(false); return; }
    var shouldWarn = false;
    if (lastAnySave > 0 && !isWithinDays(lastAnySave, 30)) {
      shouldWarn = true;
    } else if (lastAnySave === 0 && dataCount >= 5) {
      shouldWarn = true;
    }
    setExportReminder(shouldWarn);
  }, [data, lastAutoSaveTs, setExportReminder]);
  var {
    backupStatus,
    dlFile: _dlFile,
    doExport,
    doExportCSV,
    doBackupZip,
    doCollectionReport,
    doDownloadCsvTemplate,
    doImportCsvFile,
    csvIssues,
    clearCsvIssues,
    resetAll,
    doImportFile,
  } = useExportImport({
    data,
    save,
    withPhotos,
    nav,
    t,
    xl,
    excludeApiKey,
    apiKey,
    aiProvider,
    weightUnit,
    lengthUnit,
    currencySymbol,
    ageLabel,
    dateFormat,
    stageImport,
    markExported,
    setImportRecap,
  });
  // The user's own reference catalogue. Takes `dlFile` from
  // useExportImport so a download behaves identically (iOS share sheet
  // included) rather than growing a second anchor-click implementation.
  var {
    catalogueMeta,
    catalogueBusy,
    catalogueOutcome,
    loadCatalogueFile,
    clearCatalogue,
    downloadCatalogueTemplate,
    exportCatalogueCsv,
    catalogueAudit,
    catalogueAuditBusy,
    auditCatalogue,
    clearCatalogueAudit,
    refreshCatalogueMeta,
  } = useUserCatalogue({ dlFile: _dlFile });

  // A cloud RESTORE writes the catalogue straight to
  // IndexedDB, and no React state is watching that store. Without this
  // refresh the Settings section keeps describing the PREVIOUS catalogue (or
  // «aucun catalogue chargé») until the modal is reopened, which reads as the
  // restore having done nothing — the same failure `tobaccoDbInvalidate`
  // exists to prevent one layer down.
  function catalogueCloudRestoreThenRefresh() {
    return Promise.resolve(catalogueCloudRestore()).then(function (ok: any) {
      if (ok) refreshCatalogueMeta();
      return ok;
    });
  }
  var _if = useState({}),
    imgFail = _if[0],
    setImgFail = _if[1];
  // `liveData` — the raw `data` minus rows tagged with `deletedAt`
  // and lots tagged with `deletedAt`.
  // Every consumer that drives the UI reads from this — including
  // the filtered/sorted memos below. The raw state stays in `data`
  // for the stores (which map over the full array to stamp deletedAt)
  // and for the Trash UI in Settings (`dataRaw` ctx key).
  var liveData: AppData | null = useMemo(function () {
    if (!data) return data;
    function stripLots(tobs: any) {
      if (!Array.isArray(tobs)) return tobs;
      return tobs.map(function (t: any) {
        if (!t || !Array.isArray(t.lots)) return t;
        if (!t.lots.some(isTrashed)) return t;
        return Object.assign({}, t, { lots: stripDeleted(t.lots) });
      });
    }
    return Object.assign({}, data, {
      tobaccos: stripLots(stripDeleted(data.tobaccos)),
      pipes: stripDeleted(data.pipes),
      wishlist: stripDeleted(data.wishlist),
      accessories: stripDeleted(data.accessories),
      sessions: stripDeleted(data.sessions),
    });
  }, [data]);
  var filtered = useMemo(
    function () {
      if (!liveData) return [];
      var ls = liveData.tobaccos || [];
      var eff = statusFilter;
      // The lot slice the cards will display, so the SORT ranks on
      // the same figures (null for every tobacco-level filter → unchanged).
      var sortScope = scopeFromStatusFilter(statusFilter);
      // "wish" is a view-mode that delegates rendering to WishView —
      // suppress the tobacco list entirely so the inventory shows the
      // wishlist alone.
      if (eff === "wish") return [];
      if (eff === "cellar")
        ls = ls.filter(function (t) {
          return countByStatus(t, "cellar") > 0;
        });
      else if (eff === "jar")
        ls = ls.filter(function (t) {
          return countByStatus(t, "jar") > 0;
        });
      else if (eff === "finished")
        // "Finis" shows tabacs that own at least one
        // finished NON-disposed lot. Disposed lots (lots thrown /
        // given away) live in the separate "Éliminés" view below.
        ls = ls.filter(function (t) {
          return (t.lots || []).some(function (l) {
            return l.status === "finished" && !l.disposed;
          });
        });
      else if (eff === "disposed")
        // New chip — tabacs that own at least one
        // disposed lot. Disposed implies status=finished (a lot
        // can't be disposed in cellar/jar), so this is effectively
        // a "finished + disposed" sub-view.
        ls = ls.filter(function (t) {
          return (t.lots || []).some(function (l) {
            return !!l.disposed;
          });
        });
      else if (eff === "norebuy")
        // Dedicated "À ne pas reprendre" chip — narrows the
        // list to tabacs explicitly flagged rebuy=false in their fiche.
        // `rebuy` is tri-state (null / true / false), so the filter is
        // strict equality on false. Same shape as every other chip:
        // pure filter, no side effect on the data.
        ls = ls.filter(function (t) {
          return t.rebuy === false;
        });
      else if (eff === "lowstock")
        // "Stock bas" chip — tabacs whose active (non-finished)
        // weight is at/under the low-stock threshold (same definition as the
        // shopping list + watchlist). A filter view, so it shows EVERY low tin
        // (including "à ne pas reprendre" — the shopping list is the one that
        // drops those; here the user just wants to see what's running low).
        ls = ls.filter(function (t) {
          return isLowStock(t, parseFloat(watchLowWeight) || (weightUnit === "oz" ? 0.9 : 25));
        });
      else if (eff === "recent")
        // "Achats récents" — a tabac with at least one LIVE,
        // still-held lot bought within RECENT_PURCHASE_DAYS. Non-finished on
        // purpose: the card/fiche narrow to those same lots (it is a lot-level
        // scope), so a tin already smoked to zero would show an empty slice.
        ls = ls.filter(function (t) {
          return (t.lots || []).some(function (l) {
            return l && !l.deletedAt && l.status !== "finished" && isRecentPurchase(l);
          });
        });
      else if (eff === "overaged")
        ls = ls.filter(function (t) {
          return (t.lots || []).some(function (l) {
            return lotAgingStatus(l, effectiveAgingMax(t)) === "overaged";
          });
        });
      else if (eff === "approaching")
        ls = ls.filter(function (t) {
          return (t.lots || []).some(function (l) {
            return lotAgingStatus(l, effectiveAgingMax(t)) === "approaching";
          });
        });
      else if (eff === "smokesoon")
        // The Home "À fumer rapidement" tile's own slice: BOTH bands its count
        // sums. It used to drill to `overaged` alone, so a tile reading 7
        // opened a list holding 1 — the control naming a set and selecting a
        // subset of it. Both halves are urgent for opposite reasons: `peak` is
        // the window you want to be in, `overaged` is past it.
        //
        // DELEGATED to `lotInScope`, where it used to spell the rule out
        // inline. The two agreed, and that was the problem: the tile, the
        // filter and the card/fiche figures must select the SAME lots, so a
        // second spelling of the rule is free to drift from the scope on the
        // next edit — and the test guarding this could only compare its own
        // transcription against the scope, never against what App.tsx does.
        // Probed: reverting this branch to `overaged` alone left the whole
        // suite green.
        ls = ls.filter(function (t) {
          var eam = effectiveAgingMax(t);
          return (t.lots || []).some(function (l) {
            return lotInScope(l, "smokeSoon", eam);
          });
        });
      else if (eff === "young" || eff === "optimal")
        // Maturity-band filters, consistent with the Home
        // "Cave à maturité" bar (lotMaturityBucket is the shared classifier).
        // EffectiveAgingMax applies the family default when the
        // tobacco has no explicit target, so the bar and the filter agree.
        ls = ls.filter(function (t) {
          return (t.lots || []).some(function (l) {
            return lotMaturityBucket(l, effectiveAgingMax(t)) === eff;
          });
        });
      else if (eff === "used_up")
        // "Épuisé" — a tabac that HAD lots and has smoked/used
        // them all (no active lot remains, but it still carries lots). The
        // "I finished this blend" state — a rebuy candidate. Split out of the
        // old "Inactifs" umbrella from the lot-LESS case below.
        ls = ls.filter(function (t) {
          return countActive(t) === 0 && (t.lots || []).length > 0;
        });
      else if (eff === "nolot")
        // "Sans lot" — a tabac with NO lot at all (every lot
        // deleted, or a never-filled stub). A data-completeness state, not a
        // smoking milestone. The other half of the old "Inactifs".
        ls = ls.filter(function (t) {
          return (t.lots || []).length === 0;
        });
      else if (eff === "active")
        // Dedicated "Actifs" chip — tabacs with at least one
        // cellar or jar lot.
        // A tabac with NO active lot is now INACTIVE — this
        // includes a lot-LESS tabac (the old `|| length === 0` clause that
        // kept it active was dropped). A tabac only counts as active while it
        // holds at least one non-finished lot; delete every lot and it drops
        // out of "Actifs" (still reachable via "Tous"). New tabacs still land
        // active because addTobacco mints an empty starter lot.
        ls = ls.filter(function (t) {
          return countActive(t) > 0;
        });
      // else "all" → no filter: show every tabac, including those whose
      // lots are all finished. Surfaces them in the list (with the
      // disposed / finished badges they already carry) so the user can
      // act on them — delete, reactivate — without first picking the
      // "Finis" chip. The "Actifs" chip above is there for the user who
      // wants the previous default.
      if (catFilter)
        ls = ls.filter(function (t) {
          return t.category === catFilter;
        });
      if (cutFilter)
        ls = ls.filter(function (t) {
          return t.cut === cutFilter;
        });
      if (brandFilter)
        ls = ls.filter(function (t) {
          return t.brand === brandFilter;
        });
      // The ONE tag predicate, not a third copy of it. The
      // helper is generic (it reads `.tags`), which is why the pipe and
      // accessory filters below call the same function.
      if (tagFilter) ls = ls.filter(function (t) { return tobaccoHasTag(t, tagFilter); });
      if (ratingFilter)
        ls = ls.filter(function (t) {
          return Math.round(t.rating || 0) === ratingFilter;
        });
      // Aroma filter. Aromas live on sessions, so index each
      // tobacco's aggregated aromas from the journal, then keep only
      // tobaccos whose set contains EVERY selected aroma (AND).
      if (aromaFilter.length > 0) {
        var aromaIdx = buildTobaccoAromaIndex(liveData.sessions);
        ls = ls.filter(function (t) {
          return tobaccoMatchesAromas(aromaIdx, t.id, aromaFilter);
        });
      }
      if (search) {
        var q = String(search).toLowerCase();
        ls = ls.filter(function (t) {
          return [
            t.name,
            t.brand,
            t.blend,
            t.category,
            t.cut,
            t.tastingNotes,
          ].some(function (f) {
            return f && String(f).toLowerCase().indexOf(q) >= 0;
          }) ||
            // Match user tags / collections too.
            (Array.isArray(t.tags) && t.tags.some(function (tg: any) {
              return tg && String(tg).toLowerCase().indexOf(q) >= 0;
            })) ||
            // Lot-level fields — storage location + box
            // number. Typing "armoire A" surfaces every tobacco with a
            // lot stored there.
            (t.lots || []).some(function (l: any) {
              return [l.storageLocation, l.boxNumber].some(function (f: any) {
                return f && String(f).toLowerCase().indexOf(q) >= 0;
              });
            });
        });
      }
      return ls.slice().sort(function (a, b) {
        // String() coerce every localeCompare input — old or
        // imported records can carry these fields as numbers, which
        // crashes the prototype lookup.
        if (sortBy === "name")
          return String(a.name || "").localeCompare(String(b.name || ""));
        var primary;
        if (sortBy === "brand") {
          // The ONE comparator, shared with the collection report so
          // the printed document reads in the same order as this list.
          return compareByBrandThenName(a, b);
        } else if (sortBy === "rating")
          primary = (b.rating || 0) - (a.rating || 0);
        else if (sortBy === "aging")
          // Sort on the SAME lots the cards display. Under "En pot"
          // this ranked by the whole stock while every card showed its jar
          // figures, so the order looked arbitrary.
          primary = scopedOldestAgeDays(b, sortScope) - scopedOldestAgeDays(a, sortScope);
        else if (sortBy === "qty")
          primary = scopedHeldWeight(b, sortScope) - scopedHeldWeight(a, sortScope);
        else if (sortBy === "force") primary = (b.force || 0) - (a.force || 0);
        else if (sortBy === "roomNote")
          primary = (b.roomNote || 0) - (a.roomNote || 0);
        else if (sortBy === "taste") primary = (b.taste || 0) - (a.taste || 0);
        else primary = 0;
        if (primary !== 0) return primary;
        // The same shared comparator as the "brand" mode above — the
        // tie-break rule and the primary rule were two copies of one sentence.
        return compareByBrandThenName(a, b);
      });
    },
    [liveData, statusFilter, search, sortBy, catFilter, cutFilter, brandFilter, tagFilter, ratingFilter, aromaFilter, watchLowWeight, weightUnit],
  );

  var filteredPipes = useMemo(
    function () {
      if (!liveData) return [];
      var ps = liveData.pipes || [];
      // Binary chip — `showFinishedPipes` true means "show
      // RETIRED ONLY", not the previous "include retired alongside
      // active". Mirrors the new AccListView semantics.
      ps = showFinishedPipes
        ? ps.filter(function (p) { return !pipeIsActive(p); })
        : ps.filter(pipeIsActive);
      if (pBrandFilter)
        ps = ps.filter(function (p) {
          return p.brand === pBrandFilter;
        });
      if (pShapeFilter)
        ps = ps.filter(function (p) {
          return p.shape === pShapeFilter;
        });
      if (pFilterFilter)
        ps = ps.filter(function (p) {
          return pFilterFilter === "__none__"
            ? !p.filterType
            : p.filterType === pFilterFilter;
        });
      if (pRatingFilter)
        ps = ps.filter(function (p) {
          return Math.round((p as any).rating || 0) === pRatingFilter;
        });
      // Bowl + stem material filters wired from StatsView
      // click-thrus (the "Matière du bol" / "Matière du bec" charts).
      // Match on raw `bowlMaterial` / `stemMaterial` strings — the
      // chart labels come from the same field, so equality holds.
      if (pBowlMaterialFilter)
        ps = ps.filter(function (p) {
          return (p as any).bowlMaterial === pBowlMaterialFilter;
        });
      if (pStemMaterialFilter)
        ps = ps.filter(function (p) {
          return (p as any).stemMaterial === pStemMaterialFilter;
        });
      if (pTagFilter) ps = ps.filter(function (p) { return tobaccoHasTag(p, pTagFilter); });
      // The shared comparator. This site compared LOWERCASED
      // strings with `<` / `>`, which is not accent-aware — "Éclipse" sorted
      // after "Zippo" in the pipes list while the tobacco list, using
      // localeCompare, put it under E. One rule now, and the collection report
      // reads in that same order. The String() coercion is kept
      // inside the comparator, where it belongs.
      ps = sortByBrandThenName(ps);
      return ps;
    },
    [liveData, showFinishedPipes, pBrandFilter, pShapeFilter, pFilterFilter, pRatingFilter, pBowlMaterialFilter, pStemMaterialFilter, pTagFilter],
  );
  var filteredSessions = useMemo(
    function () {
      if (!liveData) return [];
      return (liveData.sessions || []).slice().sort(function (a, b) {
        return String(b.date || "").localeCompare(String(a.date || ""));
      });
    },
    [liveData],
  );
  // There is NO `filteredAccessories` memo, and that is
  // deliberate. It existed until here and had no consumer: `AccListView` is
  // the one list that filters locally rather than reading a ctx memo (its
  // siblings read `filtered` / `filteredPipes`). So this was a second copy of
  // the accessory filter rules that nothing rendered — and it cost a real
  // defect: the collection chip had never filtered anything, because
  // the tag clause lived HERE, in the copy nobody displayed, while the view's
  // own memo lacked it. Removed rather than wired, because the view filtering
  // locally is a defensible shape and two copies is not.
  // If you need a ctx-level accessory list, wire the VIEW to it in the same
  // commit — do not reintroduce an unread memo.

  // Delegated to `computeStats` (utils.ts) so the aggregate logic is
  // unit-testable in isolation. Memoised on the liveData ref alone —
  // every stat used by Home/Stats depends only on it.
  var stats = useMemo(function () { return computeStats(liveData); }, [liveData]);
  useEffect(
    function () {
      if (scrollToTopRef.current) {
        scrollToTopRef.current = false;
        window.scrollTo(0, 0);
        return;
      }
      // Back from detail / back from form (restore previous list scroll).
      // Uses `restoreScrollY` from utils.ts — see the helper for the
      // retry-until-tall-enough rationale.
      if (view === "inv" && !detail) {
        var _sry = scrollSaveRef.current["inv"] || 0;
        if (_sry > 0) {
          scrollSaveRef.current["inv"] = 0;
          restoreScrollY(_sry);
        }
      }
      if (view === "pipes" && !pipeDet) {
        var _srpy = scrollSaveRef.current["pipes"] || 0;
        if (_srpy > 0) {
          scrollSaveRef.current["pipes"] = 0;
          restoreScrollY(_srpy);
        }
      }
      if (view === "acc" && !accDet) {
        var _sracY = scrollSaveRef.current["acc"] || 0;
        if (_sracY > 0) {
          scrollSaveRef.current["acc"] = 0;
          restoreScrollY(_sracY);
        }
      }
      // Same restore branch for the Journal — sessions
      // have no separate "detail" sub-state (the SessionDetailModal
      // is local component state, not a view route), so the only
      // gating condition is `view === "journal"`.
      if (view === "journal") {
        var _srjY = scrollSaveRef.current["journal"] || 0;
        if (_srjY > 0) {
          scrollSaveRef.current["journal"] = 0;
          restoreScrollY(_srjY);
        }
      }
    },
    [view, detail, pipeDet, accDet],
  );
  // Dynamic back navigation. `captureLoc` snapshots the CURRENT
  // screen; `applyLoc` restores a popped one; `goBack` is the routine wired to
  // system-back + edge-swipe (via useBackNavigation). Open overlays (detail /
  // pipe / accessory fiche, wishlist form) close in place — same as before —
  // and view-to-view moves pop the real history stack instead of the old
  // fixed parent-mapping. A drained stack falls back to the minimal
  // forms→list / else→home mapping so the first taps of a fresh session still
  // behave. Defined as function declarations (hoisted) so nav()'s push at the
  // top can call captureLoc even though it sits earlier in the file.
  // Doc pages (help/changelog/privacy/licenses). `DOC_VIEWS` +
  // openDocFromSettings/closeDocPage give them a Settings-aware back: opened
  // from the Settings modal → back / X reopens Settings over the underlying
  // view; opened from anywhere else → back / X goes Home.
  var DOC_VIEWS = ["help", "changelog", "privacy", "licenses"];
  function openDocFromSettings(page: string) {
    settingsReturnRef.current = view; // the view underneath the Settings modal
    if (setImportModal) setImportModal(false);
    // Suppress nav()'s back-stack push. closeDocPage
    // returns via setView(returnView), NOT a stack pop, so a pushed entry is
    // never consumed — over a non-root view (catalog, or a fiche reached via a
    // banner that opens Settings) it left a stale entry that caused a dead back
    // press + could re-open a lost fiche later. The push is gated on
    // !restoringBackRef, so flipping it for the duration of nav() skips it.
    var prevRestoring = restoringBackRef.current;
    restoringBackRef.current = true;
    try { nav(page); } finally { restoringBackRef.current = prevRestoring; }
  }
  function closeDocPage() {
    if (settingsReturnRef.current) {
      var rv = settingsReturnRef.current;
      settingsReturnRef.current = null;
      setView(rv);
      if (setImportModal) setImportModal(true);
    } else {
      nav("home");
    }
  }
  function goBack() {
    // A swipe-back / system-back dismisses
    // the top-most open overlay before any doc-page / fiche / view routing.
    // The lightbox is the ONLY overlay that isn't a shared `Modal` (it's a
    // custom full-screen overlay with the highest z-index), so close it first.
    if (lightbox) { setLightbox(null); return; }
    // Everything else — search, trash, Settings, the import-confirm picker, the
    // encryption prompt, the catalog QuickAdd/fiche, lot & maintenance modals,
    // cellar-confirm, unsaved-changes confirm — registers on the shared modal
    // stack in visual (LIFO) order. closeTopModal closes the TOP-most, which
    // fixes the earlier bug where firstOpenModal claimed Settings even when a
    // child modal (encryption prompt / import picker) was stacked above it — so
    // system-back closed Settings underneath and left the child floating.
    if (hasOpenModal()) { closeTopModal(); return; }
    // Unsaved-changes guard — if the active edit form was modified,
    // ask before leaving (Save / Discard / Cancel) instead of navigating.
    var guard = formGuardRef.current;
    if (guard && guard.isDirty()) {
      setUnsavedConfirm({ onSave: guard.onSave, onDiscard: guard.onDiscard });
      return;
    }
    // A doc page opened from Settings returns to Settings first.
    if (settingsReturnRef.current && DOC_VIEWS.indexOf(view) !== -1) {
      closeDocPage();
      return;
    }
    // Leaving a BLANK setup discards it, or it blocks every
    // automatic update for ever.
    //
    // `deferAutoUpdate` blocks on a `setup`-stage tasting (correctly: a
    // silent reload while the user is picking a tobacco was a real
    // bug) and NOTHING cleared one on the way out — `decideBack` routes
    // `tasting` through `fallbackParent` to home without cancelling, so
    // `cave-tasting-active` survives relaunches with `{stage:"setup"}`.
    //
    // A NEW USER reaches this on their own: the Home's only CTA is « Démarrer
    // une dégustation », which needs a tobacco AND a pipe, and a fresh install
    // has neither — so the setup screen is genuinely unusable for them and a
    // system-back is the natural exit. Such a tasting was made visible
    // and resumable, which is the way out; that did not stop it being created.
    //
    // ONLY a setup with NOTHING chosen is discarded. That is not work: there is
    // literally nothing in it. A setup where the user picked a tobacco or a
    // pipe is preserved exactly as before, and the setup-stage rule is untouched —
    // this removes the empty state, it does not stop deferring on a real one.
    if (view === "tasting" && tasting && tasting.stage === "setup"
        && !tasting.tobaccoId && !tasting.pipeId) {
      tastingCancel();
      // fall through: the normal routing now leaves a cancelled tasting behind
    }
    // The whole decision is the pure decideBack() (utils/navHistory.ts); App
    // just executes the returned action. Open overlays close in place (return
    // to the underlying list); view-to-view moves pop the real history stack;
    // a drained stack falls back to the minimal parent-mapping.
    var action = decideBack({
      view: view,
      hasDetail: !!detail,
      hasPipeDet: !!pipeDet,
      hasAccDet: !!accDet,
      hasWishForm: !!(showWishForm || editWishId),
      hasSessionDetail: !!sessionDetail,
      isWishlist: view === "inv" && statusFilter === "wish",
      // Only a DRILL-opened overlay pops to its origin; a fiche
      // opened from its own list closes in place (see drillOverlayRef).
      drillOpened: drillOverlayRef.current,
      // A `tasting` origin is only worth popping to while the session
      // still exists — the 95-min auto-end can clear it while the user reads a
      // fiche, and nav("tasting") with no tasting paints an empty screen.
      tastingLive: !!tasting,
      stack: navHistoryRef.current,
    });
    switch (action.kind) {
      case "close-detail": setDetail(null); return;
      case "close-pipe": setPipeDet(null); return;
      case "close-acc": setAccDet(null); return;
      case "close-session": setSessionDetail(null); return;
      // Leave the wishlist → back to the tobacco list.
      case "close-wishlist": setStatusFilter("active"); return;
      case "close-wish": setShowWishForm(false); setEditWishId(null); return;
      case "pop": navHistoryRef.current = action.rest; applyLoc(action.loc); return;
      case "nav": nav(action.target); return;
      case "none": default: return;
    }
  }
  function applyLoc(loc: NavLoc) {
    // Restore a popped location. nav() clears details + resets statusFilter,
    // so re-apply the captured sub-state AFTER it; React batches these (goBack
    // runs from a native popstate/touch handler, auto-batched under createRoot)
    // into a single commit. The restoringBackRef guard stops nav()'s own push.
    restoringBackRef.current = true;
    try {
      nav(loc.view, { restoreScroll: true });
      // Restore the captured statusFilter UNCONDITIONALLY (default
      // "active"). The old `!== "active"` guard left a lingering "wish" filter
      // set — e.g. popping Home after the wishlist tile — because it only ever
      // set a non-active value; restoring the exact captured value clears it.
      setStatusFilter(loc.statusFilter || "active");
      var d = liveData || data;
      if (loc.detailId != null) {
        var tob = ((d && d.tobaccos) || []).find(function (x: any) { return x && String(x.id) === String(loc.detailId); });
        if (tob) setDetail(tob);
      }
      if (loc.pipeDetId != null) {
        var pp = ((d && d.pipes) || []).find(function (x: any) { return x && String(x.id) === String(loc.pipeDetId); });
        if (pp) setPipeDet(pp);
      }
      if (loc.accDetId != null) {
        var ac = ((d && d.accessories) || []).find(function (x: any) { return x && String(x.id) === String(loc.accDetId); });
        if (ac) setAccDet(ac);
      }
      // Re-open the session-detail modal (JournalView) if the popped
      // location had it open — so back from a fiche cross-opened from the modal
      // returns to the modal, not the bare journal.
      if (loc.sessionDetailId != null) {
        var se = ((d && d.sessions) || []).find(function (x: any) { return x && String(x.id) === String(loc.sessionDetailId); });
        if (se) setSessionDetail(se);
      }
      // Key `drillOpened` on the popped entry's `drill`
      // flag (set only by pushDrillOrigin — a genuine crossOpenDetail / tile /
      // chart drill), NOT on "an overlay id is present". The old heuristic
      // couldn't tell a drill origin from a normal nav()-pushed fiche (detail →
      // editT via pushLoc), so restoring a fiche after an edit wrongly kept
      // popping the chain and skipped the intermediate drilled list (Stats →
      // filtered list → fiche → edit → back → back jumped to Stats). A
      // non-drill restore clears the flag so back closes the fiche in place.
      drillOverlayRef.current = !!loc.drill;
    } finally {
      restoringBackRef.current = false;
    }
  }
  function captureLoc(): NavLoc {
    return {
      view: view,
      detailId: detail ? detail.id : null,
      pipeDetId: pipeDet ? pipeDet.id : null,
      accDetId: accDet ? accDet.id : null,
      sessionDetailId: sessionDetail ? sessionDetail.id : null,
      statusFilter: statusFilter,
    };
  }
  // Back-navigation transport (popstate + left-edge
  // swipe + 400ms debounce + history seeding) wired to the dynamic goBack.
  useBackNavigation(goBack);
  // The "retroactive reverse-geocoding" batch
  // (Settings → App → "Mettre à jour les noms de lieux") was removed. It
  // was a one-time migration tool to backfill place names on sessions
  // captured before the feature existed; that's long done, sessions are
  // captured with their names now, and the button nagged permanently
  // (it counted every geolocated session, not the nameless ones) while
  // re-running would overwrite manually-edited names. Reverse-geocoding
  // still happens automatically at capture (see SessionFormView /
  // TastingView).
  // Orphan-photo GC (mount-once, loading-gated, 4s-deferred).
  useOrphanPhotoGC(data, loading);
  // Startup lot-integrity probe → useLotIntegrityProbe.
  useLotIntegrityProbe(data, loading);

  // Surface the "an imported API key replaced yours" notice
  // AFTER the reload that always follows a settings-bearing restore. The
  // notice is written at the point of the write into React state
  // with an 8 s auto-dismiss, and the restore path reloads in a microtask, so
  // it could never be seen on the path it exists for. See APIKEY_REPLACED_KEY.
  // One-shot: read once, cleared immediately, exactly like `cave-lang-auto`.
  React.useEffect(function () {
    if (lsGet(APIKEY_REPLACED_KEY) !== "1") return;
    lsRemove(APIKEY_REPLACED_KEY);
    setImportRecap({ msg: t("import_apikey_replaced") });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design
  }, []);

  // Startup trash cleanup — purges entities tagged with
  // `deletedAt` older than TRASH_RETENTION_DAYS (30 by default). Runs
  // once, after `load()` has settled.
  //
  // Critical fix: this effect was `useEffect(fn, [])` reading
  // `data` from the mount-time closure. The initial `data`
  // state is `INIT` (empty) and `load()` is async, so the 6 s timer always
  // saw the empty `INIT` snapshot → `changed` was always false → the 30-day
  // retention NEVER purged anything (soft-deleted rows lived forever in
  // localStorage + every backup). Same closure bug + same fix as
  // useOrphanPhotoGC: gate on `loading === false` and read the LATEST data
  // through `trashPurgeDataRef` inside the deferred callback. Do NOT revert
  // the dep array to `[]` or read `data` directly — the regression test
  // (trashPurgeGating.test) locks the loading-gated form.
  var trashPurgeRanRef = useRef(false);
  var trashPurgeDataRef = useRef(data);
  useEffect(function () { trashPurgeDataRef.current = data; });
  useEffect(function () {
    if (trashPurgeRanRef.current) return;
    if (loading) return;
    trashPurgeRanRef.current = true;
    var id = setTimeout(function () {
      try {
        var cutoffMs = Date.now() - TRASH_RETENTION_DAYS * 24 * 3600 * 1000;
        var res = sweepExpiredTrash(trashPurgeDataRef.current || INIT, cutoffMs);
        if (res.changed) save(res.next);
      } catch (_e) {}
    }, 6000);
    return function () { clearTimeout(id); };
    // Runs once, when `loading` flips false (load() done). `trashPurgeRanRef`
    // guards against re-running if `loading` ever toggles again. One pass at
    // boot is enough; the next boot catches anything that aged past 30 d.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Trash operations extracted to useTrashOps (restore /
  // selective restore / restore-all / permanent delete / empty).
  var { restoreFromTrash, restoreSelectionFromTrash, restoreAllFromTrash, permanentlyDelete, emptyTrash } =
    useTrashOps({ data, save, weightUnit });

  // Stable sub-array refs — only change when that slice of data actually changes.
  // Saves that touch only wishlist/accessories leave all three unchanged,
  // so none of the three memos below recompute.
  //
  var _tobs = liveData?.tobaccos ?? null;
  var _pipesArr = liveData?.pipes ?? null;
  var _sessions = liveData?.sessions ?? null;

  // Extracted to src/utils/stats.ts (pure + fast-check fuzzed).
  var topTobaccos = useMemo(function () {
    return computeTopTobaccos(_tobs, _sessions);
  }, [_tobs, _sessions]);

  var topPipes = useMemo(function () {
    return computeTopPipes(_pipesArr, _sessions);
  }, [_pipesArr, _sessions]);

  // Extracted to src/utils/stats.ts (pure + fast-check fuzzed).
  var chartData = useMemo(
    function () {
      return computeChartStats(_tobs, _pipesArr, _sessions, topTobaccos, topPipes);
    },
    [_tobs, _pipesArr, _sessions, topTobaccos, topPipes],
  );
  var pickJarLotForCtx = useCallback(function(tob: any) { return pickJarLot(tob, weightUnit); }, [weightUnit]);


  // Removed the top-level `if (loading) return <pipe-icon/>`
  // gate. The shell (TopBar + Dock + empty Home) now renders immediately
  // while load() resolves localStorage asynchronously. A loading veil
  // mounted in CuratorApp covers the home content area until data is in.

  // Undo-after-delete. Each call to `withUndo(deleteFn, kind,
  // labelFn)` returns a wrapper that snapshots the current data, runs
  // the delete, and stages an undo toast. Tapping "Annuler" within 8 s
  // calls `save(snapshot)` to restore the entire dataset — simpler and
  // safer than per-entity replay logic. If the user makes other edits
  // during the 8 s window or triggers a second delete, those are
  // overwritten by the undo; the toast is replaced on each new delete
  // so only one undo slot is ever pending. The auto-clear timer fires
  // from a useEffect anchored on `undoToast.ts` so it resets on
  // replacement too.
  function withUndo<A extends any[]>(
    deleteFn: (...args: A) => void,
    kind: string,
    labelFn: (snapshot: any, ...args: A) => string,
  ) {
    return function (...args: A) {
      var snapshot = JSON.parse(JSON.stringify(data));
      var label = labelFn(snapshot, ...args);
      deleteFn(...args);
      setUndoToast({
        kind: kind,
        label: label,
        ts: Date.now(),
        restoreFn: function () {
          save(snapshot);
          setUndoToast(null);
        },
      });
    };
  }
  function _tobName(d: any, id: any): string {
    return entityLabel(findById(d.tobaccos, id));
  }
  function _pipeName(d: any, id: any): string {
    return entityLabel(findById(d.pipes, id));
  }
  function _accName(d: any, id: any): string {
    return entityLabel(findById(d.accessories, id));
  }
  function _wishName(d: any, id: any): string {
    return entityLabel(findById(d.wishlist, id));
  }
  function _sessLabel(d: any, id: any): string {
    var s = findById(d.sessions, id);
    if (!s) return "—";
    var dateStr = (s as any).date || "";
    var tob = (s as any).tobaccoId ? findById(d.tobaccos, (s as any).tobaccoId) : null;
    var tobName = tob ? entityLabel(tob, "") : "";
    return [dateStr, tobName].filter(Boolean).join(" · ") || "—";
  }
  // The maintenance log was the ONE delete with no safety
  // net. Every other delete in the app is a soft-delete plus an 8 s undo toast
  // plus the 30-day trash; `removeMaintenance` hard-filtered the entry out,
  // was not wrapped here, and `MaintFormModal` fires it straight from the
  // bottom bar with no confirm. CLAUDE.md justified the hard delete ("a log
  // entry is minor") and that part still holds — a trash entry for it would be
  // machinery out of proportion. What did not hold is the SILENCE: the one
  // delete you cannot get back was also the only one that said nothing, and
  // the entry carries a free-text `notes` field.
  //
  // `withUndo` snapshots the whole cellar and restores it wholesale, so it
  // needs nothing from the store — which is why this is the cheap fix rather
  // than giving maintenance its own `deletedAt`.
  function _maintLabel(d: any, pipeId: any, entryId: any): string {
    var p = findById(d.pipes, pipeId);
    var list = (p && (p as any).maintenance) || [];
    var e = null;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i] && list[i].id) === String(entryId)) { e = list[i]; break; }
    }
    // The rule for this slot: it is a SUBJECT (maxWidth 240, nowrap,
    // ellipsis), never a sentence. Date first, like _sessLabel.
    var dateStr = (e && e.date) || "";
    var pipeName = p ? entityLabel(p, "") : "";
    return [dateStr, pipeName].filter(Boolean).join(" · ") || "—";
  }
  var removeMaintenanceU = withUndo(removeMaintenance, "maintenance", _maintLabel);
  var deleteTobaccoU = withUndo(deleteTobacco, "tobacco", _tobName);
  var deletePipeU    = withUndo(deletePipe,    "pipe",    _pipeName);
  var deleteAccessoryU = withUndo(deleteAccessory, "accessory", _accName);
  var deleteSessionU = withUndo(deleteSession, "session",  _sessLabel);
  var delWishU       = withUndo(delWish,       "wish",     _wishName);

  // ─── Apply the reference catalogue to the whole cellar ───────────────────
  // The bulk counterpart of `useDbSync` (which does one fiche at form-open).
  // Two-step on purpose: PLAN, show the user the counts, then apply — a pass
  // over every tabac and every wish must never be a single unexplained tap.
  // The decision itself lives in the pure `utils/catalogueApply.ts`, where the
  // "personal data is never overwritten" promise is asserted field by field.
  var _cac = useState<any>(null),
    catalogueApplyPlan = _cac[0],
    setCatalogueApplyPlan = _cac[1];
  var _cab = useState(false),
    catalogueApplyBusy = _cab[0],
    setCatalogueApplyBusy = _cab[1];

  function startCatalogueApply() {
    if (catalogueApplyBusy) return;
    setCatalogueApplyBusy(true);
    // The catalogue is lazy, and the PROSE matters here because `description`
    // is one of the fields applied. A user catalogue carries every language
    // inline, so one load gives the whole thing and planning against it can
    // never produce the partial diff a two-phase load produced.
    loadTobaccoDb()
      .then(function (db) {
        // No catalogue loaded is now the ordinary state. A
        // plan against nothing would report "everything is already current",
        // which is the reassuring message becoming the misleading one — the
        // exact failure the `locked` counter was added to avoid.
        if (!db) {
          setCatalogueApplyBusy(false);
          setCatalogueApplyPlan({ missing: true, entries: [] });
          return;
        }
        var plan = planCatalogueApply(liveData, lang, tobaccoDbLookupSync);
        setCatalogueApplyBusy(false);
        setCatalogueApplyPlan(plan);
      })
      .catch(function () {
        setCatalogueApplyBusy(false);
        setCatalogueApplyPlan({ error: true, entries: [] });
      });
  }

  function doCatalogueApply() {
    var plan = catalogueApplyPlan;
    setCatalogueApplyPlan(null);
    if (!plan || plan.error || !plan.entries || !plan.entries.length) return;
    // Snapshot BEFORE, so the 8 s undo toast can restore the whole cellar —
    // the same wholesale-restore mechanism as withUndo, which is far safer than
    // trying to replay field-level reversals across hundreds of rows.
    var snapshot = JSON.parse(JSON.stringify(data));
    var next = applyCataloguePlan(data, plan, new Date().toISOString());
    save(next);
    setUndoToast({
      kind: "catalogue",
      label: String(t("cat_apply_undo_label"))
        .replace("{n}", String(plan.tobaccosChanged + plan.wishesChanged)),
      ts: Date.now(),
      restoreFn: function () { save(snapshot); setUndoToast(null); },
    });
    setImportRecap({
      msg: String(t("cat_apply_done"))
        .replace("{n}", String(plan.tobaccosChanged + plan.wishesChanged))
        .replace("{f}", String(plan.fieldsChanged)),
      view: "inv",
    });
  }


  var appCtx = {
    // These two were read via useAppCtx() by views
    // (HomeView/Overlays: pendingSync; SettingsModal: dlFile) but were never
    // exposed here — so they were silently `undefined` at runtime (the
    // now-typed AppCtxType surfaced it). pendingSync only worked because the
    // consumers fall back to the `cave-pending-sync` localStorage mirror;
    // dlFile's iOS share-aware download path was dead behind an `if (dlFile)`
    // guard, falling back to a raw anchor. Exposing them fixes both.
    pendingSync,
    importRecap,
    setImportRecap,
    deviceName,
    saveDeviceName,
    dlFile: _dlFile,
    t,
    xl,
    view,
    loading, // CuratorApp uses this to paint the loading veil
    save, // exposed for diagnostic auto-repair
    form,
    setForm,
    lang,
    handlePhotoUpload,
    photoErr,
    // Surface dismiss handler so the overlays banner can
    // clear photoErr on tap.
    setPhotoErr,
    imgLocal,
    setImgLocal,
    imgFail,
    setImgFail,
    addTobacco,
    updateTobacco,
    updateTobaccoTastingNotes,
    nav,
    openDocFromSettings,
    closeDocPage,
    sessionDetail,
    setSessionDetail,
    setFormGuard,
    unsavedConfirm,
    setUnsavedConfirm,
    pipeForm,
    setPipeForm,
    addPipe,
    updatePipe,
    weightUnit,
    lengthUnit,
    fontScale,
    saveFontScale,
    themeId,
    saveThemeId,
    themeMode,
    saveThemeMode,
    currencySymbol,
    saveCurrencySymbol,
    maintReminderThreshold,
    saveMaintReminderThreshold,
    maintRemindersEnabled,
    saveMaintRemindersEnabled,
    accountingEnabled,
    saveAccountingEnabled,
    dateFormat,
    filteredSessions,
    sessGrouped,
    setSessGrouped,
    collapsedSessGroups,
    setCollapsedSessGroups,
    toggleSessGroup,
    sessDefaultWeight,
    setSessDefaultWeight,
    watchLowWeight,
    saveWatchLowWeight,
    setSessForm,
    sessForm,
    data: liveData,
    dataRaw: data,
    restoreFromTrash,
    restoreAllFromTrash,
    restoreSelectionFromTrash,
    permanentlyDelete,
    emptyTrash,
    pickJarLot: pickJarLotForCtx,
    pipeIsActive,
    addSession,
    updateSession,
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
    chartData,
    navToInvFiltered,
    navToInvByAroma,
    navToInvByRating,
    navToPipesFiltered,
    navToPipesFilteredByMaterial,
    navToJournalFiltered,
    navToJournalFilteredByDate,
    setRatingFilter,
    setCatFilter,
    setCutFilter,
    aromaFilter,
    setAromaFilter,
    setBrandFilter,
    setSearch,
    setStatusFilter,
    tobGrouped,
    pipesGrouped,
    setCollapsedTobGroups,
    setCollapsedPipeGroups,
    scrollToTopRef,
    // ScrollSaveRef was historically NOT exposed on ctx,
    // so the InventoryListView write sites (`scrollSaveRef.current["wish"]`)
    // silently no-op'd — they read `undefined` from ctx and skipped via the
    // `if (scrollSaveRef)` guard. The useWishStore consumes it directly
    // (passed in as a hook prop), so saving a wish would read 0 every
    // time. Adding it to ctx restores the round-trip.
    scrollSaveRef,
    setDetail: ctxSetDetail,
    setPipeDet: ctxSetPipeDet,
    crossOpenDetail,
    crossOpenSession,
    BT,
    BL,
    BP,
    BA,
    BJ,
    BW,
    aiAutoFill,
    aiScanLabel,
    aiLoad,
    aiErr,
    aiSource,
    setAiSource,
    aiCompare,
    aiCompareCheck,
    applyAiCompare,
    dismissAiCompare,
    autofillSource,
    saveAutofillSource,
    deleteSession: deleteSessionU,
    editSessId: _editSessId,
    setEditSessId,
    delWish: delWishU,
    wishToInv,
    lotAgingStatus,
    pBrandFilter,
    resetAll,
    tkClear,
    tkGet,
    gdriveLoadOptionPayload,
    // InventoryListView
    detail,
    catFilter,
    cutFilter,
    brandFilter,
    tagFilter,
    setTagFilter,
    navToInvByTag,
    pTagFilter,
    setPTagFilter,
    navToPipesByTag,
    aTagFilter,
    setATagFilter,
    navToAccByTag,
    ratingFilter,
    statusFilter,
    search,
    sortBy,
    setSortBy,
    filtered,
    setTobGrouped,
    collapsedTobGroups,
    toggleTobGroup,
    expandCards,
    setExpandCards,
    expandSessCards,
    setExpandSessCards,
    // InventoryDetailView
    setLightbox,
    setEditId,
    ageLabel,
    showFinished,
    setShowFinished,
    // `lotForm` / `setLotForm` / `addLotMode` / `editLotIdx` / `lotDet` are NO
    // LONGER EXPOSED. They had zero readers in any view — the lot modal is
    // LOCAL state in `InventoryDetailView` that shadows the name — and the one
    // thing that did read `ctx.lotForm` was `deferAutoUpdate`, where it was
    // permanently truthy and blocked every update from an open fiche.
    //
    // Removed rather than left standing: a ctx key that LOOKS wired is what
    // made that defect survive. The store still owns the state internally
    // (`addLotToTobacco` reads `lotOverride || lotForm`); only the exposure is
    // gone. Same call as `filteredAccessories`, for the same reason.
    updateLotInTobacco,
    addLotToTobacco,
    deleteTobacco: deleteTobaccoU,
    // PipesListView
    pipeDet,
    filteredPipes,
    pShapeFilter,
    setPShapeFilter,
    pFilterFilter,
    setPFilterFilter,
    pRatingFilter,
    setPRatingFilter,
    pBowlMaterialFilter,
    setPBowlMaterialFilter,
    pStemMaterialFilter,
    setPStemMaterialFilter,
    journalFilterPipe,
    setJournalFilterPipe,
    journalFilterTobacco,
    setJournalFilterTobacco,
    journalFilterYear,
    setJournalFilterYear,
    journalFilterDate,
    setJournalFilterDate,
    journalFilterCommune,
    setJournalFilterCommune,
    journalFilterCountry,
    setJournalFilterCountry,
    navToJournalFilteredByLocation,
    showFinishedPipes,
    setShowFinishedPipes,
    collapsedPipeGroups,
    setPipesGrouped,
    togglePipeGroup,
    // PipesDetailView
    setEditPipeId,
    setView,
    deletePipe: deletePipeU,
    changePipeStatus,
    addMaintenance,
    updateMaintenance,
    // The ctx key keeps its name so no view changes, but it is the
    // undo-wrapped variant now — the same shape as deleteTobacco/Pipe/etc.,
    // which are exposed as `deleteTobaccoU` under their plain names below.
    removeMaintenance: removeMaintenanceU,
    // WishView
    wishGrouped,
    setWishGrouped,
    searchOpen,
    setSearchOpen,
    catalogSeed,
    wishFocusId,
    setWishFocusId,
    setCatalogSeed,
    trashOpen,
    shoppingOpen,
    setShoppingOpen,
    setTrashOpen,
    settingsTab,
    setSettingsTab,
    collapsedHelpSections,
    toggleHelpSection,
    setAllHelpSectionsCollapsed,
    collapsedWishGroups,
    setCollapsedWishGroups,
    wishForm,
    setWishForm,
    editWishId,
    setEditWishId,
    showWishForm,
    setShowWishForm,
    addWish,
    updateWish,
    toggleWishGroup,
    // AccListView
    accDet,
    accsGrouped,
    setAccsGrouped,
    collapsedAccGroups,
    setCollapsedAccGroups,
    showRetiredAcc,
    setShowRetiredAcc,
    aBrandFilter,
    setABrandFilter,
    aTypeFilter,
    setATypeFilter,
    toggleAccGroup,
    accIsActive,
    // AccDetailView
    setAccDet: ctxSetAccDet,
    setAccForm,
    setEditAccId,
    deleteAccessory: deleteAccessoryU,
    changeAccStatus,
    // AccessoryFormView
    accForm,
    addAccessory,
    updateAccessory,
    // HomeView
    stats,
    visibleSections,
    setVisibleSections,
    setPBrandFilter,
    // SettingsModal
    importModal,
    setImportModal,
    modalOpenTs,
    gdriveStatus,
    setGdriveStatus,
    gdriveConfirm,
    setGdriveConfirm,
    doGdriveConfirm,
    gdriveSave,
    gdriveRestore,
    autoSaveDrive,
    setAutoSaveDrive,
    lastAutoSaveTs,
    gdriveDeleteBackupById,
    // The catalogue's own cloud stream. Wrapped so the
    // Settings section can refresh its meta line after a restore — the hook
    // writes to IndexedDB, which no React state is watching.
    catalogueCloudSave,
    catalogueCloudRestore: catalogueCloudRestoreThenRefresh,
    catalogueCloudStatus,
    gdriveReconnect,
    triggerIosAutosaveReauth,
    cloudProviderId,
    saveCloudProviderId,
    dropboxDisconnect,
    cloudNewerBackup,
    dismissCloudNewerBackup,
    restoreCloudNewerBackup,
    cloudRestoreBusy,
    checkCloudNewerNow,
    runSyncDiagnostic,
    dismissSyncDiag,
    syncDiag,
    syncDiagBusy,
    syncDiagErr,
    syncDiagSource,
    IS_IOS_STANDALONE,
    // Expose IS_IOS too so SettingsModal can re-use it
    // instead of duplicating the userAgent / matchMedia detection
    // (single source of truth = harder to drift).
    IS_IOS,
    backupStatus,
    doExport,
    doExportCSV,
    doBackupZip,
    doCollectionReport,
    doDownloadCsvTemplate,
    // The user's own catalogue.
    catalogueMeta,
    catalogueBusy,
    catalogueOutcome,
    loadCatalogueFile,
    clearCatalogue,
    downloadCatalogueTemplate,
    exportCatalogueCsv,
    catalogueAudit,
    catalogueAuditBusy,
    auditCatalogue,
    clearCatalogueAudit,
    refreshCatalogueMeta,
    startCatalogueApply,
    doCatalogueApply,
    catalogueApplyPlan,
    setCatalogueApplyPlan,
    doImportCsvFile,
    csvIssues,
    clearCsvIssues,
    doImportFile,
    importConfirm,
    applyImport,
    cancelImport,
    saveWeightUnit,
    saveLengthUnit,
    saveDateFormat,
    undoToast,
    setUndoToast,
    exportReminder,
    setExportReminder,
    defaultListGrouped,
    saveDefaultListGrouped,
    canInstallApp: !!installPromptEvent,
    triggerInstall,
    saveLang,
    // On-demand dictionaries — the Settings switcher shows a spinner
    // while a language is fetched and a notice when it could not be.
    langPending,
    langErr,
    termsAccepted,
    acceptTerms,
    // Drive backup encryption (Phase 1)
    driveEncryptionEnabled,
    saveDriveEncryptionEnabled,
    drivePassphrase,
    setDrivePassphrase,
    encryptionPrompt,
    resolveEncryptionPrompt,
    requestDrivePassphrase,
    aiProvider,
    saveAiProvider,
    aiModel,
    aiModelResolved,
    modelProbe,
    probeModel,
    saveAiModel,
    apiKey,
    saveApiKey,
    excludeApiKey,
    setExcludeApiKey,
    updateAvailable,
    newerBuild,
    lastCheckOkMs,
    setMaintFormOpen,
    setLotFormOpen,
    // Read by `pickTopBanner` (utils/bannerStack.ts) so no top banner paints
    // over an open modal, whichever modal it is.
    stackModalOpen,
    updateStatus,
    setUpdateStatus,
    doUpdate,
    checkUpdate,
    autoUpdateCountdown,
    pendingReason,
    deferReason,
    cancelAutoUpdate,
    dismissCountdown,
    saveError,
    setSaveError,
    saveWarn,
    setSaveWarn,
    dismissQuotaWarn,
    changeLotStatus,
    removeLot,
    updatePillDismissed,
    setUpdatePillDismissed,
    justUpdated,
    // LightboxOverlay
    lightbox,
  };
  if (!termsAccepted) {
    return (
      <AppCtx.Provider value={appCtx}>
        <CuratorTermsGate />
      </AppCtx.Provider>
    );
  }
  return (
    <AppCtx.Provider value={appCtx}>
      <CuratorApp />
    </AppCtx.Provider>
  );
}

// Catch "Importing a module script failed" — the iOS Safari
// failure that hits when a lazy chunk fetch races a stale SW cache (the
// race documented in CLAUDE.md → "React.lazy code splitting — narrow
// re-enable"). Detected via the error message; auto-recovery wipes
// every SW registration + every Cache Storage entry then reloads.
// Anti-loop guard: only auto-recover once per 30s window (the flag
// timestamp lives in localStorage and is cleared on successful mount
// older than 5 minutes — see App.tsx mount effect).
export { EB } from "./components/EB.tsx";
export default App;
