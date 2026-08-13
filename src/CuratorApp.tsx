// CuratorApp — top-level shell. App.tsx wires hooks + ctx and renders
// this component unconditionally once the user has accepted the terms gate.

import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAppCtx } from "./AppContext.tsx";
import { C, F, DOCK_ACCENT, fs } from "./theme-curator.ts";
import { BottomDock, DOCK_ITEMS } from "./components/curator/BottomDock.tsx";
import { shouldShowDock } from "./utils/dockVisibility.ts";

import { CuratorHomeViewV2 }            from "./views/curator/HomeViewV2.tsx";
import { CuratorInventoryListView }     from "./views/curator/InventoryListView.tsx";
import { CuratorCatalogView }           from "./views/curator/CatalogView.tsx";
import { CuratorInventoryDetailView }   from "./views/curator/InventoryDetailView.tsx";
import { CuratorPipesListView }         from "./views/curator/PipesListView.tsx";
import { CuratorPipesDetailView }       from "./views/curator/PipesDetailView.tsx";
import { CuratorJournalView }           from "./views/curator/JournalView.tsx";
import { CuratorAccListView }           from "./views/curator/AccListView.tsx";
import { CuratorAccessoryDetailView }   from "./views/curator/AccessoryDetailView.tsx";
import { CuratorTastingView }           from "./views/curator/TastingView.tsx";
import { CuratorTastingBanner }         from "./views/curator/TastingBanner.tsx";

import { CuratorTobaccoFormView }       from "./views/curator/TobaccoFormView.tsx";
import { CuratorPipeFormView }          from "./views/curator/PipeFormView.tsx";
import { CuratorAccessoryFormView }     from "./views/curator/AccessoryFormView.tsx";
import { CuratorSessionFormView }       from "./views/curator/SessionFormView.tsx";
import { CuratorWishFormView }          from "./views/curator/WishFormView.tsx";

import { CuratorSearchModal }           from "./views/curator/SearchModal.tsx";
import { CuratorLightboxOverlay }       from "./views/curator/LightboxOverlay.tsx";
import { CuratorOverlays }              from "./views/curator/Overlays.tsx";
import { CuratorWelcomeModal }          from "./views/curator/WelcomeModal.tsx";
import { CuratorStartupNoticeModal }    from "./views/curator/StartupNoticeModal.tsx";
import { CuratorThemeModeNoticeModal }  from "./views/curator/ThemeModeNoticeModal.tsx";
import { CuratorEncryptionPromptModal } from "./views/curator/EncryptionPromptModal.tsx";
import { Modal, ModalHeader } from "./components/curator/Modal.tsx";
import { ModalAction } from "./components/curator/ModalAction.tsx";
import { Notice } from "./components/curator/Notice.tsx";

// Lazy-load the four heaviest off-critical-path surfaces.
// StatsView (+ Charts.jsx ~360 lines), HelpView, TrashModal and
// SettingsModal (1906 lines) only render on explicit user action —
// the user always lands on Home (`view = "home"` is hardcoded on every
// mount). Conditional rendering (`view === 'stats' && <Lazy/>`)
// ensures the chunk fetch doesn't fire on cold start, sidestepping
// an earlier iOS SW race (a release lazied a view that
// could be active at mount). vendor-react manualChunk in vite.config
// stays — React stays isolated for caching across app updates.
const CuratorStatsView     = lazy(() => import("./views/curator/StatsView.tsx").then(m => ({ default: m.CuratorStatsView })));
const CuratorHelpView      = lazy(() => import("./views/curator/HelpView.tsx").then(m => ({ default: m.CuratorHelpView })));
const CuratorDocPageView   = lazy(() => import("./views/curator/DocPageView.tsx").then(m => ({ default: m.CuratorDocPageView })));
const CuratorSettingsModal = lazy(() => import("./views/curator/SettingsModal.tsx").then(m => ({ default: m.CuratorSettingsModal })));
const CuratorTrashModal    = lazy(() => import("./views/curator/TrashModal.tsx").then(m => ({ default: m.CuratorTrashModal })));
const CuratorShoppingModal = lazy(() => import("./views/curator/ShoppingModal.tsx").then(m => ({ default: m.CuratorShoppingModal })));

