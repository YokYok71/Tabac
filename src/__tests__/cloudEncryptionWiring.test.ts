/**
 * LE CHIFFREMENT OPTIONNEL DES SAUVEGARDES CLOUD, AU NIVEAU DU CÂBLAGE.
 *
 * `cryptoBackup.test.ts` couvre le module PUR — `encryptBackup`,
 * `verifyPassphrase`, `makeEncryptionVerifier` — et il le couvre bien. Ce qui
 * n'était couvert par rien, c'est l'endroit où ces fonctions sont APPELÉES :
 * MESURÉ, le mot « encrypt » n'apparaissait pas une seule fois dans les 145 cas
 * de `useGdriveSync.test.ts`. C'est la forme que ce dépôt paie en boucle —
 * `chooseAutoSaveTarget`, `reDeductRestoredSessions`, `findParityGaps` : une
 * règle éprouvée là où elle est DÉFINIE et non gardée là où elle est APPELÉE.
 *
 * Ici la conséquence est la pire que cette application puisse produire. La
 * phrase secrète ne vit qu'en MÉMOIRE (jamais persistée, c'est délibéré), donc
 * elle est perdue à chaque rechargement ; la sauvegarde manuelle suivante la
 * redemande. Sans la vérification contre le témoin posé au moment de
 * l'activation, **une faute de frappe chiffre la sauvegarde sous une phrase que
 * l'utilisateur ne connaît pas** — définitivement illisible — et `markExported()`
 * part quand même, ce qui désarme pour 30 jours le rappel « vous n'avez pas
 * sauvegardé ». Sondé : neutraliser cette vérification laisse **5788 tests
 * verts**.
 *
 * CE QUI EST ÉPINGLÉ ICI EST LE CÂBLAGE, PAS LA CRYPTO. Les assertions portent
 * sur ce qui part sur le réseau (une enveloppe, du texte clair, ou rien), parce
 * que c'est la seule chose que l'utilisateur subit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGdriveSync } from "../hooks/useGdriveSync";
import { makeEncryptionVerifier, isEncryptedEnvelopeJSON } from "../utils/cryptoBackup";
import { INIT } from "../constants";

vi.mock("../utils/imgCache.ts", () => ({
  imgCache: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    open: vi.fn(),
  },
}));

const VERIFIER_KEY = "cave-drive-enc-verifier";

/** Ce qui part réellement sur le fil.
 *
 * MESURÉ plutôt que supposé : le corps d'un téléversement Drive est un
 * `FormData` dont la partie `file` est un Blob, PAS une chaîne. Une première
 * version filtrait sur `typeof body === "string"` et ne trouvait donc jamais
 * rien — six cas rouges qui accusaient le code alors que le tort était au
 * lecteur. Vider le DOM une fois coûte trente secondes et évite deux
 * corrections en aveugle. */
async function uploadedBodies(calls: Array<{ url: string; init: any }>): Promise<string[]> {
  const out: string[] = [];
  for (const c of calls) {
    if (!c.url.includes("upload")) continue;
    const b = c.init && c.init.body;
    if (!b) continue;
    if (typeof b === "string") { out.push(b); continue; }
    if (typeof b.get === "function") {
      const part = b.get("file");
      if (part && typeof part.text === "function") out.push(await part.text());
      else if (typeof part === "string") out.push(part);
    }
  }
  return out;
}

function makeProps(overrides: Record<string, any> = {}) {
  return {
    data: { ...INIT, tobaccos: [{ id: 1, name: "Halvorsen Foxtrot", brand: "Halvorsen", lots: [] }] },
    t: (k: string) => k,
    setImportModal: vi.fn(),
    pendingSync: false,
    setPendingSync: vi.fn(),
    excludeApiKey: true,
    apiKey: "",
    stageImport: vi.fn(),
    ...overrides,
  };
}

