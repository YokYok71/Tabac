// Passphrase prompt for the optional Drive backup encryption
// (cryptoBackup.ts). Two modes:
//   - "setup":  user enables encryption → enter + confirm + irreversible
//               warning. Returns the passphrase on submit.
//   - "unlock": app needs the passphrase to save / restore but it isn't
//               cached in memory yet (post-reload, post-language-switch).
//               Single field. Returns the passphrase on submit.
//
// The passphrase is never stored — caller is responsible for keeping it
// in component state (memory-only). Modal returns null on cancel.

import { useEffect, useRef, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, fsInput, C, F } from "../../theme-curator.ts";
import { Modal, ModalHeader } from "../../components/curator/Modal.tsx";
import { ModalAction } from "../../components/curator/ModalAction.tsx";
import { Notice } from "../../components/curator/Notice.tsx";
import { useFocusRing } from "../../components/curator/FormFields.tsx";

const MIN_LEN = 8;

export function CuratorEncryptionPromptModal() {
  const ctx = useAppCtx();
  const { encryptionPrompt, resolveEncryptionPrompt, t } = ctx;
  const open = !!encryptionPrompt;
  const mode = encryptionPrompt?.mode || "unlock";

  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ring1 = useFocusRing();
  const ring2 = useFocusRing();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPw("");
      setConfirm("");
      setErr(null);
      // preventScroll — see SearchModal. Same shape: an overlay
      // focusing its first field while the page behind stays put.
      const r = requestAnimationFrame(() => firstFieldRef.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(r);
    }
  }, [open, mode]);

  function cancel() {
    if (resolveEncryptionPrompt) resolveEncryptionPrompt(null);
  }
  function submit() {
    setErr(null);
    if (!pw) {
      setErr(t ? t("enc_err_empty") : "La phrase secrète ne peut pas être vide.");
      return;
    }
    if (mode === "setup") {
      if (pw.length < MIN_LEN) {
        setErr((t ? t("enc_err_short_prefix") : "Au moins ") + MIN_LEN + (t ? t("enc_err_short_suffix") : " caractères."));
        return;
      }
      if (pw !== confirm) {
        setErr(t ? t("enc_err_mismatch") : "Les deux saisies ne correspondent pas.");
        return;
      }
    }
    if (resolveEncryptionPrompt) resolveEncryptionPrompt(pw);
  }

  if (!open) return null;
  return (
    <Modal open={open} onClose={cancel} maxWidth={460}
      ariaLabel={mode === "setup"
        ? (t ? t("enc_setup_title") : "Activer le chiffrement cloud")
        : (t ? t("enc_unlock_title") : "Débloquer le chiffrement cloud")}>
      <ModalHeader
        overline={t ? t("sec_cloud") : "☁️ Sauvegarde cloud"}
        title={mode === "setup"
          ? (t ? t("enc_setup_title") : "Activer le chiffrement cloud")
          : (t ? t("enc_unlock_title") : "Débloquer le chiffrement cloud")}
        onClose={cancel}
        accent={C.brassHi}
      />
      <div style={{ padding: "0 18px 18px" }}>
        {mode === "setup" && (
          <Notice tone="warn" style={{ marginBottom: 14 }}>
            {t ? t("enc_warn_lost_passphrase") : "⚠️ Cette phrase ne peut pas être récupérée. Si vous l'oubliez, vos sauvegardes cloud chiffrées deviendront définitivement illisibles. Notez-la dans un gestionnaire de mots de passe avant de continuer."}
          </Notice>
        )}
        <div style={{ fontFamily: F.body, fontSize: fs(15), color: C.tx2, lineHeight: 1.55, marginBottom: 14 }}>
          {mode === "setup"
            ? (t ? t("enc_setup_body") : "Choisissez une phrase secrète (≥ 8 caractères). Elle sera demandée à chaque sauvegarde ou restauration cloud.")
            : (t ? t("enc_unlock_body") : "Entrez votre phrase secrète pour déverrouiller le chiffrement Drive sur cet appareil.")}
        </div>
        <label style={{ display: "block", marginBottom: 10 }}>
          <div style={{ fontFamily: F.mono, fontSize: fs(11.5), color: C.tx3, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>
            {t ? t("enc_lbl_passphrase") : "Phrase secrète"}
          </div>
          <input
            ref={firstFieldRef}
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onFocus={ring1.onFocus}
            onBlur={ring1.onBlur}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            autoComplete="new-password"
            style={{
              width: "100%", padding: "10px 12px",
              background: C.bg2, color: C.ivory,
              border: `1px solid ${C.rule}`, borderRadius: 8,
              fontFamily: F.mono, fontSize: fsInput(15), outline: "none",
              boxSizing: "border-box",
              ...(ring1.focused ? { boxShadow: `0 0 0 2px ${alpha(C.brassHi, "88")}` } : {}),
            }}
          />
        </label>
        {mode === "setup" && (
          <label style={{ display: "block", marginBottom: 10 }}>
            <div style={{ fontFamily: F.mono, fontSize: fs(11.5), color: C.tx3, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>
              {t ? t("enc_lbl_passphrase_confirm") : "Confirmer la phrase secrète"}
            </div>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onFocus={ring2.onFocus}
              onBlur={ring2.onBlur}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              autoComplete="new-password"
              style={{
                width: "100%", padding: "10px 12px",
                background: C.bg2, color: C.ivory,
                border: `1px solid ${C.rule}`, borderRadius: 8,
                fontFamily: F.mono, fontSize: fsInput(15), outline: "none",
                boxSizing: "border-box",
                ...(ring2.focused ? { boxShadow: `0 0 0 2px ${alpha(C.brassHi, "88")}` } : {}),
              }}
            />
          </label>
        )}
        {err && (
          <Notice tone="error" style={{ marginTop: 6, marginBottom: 6 }}>{err}</Notice>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <ModalAction variant="secondary" onClick={cancel} style={{ flex: 1 }}>
            {t ? t("btn_cancel") : "Annuler"}
          </ModalAction>
          <ModalAction variant="primary" onClick={submit} style={{ flex: 1 }}>
            {mode === "setup"
              ? (t ? t("enc_btn_enable") : "Activer")
              : (t ? t("enc_btn_unlock") : "Déverrouiller")}
          </ModalAction>
        </div>
      </div>
    </Modal>
  );
}
