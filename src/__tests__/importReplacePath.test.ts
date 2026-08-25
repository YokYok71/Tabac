// LE CHEMIN QUI EFFACE LA CAVE.
//
// Le MERGE est ce qu'il y a de mieux couvert dans ce dépôt — un test de
// propriété multi-appareils, six propriétés, 120 ordonnancements — parce qu'il
// a été réparé sept fois. Le REPLACE, lui, a bien moins d'attention, et c'est
// la branche qui EFFACE : elle jette la cave locale, adopte les préférences du
// fichier, réécrit la clé d'API, et relance l'application.
//
// L'asymétrie est facile à expliquer et mauvaise à garder : un merge peut se
// tromper de mille manières subtiles, donc il attire les tests ; un replace ne
// peut se tromper que d'une manière, mais elle est totale.
//
// Ce fichier épingle ce qui distingue le replace du merge, et rien d'autre —
// les règles de fusion ont leurs propres suites.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImportConfirm } from "../hooks/useImportConfirm.ts";
import { migrateData } from "../utils.ts";
import { translate } from "../i18n.ts";

const t = (k: string) => translate("fr", k);

function cellar(over: any = {}) {
  return Object.assign({
    tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [],
    nxT: 1, nxP: 1, nxA: 1, nxJ: 1, nxW: 1,
  }, over);
}

const TOB = (id: number, name: string) => ({
  id, name, brand: "Halvorsen", category: "Virginia", cut: "Flake",
  lots: [], force: 0, roomNote: 0, taste: 0, rating: 0, rebuy: null,
  tastingNotes: "", description: "", imageUrl: "", agingMax: "",
});

function mk(over: any = {}) {
  const save = vi.fn();
  const props = Object.assign({
    data: cellar({ tobaccos: [TOB(1, "Ma fiche locale")] }),
    save, t, lang: "fr", migrateData, nav: vi.fn(),
    setSaveError: vi.fn(), setSaveWarn: vi.fn(),
    setImportRecap: vi.fn(), setImportModal: vi.fn(),
    imgLocal: {}, setImgLocal: vi.fn(), setPhotoErr: vi.fn(),
    saveApiKey: vi.fn(), markExported: vi.fn(),
  }, over);
  const { result } = renderHook(() => useImportConfirm(props as any));
  return { result, props, save };
}

