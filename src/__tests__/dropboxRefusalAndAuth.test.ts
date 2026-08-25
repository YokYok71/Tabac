// LES TROIS DÉFAUTS DROPBOX LAISSÉS OUVERTS PAR L'AUDIT.
//
// Chacun avait été consigné plutôt que corrigé, pour une raison différente :
// le premier demandait une preuve externe, les deux autres demandaient de
// décider ce qu'on affiche et où l'on envoie l'utilisateur.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { cloudRefusalKind, isAuthRefusal } from "../utils/gdriveApi.ts";
import { LANGUAGES } from "../i18n/languages.ts";
import { translate } from "../i18n.ts";

// ── (1) UN DROPBOX PLEIN ARRIVE EN 409, PAS EN 507 ───────────────────────────
//
// Le code reconnaissait `insufficient_space` sous HTTP 507 — une supposition :
// la CHAÎNE vient de l'API réelle, le STATUT avait été deviné. L'API v2
// documente que **toute** erreur spécifique à un point d'accès rend **409**, et
// le billet d'ingénierie de Dropbox explique pourquoi : 409 n'a pas de sens
// défini dans la spec HTTP, donc les intermédiaires (proxies, bibliothèques
// clientes) le relaient intact.
//
// Conséquence de l'erreur : sous 409 l'écran affichait la prose anglaise brute
// du fournisseur au lieu du remède traduit — sur le seul refus où le remède
// (libérer de la place) est précisément ce qu'il faut dire.
//
// LE MARQUEUR PORTE LA DÉCISION, PAS LE STATUT : 409 est aussi le statut de
// `path/conflict`, `path/not_found` et de tout le reste, donc un 409 sans
// marqueur reconnu doit rester `other`.
describe("Dropbox : le statut ne dit rien, le marqueur dit tout", () => {
  it("plus de place, sous le statut que l'API v2 rend vraiment", () => {
    expect(cloudRefusalKind({ code: 409, message: "Dropbox: path/insufficient_space/..." }))
      .toBe("quota");
    // La forme `path/reason/insufficient_space` existe aussi selon le point
    // d'accès — le marqueur est cherché n'importe où dans le message.
    expect(cloudRefusalKind({ code: 409, message: "Dropbox: path/reason/insufficient_space/.." }))
      .toBe("quota");
  });

  it("507 reste accepté — le marqueur décide, pas le statut", () => {
    // Retirer 507 serait un changement de comportement sur un cas que je ne
    // peux pas tester contre l'API vivante. Le garder ne coûte rien : un
    // `error_summary` qui dit `insufficient_space` dit exactement cela.
    expect(cloudRefusalKind({ code: 507, message: "Dropbox: path/insufficient_space/..." }))
      .toBe("quota");
  });

  it("écriture trop fréquente sous 409 AUSSI — le dépôt le savait déjà", () => {
    // `dropboxProvider.remove` porte le commentaire : « Dropbox peut brièvement
    // rendre 429 (`too_many_write_operations`) ou 409 (…sous le tag
    // lock_conflict) ». Le classifieur ne voyait que le 429.
    expect(cloudRefusalKind({ code: 429, message: "Dropbox: too_many_write_operations/..." }))
      .toBe("rate");
    expect(cloudRefusalKind({ code: 409, message: "Dropbox: ...too_many_write_operations..." }))
      .toBe("rate");
  });

  it("un 409 SANS marqueur reconnu reste « other » — 409 est le statut de tout", () => {
    // C'est la garde qui rend l'élargissement sûr : `path/conflict` est un 409
    // et n'a rien à voir avec un disque plein.
    expect(cloudRefusalKind({ code: 409, message: "Dropbox: path/conflict/file/..." })).toBe("other");
    expect(cloudRefusalKind({ code: 409, message: "Dropbox: path/not_found/..." })).toBe("other");
    expect(cloudRefusalKind({ code: 409, message: "Dropbox: path/disallowed_name/..." })).toBe("other");
    expect(isAuthRefusal({ code: 409, message: "Dropbox: path/conflict/..." }),
      "un conflit de nom ferait jeter le jeton").toBe(false);
  });

  it("le code prime toujours sur un message qui MENTIONNE un mot-clé", () => {
    expect(cloudRefusalKind({ code: 401, message: "Dropbox: insufficient_space" })).toBe("auth");
    expect(cloudRefusalKind({ code: 500, message: "too_many_write_operations" })).toBe("other");
  });
});

