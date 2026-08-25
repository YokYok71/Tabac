// LE REFUS SILENCIEUX : l'auto-save cessait de fonctionner sans le dire.
//
// MESURÉ en pilotant le vrai `useGdriveSync` à travers quatre tentatives
// refusées faute de place, sur les DEUX fournisseurs :
//
//   fournisseur   refus                          gdriveStatus  setSaveError  setSaveWarn
//   Drive         403 storageQuotaExceeded       null          0 appel       0 appel
//   Dropbox       507 insufficient_space         null          0 appel       0 appel
//
// La seule trace était `cave-autosave-diag`, une ligne de Réglages → Données
// qu'il faut aller chercher. La cave cessait d'atteindre le cloud et
// l'application ne disait rien, indéfiniment, pendant que l'utilisateur
// croyait sa sauvegarde automatique en marche.
//
// La bannière « session Drive expirée » ne peut pas prendre le relais : elle
// exige un jeton EXPIRÉ, et un refus de quota garde le jeton valide — c'est le
// correctif du build 53 lui-même. Côté Dropbox elle rend `null` sans
// condition, donc là le silence était total quelle qu'en fût la cause.
//
// Ce fichier épingle les deux moitiés du correctif : on se tait sur un raté,
// on parle sur une série. Voir AUTOSAVE_FAIL_ALERT dans useGdriveSync.ts pour
// le raisonnement complet.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useGdriveSync, AUTOSAVE_FAIL_ALERT, readAutosaveFailures,
  autosaveFailKey, bumpAutosaveFailures, clearAutosaveFailures, readAutosaveDiag,
} from "../hooks/useGdriveSync.ts";
import { LANGUAGES } from "../i18n/languages.ts";
import { translate } from "../i18n.ts";

const t = (k: string) => translate("fr", k);
const CELLAR = JSON.stringify({
  tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [],
  nxT: 1, nxP: 1, nxA: 1, nxJ: 1, nxW: 1,
});

function props(provider: "gdrive" | "dropbox") {
  return {
    cloudProviderId: provider,
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    t, lang: "fr",
    setSaveError: vi.fn(), setSaveWarn: vi.fn(),
    stageImport: vi.fn(), pendingSync: true, setPendingSync: vi.fn(),
    markExported: vi.fn(), imgLocal: {}, setImgLocal: vi.fn(),
    setImportModal: vi.fn(), setSettingsTab: vi.fn(), setPhotoErr: vi.fn(),
  };
}

/** Drive : la liste répond, l'envoi refuse. */
function driveFetch(uploadBody: any) {
  return vi.fn().mockImplementation((url: any) => {
    if (String(url).indexOf("upload") >= 0) {
      return Promise.resolve({ ok: false, status: 403, json: async () => uploadBody });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ files: [] }) });
  });
}

/** Dropbox : jeton renouvelé, liste vide, envoi refusé. */
function dbxFetch(status: number, summary: string) {
  return vi.fn().mockImplementation((url: any) => {
    const u = String(url);
    if (u.indexOf("oauth2/token") >= 0) {
      return Promise.resolve({ ok: true, status: 200,
        json: async () => ({ access_token: "dtok", expires_in: 14400 }),
        text: async () => JSON.stringify({ access_token: "dtok", expires_in: 14400 }) });
    }
    if (u.indexOf("list_folder") >= 0) {
      return Promise.resolve({ ok: true, status: 200,
        text: async () => JSON.stringify({ entries: [] }) });
    }
    return Promise.resolve({ ok: false, status: status,
      text: async () => JSON.stringify({ error_summary: summary }) });
  });
}

async function runQuiet(result: any, times: number) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await (result.current as any).gdriveSaveQuiet(); });
    await new Promise((r) => setTimeout(r, 900));
  }
}

const QUOTA_DRIVE = {
  error: {
    code: 403, errors: [{ reason: "storageQuotaExceeded" }],
    message: "The user's Drive storage quota has been exceeded.",
  },
};

