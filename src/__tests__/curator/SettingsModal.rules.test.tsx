// Quatre règles de `src/views/curator/SettingsModal.tsx` que RIEN ne gardait.
//
// Chacune a été sondée par mutation, suite ENTIÈRE lancée à chaque fois
// (5 859 cas, 302 fichiers) : les quatre mutations sont passées au vert, au
// bruit de fond près (docChecks / docFiles, deux échecs préexistants sans
// rapport). Ce ne sont donc pas des trous de couverture de lignes — ce sont
// quatre contrôles dont la rupture ne coûte rien au CI et cher à
// l'utilisateur.
//
// Ce qui les rendait invisibles, et qui se répète : la logique métier de ces
// quatre chemins EST testée, ailleurs et bien (`cloudEncryptionWiring` pour le
// chiffrement, `useImportConfirm` pour la fusion). Ce qui n'était testé nulle
// part, c'est le CÂBLAGE de la vue vers cette logique — quel bouton appelle
// quoi, avec quel argument, et sous quelle condition. Un moteur juste derrière
// un fil croisé se comporte exactement comme un moteur cassé.
//
// Forme : trouver le contrôle est une PRÉ-CONDITION (`expect(...).toBeTruthy()`
// avant tout clic), jamais un `if`. Un contrôle disparu doit faire ÉCHOUER le
// cas, pas le faire passer à zéro assertion.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorSettingsModal } from "../../views/curator/SettingsModal";
import { LANG } from "../../i18n.ts";

// Résolveur FR réel : le `t` par défaut du harnais rend la CLÉ, donc
// « Fusionner » n'apparaîtrait jamais dans le DOM et toute assertion sur le
// libellé français serait vide de sens.
const trFr = (k: string) => (LANG.fr as any)[k] || k;

beforeEach(() => {
  try { localStorage.setItem("cave-settings-tab", "data"); } catch (_e) {}
});

