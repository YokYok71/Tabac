// Smoke tests for src/views/curator/PipesListView.tsx.

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorPipesListView } from "../../views/curator/PipesListView";

describe("PipesListView — visibility", () => {
  it("returns null when view !== 'pipes'", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, { view: "home" });
    expect(container.firstChild).toBeNull();
  });

  it("returns null when pipeDet is set (detail view takes over)", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: { id: "1", brand: "X", name: "Y" },
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the empty state when no pipes exist", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [],
      data: { pipes: [], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).toMatch(/Aucune pipe|No pipes|no_pipes/);
  });

  it("renders the pipe brand + name on the card", () => {
    // AnimNum is async so we don't assert on the numeric sub-header value
    // here; static text (brand + name) is enough proof the list rendered.
    const pipe = { id: "1", brand: "Halvorsen", name: "Sherlock", price: "150", status: "active", rating: 4 } as any;
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [pipe],
      data: { pipes: [pipe], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
      stats: { pipeVal: 150 },
    });
    expect(container.textContent).toContain("Halvorsen");
    expect(container.textContent).toContain("Sherlock");
  });
});

describe("PipesListView — rest chip", () => {
  function dateNDaysAgo(n: number): string {
    return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  }
  // The harness `t` echoes keys; give rest_chip its real template so
  // the {n} interpolation is exercised.
  const tRest = (k: string) => (k === "rest_chip" ? "repos {n} j" : k);

  it("shows the rest chip with the day count for a smoked pipe", () => {
    const pipe = { id: "1", brand: "Halvorsen", name: "Sherlock", status: "active" } as any;
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [pipe],
      t: tRest,
      data: {
        pipes: [pipe], tobaccos: [], accessories: [], wishlist: [],
        sessions: [{ pipeId: "1", date: dateNDaysAgo(3) }],
      },
    });
    expect(container.textContent).toMatch(/repos 3 j/);
  });

  it("shows NO rest chip for a never-smoked pipe", () => {
    const pipe = { id: "1", brand: "Halvorsen", name: "Sherlock", status: "active" } as any;
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [pipe],
      t: tRest,
      data: { pipes: [pipe], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).not.toMatch(/repos/);
  });

  it("shows NO rest chip on a retired pipe", () => {
    const pipe = { id: "1", brand: "Halvorsen", name: "Sherlock", status: "finished" } as any;
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [pipe],
      t: tRest,
      data: {
        pipes: [pipe], tobaccos: [], accessories: [], wishlist: [],
        sessions: [{ pipeId: "1", date: dateNDaysAgo(3) }],
      },
      showFinishedPipes: true,
    });
    expect(container.textContent).not.toMatch(/repos 3 j/);
  });
});

describe("PipesListView — '+' button", () => {
  it("nav('addP') on tap", () => {
    const nav = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [],
      data: { pipes: [], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
      nav,
    });
    const btn = getAllByRole("button").find(b =>
      /Add a pipe|Ajouter une pipe|btn_add_pipe/i.test(b.getAttribute("aria-label") || ""),
    );
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(nav).toHaveBeenCalledWith("addP");
  });
});

describe("PipesListView — description show/hide toggle", () => {
  const pipe = {
    id: "7", brand: "Brackwater", name: "Shell", status: "active", rating: 5,
    description: "Bruyère sablée profonde", notes: "Ma préférée du dimanche",
  } as any;
  const base = {
    view: "pipes", pipeDet: null,
    filteredPipes: [pipe],
    data: { pipes: [pipe], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    stats: { pipeVal: 0 },
  };

  it("hides the description by default (expandCards off)", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, base);
    expect(container.textContent).not.toContain("Bruyère sablée profonde");
    expect(container.textContent).not.toContain("Ma préférée du dimanche");
  });

  it("reveals description + notes when expandCards is on", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, { ...base, expandCards: true });
    expect(container.textContent).toContain("Bruyère sablée profonde");
    expect(container.textContent).toContain("Ma préférée du dimanche");
  });
});

