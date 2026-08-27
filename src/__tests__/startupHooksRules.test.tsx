// LES QUATRE MACHINES QUI TOURNENT SANS QUE PERSONNE NE REGARDE.
//
// `useOrphanPhotoGC`, `useStorageQuotaWarning`, `useLotIntegrityProbe` et
// `useProgressiveList` partagent une classe de danger : elles démarrent seules
// au lancement (ou tournent en continu pendant qu'on fait défiler une liste),
// et leur rupture ne produit AUCUN message. Une photo disparaît, un
// avertissement de stockage ne se lève plus jamais, un compteur de diagnostic
// s'emballe, une liste redevient le gel de treize secondes qu'elle était censée
// empêcher — et rien à l'écran ne le dit.
//
// Chacune des quatre règles ci-dessous a été SONDÉE : la règle a été rompue
// dans le code de production, la suite ENTIÈRE relancée, et elle est restée
// verte. Aucune couche ne les absorbait. Les cas sont écrits par CONSÉQUENCE :
// ce qu'ils décrivent, c'est ce que l'utilisateur perd.

import { render, renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useOrphanPhotoGC } from "../hooks/useOrphanPhotoGC.ts";
import { useStorageQuotaWarning } from "../hooks/useStorageQuotaWarning.ts";
import { useLotIntegrityProbe } from "../hooks/useLotIntegrityProbe.ts";
import { useProgressiveList } from "../hooks/useProgressiveList.ts";
import { ProgressiveMore } from "../components/curator/ProgressiveMore.tsx";
import { LOCALSTORAGE_BUDGET_CHARS } from "../constants.ts";

// Les deux modules espionnés sont ÉTENDUS depuis l'original (`importOriginal`)
// et non remplacés : `src/utils.ts` importe `isLocalPhotoRef` du même module
// que `gcOrphans`, et un mock qui n'exporterait que la fonction observée
// casserait `isWithinDays` — donc le hook de quota — dans ce même fichier.
const { gcCalls } = vi.hoisted(() => ({ gcCalls: [] as Array<Set<string>> }));
vi.mock("../utils/imgCache.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Cloné : chaque assertion doit voir l'ensemble tel qu'il était à l'appel.
    gcOrphans: (referenced: Set<string>) => {
      gcCalls.push(new Set(referenced));
      return Promise.resolve(0);
    },
  };
});

