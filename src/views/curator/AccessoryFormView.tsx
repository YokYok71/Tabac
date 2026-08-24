// Curator AccessoryFormView — Add / Edit an accessory.

import { useAppCtx } from "../../AppContext.tsx";
import { useUnsavedFormGuard } from "../../hooks/useUnsavedFormGuard.ts";
import { fs, C } from "../../theme-curator.ts";
import { ACC_TYPES, ACC_TYPES_EN, LIGHTER_FUELS, LIGHTER_FUELS_EN } from "../../constants.ts";
import {
  FormScreen, FormSection,
  TextField, TextAreaField, SelectField, StarsField, SegmentedField, PhotoField,
} from "../../components/curator/FormFields.tsx";
import { TagEditor } from "../../components/curator/TagEditor.tsx";
import { allTags, sanitizeTags } from "../../utils/tags.ts";
import { imgMap } from "../../utils/imgCache.ts";

export function CuratorAccessoryFormView() {
  const ctx = useAppCtx();
  const {
    view, accForm: form, setAccForm: setForm, t, xl, nav, BA, data,
    addAccessory, updateAccessory,
    handlePhotoUpload, imgLocal, setImgLocal,
    currencySymbol = "€",
    triggerIosAutosaveReauth,
  } = ctx;
  const isEdit = view === "editA";
  const cancel = () => { setForm(Object.assign({}, BA)); nav("acc", { restoreScroll: true }); };
  const submit = () => {
    // See TobaccoFormView for the iOS auto-save piggyback.
    (isEdit ? updateAccessory : addAccessory)();
    triggerIosAutosaveReauth && triggerIosAutosaveReauth();
  };
  useUnsavedFormGuard((view === "addA" || view === "editA") && !!form, form, submit, cancel); // add + edit

  if (view !== "addA" && view !== "editA") return null;
  if (!form) return null;

  // FUNCTIONAL. `handlePhotoUpload` is a FileReader → Image decode → canvas →
  // IndexedDB chain, so its callback fires a fraction of a second after the
  // picker closes, holding the `form` from the render in which the button was
  // tapped — and any field edited in that window was reverted when the photo
  // key was written back.
  const set = (patch: any) => setForm((prev: any) => Object.assign({}, prev, patch));
  const isLighter = form.type === "Briquet";

  return (
    <FormScreen
      overline={isEdit ? (t ? t("lbl_edit") : "Modifier") : (t ? t("acc_new_overline") : "Nouvel accessoire")}
      title={
        <>{isEdit ? <>{form.brand || (t ? t("acc_default_brand") : "Accessoire")} <span style={{ fontStyle: "italic", color: C.ember }}>{form.name || ""}</span></>
                  : <>{t ? t("acc_new_a") : "Un"} <span style={{ fontStyle: "italic", color: C.ember }}>{t ? t("acc_new_phrase") : "nouvel accessoire"}</span></>}</>
      }
      onCancel={cancel}
      onSave={submit}
      canSave={!!(form.brand || form.name)}
      saveLabel={isEdit ? (t ? t("btn_save") : "Enregistrer") : (t ? t("btn_add") : "Ajouter")}
      accent={C.ember}
    >
      <FormSection title={t ? t("sec_identity") : "Identité"} accent={C.ember}>
        {/* The save gate is name OR brand (an accessory like a
            generic tamper legitimately has no brand) — but nothing told
            the user that. Surface the rule instead of leaving the
            disabled save button unexplained. */}
        <div style={{
          fontSize: fs(13.5), fontStyle: "italic", color: C.tx3,
          margin: "0 0 10px",
        }}>
          {t ? t("acc_name_or_brand_hint") : "Nom ou marque requis (au moins l'un des deux)"}
        </div>
        <TextField label={t ? t("lbl_brand_lbl") : "Marque"}
          value={form.brand || ""} onChange={(v) => set({ brand: v })}
          placeholder="IM Corona" />
        <TextField label={t ? t("lbl_name_req") : "Nom"}
          value={form.name || ""} onChange={(v) => set({ name: v })}
          placeholder="Old Boy" />
        <SelectField label={t ? t("lbl_type") : "Type"}
          value={form.type || ""} onChange={(v) => set({ type: v })}
          options={(ACC_TYPES as readonly string[]).map(tp => ({
            value: tp, label: xl ? xl(tp, ACC_TYPES_EN) : tp,
          }))} />
        {isLighter && (
          <SelectField label={t ? t("lbl_fuel") : "Combustible"}
            value={form.fuel || ""} onChange={(v) => set({ fuel: v })}
            options={(LIGHTER_FUELS as readonly string[]).map(f => ({ value: f, label: xl ? xl(f, LIGHTER_FUELS_EN) : f }))} />
        )}
      </FormSection>

      <FormSection title={t ? t("sec_acquisition") : "Acquisition"} accent={C.brassHi}>
        {/* Accessories track purchase at year granularity
            only — see PipeFormView for the rationale. */}
        <TextField label={t ? t("lbl_purchased_on") : "Achat"}
          type="number" value={form.datePurchased || ""} onChange={(v) => set({ datePurchased: v })}
          placeholder={t ? t("production_date_placeholder") : "ex: 2017"} mono />
        <TextField label={`${t ? t("lbl_price") : "Prix"} (${currencySymbol})`}
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
            { value: "active",  label: t ? t("acc_active")  : "Actif",  color: C.sage },
            { value: "retired", label: t ? t("acc_retired") : "Retiré", color: C.tx2 },
          ]}
        />
      </FormSection>

      <FormSection title={t ? t("lbl_notes") : "Notes"} accent={C.sage}>
        <TextAreaField italic minHeight={160}
          value={form.notes || ""} onChange={(v) => set({ notes: v })} />
      </FormSection>

      <FormSection title={t ? t("sec_tags") : "Collections"} accent={C.steelHi}>
        <TagEditor
          tags={Array.isArray(form.tags) ? form.tags : []}
          suggestions={allTags(data?.accessories || [])}
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
      </FormSection>
    </FormScreen>
  );
}
