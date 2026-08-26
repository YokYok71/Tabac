/**
 * LA VARIÉTÉ DES SUGGESTIONS DU HOME, AU SITE D'APPEL.
 *
 * Deux rapports de l'utilisateur ont porté sur cette zone — « la pipe du jour
 * c'est un peu toujours la même », puis « toujours les mêmes » avec beaucoup de
 * pots ouverts — et les deux ont été corrigés dans `HomeViewV2` : le tirage est
 * devenu un mélange à graine (`seededShuffle`), la note a cessé de classer
 * (`ignoreRating`), l'éligibilité s'est restreinte aux pots OUVERTS
 * (`openOnly`), et une graine par lancement (`homeRotationSeed`) a été ajoutée
 * aux quatre choix.
 *
 * MESURÉ : les moteurs sont bien éprouvés — `suggest.test.ts` couvre `openOnly`,
 * `ignoreRating` et `seededShuffle`, `homeRotation.test.ts` couvre le compteur —
 * et **le CÂBLAGE ne l'était pas**. Six sondes au site d'appel, CINQ vertes sur
 * 120 cas : retirer `ignoreRating`, annuler `rotShift`, retirer la graine de
 * lancement du tirage, en retirer le nombre de séances, ou contourner
 * `seededShuffle` entièrement. Chacune est un retour exact à un défaut signalé.
 * C'est la forme `chooseAutoSaveTarget` : une règle éprouvée là où elle est
 * DÉFINIE et non gardée là où elle est APPELÉE.
 *
 * CE QUI EST ASSERTÉ EST LA CONSÉQUENCE OBSERVABLE, jamais l'implémentation.
 * Pour `ignoreRating` cela demande une précision qui a failli produire un test
 * creux : comme le tirage remélange APRÈS le moteur et que `max` vaut 500, la
 * note ne décide plus de l'ORDRE — ce qu'elle produit encore est la RAISON
 * `favorite`, donc la puce « favori » sur la ligne. C'est cela qu'on épingle.
 */

import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppCtx } from "../../AppContext.tsx";
import { CuratorHomeViewV2 } from "../../views/curator/HomeViewV2.tsx";
import { _resetHomeRotationForTests } from "../../utils/homeRotation.ts";

/** Horloge figée : sans cela le seau de 12 h bouge tout seul et on ne saurait
 *  plus si une variation vient du lancement ou du temps qui passe. */
const T0 = 1_800_000_000_000;

const jour = (d: number) => new Date(T0 - d * 86400000).toISOString().slice(0, 10);

/** Douze tabacs, tous avec un pot OUVERT et du poids — donc tous éligibles.
 *  Un pool large est nécessaire : sur trois éléments deux mélanges différents
 *  se ressemblent trop souvent pour que « ça varie » veuille dire quelque chose. */
function caveOuverte(n = 12) {
  const tobaccos = [];
  for (let i = 1; i <= n; i++) {
    tobaccos.push({
      id: i,
      brand: "Marque" + i,
      name: "Melange" + i,
      category: "Anglais",
      // Tout le monde à 0 sauf le premier : c'est le levier de `ignoreRating`.
      rating: i === 1 ? 5 : 0,
      lots: [{ id: 100 + i, status: "jar", weightG: "40", dateOpened: jour(30) }],
      aromas: [],
    });
  }
  return tobaccos;
}

function ctxAvec(over: Record<string, any> = {}) {
  const tobaccos = (over as any).tobaccos || caveOuverte();
  const sessions = (over as any).sessions || [];
  return {
    view: "home",
    lang: "fr",
    t: (k: string) => k,
    xl: (v: any) => v,
    nav: () => {},
    setStatusFilter: () => {},
    setSearchOpen: () => {},
    setImportModal: () => {},
    setSettingsTab: () => {},
    setDetail: () => {},
    setPipeDet: () => {},
    navToInvFiltered: () => {},
    crossOpenDetail: () => {},
    pipeIsActive: (p: any) => p.status !== "finished",
    ageLabel: (d: number | null) => (d == null ? "—" : `${d}j`),
    weightUnit: "g",
    currencySymbol: "€",
    imgLocal: {},
    data: {
      tobaccos,
      pipes: [{ id: 1, brand: "Halvorsen", name: "SH", shape: "Calabash", rating: 4, status: "active" }],
      accessories: [],
      sessions,
      wishlist: [],
    },
    stats: {
      activeRefs: tobaccos.length, cellar: 0, jars: tobaccos.length, wt: 480, avg: "0.0",
      cats: [["Anglais", tobaccos.length]], brands: [],
      pipesActive: 1, pipeVal: 0, tobVal: 0,
      lotsFinished: 0, lotsOveraged: 0, lotsApproaching: 0, wish: 0,
    },
  };
}