const BACKUP = (over: any = {}) => Object.assign({
  tobaccos: [TOB(9, "Fiche du fichier")],
  pipes: [], accessories: [], sessions: [], wishlist: [],
}, over);

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("un REPLACE remplace vraiment, et rien de plus", () => {
  it("la cave locale disparaît, celle du fichier prend sa place", async () => {
    const { result, save } = mk();
    await act(async () => {
      (result.current as any).stageImport(BACKUP(), "file", { autoApply: "replace" });
    });
    const next = save.mock.calls[0]![0];
    expect(next.tobaccos.length, "le replace a fusionné au lieu de remplacer").toBe(1);
    expect(next.tobaccos[0].name).toBe("Fiche du fichier");
  });

  it("les COMPTEURS sont reconstruits au-dessus des ids du fichier", async () => {
    // Sinon le prochain ajout réutilise un id vivant — la classe que
    // `bumpCounterPastMaxId` existe pour fermer, et le replace est le chemin
    // où les ids viennent entièrement d'ailleurs.
    const { result, save } = mk();
    await act(async () => {
      (result.current as any).stageImport(
        BACKUP({ tobaccos: [TOB(9, "a"), TOB(40, "b")] }), "file", { autoApply: "replace" });
    });
    const next = save.mock.calls[0]![0];
    expect(next.nxT, "le compteur peut réémettre un id déjà pris").toBeGreaterThan(40);
  });

  it("un fichier VIDE sur une cave PLEINE est refusé", async () => {
    // La garde qui existe parce qu'un fichier forgé aux tableaux vides
    // effaçait la cave sans un mot. Le sélecteur affiche les compteurs, donc
    // un humain voit « 0 tabacs » ; `autoApply` n'a personne dans la boucle.
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { result, save } = mk();
    await act(async () => {
      (result.current as any).stageImport(
        { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
        "file", { autoApply: "replace" });
    });
    expect(save, "un fichier vide a effacé une cave pleine").not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
  });

  it("le refus couvre une cave dont la SEULE donnée est une envie", async () => {
    // Compter uniquement tabacs/pipes/séances laissait un utilisateur dont
    // tout le contenu est envies + accessoires se faire effacer en silence.
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { result, save } = mk({
      data: cellar({ wishlist: [{ id: 1, name: "une envie", brand: "H" }] }),
    });
    await act(async () => {
      (result.current as any).stageImport(
        { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
        "file", { autoApply: "replace" });
    });
    expect(save, "une cave d'envies a été effacée par un fichier vide").not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
  });

  it("un fichier vide sur une cave VIDE passe — il n'y a rien à perdre", async () => {
    const { result, save } = mk({ data: cellar() });
    await act(async () => {
      (result.current as any).stageImport(
        { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
        "file", { autoApply: "replace" });
    });
    expect(save, "la garde est devenue un refus général").toHaveBeenCalled();
  });

  it("un fichier qui n'est pas une sauvegarde est REFUSÉ, et il le dit", async () => {
    // `stageImport` retournait en silence sur un `isPlausibleBackup` faux : un
    // corps `{error}` de Drive fermait le sélecteur et ne faisait rien —
    // indiscernable d'un import réussi.
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { result, save } = mk();
    await act(async () => {
      (result.current as any).stageImport({ error: "quota" }, "drive", { autoApply: "replace" });
    });
    expect(save).not.toHaveBeenCalled();
    expect(alert, "un fichier invalide est refusé sans rien dire").toHaveBeenCalled();
  });
});

describe("ce que le REPLACE adopte, et ce qu'un MERGE refuse d'adopter", () => {
  const SETTINGS = { "cave-lang": "de", "cave-weight-unit": "oz" };

  it("REPLACE adopte les préférences du fichier", async () => {
    const { result } = mk();
    await act(async () => {
      (result.current as any).stageImport(
        BACKUP({ _settings: SETTINGS }), "file", { autoApply: "replace" });
    });
    expect(localStorage.getItem("cave-lang"),
      "un replace doit rendre cet appareil semblable à la sauvegarde").toBe("de");
    expect(localStorage.getItem("cave-weight-unit")).toBe("oz");
  });

  it("MERGE ne les adopte PAS — combiner deux caves n'est pas une raison " +
     "d'hériter de la langue de l'autre appareil", async () => {
    const { result } = mk();
    await act(async () => {
      (result.current as any).stageImport(
        BACKUP({ _settings: SETTINGS }), "file", { autoApply: "merge" });
    });
    expect(localStorage.getItem("cave-lang"),
      "un merge a changé la langue de l'appareil").toBeNull();
    expect(localStorage.getItem("cave-weight-unit")).toBeNull();
  });

  it("le bloc de préférences ne se retrouve JAMAIS dans la cave enregistrée", async () => {
    // Sinon `_settings` deviendrait un champ fantôme sur les données, réécrit
    // à chaque sauvegarde et réexporté.
    const { result, save } = mk();
    await act(async () => {
      (result.current as any).stageImport(
        BACKUP({ _settings: SETTINGS, _apiKey: "sk-x", _schemaVersion: "v6" }),
        "file", { autoApply: "replace" });
    });
    const next = save.mock.calls[0]![0];
    for (const k of ["_settings", "_apiKey", "_apiKeyProvider", "_schemaVersion", "_imageData", "_savedAt", "_saveType"]) {
      expect(Object.prototype.hasOwnProperty.call(next, k),
        k + " a été enregistré comme champ de la cave").toBe(false);
    }
  });

  it("une préférence FORGÉE est rejetée par l'allowlist", async () => {
    // `sanitizeSettings` valide la clé ET la valeur : `cave-font-scale` part
    // droit dans une variable CSS, donc une valeur inventée rendrait l'app
    // inutilisable.
    const { result } = mk();
    await act(async () => {
      (result.current as any).stageImport(
        BACKUP({ _settings: { "cave-font-scale": "999", "gdrive-tk": "volé", "cave-weight-unit": "kg" } }),
        "file", { autoApply: "replace" });
    });
    expect(localStorage.getItem("cave-font-scale"),
      "une échelle de police inventée a été écrite").not.toBe("999");
    expect(localStorage.getItem("gdrive-tk"),
      "un jeton a voyagé dans le bloc de préférences").toBeNull();
    expect(localStorage.getItem("cave-weight-unit"),
      "une unité hors de l'ensemble fermé a été acceptée").not.toBe("kg");
  });
});

describe("la clé d'API n'est écrite que sur un REPLACE", () => {
  // La règle a été tranchée par l'utilisateur : un MERGE est précisément
  // comment on accepte le fichier de QUELQU'UN D'AUTRE, et sa clé deviendrait
  // la vôtre — appels facturés sur son compte, votre clé écrasée sans recours.
  const KEY = "sk-ant-api03-" + "z".repeat(80);

  it("REPLACE : la clé du fichier est adoptée", async () => {
    const saveApiKey = vi.fn();
    const { result } = mk({ saveApiKey });
    await act(async () => {
      (result.current as any).stageImport(
        BACKUP({ _apiKey: KEY, _apiKeyProvider: "anthropic" }), "file", { autoApply: "replace" });
    });
    expect(saveApiKey).toHaveBeenCalled();
    expect(String(saveApiKey.mock.calls[0]![0])).toBe(KEY);
  });

  it("MERGE : elle ne l'est PAS", async () => {
    const saveApiKey = vi.fn();
    const { result } = mk({ saveApiKey });
    await act(async () => {
      (result.current as any).stageImport(
        BACKUP({ _apiKey: KEY, _apiKeyProvider: "anthropic" }), "file", { autoApply: "merge" });
    });
    expect(saveApiKey,
      "accepter le fichier de quelqu'un d'autre a redirigé vos appels IA vers son compte")
      .not.toHaveBeenCalled();
  });
});

describe("le REPLACE survit à un fichier hostile sans emporter l'app", () => {
  it("un élément PRIMITIF dans une collection ne fait pas jeter migrateData", async () => {
    // Le chemin `autoApply` n'a aucune garde autour de `migrateData`, donc un
    // jet ici tuait le tap sans rien afficher. `pipes` est la collection qui
    // jetait réellement.
    const { result, save } = mk();
    await act(async () => {
      (result.current as any).stageImport(
        BACKUP({ pipes: [5, "x", null, { id: 2, name: "vraie pipe", maintenance: [] }] }),
        "file", { autoApply: "replace" });
    });
    expect(save, "un fichier avec une ligne primitive a tué l'import en silence").toHaveBeenCalled();
    const next = save.mock.calls[0]![0];
    expect(next.pipes.length, "les lignes primitives n'ont pas été écartées").toBe(1);
    expect(next.pipes[0].name).toBe("vraie pipe");
  });

  it("un imageUrl forgé est blanchi avant d'atteindre le rendu", async () => {
    const { result, save } = mk();
    await act(async () => {
      (result.current as any).stageImport(
        BACKUP({ tobaccos: [Object.assign(TOB(9, "a"), { imageUrl: "__proto__" }),
                            Object.assign(TOB(10, "b"), { imageUrl: "//evil.test/x.png" })] }),
        "file", { autoApply: "replace" });
    });
    const next = save.mock.calls[0]![0];
    for (const tb of next.tobaccos) {
      expect(tb.imageUrl, "une référence d'image étrangère a survécu à l'import").toBe("");
    }
  });

  it("des compteurs non numériques sont ramenés à un entier ≥ 1", async () => {
    const { result, save } = mk();
    await act(async () => {
      (result.current as any).stageImport(
        BACKUP({ nxT: "abc", nxP: -5, nxJ: null } as any), "file", { autoApply: "replace" });
    });
    const next = save.mock.calls[0]![0];
    for (const k of ["nxT", "nxP", "nxA", "nxJ", "nxW"]) {
      expect(Number.isInteger(next[k]), k + " n'est pas un entier").toBe(true);
      expect(next[k], k).toBeGreaterThanOrEqual(1);
    }
  });
});
