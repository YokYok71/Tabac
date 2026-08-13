// Curator TobaccoFormView — Add / Edit a tobacco reference.
// Mirrors the BT template fields.

import { useEffect, useMemo, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { CAT_FAMILIES, CATS_EN, CUT_FAMILIES, CUTS_EN } from "../../constants.ts";
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
import { useUnsavedFormGuard } from "../../hooks/useUnsavedFormGuard.ts";
import { loadTobaccoDb, tobaccoDbLookupSync } from "../../utils/tobaccoDb.ts";
import { sanitizeTags, allTags } from "../../utils/tags.ts";
import { TagEditor } from "../../components/curator/TagEditor.tsx";

export function CuratorTobaccoFormView() {
  const ctx = useAppCtx();
  const {
    view, form, setForm, t, lang, xl, nav, BT, data,
    addTobacco, updateTobacco,
    handlePhotoUpload, imgLocal, setImgLocal,
    apiKey, aiLoad, aiErr, aiAutoFill, aiScanLabel, aiProvider, aiSource,
    aiCompare, aiCompareCheck, applyAiCompare, dismissAiCompare,
    autofillSource,
    triggerIosAutosaveReauth,
  } = ctx;
  // Trigger a re-render when the tobacco DB finishes
  // loading so the dbHinted memo below picks it up.
  // The base catalog carries specs only — the description
  // prose now lives in per-language chunks. Await the active language's
  // descriptions too so `useDbSync` (which reads them synchronously) has
  // the prose in memory; reset dbReady on a language switch so the memo
  // recomputes against the freshly-loaded chunk.
  // Gate the load on the form actually being open (it used to fire
  // on mount, so the catalog chunk loaded on the home screen — this view is
  // always mounted). Now nothing catalog-related is fetched until the user
  // opens the add/edit form. loadTobaccoDb caches in module memory, so a
  // return visit is instant.
  // ONE load — a user catalogue carries every language inline,
  // so `dbReady` means "the whole catalogue is usable" and the sync offer can
  // never be computed from a half-loaded one.
  const [dbReady, setDbReady] = useState(false);
  // A form that marks itself ready whether a catalogue
  // is present or not looks IDENTICAL to 'this blend is not catalogued'. It
  // used to mean the download had failed; it now means the user has not
  // loaded a catalogue at all, which is the state of every fresh install.
  const [dbMissing, setDbMissing] = useState(false);
  useEffect(() => {
    if (view !== "addT" && view !== "editT") return;
    let mounted = true;
    setDbReady(false);
    loadTobaccoDb().then((d) => {
      if (!mounted) return;
      setDbMissing(!d);
      setDbReady(true);
    });
    return () => { mounted = false; };
  }, [view, lang]);
  // Hook-order trap fix (sibling of the WishFormView
  // fix). The `dup` useMemo was originally added BELOW the early
  // returns, which on transitioning from `view === "home"` (1 hook)
  // to `view === "addT"` (2 hooks) violates the React rule "same
  // number of Hooks on every render". The component is mounted
  // unconditionally in CuratorApp.tsx so the hook count must stay
  // stable across renders. Both hooks now sit above the returns;
  // the useMemo body internally guards on `!form`.
  const dup = useMemo(() => {
    if (!form) return null;
    // Dup-collision via literal key OR the DB
    // canonical key (so "Vondel 131" ≡ "Vondel Red Label"). Shared helper
    // — see findDuplicateEntry. Skips the entity being edited (form.id).
    return findDuplicateEntry(data && data.tobaccos, form.brand, form.name, { excludeId: form.id });
    // dbReady IS a dep: tobaccoDbCanonicalKey reads a module-level
    // cache that flips after the load resolves. Eslint can't see across
    // the module boundary, so the warning is a false positive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, data, dbReady]);
  // Also flag if the same brand+name sits in the wishlist
  // — the user is creating something they've been chasing. Signal +
  // suggest they remove the wish (still non-blocking; user decides).
  const wishDup = useMemo(() => {
    if (!form) return null;
    if (view !== "addT") return null; // editing → no point
    return findDuplicateEntry(data && data.wishlist, form.brand, form.name);
    // dbReady IS a dep — see note on the previous memo. False positive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, data, view, dbReady]);
  // The sage "this blend is in your catalogue" hint, shown when:
  //   1. the user is typing into a FRESH form (brand + name both filled), AND
  //   2. that brand+name matches an entry in the loaded catalogue, AND
  //   3. the tap would actually REACH the catalogue — i.e. the preferred source
  //      is "local", OR it is "ai" with no API key configured, where the
  //      AI-first branch falls straight through to the catalogue anyway.
  //
  // ONE banner per mode, decided by the user:
  //   new entry  → "this blend is in the catalogue", the one-tap fill
  //   editing it → the LIST of what will change (useDbSync's diff, below)
  // The simple offer used to show in BOTH modes, so editing a catalogued
  // tobacco could show a "fill the fiche" banner over a fiche that was already
  // filled — and on divergence it competed with the diff banner, which says the
  // same thing but usefully (which fields, both values, side by side).
  // `catalogueCanFill` stays as the second condition: it suppresses the offer
  // when the form arrived pre-filled from the catalogue QuickAdd, where there is
  // genuinely nothing to fill.
  const dbHinted = useMemo(() => {
    if (!form || !dbReady) return false;
    if (view !== "addT") return false;   // édition → le bandeau détaillé prend le relais
    // THE GATE KEYS ON WHAT THE TAP WILL ACTUALLY DO, not on the setting.
    // Under "ai" the tap goes to the provider first, so promising an instant
    // catalogue fill would mislead — but `autofillSource` only describes that
    // when there IS a key to call: `runAutoFill`'s AI-first branch goes
    // STRAIGHT to `tobaccoDbLookup` when `!apiKey`. Reading the setting alone
    // hid the offer from the one user who has no other way to fill a fiche:
    // someone who picked "Agent IA" and never configured a key, or cleared it.
    if (autofillSource === "ai" && apiKey) return false;
    const brand = String(form.brand || "").trim();
    const name = String(form.name || "").trim();
    if (!brand || !name) return false;
    // Pass `lang` STRAIGHT THROUGH — never clamp it to fr/en. Every other
    // caller of the lookup does, so a clamp here would judge the offer against
    // the wrong language's description
    // against was the FRENCH one for four of the six languages. `pickLang` already
    // falls back requested → en → fr, which is the correct ladder.
    const hit = tobaccoDbLookupSync(brand, name, lang);
    return !!hit && catalogueCanFill(form, hit);
  }, [form, dbReady, view, autofillSource, apiKey, lang]);

  // Refactored into the shared `useDbSync` hook:
  // "Sync with DB" — when editing an EXISTING tobacco whose brand+name
  // matches a catalog entry AND some field diverges from the catalog
  // value, surface an info Notice with a one-tap overwrite. Only in
  // edit mode (the add flow already pre-fills via the catalog modal).
  // Description and notes EXCLUDED from the diff — user prose stays
  // sacrosanct. See `src/hooks/useDbSync.ts` for the canonical impl.
  const dbSyncRes = useDbSync({
    enabled: view === "editT",
    entryId: form?.id,
    form,
    dbReady,
    lang,
    setForm,
  });
  const dbSync = dbSyncRes.dbSync;
  const dbSyncApplied = dbSyncRes.applied;
  const applyDbSync = dbSyncRes.applyDbSync;
  const dismissDbSync = dbSyncRes.dismissDbSync;

  const isEdit = view === "editT";
  const cancel = () => { setForm(Object.assign({}, BT)); nav("inv", { restoreScroll: true }); };
  const submit = () => {
    // iOS auto-save piggyback — the save tap is the
    // user gesture that lets us silently redirect through Google
    // OAuth when the Drive token has expired. No-op on Android /
    // desktop (silent refresh already covers them).
    (isEdit ? updateTobacco : addTobacco)();
    triggerIosAutosaveReauth && triggerIosAutosaveReauth();
  };
  // Warn on system-back / swipe-back out of a MODIFIED edit form.
  useUnsavedFormGuard((view === "addT" || view === "editT") && !!form, form, submit, cancel);

  if (view !== "addT" && view !== "editT") return null;
  if (!form) return null;

  const set = (patch: any) => setForm(Object.assign({}, form, patch));

  return (
    <FormScreen
      overline={isEdit ? (t ? t("lbl_edit") : "Modifier") : (t ? t("tob_new_overline") : "Nouveau tabac")}
      title={
        <>{isEdit ? <>{form.brand || (t ? t("tob_default_brand") : "Tabac")} <span style={{ fontStyle: "italic", color: C.title }}>{form.name || ""}</span></>
                  : <>{t ? t("tob_new_a") : "Un"} <span style={{ fontStyle: "italic", color: C.title }}>{t ? t("tob_new_phrase") : "nouveau tabac"}</span></>}</>
      }
      onCancel={cancel}
      onSave={submit}
      canSave={!!(form.name && form.brand)}
      saveLabel={isEdit ? (t ? t("btn_save") : "Enregistrer") : (t ? t("btn_add") : "Ajouter")}
      accent={C.brass}
    >
      <AICard
        xl={xl}
        kind="tobacco"
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
        onScanFile={aiScanLabel ? (f: File) => aiScanLabel("tobacco", f) : undefined}
      />

      {/* "Sync with DB" — only when editing AND the
          catalog has divergent values for this entry. */}
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
        // Ghost-click defence: inert success state + a full-screen
        // invisible tap-catcher so the ~150 ms synthetic tap trailing the
        // Synchroniser release lands here, not on a form <select> that shifted
        // up under the finger (which would pop its option list open).
        <div style={{ margin: "0 12px 14px" }}>
          <Notice tone="success">
            <div style={{ fontWeight: 600 }}>{t ? t("db_sync_done") : "Synchronisé ✓"}</div>
          </Notice>
          <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 9998, background: "transparent" }} />
        </div>
      ) : null}

      {/* Duplicate-detection banner. Warning only — never
          blocks save: an exact brand+name dup can be a legitimate
          re-listing (different vintage you didn't link as a lot,
          a refurbished tin, etc.). The user decides. */}
      {dup && (
        <div style={{ margin: "0 12px 14px" }}>
          <Notice tone="warn">
            {t ? t("dup_tob_pre") : "Un tabac avec cette marque et ce nom existe déjà dans votre inventaire"}
            {" "}(<span style={{ fontStyle: "italic" }}>{[dup.brand, dup.name].filter(Boolean).join(" — ")}</span>).
            {" "}{t ? t("dup_tob_post") : "S'il s'agit d'une nouvelle boîte du même mélange, ajoutez plutôt un lot au tabac existant — l'historique reste cohérent."}
          </Notice>
        </div>
      )}
      {/* Also flag if the same brand+name is on the
          wishlist — the user is creating something they were chasing. */}
      {!dup && wishDup && (
        <div style={{ margin: "0 12px 14px" }}>
          <Notice tone="info">
            {t ? t("dup_tob_wish_pre") : "Ce tabac est dans votre wishlist"}
            {" "}(<span style={{ fontStyle: "italic" }}>{[wishDup.brand, wishDup.name].filter(Boolean).join(" — ")}</span>).
            {" "}{t ? t("dup_tob_wish_post") : "Vous pouvez l'acquérir depuis la wishlist (bouton « Acquérir ») pour retirer automatiquement l'envie correspondante."}
          </Notice>
        </div>
      )}

      <FormSection title={t ? t("sec_identity") : "Identité"} accent={C.brassHi}>
        <TextField label={t ? t("lbl_brand_lbl") : "Marque"} required
          value={form.brand || ""} onChange={(v) => set({ brand: v })}
          placeholder="Peterson" />
        <TextField label={t ? t("lbl_name_req") : "Nom"} required
          value={form.name || ""} onChange={(v) => set({ name: v })}
          placeholder="Nightcap" />
        {/* The catalogue offer sits HERE — under the identity
            fields that trigger it, not in the AICard at the top of the form
            (scrolled off-screen once the keyboard is up, so a recognised
            blend went unnoticed). Brand FIRST then name, matching
            the pipe and accessory forms; the offer follows the SECOND field
            because the match needs both. */}
        {dbMissing && <CatalogueMissing compact />}
        <CatalogOffer show={dbHinted} busy={!!aiLoad} error={aiErr || ""}
          onApply={() => aiAutoFill("tobacco")} t={t} />
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

      <FormSection title={t ? t("sec_rating") : "Évaluation"} accent={C.brassHi}>
        <StarsField label={t ? t("lbl_rating_lbl") : "Note"}
          value={form.rating || 0} onChange={(v) => set({ rating: v })} />
        <SegmentedField<boolean | null>
          label={t ? t("lbl_rebuy_q") : "À reprendre ?"}
          value={form.rebuy ?? null}
          onChange={(v) => set({ rebuy: v })}
          options={[
            { value: true,  label: t ? t("opt_yes") : "Oui",   color: C.sage },
            { value: false, label: t ? t("opt_no")  : "Non",   color: C.oxbloodHi },
            { value: null,  label: "?",                          color: C.tx2 },
          ]}
        />
        <TextField label={t ? t("lbl_aging_max") : "Âge max cave (ans)"}
          value={form.agingMax || ""} onChange={(v) => set({ agingMax: v })}
          placeholder={t ? t("aging_max_placeholder") : "ex: 5 ou 3-5"} mono />
      </FormSection>

      <FormSection title={t ? t("lbl_notes") : "Notes"} accent={C.sage}>
        <TextAreaField label={t ? t("lbl_tasting") : "Notes du tabac"}
          value={form.tastingNotes || ""} onChange={(v) => set({ tastingNotes: v })}
          italic minHeight={160} placeholder={t ? t("tasting_notes_placeholder") : "Caractère, saveur, complexité…"} />
        <TextAreaField label={t ? t("lbl_desc") : "Description"}
          value={form.description || ""} onChange={(v) => set({ description: v })} minHeight={160} />
      </FormSection>

      <FormSection title={t ? t("sec_tags") : "Collections"} accent={C.steelHi}>
        <TagEditor
          tags={Array.isArray(form.tags) ? form.tags : []}
          suggestions={allTags(data?.tobaccos || [])}
          onChange={(next: string[]) => set({ tags: sanitizeTags(next) })}
          t={t}
        />
      </FormSection>

      <FormSection title={t ? t("lbl_image") : "Image"} accent={C.oxbloodHi}>
        <PhotoField
          value={form.imageUrl || ""}
          preview={form.imageUrl ? (imgLocal?.[form.imageUrl] || form.imageUrl) : undefined}
          onPickFile={() => handlePhotoUpload && handlePhotoUpload((key: string, du: string) => {
            set({ imageUrl: key });
            setImgLocal && setImgLocal((p: any) => Object.assign({}, p, { [key]: du }));
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