function rendre(ctx: any) {
  return render(
    <AppCtx.Provider value={ctx}>
      <CuratorHomeViewV2 />
    </AppCtx.Provider>,
  );
}

/** Les noms de mélange visibles, dans l'ordre du DOM. C'est ce que l'utilisateur
 *  voit ; on ne lit jamais l'état interne. */
function melangesAffiches(container: HTMLElement): string[] {
  const txt = container.textContent || "";
  const out: string[] = [];
  for (const m of txt.matchAll(/Melange(\d+)/g)) {
    const v = "Melange" + m[1];
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Simule un NOUVEAU LANCEMENT : `homeRotationSeed` mémoïse par contexte JS et
 *  incrémente un compteur persisté, donc vider la mémo suffit. */
function nouveauLancement() {
  _resetHomeRotationForTests();
}

beforeEach(() => {
  localStorage.clear();
  _resetHomeRotationForTests();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  _resetHomeRotationForTests();
});

describe("« Ce soir ? » — le tirage varie d'un lancement à l'autre", () => {
  it("NON-VACUITÉ : le Home propose bien des mélanges de la cave", () => {
    // Sans ce contrôle, tout ce qui suit passerait sur un Home qui n'affiche
    // rien du tout — l'assertion « ça varie » serait satisfaite par le vide.
    const { container } = rendre(ctxAvec());
    expect(melangesAffiches(container).length).toBeGreaterThan(0);
  });

  it("LE DÉFAUT SIGNALÉ : huit lancements ne donnent pas huit fois la même tête d'affiche", () => {
    // « toujours les mêmes ». L'horloge est FIGÉE, donc le seau de 12 h ne
    // bouge pas : la seule chose qui change entre deux rendus est le compteur
    // de lancement. S'il ne circule pas jusqu'au tirage, ce cas voit huit fois
    // le même premier mélange.
    const vus = new Set<string>();
    for (let i = 0; i < 8; i++) {
      nouveauLancement();
      const { container, unmount } = rendre(ctxAvec());
      const l = melangesAffiches(container);
      if (l.length) vus.add(l[0]!);
      unmount();
    }
    expect(vus.size, `un seul mélange vu sur 8 lancements : ${[...vus]}`).toBeGreaterThan(1);
  });

  it("journaliser une SÉANCE rebat le tirage, à lancement et horloge constants", () => {
    // Le troisième terme de la graine. Sans lui, fumer une pipe ne change rien
    // à ce que le Home propose ensuite — ce qui est précisément l'inverse de
    // l'effet voulu.
    const rendreAvec = (n: number) => {
      _resetHomeRotationForTests();
      localStorage.setItem("cave-sugg-rot", "7"); // même lancement des deux côtés
      const sessions = [];
      for (let i = 1; i <= n; i++) {
        sessions.push({ id: i, tobaccoId: 99, pipeId: 1, date: jour(200), duration: "30", weightG: "3" });
      }
      const { container, unmount } = rendre(ctxAvec({ sessions }));
      const l = melangesAffiches(container);
      unmount();
      return l.join(",");
    };
    // `tobaccoId: 99` n'existe pas : les séances comptent pour la graine sans
    // toucher à l'éligibilité ni à la récence d'aucun mélange affiché.
    const avant = rendreAvec(0);
    const apres = rendreAvec(5);
    expect(avant.length, "le Home doit afficher quelque chose des deux côtés").toBeGreaterThan(0);
    expect(apres).not.toBe(avant);
  });
});

describe("« Ce soir ? » — ce que la note n'a PAS le droit de faire", () => {
  it("un tabac noté 5 étoiles ne porte pas la puce « favori »", () => {
    // `ignoreRating: true` supprime le score de note ET la raison `favorite`.
    // Comme le tirage remélange après le moteur, l'ORDRE ne prouve rien ici :
    // ce qui est observable est la PUCE.
    //
    // LA FIXTURE A DÛ ÊTRE CONSTRUITE POUR QUE LA PUCE SOIT ATTEIGNABLE, et
    // c'est le cœur du cas. La ligne n'affiche que la PREMIÈRE raison
    // (`reasons…[0]`) et `favorite` est poussée EN DERNIER, après
    // `aging_*`, `lot_low`, `never_smoked` et `not_recent` : un tabac jamais
    // fumé porte donc « jamais fumé » et la note reste invisible. Une première
    // version de ce cas restait verte sous sonde pour exactement cette raison.
    // Chaque tabac reçoit donc une séance RÉCENTE (< 30 j, NOT_RECENT_DAYS) et
    // un pot bien rempli — aucune autre raison ne peut alors précéder
    // `favorite`.
    //
    // ET TOUS SONT NOTÉS 5, ce qui est la seconde correction qu'il a fallu
    // faire : avec un seul 5 étoiles dans un pool de douze, le tirage ne
    // l'affichait pas toujours parmi les quatre lignes rendues, donc la sonde
    // restait verte pour une raison qui n'avait rien à voir avec la règle.
    // En notant tout le monde, la ligne affichée porte la puce ou la règle est
    // rompue — il n'y a plus de troisième possibilité.
    const tobaccos = caveOuverte().map((t) => ({ ...t, rating: 5 }));
    const sessions = tobaccos.map((t, i) => ({
      id: i + 1, tobaccoId: t.id, pipeId: 1, date: jour(3),
      duration: "30", rating: 4, weightG: "3",
    }));
    const { container } = rendre(ctxAvec({ tobaccos, sessions }));
    expect(melangesAffiches(container).length, "pool non vide").toBeGreaterThan(0);
    expect(container.textContent || "").not.toContain("sugg_favorite");
  });
});

describe("« du moment » — les deux vedettes tournent aussi", () => {
  /** Le texte de la tuile « Tabac du moment », isolé du reste de la page :
   *  les mêmes noms apparaissent dans « Ce soir ? » et « À surveiller », donc
   *  une lecture globale ne dirait rien de cette tuile-là. */
  function vedette(container: HTMLElement, marqueur: string): string {
    const txt = container.textContent || "";
    const i = txt.indexOf(marqueur);
    if (i < 0) return "";
    return txt.slice(i, i + 80);
  }

  it("le tabac du moment change d'un lancement à l'autre", () => {
    // Le quatrième consommateur de la graine de lancement, et celui que le
    // tirage « Ce soir ? » ne couvre PAS : les vedettes passent par
    // `featNow = Date.now() + rotShift`, pas par `shuffleSeed`. Sonder
    // `rotShift = 0` laissait le fichier vert avant ce cas — c'est
    // littéralement le rapport « la pipe du jour c'est toujours la même »,
    // côté tabac.
    const vus = new Set<string>();
    for (let i = 0; i < 8; i++) {
      nouveauLancement();
      const { container, unmount } = rendre(ctxAvec());
      const v = vedette(container, "home_tobacco_of_moment");
      if (v) vus.add(v);
      unmount();
    }
    expect(
      [...vus].some((v) => /Melange\d+/.test(v)),
      "non-vacuité : la tuile doit bien nommer un mélange",
    ).toBe(true);
    expect(vus.size, `une seule vedette sur 8 lancements : ${[...vus]}`).toBeGreaterThan(1);
  });
});

describe("« Ce soir ? » — un pot SCELLÉ n'est jamais proposé", () => {
  it("une cave entièrement en cave ne propose rien à fumer ce soir", () => {
    // `openOnly: true`. Une boîte scellée n'est pas fumable ce soir : la
    // proposer serait demander à l'utilisateur d'en ouvrir une, ce que la
    // section ne dit pas.
    const scelles = caveOuverte().map((t) => ({
      ...t,
      lots: [{ id: t.id + 500, status: "cellar", weightG: "50", datePurchased: jour(400) }],
    }));
    const { container } = rendre(ctxAvec({ tobaccos: scelles }));
    // LE MARQUEUR EST `home_tonight_title`, ET IL A ÉTÉ VÉRIFIÉ AVANT D'ÊTRE
    // UTILISÉ. Une première version assérait l'absence de `home_tonight_hero`,
    // une clé qui N'EXISTE PAS — donc une assertion qui ne pouvait jamais
    // échouer, la forme creuse exacte. `home_tonight_title` est rendu sous
    // `{hero && …}`, donc son absence signifie bien « aucune proposition ».
    //
    // Les mélanges peuvent apparaître ailleurs (« À surveiller », « À point »),
    // donc on n'assère pas leur absence totale : seulement que la section
    // « Ce soir ? » ne s'ouvre pas.
    expect(container.textContent || "").not.toContain("home_tonight_title");

    // Le contrôle positif, sans lequel le précédent serait satisfait par un
    // Home qui ne rend jamais cette section.
    const ouverts = rendre(ctxAvec());
    expect(
      ouverts.container.textContent || "",
      "contrôle : avec des pots ouverts, la section s'ouvre",
    ).toContain("home_tonight_title");
    ouverts.unmount();
  });
});
