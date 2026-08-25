// LES QUATRE MODULES QU'AUCUN TEST N'IMPORTAIT.
//
// Mesuré plutôt qu'estimé : sur ~140 modules de production, quatre n'étaient
// importés par AUCUN fichier de test — `EncryptionPromptModal`,
// `StartupNoticeModal`, `DbSyncDiff` et `platform`. C'est une surface petite,
// et c'est la bonne nouvelle ; ce qui compte est LEQUEL.
//
// `EncryptionPromptModal` garde la phrase de passe des sauvegardes cloud
// chiffrées. Le dépôt le dit dans ses propres termes : « phrase de passe
// oubliée = sauvegardes perdues. Il n'y a aucune récupération. » Les deux
// gardes qui protègent l'utilisateur de cette perte — la longueur minimale et
// la CONFIRMATION à la création — n'étaient vérifiées par rien.
//
// `platform.ts` n'est pas couvert ici : ce sont deux constantes calculées au
// chargement du module à partir du user-agent, donc les tester demanderait de
// réécrire `navigator` avant l'import, et ce que cela vérifierait est la
// capacité de vitest à recharger un module — pas une règle de l'application.
// L'asymétrie iOS/Android qu'elles portent est déjà épinglée ailleurs
// (`iosPwaDockGuard`, la note de parité). Absence assumée, pas oubli.

import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { AppCtx } from "../../AppContext.tsx";
import { CuratorEncryptionPromptModal } from "../../views/curator/EncryptionPromptModal.tsx";
import { DbSyncDiff } from "../../components/curator/DbSyncDiff.tsx";
import { CATS_EN, CUTS_EN } from "../../constants.ts";
import { translate } from "../../i18n.ts";

const t = (k: string) => translate("fr", k);

function withCtx(node: React.ReactNode, value: any) {
  return render(
    React.createElement(AppCtx.Provider, { value: value as any }, node),
  );
}