// ── Tag / collection chips folded behind a disclosure ────────
// Reported from the app: the tag filter row spent a whole row above the first
// card ("ça prend trop de place"). It now hides behind a `#` icon placed IN the
// existing controls row — NOT its own labelled row, which would have cost a row
// to hide a row and saved nothing. Two things must hold: the chips are gone by
// default, and an ACTIVE tag filter is still visible while they are hidden
// (otherwise folding them away would conceal that the list is narrowed).
describe("PipesListView — tag chips behind the # disclosure", () => {
  const tagged = (id: string, tags: string[]) => ({
    id, brand: "Halvorsen", name: "Sherlock " + id, status: "active", rating: 4, tags,
  }) as any;
  const pipes = [tagged("1", ["Boa", "week-end"]), tagged("2", ["Boa"])];
  const base = {
    view: "pipes", pipeDet: null,
    filteredPipes: pipes,
    data: { pipes, tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    stats: { pipeVal: 0 },
  };

  it("hides the tag chips by default", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, base);
    expect(container.textContent).not.toContain("# Boa");
    expect(container.textContent).not.toContain("# week-end");
  });

  it("offers the disclosure only when a pipe actually carries a tag", () => {
    const withTags = renderWithCtx(<CuratorPipesListView />, base);
    expect(withTags.container.querySelectorAll('[aria-label*="tag_filter_label"]').length)
      .toBeGreaterThan(0);
    const bare = [{ id: "9", brand: "X", name: "Y", status: "active" }] as any[];
    const without = renderWithCtx(<CuratorPipesListView />, {
      ...base, filteredPipes: bare,
      data: { pipes: bare, tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(without.container.querySelectorAll('[aria-label*="tag_filter_label"]').length).toBe(0);
  });

  it("reveals every distinct tag when the disclosure is tapped", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, base);
    const btn = container.querySelector('[aria-label*="tag_filter_label"]') as HTMLElement;
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(container.textContent).toContain("# Boa");
    expect(container.textContent).toContain("# week-end");
  });

  it("still shows an ACTIVE tag filter while the chips are folded away", () => {
    // The active-filter pill row is outside the disclosure on purpose.
    const { container } = renderWithCtx(<CuratorPipesListView />, { ...base, pTagFilter: "Boa" });
    expect(container.textContent).toContain("Boa");
  });
});

// ── the retired-pipe card is legible ─────────────────────────
// An earlier release removed `opacity: active ? 1: 0.55` from the whole PipeCard and
// shipped that fix with NO test, so it was freely reinstatable — found while
// correcting its comment, which claimed a measured ~2.3:1 across all six
// theme×mode combos. That claim was wrong: `...e` (useEnter) is spread last in
// the same style object and always carries an opacity, so the fade never
// rendered. It was a landmine rather than a live defect, and the distinction
// only matters for the comment — removing it was right either way.
// This asserts the SETTLED opacity, so it fails on the form that WOULD render
// (a fade placed after the spread) rather than merely on the declaration.
describe("PipesListView — retired pipes stay readable", () => {
  const retired = { id: "1", brand: "Halvorsen", name: "Sherlock", status: "finished", rating: 3 } as any;
  const ctx51 = {
    view: "pipes",
    pipeDet: null,
    filteredPipes: [retired],
    data: { pipes: [retired], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    showFinishedPipes: true,
  };
  const card = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("[role='button']"))
      .find((el) => /Sherlock/.test(el.textContent || "")) as HTMLElement | undefined;

  it("settles at full opacity — the card is an active control, not a disabled one", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWithCtx(<CuratorPipesListView />, ctx51);
      const el = card(container);
      expect(el, "the retired pipe card must render").toBeTruthy();
      act(() => { vi.advanceTimersByTime(2000); });
      expect(card(container)!.style.opacity).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the retired state is still signalled — by a pill, not by fading", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, ctx51);
    expect(container.textContent).toMatch(/pipe_retired|RETIR/i);
  });
});

