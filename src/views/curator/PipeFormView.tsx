// Curator PipeFormView — Add / Edit a pipe.

import { useState, useEffect } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { useUnsavedFormGuard } from "../../hooks/useUnsavedFormGuard.ts";
import { C, fs, F } from "../../theme-curator.ts";
import { imgCache, safeBgUrl, imgMap } from "../../utils/imgCache.ts";
import { Ico } from "../../components/curator/icons.tsx";
import { TagEditor } from "../../components/curator/TagEditor.tsx";
import { allTags, sanitizeTags } from "../../utils/tags.ts";
import {
  SHAPES_EN, SHAPE_FAMILIES, BENDS, BENDS_EN, FILTERS, FILTERS_EN,
  BOWL_MAT_FAMILIES, BOWL_MATS_EN, STEM_MAT_FAMILIES, STEM_MATS_EN,
  FINISHES, FINISHES_EN,
  PIPE_MAX_EXTRA_PHOTOS,
} from "../../constants.ts";
import {
  FormScreen, FormSection,
  TextField, TextAreaField, SelectField, StarsField, SegmentedField, PhotoField,
} from "../../components/curator/FormFields.tsx";
import { AICard } from "../../components/curator/AICard.tsx";
import { Notice } from "../../components/curator/Notice.tsx";
import {
  chamberDimsPlausible,
  CHAMBER_DIAMETER_MIN, CHAMBER_DIAMETER_MAX, CHAMBER_DEPTH_MIN, CHAMBER_DEPTH_MAX,
} from "../../utils/bowlEstimate.ts";

