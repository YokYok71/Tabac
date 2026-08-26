// Smoke tests for src/views/curator/TastingView.tsx.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorTastingView } from "../../views/curator/TastingView";

describe("TastingView — visibility", () => {
  it("returns null when view !== 'tasting'", () => {
    const { container } = renderWithCtx(<CuratorTastingView />, {
      view: "home",
      tasting: null,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders setup state when tasting.stage === 'setup'", () => {
    const { container } = renderWithCtx(<CuratorTastingView />, {
      view: "tasting",
      tasting: { stage: "setup", tobaccoId: "", pipeId: "", weightG: "", lotId: "" },
      tastingSetupUpdate: vi.fn(),
      tastingIgnite: vi.fn(),
      tastingCancel: vi.fn(),
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.firstChild).toBeTruthy();
  });

  it("shows the no-usable-lot warning when no tobacco has a usable jar or cellar lot", () => {
    const { container } = renderWithCtx(<CuratorTastingView />, {
      view: "tasting",
      tasting: { stage: "setup", tobaccoId: "", pipeId: "", weightG: "", lotId: "" },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).toMatch(/tasting_no_usable_tob|no tobacco|aucun tabac|usable lot|lot utilisable/i);
  });
});

describe("TastingView — cellar lot support (parity with SessionFormView)", () => {
  it("lists tobaccos that only have a usable cellar lot (jar parity)", () => {
    const cellarOnlyTob = {
      id: 7, name: "Duskfall", brand: "Brackwater",
      lots: [{ id: "L1", status: "cellar", weightG: "50", originalStatus: "cellar" }],
    };
    const { container } = renderWithCtx(<CuratorTastingView />, {
      view: "tasting",
      tasting: { stage: "setup", tobaccoId: "", pipeId: "", weightG: "3", lotId: "" },
      data: { tobaccos: [cellarOnlyTob], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // The dropdown for tobacco must include the cellar-only tobacco.
    expect(container.textContent).toMatch(/Brackwater.*Duskfall/);
    // The no-usable-lot warning must NOT be shown — this tobacco IS usable.
    expect(container.textContent).not.toMatch(/tasting_no_usable_tob|aucun tabac|no tobacco/i);
  });

  it("shows the cellar advisory note when the picked lot is in cellar status", () => {
    const cellarOnlyTob = {
      id: 7, name: "Duskfall", brand: "Brackwater",
      lots: [{ id: "L1", status: "cellar", weightG: "50", originalStatus: "cellar" }],
    };
    const { container } = renderWithCtx(<CuratorTastingView />, {
      view: "tasting",
      tasting: { stage: "setup", tobaccoId: "7", pipeId: "", weightG: "3", lotId: "L1" },
      data: { tobaccos: [cellarOnlyTob], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).toMatch(/tasting_cellar_notice|encore en cave|sealed in the cellar/i);
  });

  it("Ignite on a cellar lot opens the confirm modal instead of igniting immediately", () => {
    const tastingIgnite = vi.fn();
    const changeLotStatus = vi.fn();
    const cellarOnlyTob = {
      id: 7, name: "Duskfall", brand: "Brackwater",
      lots: [{ id: "L1", status: "cellar", weightG: "50", originalStatus: "cellar" }],
    };
    // ignite requires tobaccoId + pipeId + weightG > 0, so the
    // test now picks a real pipe too (was pipeId:"" before).
    const pipe = { id: "P1", name: "Shell Briar", brand: "Brackwater", status: "active" };
    const { container, getAllByRole } = renderWithCtx(<CuratorTastingView />, {
      view: "tasting",
      tasting: { stage: "setup", tobaccoId: "7", pipeId: "P1", weightG: "3", lotId: "L1" },
      tastingIgnite,
      changeLotStatus,
      tastingSetupUpdate: vi.fn(),
      pipeIsActive: () => true,
      data: { tobaccos: [cellarOnlyTob], pipes: [pipe], accessories: [], sessions: [], wishlist: [] },
    });
    // Locate the Ignite button — it carries the "Allumer" / "Light up" label.
    const ignite = getAllByRole("button").find(b =>
      /allumer|light up|tasting_ignite/i.test(b.textContent || ""),
    );
    expect(ignite).toBeTruthy();
    fireEvent.click(ignite!);
    // tastingIgnite must NOT fire directly — the modal must intercept.
    expect(tastingIgnite).not.toHaveBeenCalled();
    // The confirm modal text must now be visible.
    expect(container.textContent).toMatch(/tasting_open_lot_q|ouvrir ce lot|open this lot/i);
  });
});

describe("TastingView — cancel", () => {
  it("Cancel button (back arrow) calls tastingCancel", () => {
    const tastingCancel = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorTastingView />, {
      view: "tasting",
      tasting: { stage: "setup", tobaccoId: "", pipeId: "", weightG: "", lotId: "" },
      tastingCancel,
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // The back/close icon button is the first button rendered with aria-label
    // matching close/cancel/back.
    const back = getAllByRole("button").find(b =>
      /Annuler|Cancel|Retour|Back|btn_close|nav_back/i.test(b.getAttribute("aria-label") || ""),
    );
    expect(back).toBeTruthy();
    fireEvent.click(back!);
    expect(tastingCancel).toHaveBeenCalled();
  });
});

describe("TastingView — running stage", () => {
  it("renders the timer / notes area when running", () => {
    const { container } = renderWithCtx(<CuratorTastingView />, {
      view: "tasting",
      tasting: {
        stage: "running",
        startTs: Date.now() - 60_000,
        pauseStartTs: null,
        pausedAccumMs: 0,
        tobaccoId: "1",
        pipeId: "1",
        notes: "",
        rating: 0,
        weightG: "",
        lotId: "",
      },
      tastingElapsedMs: () => 60_000,
      tastingUpdate: vi.fn(),
      tastingPause: vi.fn(),
      tastingEnd: vi.fn(),
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.firstChild).toBeTruthy();
  });

  // The running-stage POIDS input must be
  // hidden when accounting is OFF — otherwise a typed weight gets deducted at
  // Terminer despite the toggle. The label renders the i18n key in tests.
  const runningCtx = (accountingEnabled: boolean | undefined) => ({
    view: "tasting" as const,
    tasting: {
      stage: "running", startTs: Date.now() - 60_000, pauseStartTs: null,
      pausedAccumMs: 0, tobaccoId: "1", pipeId: "1", notes: "", rating: 0,
      weightG: "0", lotId: "",
    },
    tastingElapsedMs: () => 60_000,
    tastingUpdate: vi.fn(), tastingPause: vi.fn(), tastingEnd: vi.fn(),
    accountingEnabled,
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
  });

  it("hides the running-stage weight input when accountingEnabled is false", () => {
    const { queryByText } = renderWithCtx(<CuratorTastingView />, runningCtx(false));
    expect(queryByText("lbl_weight_upper")).toBeNull();
  });

  it("shows the running-stage weight input when accounting is on (default)", () => {
    const { queryByText } = renderWithCtx(<CuratorTastingView />, runningCtx(true));
    expect(queryByText("lbl_weight_upper")).not.toBeNull();
  });

  // The "Terminer la séance" label button was replaced by a
  // square stop icon button next to pause. The stop button ends the session.
  it("ends the session via the stop button (label 'tasting_end')", () => {
    const end = vi.fn();
    const { getByLabelText } = renderWithCtx(<CuratorTastingView />, {
      ...runningCtx(true),
      tastingEnd: end,
    });
    fireEvent.click(getByLabelText("tasting_end"));
    expect(end).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// The ignite CTA must announce that it is disabled.
//
// It is a PressCard using the app's disable convention (`onClick={cond ? … :
// undefined}`), which drops role AND tabIndex — so until a tabac + pipe are
// picked, the screen's primary action rendered as inert greyed text with no
// button semantics at all, and the reason shown underneath was unreachable to a
// screen reader. Same defect as AICard's search button.
//
// Worth a test because of HOW it was found: the first sweep grepped the
// one-line `? undefined` pattern and missed this multi-line ternary entirely.
// The reliable marker turned out to be `cursor: not-allowed`.
// ─────────────────────────────────────────────────────────────
describe("TastingView — ignite CTA announces its disabled state", () => {
  const tob = {
    id: 7, name: "Duskfall", brand: "Halvorsen",
    lots: [{ id: "L1", status: "jar", weightG: "50", originalStatus: "jar" }],
  };
  const pipe = { id: 3, name: "Old Boy", brand: "Halvorsen", status: "active" };

  function setup(tasting: Record<string, unknown>) {
    return renderWithCtx(<CuratorTastingView />, {
      view: "tasting",
      tasting: { stage: "setup", ...tasting },
      data: { tobaccos: [tob], pipes: [pipe], accessories: [], sessions: [], wishlist: [] },
    });
  }

  it("nothing picked → the CTA is a button reported as aria-disabled", () => {
    const { container } = setup({ tobaccoId: "", pipeId: "", weightG: "3", lotId: "" });
    const off = container.querySelectorAll('[role="button"][aria-disabled="true"]');
    expect(off.length).toBeGreaterThan(0);
    // Focusable, so the user can reach it and be told it is unavailable.
    expect(off[0]!.getAttribute("tabindex")).toBe("0");
  });

  it("tabac + pipe + weight picked → the CTA no longer claims to be disabled", () => {
    const { container } = setup({ tobaccoId: 7, pipeId: 3, weightG: "3", lotId: "L1" });
    expect(container.querySelectorAll('[aria-disabled="true"]').length).toBe(0);
  });
});

// reaching the tobacco or the pipe FROM a running tasting.
//
// Reported from the app: « quand je suis dans une session j'aimerais pouvoir
// atteindre la pipe ou le tabac en cliquant dessus ». The journal's
// session-detail blocks have done this; the live tasting view
// is a different component and never got it.
//
// Leaving a running tasting is a supported move — the state lives in
// `cave-tasting-active` and the gold banner with « Reprendre » is on every
// non-tasting view — so the row simply drills, exactly like the journal's.
describe("TastingView — opening the tobacco / pipe from a running session", () => {
  const RUNNING = {
    stage: "running", startTs: Date.now() - 60_000, pauseStartTs: null,
    pausedAccumMs: 0, tobaccoId: "1", pipeId: "1",
    notes: "", rating: 0, weightG: "2.6", lotId: "700",
  };
  const TOB = {
    id: 1, brand: "Gladora", name: "Pesse Canoe Oriental Flake",
    category: "Oriental", lots: [{ id: 700, status: "jar", weightG: "40" }],
  };
  const PIPE = { id: 1, brand: "Brackwater", name: "Bruyère 1103", status: "active" };

  const run = (over: any = {}) => {
    const crossOpenDetail = vi.fn();
    const r = renderWithCtx(<CuratorTastingView />, Object.assign({
      view: "tasting", tasting: RUNNING,
      tastingElapsedMs: () => 60_000,
      tastingUpdate: vi.fn(), tastingPause: vi.fn(), tastingEnd: vi.fn(),
      crossOpenDetail,
      data: { tobaccos: [TOB], pipes: [PIPE], accessories: [], sessions: [], wishlist: [] },
    }, over));
    return { ...r, crossOpenDetail };
  };

  const rowWith = (container: HTMLElement, text: RegExp) =>
    Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => text.test(b.textContent || ""));

  it("opens the tobacco fiche, recording the drill so back behaves", () => {
    const { container, crossOpenDetail } = run();
    const row = rowWith(container, /Pesse Canoe/);
    expect(row, "the tobacco row must be activable").toBeTruthy();
    fireEvent.click(row!);
    expect(crossOpenDetail).toHaveBeenCalledWith(
      expect.objectContaining({ view: "inv", kind: "tobacco" }));
    expect(crossOpenDetail.mock.calls[0]![0].obj.name).toBe("Pesse Canoe Oriental Flake");
  });

  it("opens the pipe fiche", () => {
    const { container, crossOpenDetail } = run();
    const row = rowWith(container, /Bruyère 1103/);
    expect(row, "the pipe row must be activable").toBeTruthy();
    fireEvent.click(row!);
    expect(crossOpenDetail).toHaveBeenCalledWith(
      expect.objectContaining({ view: "pipes", kind: "pipe" }));
  });

  it("is keyboard-activable, not a bare onClick div", () => {
    const { container } = run();
    const row = rowWith(container, /Pesse Canoe/)!;
    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(row, { key: "Enter" });
  });

  it("stays INERT when the entity no longer exists", () => {
    // A tasting outlives a delete: the row must not offer a fiche that is gone.
    // The `? : undefined` idiom drops role AND tabIndex, so the row degrades to
    // plain text rather than announcing a button that does nothing.
    //
    // ASSERT ON THE ROW, NOT ON ITS TEXT. The first version of this case looked
    // for /Pesse Canoe/ and passed for the wrong reason: with no tobacco the row
    // renders "—", so the text is absent whether or not the guard exists —
    // PROBED, and removing `selTob &&` left it green. `data-combo-row` is the
    // stable hook: the rows are still THERE, they are simply not activable.
    const { container, crossOpenDetail } = run({
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const rows = container.querySelectorAll("[data-combo-row]");
    expect(rows.length, "both rows still render, with an em dash").toBe(2);
    rows.forEach((r) => {
      const card = r.closest("[role='button']");
      expect(card, `${r.getAttribute("data-combo-row")} must not be activable`).toBeNull();
    });
    expect(crossOpenDetail).not.toHaveBeenCalled();
  });

  it("both rows ARE activable when both entities exist", () => {
    // The positive counterpart, on the same hook — so the case above cannot
    // pass merely because the rows stopped rendering.
    const { container } = run();
    const rows = Array.from(container.querySelectorAll("[data-combo-row]"));
    expect(rows.length).toBe(2);
    rows.forEach((r) => {
      expect(r.closest("[role='button']"),
        `${r.getAttribute("data-combo-row")} must be activable`).toBeTruthy();
    });
  });

  it("does not blow up when the ctx has no crossOpenDetail", () => {
    const { container } = run({ crossOpenDetail: undefined });
    expect(container.firstChild).toBeTruthy();
    expect(rowWith(container, /Pesse Canoe/)).toBeFalsy();
  });
});

// ALLUMER SANS LOT RÉSOLUBLE — la survivante dont CLAUDE.md documente la
// correction avec un commentaire de douze lignes, et que rien ne verrouillait.
//
// `canIgnite` exige que le lot RÉSOLVE, pas seulement que `lotId` soit non
// vide : une dégustation persiste dans `cave-tasting-active` et survit aux
// relancements, donc un `lotId` gardé d'une mise en place abandonnée peut
// pointer vers un lot terminé ou supprimé depuis. Ce que coûte l'oubli est
// écrit à côté : la dégustation s'allume en pointant vers rien, et 95 min plus
// tard la clôture automatique DÉTRUIT la séance — `_persistSession` refuse un
// poids positif sans lot résoluble, et le chemin auto vide l'état quoi qu'il
// arrive. Une dégustation entière perdue, sous une phrase de succès.
//
// Retirer `&& !!selectedLot` était donc à un coup d'éditeur de rouvrir le
// défaut sans rien rougir.
describe("TastingView — l'allumage exige un lot qui EXISTE", () => {
  const tob = {
    id: 7, name: "Duskfall", brand: "Brackwater",
    lots: [{ id: "L1", status: "jar", weightG: "50", dateOpened: "2026-01-04" }],
  };
  const pipeRow = { id: 3, brand: "Vondel", name: "Corvane", status: "active" };

  const setup = (lotId: string) => ({
    view: "tasting",
    tasting: { stage: "setup", tobaccoId: "7", pipeId: "3", weightG: "2.5", lotId },
    data: { tobaccos: [tob], pipes: [pipeRow], accessories: [], sessions: [], wishlist: [] },
    accountingEnabled: true,
  });

  it("un lotId périmé n'allume pas", () => {
    // « L9 » n'existe dans aucun lot : c'est exactement l'état qu'une mise en
    // place persistée peut porter après la disparition du lot.
    const tastingIgnite = vi.fn();
    const { getByText } = renderWithCtx(<CuratorTastingView />, { ...setup("L9"), tastingIgnite } as any);
    fireEvent.click(getByText("tasting_ignite"));
    expect(tastingIgnite).not.toHaveBeenCalled();
  });

  it("le même contexte avec un lot RÉSOLUBLE allume", () => {
    // Non-vacuité : sans ce cas, une garde qui refuserait TOUT passerait.
    const tastingIgnite = vi.fn();
    const { getByText } = renderWithCtx(<CuratorTastingView />, { ...setup("L1"), tastingIgnite } as any);
    fireEvent.click(getByText("tasting_ignite"));
    expect(tastingIgnite).toHaveBeenCalledTimes(1);
  });

  it("hors comptabilité, le lot périmé n'empêche plus rien", () => {
    // La garde est conditionnée à la comptabilité : en mode hors comptabilité
    // aucun gramme n'est déduit, donc exiger un lot enfermerait l'utilisateur.
    const tastingIgnite = vi.fn();
    const { getByText } = renderWithCtx(<CuratorTastingView />, {
      ...setup("L9"), accountingEnabled: false, tastingIgnite,
    } as any);
    fireEvent.click(getByText("tasting_ignite"));
    expect(tastingIgnite).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Les deux gardes de l'allumage, et le couple pause / reprise.
//
// `canIgnite` est la SEULE chose entre un tap et une séance en cours. Sondé,
// deux de ses trois termes passaient au vert : sans la pipe, on démarre une
// dégustation qui n'en a pas (le journal affichera « — » à sa place, pour
// toujours) ; sans le poids, comptabilité ACTIVE, on enregistre un bol à 0 g
// et le lot n'est jamais débité — la cave cesse de compter, silencieusement.
// Le troisième terme (le lot doit RÉSOUDRE, pas seulement porter un id) était
// déjà gardé, et c'est lui qui rendait les deux autres invisibles : un fixture
// qui échoue toujours sur le même terme n'exerce jamais les autres.
//
// Et le bouton pause/reprise porte les DEUX actions sur un seul contrôle,
// choisies par `paused`. Les inverser ne casse rien de visible dans une suite :
// le bouton existe, il est nommé, il appelle quelque chose. Il fait
// simplement l'inverse de son libellé — et sur un chrono, mettre en pause en
// croyant reprendre fausse la durée enregistrée.
describe("TastingView — allumer, et le couple pause/reprise", () => {
  const tob = {
    id: 7, name: "Duskfall", brand: "Brackwater", category: "Anglais", cut: "Ribbon",
    lots: [{ id: "L1", status: "jar", weightG: "50", originalStatus: "jar" }],
  };
  const pipe = { id: 3, name: "Foxtrot", brand: "Halvorsen", status: "active" };

  function setup(over: Record<string, any> = {}) {
    const ctx: Record<string, any> = {
      view: "tasting",
      accountingEnabled: true,
      tastingIgnite: vi.fn(),
      tastingSetupUpdate: vi.fn(),
      tastingCancel: vi.fn(),
      weightUnit: "g",
      data: { tobaccos: [tob], pipes: [pipe], accessories: [], sessions: [], wishlist: [] },
      tasting: { stage: "setup", tobaccoId: 7, pipeId: 3, lotId: "L1", weightG: "2.5" },
      ...over,
    };
    return { ctx, ...renderWithCtx(<CuratorTastingView />, ctx) };
  }

  function igniteBtn(container: HTMLElement) {
    return Array.from(container.querySelectorAll("[role=button], button"))
      .find(b => /tasting_ignite|allumer/i.test(
        b.getAttribute("aria-label") || b.textContent || ""));
  }

  it("tout est choisi : le bouton est ACTIF et allume", () => {
    const { ctx, container } = setup();
    const btn = igniteBtn(container as HTMLElement);
    expect(btn, "le bouton d'allumage doit être rendu").toBeTruthy();
    expect(btn!.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(btn!);
    expect(ctx.tastingIgnite).toHaveBeenCalledTimes(1);
  });

  it("sans PIPE, on n'allume pas", () => {
    const { ctx, container } = setup({
      tasting: { stage: "setup", tobaccoId: 7, pipeId: "", lotId: "L1", weightG: "2.5" },
    });
    const btn = igniteBtn(container as HTMLElement);
    expect(btn!.getAttribute("aria-disabled"),
      "un contrôle indisponible doit l'ANNONCER, pas seulement le paraître").toBe("true");
    fireEvent.click(btn!);
    expect(ctx.tastingIgnite).not.toHaveBeenCalled();
  });

  it("comptabilité ACTIVE et poids à zéro : on n'allume pas non plus", () => {
    const { ctx, container } = setup({
      tasting: { stage: "setup", tobaccoId: 7, pipeId: 3, lotId: "L1", weightG: "0" },
    });
    const btn = igniteBtn(container as HTMLElement);
    expect(btn!.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn!);
    expect(ctx.tastingIgnite).not.toHaveBeenCalled();
  });

  it("comptabilité DÉSACTIVÉE, le poids ne bloque plus — la moitié qui doit rester", () => {
    // Contre-cas : sans lui, exiger le poids inconditionnellement passerait le
    // cas ci-dessus et rendrait l'écran inutilisable comptabilité coupée.
    const { ctx, container } = setup({
      accountingEnabled: false,
      tasting: { stage: "setup", tobaccoId: 7, pipeId: 3, lotId: "L1", weightG: "0" },
    });
    const btn = igniteBtn(container as HTMLElement);
    expect(btn!.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(btn!);
    expect(ctx.tastingIgnite).toHaveBeenCalledTimes(1);
  });

  function runningCtx(paused: boolean) {
    const ctx: Record<string, any> = {
      view: "tasting",
      accountingEnabled: true,
      weightUnit: "g",
      data: { tobaccos: [tob], pipes: [pipe], accessories: [], sessions: [], wishlist: [] },
      tasting: {
        stage: "running", tobaccoId: 7, pipeId: 3, lotId: "L1", weightG: "2.5",
        startTs: 1_700_000_000_000, pausedAccumMs: 0,
        ...(paused ? { pauseStartTs: 1_700_000_060_000 } : {}),
      },
      tastingPause: vi.fn(),
      tastingUnpause: vi.fn(),
      tastingEnd: vi.fn(),
      tastingUpdate: vi.fn(),
      tastingElapsedMs: () => 60_000,
      tastingOvertimePrompt: () => false,
      tastingOvertimeRemainingMs: () => 0,
    };
    return { ctx, ...renderWithCtx(<CuratorTastingView />, ctx) };
  }

  it("en marche, le bouton MET EN PAUSE", () => {
    const { ctx, container } = runningCtx(false);
    const btn = container.querySelector('[aria-label="aria_pause_tasting"]');
    expect(btn, "en marche, le contrôle doit s'annoncer comme une pause").toBeTruthy();
    fireEvent.click(btn as Element);
    expect(ctx.tastingPause).toHaveBeenCalledTimes(1);
    expect(ctx.tastingUnpause).not.toHaveBeenCalled();
  });

  it("en pause, le MÊME bouton reprend", () => {
    const { ctx, container } = runningCtx(true);
    const btn = container.querySelector('[aria-label="aria_resume_tasting"]');
    expect(btn, "en pause, il doit s'annoncer comme une reprise").toBeTruthy();
    fireEvent.click(btn as Element);
    expect(ctx.tastingUnpause).toHaveBeenCalledTimes(1);
    expect(ctx.tastingPause).not.toHaveBeenCalled();
  });
});
