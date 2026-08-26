/**
 * LES PUCES DE FAMILLE DE LA COURBE D'ÂGE NARROWISSENT VRAIMENT.
 *
 * `computeAgingSweetSpot` prend un `category` optionnel — « les familles
 * vieillissent très différemment, donc une courbe globale moyenne des
 * comportements contradictoires » — et `stats.test.ts` couvre ce paramètre.
 * Ce qui n'était gardé par rien, c'est que la VUE le lui passe : SONDÉ, retirer
 * l'argument au site d'appel laissait les 81 cas de `StatsView.test.tsx` +
 * `stats.test.ts` entièrement verts.
 *
 * La conséquence est un CONTRÔLE MORT : la puce s'allume, la courbe ne bouge
 * pas. Ce dépôt a déjà payé cette forme sur la puce de collection des
 * accessoires, où c'était pire qu'inerte parce que le contrôle prétendait avoir
 * filtré.
 *
 * POURQUOI CE FICHIER À PART, ET POURQUOI ON ASSÈRE L'APPEL. Une première
 * version assérait le TEXTE rendu avant/après le clic et restait rouge pour une
 * raison sans rapport : avec des lots tous du même âge, `computeAgingSweetSpot`
 * rend son état vide diagnostique des DEUX côtés, donc le narrowing existait et
 * n'était pas observable. Le manque est ici un manque de CÂBLAGE, et l'appel est
 * le bon niveau pour l'épingler — comme pour `navToInvByRating` deux cas plus
 * loin. Le module est simulé, d'où le fichier séparé : les 17 autres cas de
 * `StatsView.test.tsx` doivent continuer à voir le vrai module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";

const spyAging = vi.fn();

vi.mock("../../utils/stats.ts", async (importOriginal) => {
  const vrai = await importOriginal<typeof import("../../utils/stats.ts")>();
  return {
    ...vrai,
    computeAgingSweetSpot: (...args: any[]) => {
      spyAging(...args);
      return (vrai.computeAgingSweetSpot as any)(...args);
    },
  };
});

const { CuratorStatsView } = await import("../../views/curator/StatsView");

const jour = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

const tobaccos = [
  { id: 1, brand: "M1", name: "Anglais A", category: "Anglais", rating: 4,
    lots: [{ id: 11, status: "jar", weightG: "40", datePurchased: jour(1500) }] },
  { id: 2, brand: "M2", name: "Burley B", category: "Burley", rating: 4,
    lots: [{ id: 22, status: "jar", weightG: "40", datePurchased: jour(400) }] },
];
const sessions = [
  { id: 1, tobaccoId: 1, pipeId: 1, date: jour(10), duration: "30", rating: 5, weightG: "3", lotId: "11" },
  { id: 2, tobaccoId: 1, pipeId: 1, date: jour(11), duration: "30", rating: 5, weightG: "3", lotId: "11" },
  { id: 3, tobaccoId: 2, pipeId: 1, date: jour(12), duration: "30", rating: 2, weightG: "3", lotId: "22" },
  { id: 4, tobaccoId: 2, pipeId: 1, date: jour(13), duration: "30", rating: 2, weightG: "3", lotId: "22" },
];

function rendre() {
  return renderWithCtx(<CuratorStatsView />, {
    view: "stats",
    chartData: { catW: [["Anglais", 200]], monthW: [], ratings: [], topT: [], topP: [] },
    data: {
      tobaccos,
      pipes: [{ id: 1, name: "P", status: "active" }],
      accessories: [], sessions, wishlist: [],
    },
  });
}

/** La catégorie passée au moteur lors du dernier appel. */
function derniereCategorie(): unknown {
  const c = spyAging.mock.calls;
  return c.length ? c[c.length - 1]![2] : undefined;
}

beforeEach(() => { spyAging.mockClear(); });

describe("StatsView — la courbe d'âge suit la famille choisie", () => {
  it("NON-VACUITÉ : le moteur est bien appelé au rendu, et sans famille au départ", () => {
    // Sans ce cas, celui d'après pourrait passer sur une vue qui n'appelle
    // jamais le moteur — l'assertion « la famille est transmise » serait
    // satisfaite par l'absence d'appel.
    rendre();
    expect(spyAging.mock.calls.length, "le moteur doit être appelé").toBeGreaterThan(0);
    expect(derniereCategorie(), "aucune famille choisie au premier rendu").toBe("");
  });

  it("LE DÉFAUT : taper une famille la TRANSMET au moteur", () => {
    const { getAllByRole } = rendre();
    const puce = getAllByRole("button").find(
      (b) => (b.textContent || "").trim() === "Burley",
    );
    expect(puce, "la puce de famille « Burley » doit être rendue").toBeTruthy();
    fireEvent.click(puce!);
    expect(derniereCategorie()).toBe("Burley");
  });

  it("« Tous » remet la courbe au global", () => {
    // Le contre-cas : une transmission qui ne saurait pas revenir en arrière
    // laisserait l'utilisateur enfermé dans la dernière famille tapée.
    const { getAllByRole } = rendre();
    const boutons = () => getAllByRole("button");
    const burley = boutons().find((b) => (b.textContent || "").trim() === "Burley");
    fireEvent.click(burley!);
    expect(derniereCategorie()).toBe("Burley");
    const tous = boutons().find((b) => (b.textContent || "").trim() === "f_all");
    expect(tous, "la puce « Tous » doit être rendue").toBeTruthy();
    fireEvent.click(tous!);
    expect(derniereCategorie()).toBe("");
  });
});
