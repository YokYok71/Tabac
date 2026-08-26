/**
 * LES DEUX POINTS D'ENTRÉE D'UNE SÉANCE DOIVENT SE COMPORTER PAREIL —
 * ET C'ÉTAIT AFFIRMÉ EN PROSE, VÉRIFIÉ PAR RIEN.
 *
 * `SessionFormView` (saisie manuelle) et `TastingView` (dégustation en direct)
 * appellent les MÊMES trois règles, et le source le dit à chaque site :
 * « identical to SessionFormView so both session entry points behave the
 * same », « mirror of SessionFormView », « identical intent to
 * SessionFormView ». Cette phrase revient quatre fois. Personne ne la
 * vérifiait.
 *
 * MESURÉ, en sondant `TastingView` règle par règle contre la suite ENTIÈRE
 * (5813 cas) :
 *
 *   pickSessionLot            → ROUGE  (untrackedLotUsable.test.ts)
 *   estimateSessionWeight     → VERT   ← non gardée
 *   computePipeGhostingRisk   → VERT   ← non gardée
 *   pipeHoursSinceLastSession → VERT   ← non gardée
 *
 * Une sur quatre. Les trois autres pouvaient disparaître du côté dégustation
 * sans qu'une seule assertion bouge : le grammage retombant sur le défaut
 * global (donc un débit faux sur le lot à chaque bol), l'avertissement de
 * repos et l'avertissement de ghosting purement absents. C'est la forme que ce
 * dépôt paie en boucle — `chooseAutoSaveTarget`, `reDeductRestoredSessions`,
 * `findParityGaps` — une règle éprouvée là où elle est DÉFINIE et non gardée
 * là où elle est APPELÉE, sauf qu'ici il y a DEUX sites d'appel et que c'est
 * leur ACCORD qui est le contrat.
 *
 * POURQUOI UN FICHIER PLUTÔT QU'UN CAS PAR VUE. Un cas par vue verrouille deux
 * comportements ; il ne verrouille pas qu'ils sont LE MÊME. Ici la même
 * fixture traverse les deux vues et les deux résultats sont comparés l'un à
 * l'autre — c'est la seule forme qui puisse rougir quand l'un des deux dérive.
 *
 * CE QUI N'EST DÉLIBÉRÉMENT PAS EXIGÉ, parce que ce sont de vraies différences
 * et qu'une garde trop stricte ferait réécrire du code correct :
 *
 *  - la PORTE diffère (`view === "addJ"` contre `stage === "setup"`) : le
 *    formulaire en ÉDITION garde le grammage enregistré, une dégustation n'a
 *    pas d'équivalent ;
 *  - l'INSTANT de référence du repos diffère (la date+heure de la séance
 *    saisie contre `Date.now()`) : une dégustation commence maintenant, par
 *    définition ;
 *  - le formulaire EXCLUT la séance en cours d'édition du calcul de repos ;
 *    une dégustation n'édite rien.
 *
 * Ce qui est exigé est la moitié partagée : les deux consultent la règle, et
 * les deux en montrent le résultat.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorSessionFormView } from "../../views/curator/SessionFormView";
import { CuratorTastingView } from "../../views/curator/TastingView";
import { estimateSessionWeight } from "../../utils/bowlEstimate";

// ── La fixture, une seule, traversée par les deux vues ──────────────────────
//
// Noms inventés : ce dépôt n'embarque plus de catalogue et sa prose de test ne
// désigne aucun mélange réel.

/** Foyer 19 × 40 mm — de quoi produire une estimation qui DIFFÈRE du défaut
 *  global, ce qui est la seule façon de distinguer « la vue a estimé » de
 *  « la vue a laissé le repli ». */
const PIPE = {
  id: 1, brand: "Halvorsen", name: "Foxtrot", shape: "Billiard",
  chamberDiameter: "19", chamberDepth: "40", status: "active",
};

/** Latakia — une des `GHOSTING_FAMILIES`. Trois séances de ce tabac dans la
 *  pipe suffisent à la déclarer dédiée (MIN_TOTAL 3, DOMINANT_SHARE 0.6). */
const TOB_LATAKIA = {
  id: 10, brand: "R.T. Mallow", name: "Nightfall", category: "Latakia", cut: "Flake",
  lots: [{ id: "L10", status: "jar", weightG: "50", weightInitial: "50", dateOpened: "2024-01-15" }],
};

/** Virginia — famille DIFFÉRENTE, et non ghostante elle-même : c'est le tabac
 *  entrant qui déclenche l'avertissement dans une pipe à Latakia. */
const TOB_VIRGINIA = {
  id: 11, brand: "Vondel", name: "Goldleaf", category: "Virginia", cut: "Ribbon",
  lots: [{ id: "L11", status: "jar", weightG: "50", weightInitial: "50", dateOpened: "2024-02-01" }],
};

const TOBACCOS = [TOB_LATAKIA, TOB_VIRGINIA];