export function CuratorPipeFormView() {
  const ctx = useAppCtx();
  const {
    view, pipeForm: form, setPipeForm: setForm, t, xl, nav, BP, data,
    addPipe, updatePipe, lengthUnit = "mm", weightUnit = "g", currencySymbol = "€",
    handlePhotoUpload, imgLocal, setImgLocal,
    apiKey, aiLoad, aiErr, aiAutoFill, aiProvider,
    triggerIosAutosaveReauth,
  } = ctx;
  const isEdit = view === "editP";
  const cancel = () => { setForm(Object.assign({}, BP)); nav("pipes", { restoreScroll: true }); };
  const submit = () => {
    // See TobaccoFormView for the iOS auto-save piggyback.
    (isEdit ? updatePipe : addPipe)();
    triggerIosAutosaveReauth && triggerIosAutosaveReauth();
  };
  useUnsavedFormGuard((view === "addP" || view === "editP") && !!form, form, submit, cancel); // add + edit

  if (view !== "addP" && view !== "editP") return null;
  if (!form) return null;

  // FUNCTIONAL. `handlePhotoUpload` is a FileReader → Image decode → canvas →
  // IndexedDB chain, so its callback fires a fraction of a second after the
  // picker closes, holding the `form` from the render in which the button was
  // tapped — and any field edited in that window was reverted when the photo
  // key was written back.
  const set = (patch: any) => setForm((prev: any) => Object.assign({}, prev, patch));

  return (
    <FormScreen
      overline={isEdit ? (t ? t("lbl_edit") : "Modifier") : (t ? t("pipe_form_overline_new") : "Nouvelle pipe")}
      title={
        <>{isEdit ? <>{form.brand || (t ? t("stat_pipes_word") : "Pipes")} <span style={{ fontStyle: "italic", color: C.oxbloodHi }}>{form.name || ""}</span></>
                  : <>{t ? t("pipe_new_a") : "Une"} <span style={{ fontStyle: "italic", color: C.oxbloodHi }}>{t ? t("pipe_new_phrase") : "nouvelle pipe"}</span></>}</>
      }
      onCancel={cancel}
      onSave={submit}
      canSave={!!(form.brand && form.name)}
      saveLabel={isEdit ? (t ? t("btn_save") : "Enregistrer") : (t ? t("btn_add") : "Ajouter")}
      accent={C.oxbloodHi}
    >
      <AICard kind="pipe" apiKey={apiKey} aiLoad={!!aiLoad} aiErr={aiErr || ""} xl={xl}
        aiAutoFill={aiAutoFill} t={t} aiProvider={aiProvider} />

      <FormSection title={t ? t("sec_identity") : "Identité"} accent={C.oxbloodHi}>
        <TextField label={t ? t("lbl_brand_lbl") : "Marque"} required
          value={form.brand || ""} onChange={(v) => set({ brand: v })}
          placeholder="Peterson" />
        <TextField label={t ? t("lbl_name_req") : "Nom"} required
          value={form.name || ""} onChange={(v) => set({ name: v })}
          placeholder="Sherlock Holmes" />
        <SelectField label={t ? t("lbl_shape") : "Forme"}
          value={form.shape || ""} onChange={(v) => set({ shape: v })}
          groups={SHAPE_FAMILIES.map(f => {
            const fk = "shape_family_" + f.key;
            return {
              label: t ? t(fk) : f.key,
              options: f.shapes.map(s => ({ value: s, label: xl ? xl(s, SHAPES_EN) : s })),
            };
          })} />
        <SelectField label={t ? t("lbl_bend") : "Courbure"}
          value={form.courbure || ""} onChange={(v) => set({ courbure: v })}
          options={(BENDS as readonly string[]).map(b => ({ value: b, label: xl ? xl(b, BENDS_EN) : b }))} />
      </FormSection>

      <FormSection title={t ? t("sec_materials") : "Matériaux"} accent={C.sage}>
        <SelectField label={t ? t("lbl_bowl_material") : "Foyer"}
          value={form.bowlMaterial || ""} onChange={(v) => set({ bowlMaterial: v })}
          groups={BOWL_MAT_FAMILIES.map(f => ({
            label: t ? t(f.labelKey) : f.labelKey,
            options: f.values.map(b => ({ value: b, label: xl ? xl(b, BOWL_MATS_EN) : b })),
          }))} />
        <SelectField label={t ? t("lbl_finish") : "Finition"}
          value={form.finish || ""} onChange={(v) => set({ finish: v })}
          options={(FINISHES as readonly string[]).map(f => ({ value: f, label: xl ? xl(f, FINISHES_EN) : f }))} />
        <SelectField label={t ? t("lbl_stem_material") : "Tuyau"}
          value={form.stemMaterial || ""} onChange={(v) => set({ stemMaterial: v })}
          groups={STEM_MAT_FAMILIES.map(f => ({
            label: t ? t(f.labelKey) : f.labelKey,
            options: f.values.map(s => ({ value: s, label: xl ? xl(s, STEM_MATS_EN) : s })),
          }))} />
        <SelectField label={t ? t("lbl_filter_kind") : "Filtre"}
          value={form.filterType || ""} onChange={(v) => set({ filterType: v })}
          options={(FILTERS as readonly string[]).map(f => ({ value: f, label: xl ? xl(f, FILTERS_EN) : f }))} />
      </FormSection>

      <FormSection title={t ? t("sec_dimensions") : "Dimensions"} accent={C.amber}>
        <TextField label={`${t ? t("lbl_length") : "Longueur"} (${lengthUnit})`}
          type="number" step="0.1" value={form.length || ""} onChange={(v) => set({ length: v })} mono />
        <TextField label={`${t ? t("lbl_weight_simple") : "Poids"} (${weightUnit})`}
          type="number" step="0.1" value={form.weight || ""} onChange={(v) => set({ weight: v })} mono />
        <TextField label={`${t ? t("lbl_chamber_diameter") : "Diamètre foyer"} (mm)`}
          type="number" step="0.1" value={form.chamberDiameter || ""} onChange={(v) => set({ chamberDiameter: v })} mono />
        <TextField label={`${t ? t("lbl_chamber_depth") : "Profondeur foyer"} (mm)`}
          type="number" step="0.1" value={form.chamberDepth || ""} onChange={(v) => set({ chamberDepth: v })} mono />
        {/* Advisory warning when a chamber dimension is outside the
            plausible range — a mis-entered value (cm typed as mm, etc.) would
            blow up the session weight estimate. Never blocks save. */}
        {(() => {
          const pl = chamberDimsPlausible(form.chamberDiameter, form.chamberDepth);
          if (pl.diameterOk && pl.depthOk) return null;
          return (
            <Notice tone="warn" style={{ marginTop: 4 }}>
              {String(t ? t("chamber_dims_warn") : "Dimension du foyer inhabituelle — vérifiez la saisie (Ø {dmin}–{dmax} mm, profondeur {hmin}–{hmax} mm). Une valeur erronée fausserait l'estimation du grammage.")
                .replace("{dmin}", String(CHAMBER_DIAMETER_MIN)).replace("{dmax}", String(CHAMBER_DIAMETER_MAX))
                .replace("{hmin}", String(CHAMBER_DEPTH_MIN)).replace("{hmax}", String(CHAMBER_DEPTH_MAX))}
            </Notice>
          );
        })()}
      </FormSection>

      <FormSection title={t ? t("sec_acquisition") : "Acquisition"} accent={C.brassHi}>
        {/* Pipes track purchase + production at year
            granularity only — the day / month was rarely known and
            never useful. Stored as a 4-digit string `YYYY`. Migration
            in utils.ts truncates legacy full-date values on load. */}
        <TextField label={t ? t("lbl_purchased_on") : "Achat"}
          type="number" value={form.datePurchased || ""} onChange={(v) => set({ datePurchased: v })}
          placeholder={t ? t("production_date_placeholder") : "ex: 2017"} mono />
        <TextField label={t ? t("lbl_production_date") : "Année de production"}
          type="number" value={form.dateProduction || ""} onChange={(v) => set({ dateProduction: v })}
          placeholder={t ? t("production_date_placeholder") : "ex: 2017"} mono />
        <TextField label={`${t ? t("lbl_price_lbl") : "Prix"} (${currencySymbol})`}
          type="number" step="0.01" value={form.price || ""} onChange={(v) => set({ price: v })} mono />
        <TextField label={t ? t("lbl_seller") : "Vendeur"}
          value={form.seller || ""} onChange={(v) => set({ seller: v })} />
        <TextField label={t ? t("lbl_seller_url") : "Site du vendeur"} type="url"
          placeholder="https://…"
          value={form.sellerUrl || ""} onChange={(v) => set({ sellerUrl: v })} />
      </FormSection>

      <FormSection title={t ? t("sec_rating") : "Évaluation"} accent={C.brassHi}>
        <StarsField label={t ? t("lbl_rating_lbl") : "Note"}
          value={form.rating || 0} onChange={(v) => set({ rating: v })} />
        <SegmentedField<string>
          label={t ? t("lbl_status") : "Statut"}
          value={form.status || "active"}
          onChange={(v) => set({ status: v })}
          options={[
            { value: "active",   label: t ? t("pipe_active_lbl") : "Active",  color: C.sage },
            { value: "finished", label: t ? t("pipe_retired_lbl") : "Retirée",  color: C.tx2 },
          ]}
        />
      </FormSection>

      <FormSection title={t ? t("lbl_notes") : "Notes"} accent={C.sage}>
        <TextAreaField label={t ? t("lbl_notes") : "Notes"} italic minHeight={160}
          value={form.notes || ""} onChange={(v) => set({ notes: v })} />
        <TextAreaField label={t ? t("lbl_desc") : "Description"}
          value={form.description || ""} onChange={(v) => set({ description: v })} minHeight={160} />
      </FormSection>

      <FormSection title={t ? t("sec_tags") : "Collections"} accent={C.steelHi}>
        <TagEditor
          tags={Array.isArray(form.tags) ? form.tags : []}
          suggestions={allTags(data?.pipes || [])}
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
            setImgLocal && setImgLocal((p: any) => imgMap(p, { [key]: du }));
          })}
          onClear={() => set({ imageUrl: "" })}
        />
        {/* Additional pipe photos (pipes only). Loaded on demand,
            never into the global imgLocal — so a big collection stays light. */}
        <PipeExtraPhotos
          photos={form.photos || []}
          onChange={(next: string[]) => set({ photos: next })}
          // Appending goes through an UPDATER, not `[...photos, key]`: the
          // photo chain is async, so a second photo queued before the first
          // landed rebuilt the array from a stale snapshot and dropped one.
          onAppend={(key: string) => setForm((prev: any) => {
            const cur: string[] = prev.photos || [];
            if (cur.indexOf(key) >= 0 || cur.length >= PIPE_MAX_EXTRA_PHOTOS) return prev;
            return Object.assign({}, prev, { photos: cur.concat([key]) });
          })}
        />
      </FormSection>
    </FormScreen>
  );
}

