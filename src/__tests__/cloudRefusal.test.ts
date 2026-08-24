// « LE SERVEUR REFUSE » N'EST PAS « VOTRE SESSION A EXPIRÉ ».
//
// MESURÉ en pilotant le vrai `useGdriveSync` avec un refus du fournisseur :
//
//   refus                        statut affiché        jeton
//   403 quota Drive plein        « st_connecting »     JETÉ
//   403 auth véritable           « st_connecting »     JETÉ
//   500 côté serveur             « err_prefix: Internal Error »  conservé
//
// Les deux 403 sont indiscernables pour le code, qui ne regarde que `code`.
// Google met pourtant le discriminant dans `error.errors[].reason` :
// `storageQuotaExceeded` pour un Drive plein, `insufficientPermissions` pour un
// vrai problème d'autorisation.
//
// Ce que coûte la confusion : un Drive plein fait JETER un jeton VALIDE, puis
// relancer une authentification — sur iOS standalone c'est une redirection
// OAuth complète, donc l'utilisateur repasse par Google, en boucle, pour un
// problème qui n'a rien à voir avec sa session. Et on ne lui dit jamais que son
// Drive est plein. C'est la forme d'échec que ce dépôt consigne le plus
// souvent : envoyer l'utilisateur au mauvais remède.
//
// Le quota gratuit de Drive est partagé avec Gmail et Photos, donc le saturer
// est ordinaire.

import { describe, it, expect } from "vitest";
import { cloudRefusalKind, isAuthRefusal } from "../utils/gdriveApi.ts";

describe("cloudRefusalKind — distinguer ce que le fournisseur reproche", () => {
  it("Drive plein : quota, pas auth", () => {
    const e = { code: 403, message: "The user's Drive storage quota has been exceeded.",
      errors: [{ reason: "storageQuotaExceeded", domain: "global" }] };
    expect(cloudRefusalKind(e)).toBe("quota");
    expect(isAuthRefusal(e), "un Drive plein ferait jeter le jeton").toBe(false);
  });

  it("quota du projet dépassé : quota aussi", () => {
    expect(cloudRefusalKind({ code: 403, errors: [{ reason: "quotaExceeded" }] })).toBe("quota");
  });

  it("trop de requêtes : rate, pas auth", () => {
    for (const reason of ["rateLimitExceeded", "userRateLimitExceeded"]) {
      const e = { code: 403, errors: [{ reason }] };
      expect(cloudRefusalKind(e), reason).toBe("rate");
      expect(isAuthRefusal(e), reason + " ferait jeter le jeton").toBe(false);
    }
  });

  it("403 d'autorisation véritable : auth", () => {
    const e = { code: 403, message: "Insufficient Permission",
      errors: [{ reason: "insufficientPermissions" }] };
    expect(cloudRefusalKind(e)).toBe("auth");
    expect(isAuthRefusal(e)).toBe(true);
  });

  it("401 : auth, avec ou sans raison", () => {
    // Le comportement HISTORIQUE, qui ne doit pas bouger : un 401 est une
    // expiration de jeton, point.
    expect(isAuthRefusal({ code: 401, message: "Unauthorized" })).toBe(true);
    expect(isAuthRefusal({ code: 401, errors: [{ reason: "authError" }] })).toBe(true);
  });

  it("403 SANS raison exploitable reste auth — le défaut ne change pas", () => {
    // Le point qui rend ce changement sûr : on ne reclasse QUE ce qu'on sait
    // nommer. Tout le reste garde exactement l'ancien comportement.
    expect(isAuthRefusal({ code: 403, message: "Forbidden" })).toBe(true);
    expect(isAuthRefusal({ code: 403, errors: [] })).toBe(true);
    expect(isAuthRefusal({ code: 403, errors: [{ reason: "somethingNew" }] })).toBe(true);
  });

  it("Dropbox : plus de place, et écriture trop fréquente", () => {
    // `dropboxProvider` normalise en `{code: <statut HTTP>, message: "Dropbox: " + summary}`,
    // donc le discriminant est dans le MESSAGE.
    expect(cloudRefusalKind({ code: 507, message: "Dropbox: path/insufficient_space/.." })).toBe("quota");
    expect(cloudRefusalKind({ code: 429, message: "Dropbox: too_many_write_operations/..." })).toBe("rate");
  });

  it("un 5xx ou un réseau reste « other » — ni auth ni quota", () => {
    expect(cloudRefusalKind({ code: 500, message: "Internal Error" })).toBe("other");
    expect(cloudRefusalKind({ code: 404, message: "File not found" })).toBe("other");
    expect(isAuthRefusal({ code: 500 })).toBe(false);
  });

  it("survit à une entrée absurde sans jeter", () => {
    // L'entrée vient du réseau : elle peut être n'importe quoi.
    for (const junk of [null, undefined, 0, "", "nope", [], {}, { errors: "pas un tableau" },
                        { code: "403" }, { errors: [null] }, { errors: [{ reason: 42 }] }]) {
      expect(() => cloudRefusalKind(junk as any)).not.toThrow();
      expect(() => isAuthRefusal(junk as any)).not.toThrow();
    }
    expect(cloudRefusalKind(null as any)).toBe("other");
    // Une clé forgée ne doit pas résoudre sur Object.prototype.
    expect(cloudRefusalKind({ code: 403, errors: [{ reason: "__proto__" }] })).toBe("auth");
  });

  it("le code prime sur un message qui MENTIONNE un mot-clé", () => {
    // Contrepoids : un blend nommé « insufficient_space » dans un message
    // d'erreur sans rapport ne doit pas être lu comme un quota. On n'accepte
    // le marqueur Dropbox que sur les statuts que Dropbox utilise pour ça.
    expect(cloudRefusalKind({ code: 401, message: "Dropbox: insufficient_space" })).toBe("auth");
    expect(cloudRefusalKind({ code: 500, message: "too_many_write_operations" })).toBe("other");
  });
});