// ── (2) UNE COUPURE RÉSEAU N'EST PAS « RECONNECTEZ-VOUS » ────────────────────
//
// `getToken` redirigeait vers dropbox.com sur N'IMPORTE QUEL rejet de
// `getTokenSilent` — or celui-ci rejette pour trois raisons indiscernables à
// cet endroit : pas de jeton de rafraîchissement (redirection légitime), grant
// révoqué (légitime), ou **l'appel réseau a échoué**. Dans le troisième cas
// l'application quitte son origine ; hors ligne, dropbox.com échoue aussi, et
// sur une PWA installée il faut fermer et rouvrir.
//
// L'asymétrie n'était pas justifiée : `gdriveGetToken` ne fait AUCUN appel
// réseau avant de décider de rediriger, donc une panne passagère ne peut pas
// y déclencher une redirection.
describe("le refresh grant Dropbox ne quitte pas l'app sur une panne réseau", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules(); });

  async function drive(fetchImpl: any) {
    const { renderHook } = await import("@testing-library/react");
    const { useDropboxAuth } = await import("../hooks/useDropboxAuth.ts");
    (globalThis as any).fetch = fetchImpl;
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: Object.assign({}, orig, { assign, origin: "https://x.test", search: "", pathname: "/", hash: "" }),
    });
    const { result } = renderHook(() => useDropboxAuth({ t: (k: string) => translate("fr", k) } as any));
    return { result, assign, restore: () => Object.defineProperty(window, "location", { configurable: true, value: orig }) };
  }

  it("panne réseau : on RESTE dans l'app et on dit pourquoi", async () => {
    localStorage.setItem("dropbox-rt", "rt-value");
    const d = await drive(vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    let msg = "";
    await (d.result.current as any).getToken("save").catch((e: any) => { msg = String(e && e.message); });
    expect(d.assign.mock.calls.length,
      "une coupure réseau a éjecté l'utilisateur hors de la PWA vers dropbox.com").toBe(0);
    expect(localStorage.getItem("dropbox-rt"),
      "le jeton de rafraîchissement a été jeté pour une panne passagère").toBe("rt-value");
    expect(msg, "le message est vide ou brut : « " + msg + " »")
      .toBe(translate("fr", "err_cloud_unreachable"));
    d.restore();
  }, 30000);

  it("pas de grant du tout : la redirection reste la bonne réponse", async () => {
    const d = await drive(vi.fn());
    (d.result.current as any).getToken("save");
    await new Promise((r) => setTimeout(r, 50));
    expect(d.assign.mock.calls.length,
      "sans jeton de rafraîchissement il FAUT rediriger — sinon le bouton est mort").toBe(1);
    expect(String(d.assign.mock.calls[0]![0])).toContain("dropbox.com/oauth2/authorize");
    d.restore();
  }, 30000);

  it("grant révoqué : redirection aussi, et le jeton mort est effacé", async () => {
    localStorage.setItem("dropbox-rt", "rt-value");
    const d = await drive(vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: "invalid_grant" }),
      text: async () => JSON.stringify({ error: "invalid_grant" }),
    }));
    (d.result.current as any).getToken("save");
    await new Promise((r) => setTimeout(r, 80));
    expect(d.assign.mock.calls.length).toBe(1);
    expect(localStorage.getItem("dropbox-rt"),
      "un grant révoqué doit être effacé, sinon on martèle un jeton mort").toBeNull();
    d.restore();
  }, 30000);

  it("le message existe dans les six langues", () => {
    for (const l of LANGUAGES) {
      const v = translate(l.code, "err_cloud_unreachable");
      expect(v, l.code).not.toBe("err_cloud_unreachable");
      expect(String(v).length, l.code).toBeGreaterThan(15);
    }
  });
});