function baseCtx(over: Record<string, any> = {}): Record<string, any> {
  return {
    importModal: true,
    t: trFr,
    settingsTab: "data",
    setSettingsTab: () => {},
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1 + 2. L'INTERRUPTEUR DE CHIFFREMENT DES SAUVEGARDES CLOUD
//
// Les deux sens de cet interrupteur portent chacun une garde, et aucune des
// deux n'était éprouvée.
//
// L'ÉTEINDRE coûte la confidentialité : `saveDriveEncryptionEnabled(false)`
// est derrière un `window.confirm` parce que les sauvegardes SUIVANTES
// partiront en clair chez le fournisseur cloud. Sondé en appelant
// `saveDriveEncryptionEnabled(false)` quelle que soit la réponse : suite
// verte. Un doigt qui frôle l'interrupteur déchiffre la cave sans que le
// refus serve à rien.
//
// L'ALLUMER coûte la SAUVEGARDE ELLE-MÊME, et c'est le plus cher des deux.
// `requestDrivePassphrase("setup")` peut être annulée (`pw === null`) ; le
// `if (!pw) return;` existe pour que « chiffrement actif » n'arrive jamais
// sans phrase. Sondé en retirant ce return : suite verte. L'état obtenu
// n'est pas cosmétique — `cloudEncryptionWiring.test.ts` mesure exactement
// ce qu'il produit : « chiffrement actif + phrase absente : l'auto-save ne
// monte RIEN ». Autrement dit un tap annulé arrête silencieusement toute
// sauvegarde cloud, sans message, jusqu'à ce que l'utilisateur pense à
// revenir dans Réglages.
// ─────────────────────────────────────────────────────────────────────────
describe("SettingsModal — l'interrupteur de chiffrement cloud", () => {
  function findToggle(container: HTMLElement): HTMLElement {
    const el = container.querySelector(`[aria-label="${trFr("enc_toggle_label")}"]`);
    expect(el, "l'interrupteur de chiffrement est introuvable dans l'onglet Données")
      .toBeTruthy();
    return el as HTMLElement;
  }

  let confirmSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => { if (confirmSpy) confirmSpy.mockRestore(); });

  it("l'ÉTEINDRE demande — et un refus laisse le chiffrement en place", () => {
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const ctx = baseCtx({
      driveEncryptionEnabled: true,
      drivePassphrase: "la-phrase",
      saveDriveEncryptionEnabled: vi.fn(),
      setDrivePassphrase: vi.fn(),
      requestDrivePassphrase: vi.fn(),
    });
    const { container } = renderWithCtx(<CuratorSettingsModal />, ctx);
    fireEvent.click(findToggle(container as HTMLElement));
    expect(confirmSpy.mock.calls.length,
      "déchiffrer les sauvegardes suivantes sans rien demander").toBeGreaterThan(0);
    expect(ctx.saveDriveEncryptionEnabled,
      "un refus doit tout laisser en place").not.toHaveBeenCalled();
  });

  it("… et l'éteint bien quand la réponse est oui", () => {
    // La moitié positive. Sans elle, débrancher complètement l'interrupteur
    // laisserait le cas ci-dessus vert : un contrôle mort passe le test du
    // refus, et l'utilisateur ne pourrait plus jamais désactiver.
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const ctx = baseCtx({
      driveEncryptionEnabled: true,
      drivePassphrase: "la-phrase",
      saveDriveEncryptionEnabled: vi.fn(),
      setDrivePassphrase: vi.fn(),
      requestDrivePassphrase: vi.fn(),
    });
    const { container } = renderWithCtx(<CuratorSettingsModal />, ctx);
    fireEvent.click(findToggle(container as HTMLElement));
    expect(ctx.saveDriveEncryptionEnabled).toHaveBeenCalledTimes(1);
    expect(ctx.saveDriveEncryptionEnabled).toHaveBeenCalledWith(false);
  });

  it("l'ALLUMER sans donner de phrase n'active RIEN", async () => {
    const ctx = baseCtx({
      driveEncryptionEnabled: false,
      drivePassphrase: null,
      saveDriveEncryptionEnabled: vi.fn(),
      setDrivePassphrase: vi.fn(),
      // L'invite annulée : l'utilisateur a touché l'interrupteur puis
      // renoncé.
      requestDrivePassphrase: vi.fn().mockResolvedValue(null),
    });
    const { container } = renderWithCtx(<CuratorSettingsModal />, ctx);
    fireEvent.click(findToggle(container as HTMLElement));
    await waitFor(() => expect(ctx.requestDrivePassphrase).toHaveBeenCalledTimes(1));
    expect(ctx.requestDrivePassphrase).toHaveBeenCalledWith("setup");
    // Les deux moitiés de l'état interdit. `saveDriveEncryptionEnabled(true)`
    // sans phrase, c'est l'auto-save qui ne monte plus rien ; et une phrase
    // `null` poussée en mémoire écraserait au passage une phrase déjà chargée.
    expect(ctx.saveDriveEncryptionEnabled,
      "chiffrement « actif » sans phrase = plus aucune sauvegarde cloud").not.toHaveBeenCalled();
    expect(ctx.setDrivePassphrase,
      "une invite annulée ne doit pas toucher la phrase en mémoire").not.toHaveBeenCalled();
  });

  it("… et l'active bien quand la phrase est donnée", async () => {
    // Le miroir : sans lui, un interrupteur qui n'active JAMAIS passerait le
    // cas ci-dessus, et personne ne pourrait plus chiffrer ses sauvegardes.
    const ctx = baseCtx({
      driveEncryptionEnabled: false,
      drivePassphrase: null,
      saveDriveEncryptionEnabled: vi.fn(),
      setDrivePassphrase: vi.fn(),
      requestDrivePassphrase: vi.fn().mockResolvedValue("ma-phrase-secrete"),
    });
    const { container } = renderWithCtx(<CuratorSettingsModal />, ctx);
    fireEvent.click(findToggle(container as HTMLElement));
    await waitFor(() => expect(ctx.saveDriveEncryptionEnabled).toHaveBeenCalledTimes(1));
    expect(ctx.saveDriveEncryptionEnabled).toHaveBeenCalledWith(true);
    expect(ctx.setDrivePassphrase).toHaveBeenCalledWith("ma-phrase-secrete");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3 + 4. LE PANNEAU D'IMPORT — les trois cartes et le sélecteur
//
// Ce panneau est la seule surface de l'app où l'utilisateur choisit
// explicitement d'ÉCRASER sa cave. `applyImport("replace")` efface les
// données locales ; `applyImport("merge")` n'efface rien. Un seul mot
// sépare les deux appels, ils sont à trente lignes l'un de l'autre dans le
// même fichier, et les deux cartes se ressemblent trait pour trait.
//
// Sondé en recâblant la carte « Fusionner » sur `applyImport("replace")` :
// suite ENTIÈRE verte. C'est la mutation la plus chère des quatre — la carte
// dont le texte promet « Rien n'est effacé » efface tout, et il n'y a ni
// confirmation ni corbeille derrière (la corbeille garde les suppressions
// une par une, pas un remplacement de la base entière).
//
// Sondé aussi en retirant `selectedSet` de l'appel du sélecteur : suite
// verte. L'utilisateur qui coche deux tabacs sur quatre-cents en reçoit
// quatre-cents, et il n'existe aucune annulation pour une fusion.
// ─────────────────────────────────────────────────────────────────────────
describe("SettingsModal — le panneau d'import", () => {
  const parsed = {
    tobaccos: [
      { id: "t1", brand: "Halvorsen", name: "Brackwater" },
      { id: "t2", brand: "R.T. Mallow", name: "Vondel" },
    ],
    pipes: [{ id: "p1", brand: "Østergaard", name: "Corvane" }],
    wishlist: [],
    accessories: [],
    sessions: [],
  };

  function renderPanel(over: Record<string, any> = {}) {
    const applyImport = vi.fn();
    const cancelImport = vi.fn();
    const r = renderWithCtx(<CuratorSettingsModal />, baseCtx({
      applyImport,
      cancelImport,
      importConfirm: {
        parsed,
        imgData: {},
        dupCounts: { tobaccos: 0, pipes: 0, wishlist: 0, accessories: 0 },
        incoming: { tobaccos: 2, pipes: 1, wishlist: 0, accessories: 0, sessions: 0 },
      },
      ...over,
    }));
    return { ...r, applyImport, cancelImport };
  }

  // Les trois cartes sont des `PressCard` : `role="button"` UNIQUEMENT tant
  // qu'elles portent un `onClick`. Une carte débranchée disparaît donc de
  // cette recherche — et le `expect(...).toBe(1)` la transforme en échec au
  // lieu d'un silence.
  function findCard(container: HTMLElement, label: string): HTMLElement {
    const hits = (Array.from(container.querySelectorAll("[role='button']")) as HTMLElement[])
      .filter((b) => (b.textContent || "").trim().startsWith(label));
    expect(hits.length, `la carte « ${label} » doit être présente et unique`).toBe(1);
    return hits[0]!;
  }

  it("« Fusionner » demande une FUSION — jamais un remplacement", () => {
    const { container, applyImport } = renderPanel();
    fireEvent.click(findCard(container as HTMLElement, trFr("import_merge")));
    expect(applyImport).toHaveBeenCalledTimes(1);
    // Le premier argument EST la règle. La carte annonce « Rien n'est
    // effacé » : un "replace" ici efface la cave entière sans confirmation.
    expect(applyImport.mock.calls[0]![0]).toBe("merge");
  });

  it("« Remplacer » demande bien un remplacement", () => {
    // Le miroir. Sans lui, câbler LES DEUX cartes sur "merge" passerait le
    // cas ci-dessus : la restauration propre depuis une sauvegarde ne
    // remplacerait plus rien et l'utilisateur récupérerait un mélange de son
    // ancienne cave et de la sauvegarde.
    const { container, applyImport } = renderPanel();
    fireEvent.click(findCard(container as HTMLElement, trFr("import_replace")));
    expect(applyImport).toHaveBeenCalledTimes(1);
    expect(applyImport.mock.calls[0]![0]).toBe("replace");
  });

  it("« Annuler » ne touche à rien", () => {
    // Troisième issue du même panneau : elle doit renoncer, pas importer.
    const { container, applyImport, cancelImport } = renderPanel();
    fireEvent.click(findCard(container as HTMLElement, trFr("btn_cancel")));
    expect(cancelImport).toHaveBeenCalledTimes(1);
    expect(applyImport, "renoncer ne doit RIEN importer").not.toHaveBeenCalled();
  });

  it("« Importer la sélection » transmet la SÉLECTION, pas le fichier entier", () => {
    const { container, applyImport } = renderPanel();
    // Passer au sélecteur.
    fireEvent.click(findCard(container as HTMLElement, trFr("import_select_items")));

    const rows = Array.from(
      (container as HTMLElement).querySelectorAll("[role='checkbox']"),
    ) as HTMLElement[];
    expect(rows.length, "le sélecteur doit lister les trois entités du fichier").toBe(3);

    const target = rows.find((r) =>
      (r.getAttribute("aria-label") || "").includes("Brackwater"));
    expect(target, "la ligne du tabac à cocher est introuvable").toBeTruthy();

    const confirmBtn = () => Array.from(
      (container as HTMLElement).querySelectorAll("button"),
    ).find((b) => (b.textContent || "").includes(trFr("import_action_selection")));

    // Avant toute coche : rien n'est sélectionné, donc le bouton doit être
    // inerte. S'il partait ici, il partirait avec un ensemble VIDE — et
    // `applyImport` traite l'absence de sélection comme « tout prendre ».
    const before = confirmBtn();
    expect(before, "le bouton de confirmation du sélecteur est introuvable").toBeTruthy();
    expect((before as HTMLButtonElement).disabled,
      "confirmer une sélection vide importerait tout le fichier").toBe(true);

    fireEvent.click(target as HTMLElement);

    const after = confirmBtn();
    expect(after, "le bouton de confirmation a disparu après la coche").toBeTruthy();
    expect((after as HTMLButtonElement).disabled,
      "une ligne cochée doit rendre la confirmation active").toBe(false);
    fireEvent.click(after as HTMLButtonElement);

    expect(applyImport).toHaveBeenCalledTimes(1);
    expect(applyImport.mock.calls[0]![0]).toBe("merge");
    // Le SECOND argument est toute la règle : sans lui, `applyImport` fusionne
    // l'intégralité du fichier. L'encodage "kind:id" est celui que
    // `useImportConfirm.applyImport` attend — un ensemble mal encodé ne
    // sélectionnerait rien, ce qui est l'autre moitié du même défaut.
    const sel = applyImport.mock.calls[0]![1];
    expect(sel, "la sélection doit être transmise").toBeInstanceOf(Set);
    expect(Array.from(sel as Set<string>)).toEqual(["tobacco:t1"]);
  });
});
