// Curator TastingView — handles setup + running stages.
// Running stage features a Web-Animations-API ember pulse around the timer.

import React, { useRef, useState, useEffect } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { safeBgUrl } from "../../utils/imgCache.ts";
import { alpha, fs, fsInput, C, F, CARD_BG } from "../../theme-curator.ts";
import { entityLabel, compareByBrandName, findById, lotPickerLabel } from "../../utils.ts";
import { estimateSessionWeight } from "../../utils/bowlEstimate.ts";
import { isUsableLot, compareLotForPicker, lotWillClose, pickSessionLot, tobaccoHasUsableLot } from "../../utils/lotUtils.ts";
import { useFocusRing, caretToEnd } from "../../components/curator/FormFields.tsx";
import {
  Stars, Lbl, IconBtn, PressCard, TopBar, SectionHead,
  useWAAPILoop, EmptyState,
} from "../../components/curator/primitives.tsx";
import { Modal, ModalHeader } from "../../components/curator/Modal.tsx";
import { Notice } from "../../components/curator/Notice.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { formatTastingTime as formatMs } from "../../hooks/useTastingSession.ts";
import { isValidCoords, formatCoords, joinPlaceParts, captureGeoLocation } from "../../utils/geo.ts";
import { computePipeGhostingRisk } from "../../utils/ghosting.ts";
import { pipeHoursSinceLastSession, PIPE_REST_MIN_HOURS } from "../../utils/rotation.ts";
import { CATS_EN } from "../../constants.ts";
import { AromaPicker } from "../../components/curator/AromaPicker.tsx";

