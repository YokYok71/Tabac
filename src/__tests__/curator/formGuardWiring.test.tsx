/**
 * LA GARDE DES MODIFICATIONS NON ENREGISTRÉES ÉTAIT CÂBLÉE PAR RIEN.
 *
 * `useUnsavedFormGuard` a sa propre suite (`useUnsavedFormGuard.test.tsx`) et
 * elle le couvre bien : l'instantané pris à l'entrée, la comparaison JSON, les
 * refs de dernière valeur. Ce qui n'était couvert par rien, ce sont ses CINQ
 * SITES D'APPEL — la forme que ce dépôt paie en boucle (`chooseAutoSaveTarget`,
 * `reDeductRestoredSessions`, `findParityGaps`) : une règle éprouvée là où elle
 * est DÉFINIE et non gardée là où elle est APPELÉE.
 *
 * MESURÉ, chaque sonde confrontée à la SUITE ENTIÈRE (5818 cas) :
 *
 *   garde DÉSARMÉE sur PipeFormView        → 5818 verts
 *   garde DÉSARMÉE sur TobaccoFormView     → 5818 verts
 *   `submit` et `cancel` INTERVERTIS       → 5818 verts
 *
 * Les conséquences, dans l'ordre où elles font mal. Désarmée, on quitte un
 * formulaire modifié d'un geste de retour système **sans un mot** : la saisie
 * est perdue en silence, et c'est précisément le défaut que ce hook a été écrit
 * pour empêcher. Intervertie, c'est pire — la modale s'ouvre bien, mais son
 * bouton « Enregistrer » appelle `cancel` et JETTE la saisie, pendant que
 * « Quitter sans enregistrer » l'enregistre. Un utilisateur qui répond
 * correctement à la question perd son travail.
 *
 * Aucun invariant ne peut voir ça : les deux issues produisent des données
 * valides. Seul le CÂBLAGE distingue les deux.
 *
 * CE FICHIER PILOTE LES VRAIES VUES et interroge ce qu'elles remettent à
 * `ctx.setFormGuard` — c'est le seul point où l'accord entre la vue et le hook
 * est observable.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { AppCtx } from "../../AppContext";
import { CuratorTobaccoFormView } from "../../views/curator/TobaccoFormView";
import { CuratorPipeFormView } from "../../views/curator/PipeFormView";
import { CuratorAccessoryFormView } from "../../views/curator/AccessoryFormView";

/** Chaque formulaire : la vue, la clé de vue en mode AJOUT, les clés de
 *  contexte que la vue déstructure (elles ne portent PAS le nom que la vue leur
 *  donne en interne — `TobaccoFormView` lit `form`, `PipeFormView` lit
 *  `pipeForm`), et l'action d'écriture attendue. Vérifié dans le source avant
 *  d'être écrit ici : un contexte mal nommé rend le VIDE, et trois cas ont déjà
 *  accusé le code alors que le tort était au lecteur. */
/** Les quelques clés que `renderWithCtx` fournit par défaut et dont les vues
 *  ont besoin. Le harnais à état ci-dessous fournit son propre Provider, donc
 *  il doit les porter lui-même. */
const BASE_CTX = {
  t: (k: string) => k, xl: (v: string) => v, lang: "fr",
  weightUnit: "g", lengthUnit: "mm", dateFormat: "fr", currencySymbol: "\u20ac",
};

const FORMULAIRES = [
  {
    nom: "tabac",
    View: CuratorTobaccoFormView,
    view: "addT",
    formKey: "form", setFormKey: "setForm",
    addKey: "addTobacco",
    base: { name: "", brand: "", category: "", cut: "", blend: "", lots: [] },
    modif: { name: "Foxtrot" },
  },
  {
    nom: "pipe",
    View: CuratorPipeFormView,
    view: "addP",
    formKey: "pipeForm", setFormKey: "setPipeForm",
    addKey: "addPipe",
    base: { name: "", brand: "", shape: "", status: "active" },
    modif: { name: "Corvane" },
  },
  {
    nom: "accessoire",
    View: CuratorAccessoryFormView,
    view: "addA",
    formKey: "accForm", setFormKey: "setAccForm",
    addKey: "addAccessory",
    base: { name: "", brand: "", type: "", status: "active" },
    modif: { name: "Aldwych" },
  },
] as const;

function monte(f: (typeof FORMULAIRES)[number], form: any) {
  const setFormGuard = vi.fn();
  const ecrire = vi.fn();
  const nav = vi.fn();
  const ctx: Record<string, any> = {
    view: f.view,
    setFormGuard,
    nav,
    [f.formKey]: form,
    [f.setFormKey]: vi.fn(),
    [f.addKey]: ecrire,
    data: { tobaccos: [], pipes: [], accessories: [], wishlist: [], sessions: [] },
  };
  const r = renderWithCtx(<f.View />, ctx);
  return { setFormGuard, ecrire, nav, r };
}

