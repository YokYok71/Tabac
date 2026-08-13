// Curator SessionFormView — Add / Edit a tasting session (journal entry).

import { useState, useEffect, useRef } from "react";
import { useUnsavedFormGuard } from "../../hooks/useUnsavedFormGuard.ts";
import { useAppCtx } from "../../AppContext.tsx";
import {
  FormScreen, FormSection,
  TextField, TextAreaField, SelectField, StarsField,
} from "../../components/curator/FormFields.tsx";
import { PressCard, Lbl } from "../../components/curator/primitives.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { Modal, ModalHeader } from "../../components/curator/Modal.tsx";
import { Notice } from "../../components/curator/Notice.tsx";
import { alpha, fs, fsInput, C, F } from "../../theme-curator.ts";
import { useFocusRing } from "../../components/curator/FormFields.tsx";
import { safeBgUrl } from "../../utils/imgCache.ts";
import { fmtDate, entityLabel, compareByBrandName, findById, lotPickerLabel } from "../../utils.ts";
import { estimateSessionWeight } from "../../utils/bowlEstimate.ts";
import { isUsableLot, compareLotForPicker, lotWillClose, pickSessionLot, tobaccoHasUsableLot } from "../../utils/lotUtils.ts";
import { isValidCoords, captureGeoLocation, reverseGeocode } from "../../utils/geo.ts";
import { computePipeGhostingRisk } from "../../utils/ghosting.ts";
import { pipeHoursSinceLastSession, sessionStartMs, PIPE_REST_MIN_HOURS } from "../../utils/rotation.ts";
import { CATS_EN } from "../../constants.ts";
import { AromaPicker } from "../../components/curator/AromaPicker.tsx";