export function CuratorTastingView() {
  const ctx = useAppCtx();
  const {
    view, t, xl, lang, dateFormat, data, weightUnit = "g", nav,
    pipeIsActive, imgLocal, crossOpenDetail,
    tasting, tastingStart, tastingSetupUpdate, tastingSetLocation, tastingIgnite,
    tastingPause, tastingUnpause, tastingUpdate, tastingEnd, tastingCancel,
    tastingElapsedMs, sessDefaultWeight,
    changeLotStatus,
    accountingEnabled = true,
  } = ctx;
  const weightRing = useFocusRing();
  const notesRing = useFocusRing();
  const setupWeightRing = useFocusRing();

  // Cellar → jar confirm before ignite. Mirrors the SessionFormView pattern
  // if the picked lot is still sealed in cellar status, intercept
  // the Ignite action to ask the user before opening the lot. Once accepted,
  // we open the lot via changeLotStatus and queue tastingIgnite via a state
  // flag so React can re-render with the lot now in "jar" before the ignite
  // closure fires — same stale-closure issue as the session form.
  const [pendingCellarConfirm, setPendingCellarConfirm] = useState(false);
  const [pendingPostOpenIgnite, setPendingPostOpenIgnite] = useState<
    null | { lotId: string }
  >(null);
  // Optional location capture during a live tasting.
  // Same UX as SessionFormView: never fires on its own, the browser
  // shows its own permission prompt. The captured point lands on the
  // tasting state itself (tasting.lat / tasting.lng) and is forwarded
  // to the saved session by tastingEnd (see useTastingSession).
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "error">("idle");
  const [geoErr, setGeoErr] = useState<string>("");
  // Audit: abort a pending reverse-geocode on unmount so a late
  // result can't stamp a tasting that has since ended. Parity with
  // SessionFormView.
  const geoAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => { if (geoAbortRef.current) { geoAbortRef.current.abort(); geoAbortRef.current = null; } };
  }, []);
  // Reverse-geocode stamps the place onto the tasting state once
  // it resolves (best-effort). onCoords returns false when tastingSetLocation
  // isn't wired → the invalid-position branch fires (mirrors the original
  // `isValidCoords(...) && tastingSetLocation` guard). See geo.ts.
  function captureTastingLocation() {
    if (geoAbortRef.current) geoAbortRef.current.abort();
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    geoAbortRef.current = ctrl;
    captureGeoLocation({
      t, lang,
      ...(ctrl ? { signal: ctrl.signal } : {}),
      onStatus: setGeoStatus,
      onError: setGeoErr,
      onCoords: (lat, lng) => {
        if (!tastingSetLocation) return false;
        tastingSetLocation(lat, lng);
        return true;
      },
      onPlace: (lat, lng, p) => { if (tastingSetLocation) tastingSetLocation(lat, lng, p); },
    });
  }
  function clearTastingLocation() {
    if (geoAbortRef.current) { geoAbortRef.current.abort(); geoAbortRef.current = null; }
    if (tastingSetLocation) tastingSetLocation(undefined, undefined);
    setGeoStatus("idle"); setGeoErr("");
  }

  // Defense-in-depth weight prefill on tasting setup. The callers in
  // JournalView / InventoryDetailView / PipesDetailView already seed
  // tasting.weightG via tastingStart, but if the tasting was rehydrated
  // from localStorage without a weight, the field would render empty.
  //
  // CRITICAL: `tasting?.weightG` is intentionally OMITTED from the dep
  // array — same reason as SessionFormView. Including it makes the
  // effect re-run on every keystroke, so clearing the field (backspace
  // → "") immediately re-fills with the default and the user can't
  // type a new value. Stage + accountingEnabled are the only legitimate
  // prefill triggers.
  React.useEffect(() => {
    if (!tasting || tasting.stage !== "setup") return;
    if (!tastingSetupUpdate) return;
    // In accounting-off mode the weight setup field is
    // hidden and the value is locked to "0" so the eventual save
    // (addSessionFromTasting → _persistSession) skips deduction.
    if (!accountingEnabled) {
      if (tasting.weightG !== "0") tastingSetupUpdate({ weightG: "0" });
      return;
    }
    // Review fix: guard on a POSITIVE weight (see SessionFormView) so the
    // default is restored after accounting-off had locked weightG to "0".
    if (parseFloat(tasting.weightG) > 0) return;
    const fallback = sessDefaultWeight || (weightUnit === "oz" ? "0.1" : "3");
    tastingSetupUpdate({ weightG: fallback });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasting?.stage, accountingEnabled]);

  // Estimated default weight — mirror of SessionFormView. Seed the
  // setup weight from the picked pipe's chamber size × the tobacco's cut
  // density (bowlEstimate); fall back to the global default when the pipe has
  // no chamber dimensions. Keyed on tasting.pipeId + tasting.tobaccoId (NOT
  // tasting.weightG) so typing never re-fires it — the user's override sticks.
  React.useEffect(() => {
    if (!tasting || tasting.stage !== "setup" || !accountingEnabled) return;
    if (!tastingSetupUpdate || !tasting.pipeId) return;
    const pipe = ((data?.pipes || []) as any[]).find((p: any) => String(p.id) === String(tasting.pipeId));
    const tob = ((data?.tobaccos || []) as any[]).find((tb: any) => String(tb.id) === String(tasting.tobaccoId));
    const next = estimateSessionWeight(pipe, tob, sessDefaultWeight, weightUnit);
    if (tasting.weightG !== next) tastingSetupUpdate({ weightG: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasting?.pipeId, tasting?.tobaccoId, tasting?.stage, accountingEnabled]);

  // Stash the latest tastingIgnite in a ref so the
  // mount-installed effect below always calls the freshest closure,
  // even if a future refactor makes tastingIgnite a useCallback (today
  // it's a stable identity per render but the audit flagged the stale-
  // closure latency).
  const tastingIgniteRef = useRef(tastingIgnite);
  // Intentional: keep the ref pointing to the latest closure for the
  // mount-installed effect below (full rationale in the comment above).
  // eslint-disable-next-line -- ref-during-render is the explicit pattern here.
  tastingIgniteRef.current = tastingIgnite;

  // Post-cellar-open ignite effect — runs once after the user accepts the
  // "open this lot" confirm and React has re-rendered with the lot now in
  // jar status. We verify the referenced lot is "jar" before triggering
  // tastingIgnite so a stale closure cannot fire too early.
  useEffect(() => {
    if (!pendingPostOpenIgnite) return;
    const tob = ((data?.tobaccos || []) as any[]).find(
      (tb: any) => (tb.lots || []).some((l: any) => String(l.id) === String(pendingPostOpenIgnite.lotId)));
    const lot = tob && (tob.lots || []).find(
      (l: any) => String(l.id) === String(pendingPostOpenIgnite.lotId));
    if (!lot || lot.status !== "jar") return;
    setPendingPostOpenIgnite(null);
    const fire = tastingIgniteRef.current;
    fire && fire();
  }, [pendingPostOpenIgnite, data]);

  // Fail-safe: if the lot never reaches "jar" within 3 seconds (lot deleted
  // in parallel, or changeLotStatus didn't land), drop the pending state.
  //
  // And SAY SO. `SessionFormView`'s twin has reported this
  // since it was written; here the user tapped « Ouvrir et allumer », the
  // modal closed, and nothing happened — no tasting, no message, no way to
  // tell a failure from a slow render. The two entry points must behave the
  // same, and a silent no-op on a confirmed destructive-ish action is the
  // worst of the two behaviours to have picked.
  useEffect(() => {
    if (!pendingPostOpenIgnite) return;
    const timer = setTimeout(() => {
      setPendingPostOpenIgnite(null);
      const setSaveError = (ctx && ctx.setSaveError) as ((msg: string | null) => void) | undefined;
      if (setSaveError) {
        setSaveError(t ? t("tasting_open_err") : "Impossible d'ouvrir le lot. La dégustation n'a pas démarré — réessaie.");
      }
    }, 3000);
    return () => clearTimeout(timer);
    // `ctx` and `t` are deliberately out of the deps, exactly as in the
    // SessionFormView twin: `ctx` is a fresh object on every render, so
    // listing it would restart the 3 s timer on each one and the fail-safe
    // would never fire — it would guard nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPostOpenIgnite]);

  if (view !== "tasting") return null;
  if (!tasting) {
    // This was the harshest dead end in the app — one centred
    // sentence, no top bar, and the dock is HIDDEN on `tasting`
    // (NO_DOCK_VIEWS), so there was literally nothing to tap. The only way out
    // was a system-back gesture, which is not an affordance.
    //
    // Two ways forward, because the screen has two honest readings: start the
    // thing this page is for, or leave. Starting seeds the same blank setup
    // HomeViewV2's CTA does, so the two entry points cannot drift.
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: F.body }}>
        <EmptyState
          icon="flame"
          accent={C.ember}
          label={t ? t("tasting_none") : "Aucune séance active."}
          actions={[
            {
              label: t ? t("tasting_title") : "Démarrer une dégustation",
              onClick: () => tastingStart && tastingStart({
                tobaccoId: "", pipeId: "", lotId: "",
                weightG: sessDefaultWeight || (weightUnit === "oz" ? "0.1" : "3"),
              }),
            },
            { label: t ? t("btn_back_home") : "Retour à l’accueil", onClick: () => nav && nav("home"), accent: C.tx2 },
          ]} />
      </div>
    );
  }

  // ──────────── SETUP ────────────
  if (tasting.stage === "setup") {
    // Tobaccos with at least one usable lot — jar OR cellar with positive
    // weight. Mirrors SessionFormView: a cellar lot is allowed
    // because the Ignite action will offer to open it on confirm. Shared
    // `isUsableLot` / `compareByBrandName` keep the two entry points in sync.
    // The shared `tobaccoHasUsableLot`, not a fourth copy of
    // its body — it was exported, unit-tested and DEAD in production (the
    // `tobaccoHasTag` shape, which knip cannot see because its own
    // test counts as a consumer). Plus: keep the CURRENT selection listed even
    // if it stopped being usable. A tasting setup survives relaunches, so its
    // tobacco can have every lot finished in the meantime; dropping it from
    // the options left the select showing "—" while the state still held it.
    // Mirrors SessionFormView's editJ rule. Ignite still refuses — the gate
    // below requires a USABLE lot, which such a tobacco has none of.
    const usableTobs = ((data?.tobaccos || []) as any[])
      .filter((tb: any) => tobaccoHasUsableLot(tb)
        || (!!tasting.tobaccoId && String(tb.id) === String(tasting.tobaccoId)))
      .slice().sort(compareByBrandName);
    const activePipes = ((data?.pipes || []) as any[])
      .filter((p: any) => !pipeIsActive || pipeIsActive(p))
      .slice().sort(compareByBrandName);
    const selTob = tasting.tobaccoId
      ? findById(data?.tobaccos as any[], tasting.tobaccoId) || null
      : null;
    const selUsableLots = selTob
      ? (selTob.lots || []).filter(isUsableLot)
      : [];
    // Resolved against the USABLE lots, not against every lot.
    // `findById` over `selTob.lots` also returns a finished or trashed lot, and
    // the ignite gate below reads this — a stale setup pointing at a lot
    // finished since would have lit up the button and then recorded 0 g.
    const selectedLot = selTob && tasting.lotId
      ? selUsableLots.find((l: any) => String(l.id) === String(tasting.lotId)) || null
      : null;
    const selectedIsCellar = !!(selectedLot && selectedLot.status === "cellar");
    return (
      <div style={{
        position: "relative", minHeight: "100vh",
        background: `radial-gradient(circle at 50% 25%, ${C.washEmber}, ${C.bg} 80%)`,
        fontFamily: F.body, color: C.tx,
      }}>
        <div style={{ paddingBottom: 130 }}>
          <TopBar
            leading={<IconBtn icon="back" onClick={tastingCancel} ariaLabel={t ? t("btn_cancel") : "Annuler"} color={C.cream} />}
            title={t ? t("ttl_prepare_session") : "Préparer une séance"}
            trailing={null}
          />
          <div style={{ padding: "8px 16px 22px" }}>
            <Lbl color={C.ember}>{t ? t("tasting_setup_hint") : "Choisis le tabac et la pipe, puis allume."}</Lbl>
            {/* An <h1>. The setup stage carries three
                `SectionHead` h2s (Tabac / Pipe / Poids) and had no h1 above
                them. The RUNNING stage deliberately gets none: its biggest
                text is the live timer, and a heading whose text changes every
                second is worse than no heading. */}
            <h1 style={{
              margin: 0, padding: 0, fontWeight: 400,
              fontFamily: F.display, fontSize: fs(40), color: C.ivory, marginTop: 8,
              letterSpacing: -0.6, lineHeight: 1.1,
            }}>
              {/* Split into pre / italic-word / post keys so every UI
                language keeps its own word order around the italic noun
                (FR puts the noun first, EN/ES/DE/IT after the adjective). */}
              {t ? t("tasting_upcoming_pre") : ""}
              <span style={{ fontStyle: "italic", color: C.ember }}>{t ? t("tasting_upcoming_word") : "Séance"}</span>
              {t ? t("tasting_upcoming_post") : " à venir"}
            </h1>
          </div>

          {usableTobs.length === 0 && (
            <div style={{ margin: "0 12px 16px" }}>
              <Notice tone="warn">
                {t ? t("tasting_no_usable_tob") : "Aucun tabac avec un lot utilisable. Ajoute ou ouvre un lot avant."}
                {/* The sentence gives an ORDER — "add or open a lot
                    first" — and the lots live on another screen entirely, with
                    the dock hidden on this view. Telling someone to go
                    somewhere they cannot get to is worse than saying nothing. */}
                <div style={{ marginTop: 10 }}>
                  <PressCard onClick={() => nav && nav("inv")} style={{
                    display: "inline-flex", padding: "7px 13px",
                    background: alpha(C.amber, "22"), border: `1px solid ${alpha(C.amber, "66")}`,
                    borderRadius: 8, color: C.amber,
                    fontFamily: F.mono, fontSize: fs(13), letterSpacing: 1.1,
                    textTransform: "uppercase", fontWeight: 700,
                  }}>{t ? t("btn_see_tobaccos") : "Voir mes tabacs"}</PressCard>
                </div>
              </Notice>
            </div>
          )}

          {/* Tobacco picker */}
          <SectionHead title={t ? t("sec_tobacco_lbl") : "Tabac"} accent={C.brassHi} />
          <div style={{ padding: "0 12px 14px" }}>
            <select
              aria-label={t ? t("sec_tobacco_lbl") : "Tabac"}
              value={tasting.tobaccoId || ""}
              onChange={(e) => {
                const tid = e.target.value;
                const auto: any = { tobaccoId: tid, lotId: "" };
                if (tid) {
                  const tob = findById(data?.tobaccos as any[], tid);
                  if (tob) {
                    // The SHARED picker — see the twin in
                    // SessionFormView and the reasoning on `pickSessionLot`.
                    const picked = pickSessionLot(tob, weightUnit);
                    if (picked) auto.lotId = String(picked.id);
                  }
                }
                tastingSetupUpdate && tastingSetupUpdate(auto);
              }}
              style={{
                width: "100%", padding: "12px 14px",
                background: CARD_BG, color: C.ivory,
                border: `1px solid ${C.rule}`, borderRadius: 8,
                fontFamily: F.body, fontSize: fsInput(17),
              }}>
              <option value="">—</option>
              {usableTobs.map((tb: any) => (
                <option key={tb.id} value={String(tb.id)}>
                  {entityLabel(tb, "")}
                </option>
              ))}
            </select>
            {selTob && (() => {
              const photo = selTob.imageUrl ? ((imgLocal && imgLocal[selTob.imageUrl]) || selTob.imageUrl) : null;
              return (
                <div style={{
                  marginTop: 10, padding: "10px 12px",
                  background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  {photo ? (
                    <div style={{
                      width: 48, height: 48, borderRadius: 6, flexShrink: 0,
                      background: `${safeBgUrl(photo)} center/cover no-repeat, ${C.bg3}`,
                      border: `1px solid ${C.rule}`,
                    }} />
                  ) : (
                    <div style={{
                      width: 48, height: 48, borderRadius: 6, flexShrink: 0,
                      background: C.bg3, border: `1px solid ${C.rule}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: C.brass,
                    }}>
                      <Ico name="leaf" size={20} sw={1.4} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Lbl color={C.brassHi}>{selTob.brand}</Lbl>
                    <div style={{
                      fontFamily: F.display, fontSize: fs(20), color: C.ivory, marginTop: 2,
                      fontStyle: "italic",
                    }}>{selTob.name}</div>
                  </div>
                </div>
              );
            })()}
            {/* Lot picker — visible as soon as there is at least one usable
                lot (jar OR cellar) so the user can always see and change the
                selection, mirroring SessionFormView. Cellar lots are kept
                so the user can pick from a sealed tin; Ignite then offers
                to open it. */}
            {selUsableLots.length >= 1 && (
              <div style={{ marginTop: 10 }}>
                <Lbl color={C.tx2}>{t ? t("lbl_sess_lot") : "Pot utilisé"}</Lbl>
                <select
                  aria-label={t ? t("lbl_sess_lot") : "Pot utilisé"}
                  value={tasting.lotId || ""}
                  onChange={(e) => tastingSetupUpdate && tastingSetupUpdate({ lotId: e.target.value })}
                  style={{
                    width: "100%", padding: "10px 14px", marginTop: 6,
                    background: CARD_BG, color: C.ivory,
                    border: `1px solid ${C.rule}`, borderRadius: 8,
                    fontFamily: F.body, fontSize: fsInput(17),
                  }}>
                  {/* An empty option, rendered ONLY when the
                      current value matches none of the listed lots. A
                      `<select>` whose value is unknown displays its FIRST
                      option, so without this the screen showed one lot while
                      the state held another (or nothing) — and the user had no
                      way to see it. It appears for a stale `lotId` carried over
                      from a persisted setup whose lot has since been finished
                      or deleted. Not rendered in the normal case, so no stray
                      "—" appears above a perfectly good selection. */}
                  {!selUsableLots.some((l: any) => String(l.id) === String(tasting.lotId)) && (
                    <option value="">—</option>
                  )}
                  {selUsableLots
                    .slice()
                    .sort(compareLotForPicker)
                    .map((l: any) => (
                      <option key={l.id} value={String(l.id)}>
                        {lotPickerLabel(l, { t, lang, weightUnit, dateFormat })}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {selectedIsCellar && (
              <Notice tone="info" style={{ marginTop: 10 }}>
                {t ? t("tasting_cellar_notice") : "Ce lot est encore en cave (boîte fermée). À l'allumage, l'application proposera de l'ouvrir (passage en pot)."}
              </Notice>
            )}
          </div>

          {/* Pipe picker */}
          <SectionHead title={t ? t("sec_pipe_lbl") : "Pipe"} accent={C.oxbloodHi} />
          <div style={{ padding: "0 12px 14px" }}>
            <select
              aria-label={t ? t("sec_pipe_lbl") : "Pipe"}
              value={tasting.pipeId || ""}
              onChange={(e) => tastingSetupUpdate && tastingSetupUpdate({ pipeId: e.target.value })}
              style={{
                width: "100%", padding: "12px 14px",
                background: CARD_BG, color: C.ivory,
                border: `1px solid ${C.rule}`, borderRadius: 8,
                fontFamily: F.body, fontSize: fsInput(17),
              }}>
              <option value="">—</option>
              {activePipes.map((p: any) => (
                <option key={p.id} value={String(p.id)}>
                  {entityLabel(p, "")}
                </option>
              ))}
            </select>
            {tasting.pipeId && (() => {
              const sp = (data?.pipes || []).find((p: any) => String(p.id) === String(tasting.pipeId));
              if (!sp) return null;
              const photo = sp.imageUrl ? ((imgLocal && imgLocal[sp.imageUrl]) || sp.imageUrl) : null;
              return (
                <div style={{
                  marginTop: 10, padding: "10px 12px",
                  background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  {photo ? (
                    <div style={{
                      width: 48, height: 48, borderRadius: 6, flexShrink: 0,
                      background: `${safeBgUrl(photo)} center/cover no-repeat, ${C.bg3}`,
                      border: `1px solid ${C.rule}`,
                    }} />
                  ) : (
                    <div style={{
                      width: 48, height: 48, borderRadius: 6, flexShrink: 0,
                      background: C.bg3, border: `1px solid ${C.rule}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: C.oxbloodHi,
                    }}>
                      <Ico name="pipe" size={20} sw={1.4} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Lbl color={C.oxbloodHi}>{sp.brand}</Lbl>
                    <div style={{
                      fontFamily: F.display, fontSize: fs(20), color: C.ivory, marginTop: 2,
                      fontStyle: "italic",
                    }}>{sp.name}</div>
                  </div>
                </div>
              );
            })()}
            {/* Rest advisory — a live tasting starts now, so warn
                when the picked pipe was smoked < 24 h ago (identical intent to
                SessionFormView). */}
            {tasting.pipeId && (() => {
              const hrs = pipeHoursSinceLastSession(tasting.pipeId, data?.sessions as any[], Date.now());
              if (hrs === null || hrs >= PIPE_REST_MIN_HOURS) return null;
              return (
                <Notice tone="warn" icon="clock" style={{ marginTop: 8 }}>
                  {t ? t("pipe_rest_warn") : "⏳ Cette pipe a été fumée il y a moins de 24 h — elle n'a pas eu le temps de reposer. L'idéal est de la laisser sécher 1 à 2 jours."}
                </Notice>
              );
            })()}
            {/* Anti-ghosting advisory — identical to SessionFormView
                so both session entry points behave the same. */}
            {tasting.pipeId && tasting.tobaccoId && (() => {
              const risk = computePipeGhostingRisk(
                tasting.pipeId, tasting.tobaccoId, data?.sessions as any[], data?.tobaccos as any[],
              );
              if (!risk) return null;
              const fam = xl ? xl(risk.dominant, CATS_EN) : risk.dominant;
              return (
                <Notice tone="warn" style={{ marginTop: 8 }}>
                  {String(t ? t("ghost_warn_body") : "👻 Cette pipe a surtout fumé du {family} ({count}/{total} séances). Ces tabacs marquent la bruyère — y fumer un autre profil peut en garder le goût. Une pipe dédiée préserve mieux chaque tabac.")
                    .replace("{family}", fam)
                    .replace("{count}", String(risk.count))
                    .replace("{total}", String(risk.total))}
                </Notice>
              );
            })()}
          </div>

          {/* Weight — Hidden when accounting is off. The
              effect above locks tasting.weightG to "0" so the eventual
              save path skips deduction naturally. */}
          {accountingEnabled && (
            <>
              <SectionHead title={t ? t("sec_weight_lbl") : "Poids"} sub={`(${weightUnit})`} accent={C.sage} />
              <div style={{ padding: "0 12px 24px" }}>
                <input
                  type="text" inputMode="decimal"
                  value={tasting.weightG || ""}
                  aria-label={(t ? t("lbl_weight_simple") : "Poids") + " (" + weightUnit + ")"}
                  onChange={(e) => tastingSetupUpdate && tastingSetupUpdate({ weightG: String(e.target.value).replace(",", ".") })}
                  onFocus={(e) => { setupWeightRing.onFocus(); caretToEnd(e); }}
                  onBlur={setupWeightRing.onBlur}
                  style={{
                    width: "100%", padding: "12px 14px",
                    background: CARD_BG, color: C.ivory,
                    border: `1px solid ${C.rule}`, borderRadius: 8,
                    fontFamily: F.mono, fontSize: fsInput(17), letterSpacing: 0.5,
                    outline: "none", transition: "box-shadow 200ms, border-color 200ms",
                    ...(setupWeightRing.style || {}),
                  }}
                />
                {/* "estimé · modifiable" hint when the pre-filled
                    weight is a chamber×cut estimate (picked pipe has chamber
                    dimensions). */}
                {(() => {
                  const p = ((data?.pipes || []) as any[]).find((x: any) => String(x.id) === String(tasting.pipeId));
                  const est = !!(p && parseFloat(String(p.chamberDiameter)) > 0 && parseFloat(String(p.chamberDepth)) > 0);
                  return est ? (
                    <div style={{ marginTop: 6, fontSize: fs(13), color: C.tx3, fontFamily: F.body, lineHeight: 1.4 }}>
                      {t ? t("weight_estimated_hint") : "Estimé d'après le foyer de la pipe et la coupe du tabac · modifiable."}
                    </div>
                  ) : null;
                })()}
              </div>
            </>
          )}

          {/* Optional location capture during setup.
              Same UX shape as SessionFormView. The captured point
              persists on the tasting state and is forwarded to the
              saved session by tastingEnd. */}
          {(() => {
            const tasted: any = tasting;
            const hasGeo = isValidCoords(tasted.lat, tasted.lng);
            return (
              // The 12 px page gutter. Every sibling section of
              // the tasting setup is `padding: "0 12px …"` and this one was a
              // bare `marginTop`, so the Lieu label and its card ran edge to
              // edge while Tabac, Pipe, Poids and the CTA below were all inset
              // — visible as a step in the left margin on every phone. Its
              // SessionFormView twin does not have it because that one is a
              // real `FormSection`, which owns the gutter; this block is hand
              // rolled and simply never got one.
              <div style={{ marginTop: 16, padding: "0 12px" }}>
                <div style={{
                  fontFamily: F.mono, fontSize: fs(12.5), color: C.tx2,
                  letterSpacing: 1.5, textTransform: "uppercase",
                  marginBottom: 6, fontWeight: 600,
                }}>
                  {t ? t("sec_location") : "Lieu"}
                </div>
                {hasGeo ? (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                    padding: "10px 12px", borderRadius: 8,
                    background: CARD_BG, border: `1px solid ${C.rule}`,
                  }}>
                    <span style={{ fontSize: fs(20) }}>📍</span>
                    <span style={{ flex: 1, minWidth: 0, fontFamily: (tasted.locationName || tasted.locationCity || tasted.locationCountry) ? F.body : F.mono, fontSize: fs(14.5), color: C.tx }}>
                      {joinPlaceParts(tasted.locationName, tasted.locationCity, tasted.locationCountry) || formatCoords(tasted.lat as number, tasted.lng as number)}
                    </span>
                    <PressCard onClick={clearTastingLocation} style={{
                      padding: "7px 12px", borderRadius: 8,
                      background: C.bg3, border: `1px solid ${C.rule}`,
                      color: C.tx2, fontFamily: F.mono, fontSize: fs(12.5),
                      letterSpacing: 1, textTransform: "uppercase", fontWeight: 700,
                    }}>
                      {t ? t("btn_remove") : "Retirer"}
                    </PressCard>
                  </div>
                ) : (
                  <PressCard
                    onClick={geoStatus === "loading" ? undefined : captureTastingLocation}
                    ariaBusy={geoStatus === "loading"}
                    style={{
                      padding: "11px 14px", borderRadius: 8,
                      background: "transparent",
                      border: `1px solid ${alpha(C.oxbloodHi, "55")}`, color: C.oxbloodHi,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
                      opacity: geoStatus === "loading" ? 0.6 : 1,
                      cursor: geoStatus === "loading" ? "wait" : "pointer",
                    }}>
                    <span style={{ fontSize: fs(17) }}>📍</span>
                    {geoStatus === "loading"
                      ? (t ? t("geo_locating") : "Localisation…")
                      : (t ? t("btn_add_location") : "Ajouter ma position")}
                  </PressCard>
                )}
                {geoStatus === "error" && geoErr && (
                  <Notice tone="warn" style={{ marginTop: 8 }}>{geoErr}</Notice>
                )}
              </div>
            );
          })()}

          {/* Ignite CTA. When the picked lot is still in cellar status,
              intercept and route through the confirm modal — same pattern
              as SessionFormView's save → cellar confirm flow. */}
          {/* Require tobacco + pipe + a positive weight
              before "Allumer" lights up. Previously only the tobacco
              was checked, so the user could start a tasting with no
              pipe selected or with a zero grammage. A small hint
              appears underneath the button when something's missing. */}
          {(() => {
            const tastingWeight = parseFloat(tasting.weightG) || 0;
            // Weight is required only when accounting is ON.
            // In off-mode the value is locked to 0 and the field is
            // hidden — gating ignite on it would lock the user out.
            // A LOT is required too, when accounting is on.
            // Without it a tasting could be ignited pointing at nothing — and
            // 95 minutes later the auto-end DESTROYED it: `_persistSession`
            // refuses a positive weight with no resolvable lot, and the auto
            // path clears the tasting state whether the save succeeded or not.
            // A whole dégustation lost, announced as « clôturée
            // automatiquement ». The state was reachable (see `pickJarLot`'s
            // note) and, worse, INVISIBLE: the lot `<select>` has no
            // empty option, so a value matching none of them simply displays
            // the first one. Gated on `selectedLot` RESOLVING, not merely on
            // `lotId` being non-empty — a stale id from a persisted setup
            // points at a lot that may no longer exist.
            const canIgnite = !!tasting.tobaccoId && !!tasting.pipeId
              && (!accountingEnabled || (tastingWeight > 0 && !!selectedLot));
            return (
              <div style={{ padding: "0 12px 8px" }}>
                <PressCard onClick={canIgnite
                  ? () => {
                      if (selectedIsCellar) {
                        setPendingCellarConfirm(true);
                        return;
                      }
                      tastingIgnite && tastingIgnite();
                    }
                  : undefined}
                  // The screen's primary CTA. Greyed out until a
                  // tabac + pipe (+ a weight, when accounting is on) are
                  // picked, but it never said so — announce it, so the reason
                  // shown just below is reachable. Found by grepping
                  // `cursor: not-allowed` rather than the one-line
                  // `? undefined` pattern, which missed this multi-line ternary.
                  ariaDisabled={!canIgnite}
                  style={{
                  background: canIgnite
                    ? `linear-gradient(135deg, ${C.ember}, ${C.amber})`
                    : C.card,
                  borderRadius: 12, padding: "16px 18px",
                  display: "flex", alignItems: "center", gap: 12,
                  color: canIgnite ? C.ink : C.tx3,
                  border: canIgnite ? "none" : `1px solid ${C.rule}`,
                  boxShadow: canIgnite ? `0 8px 24px ${alpha(C.ember, "55")}` : "none",
                  opacity: canIgnite ? 1 : 0.5,
                  cursor: canIgnite ? "pointer" : "not-allowed",
                }}>
                  <Ico name="flame" size={24} sw={1.8} />
                  <span style={{ flex: 1, fontFamily: F.display, fontSize: fs(20), fontStyle: "italic", fontWeight: 600 }}>
                    {t ? t("tasting_ignite") : "Allumer"}
                  </span>
                  <Ico name="chevron" size={20} sw={2.2} />
                </PressCard>
                {/* The "Renseigne tabac + pipe avant d'allumer."
                    hint under the button was removed — redundant, the greyed
                    disabled "Allumer" button already signals it's not ready. */}
              </div>
            );
          })()}

          {/* Cellar → jar confirm modal. Fires when the user taps Ignite
              while the picked lot is still sealed (cellar). Confirming
              opens the lot first (changeLotStatus → "jar", auto-fills
              dateOpened), then queues tastingIgnite via the effect above
              once React has re-rendered with the lot's new status. */}
          <Modal open={pendingCellarConfirm}
            onClose={() => setPendingCellarConfirm(false)}
            maxWidth={440}
            ariaLabel={t ? t("tasting_open_lot_q") : "Ouvrir ce lot ?"}>
            <ModalHeader
              overline={t ? t("lbl_confirm") : "Confirmation"}
              title={t ? t("tasting_open_lot_q") : "Ouvrir ce lot ?"}
              onClose={() => setPendingCellarConfirm(false)}
              accent={C.brassHi} />
            <div style={{ padding: "0 18px 14px", color: C.tx, fontSize: fs(15), lineHeight: 1.5 }}>
              {t ? t("tasting_open_lot_body") : "Le lot sélectionné est encore en cave (boîte fermée). Pour démarrer cette dégustation avec ce lot, il faut l'ouvrir (passage en pot). La date d'ouverture sera fixée à aujourd'hui."}
            </div>
            <div style={{ padding: "0 14px 16px", display: "flex", gap: 10 }}>
              <PressCard onClick={() => setPendingCellarConfirm(false)} style={{
                flex: 1, padding: "11px 12px",
                background: C.bg2, border: `1px solid ${C.rule}`,
                borderRadius: 8, textAlign: "center",
                color: C.tx, fontFamily: F.mono, fontSize: fs(13.5),
                letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {t ? t("btn_cancel") : "Annuler"}
              </PressCard>
              <PressCard onClick={() => {
                setPendingCellarConfirm(false);
                if (selTob && selectedLot && selectedLot.id != null && changeLotStatus) {
                  // Locate by stable id (changeLotStatus matches by id now).
                  changeLotStatus(selTob.id, selectedLot.id, "jar");
                  setPendingPostOpenIgnite({ lotId: String(selectedLot.id) });
                }
              }} style={{
                flex: 1, padding: "11px 12px",
                background: alpha(C.brass, "33"), border: `1px solid ${alpha(C.brass, "88")}`,
                borderRadius: 8, textAlign: "center",
                color: C.brassHi, fontFamily: F.mono, fontSize: fs(13.5),
                letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {t ? t("tasting_open_ignite") : "Ouvrir & allumer"}
              </PressCard>
            </div>
          </Modal>
        </div>
      </div>
    );
  }

  // ──────────── RUNNING ────────────
  const elapsed = tastingElapsedMs ? tastingElapsedMs() : 0;
  const paused = tasting.pauseStartTs !== null && tasting.pauseStartTs !== undefined;
  const selTob = tasting.tobaccoId
    ? findById(data?.tobaccos as any[], tasting.tobaccoId) || null
    : null;
  const selPipe = tasting.pipeId
    ? findById(data?.pipes as any[], tasting.pipeId) || null
    : null;
  // Mirror of the SessionFormView heads-up — when the live
  // weight will close out the picked lot, surface a discreet info
  // notice so the user knows the lot will be auto-finished at
  // "Terminer la séance". Pure info, doesn't block.
  const liveLot = selTob && tasting.lotId
    ? findById(selTob.lots as any[], tasting.lotId) || null
    : null;
  const liveWillCloseLot = lotWillClose(liveLot, parseFloat(tasting.weightG) || 0);

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: `radial-gradient(circle at 50% 30%, ${C.washEmber}, ${C.bg} 80%)`,
      fontFamily: F.body, color: C.tx,
    }}>
      <EmberPulse />
      <div style={{ paddingBottom: 130, position: "relative", zIndex: 1 }}>

        <TopBar
          leading={<IconBtn icon="back"
            onClick={() => nav && nav("home")}
            ariaLabel={t ? t("aria_run_background") : "Continuer en arrière-plan"}
            color={C.cream} />}
          title={t ? t("tasting_in_progress") : "Séance en cours"}
          trailing={<IconBtn icon="close"
            onClick={() => { if (window.confirm(t ? t("tasting_confirm_cancel") : "Annuler cette séance ? Le temps écoulé sera perdu.")) tastingCancel && tastingCancel(); }}
            ariaLabel={t ? t("aria_cancel_session") : "Annuler la séance"}
            color={C.cream} />}
        />

        {/* Hero timer */}
        <div style={{ textAlign: "center", padding: "12px 16px 14px" }}>
          <Lbl color={paused ? C.tx2 : C.amber} size={11}>
            ● {paused ? (t ? t("tasting_paused") : "En pause") : (t ? t("tasting_burning_slowly") : "Allumée · brûle lentement")}
          </Lbl>
          <div style={{
            fontFamily: F.display, fontSize: fs(110), color: paused ? C.tx2 : C.ivory, lineHeight: 1,
            letterSpacing: -5, marginTop: 20, fontStyle: "italic",
            textShadow: paused ? "none" : `0 0 40px ${alpha(C.ember, "55")}`,
            fontVariantNumeric: "tabular-nums",
          }}>
            {(() => {
              const f = formatMs(elapsed);
              return <>{f.slice(0, 2)}<span style={{ color: C.ember }}>:</span>{f.slice(3)}</>;
            })()}
          </div>
          {/* Audit finding: mirror the setup-stage gate —
              when accounting is OFF, tasting.weightG is locked to "0" and no
              deduction happens, so surfacing an editable POIDS input here let
              the user type a weight that WAS then deducted at Terminer,
              contradicting the toggle. Hide it, same as the setup stage. */}
          {accountingEnabled && (
            <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8,
              background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
              padding: "4px 8px 4px 12px",
            }}>
              <span style={{
                fontFamily: F.mono, fontSize: fs(13.5), color: C.tx2, letterSpacing: 1.4,
              }}>{t ? t("lbl_weight_upper") : "POIDS"}</span>
              <input
                type="text" inputMode="decimal"
                value={tasting.weightG || ""}
                aria-label={t ? t("lbl_weight_simple") : "Poids"}
                onChange={(e) => tastingUpdate && tastingUpdate({ weightG: String(e.target.value).replace(",", ".") })}
                onFocus={(e) => { weightRing.onFocus(); caretToEnd(e); }}
                onBlur={weightRing.onBlur}
                style={{
                  width: 60, padding: "5px 8px",
                  background: "transparent", color: C.ivory,
                  border: `1px solid ${C.rule}`, borderRadius: 8,
                  fontFamily: F.mono, fontSize: fsInput(17), textAlign: "right",
                  outline: "none", transition: "box-shadow 200ms, border-color 200ms",
                  ...(weightRing.style || {}),
                }}
              />
              <span style={{ fontFamily: F.mono, fontSize: fs(13.5), color: C.tx2 }}>{weightUnit}</span>
            </div>
          )}
        </div>

        {/* Combo card with photos */}
        <div style={{
          margin: "16px 16px", padding: 0,
          background: `linear-gradient(180deg, ${C.card}, ${C.bg2})`,
          border: `1px solid ${C.rule}`, borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{ height: 4, background: `linear-gradient(90deg, ${C.oxblood}, ${C.ember}, ${C.brass})` }} />
          <ComboRow icon="leaf" color={C.brassHi}
            overline={selTob?.brand || "—"} title={selTob?.name || "—"}
            photo={selTob?.imageUrl ? ((imgLocal && imgLocal[selTob.imageUrl]) || selTob.imageUrl) : null}
            onOpen={selTob && crossOpenDetail
              ? () => crossOpenDetail({ view: "inv", kind: "tobacco", obj: selTob })
              : undefined} />
          <div style={{ height: 1, background: C.rule, margin: "0 14px" }} />
          <ComboRow icon="pipe" color={C.oxbloodHi}
            overline={selPipe?.brand || "—"} title={selPipe?.name || "—"}
            photo={selPipe?.imageUrl ? ((imgLocal && imgLocal[selPipe.imageUrl]) || selPipe.imageUrl) : null}
            onOpen={selPipe && crossOpenDetail
              ? () => crossOpenDetail({ view: "pipes", kind: "pipe", obj: selPipe })
              : undefined} />
        </div>

        {/* Controls — pause/resume + stop (ends the session).
            The big "Terminer la séance" label button was replaced by this
            square stop button sitting next to pause. A small
            discreet caption sits under each button. */}
        <div style={{ padding: "12px 16px 16px", display: "flex", justifyContent: "center", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
            <button type="button"
              onClick={paused ? tastingUnpause : tastingPause}
              aria-label={paused ? (t ? t("aria_resume_tasting") : "Reprendre") : (t ? t("aria_pause_tasting") : "Mettre en pause")}
              style={{
                width: 72, height: 72, borderRadius: "50%",
                background: paused
                  ? `linear-gradient(135deg, ${C.ember}, ${C.amber})`
                  : C.cardHi,
                border: `1px solid ${paused ? "transparent" : C.rule2}`,
                color: paused ? C.ink : C.ivory,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
                boxShadow: paused ? `0 8px 24px ${alpha(C.ember, "66")}` : "none",
                transition: "all 240ms",
              }}>
              <Ico name={paused ? "play" : "pause"} size={28} />
            </button>
            <Lbl size={9.5} color={C.tx3} weight={600}>
              {paused ? (t ? t("tasting_btn_resume") : "Reprendre") : (t ? t("tasting_btn_pause") : "Pause")}
            </Lbl>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
            <button type="button"
              onClick={() => {
                tastingEnd();
                // See TobaccoFormView for the iOS auto-save piggyback.
                ctx.triggerIosAutosaveReauth && ctx.triggerIosAutosaveReauth();
              }}
              aria-label={t ? t("tasting_end") : "Terminer la séance"}
              title={t ? t("tasting_end") : "Terminer la séance"}
              style={{
                width: 72, height: 72, borderRadius: "50%",
                background: `linear-gradient(135deg, ${C.brassHi}, ${C.brass})`,
                border: "1px solid transparent",
                color: C.ink,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
                boxShadow: `0 8px 24px ${alpha(C.brass, "44")}`,
                transition: "all 240ms",
              }}>
              <Ico name="stop" size={26} />
            </button>
            <Lbl size={9.5} color={C.tx3} weight={600}>
              {t ? t("tasting_btn_stop") : "Terminer"}
            </Lbl>
          </div>
        </div>

        {/* Rating + Notes */}
        <div style={{
          margin: "0 12px 14px", padding: "14px 16px",
          background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 10,
        }}>
          <Lbl color={C.brassHi}>{t ? t("lbl_rating_lbl") : "Note"}</Lbl>
          <div style={{ marginTop: 8 }}>
            <Stars n={tasting.rating || 0} size={18}
              onChange={(v) => tastingUpdate && tastingUpdate({ rating: v })} />
          </div>
        </div>
        {/* Aroma wheel during the live tasting — same picker as the
            manual session form so both entry points capture the same data. */}
        <div style={{
          margin: "0 12px 14px", padding: "14px 16px",
          background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 10,
        }}>
          <Lbl color={C.brassHi}>{t ? t("aroma_section") : "Arômes"}</Lbl>
          <div style={{ marginTop: 10 }}>
            <AromaPicker
              value={(tasting as any).aromas || []}
              onChange={(next) => tastingUpdate && tastingUpdate({ aromas: next } as any)} />
          </div>
        </div>
        <div style={{
          margin: "0 12px 14px", padding: "14px 16px",
          background: CARD_BG, border: `1px dotted ${C.rule2}`, borderRadius: 10,
        }}>
          <Lbl color={C.brassHi}>{t ? t("tasting_live_notes") : "Notes en direct"}</Lbl>
          <textarea
            value={tasting.notes || ""}
            aria-label={t ? t("tasting_live_notes") : "Notes en direct"}
            onChange={(e) => tastingUpdate && tastingUpdate({ notes: e.target.value })}
            onFocus={notesRing.onFocus}
            onBlur={notesRing.onBlur}
            placeholder={t ? t("tasting_quick_notes_placeholder") : "Notez vos impressions…"}
            style={{
              width: "100%", minHeight: 70, marginTop: 8,
              background: "transparent", border: "none", color: C.cream,
              fontFamily: F.display, fontStyle: "italic", fontSize: fsInput(17),
              lineHeight: 1.6, resize: "vertical", outline: "none",
              borderRadius: 4, transition: "box-shadow 200ms",
              ...(notesRing.focused ? { boxShadow: `0 0 0 2px ${alpha(C.brassHi, "88")}` } : {}),
            }}
          />
        </div>

        {/* Location chip during the running stage too.
            Same captureTastingLocation / clearTastingLocation handlers
            as setup; tastingSetupUpdate now accepts the patch on both
            stages (see useTastingSession). */}
        {(() => {
          const tasted: any = tasting;
          const hasGeo = isValidCoords(tasted.lat, tasted.lng);
          return (
            <div style={{
              margin: "0 12px 14px", padding: "12px 16px",
              background: CARD_BG, border: `1px dotted ${C.rule2}`, borderRadius: 10,
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            }}>
              <span style={{ fontSize: fs(20) }}>📍</span>
              <span style={{ flex: 1, minWidth: 0, fontFamily: F.mono, fontSize: fs(14.5), color: hasGeo ? C.tx : C.tx3 }}>
                {hasGeo
                  ? formatCoords(tasted.lat as number, tasted.lng as number)
                  : (t ? t("sec_location") : "Lieu")}
              </span>
              {hasGeo ? (
                <PressCard onClick={clearTastingLocation} style={{
                  padding: "6px 10px", borderRadius: 8,
                  background: C.bg3, border: `1px solid ${C.rule}`,
                  color: C.tx2, fontFamily: F.mono, fontSize: fs(12),
                  letterSpacing: 1, textTransform: "uppercase", fontWeight: 700,
                }}>
                  {t ? t("btn_remove") : "Retirer"}
                </PressCard>
              ) : (
                <PressCard
                  onClick={geoStatus === "loading" ? undefined : captureTastingLocation}
                  ariaBusy={geoStatus === "loading"}
                  style={{
                    padding: "6px 10px", borderRadius: 8,
                    background: "transparent",
                    border: `1px solid ${alpha(C.oxbloodHi, "55")}`, color: C.oxbloodHi,
                    fontFamily: F.body, fontSize: fs(13.5), fontWeight: 700,
                    opacity: geoStatus === "loading" ? 0.6 : 1,
                    cursor: geoStatus === "loading" ? "wait" : "pointer",
                  }}>
                  {geoStatus === "loading"
                    ? (t ? t("geo_locating") : "Localisation…")
                    : (t ? t("btn_add_location") : "Ajouter ma position")}
                </PressCard>
              )}
            </div>
          );
        })()}

        {/* Heads-up that the live weight will close out the lot
            when the session ends (via the stop button up top). Pure info. */}
        {liveWillCloseLot && (
          <div style={{ padding: "0 12px 12px" }}>
            <Notice tone="info" icon="check">
              {t ? t("tasting_will_close_lot") : "Après cette séance le lot atteint 0 — il sera automatiquement marqué comme Terminé."}
            </Notice>
          </div>
        )}

        {/* Background-hint (the End action lives in the stop button next
            to pause). */}
        <div style={{ padding: "0 12px 0" }}>
          <div style={{
            padding: "0 6px",
            fontSize: fs(13.5), color: C.tx3, lineHeight: 1.5, textAlign: "center",
            fontFamily: F.body,
          }}>
            {t ? t("tasting_bg_hint") : "La séance continue en arrière-plan si tu changes de menu — un bandeau te ramène ici."}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmberPulse() {
  const ref = useRef<HTMLDivElement>(null);
  useWAAPILoop(ref,
    [{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }],
    { duration: 4000 },
  );
  return (
    <div ref={ref} style={{
      position: "absolute", inset: 0, pointerEvents: "none",
      background: `radial-gradient(circle at 50% 25%, ${alpha(C.ember, "30")}, transparent 50%)`,
    }} />
  );
}

// The two rows open their fiche when the entity still exists.
// Same affordance as the journal's session-detail blocks — a
// PressCard plus a chevron — so the two surfaces that show "this tobacco in
// this pipe" behave identically. Leaving a running tasting is a supported move:
// the state lives in `cave-tasting-active`, and the gold banner with
// « Reprendre » is on every non-tasting view, which is the way back.
function ComboRow({
  icon, color, overline, title, photo, onOpen,
}: {
  icon: "leaf" | "pipe"; color: string; overline: string; title: string;
  photo?: string | null;
  onOpen?: (() => void) | undefined;
}) {
  const inner = (
    <div data-combo-row={icon}
      style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{
        width: 50, height: 50, borderRadius: 12, flexShrink: 0,
        background: photo
          ? `${safeBgUrl(photo)} center/cover no-repeat, ${C.bg3}`
          : `linear-gradient(135deg, ${C.bg2}, ${C.bg3})`,
        border: `1px solid ${C.rule}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color,
      }}>
        {!photo && <Ico name={icon} size={24} sw={1.4} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Lbl color={color}>{overline}</Lbl>
        <div style={{
          fontFamily: F.display, fontSize: fs(18), color: C.ivory,
          fontStyle: "italic", marginTop: 2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{title}</div>
      </div>
      {onOpen && <span style={{ color: C.tx3, flexShrink: 0 }}><Ico name="chevron" size={16} sw={2} /></span>}
    </div>
  );
  if (!onOpen) return inner;
  return <PressCard onClick={onOpen} style={{ cursor: "pointer" }}>{inner}</PressCard>;
}