// ── LA PUCE « À ENTRETENIR » N'ÉTAIT ASSERTÉE PAR RIEN ───────────────────────
//
// Trouvée par mutation : neutraliser `maintDueSet.has(...)` — donc faire
// disparaître la puce de TOUTES les cartes — laissait ce fichier entièrement
// vert, et il ne contenait pas une seule occurrence du mot « entretien ».
//
// Le rappel d'entretien existe sur TROIS surfaces (la section du Home, cette
// puce, la Notice de la fiche) ; c'est celle-ci qu'on voit en parcourant sa
// collection, et c'est la seule qui n'avait pas de filet. Deux règles sont en
// jeu et elles se cassent séparément : le SEUIL décide quelles pipes sont
// concernées, l'INTERRUPTEUR décide si le rappel existe du tout.
describe("PipesListView — la puce d'entretien", () => {
  const PIPE = (id: string, name: string) => ({
    id, brand: "Halvorsen", name, status: "active",
    shape: "Billiard", maintenance: [], photos: [], rating: 0,
  });
  // Cinq séances sur la pipe 1, aucune sur la 2 — au seuil par défaut (5) la
  // première est due, la seconde non.
  const SESSIONS = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1, date: "2026-08-0" + (i + 1), pipeId: "1", tobaccoId: "1",
    duration: 30, rating: 0, notes: "", weightG: "0", lotId: "",
  }));
  const base = (over: any = {}) => Object.assign({
    view: "pipes", pipeDet: null,
    filteredPipes: [PIPE("1", "Trop fumée"), PIPE("2", "Fraîche")],
    data: {
      pipes: [PIPE("1", "Trop fumée"), PIPE("2", "Fraîche")],
      tobaccos: [], accessories: [], sessions: SESSIONS, wishlist: [],
    },
    maintReminderThreshold: 5,
    maintRemindersEnabled: true,
  }, over);

  it("marque la pipe qui a dépassé le seuil, et elle SEULE", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, base());
    const chips = Array.from(container.querySelectorAll("span"))
      .filter((e) => /maint_due|entretenir/i.test(e.textContent || ""));
    expect(chips.length,
      "la puce d'entretien ne s'affiche pas, ou s'affiche sur toutes les pipes")
      .toBe(1);
  });

  it("l'INTERRUPTEUR de rappels éteint la puce partout", () => {
    // Le réglage doit supprimer le rappel, pas seulement le rendre discret :
    // une puce ambre qui survit à son propre interrupteur est un réglage mort.
    const { container } = renderWithCtx(<CuratorPipesListView />,
      base({ maintRemindersEnabled: false }));
    expect(container.textContent,
      "les rappels sont désactivés et la puce reste affichée")
      .not.toMatch(/maint_due|entretenir/i);
  });

  it("le SEUIL décide vraiment — à 99, plus personne n'est dû", () => {
    // Sans ce cas, une puce câblée en dur sur « toujours vrai » passerait le
    // premier cas dès qu'il n'y a qu'une pipe concernée.
    const { container } = renderWithCtx(<CuratorPipesListView />,
      base({ maintReminderThreshold: 99 }));
    expect(container.textContent,
      "le seuil n'est pas consulté — la puce est câblée")
      .not.toMatch(/maint_due|entretenir/i);
  });

  it("une pipe RETIRÉE ne porte pas la puce — elle n'est plus en rotation", () => {
    const retired = Object.assign(PIPE("1", "Trop fumée"), { status: "finished" });
    const { container } = renderWithCtx(<CuratorPipesListView />, base({
      filteredPipes: [retired],
      showFinishedPipes: true,
      data: { pipes: [retired], tobaccos: [], accessories: [], sessions: SESSIONS, wishlist: [] },
    }));
    expect(container.textContent,
      "une pipe hors rotation est signalée à entretenir")
      .not.toMatch(/maint_due|entretenir/i);
  });
});

// ── L'ÉTAT VIDE DOIT SAVOIR QU'UN FILTRE NARROWE ────────────────────────────
// `pipesFiltered` décide entre les DEUX états vides : « aucun résultat pour ces
// filtres » + Réinitialiser, ou « aucune pipe » + Ajouter. Les EXCLUSIONS de ce
// prédicat sont assertées ailleurs (`showFinishedPipes` élargit, donc le
// réinitialiser retirerait des lignes que l'utilisateur venait de demander) —
// les INCLUSIONS ne l'étaient pas : sondé, retirer `pTagFilter` du prédicat
// laissait 1053 cas verts.
//
// La conséquence est celle que ce dépôt a déjà documentée pour les trois
// listes : l'utilisateur qui filtre par collection jusqu'à zéro lit la phrase
// du PREMIER LANCEMENT et se voit offrir un bouton qui crée une pipe ne
// correspondant pas au filtre — sans rien à l'écran disant qu'un filtre est
// actif.
describe("PipesListView — état vide : filtré ou vraiment vide", () => {
  const base = {
    view: "pipes", pipeDet: null, filteredPipes: [],
    data: { pipes: [{ id: "1", brand: "Halvorsen", name: "Foxtrot", status: "active", tags: ["voyage"] }],
            tobaccos: [], accessories: [], sessions: [], wishlist: [] },
  };

  it("un filtre COLLECTION qui ne rend rien propose de réinitialiser", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, { ...base, pTagFilter: "voyage" });
    expect(container.textContent, "l'état « premier lancement » s'affiche alors qu'un filtre est actif")
      .toMatch(/list_no_match|Aucun résultat/);
    expect(container.textContent).toMatch(/btn_reset_filters|Réinitialiser/);
  });

  it("sans filtre, c'est bien l'état « aucune pipe » avec l'ajout", () => {
    // Le contre-sens : sans ce cas, un prédicat toujours-vrai passerait pour
    // correct et le premier lancement offrirait « Réinitialiser » à un
    // utilisateur qui n'a filtré sur rien.
    const { container } = renderWithCtx(<CuratorPipesListView />, { ...base, pTagFilter: "" });
    expect(container.textContent).toMatch(/no_pipes|Aucune pipe/);
    expect(container.textContent).toMatch(/btn_add_pipe|Ajouter une pipe/);
  });
});