// Defers the `false` transition of a boolean by `delayMs` so an
// unmount doesn't expose underlying buttons to the iOS/Android
// ghost-click that fires ~150-300ms after a real tap. Used to gate
// modal lazy mounts that close via an X button overlapping another
// tappable surface (e.g. Settings X over the HomeView search icon).
// `true` transitions are immediate so opening the modal is snappy.
// Same defence pattern as the lightbox (see the note in CLAUDE.md).
function useDeferredFalse(value: boolean, delayMs = 320): boolean {
  const [deferred, setDeferred] = useState(value);
  useEffect(() => {
    if (value) { setDeferred(true); return; }
    const t = window.setTimeout(() => setDeferred(false), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return deferred;
}

const VALID_DOCK_IDS = ["home", "inv", "pipes", "acc", "journal", "stats"];

export function CuratorApp() {
  const ctx = useAppCtx();
  const { view, detail, pipeDet, accDet, nav, visibleSections, showWishForm, editWishId, importModal, trashOpen, shoppingOpen, loading, t } = ctx;

  // Ghost-click defence: keep the modal mounted ~320ms after close so
  // the iOS/Android synthetic click triggered by the X tap can't land
  // on the icon underneath (Settings X overlaps HomeView's search
  // icon vertically). See useDeferredFalse + lightbox note.
  const importModalMounted = useDeferredFalse(!!importModal);
  const trashOpenMounted   = useDeferredFalse(!!trashOpen);
  const shoppingOpenMounted = useDeferredFalse(!!shoppingOpen);

  // Reserve top space for the fixed tasting banner so it doesn't overlay
  // each view's TopBar (hiding the search / settings / cloud / trash icons)
  // while a tasting is running. The banner reports its content height via
  // onHeight; 0 when hidden. See CuratorTastingBanner.
  const [bannerH, setBannerH] = useState(0);
  // The height of whichever `top: 0` banner is showing (0 when
  // none). Same mechanism as `bannerH` above, extended to the five banners that
  // never had it — validated on the installed iOS PWA before shipping, since
  // the safe-area inset and the fixed-position behaviour are exactly what
  // headless cannot reproduce.
  const [topBannerH, setTopBannerH] = useState(0);

  const dockId = (() => {
    if (VALID_DOCK_IDS.indexOf(view) !== -1) return view;
    if (view === "addT" || view === "editT" || view === "catalog") return "inv";
    if (view === "addP" || view === "editP") return "pipes";
    if (view === "addA" || view === "editA") return "acc";
    if (view === "addJ" || view === "editJ") return "journal";
    if (detail)  return "inv";
    if (pipeDet) return "pipes";
    if (accDet)  return "acc";
    return null;
  })();

  // Hide dock for full-screen forms, tasting, the reading/doc pages, AND
  // when the wishlist form is taking over the screen. See dockVisibility.ts.
  const showDock = shouldShowDock(view, { showWishForm, editWishId });

  // Filter out optional sections the user disabled in Settings (acc/journal/stats),
  // then translate each label via a "dock_<id>" i18n key so every UI language
  // is covered (es/de/it previously fell back to French labels).
  const dockItems = DOCK_ITEMS
    .filter(it => {
      if (it.id === "acc" || it.id === "journal" || it.id === "stats") {
        return visibleSections?.[it.id] !== false;
      }
      return true;
    })
    .map(it => {
      // Key built in a variable (not inline in t("…")) so doc:check's
      // literal-key extractor doesn't mistake the "dock_" prefix for a key.
      const dockKey = "dock_" + it.id;
      return t ? { ...it, label: t(dockKey) } : it;
    });

  return (
    <>
      <CuratorTastingBanner onHeight={setBannerH} topInset={topBannerH} />
      <div style={{
        // width:100% (NOT 100vw) — 100vw ignores the scrollbar and creates a
        // horizontal-overflow sliver that, combined with body scroll, floats
        // the fixed dock on iOS PWA. See index.html overflow-x:clip + the
        // iOS-PWA dock guardrail in CLAUDE.md (restored after a roll-back undid it).
        width: "100%", minHeight: "100vh",
        background: `radial-gradient(circle at 30% 15%, ${C.washMoss}, ${C.bg} 70%), ${C.bg}`,
        display: "flex", justifyContent: "center",
        fontFamily: F.body, color: C.tx,
      }}>
        <div style={{
          // The column caps at 760 (was 600) so tablets /
          // large screens (iPad, desktop) use more horizontal space. Phones
          // are narrower than 600 anyway, so raising the cap is a strict
          // no-op below 600px — no media query needed. Scroll model, safe-
          // area and position:fixed dock are untouched (the hard-won window-
          // scroll invariants only care about the cap value being centred).
          width: "100%", maxWidth: 760,
          position: "relative",
          background: C.bg,
          boxShadow: "0 0 60px rgba(0,0,0,0.4)",
          // Reserve room for the fixed banners (0 when none) so the active
          // view's TopBar icons stay tappable underneath them.
          //
          // `topBannerH` was added later: the tasting banner had this from
          // long ago, and the five `top: 0` banners did not — so a save
          // failure, a full disk, a rejected photo, a newer cloud backup or an
          // overdue-backup reminder covered the TopBar completely (65 px of
          // 65 at 390 px, measured) and every one of its four buttons with it.
          // The two are SUMMED rather than maxed because they stack: the
          // tasting banner is offset by `topInset` so it sits below whichever
          // top banner is up, instead of the two sharing one rectangle.
          paddingTop: (topBannerH + bannerH) || undefined,
        }}>
          {/* List & detail views — each returns null when not active.
              HomeViewV2 is the sole Home (the classic HomeView was
              removed). Returns null unless view === "home". */}
          <CuratorHomeViewV2 />
          <CuratorInventoryListView />
          <CuratorInventoryDetailView />
          <CuratorCatalogView />
          <CuratorPipesListView />
          <CuratorPipesDetailView />
          <CuratorJournalView />
          <CuratorAccListView />
          <CuratorAccessoryDetailView />
          <CuratorTastingView />

          {/* Lazy views — gated so the chunk fetch only fires on user
              navigation, never on cold start (see the note above). */}
          {view === "stats" && (
            <Suspense fallback={null}><CuratorStatsView /></Suspense>
          )}
          {view === "help" && (
            <Suspense fallback={null}><CuratorHelpView /></Suspense>
          )}
          {(view === "changelog" || view === "privacy" || view === "licenses") && (
            <Suspense fallback={null}><CuratorDocPageView /></Suspense>
          )}

          {/* Forms — each returns null when its view is not active */}
          <CuratorTobaccoFormView />
          <CuratorPipeFormView />
          <CuratorAccessoryFormView />
          <CuratorSessionFormView />
          <CuratorWishFormView />

          {/* Bottom navigation — PORTALED to document.body (re-applying the
              float fix, reverted by a later roll-back and
              re-broken by the recessed-tone sweep's backdrop/filter surfaces).
              The dock is position:fixed; if ANY ancestor in the app column
              gains a containing-block property (transform / filter /
              backdrop-filter / contain / will-change), a fixed child silently
              drops into flow and the dock "floats" mid-page on the installed
              iOS PWA (works in Safari, breaks in the PWA). Rendering it straight
              under <body> makes it immune regardless of what the views do. It
              stays in the React tree via createPortal, so ctx + props are
              intact. Locked by src/__tests__/curator/dockPortal.test.tsx. */}
          {showDock && typeof document !== "undefined" && createPortal(
            <BottomDock
              active={dockId}
              onNav={(id) => {
                // IOS-style "tap active tab to scroll to top".
                // If the user taps the dock tab they're already on,
                // nav() doesn't trigger a view change so the scroll-
                // -restore useEffect doesn't fire — we force the scroll
                // to top here. nav() is still called (it also clears
                // detail / pipeDet / accDet so a "tap leaf while on a
                // tobacco fiche" lands on the list, not silently
                // staying on the detail).
                if (nav) nav(id);
                if (id === dockId) {
                  requestAnimationFrame(function () { window.scrollTo(0, 0); });
                }
              }}
              navLabel={t ? t("sec_sections") : "Sections"}
              accent={dockId ? DOCK_ACCENT[dockId] : C.brass}
              items={dockItems}
            />,
            document.body,
          )}

          {/* Global modals */}
          <CuratorSearchModal />
          {importModalMounted && (
            <Suspense fallback={null}><CuratorSettingsModal /></Suspense>
          )}
          {trashOpenMounted && (
            <Suspense fallback={null}><CuratorTrashModal /></Suspense>
          )}
          {shoppingOpenMounted && (
            <Suspense fallback={null}><CuratorShoppingModal /></Suspense>
          )}
          <CuratorLightboxOverlay />
          <CuratorUnsavedConfirmModal />
          <CuratorCatalogueApplyModal />

          {/* Loading veil. Renders the shell instantly while
              load() resolves localStorage. The veil covers the home
              content area (not the TopBar/Dock — those live further up
              in their respective views, but in practice the radial
              gradient + pipe icon read as a unified "loading" state).
              Fades out as soon as `loading` flips to false. */}
          {loading && (
            <div
              aria-busy="true"
              style={{
                position: "absolute", inset: 0,
                background: C.bg,
                display: "flex", alignItems: "center", justifyContent: "center",
                pointerEvents: "auto",
                zIndex: 9000,
              }}
            >
              <div style={{ textAlign: "center", color: C.tx2 }}>
                <div style={{ fontSize: fs(44), marginBottom: 12 }}>🪈</div>
                <div style={{ letterSpacing: 3, fontSize: fs(14), textTransform: "uppercase", fontFamily: F.mono }}>
                  {t ? t("loading") : "Chargement..."}
                </div>
                <a
                  href="./reset.html"
                  style={{
                    display: "block", marginTop: 24, fontSize: fs(12),
                    color: C.tx3, textDecoration: "none",
                    opacity: 0, animation: "fadeInSlow 1s 5s forwards",
                  }}
                >
                  {t ? t("repair_app_link") : "Rien ne se passe ? Réparer l'application →"}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Side overlays that float over the viewport */}
      <CuratorOverlays onTopBannerHeight={setTopBannerH} />
      <CuratorWelcomeModal />
      <CuratorStartupNoticeModal />
      <CuratorThemeModeNoticeModal />
      <CuratorEncryptionPromptModal />
    </>
  );
}

// "unsaved changes" confirm — opened by goBack when the user
// swipe-backs / system-backs out of a MODIFIED edit form. Save runs the form's
// save handler (validates + navigates), Discard runs its cancel (leaves), and
// the backdrop / Annuler dismisses it (stays on the form).
// Confirmation for the bulk catalogue pass. It states the COUNTS
// before anything is written, and — the part that matters — names what will
// NEVER be touched. A pass over every tabac and every wish must not be a
// single unexplained tap, and the reassurance has to be at the point of
// decision, not buried in the help.
// Exported for tests: this modal is the ONLY confirmation
// standing between a tap and a pass over every tobacco and every wish, and
// it had no test at all — including the two branches (the `locked`
// counter, the `missing` case) written precisely so a reassuring message
// cannot become the misleading one.
export function CuratorCatalogueApplyModal() {
  const {
    catalogueApplyPlan: plan, setCatalogueApplyPlan, doCatalogueApply, t,
    setImportModal, setSettingsTab,
  } = useAppCtx();
  if (!plan) return null;
  const close = () => setCatalogueApplyPlan(null);
  // A pass with NO catalogue loaded would plan zero changes
  // and land on `nothing`, i.e. announce "everything is already up to date" —
  // true of the rows it looked at (none) and false about the cellar. Same
  // shape as the `locked` counter: the reassuring message becoming
  // the misleading one.
  const missing = !!plan.missing;
  const nothing = !plan.error && !missing && !(plan.entries && plan.entries.length);
  function openSettings() {
    close();
    if (setSettingsTab) setSettingsTab("data");
    if (setImportModal) setImportModal(true);
  }
  return (
    <Modal open={!!plan} onClose={close} ariaLabel={t("cat_apply_title")}>
      <div style={{ padding: 18 }}>
        <h2 style={{
          margin: "0 0 10px", fontFamily: F.display, fontWeight: 400,
          fontSize: fs(22), color: C.title,
        }}>{t("cat_apply_title")}</h2>
        {plan.error ? (
          <Notice tone="error">{t("cat_apply_err")}</Notice>
        ) : missing ? (
          <Notice tone="info">{t("cat_missing_hint")}</Notice>
        ) : nothing ? (
          <>
            <Notice tone="success">{t("cat_apply_nothing")}</Notice>
            {/* Without this line, a cellar whose matching fiches
                are ALL pinned would read "everything is already up to date" —
                true of the rows the pass looked at, and false about the ones
                it deliberately did not. The count has to appear in BOTH
                branches or the reassuring one becomes the misleading one. */}
            {plan.locked > 0 && (
              <div style={{
                fontFamily: F.body, fontSize: fs(14), color: C.tx2,
                margin: "10px 0 0", lineHeight: 1.5,
              }}>
                {String(t("cat_apply_locked")).replace("{n}", String(plan.locked))}
              </div>
            )}
          </>
        ) : (
          <>
            <Notice tone="info">
              {String(t("cat_apply_plan"))
                .replace("{n}", String(plan.tobaccosChanged + plan.wishesChanged))
                .replace("{f}", String(plan.fieldsChanged))}
            </Notice>
            <div style={{
              fontFamily: F.body, fontSize: fs(14), color: C.tx2,
              margin: "10px 0 0", lineHeight: 1.5,
            }}>
              <div>{t("cat_apply_fields")}</div>
              <div style={{ marginTop: 6, color: C.sageHi }}>{t("cat_apply_safe")}</div>
              {plan.unmatched > 0 && (
                <div style={{ marginTop: 6 }}>
                  {String(t("cat_apply_unmatched")).replace("{n}", String(plan.unmatched))}
                </div>
              )}
              {plan.locked > 0 && (
                <div style={{ marginTop: 6, color: C.steelHi }}>
                  {String(t("cat_apply_locked")).replace("{n}", String(plan.locked))}
                </div>
              )}
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          {missing && (
            <ModalAction onClick={openSettings}>{t("btn_cat_open_settings")}</ModalAction>
          )}
          {!plan.error && !missing && !nothing && (
            <ModalAction onClick={doCatalogueApply}>{t("cat_apply_go")}</ModalAction>
          )}
          <ModalAction variant="secondary" onClick={close}>
            {t(nothing || missing || plan.error ? "btn_close" : "btn_cancel")}
          </ModalAction>
        </div>
      </div>
    </Modal>
  );
}

function CuratorUnsavedConfirmModal() {
  const ctx = useAppCtx();
  const { unsavedConfirm, setUnsavedConfirm, t } = ctx;
  const uc = unsavedConfirm;
  return (
    <Modal open={!!uc} onClose={() => setUnsavedConfirm && setUnsavedConfirm(null)}
      maxWidth={420} ariaLabel={t ? t("unsaved_title") : "Modifications non enregistrées"}>
      <div style={{ padding: 18 }}>
        <ModalHeader title={t ? t("unsaved_title") : "Modifications non enregistrées"}
          onClose={() => setUnsavedConfirm && setUnsavedConfirm(null)} />
        <p style={{ margin: "10px 0 18px", fontSize: fs(14), lineHeight: 1.5, color: C.tx2, fontFamily: F.body }}>
          {t ? t("unsaved_body") : "Vous avez des modifications non enregistrées. Que voulez-vous faire ?"}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ModalAction variant="primary"
            onClick={() => { const f = uc && uc.onSave; setUnsavedConfirm && setUnsavedConfirm(null); if (f) f(); }}>
            {t ? t("unsaved_save") : "Enregistrer"}
          </ModalAction>
          <ModalAction variant="danger"
            onClick={() => { const f = uc && uc.onDiscard; setUnsavedConfirm && setUnsavedConfirm(null); if (f) f(); }}>
            {t ? t("unsaved_discard") : "Quitter sans enregistrer"}
          </ModalAction>
          <ModalAction variant="secondary"
            onClick={() => setUnsavedConfirm && setUnsavedConfirm(null)}>
            {t ? t("btn_cancel") : "Annuler"}
          </ModalAction>
        </div>
      </div>
    </Modal>
  );
}