describe("le compteur de refus consécutifs", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it("est PAR FOURNISSEUR — changer de destination n'hérite pas de la série", () => {
    expect(autosaveFailKey(false)).not.toBe(autosaveFailKey(true));
    bumpAutosaveFailures(false); bumpAutosaveFailures(false); bumpAutosaveFailures(false);
    expect(readAutosaveFailures(false)).toBe(3);
    expect(readAutosaveFailures(true),
      "le compteur Drive a débordé sur Dropbox — le premier échec de la nouvelle " +
      "destination lèverait une alerte qu'elle n'a pas méritée").toBe(0);
    clearAutosaveFailures(false);
    expect(readAutosaveFailures(false)).toBe(0);
  });

  it("survit à une valeur de stockage absurde", () => {
    // La clé est du stockage local : elle peut avoir été éditée à la main.
    for (const junk of ["", "nope", "-4", "NaN", "1e9999", "{}"]) {
      localStorage.setItem(autosaveFailKey(false), junk);
      expect(readAutosaveFailures(false), junk).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(readAutosaveFailures(false)), junk).toBe(true);
    }
  });

  it("est borné — un appareil hors ligne depuis des mois ne fait pas croître un entier sans fin", () => {
    localStorage.setItem(autosaveFailKey(false), "999");
    expect(bumpAutosaveFailures(false)).toBe(999);
  });
});