let calls: Array<{ url: string; init: any }>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  (globalThis as any).fetch = vi.fn().mockImplementation((url: any, init: any) => {
    calls.push({ url: String(url), init });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ files: [], id: "g1" }),
      text: () => Promise.resolve("{}"),
    });
  }) as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sauvegarde manuelle chiffrée — le câblage", () => {
  it("NON-VACUITÉ : sans chiffrement, ce qui part est du texte clair lisible", async () => {
    // Le cas de contrôle. Sans lui, tous les cas ci-dessous pourraient passer
    // parce que RIEN ne part jamais, et le fichier ne prouverait rien.
    const props = makeProps({ driveEncryptionEnabled: false });
    const { result } = renderHook(() => useGdriveSync(props as any));
    await act(async () => { result.current.gdriveSave("gtok"); });
    await waitFor(async () => expect((await uploadedBodies(calls)).length).toBeGreaterThan(0));
    const body = (await uploadedBodies(calls)).join("");
    expect(body).toContain("Halvorsen Foxtrot");
    expect(isEncryptedEnvelopeJSON(body.slice(body.indexOf("{")))).toBe(false);
  });

  it("chiffrement actif + phrase en mémoire : une ENVELOPPE part, jamais la cave en clair", async () => {
    const props = makeProps({
      driveEncryptionEnabled: true,
      drivePassphrase: "correcte-horse-battery",
      setDrivePassphrase: vi.fn(),
    });
    const { result } = renderHook(() => useGdriveSync(props as any));
    await act(async () => { result.current.gdriveSave("gtok"); });
    await waitFor(async () => expect((await uploadedBodies(calls)).length).toBeGreaterThan(0));
    const body = (await uploadedBodies(calls)).join("");
    // Ce qui compte pour l'utilisateur : le nom de son tabac n'est pas sur le fil.
    expect(body).not.toContain("Halvorsen Foxtrot");
    expect(body).toContain("_encrypted");
  });

  it("LE DÉFAUT : une phrase saisie qui NE correspond PAS au témoin est refusée, rien ne part", async () => {
    // La sonde qui a motivé ce fichier. Sans la vérification, cette sauvegarde
    // part chiffrée sous « faute-de-frappe » et n'est plus jamais lisible.
    const marker = await makeEncryptionVerifier("la-vraie-phrase");
    localStorage.setItem(VERIFIER_KEY, marker);
    const setDrivePassphrase = vi.fn();
    const props = makeProps({
      driveEncryptionEnabled: true,
      drivePassphrase: null,
      setDrivePassphrase,
      requestDrivePassphrase: vi.fn().mockResolvedValue("faute-de-frappe"),
    });
    const { result } = renderHook(() => useGdriveSync(props as any));
    await act(async () => { result.current.gdriveSave("gtok"); });
    // On attend le statut FINAL, pas « un statut ». `st_connecting` est posé
    // tôt et satisfait un `toBeTruthy()` — une première version s'arrêtait là
    // et lisait le message transitoire.
    await waitFor(() =>
      expect(String(result.current.gdriveStatus)).toContain("enc_err_wrong_passphrase"),
    );
    // RIEN n'est monté — ni en clair ni chiffré sous la mauvaise phrase.
    expect(await uploadedBodies(calls)).toEqual([]);
    // Et la mauvaise phrase n'est pas mise en cache : la retenir ferait
    // échouer aussi toutes les sauvegardes suivantes de la session.
    expect(setDrivePassphrase).not.toHaveBeenCalled();
  });

  it("une phrase saisie qui CORRESPOND au témoin passe, et elle est mise en cache", async () => {
    // Le contre-cas : une garde trop stricte qui refuserait tout serait
    // satisfaite par le cas précédent seul.
    const marker = await makeEncryptionVerifier("la-vraie-phrase");
    localStorage.setItem(VERIFIER_KEY, marker);
    const setDrivePassphrase = vi.fn();
    const props = makeProps({
      driveEncryptionEnabled: true,
      drivePassphrase: null,
      setDrivePassphrase,
      requestDrivePassphrase: vi.fn().mockResolvedValue("la-vraie-phrase"),
    });
    const { result } = renderHook(() => useGdriveSync(props as any));
    await act(async () => { result.current.gdriveSave("gtok"); });
    await waitFor(async () => expect((await uploadedBodies(calls)).length).toBeGreaterThan(0));
    expect((await uploadedBodies(calls)).join("")).toContain("_encrypted");
    expect(setDrivePassphrase).toHaveBeenCalledWith("la-vraie-phrase");
  });

  it("un utilisateur LEGACY sans témoin garde le comportement tolérant", async () => {
    // La moitié qui empêche de « durcir » la garde en verrouillant dehors les
    // installations antérieures au témoin : sans marqueur il n'y a rien à
    // comparer, et refuser par défaut les priverait de toute sauvegarde.
    expect(localStorage.getItem(VERIFIER_KEY)).toBeNull();
    const props = makeProps({
      driveEncryptionEnabled: true,
      drivePassphrase: null,
      setDrivePassphrase: vi.fn(),
      requestDrivePassphrase: vi.fn().mockResolvedValue("une-phrase-quelconque"),
    });
    const { result } = renderHook(() => useGdriveSync(props as any));
    await act(async () => { result.current.gdriveSave("gtok"); });
    await waitFor(async () => expect((await uploadedBodies(calls)).length).toBeGreaterThan(0));
    expect((await uploadedBodies(calls)).join("")).toContain("_encrypted");
  });

  it("une invite ANNULÉE ne monte rien", async () => {
    const props = makeProps({
      driveEncryptionEnabled: true,
      drivePassphrase: null,
      setDrivePassphrase: vi.fn(),
      requestDrivePassphrase: vi.fn().mockResolvedValue(null),
    });
    const { result } = renderHook(() => useGdriveSync(props as any));
    await act(async () => { result.current.gdriveSave("gtok"); });
    await waitFor(() => expect(result.current.gdriveStatus).toBeTruthy());
    expect(await uploadedBodies(calls)).toEqual([]);
  });
});