// ── LE CÂBLAGE, qui est ce qui pourrit ──────────────────────────────────────
//
// Le classifieur pur ne garantit rien tout seul : c'est la leçon la plus
// répétée de ce dépôt (`chooseAutoSaveTarget` avait sa propre suite et son
// APPEL n'était couvert par rien). Ces cas pilotent donc le vrai
// `useGdriveSync`.

import { renderHook, act, waitFor } from "@testing-library/react";
import { vi as _vi, beforeEach as _beforeEach } from "vitest";
import { useGdriveSync } from "../hooks/useGdriveSync.ts";
import { LANGUAGES } from "../i18n/languages.ts";
import { translate } from "../i18n.ts";

describe("un refus NON authentifié garde le jeton et dit ce qui ne va pas", () => {
  const t = (k: string) => translate("fr", k);
  const props = () => ({
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    t, lang: "fr", setSaveError: _vi.fn(), setSaveWarn: _vi.fn(),
    stageImport: _vi.fn(), pendingSync: false, setPendingSync: _vi.fn(),
    markExported: _vi.fn(), imgLocal: {}, setImgLocal: _vi.fn(),
    setImportModal: _vi.fn(), setSettingsTab: _vi.fn(), setPhotoErr: _vi.fn(),
  });

  _beforeEach(() => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem("cave-cloud-provider", "gdrive");
    localStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok", x: Date.now() + 3600e3 }));
  });

  async function save(uploadErr: any) {
    (globalThis as any).fetch = _vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ files: [] }) })
      .mockResolvedValue({ json: async () => uploadErr });
    const { result } = renderHook(() => useGdriveSync(props() as any));
    act(() => { (result.current as any).gdriveSave("tok"); });
    await waitFor(() => expect((result.current as any).gdriveStatus).toMatch(/plein|refuse|Erreur/i),
      { timeout: 4000 }).catch(() => {});
    return result;
  }

  it("Drive plein : le jeton SURVIT et l'écran nomme le vrai problème", async () => {
    const r = await save({ error: { code: 403, errors: [{ reason: "storageQuotaExceeded" }],
      message: "The user's Drive storage quota has been exceeded." } });
    expect(localStorage.getItem("gdrive-tk"),
      "un jeton VALIDE a été jeté — sur iOS cela relance une redirection OAuth").not.toBeNull();
    const st = String((r.current as any).gdriveStatus);
    expect(st, "l'écran ne dit pas que le stockage est plein : « " + st + " »").toMatch(/plein/i);
    expect(st, "la prose anglaise du fournisseur est passée telle quelle")
      .not.toMatch(/storage quota has been exceeded/i);
  }, 30000);

  it("403 d'autorisation véritable : le jeton est jeté, comme avant", async () => {
    // Le contrepoids. Sans lui, une garde qui refuserait TOUT reclassement
    // passerait le cas ci-dessus tout en cassant la ré-authentification, qui
    // est le chemin ordinaire d'un jeton expiré.
    await save({ error: { code: 403, errors: [{ reason: "insufficientPermissions" }],
      message: "Insufficient Permission" } });
    await waitFor(() => expect(localStorage.getItem("gdrive-tk")).toBeNull(), { timeout: 4000 });
  }, 30000);

  it("les deux messages existent dans les six langues et ne rendent pas leur clé", () => {
    for (const l of LANGUAGES) {
      for (const k of ["err_cloud_full", "err_cloud_rate"]) {
        const v = translate(l.code, k);
        expect(v, l.code + " n'a pas " + k).not.toBe(k);
        expect(String(v).length, l.code + "/" + k + " est vide").toBeGreaterThan(10);
      }
    }
  });

  it("les huit sites de refus passent par isAuthRefusal, pas par le code brut", async () => {
    // Source-level : ce qui pourrit est un site qui retombe sur `code === 403`.
    const src = (await import("node:fs")).readFileSync("src/hooks/useGdriveSync.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    expect((src.match(/isAuthRefusal\(/g) || []).length,
      "moins de huit sites passent par le classifieur").toBeGreaterThanOrEqual(8);
    expect(src, "un site compare encore le code brut")
      .not.toMatch(/error\.code === 401 \|\| \w+\.error\.code === 403/);
  });
});