/** Historique qui rend la pipe DÉDIÉE au Latakia, daté assez loin pour ne pas
 *  déclencher aussi l'avertissement de repos — les deux règles doivent pouvoir
 *  être observées séparément. */
const SESSIONS_DEDICATED = [
  { id: 1, date: "2024-03-01", time: "20:00", pipeId: 1, tobaccoId: 10, weightG: "2.5", lotId: "L10" },
  { id: 2, date: "2024-03-05", time: "20:00", pipeId: 1, tobaccoId: 10, weightG: "2.5", lotId: "L10" },
  { id: 3, date: "2024-03-09", time: "20:00", pipeId: 1, tobaccoId: 10, weightG: "2.5", lotId: "L10" },
];

/** Une seule séance, il y a deux heures : sous les 24 h de repos, et trop peu
 *  nombreuse pour déclarer une dédication. */
function sessionsSmokedHoursAgo(h: number) {
  const d = new Date(FIXED_NOW - h * 3600 * 1000);
  const iso = d.toISOString().slice(0, 10);
  const hhmm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  return [{ id: 1, date: iso, time: hhmm, pipeId: 1, tobaccoId: 10, weightG: "2.5", lotId: "L10" }];
}

/** Horloge figée. Le repos se calcule contre `Date.now()` côté dégustation, et
 *  un test qui laisse courir l'horloge réelle bascule tout seul au fil de la
 *  journée — ce dépôt s'est déjà fait prendre par un cas dont le verdict
 *  dépendait de l'heure UTC. */
const FIXED_NOW = Date.UTC(2026, 5, 15, 21, 0, 0);

const SESS_DEFAULT_WEIGHT = "3";

function dataWith(sessions: any[]) {
  return {
    tobaccos: TOBACCOS, pipes: [PIPE],
    accessories: [], wishlist: [], sessions,
  };
}

/** Contexte du FORMULAIRE, mode ajout.
 *
 *  Les clés sont `sessForm` / `setSessForm` — la vue les rebaptise en
 *  déstructurant (`sessForm: form`). Une première version passait `form` et
 *  `setForm` : la vue rendait le VIDE et trois cas accusaient le code alors
 *  que le tort était au lecteur. C'est la troisième fois que ce dépôt paie
 *  cette leçon — vider le DOM une fois coûte trente secondes. */
function formCtx(over: Record<string, any> = {}) {
  const setForm = vi.fn();
  const form = {
    date: "2026-06-15", time: "21:00",
    tobaccoId: "", pipeId: "", lotId: "",
    weightG: "", duration: "", rating: 0, notes: "",
    ...(over.form || {}),
  };
  return {
    setForm,
    ctx: {
      view: "addJ",
      sessForm: form, setSessForm: setForm,
      BJ: { date: "", time: "", tobaccoId: "", pipeId: "", lotId: "", weightG: "", duration: "", rating: 0, notes: "" },
      sessDefaultWeight: SESS_DEFAULT_WEIGHT,
      weightUnit: "g",
      accountingEnabled: true,
      data: dataWith(over.sessions || []),
      addSession: vi.fn(), updateSession: vi.fn(), nav: vi.fn(),
      changeLotStatus: vi.fn(),
    },
  };
}