/** La dernière garde remise au contexte (le hook la réenregistre à chaque
 *  activation). */
function derniereGarde(setFormGuard: ReturnType<typeof vi.fn>) {
  const avec = setFormGuard.mock.calls.filter((c) => c[0]);
  return avec.length ? avec[avec.length - 1]![0] : null;
}

describe("chaque formulaire remet une garde au contexte", () => {
  for (const f of FORMULAIRES) {
    it(`${f.nom} — la garde est ENREGISTRÉE en mode ajout`, () => {
      // La sonde qui a motivé ce fichier : `useUnsavedFormGuard(false, …)` sur
      // n'importe laquelle de ces vues laissait la suite entière verte, et on
      // quittait alors un formulaire modifié sans un mot.
      const { setFormGuard } = monte(f, { ...f.base });
      const g = derniereGarde(setFormGuard);
      expect(g, `${f.nom} : aucune garde enregistrée`).toBeTruthy();
      expect(typeof g.isDirty).toBe("function");
      expect(typeof g.onSave).toBe("function");
      expect(typeof g.onDiscard).toBe("function");
    });

    it(`${f.nom} — onSave ENREGISTRE, onDiscard n'enregistre pas`, () => {
      // L'interversion `submit`/`cancel` est le défaut le plus coûteux des
      // trois : la modale s'ouvre, l'utilisateur répond « Enregistrer », et la
      // saisie est jetée. Les deux moitiés sont exigées, sinon un câblage qui
      // appelle l'écriture des DEUX côtés passerait la première.
      const a = monte(f, { ...f.base, ...f.modif });
      derniereGarde(a.setFormGuard).onSave();
      expect(a.ecrire, `${f.nom} : onSave n'a pas enregistré`).toHaveBeenCalled();

      const b = monte(f, { ...f.base, ...f.modif });
      derniereGarde(b.setFormGuard).onDiscard();
      expect(b.ecrire, `${f.nom} : onDiscard a ENREGISTRÉ — submit et cancel sont intervertis`)
        .not.toHaveBeenCalled();
    });

    it(`${f.nom} — isDirty est FAUX à l'entrée et VRAI après une saisie`, () => {
      // Les deux moitiés sont exigées, et c'est le point : une garde TOUJOURS
      // sale fait confirmer la sortie d'un formulaire auquel personne n'a
      // touché — on apprend alors à taper « Quitter » sans lire, et la garde
      // devient pire qu'absente — tandis qu'une garde JAMAIS sale ne demande
      // rien du tout.
      //
      // MA PREMIÈRE VERSION DE CE CAS ÉTAIT CREUSE : elle assertait
      // `typeof isDirty() === "boolean"`, satisfait par n'importe quoi. Dans un
      // fichier dont le sujet EST le test creux, c'était la faute à ne pas
      // commettre. Il faut un harnais À ÉTAT, parce que l'instantané est pris à
      // l'ENTRÉE : monter directement sur une valeur modifiée ne donne pas un
      // formulaire « sale », seulement un formulaire pré-rempli.
      const setFormGuard = vi.fn();
      function Harnais() {
        const [form, setForm] = React.useState<any>({ ...f.base });
        const ctx: Record<string, any> = {
          view: f.view, setFormGuard, nav: vi.fn(),
          [f.formKey]: form, [f.setFormKey]: setForm,
          [f.addKey]: vi.fn(),
          data: { tobaccos: [], pipes: [], accessories: [], wishlist: [], sessions: [] },
        };
        return (
          <AppCtx.Provider value={{ ...BASE_CTX, ...ctx } as any}>
            <button data-saisir onClick={() => setForm((p: any) => ({ ...p, ...f.modif }))} />
            <f.View />
          </AppCtx.Provider>
        );
      }
      const { container } = render(<Harnais />);

      const avant = derniereGarde(setFormGuard);
      expect(avant, `${f.nom} : aucune garde`).toBeTruthy();
      expect(avant.isDirty(), `${f.nom} : sale avant toute saisie`).toBe(false);

      // Une VRAIE modification de la copie de travail, par le chemin qu'emprunte
      // la vue elle-même (`setForm`), suivie du rendu que React en fait.
      act(() => { (container.querySelector("[data-saisir]") as HTMLElement).click(); });

      expect(
        derniereGarde(setFormGuard).isDirty(),
        `${f.nom} : la saisie n'a pas rendu le formulaire sale — on le quitterait sans un mot`,
      ).toBe(true);
    });
  }
});