// ── (3) « SESSION DRIVE EXPIRÉE » CHEZ UN UTILISATEUR DROPBOX ────────────────
//
// Quatre sites jettent `err_drive_expired`, et les quatre sont atteignables
// sur Dropbox — donc le message nommait le mauvais service, dans les six
// langues. Invisible à la parité i18n (la clé existe et est traduite) comme
// aux contrats d'étiquettes.
describe("le message d'expiration nomme le service actif", () => {
  it("les deux clés existent dans les six langues et se distinguent", () => {
    for (const l of LANGUAGES) {
      const drive = translate(l.code, "err_drive_expired");
      const dbx = translate(l.code, "err_dropbox_expired");
      expect(dbx, l.code + " n'a pas err_dropbox_expired").not.toBe("err_dropbox_expired");
      expect(dbx, l.code + " : les deux messages sont identiques").not.toBe(drive);
      expect(String(dbx).toLowerCase(), l.code + " : le message Dropbox parle de Drive")
        .not.toMatch(/\bdrive\b/);
      expect(String(drive).toLowerCase(), l.code + " : le message Drive ne nomme plus Drive")
        .toMatch(/drive/);
    }
  });

  it("aucun site ne jette err_drive_expired en dur — un helper choisit", async () => {
    // Ce qui pourrit est le nombre de sites : quatre copies, dont aucune ne
    // regardait le fournisseur. Le helper est la seule façon d'empêcher un
    // cinquième de repartir sur la mauvaise clé.
    const src = (await import("node:fs")).readFileSync("src/hooks/useGdriveSync.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    expect(src.match(/t\("err_drive_expired"\)/g),
      "un site nomme encore Drive sans regarder le fournisseur actif").toBeNull();
    expect((src.match(/cloudExpiredMessage\(\)/g) || []).length,
      "les quatre sites ne passent pas par le helper").toBeGreaterThanOrEqual(4);
  });

  it("les deux boutons du panneau cloud escaladent sur Dropbox", async () => {
    // Là où Drive escalade vers une authentification interactive, Dropbox
    // s'arrêtait à `getTokenSilent` : les deux boutons devenaient des
    // culs-de-sac, avec un message nommant le mauvais service pour seule
    // réponse. L'escalade n'est possible sans danger que depuis que le
    // dispatcher lit les marqueurs (build 55) ET qu'une panne réseau ne
    // redirige plus (bloc 2 ci-dessus).
    const src = (await import("node:fs")).readFileSync("src/hooks/useGdriveSync.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    expect((src.match(/dbx\.getToken\("list"\)/g) || []).length,
      "les deux boutons n'escaladent pas").toBeGreaterThanOrEqual(2);
    // ET l'autre moitié de la règle, qui est ce que ma première assertion
    // — trop large — aurait cassé : la vérification AU LANCEMENT ne doit
    // JAMAIS escalader. Elle part au montage, et la branche Drive s'arrête
    // là pour cette raison même (« no popups from mount »). Un troisième
    // `getToken("list")` qui apparaîtrait dans ce bloc ferait surgir une
    // redirection OAuth pendant l'ouverture de l'app.
    const launch = src.slice(src.indexOf("not-engaged"), src.indexOf("no-drive-token"));
    expect(launch.length, "le bloc de la vérification au lancement est introuvable")
      .toBeGreaterThan(50);
    expect(launch, "la vérification au lancement escalade — elle redirigerait au montage")
      .not.toMatch(/getToken\(/);
  });
});