/** Contexte de la DÉGUSTATION, étape setup. */
function tastingCtx(over: Record<string, any> = {}) {
  const tastingSetupUpdate = vi.fn();
  const tasting = {
    stage: "setup",
    tobaccoId: "", pipeId: "", lotId: "", weightG: "",
    ...(over.tasting || {}),
  };
  return {
    tastingSetupUpdate,
    ctx: {
      view: "tasting",
      tasting, tastingSetupUpdate,
      tastingIgnite: vi.fn(), tastingCancel: vi.fn(),
      tastingStart: vi.fn(), tastingSetLocation: vi.fn(),
      sessDefaultWeight: SESS_DEFAULT_WEIGHT,
      weightUnit: "g",
      accountingEnabled: true,
      data: dataWith(over.sessions || []),
      changeLotStatus: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── 1. Le grammage estimé ───────────────────────────────────────────────────

describe("le grammage est ESTIMÉ des deux côtés, jamais laissé au défaut global", () => {
  /** La valeur que la règle produit pour cette pipe et ce tabac. Calculée par
   *  la vraie fonction plutôt qu'écrite en dur : la table de densités a bougé
   *  plusieurs fois et un nombre figé ici rougirait à la prochaine passe sans
   *  rien dire d'utile. Ce n'est pas circulaire — la vue peut n'appeler rien,
   *  ou appeler avec les mauvais arguments (le défaut des millimètres pris
   *  pour des pouces), et la comparaison l'attrape. */
  const EXPECTED = estimateSessionWeight(PIPE, TOB_LATAKIA, SESS_DEFAULT_WEIGHT, "g");

  it("NON-VACUITÉ : l'estimation DIFFÈRE du défaut global", () => {
    // Sans cette garde, une vue qui ignore complètement l'estimation et laisse
    // le repli passerait tous les cas ci-dessous. C'est exactement la sonde
    // qui est restée verte : `String(sessDefaultWeight)` à la place de
    // l'appel.
    expect(EXPECTED).not.toBe(SESS_DEFAULT_WEIGHT);
    expect(parseFloat(EXPECTED)).toBeGreaterThan(0);
  });

  it("le formulaire de séance l'écrit dans sa copie de travail", () => {
    const { setForm, ctx } = formCtx({
      form: { pipeId: "1", tobaccoId: "10", lotId: "L10" },
    });
    renderWithCtx(<CuratorSessionFormView />, ctx);
    const written = setForm.mock.calls.map((c) => c[0] && c[0].weightG).filter(Boolean);
    expect(written, "le formulaire n'a écrit aucun grammage").not.toHaveLength(0);
    expect(written[written.length - 1]).toBe(EXPECTED);
  });

  it("la dégustation écrit LA MÊME valeur", () => {
    const { tastingSetupUpdate, ctx } = tastingCtx({
      tasting: { pipeId: "1", tobaccoId: "10", lotId: "L10" },
    });
    renderWithCtx(<CuratorTastingView />, ctx);
    const written = tastingSetupUpdate.mock.calls
      .map((c) => c[0] && c[0].weightG)
      .filter((v: any) => v !== undefined && v !== "");
    expect(written, "la dégustation n'a écrit aucun grammage").not.toHaveLength(0);
    expect(written[written.length - 1]).toBe(EXPECTED);
  });
});

// ── 2. L'avertissement de repos ─────────────────────────────────────────────

describe("l'avertissement de repos sort des DEUX côtés", () => {
  const RECENT = sessionsSmokedHoursAgo(2);

  it("le formulaire le montre quand la pipe a été fumée il y a 2 h", () => {
    const { ctx } = formCtx({
      form: { pipeId: "1", tobaccoId: "10", lotId: "L10" },
      sessions: RECENT,
    });
    const { container } = renderWithCtx(<CuratorSessionFormView />, ctx);
    expect(container.textContent).toContain("pipe_rest_warn");
  });

  it("la dégustation aussi", () => {
    const { ctx } = tastingCtx({
      tasting: { pipeId: "1", tobaccoId: "10", lotId: "L10" },
      sessions: RECENT,
    });
    const { container } = renderWithCtx(<CuratorTastingView />, ctx);
    expect(container.textContent).toContain("pipe_rest_warn");
  });

  it("et NI L'UN NI L'AUTRE ne le montre quand la pipe a reposé", () => {
    // Le contre-cas. Sans lui, une vue qui afficherait l'avertissement en
    // permanence satisferait les deux cas au-dessus — un contrôle qui crie
    // toujours ne dit rien.
    const rested = sessionsSmokedHoursAgo(72);
    const f = formCtx({ form: { pipeId: "1", tobaccoId: "10", lotId: "L10" }, sessions: rested });
    const g = tastingCtx({ tasting: { pipeId: "1", tobaccoId: "10", lotId: "L10" }, sessions: rested });
    expect(renderWithCtx(<CuratorSessionFormView />, f.ctx).container.textContent)
      .not.toContain("pipe_rest_warn");
    expect(renderWithCtx(<CuratorTastingView />, g.ctx).container.textContent)
      .not.toContain("pipe_rest_warn");
  });
});

// ── 3. L'avertissement de ghosting ──────────────────────────────────────────

describe("l'avertissement de ghosting sort des DEUX côtés", () => {
  it("le formulaire le montre : pipe dédiée au Latakia, on y met du Virginia", () => {
    const { ctx } = formCtx({
      form: { pipeId: "1", tobaccoId: "11", lotId: "L11" },
      sessions: SESSIONS_DEDICATED,
    });
    const { container } = renderWithCtx(<CuratorSessionFormView />, ctx);
    expect(container.textContent).toContain("ghost_warn_body");
  });

  it("la dégustation aussi", () => {
    const { ctx } = tastingCtx({
      tasting: { pipeId: "1", tobaccoId: "11", lotId: "L11" },
      sessions: SESSIONS_DEDICATED,
    });
    const { container } = renderWithCtx(<CuratorTastingView />, ctx);
    expect(container.textContent).toContain("ghost_warn_body");
  });

  it("et NI L'UN NI L'AUTRE ne le montre quand on y remet le même tabac", () => {
    // Contre-cas : même historique, mais le tabac entrant EST le Latakia
    // auquel la pipe est dédiée. Il n'y a rien à avertir.
    const f = formCtx({ form: { pipeId: "1", tobaccoId: "10", lotId: "L10" }, sessions: SESSIONS_DEDICATED });
    const g = tastingCtx({ tasting: { pipeId: "1", tobaccoId: "10", lotId: "L10" }, sessions: SESSIONS_DEDICATED });
    expect(renderWithCtx(<CuratorSessionFormView />, f.ctx).container.textContent)
      .not.toContain("ghost_warn_body");
    expect(renderWithCtx(<CuratorTastingView />, g.ctx).container.textContent)
      .not.toContain("ghost_warn_body");
  });
});
