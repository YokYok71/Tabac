// LES PETITS CORRECTIFS TARDIFS N'ONT PAS SUIVI JUSQU'À DROPBOX.
//
// Un audit du chemin Dropbox a trouvé que les mécanismes LOURDS avaient bien
// été portés — convergence par appareil, balayage, flux catalogue, cycle de vie
// du jeton de rafraîchissement, sérialisation des écritures : tout mesuré
// correct. Ce qui n'a pas suivi, ce sont trois corrections écrites en pensant à
// Drive, dont la bonne version est littéralement un fichier plus loin.
//
// C'est la forme la plus fréquente de ce dépôt : la règle est écrite deux fois,
// et la seconde copie ne reçoit pas le correctif.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dropboxProvider, gdriveProvider } from "../utils/cloudProvider.ts";
import { parseBackupCounts, backupDeviceName, autoFileDeviceId } from "../utils/gdriveApi.ts";
import {
  consumeListResume, BACKUP_DELETE_PENDING_KEY, CLOUD_CHECK_PENDING_KEY,
} from "../hooks/useGdriveSync.ts";

// ── D1 : `retries` était au CONTRAT et Dropbox l'ignorait ────────────────────
//
// `CloudProvider.list`'s `opts.retries` est documenté « Number of network
// retries (fetchRetry); 0 = single attempt ». Quatre appelants passent
// `retries: 2` — la sauvegarde manuelle, la liste de restauration, et les deux
// sens du flux catalogue. Sur Drive ils obtiennent `fetchRetry` ; sur Dropbox
// `dbxRpc` partait droit sur `fetchWithTimeout`, donc UNE micro-coupure réseau
// suffisait à faire échouer les quatre.
//
// Ce que les suites Dropbox existantes ne pouvaient pas voir : elles simulent
// des réponses HTTP REFUSÉES, jamais une REJECTION de `fetch`. Et `retries`
// étant optionnel, l'ignorer ne casse ni le typage ni le contrat structurel.
describe("le contrat `retries` de list vaut pour les deux fournisseurs", () => {
  function flaky(okBody: any, isDbx: boolean) {
    let n = 0;
    return vi.fn().mockImplementation(() => {
      n += 1;
      if (n === 1) return Promise.reject(new Error("net blip"));
      return Promise.resolve(isDbx
        ? { ok: true, status: 200, text: async () => JSON.stringify(okBody) }
        : { ok: true, status: 200, json: async () => okBody });
    });
  }

  it("Drive survit à une micro-coupure quand on lui demande deux essais", async () => {
    (globalThis as any).fetch = flaky({ files: [] }, false);
    const r = await gdriveProvider.list("tok", {
      fields: "files(id,name)", orderBy: "createdTime+desc", retries: 2,
    });
    await r.json();
    expect((globalThis as any).fetch.mock.calls.length).toBe(2);
  }, 20000);

  it("Dropbox aussi — une seule coupure ne doit pas perdre la sauvegarde", async () => {
    (globalThis as any).fetch = flaky({ entries: [] }, true);
    const r = await dropboxProvider.list("tok", {
      fields: "files(id,name)", orderBy: "createdTime+desc", retries: 2,
    });
    const body = await r.json();
    expect((globalThis as any).fetch.mock.calls.length,
      "dbxRpc part sur fetchWithTimeout : le contrat `retries` est ignoré").toBe(2);
    expect(body.files, "la liste n'a pas abouti après le réessai").toEqual([]);
  }, 20000);

  it("sans `retries`, aucun des deux ne réessaie — le défaut ne change pas", async () => {
    (globalThis as any).fetch = flaky({ entries: [] }, true);
    let threw = false;
    await dropboxProvider.list("tok", { fields: "f", orderBy: "createdTime+desc" })
      .catch(() => { threw = true; });
    expect(threw, "un appel sans réessai demandé a été réessayé quand même").toBe(true);
    expect((globalThis as any).fetch.mock.calls.length).toBe(1);
  }, 20000);
});