// ── La phrase de passe ───────────────────────────────────────────────────────
describe("le prompt de chiffrement protège d'une perte sans recours", () => {
  let resolved: any;
  const ctx = (mode: "setup" | "unlock") => ({
    encryptionPrompt: { mode },
    resolveEncryptionPrompt: (v: any) => { resolved = v; },
    t,
  });

  beforeEach(() => { resolved = undefined; });

  function fields(c: HTMLElement) {
    return Array.from(c.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
  }
  // Sélection par la VALEUR du dictionnaire, jamais par un mot deviné : ma
  // première version cherchait « débloquer » là où la clé dit
  // « Déverrouiller », donc le bouton était introuvable en mode unlock — la
  // leçon que ce dépôt consigne pour les libellés cités.
  function byText(c: HTMLElement, txt: string) {
    return Array.from(c.querySelectorAll("[role='button'], button"))
      .find((e) => (e.textContent || "").trim() === txt) as HTMLElement | undefined;
  }
  function submitBtn(c: HTMLElement, mode: "setup" | "unlock") {
    return byText(c, t(mode === "setup" ? "enc_btn_enable" : "enc_btn_unlock"));
  }
  function cancelBtn(c: HTMLElement) {
    return byText(c, t("btn_cancel"));
  }

  it("mode CRÉATION : deux champs, mode DÉBLOCAGE : un seul", () => {
    const a = withCtx(React.createElement(CuratorEncryptionPromptModal), ctx("setup"));
    expect(fields(a.container).length,
      "la confirmation a disparu — une faute de frappe scellerait les sauvegardes").toBe(2);
    a.unmount();
    const b = withCtx(React.createElement(CuratorEncryptionPromptModal), ctx("unlock"));
    expect(fields(b.container).length,
      "le mode déblocage redemande une confirmation qu'il n'a aucun moyen de vérifier").toBe(1);
  });

  it("une phrase trop courte est REFUSÉE et le message le dit", () => {
    const { container } = withCtx(React.createElement(CuratorEncryptionPromptModal), ctx("setup"));
    const [pw, cf] = fields(container);
    fireEvent.change(pw!, { target: { value: "court" } });
    fireEvent.change(cf!, { target: { value: "court" } });
    fireEvent.click(submitBtn(container, "setup")!);
    expect(resolved, "une phrase de 5 caractères a été acceptée").toBeUndefined();
    expect(container.textContent).toContain(t("enc_err_short_prefix").trim());
  });

  it("deux saisies qui diffèrent sont REFUSÉES — c'est toute la raison du second champ", () => {
    const { container } = withCtx(React.createElement(CuratorEncryptionPromptModal), ctx("setup"));
    const [pw, cf] = fields(container);
    fireEvent.change(pw!, { target: { value: "assez-longue-1" } });
    fireEvent.change(cf!, { target: { value: "assez-longue-2" } });
    fireEvent.click(submitBtn(container, "setup")!);
    expect(resolved,
      "une faute de frappe non détectée scellerait toutes les sauvegardes à venir").toBeUndefined();
    expect(container.textContent).toContain(t("enc_err_mismatch"));
  });

  it("une phrase vide est refusée dans les DEUX modes", () => {
    for (const mode of ["setup", "unlock"] as const) {
      const { container, unmount } = withCtx(
        React.createElement(CuratorEncryptionPromptModal), ctx(mode));
      fireEvent.click(submitBtn(container, mode)!);
      expect(resolved, mode + " : une phrase vide est passée").toBeUndefined();
      expect(container.textContent, mode).toContain(t("enc_err_empty"));
      unmount();
    }
  });

  it("une saisie valide est rendue à l'appelant, telle quelle", () => {
    const { container } = withCtx(React.createElement(CuratorEncryptionPromptModal), ctx("setup"));
    const [pw, cf] = fields(container);
    fireEvent.change(pw!, { target: { value: "une phrase secrète" } });
    fireEvent.change(cf!, { target: { value: "une phrase secrète" } });
    fireEvent.click(submitBtn(container, "setup")!);
    expect(resolved, "la phrase n'a pas été rendue, ou a été transformée")
      .toBe("une phrase secrète");
  });

  it("l'AVERTISSEMENT irréversible n'apparaît qu'à la CRÉATION", () => {
    // À la création il faut le lire AVANT de choisir ; au déblocage la phrase
    // existe déjà et le répéter serait de l'alarme sans action possible.
    const a = withCtx(React.createElement(CuratorEncryptionPromptModal), ctx("setup"));
    expect(a.container.textContent,
      "l'utilisateur choisit une phrase irrécupérable sans en être averti")
      .toContain(t("enc_warn_lost_passphrase").slice(0, 30));
    a.unmount();
    const b = withCtx(React.createElement(CuratorEncryptionPromptModal), ctx("unlock"));
    expect(b.container.textContent).not.toContain(t("enc_warn_lost_passphrase").slice(0, 30));
  });

  it("annuler rend null — jamais une phrase partielle", () => {
    const { container } = withCtx(React.createElement(CuratorEncryptionPromptModal), ctx("setup"));
    fireEvent.change(fields(container)[0]!, { target: { value: "a-moitié-tapée" } });
    fireEvent.click(cancelBtn(container)!);
    expect(resolved,
      "une phrase partielle a été rendue à l'appelant, qui l'aurait utilisée pour chiffrer")
      .toBeNull();
  });

  it("ne rend rien quand aucun prompt n'est demandé", () => {
    const { container } = withCtx(
      React.createElement(CuratorEncryptionPromptModal),
      { encryptionPrompt: null, resolveEncryptionPrompt: () => {}, t });
    expect(container.textContent).toBe("");
  });
});

// ── Le diff du catalogue ─────────────────────────────────────────────────────
describe("DbSyncDiff traduit les énumérations et borne la prose", () => {
  const xl = (v: string, m: any) => (m === (CATS_EN as any) ? "XL:" + v : "xl:" + v);

  it("catégorie et coupe passent par xl(), avec la BONNE carte", () => {
    // Le commentaire du module le dit : un lecteur allemand comparait sa fiche
    // au catalogue et lisait « Anglais » et « Ribbon ». La règle
    // `no-raw-enum-render` est aveugle ici — la lecture est un `d.db` générique.
    const { container } = render(React.createElement(DbSyncDiff, {
      diffs: [
        { field: "category", db: "Anglais", current: "Virginia" },
        { field: "cut", db: "Flake", current: "Ribbon" },
      ],
      t, xl,
    } as any));
    expect(container.textContent, "la catégorie n'est pas traduite").toContain("XL:Anglais");
    expect(container.textContent, "la coupe utilise la carte des catégories").toContain("xl:Flake");
  });

  it("un champ NON énuméré n'est pas traduit", () => {
    // Passer une composition par xl() la laisserait intacte aujourd'hui, mais
    // c'est la carte qui décide, pas la chance.
    const { container } = render(React.createElement(DbSyncDiff, {
      diffs: [{ field: "blend", db: "Virginia, Perique", current: "" }], t, xl,
    } as any));
    expect(container.textContent).toContain("Virginia, Perique");
    expect(container.textContent).not.toContain("xl:");
  });

  it("une description longue est tronquée à ~70 caractères, avec l'ellipsis", () => {
    const long = "x".repeat(200);
    const { container } = render(React.createElement(DbSyncDiff, {
      diffs: [{ field: "description", db: long, current: "" }], t, xl,
    } as any));
    expect(container.textContent, "une ligne de 200 caractères casserait la lisibilité du diff")
      .not.toContain("x".repeat(80));
    expect(container.textContent).toContain("…");
  });

  it("une valeur absente s'affiche « — », jamais « undefined »", () => {
    const { container } = render(React.createElement(DbSyncDiff, {
      diffs: [{ field: "force", db: 3, current: 0 }], t, xl,
    } as any));
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toMatch(/undefined|null/);
  });

  it("une clé forgée ne résout pas sur Object.prototype", () => {
    // `ENUM_MAPS` est null-prototype par construction ; un `field` valant
    // `constructor` doit retomber sur l'étiquette générique, pas sur une
    // fonction rendue comme enfant React (ce qui ferait tomber la fiche).
    expect(() => render(React.createElement(DbSyncDiff, {
      diffs: [{ field: "__proto__", db: "x", current: "y" },
              { field: "constructor", db: "a", current: "b" }],
      t, xl,
    } as any))).not.toThrow();
  });

  it("sans xl(), la valeur brute passe — le repli ne doit pas jeter", () => {
    const { container } = render(React.createElement(DbSyncDiff, {
      diffs: [{ field: "category", db: "Anglais", current: "Virginia" }], t,
    } as any));
    expect(container.textContent).toContain("Anglais");
  });

  it("les étiquettes de champ viennent du dictionnaire, pas d'un littéral", () => {
    const { container } = render(React.createElement(DbSyncDiff, {
      diffs: [{ field: "cut", db: "Flake", current: "Ribbon" }], t, xl,
    } as any));
    expect(container.textContent).toContain(t("lbl_cut"));
  });

  it("CUTS_EN est bien la carte utilisée pour la coupe", () => {
    // Non-vacuité : sans ça, les deux cas ci-dessus passeraient avec une
    // carte quelconque.
    const seen: string[] = [];
    render(React.createElement(DbSyncDiff, {
      diffs: [{ field: "cut", db: "Flake", current: "" }],
      t,
      xl: (v: string, m: any) => { seen.push(m === (CUTS_EN as any) ? "cuts" : "autre"); return v; },
    } as any));
    expect(seen).toContain("cuts");
  });
});