describe("un auto-save qui échoue en boucle finit par le dire", () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem("cave-autosave", "1");
    localStorage.setItem("pipe-cellar-v6", CELLAR);
  });

  function driveSetup() {
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok", x: Date.now() + 3600e3 }));
    localStorage.setItem("gdrive-auto-fid", "F1");
  }
  function dbxSetup() {
    localStorage.setItem("dropbox-rt", "refresh");
    localStorage.setItem("dropbox-auto-fid", "F1");
  }

  it("Drive : UN seul raté ne dit rien — c'est le travail d'un filet non surveillé", async () => {
    driveSetup();
    (globalThis as any).fetch = driveFetch(QUOTA_DRIVE);
    const p = props("gdrive");
    const { result } = renderHook(() => useGdriveSync(p as any));
    await runQuiet(result, 1);
    expect(p.setSaveWarn.mock.calls.length,
      "crier au premier refus apprendrait à l'utilisateur à ignorer le message").toBe(0);
    expect(readAutosaveFailures(false), "l'échec n'a pas été compté").toBeGreaterThan(0);
    expect(readAutosaveDiag()!.stage).toBe("upload-error");
  }, 30000);

  it("Drive : au seuil, l'écran le dit UNE fois et pas à chaque tentative", async () => {
    driveSetup();
    (globalThis as any).fetch = driveFetch(QUOTA_DRIVE);
    const p = props("gdrive");
    const { result } = renderHook(() => useGdriveSync(p as any));
    await runQuiet(result, AUTOSAVE_FAIL_ALERT + 2);
    expect(p.setSaveWarn.mock.calls.length,
      "l'auto-save a cessé de fonctionner sans que rien ne le dise ailleurs que " +
      "dans la ligne de diagnostic").toBe(1);
    expect(String(p.setSaveWarn.mock.calls[0]![0])).toBe(t("cloud_autosave_failing"));
    expect(p.setSaveError.mock.calls.length,
      "le canal oxblood est celui d'une cave qui ne s'enregistre pas ; ici les " +
      "données SONT sur l'appareil").toBe(0);
    expect(sessionStorage.getItem("gdrive-tk"),
      "un jeton valide a été jeté pour un disque plein").not.toBeNull();
  }, 40000);

  it("Dropbox : même silence, même seuil, même message", async () => {
    dbxSetup();
    (globalThis as any).fetch = dbxFetch(507, "path/insufficient_space/...");
    const p = props("dropbox");
    const { result } = renderHook(() => useGdriveSync(p as any));
    await runQuiet(result, 1);
    expect(p.setSaveWarn.mock.calls.length).toBe(0);
    await runQuiet(result, AUTOSAVE_FAIL_ALERT + 1);
    expect(p.setSaveWarn.mock.calls.length,
      "sur Dropbox le silence était TOTAL — la bannière d'authentification y " +
      "rend null sans condition").toBe(1);
    expect(String(p.setSaveWarn.mock.calls[0]![0])).toBe(t("cloud_autosave_failing"));
  }, 40000);

  it("un succès remet la série à zéro ET réarme l'alerte", async () => {
    driveSetup();
    (globalThis as any).fetch = driveFetch(QUOTA_DRIVE);
    const p = props("gdrive");
    const { result } = renderHook(() => useGdriveSync(p as any));
    await runQuiet(result, AUTOSAVE_FAIL_ALERT);
    expect(p.setSaveWarn.mock.calls.length).toBe(1);

    // Le cloud se remet à répondre.
    (globalThis as any).fetch = vi.fn().mockImplementation((url: any) => {
      if (String(url).indexOf("upload") >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: "F2", name: "n" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ files: [] }) });
    });
    await runQuiet(result, 1);
    expect(readAutosaveFailures(false), "la série n'a pas été remise à zéro").toBe(0);

    // Puis il recasse : il faut le redire.
    (globalThis as any).fetch = driveFetch(QUOTA_DRIVE);
    await runQuiet(result, AUTOSAVE_FAIL_ALERT);
    expect(p.setSaveWarn.mock.calls.length,
      "après un rétablissement puis une nouvelle panne, l'app est redevenue muette").toBe(2);
  }, 60000);

  it("un refus d'AUTHENTIFICATION n'est pas compté — il a déjà sa bannière", async () => {
    // Sans cette exclusion, un jeton expiré empilerait DEUX bannières ambre
    // disant la même chose à deux endroits de l'écran : la bannière « session
    // Drive expirée » en bas, celle-ci en haut. C'est exactement la classe que
    // `bannerStack.ts` existe pour fermer.
    driveSetup();
    (globalThis as any).fetch = driveFetch({
      error: { code: 403, errors: [{ reason: "insufficientPermissions" }],
        message: "Insufficient Permission" },
    });
    const p = props("gdrive");
    const { result } = renderHook(() => useGdriveSync(p as any));
    await runQuiet(result, AUTOSAVE_FAIL_ALERT + 2);
    expect(p.setSaveWarn.mock.calls.length,
      "un échec d'authentification a levé la bannière du refus répété").toBe(0);
    expect(readAutosaveFailures(false),
      "un échec d'authentification a été compté dans la série").toBe(0);
  }, 40000);

  it("un rejet réseau laisse une trace — avant, les trois .catch l'avalaient", async () => {
    // `fetch` REJETTE sur une coupure, un DNS mort ou le délai de garde, et
    // les catch terminaux ne faisaient que relâcher le verrou : pas même une
    // ligne de diagnostic.
    driveSetup();
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const p = props("gdrive");
    const { result } = renderHook(() => useGdriveSync(p as any));
    await runQuiet(result, 1);
    const d = readAutosaveDiag();
    expect(d && d.stage, "un auto-save qui n'atteint jamais le serveur ne laissait AUCUNE trace")
      .toBe("network-error");
    expect(readAutosaveFailures(false)).toBe(1);
  }, 30000);

  it("le message existe dans les six langues et ne rend pas sa clé", () => {
    for (const l of LANGUAGES) {
      const v = translate(l.code, "cloud_autosave_failing");
      expect(v, l.code + " n'a pas cloud_autosave_failing").not.toBe("cloud_autosave_failing");
      expect(String(v).length, l.code + " est vide").toBeGreaterThan(20);
    }
  });

  it("App.tsx CÂBLE setSaveWarn — la fonction sans son appelant ne parle à personne", async () => {
    // Source-level : le prop est optionnel, donc un oubli de câblage ne
    // casserait rien et rendrait juste le hook muet à nouveau. C'est la
    // moitié qui pourrit (`chooseAutoSaveTarget` avait sa suite et son appel
    // couvert par rien).
    const src = (await import("node:fs")).readFileSync("src/App.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const call = src.slice(src.indexOf("useGdriveSync({"));
    expect(call.slice(0, call.indexOf("});")),
      "useGdriveSync ne reçoit pas setSaveWarn").toMatch(/\bsetSaveWarn\b/);
  });
});