// ── D2 : les marqueurs one-shot du retour OAuth ──────────────────────────────
//
// `gdriveDeleteBackupById` écrit `cave-backup-delete-pending` puis demande
// `getCloudToken("list")` — et ce chemin est AVEUGLE AU FOURNISSEUR : sans
// jeton Dropbox il redirige comme Drive. Le dispatcher Google lit les trois
// marqueurs avant de router ; le dispatcher Dropbox faisait `if (ac === "list")
// runSyncDiagnostic()`, sans rien lire. Donc une suppression que l'utilisateur
// venait de confirmer disparaissait : le fichier restait dans le cloud, le
// panneau se réaffichait avec la ligne intacte, aucun message.
//
// La décision est maintenant UNE fonction pure que les deux dispatchers
// appellent, pour qu'un troisième fournisseur ne puisse pas rouvrir le trou.
describe("consumeListResume — quel bouton a lancé la redirection « list »", () => {
  beforeEach(() => { localStorage.clear(); });
  const NOW = 1_700_000_000_000;

  it("sans marqueur, on retombe sur le panneau des sauvegardes", () => {
    expect(consumeListResume(NOW)).toEqual({ kind: "diag" });
  });

  it("la SUPPRESSION est vérifiée en premier — c'est la seule qui mute", () => {
    localStorage.setItem(BACKUP_DELETE_PENDING_KEY, JSON.stringify({ id: "id:x", ts: NOW - 1000 }));
    localStorage.setItem(CLOUD_CHECK_PENDING_KEY, String(NOW - 1000));
    expect(consumeListResume(NOW)).toEqual({ kind: "delete", id: "id:x" });
  });

  it("chaque marqueur est LU avant d'être effacé, et consommé une seule fois", () => {
    localStorage.setItem(BACKUP_DELETE_PENDING_KEY, JSON.stringify({ id: "id:x", ts: NOW }));
    expect(consumeListResume(NOW)).toEqual({ kind: "delete", id: "id:x" });
    expect(localStorage.getItem(BACKUP_DELETE_PENDING_KEY)).toBeNull();
    expect(consumeListResume(NOW), "un marqueur consommé a rejoué").toEqual({ kind: "diag" });
  });

  it("un marqueur PÉRIMÉ n'agit pas — surtout celui qui supprime", () => {
    localStorage.setItem(BACKUP_DELETE_PENDING_KEY,
      JSON.stringify({ id: "id:x", ts: NOW - 10 * 60 * 1000 }));
    expect(consumeListResume(NOW)).toEqual({ kind: "diag" });
  });

  it("la vérification cloud passe avant le diagnostic", () => {
    localStorage.setItem(CLOUD_CHECK_PENDING_KEY, String(NOW - 500));
    expect(consumeListResume(NOW)).toEqual({ kind: "check" });
    localStorage.setItem("cave-sync-diag-pending", String(NOW - 500));
    expect(consumeListResume(NOW)).toEqual({ kind: "diag" });
  });

  it("survit à un marqueur forgé sans jeter", () => {
    for (const junk of ["", "nope", "{}", '{"id":""}', '{"id":123}', "[]", "null"]) {
      localStorage.setItem(BACKUP_DELETE_PENDING_KEY, junk);
      expect(() => consumeListResume(NOW), junk).not.toThrow();
      expect(consumeListResume(NOW).kind, junk).toBe("diag");
    }
  });

  it("les DEUX dispatchers consultent la décision partagée", async () => {
    // Ce qui pourrit n'est pas la fonction, c'est le nombre d'appelants : le
    // trou d'origine était UN dispatcher sur deux.
    const src = (await import("node:fs")).readFileSync("src/hooks/useGdriveSync.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    expect((src.match(/consumeListResume\(/g) || []).length,
      "un dispatcher route encore « list » sans lire les marqueurs").toBeGreaterThanOrEqual(3);
  });
});

// ── D6 : `autorename: true` et le suffixe « (1) » ────────────────────────────
//
// Dropbox ne fait pas de vrai PATCH : `dbxUpload` envoie `autorename: true`
// pour survivre à une collision de nom à la même seconde (un double-tap sur
// « Sauvegarder »). Le fichier arrive alors en `… (1).json` — et les deux regex
// ancrent `\.json$` juste après le groupe compteurs/slug, donc elles ne
// reconnaissent plus rien.
//
// Conséquence : la sauvegarde que le double-tap vient de créer — le cas exact
// pour lequel `autorename` a été activé — s'affiche dans le sélecteur SANS sa
// ligne « t12 · p3 · j40 » et sans nom d'appareil dans le panneau de synchro.
describe("un nom renommé par Dropbox reste lisible", () => {
  const BASE = "cave-tabac-20260825-101112-t12-p3-w2-a1-j40-iphone";

  it("les compteurs survivent au suffixe", () => {
    const want = { tobaccos: 12, pipes: 3, wishlist: 2, accessories: 1, sessions: 40 };
    expect(parseBackupCounts(BASE + ".json")).toEqual(want);
    expect(parseBackupCounts(BASE + " (1).json"),
      "le sélecteur perd les compteurs de la sauvegarde qu'autorename vient de créer")
      .toEqual(want);
    expect(parseBackupCounts(BASE + " (12).json")).toEqual(want);
  });

  it("le nom d'appareil survit au suffixe", () => {
    expect(backupDeviceName(BASE + ".json")).toBe("iphone");
    expect(backupDeviceName(BASE + " (1).json")).toBe("iphone");
  });

  it("un fichier auto renommé garde son identité d'appareil", () => {
    // Sinon il devient « legacy » et un AUTRE appareil peut le balayer.
    const auto = "cave-tabac-auto-8udtad73xz-20260825-101112-t1-p0-w0-a0-j0";
    expect(autoFileDeviceId(auto + ".json")).toBe("8udtad73xz");
    expect(autoFileDeviceId(auto + " (1).json")).toBe("8udtad73xz");
  });

  it("la tolérance reste ÉTROITE — pas n'importe quoi entre les compteurs et .json", () => {
    // Une tolérance large ferait passer un nom forgé pour une sauvegarde.
    expect(parseBackupCounts(BASE + "-autre.json"),
      "un second slug a été avalé").toBeNull();
    expect(parseBackupCounts(BASE + " (a).json")).toBeNull();
    expect(parseBackupCounts(BASE + " ().json")).toBeNull();
    expect(parseBackupCounts(BASE + ".json.bak")).toBeNull();
    expect(backupDeviceName(BASE + " (a).json")).toBe("");
  });
});