// Extra-photos strip for the pipe form. Self-contained (owns its
// preview state) so its hooks don't sit before the parent's early return.
// Existing photo keys are resolved from IndexedDB on demand; freshly-added
// ones cache their data URL immediately for instant preview.
function PipeExtraPhotos({ photos, onChange, onAppend }: { photos: string[]; onChange: (next: string[]) => void; onAppend: (key: string) => void }) {
  const ctx = useAppCtx();
  const { t, handlePhotoUpload, setPhotoErr } = ctx as any;
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const missing = photos.filter((k) => k && k.indexOf("local-photo-") === 0 && !previews[k]);
    if (!missing.length) return;
    Promise.all(missing.map((k) => imgCache.get(k).then((v) => ({ k, v })).catch(() => ({ k, v: null as any }))))
      .then((res) => {
        if (!alive) return;
        const upd: Record<string, string> = {};
        res.forEach((r) => { if (r.v) upd[r.k] = r.v; });
        if (Object.keys(upd).length) setPreviews((p) => Object.assign({}, p, upd));
      });
    return () => { alive = false; };
  }, [photos, previews]);

  function add() {
    if (!handlePhotoUpload || photos.length >= PIPE_MAX_EXTRA_PHOTOS) return;
    handlePhotoUpload((key: string, du: string) => {
      // Photos[] holds ONLY persisted local-photo-* keys. On an
      // IndexedDB write failure (Safari private mode / near-quota),
      // handlePhotoUpload returns the raw data-URL as `key`; adding it would
      // render this session then vanish on reload (migrateData strips
      // non-local keys). Skip it and surface the error rather than losing the
      // photo silently. (The cover photo has its own base64 fallback; the extra
      // gallery is local-keys-only by contract.)
      if (typeof key !== "string" || key.indexOf("local-photo-") !== 0) {
        if (setPhotoErr) {
          setPhotoErr(t ? t("err_photo_read") : "Impossible de lire cette image");
          setTimeout(() => setPhotoErr(""), 4000);
        }
        return;
      }
      setPreviews((p) => Object.assign({}, p, { [key]: du }));
      onAppend(key);
    });
  }
  function remove(key: string) {
    onChange(photos.filter((k) => k !== key));
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.4, textTransform: "uppercase", color: C.tx3, marginBottom: 8 }}>
        {t ? t("lbl_pipe_extra_photos") : "Photos supplémentaires"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {photos.map((k) => (
          <div key={k} style={{ position: "relative", width: 72, height: 72 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 8, border: `1px solid ${C.rule2}`,
              background: `${safeBgUrl(previews[k] || "")} center/cover no-repeat, ${C.bg2}`,
            }} />
            <button type="button" onClick={() => remove(k)} aria-label={t ? t("btn_remove_photo") : "Retirer la photo"}
              style={{
                position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: 12,
                background: C.oxbloodHi, border: "none", color: C.bg, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              <Ico name="close" size={13} sw={2.4} />
            </button>
          </div>
        ))}
        {photos.length < PIPE_MAX_EXTRA_PHOTOS && (
          <button type="button" onClick={add} aria-label={t ? t("lbl_pipe_add_photo") : "Ajouter une photo"}
            style={{
              width: 72, height: 72, borderRadius: 8, cursor: "pointer",
              border: `1px dashed ${C.rule2}`, background: "transparent", color: C.tx2,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
            <Ico name="camera" size={22} sw={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}
