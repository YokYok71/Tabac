// Quatre règles des trois modales — Courses, Recherche, Comparaison — dont
// AUCUN test ne gardait la rupture. Chacune a été sondée par une mutation dans
// le code de production, suite ENTIÈRE relancée : les quatre sont restées
// vertes. Ce fichier ferme ces quatre trous, et rien d'autre.
//
// Ce qui n'est PAS ici, et pourquoi : le plafond COMPARE_MAX (déjà tenu par
// `buildComparison` dans compareBlends.test.ts) et le filtre `deletedAt` de la
// modale de comparaison (la vue reçoit `liveData`, déjà filtré — une mutation
// y serait ÉQUIVALENTE, pas une survivante).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { AppCtx, type AppCtxType } from "../../AppContext.tsx";
import { BT } from "../../constants";

// Le catalogue de référence est chargé paresseusement par SearchModal à
// l'ouverture ; on lui en donne un minuscule, le matcher restant le vrai.
// (La fixture est DÉFINIE DANS la factory : `vi.mock` est hissé au-dessus des
// imports, une const de module serait dans sa zone morte au moment de l'appel.)
vi.mock("../../utils/tobaccoDb.ts", async () => {
  const real: any = await vi.importActual("../../utils/tobaccoDb.ts");
  const db = {
    brands: { halvorsen: { displayName: "Halvorsen" } },
    blends: {
      "halvorsen|duskfall": { name: "Duskfall", category: "Anglais", cut: "Ribbon" },
    },
  };
  return { ...real, loadTobaccoDb: () => Promise.resolve(db) };
});

import { CuratorShoppingModal } from "../../views/curator/ShoppingModal";
import { CuratorSearchModal } from "../../views/curator/SearchModal";
import { CuratorCompareModal } from "../../views/curator/CompareModal";

const dlg = () => within(screen.getByRole("dialog"));

// ─────────────────────────────────────────────────────────────────────────────
// LISTE DE COURSES
// ─────────────────────────────────────────────────────────────────────────────

const lowStockTob = {
  id: 1, brand: "Brackwater", name: "Duskfall",
  lots: [{ status: "jar", weightG: "20" }],
};
const wishItem = { id: 5, brand: "Halvorsen", name: "Rivière Dorée" };

const shoppingCtx = {
  shoppingOpen: true,
  setShoppingOpen: () => {},
  weightUnit: "g",
  watchLowWeight: "50",
  imgLocal: {},
  crossOpenDetail: () => {},
  setStatusFilter: () => {},
  nav: () => {},
  t: (k: string) => k,
  data: { tobaccos: [lowStockTob], pipes: [], accessories: [], sessions: [], wishlist: [wishItem] },
};

// Le bouton de coche d'une ligne, retrouvé par le NOM de son article.
// L'absence du contrôle doit être un ÉCHEC, jamais un test à zéro assertion :
// `getByRole` lève si rien ne correspond.
function tickFor(label: string): HTMLElement {
  const btn = dlg().getAllByRole("button")
    .find((b) => (b.getAttribute("aria-label") || "").includes(label));
  expect(btn, `la ligne « ${label} » doit porter son bouton de coche`).toBeTruthy();
  return btn as HTMLElement;
}

describe("ShoppingModal — ce que « Copier la liste » met dans le presse-papier", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    // Promesse jamais tenue : on mesure l'APPEL, et rien ne repasse par
    // setState après la fin du test.
    writeText = vi.fn(() => new Promise<void>(() => {}));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText }, configurable: true, writable: true,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator as any, "clipboard");
  });

  // CE QUE COÛTE LA RUPTURE : la liste copiée est celle qu'on emporte au
  // bureau de tabac. Si elle inclut les lignes déjà cochées, on rachète ce
  // qu'on vient d'acheter — la coche devient décorative et la copie ment sur
  // ce qu'elle sélectionne. C'est de l'argent, pas de l'affichage.
  it("n'emporte QUE les lignes non cochées", () => {
    renderWithCtx(<CuratorShoppingModal />, shoppingCtx);
    fireEvent.click(tickFor("Duskfall"));

    const copy = dlg().getAllByRole("button")
      .find((b) => (b.textContent || "").includes("shopping_copy"));
    expect(copy, "le bouton Copier doit exister tant qu'il y a quelque chose à acheter").toBeTruthy();
    fireEvent.click(copy as HTMLElement);

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = String(writeText.mock.calls[0]![0]);
    expect(text, "l'article déjà acheté ne doit PAS repartir dans la liste").not.toContain("Duskfall");
    expect(text, "l'envie non cochée, elle, doit y être").toContain("Rivière Dorée");
    // La section devenue vide disparaît aussi : pas d'en-tête « À racheter »
    // suivi de rien, qui donnerait l'impression d'une liste tronquée.
    expect(text).not.toContain("shopping_restock");
    expect(text).toContain("shopping_wishes");
  });

  // CE QUE COÛTE LA RUPTURE : si tout est coché et que la copie ment quand
  // même, on repart avec une liste entière à racheter. Rien à copier doit
  // rester rien.
  it("ne copie rien quand tout est coché", () => {
    renderWithCtx(<CuratorShoppingModal />, shoppingCtx);
    fireEvent.click(tickFor("Duskfall"));
    fireEvent.click(tickFor("Rivière Dorée"));
    const copy = dlg().getAllByRole("button")
      .find((b) => (b.textContent || "").includes("shopping_copy"));
    expect(copy).toBeTruthy();
    fireEvent.click(copy as HTMLElement);
    expect(writeText, "une liste entièrement cochée n'a rien à copier").not.toHaveBeenCalled();
  });
});

