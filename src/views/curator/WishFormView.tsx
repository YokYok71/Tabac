// Curator WishFormView — Add / Edit a wishlist entry.
// Wishlist add/edit form. Gated by ctx.showWishForm || ctx.editWishId.

import { useEffect, useMemo, useState } from "react";
import { useUnsavedFormGuard } from "../../hooks/useUnsavedFormGuard.ts";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { CAT_FAMILIES, CATS_EN, CUT_FAMILIES, CUTS_EN } from "../../constants.ts";
import { restoreScrollY } from "../../utils.ts";
import {
  FormScreen, FormSection,
  TextField, TextAreaField, SelectField, StarsField, SegmentedField, PhotoField,
  CheckboxField,
} from "../../components/curator/FormFields.tsx";
import { AICard } from "../../components/curator/AICard.tsx";
import { CatalogOffer } from "../../components/curator/CatalogOffer.tsx";
import { CatalogueMissing } from "../../components/curator/CatalogueMissing.tsx";
import { Notice } from "../../components/curator/Notice.tsx";
import { PressCard } from "../../components/curator/primitives.tsx";
import { DbSyncDiff } from "../../components/curator/DbSyncDiff.tsx";
import { findDuplicateEntry } from "../../hooks/useImportConfirm.ts";
import { useDbSync, catalogueCanFill } from "../../hooks/useDbSync.ts";
import { loadTobaccoDb, tobaccoDbLookupSync } from "../../utils/tobaccoDb.ts";
import { imgMap } from "../../utils/imgCache.ts";