export function CuratorSessionFormView() {
  const ctx = useAppCtx();
  const {
    view, sessForm: form, setSessForm: setForm, t, xl, lang, dateFormat, nav, BJ,
    addSession, updateSession, data, weightUnit = "g",
    pipeIsActive, updateTobaccoTastingNotes,
    changeLotStatus,
    sessDefaultWeight,
    imgLocal,
    accountingEnabled = true,
    triggerIosAutosaveReauth,
  } = ctx;

  // CuratorApp mounts every view simultaneously and only the matching
  // `view` renders content — the others return null. React's hook order
  // must therefore be stable across those transitions: every hook MUST
  // be called BEFORE any early return, or React throws #310 ("rendered
  // more hooks than during the previous render") when the user navigates
  // into addJ/editJ. See CLAUDE.md "Hook-order trap".
  const [tnDraft, setTnDraft] = useState<string>("");
  const tnRing = useFocusRing();
  // Pending cellar confirm — when the user tries to save but the selected
  // lot is still in "cellar" status, we hold the save and ask whether to
  // open the lot first (transition cellar → jar before deduction).
  const [pendingCellarConfirm, setPendingCellarConfirm] = useState(false);
  // After confirming the cellar → jar opening we cannot call addSession
  // synchronously: the addSession closure still references the previous
  // render's data. We flip this flag, let React re-render with the lot now
  // "jar", and the effect below kicks off the actual save with fresh
  // closures.
  const [pendingPostOpenSave, setPendingPostOpenSave] = useState<
    null | { lotId: string; mode: "add" | "edit" }
  >(null);
  // Session location capture state. "idle" → button,
  // "loading" → spinner label, "error" → message. The captured
  // coordinates live on the form itself (form.lat / form.lng), not in
  // local state, so they persist through the save like every other
  // field. This state only tracks the in-flight capture UX.
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "error">("idle");
  const [geoErr, setGeoErr] = useState<string>("");
  // Reverse-geocoding busy flag (coords → place name, no AI).
  const [geoNameBusy, setGeoNameBusy] = useState<boolean>(false);
  // Audit: abort an in-flight reverse-geocode when the user
  // switches to a different session or leaves the form, so a late place
  // name can't stamp the wrong session's location.
  const geoAbortRef = useRef<AbortController | null>(null);
  // Manual (editable) coordinate entry — a session logged after
  // the fact can carry a location without GPS. Local string state backs the
  // two inputs so partial values (a trailing ".", a lone "-") survive typing;
  // the parsed number is committed to form.lat / form.lng. Re-seeded when a
  // DIFFERENT session is opened (edit A → edit B, or + → edit), keyed on the
  // edited-session identity + view, NOT on the coord value (prefill-race
  // rule) — GPS capture / clear update the text explicitly instead.
  const [latText, setLatText] = useState<string>(() => (form?.lat != null ? String(form.lat) : ""));
  const [lngText, setLngText] = useState<string>(() => (form?.lng != null ? String(form.lng) : ""));
  const editSessIdForGeo = ctx.editSessId;
  useEffect(() => {
    // Prefill-race rule: re-seed ONLY when a different session/view is
    // opened, never on form.lat/lng (the values this effect writes) —
    // listing them in the deps would clobber the user's keystrokes.
    setLatText(form?.lat != null ? String(form.lat) : "");
    setLngText(form?.lng != null ? String(form.lng) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSessIdForGeo, view]);
  // Audit: the cleanup fires on session/view change AND unmount,
  // cancelling any pending reverse-geocode from the previous session.
  useEffect(() => {
    return () => { if (geoAbortRef.current) { geoAbortRef.current.abort(); geoAbortRef.current = null; } };
  }, [editSessIdForGeo, view]);
  const onLatText = (v: string) => {
    setLatText(v);
    const n = parseFloat(v);
    set({ lat: Number.isFinite(n) ? n : undefined });
  };
  const onLngText = (v: string) => {
    setLngText(v);
    const n = parseFloat(v);
    set({ lng: Number.isFinite(n) ? n : undefined });
  };
  const selectedTobId = form?.tobaccoId
    ? ((data?.tobaccos || []) as any[]).find((tb: any) => String(tb.id) === String(form.tobaccoId))?.id
    : undefined;

  // Defense-in-depth weight prefill: every caller (JournalView "+" button,
  // InventoryDetailView and PipesDetailView tasting buttons) already seeds
  // sessForm.weightG with the default, but a fresh nav("addJ") that bypasses
  // those entry points (or a stale ctx wiring) would leave the field empty.
  // This effect guarantees the field is always populated on addJ mount.
  //
  // CRITICAL: `form?.weightG` is intentionally OMITTED from the dep array.
  // Adding it back creates a race against the user's typing: clearing the
  // input (backspace → "") would trigger the effect, which would
  // immediately refill with the default value before the next keystroke
  // landed. The user reported "I can't change the session weight even
  // with accounting on". Rely on the `view` and `accountingEnabled` deps
  // — both cover every legitimate prefill trigger (view enter, toggle
  // flip). When the user types, only `set({ weightG: v })` should fire.
  useEffect(() => {
    if (view !== "addJ" && view !== "editJ") return;
    if (!form || !setForm) return;
    // In accounting-off mode the weight field is hidden, so a
    // NEW session is forced to weightG="0" (no deduction).
    // Audit: but do NOT zero it on EDIT. An existing session
    // created while accounting was ON carries a real recorded weight; zeroing
    // it here would (a) reverse its lot deduction — silently restoring grams to
    // the cellar / reactivating a finished lot — and (b) destroy the
    // consumption record, on what the user intended as a notes-only edit.
    // Preserving the stored weight keeps net delta 0 on save (no reversal); the
    // field stays hidden either way.
    if (!accountingEnabled) {
      if (view === "addJ" && form.weightG !== "0") setForm(Object.assign({}, form, { weightG: "0" }));
      return;
    }
    if (view !== "addJ") return;
    // Review fix: guard on a POSITIVE weight, not just non-empty — after
    // accounting-off forced weightG="0", `"0" !== ""` was truthy and the
    // default weight never got restored when accounting was re-enabled.
    if (parseFloat(form.weightG) > 0) return;
    const fallback = sessDefaultWeight || (weightUnit === "oz" ? "0.1" : "3");
    setForm(Object.assign({}, form, { weightG: fallback }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, accountingEnabled]);

  // Estimated default weight. On a NEW session, seed the weight from
  // the picked pipe's chamber size × the tobacco's cut density (bowlEstimate);
  // when the pipe has no chamber dimensions, fall back to the global Settings
  // default. Keyed on form.pipeId + form.tobaccoId (screen signals) and NOT on
  // form.weightG — typing in the weight field never re-fires this (prefill-race
  // rule), so the user's override sticks until they change the pipe or tobacco.
  // Add-mode + accounting-on only: editing keeps the recorded weight, and
  // accounting-off forces weightG="0" via the effect above.
  useEffect(() => {
    if (view !== "addJ" || !accountingEnabled) return;
    if (!form || !setForm || !form.pipeId) return;
    const pipe = ((data?.pipes || []) as any[]).find((p: any) => String(p.id) === String(form.pipeId));
    const tob = ((data?.tobaccos || []) as any[]).find((tb: any) => String(tb.id) === String(form.tobaccoId));
    const next = estimateSessionWeight(pipe, tob, sessDefaultWeight, weightUnit);
    if (form.weightG !== next) setForm(Object.assign({}, form, { weightG: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.pipeId, form?.tobaccoId, view, accountingEnabled]);

  // Tasting-notes draft sync — pull the latest notes when the user picks
  // a different tobacco. Reads ctx-derived `selectedTobId` so it stays
  // hoisted above the early returns alongside the other hooks.
  //
  // `data` MUST NOT be in the dep array (prefill-race
  // invariant — CLAUDE.md "Prefill-race trap"). Any auto-save Drive or
  // background hook that re-creates the `data` object re-fires the
  // effect, wiping the user's in-progress edit of the textarea back
  // to the tobacco's saved tastingNotes. The legitimate triggers are
  // "user picked a different tobacco" (selectedTobId) and screen entry
  // (view). The closure captures `data` from the current render anyway,
  // so when selectedTobId DOES change, the latest data is read.
  useEffect(() => {
    if (view !== "addJ" && view !== "editJ") return;
    const tob = ((data?.tobaccos || []) as any[]).find((tb: any) => String(tb.id) === String(selectedTobId));
    setTnDraft(tob?.tastingNotes || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTobId, view]);

  // Post-cellar-open save effect — runs once after the user accepts the
  // "open this lot" confirm and React has re-rendered with the lot now in
  // jar status. We verify the referenced lot is "jar" before triggering
  // the actual session save so a stale closure cannot fire too early.
  useEffect(() => {
    if (!pendingPostOpenSave) return;
    const tob = ((data?.tobaccos || []) as any[]).find(
      (tb: any) => (tb.lots || []).some((l: any) => String(l.id) === String(pendingPostOpenSave.lotId)));
    const lot = tob && (tob.lots || []).find(
      (l: any) => String(l.id) === String(pendingPostOpenSave.lotId));
    if (!lot || lot.status !== "jar") return;
    const mode = pendingPostOpenSave.mode;
    setPendingPostOpenSave(null);
    if (mode === "edit") updateSession && updateSession();
    else addSession && addSession();
    // This effect still runs under the original user
    // gesture (the confirm-modal tap) — propagate the iOS reauth
    // trigger so the deferred save path is covered too.
    triggerIosAutosaveReauth && triggerIosAutosaveReauth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPostOpenSave, data]);

  // Fail-safe: if the lot referenced by the pending
  // save never reaches "jar" status within 3 seconds (because the lot
  // was deleted in parallel, or the changeLotStatus call somehow
  // didn't propagate), drop the pending state and surface an error
  // so the user knows the save didn't go through.
  useEffect(() => {
    if (!pendingPostOpenSave) return;
    const timer = setTimeout(() => {
      setPendingPostOpenSave(null);
      const setSaveError = (ctx && ctx.setSaveError) as ((msg: string | null) => void) | undefined;
      if (setSaveError) {
        setSaveError(t ? t("session_open_err") : "Impossible d'ouvrir le lot avant l'enregistrement. La séance n'a pas été enregistrée — réessaie.");
      }
    }, 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPostOpenSave]);

  // Unsaved-changes guard (edit only). `submit`/`cancel` depend on
  // state computed below the early returns (selected lot / cellar / draft), so
  // route them through refs the render fills in just before FormScreen — the
  // hook itself (useRef + useEffect) must sit above the early returns.
  const sessSaveRef = useRef<() => void>(() => {});
  const sessCancelRef = useRef<() => void>(() => {});
  useUnsavedFormGuard((view === "addJ" || view === "editJ") && !!form, form,
    () => sessSaveRef.current(), () => sessCancelRef.current());

  if (view !== "addJ" && view !== "editJ") return null;
  if (!form) return null;
  const isEdit = view === "editJ";

  const set = (patch: any) => setForm(Object.assign({}, form, patch));
  const cancel = () => { setForm(Object.assign({}, BJ)); nav("journal", { restoreScroll: true }); };

  // Explicit geolocation capture. Never fires on its own
  // — only on the user's tap. The browser shows its own permission
  // prompt the first time. On success we stamp form.lat / form.lng; on
  // failure we surface a localized message and stay in "error".
  const hasGeo = isValidCoords(form.lat, form.lng);
  // Reverse-geocode fills the place name (best-effort, Nominatim,
  // no AI). Functional setForm so the async result merges with the latest
  // form (which now carries lat/lng). See captureGeoLocation in geo.ts.
  const captureLocation = () => {
    if (geoAbortRef.current) geoAbortRef.current.abort();
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    geoAbortRef.current = ctrl;
    captureGeoLocation({
      t, lang,
      ...(ctrl ? { signal: ctrl.signal } : {}),
      onStatus: setGeoStatus,
      onError: setGeoErr,
      onCoords: (lat, lng) => { set({ lat, lng }); setLatText(String(lat)); setLngText(String(lng)); return true; },
      onGeocodeStart: () => setGeoNameBusy(true),
      onGeocodeEnd: () => setGeoNameBusy(false),
      // Audit: preserve-if-empty (match refreshLocationName) so a
      // partial geocode (e.g. name but no commune) can't wipe a field the
      // user already filled.
      onPlace: (_lat, _lng, p) => setForm((prev: any) => Object.assign({}, prev, {
        locationName: p.name || prev.locationName,
        locationCity: p.city || prev.locationCity,
        locationCountry: p.country || prev.locationCountry,
      })),
    });
  };
  const clearLocation = () => { if (geoAbortRef.current) { geoAbortRef.current.abort(); geoAbortRef.current = null; } set({ lat: undefined, lng: undefined, locationName: undefined, locationCity: undefined, locationCountry: undefined }); setLatText(""); setLngText(""); setGeoStatus("idle"); setGeoErr(""); setGeoNameBusy(false); };
  // Reverse-geocode the CURRENT coordinates (typed by hand) into
  // Lieu / Commune / Pays — OpenStreetMap, no AI, no GPS. Only overwrites a
  // field when the lookup returns a non-empty value, so a failed request
  // never wipes what the user already entered.
  const refreshLocationName = () => {
    if (!isValidCoords(form.lat, form.lng) || geoNameBusy) return;
    setGeoNameBusy(true);
    reverseGeocode(form.lat as number, form.lng as number, lang)
      .then((p) => setForm((prev: any) => Object.assign({}, prev, {
        locationName: p.name || prev.locationName,
        locationCity: p.city || prev.locationCity,
        locationCountry: p.country || prev.locationCountry,
      })))
      .finally(() => setGeoNameBusy(false));
  };

  // addJ: show tobaccos with at least one lot (jar OR cellar) with positive
  //       balance. Cellar lots are kept so the user can pick from a sealed
  //       tin and transition it to "jar" with a confirm on save.
  //       0g lots are filtered out — no usable balance for deduction.
  // editJ: always include the currently selected tobacco (even if no usable lot).
  const tobOptions = ((data?.tobaccos || []) as any[])
    .filter((tb: any) => {
      // The shared helper, not a copy of its body.
      if (tobaccoHasUsableLot(tb)) return true;
      return isEdit && String(tb.id) === String(form.tobaccoId);
    })
    .slice()
    .sort(compareByBrandName)
    .map((tb: any) => ({ value: String(tb.id), label: entityLabel(tb) }));

  const pipeOptions = ((data?.pipes || []) as any[])
    .filter((p: any) => {
      const active = !pipeIsActive || pipeIsActive(p);
      // In editJ keep the currently-selected pipe even if it's now retired,
      // otherwise the dropdown silently empties when the session's pipe was
      // marked finished after the fact.
      return active || (isEdit && String(p.id) === String(form.pipeId));
    })
    .slice()
    .sort(compareByBrandName)
    .map((p: any) => ({ value: String(p.id), label: entityLabel(p) }));

  // Lot picker: when the chosen tobacco has multiple usable lots, let the
  // user pick which one this session consumes from. We include jar AND
  // cellar lots — picking a cellar lot triggers a "open this lot?" confirm
  // on save (see the cellar-confirm modal below).
  const selectedTob = form.tobaccoId
    ? findById(data?.tobaccos as any[], form.tobaccoId) || null
    : null;
  const usableLots = selectedTob
    ? (selectedTob.lots || []).filter(isUsableLot)
    : [];
  const selectedLot = selectedTob && form.lotId
    ? findById(selectedTob.lots as any[], form.lotId) || null
    : null;
  const selectedIsCellar = !!(selectedLot && selectedLot.status === "cellar");
  // The session save handler (also fed to the unsaved-changes guard
  // via the refs seeded above the early returns).
  const submit = () => {
    // Commit any pending tasting-notes draft before persisting the session.
    if (selectedTob && updateTobaccoTastingNotes && tnDraft !== (selectedTob.tastingNotes || "")) {
      updateTobaccoTastingNotes(selectedTob.id, tnDraft);
    }
    // If the picked lot is still in cellar, hand off to the confirm modal —
    // the actual save happens only after the user accepts.
    if (selectedIsCellar) { setPendingCellarConfirm(true); return; }
    if (isEdit) updateSession && updateSession();
    else addSession && addSession();
    triggerIosAutosaveReauth && triggerIosAutosaveReauth();
  };
  // Write-in-render / read-only-in-the-goBack-event — safe latest-ref pattern;
  // these sit below the early returns so they can't move into an effect.
  // eslint-disable-next-line react-hooks/refs
  sessSaveRef.current = submit;
  // eslint-disable-next-line react-hooks/refs
  sessCancelRef.current = cancel;
  // Warn when the session's weight will zero (or drive negative)
  // the selected lot — applyLotWeightDelta then auto-finishes it silently.
  // On editJ the lot already has the OLD session weight deducted, so the
  // original weight is given back in the projection (restoreWeight). See
  // lotWillClose in lotUtils.ts.
  const originalSessionWeight = isEdit && form.id
    ? (() => {
        const orig = findById<any>(data?.sessions as any[], form.id);
        return orig && String(orig.lotId) === String(form.lotId)
          ? parseFloat(orig.weightG) || 0
          : 0;
      })()
    : 0;
  const willCloseLot = lotWillClose(selectedLot, parseFloat(form.weightG) || 0, originalSessionWeight);
  // Is the pre-filled weight a chamber×cut estimate? True in add
  // mode (accounting on) when the picked pipe carries chamber dimensions —
  // drives the "estimé · modifiable" hint under the weight field.
  const weightIsEstimated = (() => {
    if (view !== "addJ" || !accountingEnabled) return false;
    const p = ((data?.pipes || []) as any[]).find((x: any) => String(x.id) === String(form.pipeId));
    return !!(p && parseFloat(String(p.chamberDiameter)) > 0 && parseFloat(String(p.chamberDepth)) > 0);
  })();
  // Orphaned-session detection: editJ + lotId set, but the referenced lot
  // no longer exists on ANY tobacco (e.g. data imported from a backup that
  // doesn't carry that lot id anymore). Scan all tobaccos, not just the
  // currently-selected one.
  const lotMissing = isEdit && !!form.lotId
    && !((data?.tobaccos || []) as any[]).some((tb: any) =>
        (tb.lots || []).some((l: any) => String(l.id) === String(form.lotId)));

  // tnDraft / tnRing are now hoisted above the early returns (see top of
  // function) so the hook order stays stable across view transitions.
  // The tnDraft sync effect runs there too.

  return (
    <FormScreen
      overline={isEdit
        ? (t ? t("lbl_edit") : "Modifier")
        : (t ? t("session_form_title_new") : "Nouvelle séance")}
      title={
        // Kept inline — italic-styled span position differs
        // (FR puts the noun first as italic, EN puts adjective + italic
        // noun). A single t() with HTML would defeat the structural styling.
        <>{isEdit
          ? <>{t ? t("session_word") : "Séance"} <span style={{ fontStyle: "italic", color: C.sage }}>{form.date ? fmtDate(form.date, dateFormat) : ""}</span></>
          : <>{t ? t("session_new_a") : "Une"} <span style={{ fontStyle: "italic", color: C.sage }}>{t ? t("session_new_phrase") : "nouvelle séance"}</span></>}</>
      }
      onCancel={cancel}
      onSave={submit}
      canSave={!!(form.tobaccoId && form.pipeId && form.date
        // weightG > 0 is required only when accounting is
        // currently ON. In off-mode the value is forced to "0" by the
        // effect above and the field is hidden — gating saves on it
        // would otherwise lock the user out.
        && (!accountingEnabled || (parseFloat(form.weightG) || 0) > 0))}
      saveLabel={isEdit ? (t ? t("btn_save") : "Enregistrer") : (t ? t("btn_add") : "Ajouter")}
      accent={C.sage}
    >
      <FormSection title={t ? t("sec_selection") : "Sélection"} accent={C.sage}>
        <SelectField label={t ? t("lbl_tobacco_sel") : "Tabac"} required
          value={form.tobaccoId ? String(form.tobaccoId) : ""}
          onChange={(v) => {
            const patch: any = { tobaccoId: v, lotId: "" };
            if (v) {
              const tob = (data?.tobaccos || []).find((tb: any) => String(tb.id) === v);
              if (tob) {
                // The SHARED picker. The best usable jar, else
                // the oldest usable cellar lot (which the confirm below offers
                // to open). It used to be this block, written out here and
                // again in TastingView — an earlier fix had already had to correct the
                // same `.filter()` in both files, which is the argument for
                // extracting it. And the auto-selected lot is now guaranteed to
                // be one the picker below will LIST, so the `<select>` can no
                // longer display one lot while the state holds another.
                const picked = pickSessionLot(tob, weightUnit);
                if (picked) patch.lotId = String(picked.id);
              }
            }
            setForm(Object.assign({}, form, patch));
          }}
          options={tobOptions} />
        {selectedTob && (
          <SelectionCard
            photo={selectedTob.imageUrl ? ((imgLocal && imgLocal[selectedTob.imageUrl]) || selectedTob.imageUrl) : null}
            brand={selectedTob.brand}
            name={selectedTob.name}
            accent={C.brassHi}
            iconName="leaf"
          />
        )}
        {/* Lot picker — visible as soon as there is at least one usable lot
            so the user can always see (and change) the selection, including
            the "Cave" lots. The previous gate at length > 1 hid the picker
            entirely when a tobacco only had a single cellar lot, which made
            it feel like cellar selection was disabled. */}
        {usableLots.length >= 1 && (
          <SelectField label={t ? t("lbl_sess_lot") : "Pot utilisé"}
            value={form.lotId ? String(form.lotId) : ""}
            onChange={(v) => set({ lotId: v })}
            options={usableLots
              .slice()
              .sort(compareLotForPicker)
              .map((l: any) => ({
                value: String(l.id),
                label: lotPickerLabel(l, { t, lang, weightUnit, dateFormat }),
              }))}
          />
        )}
        {selectedIsCellar && (
          <Notice tone="info" style={{ marginTop: 4 }}>
            {t ? t("session_cellar_save_notice") : "Ce lot est encore en cave (boîte fermée). À l'enregistrement, l'application proposera de l'ouvrir (passage en pot)."}
          </Notice>
        )}
        <SelectField label={t ? t("lbl_pipe_sel") : "Pipe"}
          value={form.pipeId ? String(form.pipeId) : ""}
          onChange={(v) => set({ pipeId: v })}
          options={pipeOptions} />
        {form.pipeId && (() => {
          const sp = (data?.pipes || []).find((p: any) => String(p.id) === String(form.pipeId));
          if (!sp) return null;
          return (
            <SelectionCard
              photo={sp.imageUrl ? ((imgLocal && imgLocal[sp.imageUrl]) || sp.imageUrl) : null}
              brand={sp.brand}
              name={sp.name}
              accent={C.oxbloodHi}
              iconName="pipe"
            />
          );
        })()}
        {/* Rest advisory. Warn (never blocks) when the picked pipe
            was smoked less than 24 h before this session — the briar hasn't
            dried. Reference = this session's date+time (noon fallback), or now
            if the date is empty; the edited session excludes itself. */}
        {form.pipeId && (() => {
          const refMs = (() => { const ms = sessionStartMs({ date: form.date, time: form.time }); return isNaN(ms) ? Date.now() : ms; })();
          const hrs = pipeHoursSinceLastSession(form.pipeId, data?.sessions as any[], refMs, isEdit ? form.id : undefined);
          if (hrs === null || hrs >= PIPE_REST_MIN_HOURS) return null;
          return (
            <Notice tone="warn" icon="clock" style={{ marginTop: 6 }}>
              {t ? t("pipe_rest_warn") : "⏳ Cette pipe a été fumée il y a moins de 24 h — elle n'a pas eu le temps de reposer. L'idéal est de la laisser sécher 1 à 2 jours."}
            </Notice>
          );
        })()}
        {/* Anti-ghosting advisory. When the picked pipe is clearly
            dedicated to a ghosting-prone family and this tobacco is a
            different profile, warn softly (never blocks save). Same call in
            TastingView so both entry points behave identically. */}
        {form.pipeId && form.tobaccoId && (() => {
          const risk = computePipeGhostingRisk(
            form.pipeId, form.tobaccoId, data?.sessions as any[], data?.tobaccos as any[],
          );
          if (!risk) return null;
          const fam = xl ? xl(risk.dominant, CATS_EN) : risk.dominant;
          return (
            <Notice tone="warn" style={{ marginTop: 6 }}>
              {String(t ? t("ghost_warn_body") : "👻 Cette pipe a surtout fumé du {family} ({count}/{total} séances). Ces tabacs marquent la bruyère — y fumer un autre profil peut en garder le goût. Une pipe dédiée préserve mieux chaque tabac.")
                .replace("{family}", fam)
                .replace("{count}", String(risk.count))
                .replace("{total}", String(risk.total))}
            </Notice>
          );
        })()}
      </FormSection>

      <FormSection title={t ? t("sec_when_how_much") : "Quand & combien"} accent={C.brassHi}>
        <TextField label={t ? t("lbl_date") : "Date"}
          type="date" value={form.date || ""} onChange={(v) => set({ date: v })} />
        <TextField label={t ? t("lbl_time") : "Heure de début"}
          type="time" value={form.time || ""} onChange={(v) => set({ time: v })} />
        <TextField label={t ? t("lbl_duration_min") : "Durée (min)"}
          type="number" min="0" step="1"
          value={form.duration || ""} onChange={(v) => set({ duration: v })} mono />
        {/* In accounting-off mode the weight field disappears
            entirely. The effect above keeps form.weightG === "0" so
            _persistSession's "if (w > 0)" guards all short-circuit and
            nothing else needs to know about the mode. A small inline
            notice replaces the field so the user understands why it's
            gone. */}
        {!accountingEnabled ? (
          <Notice tone="info">
            {t ? t("accounting_off_notice") : "Comptabilité désactivée — cette séance est enregistrée sans grammage (pas de déduction de lot, pas de passage automatique en Terminé, exclue des graphes de poids)."}
          </Notice>
        ) : lotMissing ? (
          <div>
            <div style={{ marginBottom: 6 }}>
              <span style={{
                fontFamily: F.mono, fontSize: fs(12.5), letterSpacing: 1.6,
                textTransform: "uppercase", color: C.tx2, fontWeight: 600,
              }}>{`${t ? t("lbl_weight_simple") : "Poids"} (${weightUnit})`}</span>
            </div>
            <div style={{
              width: "100%", padding: "11px 14px",
              background: C.bg2, color: C.tx3,
              border: `1px solid ${alpha(C.amber, "55")}`, borderRadius: 8,
              fontFamily: F.mono, fontSize: fs(15),
            }}>{form.weightG || "0"}</div>
            <Notice tone="warn" style={{ marginTop: 6 }}>
              {t ? t("lot_missing_weight_notice") : "Le lot référencé par cette séance a été supprimé. Le poids est verrouillé pour préserver la cohérence des statistiques."}
            </Notice>
          </div>
        ) : (
          <div>
            <TextField label={`${t ? t("lbl_weight_simple") : "Poids"} (${weightUnit})`}
              type="number" min="0" step="0.1"
              value={form.weightG || ""}
              /* Strip a comma decimal (parity with TastingView /
                 SettingsModal). A "1,5" reaching safeW would parseFloat to 1,
                 silently dropping .5. */
              onChange={(v) => set({ weightG: String(v).replace(",", ".") })} mono />
            {weightIsEstimated && (
              <div style={{ marginTop: 5, fontSize: fs(13), color: C.tx3, fontFamily: F.body, lineHeight: 1.4 }}>
                {t ? t("weight_estimated_hint") : "Estimé d'après le foyer de la pipe et la coupe du tabac · modifiable."}
              </div>
            )}
            {/* In EDIT mode, a button to (re)apply the default weight
                — the chamber×cut estimate when the pipe has chamber dims, else
                the global Settings default. Lets the user refresh the weight of
                an OLD session. Add mode already auto-applies it. */}
            {isEdit && accountingEnabled && (() => {
              const pipe = ((data?.pipes || []) as any[]).find((p: any) => String(p.id) === String(form.pipeId));
              const tob = ((data?.tobaccos || []) as any[]).find((tb: any) => String(tb.id) === String(form.tobaccoId));
              const def = estimateSessionWeight(pipe, tob, sessDefaultWeight, weightUnit);
              // Hide the button when the recorded weight already equals the
              // default — nothing to apply.
              const cur = parseFloat(String(form.weightG));
              if (Number.isFinite(cur) && cur === parseFloat(def)) return null;
              return (
                <button type="button" onClick={() => set({ weightG: def })}
                  style={{
                    marginTop: 8, minHeight: 36, padding: "7px 12px",
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "transparent", border: `1px solid ${alpha(C.brass, "66")}`,
                    borderRadius: 8, color: C.brassHi, cursor: "pointer",
                    fontFamily: F.body, fontSize: fs(14.5), fontWeight: 600,
                  }}>
                  ↻ {(t ? t("btn_apply_default_weight") : "Appliquer le poids par défaut") + ` (${def} ${weightUnit})`}
                </button>
              );
            })()}
          </div>
        )}
        {/* Heads-up when the session weight will close out
            the selected lot. Pure info — doesn't block save. Naturally
            inert in accounting-off mode because weightG is forced to 0
            (the willCloseLot computation can't return true at w=0
            against a non-zero balance). */}
        {willCloseLot && (
          <Notice tone="info" icon="check" style={{ marginTop: 8 }}>
            {t ? t("tasting_will_close_lot") : "Après cette séance le lot atteint 0 — il sera automatiquement marqué comme Terminé."}
          </Notice>
        )}
      </FormSection>

      <FormSection title={t ? t("sec_rating") : "Évaluation"} accent={C.amber}>
        <StarsField label={t ? t("lbl_rating_lbl") : "Note"}
          value={form.rating || 0} onChange={(v) => set({ rating: v })} />
      </FormSection>

      {/* Aroma wheel — structured taste tags feeding the profile. */}
      <FormSection title={t ? t("aroma_section") : "Arômes"} accent={C.brass}>
        <div style={{ fontSize: fs(13.5), color: C.tx3, marginBottom: 12, lineHeight: 1.45 }}>
          {t ? t("aroma_picker_hint") : "Touchez les arômes perçus — ils dessinent votre profil au fil des séances."}
        </div>
        <AromaPicker value={form.aromas || []} onChange={(next) => set({ aromas: next })} />
      </FormSection>

      {/* Optional session location. Captured only on an
          explicit tap (the browser shows its own permission prompt).
          Shown as a coordinate chip + remove button once set; rendered
          as an embedded OpenStreetMap map in the session detail view. */}
      <FormSection title={t ? t("sec_location") : "Lieu"} accent={C.oxbloodHi}>
        {/* Coordinates are directly editable so a session logged
            after the fact can carry (or correct) a location without GPS. The
            button below fills these two fields from the device on one tap. */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}>
          <TextField
            label={t ? t("lbl_latitude") : "Latitude"}
            type="number"
            value={latText}
            onChange={onLatText}
            placeholder="48.8566"
          />
          <TextField
            label={t ? t("lbl_longitude") : "Longitude"}
            type="number"
            value={lngText}
            onChange={onLngText}
            placeholder="2.3522"
          />
        </div>
        <PressCard
          onClick={geoStatus === "loading" ? undefined : captureLocation}
          // An in-flight capture is BUSY, not disabled — announce
          // the wait instead of silently going inert (see the PressCard
          // ariaDisabled note: that is for a control that is unavailable).
          ariaBusy={geoStatus === "loading"}
          style={{
            marginTop: 8,
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
        {geoStatus === "error" && geoErr && (
          <Notice tone="warn" style={{ marginTop: 8 }}>{geoErr}</Notice>
        )}
        {hasGeo && (
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
            <PressCard
              onClick={geoNameBusy ? undefined : refreshLocationName}
              ariaBusy={geoNameBusy}
              style={{
                padding: "10px 14px", borderRadius: 8,
                background: "transparent",
                border: `1px solid ${alpha(C.sage, "55")}`, color: C.sage,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                fontFamily: F.body, fontSize: fs(14.5), fontWeight: 600,
                opacity: geoNameBusy ? 0.6 : 1,
                cursor: geoNameBusy ? "wait" : "pointer",
              }}>
              <span style={{ fontSize: fs(16) }}>🔄</span>
              {geoNameBusy
                ? (t ? t("geo_name_locating") : "Recherche du nom…")
                : (t ? t("btn_refresh_address") : "Mettre à jour l'adresse")}
            </PressCard>
            <TextField
              label={t ? t("lbl_location_name") : "Lieu"}
              value={form.locationName || ""}
              onChange={(v: string) => set({ locationName: v })}
              placeholder={geoNameBusy
                ? (t ? t("geo_name_locating") : "Recherche du nom…")
                : (t ? t("geo_name_ph") : "Café de Flore")}
            />
            <TextField
              label={t ? t("lbl_location_city") : "Commune"}
              value={form.locationCity || ""}
              onChange={(v: string) => set({ locationCity: v })}
              placeholder="Paris"
            />
            <TextField
              label={t ? t("lbl_location_country") : "Pays"}
              value={form.locationCountry || ""}
              onChange={(v: string) => set({ locationCountry: v })}
              placeholder="France"
            />
            <PressCard onClick={clearLocation} style={{
              padding: "9px 12px", borderRadius: 8,
              background: C.bg3, border: `1px solid ${C.rule}`,
              color: C.tx2, fontFamily: F.mono, fontSize: fs(12.5),
              letterSpacing: 1, textTransform: "uppercase", fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {t ? t("btn_remove") : "Retirer"}
            </PressCard>
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: fs(13.5), color: C.tx3, lineHeight: 1.45 }}>
          {t ? t("geo_hint") : "La position est enregistrée sur cette séance et part dans vos exports / sauvegardes. La carte s'affiche dans le détail de la séance."}
        </div>
      </FormSection>

      {selectedTob && updateTobaccoTastingNotes && (
        <FormSection title={t ? t("lbl_tasting") : "Notes du tabac"} accent={C.brass}>
          <div style={{ fontSize: fs(13.5), color: C.tx3, marginBottom: 6 }}>
            {t ? t("tasting_notes_section_hint") : "Enregistré sur la fiche du tabac, pas sur la séance. Sauvegardé en quittant le champ."}
          </div>
          <textarea
            value={tnDraft}
            aria-label={t ? t("lbl_tasting") : "Notes du tabac"}
            onChange={(e) => setTnDraft(e.target.value)}
            onFocus={tnRing.onFocus}
            onBlur={() => {
              tnRing.onBlur();
              if (tnDraft !== (selectedTob.tastingNotes || "")) {
                updateTobaccoTastingNotes(selectedTob.id, tnDraft);
              }
            }}
            placeholder={t ? t("tasting_notes_placeholder") : "Caractère, saveur, complexité…"}
            style={{
              width: "100%", minHeight: 80, padding: "10px 14px",
              background: C.bg2, color: C.ivory,
              border: `1px solid ${C.rule}`, borderRadius: 8,
              fontFamily: F.display, fontStyle: "italic", fontSize: fsInput(16),
              lineHeight: 1.5, resize: "vertical", outline: "none",
              transition: "box-shadow 200ms, border-color 200ms",
              ...(tnRing.style || {}),
              boxSizing: "border-box",
            }}
          />
        </FormSection>
      )}

      <FormSection title={t ? t("sec_session_notes_lbl") : "Notes de séance"} accent={C.sage}>
        <TextAreaField italic minHeight={120}
          placeholder={t ? t("session_notes_placeholder") : "Vos impressions, le caractère, l'évolution…"}
          value={form.notes || ""} onChange={(v) => set({ notes: v })} />
      </FormSection>

      {/* Cellar → jar confirm modal. Fires when the user saves a session
          whose picked lot is still sealed (cellar). Confirming opens the
          lot first (changeLotStatus → "jar", which auto-fills dateOpened),
          then runs the normal save path so weight deduction lands on the
          correctly-statused lot. */}
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
          {t ? t("session_open_lot_body") : "Le lot sélectionné est encore en cave (boîte fermée). Pour enregistrer cette séance avec ce lot, il faut l'ouvrir (passage en pot). La date d'ouverture sera fixée à aujourd'hui."}
        </div>
        <div style={{ padding: "0 12px 16px", display: "flex", gap: 10 }}>
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
            // Open the lot first (cellar → jar; the store auto-fills
            // dateOpened). The actual session save is queued via
            // pendingPostOpenSave and fires from the effect above once
            // React has re-rendered with the lot's new status — the
            // stale-closure issue is why we cannot just call
            // addSession()/updateSession() inline here.
            if (selectedTob && selectedLot && selectedLot.id != null && changeLotStatus) {
              // Locate the lot by its stable id (changeLotStatus now
              // matches by id, not positional index).
              changeLotStatus(selectedTob.id, selectedLot.id, "jar");
              setPendingPostOpenSave({
                lotId: String(selectedLot.id),
                mode: isEdit ? "edit" : "add",
              });
            }
          }} style={{
            flex: 1, padding: "11px 12px",
            background: alpha(C.brass, "33"), border: `1px solid ${alpha(C.brass, "88")}`,
            borderRadius: 8, textAlign: "center",
            color: C.brassHi, fontFamily: F.mono, fontSize: fs(13.5),
            letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {t ? t("btn_open_and_save") : "Ouvrir & enregistrer"}
          </PressCard>
        </div>
      </Modal>
    </FormScreen>
  );
}

// SelectionCard — small read-only card displayed under the tabac / pipe
// selectors in the session form. Mirrors the TastingView setup cards so
// the user can confirm the picked photo at a glance.
function SelectionCard({
  photo, brand, name, accent, iconName,
}: {
  photo: string | null;
  brand?: string;
  name?: string;
  accent: string;
  iconName: "leaf" | "pipe";
}) {
  return (
    <div style={{
      marginTop: 4, padding: "10px 12px",
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
          color: accent,
        }}>
          <Ico name={iconName} size={20} sw={1.4} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {brand && <Lbl color={accent}>{brand}</Lbl>}
        {name && (
          <div style={{
            fontFamily: F.display, fontSize: fs(20), color: C.ivory,
            marginTop: 2, fontStyle: "italic",
          }}>{name}</div>
        )}
      </div>
    </div>
  );
}