describe("ShoppingModal — les coches survivent au rechargement", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  // CE QUE COÛTE LA RUPTURE : la modale est faite pour être ouverte DANS le
  // magasin, sur un téléphone qui recharge l'app dès qu'on change d'onglet.
  // L'écriture dans localStorage était gardée, la RELECTURE ne l'était pas :
  // si elle disparaît, l'utilisateur retrouve une liste vierge au milieu de ses
  // courses et rachète ce qu'il a déjà dans le panier. L'état persisté perdu
  // est silencieux — rien à l'écran ne dit qu'il a été perdu.
  it("relit cave-shopping-checked au montage et rend la ligne pressée", () => {
    localStorage.setItem("cave-shopping-checked", JSON.stringify(["restock:1"]));
    renderWithCtx(<CuratorShoppingModal />, shoppingCtx);
    expect(tickFor("Duskfall").getAttribute("aria-pressed"),
      "la coche posée avant le rechargement doit être encore là").toBe("true");
    expect(tickFor("Rivière Dorée").getAttribute("aria-pressed"),
      "et elle ne doit pas déteindre sur les autres lignes").toBe("false");
  });

  // Le corollaire : ce qui est relu doit être exactement ce qui a été écrit.
  it("ce qui a été coché est ce qui est relu", () => {
    const { unmount } = renderWithCtx(<CuratorShoppingModal />, shoppingCtx);
    fireEvent.click(tickFor("Rivière Dorée"));
    unmount();
    renderWithCtx(<CuratorShoppingModal />, shoppingCtx);
    expect(tickFor("Rivière Dorée").getAttribute("aria-pressed")).toBe("true");
    expect(tickFor("Duskfall").getAttribute("aria-pressed")).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RECHERCHE GLOBALE
// ─────────────────────────────────────────────────────────────────────────────

describe("SearchModal — un résultat CATALOGUE emporte la requête avec lui", () => {
  const mount = (over: Record<string, any>) => render(
    <AppCtx.Provider value={{
      searchOpen: true, lang: "fr", t: (k: string) => k, xl: (v: string) => v,
      weightUnit: "g", lengthUnit: "mm", dateFormat: "fr", currencySymbol: "€",
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      setSearchOpen: vi.fn(), setDetail: vi.fn(), setPipeDet: vi.fn(),
      setAccDet: vi.fn(), setStatusFilter: vi.fn(), setWishFocusId: vi.fn(),
      ...over,
    } as unknown as AppCtxType}>
      <CuratorSearchModal />
    </AppCtx.Provider>);

  // CE QUE COÛTE LA RUPTURE : le catalogue fait ~1200 blends. Toucher un
  // résultat catalogue doit ouvrir la page DÉJÀ filtrée sur ce qu'on cherchait ;
  // si la requête est lâchée en route, on atterrit en haut d'une liste
  // interminable, sans rien qui dise où est passée la correspondance qu'on
  // venait de voir. C'est exactement le défaut que la wishlist avait déjà payé
  // (`h.id` jeté par le même handler) — le seul autre `kind` qui transporte une
  // charge utile n'était gardé par rien.
  it("passe la requête à setCatalogSeed puis navigue vers le catalogue", async () => {
    const setCatalogSeed = vi.fn();
    const nav = vi.fn();
    const setSearchOpen = vi.fn();
    const { container } = mount({ setCatalogSeed, nav, setSearchOpen });
    fireEvent.change(container.querySelector("input")!, { target: { value: "Duskfall" } });

    // Le catalogue est chargé paresseusement : la ligne n'existe qu'après.
    const row = await waitFor(() => {
      const r = dlg().getAllByRole("button")
        .find((b) => /Duskfall/.test(b.textContent || ""));
      expect(r, "le blend du catalogue doit apparaître dans les résultats").toBeTruthy();
      return r as HTMLElement;
    });
    expect(dlg().getByText("search_grp_catalog"),
      "et sous le groupe Catalogue, pas ailleurs").toBeTruthy();

    fireEvent.click(row);
    expect(setCatalogSeed, "la requête doit voyager jusqu'au catalogue").toHaveBeenCalledWith("Duskfall");
    expect(nav).toHaveBeenCalledWith("catalog");
    expect(setSearchOpen).toHaveBeenCalledWith(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPARAISON
// ─────────────────────────────────────────────────────────────────────────────

describe("CompareModal — la croix retire la colonne qu'elle nomme", () => {
  const tob = Object.assign({}, BT, {
    id: 1, brand: "Halvorsen", name: "Duskfall",
    category: "Anglais", cut: "Ribbon", force: 4,
    lots: [{ id: 700, status: "cellar", weightG: "50", datePurchased: "2024-01-01" }],
  });
  const DB: any = {
    brands: { halvorsen: { displayName: "Halvorsen" } },
    blends: {
      "halvorsen|early tide": {
        name: "Early Tide", category: "Virginia/Burley", cut: "Flake", force: 3,
      },
    },
  };

  const twoColumns = () => {
    render(
      <CuratorCompareModal
        open={true} onClose={vi.fn()} db={DB} lang="fr"
        data={{ tobaccos: [tob], wishlist: [], sessions: [], pipes: [], accessories: [] }}
        t={(k: string) => k} xl={(v: string) => v}
        weightUnit="g" currencySymbol="€" seedKey="cellar:1" />);
    const addCard = dlg().getAllByRole("button")
      .find((b) => /cmp_add/.test(b.getAttribute("aria-label") || ""));
    expect(addCard, "le bouton « ajouter un blend » doit exister sous le plafond").toBeTruthy();
    fireEvent.click(addCard as HTMLElement);
    fireEvent.change(screen.getByRole("dialog").querySelector("input")!, { target: { value: "early" } });
    const opt = dlg().getAllByRole("button")
      .find((b) => (b.textContent || "").includes("Early Tide"));
    expect(opt, "le blend catalogue doit être proposé au-delà de 2 lettres").toBeTruthy();
    fireEvent.click(opt as HTMLElement);
    expect(screen.getByRole("dialog").querySelectorAll("[data-compare-col]")).toHaveLength(2);
  };

  // CE QUE COÛTE LA RUPTURE : la croix porte le nom de sa colonne
  // (`cmp_remove` + le nom du blend), donc elle promet quelque chose. Si elle
  // retire une AUTRE colonne, l'utilisateur perd le blend qu'il voulait garder
  // — celui de sa cave, souvent la référence de la comparaison — et doit le
  // retrouver dans un catalogue de ~1200 lignes. Le test existant ne cliquait
  // la croix qu'avec UNE seule colonne, où toute croix retire la bonne : la
  // règle n'était vérifiable qu'à partir de deux.
  it("retire Early Tide et laisse Duskfall", () => {
    twoColumns();
    const remove = dlg().getAllByRole("button")
      .find((b) => /Early Tide/.test(b.getAttribute("aria-label") || ""));
    expect(remove, "chaque croix doit nommer sa propre colonne").toBeTruthy();
    fireEvent.click(remove as HTMLElement);

    const cols = Array.from(screen.getByRole("dialog").querySelectorAll("[data-compare-col]"));
    expect(cols, "une seule colonne doit partir").toHaveLength(1);
    expect(cols[0]!.textContent, "celle qui reste est celle qu'on n'a pas retirée").toContain("Duskfall");
    expect(cols[0]!.textContent).not.toContain("Early Tide");
  });

  it("retire Duskfall et laisse Early Tide (l'autre sens, pour que rien ne passe par hasard)", () => {
    twoColumns();
    const remove = dlg().getAllByRole("button")
      .find((b) => /Duskfall/.test(b.getAttribute("aria-label") || ""));
    expect(remove).toBeTruthy();
    fireEvent.click(remove as HTMLElement);

    const cols = Array.from(screen.getByRole("dialog").querySelectorAll("[data-compare-col]"));
    expect(cols).toHaveLength(1);
    expect(cols[0]!.textContent).toContain("Early Tide");
    expect(cols[0]!.textContent).not.toContain("Duskfall");
  });
});