const { diag } = vi.hoisted(() => ({
  diag: { assert: [] as any[], checkAll: [] as any[], clear: 0, count: 0, violations: [] as any[] },
}));
vi.mock("../utils/lotInvariants.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    assertLotInvariants: (d: any) => { diag.assert.push(d); },
    checkAllInvariants: (d: any) => { diag.checkAll.push(d); return diag.violations; },
  };
});
vi.mock("../utils/diagnostic.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getDiagnosticSnapshot: () => ({ count: diag.count }),
    clearDiagnostic: () => { diag.clear++; },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. LE RAMASSE-MIETTES DE PHOTOS OUBLIE LES ACCESSOIRES
// ─────────────────────────────────────────────────────────────────────────────
//
// CE QUE COÛTE LA RUPTURE : `gcOrphans` supprime de IndexedDB toute clé
// `local-photo-*` absente de l'ensemble « référencé ». La marche de référence
// visite tabacs, pipes, envies, ACCESSOIRES et instantanés de séances. Si la
// branche accessoires disparaît, la photo de chaque briquet, cure-pipe ou étui
// devient un orphelin : elle est effacée au prochain démarrage à froid, quatre
// secondes après le lancement, sans un mot. L'utilisateur retrouve une fiche
// accessoire sans image et n'a aucun moyen de savoir quand ni pourquoi — la
// seule issue est de restaurer une sauvegarde cloud.
//
// SONDE : `collect(d.accessories);` supprimé → suite entière VERTE. Les trois
// autres marches sont verrouillées (imgGcGating.test.tsx couvre tabacs, pipes,
// envies, instantanés et lignes en corbeille) ; celle-ci ne l'était pas, parce
// que toutes les données de test y portent `accessories: []`.
describe("useOrphanPhotoGC — la marche de référence n'oublie personne", () => {
  beforeEach(() => { gcCalls.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function GcHarness({ data, loading }: { data: any; loading: boolean }) {
    useOrphanPhotoGC(data, loading);
    return null;
  }

  it("référence la photo d'un ACCESSOIRE, vivant ou en corbeille", () => {
    const data = {
      tobaccos: [{ id: 1, imageUrl: "local-photo-tob" }],
      pipes: [],
      wishlist: [],
      accessories: [
        { id: 1, name: "Briquet", imageUrl: "local-photo-acc-vivant" },
        // Une ligne en corbeille reste restaurable trente jours : sa photo doit
        // survivre au balayage exactement comme celle d'une ligne vivante.
        { id: 2, name: "Cure-pipe", imageUrl: "local-photo-acc-corbeille",
          deletedAt: "2026-08-01T00:00:00Z" },
      ],
      sessions: [],
    };
    render(<GcHarness data={data} loading={false} />);
    vi.advanceTimersByTime(5_000);

    // Borne sur la CONDITION : si le balayage n'a pas tourné du tout, rien
    // au-dessous n'aurait de sens et ce cas doit échouer ici.
    expect(gcCalls, "le balayage n'a jamais tourné").toHaveLength(1);
    const seen = gcCalls[0]!;
    expect(seen.has("local-photo-acc-vivant"),
      "la photo d'un accessoire vivant sera effacée au prochain démarrage").toBe(true);
    expect(seen.has("local-photo-acc-corbeille"),
      "la photo d'un accessoire en corbeille sera effacée avant sa restauration").toBe(true);
    expect(seen.has("local-photo-tob")).toBe(true);
    // Non-vacuité : une marche qui référencerait tout et n'importe quoi
    // protégerait les accessoires en désarmant le ramasse-miettes entier.
    expect(seen.size, "la marche référence plus que les clés local-photo-*").toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. LA MISE EN SOURDINE DU STOCKAGE DOIT EXPIRER
// ─────────────────────────────────────────────────────────────────────────────
//
// CE QUE COÛTE LA RUPTURE : quand l'un des deux budgets dépasse 80 %, le hook
// lève « pensez à exporter avant que le navigateur ne refuse d'écrire ». Fermer
// la bannière écrit `cave-quota-warn-dismissed` et met l'alerte en sourdine
// SEPT JOURS — une durée, pas un interrupteur. La branche qui efface ce drapeau
// ne s'exécute que si l'usage REDESCEND sous la barre ; sur une cave qui ne
// fait que grossir, elle ne s'exécute jamais. Si la fenêtre de sourdine
// s'allonge (ou cesse d'expirer), la seule protection contre une écriture
// refusée est désarmée définitivement, en silence, par un geste que
// l'utilisateur a fait une fois. Et l'échec qui suit n'est pas un simple refus :
// `save()` appelle `setData` AVANT d'écrire, donc la modification reste en
// mémoire et A DISPARU au prochain lancement.
//
// SONDE : `isWithinDays(dismissedAt, 7)` porté à 700 → suite entière VERTE.
// Les cas existants (useStorageQuotaWarning.test.ts, localStorageBudget.test.ts)
// ne posent que des sourdines datées de MAINTENANT : elles vérifient que la
// sourdine fonctionne, jamais qu'elle prend fin.
describe("useStorageQuotaWarning — la sourdine de 7 jours prend fin", () => {
  const DAY = 24 * 3600 * 1000;
  // Un vrai gabarit : avec un `t` qui renvoie sa clé, `{pct}` ne s'interpole
  // pas et une assertion sur le pourcentage lirait pareil quoi qu'il arrive.
  const T = (k: string) => k === "warn_storage_high"
    ? "Stockage à {pct}% ({used} Mo / {quota} Mo). Pensez à exporter." : k;
  const realStorage = Object.getOwnPropertyDescriptor(navigator, "storage");

  beforeEach(() => { localStorage.clear(); });
  afterEach(() => {
    localStorage.clear();
    if (realStorage) Object.defineProperty(navigator, "storage", realStorage);
    else delete (navigator as any).storage;
  });

  // Sans `storage.estimate`, le hook mesure le budget localStorage de façon
  // SYNCHRONE dans le corps de l'effet : le résultat est lisible dès le retour
  // de `renderHook`, sans attendre le moindre délai.
  function raisedWith(dismissedAgoMs: number | null): any[] {
    delete (navigator as any).storage;
    if (dismissedAgoMs === null) localStorage.removeItem("cave-quota-warn-dismissed");
    else localStorage.setItem("cave-quota-warn-dismissed", String(Date.now() - dismissedAgoMs));
    const setSaveWarn = vi.fn();
    renderHook(() => useStorageQuotaWarning(
      { tobaccos: [] }, "fr", T, setSaveWarn, Math.round(LOCALSTORAGE_BUDGET_CHARS * 0.95),
    ));
    return setSaveWarn.mock.calls.filter((c) => c[0]);
  }

  it("se tait pendant la semaine, puis reparle après", () => {
    // Contrôle positif : sans sourdine, ce harnais lève bien l'alerte. C'est
    // lui qui empêche les deux assertions suivantes d'être satisfaites par un
    // hook qui ne dirait jamais rien.
    expect(raisedWith(null), "le harnais ne lève même pas l'alerte sans sourdine")
      .toHaveLength(1);

    // Un jour : encore en sourdine, l'utilisateur a fermé la bannière hier.
    expect(raisedWith(1 * DAY), "la sourdine ne dure pas jusqu'au lendemain")
      .toHaveLength(0);

    // Huit jours : la sourdine a EXPIRÉ. C'est la moitié de la règle que
    // personne ne gardait — sans elle, une bannière fermée une fois désarme la
    // protection pour toujours.
    const late = raisedWith(8 * DAY);
    expect(late, "la sourdine ne prend jamais fin : l'alerte est perdue à jamais")
      .toHaveLength(1);
    // Et elle reparle avec le bon chiffre, pas avec un message vide.
    expect(String(late[0]![0]),
      "l'alerte revient sans dire de combien la cave est pleine").toContain("95");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. LA SONDE D'INTÉGRITÉ NE RECOMPTE PAS CE QUI EST DÉJÀ COMPTÉ
// ─────────────────────────────────────────────────────────────────────────────
//
// CE QUE COÛTE LA RUPTURE : `assertLotInvariants` tourne à chaque `save()` et
// incrémente un compteur PERSISTÉ (`cave-diagnostic-v1`) plus une trace des 20
// dernières violations. La sonde de démarrage n'est là que pour le cas où
// l'utilisateur ouvre l'app sur des données déjà corrompues sans jamais
// enregistrer. D'où la règle : si le compteur persisté est DÉJÀ non nul, la
// sonde vérifie l'état courant et s'arrête là — elle ne réenregistre rien.
// Sans cet arrêt, chaque lancement recompte les mêmes violations : le compteur
// grimpe tout seul, la trace se remplit de doublons, et l'écran Réglages →
// Diagnostic annonce une corruption qui s'aggrave alors que rien n'a bougé. Un
// compteur qui monte sans cause est un compteur qu'on cesse de lire.
//
// SONDE : le `return;` qui clôt cette branche supprimé → suite entière VERTE.
// lotIntegrityProbeGating.test.tsx couvre l'AUTRE sens (ne pas faire tomber à
// tort un diagnostic vivant) et n'observe jamais `assertLotInvariants` sur ce
// chemin.
describe("useLotIntegrityProbe — un compteur déjà rempli n'est pas re-rempli", () => {
  const LOADED = {
    tobaccos: [{ id: 1, lots: [] }], pipes: [], wishlist: [], accessories: [], sessions: [],
  };

  beforeEach(() => {
    diag.assert.length = 0; diag.checkAll.length = 0; diag.clear = 0;
    diag.count = 0; diag.violations = [];
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  function ProbeHarness({ data, loading }: { data: any; loading: boolean }) {
    useLotIntegrityProbe(data, loading);
    return null;
  }

  it("ne réenregistre pas des violations qu'un save() a déjà comptées", () => {
    diag.count = 2;                                  // un compteur persisté
    diag.violations = [{ code: "lot-balance-overflow" }];  // toujours corrompu
    render(<ProbeHarness data={LOADED} loading={false} />);
    vi.advanceTimersByTime(1_500);

    // Borne sur la CONDITION : la sonde a bien tourné et a bien pris la branche
    // « compteur non vide ». Sans cette ligne, l'assertion suivante serait
    // satisfaite par une sonde qui ne démarre plus du tout.
    expect(diag.checkAll, "la sonde n'a pas tourné").toHaveLength(1);
    expect(diag.assert,
      "les mêmes violations sont recomptées à chaque lancement").toHaveLength(0);
    expect(diag.clear, "un diagnostic vivant a été effacé").toBe(0);
  });

  it("ne recompte rien non plus quand elle vient de faire tomber le compteur", () => {
    // L'autre sortie de la même branche : les données sont redevenues saines,
    // le compteur est remis à zéro — et surtout pas ré-alimenté dans la foulée
    // par un `assertLotInvariants` qui repartirait de zéro pour rien.
    diag.count = 2;
    diag.violations = [];
    render(<ProbeHarness data={LOADED} loading={false} />);
    vi.advanceTimersByTime(1_500);

    expect(diag.checkAll, "la sonde n'a pas tourné").toHaveLength(1);
    expect(diag.clear, "le compteur périmé n'est pas tombé").toBe(1);
    expect(diag.assert,
      "la sonde repart pour un tour après avoir remis le compteur à zéro").toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. LA SENTINELLE DE LA FENÊTRE PRÉCÉDENTE EST DÉBRANCHÉE
// ─────────────────────────────────────────────────────────────────────────────
//
// CE QUE COÛTE LA RUPTURE : l'effet reconstruit son `IntersectionObserver` à
// chaque agrandissement de la fenêtre (un observateur ne signale qu'un
// CHANGEMENT, et un pas court peut laisser la sentinelle immobile dans la marge
// de 600 px). Le nettoyage `io.disconnect()` est ce qui empêche les
// observateurs de s'EMPILER sur le même nœud sentinelle. S'il saute, le
// deuxième passage de la sentinelle fait feu sur deux observateurs, le
// troisième sur trois : la fenêtre double à chaque coup d'œil et la liste plate
// rend d'un bloc les 20 000 lignes que ce hook existe pour borner — le gel de
// treize secondes, revenu par la porte de derrière, sans rien à l'écran pour le
// dire. (Chaque observateur fuité retient en plus le nœud qu'il observe.)
//
// SONDE : `return function () { io.disconnect(); };` remplacé par `return;` →
// suite entière VERTE. progressiveList.test.tsx a un faux observateur dont le
// `disconnect` est un no-op et qui ne garde qu'un seul rappel : par
// construction il ne peut pas voir un empilement.
describe("useProgressiveList — un franchissement de sentinelle ne vaut qu'un pas", () => {
  type Fake = { fire: () => void; disconnected: boolean; el: Element | null };
  let ios: Fake[] = [];

  beforeEach(() => {
    ios = [];
    (globalThis as any).IntersectionObserver = class {
      _me: Fake;
      constructor(cb: (entries: any[]) => void) {
        this._me = { fire: () => cb([{ isIntersecting: true }]), disconnected: false, el: null };
        ios.push(this._me);
      }
      observe(el: Element) { this._me.el = el; }
      disconnect() { this._me.disconnected = true; }
    };
  });
  afterEach(() => { delete (globalThis as any).IntersectionObserver; });

  // Ceux qu'un vrai navigateur ferait encore feu : branchés sur un nœud, et pas
  // débranchés.
  const live = () => ios.filter((o) => o.el && !o.disconnected);
  const shown = () => document.querySelector("[data-count]")!.textContent;

  function Host({ n }: { n: number }) {
    const { visible, hidden, revealMore, sentinelRef } = useProgressiveList(
      Array.from({ length: n }, (_, i) => ({ id: i })), 10,
    );
    return (
      <div>
        <span data-count>{visible.length}</span>
        <ProgressiveMore hidden={hidden} onMore={revealMore} sentinelRef={sentinelRef}
          t={(k) => k} />
      </div>
    );
  }

  it("débranche l'observateur de la fenêtre précédente au lieu de l'empiler", () => {
    render(<Host n={100} />);
    expect(shown()).toBe("10");
    expect(ios, "la sentinelle n'a jamais été observée").toHaveLength(1);

    // Premier franchissement : un pas.
    act(() => { live().forEach((o) => o.fire()); });
    expect(shown(), "le premier franchissement n'a pas agrandi la fenêtre").toBe("20");

    // Non-vacuité : l'observateur A BIEN été reconstruit pour la nouvelle
    // fenêtre. Sans cette ligne, l'assertion suivante passerait aussi dans un
    // monde où plus aucun observateur n'est jamais créé.
    expect(ios.length, "l'observateur n'a pas été reconstruit après l'agrandissement")
      .toBeGreaterThan(1);
    expect(ios[0]!.disconnected,
      "l'observateur de la fenêtre précédente est resté branché sur la sentinelle")
      .toBe(true);

    // La conséquence, mesurée : un SEUL franchissement de plus ne doit valoir
    // qu'un pas de plus. Avec des observateurs empilés, il en vaut autant qu'il
    // y en a — et la borne s'effondre en quelques coups d'œil.
    act(() => { live().forEach((o) => o.fire()); });
    expect(shown(), "un franchissement a révélé plusieurs pas d'un coup").toBe("30");
  });
});