export function CuratorWishFormView() {
  const ctx = useAppCtx();
  const {
    showWishForm, editWishId, wishForm: form, setWishForm: setForm,
    t, lang, xl, BW, addWish, updateWish, setShowWishForm, setEditWishId,
    handlePhotoUpload, imgLocal, setImgLocal,
    apiKey, aiLoad, aiErr, aiAutoFill, aiScanLabel, aiProvider, aiSource,
    aiCompare, aiCompareCheck, applyAiCompare, dismissAiCompare,
    autofillSource, data, scrollSaveRef,
    triggerIosAutosaveReauth,
  } = ctx;
  // Sage hint trigger (see same logic in TobaccoFormView).
  // Await the active language's description chunk too so
  // useDbSync's synchronous lookup finds the prose; reset on lang switch.
  // Gate on the wish form being open (it used to fire on mount,
  // loading the catalog chunk on the home screen — this overlay view is
  // always mounted). loadTobaccoDb caches in module memory.
  const wishFormOpen = !!(showWishForm || editWishId);
  const [dbReady, setDbReady] = useState(false);
  // No catalogue loaded must SAY so — the form used to
  // look identical to 'this blend is not catalogued'. Same reason as
  // TobaccoFormView, and the same one-load shape.
  const [dbMissing, setDbMissing] = useState(false);
  useEffect(() => {
    if (!wishFormOpen) return;
    let mounted = true;
    setDbReady(false);
    loadTobaccoDb().then((d) => {
      if (!mounted) return;
      setDbMissing(!d);
      setDbReady(true);
    });
    return () => { mounted = false; };
  }, [wishFormOpen, lang]);
  // Scroll to the top of the form when it opens. The wish
  // form is an overlay (not a `nav()` view change), so the window scroll
  // carries over from the underlying wishlist. Opening from a scrolled
  // position landed the user mid-form. This effect fires once per open
  // (deps gate on `showWishForm || !!editWishId`).
  //
  // CRITICAL — CLAUDE.md "Hook-order trap" rule: EVERY hook in this
  // component must run BEFORE any early return (the WishFormView is
  // mounted unconditionally in CuratorApp.tsx, so the render count
  // varies between closed and open states). The dupInfo
  // useMemo used to live AFTER the early returns — adding the new useEffect
  // above tipped the hook-count delta past React's tolerance and the
  // user hit "Minified React error #310 (Rendered more hooks than
  // during the previous render)" on transitioning from closed to open.
  // Both hooks now sit above the returns; dupInfo internally guards
  // on `!form` so its body can run safely even when the form is closed.
  // Reuse `wishFormOpen` (was a byte-identical duplicate `formOpen`).
  useEffect(() => {
    if (!wishFormOpen) return;
    window.scrollTo(0, 0);
  }, [wishFormOpen]);

  // Duplicate detection on wishlist — same logic as the
  // tabac form, applied to (a) the wishlist itself ("already on your
  // wishlist") and (b) the live tabac inventory ("you already own this,
  // no need to wish"). Both checks key off the shared `dupKey` from
  // useImportConfirm. Skipped while brand or name is empty, skipped
  // for the entry being edited (editWishId match), skipped for trashed
  // rows. Warning only — never blocks save.
  const dupInfo = useMemo(() => {
    if (!form) return null;
    // Shared collision lookup (literal + DB canonical key).
    // Wishlist first (identical wish), then owned tobaccos ("you already
    // own this"). Skips the wish being edited (editWishId).
    const wHit = findDuplicateEntry(data && data.wishlist, form.brand, form.name, { excludeId: editWishId });
    if (wHit) return { kind: "wish", entry: wHit };
    const tHit = findDuplicateEntry(data && data.tobaccos, form.brand, form.name);
    if (tHit) return { kind: "tobacco", entry: tHit };
    return null;
    // dbReady IS a dep — `tobaccoDbCanonicalKey` reads a module-level
    // cache that flips after the load resolves. False positive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, editWishId, data, dbReady]);
  // ONE banner per mode, decided by the user:
  //   new entry  → "this blend is in the catalogue", the one-tap fill
  //   editing it → the LIST of what will change (useDbSync's diff, below)
  // Before this the simple offer showed in BOTH modes, so editing a catalogued
  // tobacco could show a "fill the fiche" banner over a fiche that was already
  // filled — and on divergence it competed with the diff banner, which says the
  // same thing but usefully (which fields, both values, side by side).
  // `catalogueCanFill` stays as the second condition: it suppresses the offer
  // when the form arrived pre-filled from the catalogue QuickAdd, where there is
  // genuinely nothing to fill.
  const dbHinted = useMemo(() => {
    if (!form || !dbReady) return false;
    if (editWishId) return false;        // édition → le bandeau détaillé prend le relais
    // See the identical note in TobaccoFormView — the setting only
    // describes the tap when there IS a key to call, so gating on it alone hid
    // the offer on every fresh install, where the tap fills from the catalogue.
    if (autofillSource === "ai" && apiKey) return false;
    const brand = String(form.brand || "").trim();
    const name = String(form.name || "").trim();
    if (!brand || !name) return false;
    // See the identical note in TobaccoFormView — a two-language clamp
    // that predates es/de/it, so the catalogue description behind this offer was
    // French for four of the six languages. `pickLang` owns the fallback ladder.
    const hit = tobaccoDbLookupSync(brand, name, lang);
    return !!hit && catalogueCanFill(form, hit);
  }, [form, dbReady, editWishId, autofillSource, apiKey, lang]);

  // Refactored into the shared `useDbSync` hook:
  // "Sync with DB" — when editing an EXISTING wish whose brand+name
  // match a catalog entry AND some factual field diverges, surface
  // an info Notice with a one-tap overwrite. Add mode never surfaces
  // (the catalog QuickAdd modal already pre-fills). Description /
  // personal notes are excluded — only factual blend attributes.
  const dbSyncRes = useDbSync({
    enabled: !!editWishId,
    entryId: editWishId,
    form,
    dbReady,
    lang,
    setForm,
  });
  const dbSync = dbSyncRes.dbSync;
  const dbSyncApplied = dbSyncRes.applied;
  const applyDbSync = dbSyncRes.applyDbSync;
  const dismissDbSync = dbSyncRes.dismissDbSync;

  const isEdit = !!editWishId;
  // Cancel just closes the overlay — it must NOT call
  // nav("inv") because nav() resets statusFilter to "active" (App.tsx
  // line ~1035), which would yank the user from the wishlist over to
  // the tobacco inventory. The wish form is an overlay on top of
  // InventoryListView (statusFilter="wish"); closing the overlay
  // reveals the underlying view with its statusFilter intact. Scroll
  // restore is plugged in inline (the central restore useEffect only
  // fires on view changes — not on overlay close).
  const cancel = () => {
    setForm && setForm(Object.assign({}, BW));
    setShowWishForm && setShowWishForm(false);
    setEditWishId && setEditWishId(null);
    if (scrollSaveRef) {
      const sy = scrollSaveRef.current["wish"] || 0;
      if (sy > 0) {
        scrollSaveRef.current["wish"] = 0;
        restoreScrollY(sy);
      }
    }
  };
  const save = () => {
    // Audit: updateWish/addWish both no-op on an empty name, but
    // pre-341 save() still closed the overlay + cleared editWishId — so tapping
    // "Enregistrer" on the back-guard with a cleared Nom silently DISCARDED the
    // edit and dismissed the form. Bail before closing when the write can't run.
    if (!form || !form.name) return;
    if (isEdit) updateWish && updateWish();
    else addWish && addWish();
    // Close the form overlay so the user lands back on the wishlist.
    // updateWish() handles its own scroll restore via scrollSaveRef;
    // addWish doesn't need one (creating a new wish doesn't preserve
    // a position).
    setShowWishForm && setShowWishForm(false);
    setEditWishId && setEditWishId(null);
    // See TobaccoFormView for the iOS auto-save piggyback.
    triggerIosAutosaveReauth && triggerIosAutosaveReauth();
  };
  // Warn on system-back / swipe-back out of a MODIFIED edit-wish.
  useUnsavedFormGuard((!!showWishForm || !!editWishId) && !!form, form, save, cancel);

  if (!showWishForm && !editWishId) return null;
  if (!form) return null;

  const set = (patch: any) => setForm(Object.assign({}, form, patch));

  return (
    <FormScreen
      overline={isEdit ? (t ? t("lbl_edit") : "Modifier") : (t ? t("wish_form_overline_new") : "Nouvelle envie")}
      title={
        <>{isEdit
          ? <>{form.brand || (t ? t("lbl_wish") : "Envie")} <span style={{ fontStyle: "italic", color: C.oxbloodHi }}>{form.name || ""}</span></>
          : <>{t ? t("wish_new_a") : "Une"} <span style={{ fontStyle: "italic", color: C.oxbloodHi }}>{t ? t("wish_new_phrase") : "nouvelle envie"}</span></>}</>
      }
      onCancel={cancel}
      onSave={save}
      canSave={!!form.name}
      saveLabel={isEdit ? (t ? t("btn_save") : "Enregistrer") : (t ? t("btn_add") : "Ajouter")}
      accent={C.oxbloodHi}
    >
      <AICard
        xl={xl}
        kind="wish"
        apiKey={apiKey}
        aiLoad={!!aiLoad}
        aiErr={aiErr || ""}
        aiAutoFill={aiAutoFill}
        t={t}
        aiProvider={aiProvider}
        aiSource={aiSource}
        aiCompare={aiCompare}
        aiCompareCheck={aiCompareCheck}
        applyAiCompare={applyAiCompare}
        dismissAiCompare={dismissAiCompare}
        onScanFile={aiScanLabel ? (f: File) => aiScanLabel("wish", f) : undefined}
      />

      {/* "Sync with DB" — only when editing AND the
          catalog has divergent values for this wish. Same UX as the
          tabac form. */}
      {dbSync ? (
        <div style={{ margin: "0 12px 14px" }}>
          <Notice tone="info">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {t ? t("db_sync_title") : "Mise à jour disponible depuis le catalogue"}
            </div>
            <div style={{ fontSize: fs(13.5), color: C.tx2, marginBottom: 8 }}>
              {t
                ? String(t("db_sync_intro")).replace("{n}", String(dbSync.diffs.length))
                : `${dbSync.diffs.length} champ(s) diffèrent de la fiche de référence. Seules tes notes personnelles (notes de dégustation) restent intactes.`}
            </div>
            <DbSyncDiff diffs={dbSync.diffs} t={t} xl={xl} />
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <PressCard
                onClick={applyDbSync}
                style={{
                  padding: "7px 12px", borderRadius: 8,
                  background: `linear-gradient(135deg, ${C.brassHi}, ${C.brass})`,
                  color: C.bg, border: "none",
                  fontFamily: F.body, fontSize: fs(14.5), fontWeight: 700,
                }}>
                {t ? t("db_sync_apply") : "Synchroniser"}
              </PressCard>
              <PressCard
                onClick={dismissDbSync}
                style={{
                  padding: "7px 12px", borderRadius: 8,
                  background: "transparent",
                  border: `1px solid ${alpha(C.sage, "55")}`, color: C.sageHi,
                  fontFamily: F.body, fontSize: fs(14.5), fontWeight: 600,
                }}>
                {t ? t("db_sync_dismiss") : "Garder mes valeurs"}
              </PressCard>
            </div>
          </Notice>
        </div>
      ) : dbSyncApplied ? (
        // Ghost-click defence: inert success state + tap-catcher — see TobaccoFormView.
        <div style={{ margin: "0 12px 14px" }}>
          <Notice tone="success">
            <div style={{ fontWeight: 600 }}>{t ? t("db_sync_done") : "Synchronisé ✓"}</div>
          </Notice>
          <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 9998, background: "transparent" }} />
        </div>
      ) : null}

      {/* Duplicate-detection banner. Two flavours:
            - "wish" : already on the wishlist (raw dup).
            - "tobacco" : already in the active inventory — no need to
              wish for it; suggest opening the tabac's fiche directly.
          Warning only — save isn't blocked. */}
      {dupInfo && (
        <div style={{ margin: "0 12px 14px" }}>
          <Notice tone="warn">
            {/* Kept inline — JSX with embedded italic span +
              interpolation of brand/name. */}
            {dupInfo.kind === "tobacco"
              ? <>{t ? t("wishdup_own_pre") : "Ce tabac fait déjà partie de votre inventaire"}
                  {" "}(<span style={{ fontStyle: "italic" }}>{[dupInfo.entry.brand, dupInfo.entry.name].filter(Boolean).join(" — ")}</span>).
                  {" "}{t ? t("wishdup_own_post") : "Inutile de l'ajouter aux envies — ouvrez sa fiche pour enregistrer un nouveau lot."}</>
              : <>{t ? t("wishdup_wish_pre") : "Une envie identique figure déjà sur votre liste"}
                  {" "}(<span style={{ fontStyle: "italic" }}>{[dupInfo.entry.brand, dupInfo.entry.name].filter(Boolean).join(" — ")}</span>).</>}
          </Notice>
        </div>
      )}

      <FormSection title={t ? t("sec_identity") : "Identité"} accent={C.oxbloodHi}>
        <TextField label={t ? t("lbl_brand_lbl") : "Marque"}
          value={form.brand || ""} onChange={(v) => set({ brand: v })}
          placeholder="Peterson" />
        <TextField label={t ? t("lbl_name_req") : "Nom"} required
          value={form.name || ""} onChange={(v) => set({ name: v })}
          placeholder="Nightcap" />
        {/* Brand FIRST, then name — matching the pipe and
            accessory forms. The offer follows the SECOND identity field,
            because the catalogue match needs both. See CatalogOffer.tsx. */}
        {dbMissing && <CatalogueMissing compact />}
        <CatalogOffer show={dbHinted} busy={!!aiLoad} error={aiErr || ""}
          onApply={() => aiAutoFill("wish")} t={t} />
        <SelectField label={t ? t("lbl_type") : "Type"}
          value={form.category || ""} onChange={(v) => set({ category: v })}
          groups={CAT_FAMILIES.map(f => ({
            label: t ? t(f.labelKey) : f.labelKey,
            options: f.values.map(c => ({ value: c, label: xl ? xl(c, CATS_EN) : c })),
          }))} />
        <SelectField label={t ? t("lbl_cut") : "Coupe"}
          value={form.cut || ""} onChange={(v) => set({ cut: v })}
          groups={CUT_FAMILIES.map(f => ({
            label: t ? t(f.labelKey) : f.labelKey,
            options: f.values.map(c => ({ value: c, label: xl ? xl(c, CUTS_EN) : c })),
          }))} />
        <TextField label={t ? t("lbl_blend") : "Composition"}
          value={form.blend || ""} onChange={(v) => set({ blend: v })}
          placeholder="Latakia, Virginia, Orientals…" />
      </FormSection>

      <FormSection title={t ? t("sec_flavour") : "Profil gustatif"} accent={C.amber}>
        <StarsField label={t ? t("lbl_force") : "Force"}
          value={form.force || 0} onChange={(v) => set({ force: v })} />
        <StarsField label={t ? t("lbl_taste") : "Goût"}
          value={form.taste || 0} onChange={(v) => set({ taste: v })} />
        <StarsField label={t ? t("lbl_room_note") : "Room Note"}
          value={form.roomNote || 0} onChange={(v) => set({ roomNote: v })} />
      </FormSection>

      <FormSection title={t ? t("sec_wishlist") : "Wishlist"} accent={C.brassHi}>
        <SegmentedField<string>
          label={t ? t("lbl_priority") : "Priorité"}
          value={form.priority || "medium"}
          onChange={(v) => set({ priority: v })}
          options={[
            { value: "low",    label: t ? t("prio_low")    : "Basse",   color: C.sage },
            { value: "medium", label: t ? t("prio_medium") : "Moyenne", color: C.amber },
            { value: "high",   label: t ? t("prio_high")   : "Haute",   color: C.oxbloodHi },
          ]}
        />
        <TextField label={t ? t("lbl_aging_max") : "Âge max cave (ans)"}
          value={form.agingMax || ""} onChange={(v) => set({ agingMax: v })}
          placeholder={t ? t("aging_max_placeholder") : "ex: 5 ou 3-5"} mono />
      </FormSection>

      <FormSection title={t ? t("sec_notes") : "Notes"} accent={C.sage}>
        <TextAreaField label={t ? t("lbl_tasting") : "Notes du tabac"}
          value={form.tastingNotes || ""} onChange={(v) => set({ tastingNotes: v })}
          italic />
        <TextAreaField label={t ? t("lbl_desc") : "Description"}
          value={form.description || ""} onChange={(v) => set({ description: v })} />
        <TextAreaField label={t ? t("lbl_personal_note") : "Note personnelle"}
          value={form.notes || ""} onChange={(v) => set({ notes: v })} />
      </FormSection>

      <FormSection title={t ? t("sec_image") : "Image"} accent={C.oxbloodHi}>
        <PhotoField
          value={form.imageUrl || ""}
          preview={form.imageUrl ? (imgLocal?.[form.imageUrl] || form.imageUrl) : undefined}
          onPickFile={() => handlePhotoUpload && handlePhotoUpload((key: string, du: string) => {
            set({ imageUrl: key });
            setImgLocal && setImgLocal((p: any) => imgMap(p, { [key]: du }));
          })}
          onClear={() => set({ imageUrl: "" })}
        />
      </FormSection>

      <FormSection title={t ? t("sec_catalogue_lock") : "Catalogue"} accent={C.steelHi}>
        <CheckboxField
          label={t ? t("lbl_catalogue_lock") : "Ne jamais écraser depuis le catalogue"}
          hint={t ? t("catalogue_lock_hint") : "La mise à jour groupée ignorera cette fiche. La synchronisation manuelle depuis la fiche reste possible."}
          checked={!!form.catalogueLock}
          onChange={(v: boolean) => set({ catalogueLock: v })}
          accent={C.steelHi}
        />
      </FormSection>
    </FormScreen>
  );
}