describe("sauvegarde AUTO chiffrée — jamais de fuite en clair", () => {
  /** L'auto-save lit son instantané dans `localStorage[SK]`, PAS dans la prop,
   *  et prend son jeton dans le cache — d'où ces deux amorces. */
  function amorcerAutoSave() {
    localStorage.setItem("cave-autosave", "1");
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "quiet-token", x: Date.now() + 3600000 }));
    localStorage.setItem(
      "pipe-cellar-v6",
      JSON.stringify({ ...INIT, tobaccos: [{ id: 1, name: "Halvorsen Foxtrot", brand: "Halvorsen", lots: [] }] }),
    );
  }

  /** LA MOITIÉ QUI REND L'ASSERTION NÉGATIVE NON CREUSE. `gdriveSaveQuiet`
   *  n'atteint le réseau qu'après `gatherLocalImages` ET
   *  `maybeEncryptPayloadQuiet`, soit plusieurs microtâches après l'appel : un
   *  `expect(...).toEqual([])` immédiat passerait avec la garde SUPPRIMÉE. Le
   *  fichier voisin a déjà payé exactement ça. C'est le cas POSITIF ci-dessous
   *  qui prouve que ce délai est suffisant — une assertion négative ne vaut que
   *  ce que vaut son contrôle positif. */
  async function laisserRetomber() {
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("chiffrement actif + phrase absente : l'auto-save ne monte RIEN", async () => {
    // La conséquence si ça cédait : la cave part en clair dans le cloud pendant
    // que l'utilisateur croit ses sauvegardes chiffrées, silencieusement et à
    // chaque modification.
    //
    // DEUX COUCHES ferment ce chemin, et ce n'est pas une lecture du code mais
    // une MESURE — trois sondes, dont deux VERTES, ce qui est précisément ce
    // qui l'établit :
    //   · retirer la sortie précoce de `gdriveSaveQuiet`
    //     (`driveEncryptionEnabled && !drivePassphrase`) seule → 8 verts ;
    //   · faire rendre le clair à `maybeEncryptQuiet` seule → 8 verts ;
    //   · retirer LES DEUX → ce cas rougit, la cave part en clair.
    // Une sonde verte n'est donc pas ici le signe d'un test creux : c'est la
    // couche absorbante qui se montre. Ce cas épingle le RÉSULTAT sur le fil,
    // donc il tient quelle que soit celle des deux qu'un remaniement supprime —
    // et il rougira le jour où quelqu'un les supprimera toutes les deux en
    // croyant en simplifier une.
    amorcerAutoSave();
    const props = makeProps({
      driveEncryptionEnabled: true,
      drivePassphrase: null,
      pendingSync: true,
    });
    const { result } = renderHook(() => useGdriveSync(props as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await laisserRetomber();
    expect(await uploadedBodies(calls)).toEqual([]);
    const tout = calls.map((c) => (c.init && c.init.body) || "").join("");
    expect(tout).not.toContain("Halvorsen Foxtrot");
  });

  it("chiffrement actif + phrase en mémoire : l'auto-save monte une enveloppe", async () => {
    // Le contre-cas de la précédente : sans lui, « ne monte rien » serait
    // satisfait par un auto-save qui ne fonctionne jamais.
    amorcerAutoSave();
    const props = makeProps({
      driveEncryptionEnabled: true,
      drivePassphrase: "correcte-horse-battery",
      pendingSync: true,
    });
    const { result } = renderHook(() => useGdriveSync(props as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await laisserRetomber();
    await waitFor(async () => expect((await uploadedBodies(calls)).length).toBeGreaterThan(0));
    const body = (await uploadedBodies(calls)).join("");
    expect(body).toContain("_encrypted");
    expect(body).not.toContain("Halvorsen Foxtrot");
  });
});
