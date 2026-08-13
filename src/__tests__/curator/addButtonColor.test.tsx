// Anti-regression: the primary "+" add button in every list view must use
// the bright-section-accent-bg + `color={C.bg}` convention so the icon
// flips OPPOSITE the accent and stays legible in BOTH light and dark mode.
//
// The bug this locks: PipesListView used `bg={C.oxblood}` +
// `color={C.ivory}`. In light mode `C.ivory` flips dark → a dark "+" on the
// dark-red button. The fix aligned it with Inventory/Accessories:
// `bg={C.oxbloodHi}` + `color={C.bg}`. Any view that regresses to a flipping
// light token (ivory/cream) on its add button fails here.

import { describe, it, expect } from "vitest";
import { renderWithCtx } from "../viewTestUtils";
import { C } from "../../theme-curator.ts";
import { CuratorInventoryListView } from "../../views/curator/InventoryListView";
import { CuratorPipesListView } from "../../views/curator/PipesListView";
import { CuratorAccListView } from "../../views/curator/AccListView";

const emptyData = { pipes: [], tobaccos: [], accessories: [], sessions: [], wishlist: [] };

// Each list view + the ctx it needs to render its TopBar (no rows, no trash).
const CASES: Array<{ name: string; ui: React.ReactElement; ctx: Record<string, any> }> = [
  {
    name: "InventoryListView",
    ui: <CuratorInventoryListView />,
    ctx: { view: "inv", detail: null, statusFilter: "active", filtered: [], data: emptyData },
  },
  {
    name: "PipesListView",
    ui: <CuratorPipesListView />,
    ctx: { view: "pipes", pipeDet: null, filteredPipes: [], data: emptyData },
  },
  {
    name: "AccListView",
    ui: <CuratorAccListView />,
    ctx: { view: "acc", accDet: null, data: emptyData },
  },
];

describe("list-view add button — color convention", () => {
  for (const { name, ui, ctx } of CASES) {
    it(`${name} '+' uses color={C.bg} on a non-transparent accent bg`, () => {
      const { container } = renderWithCtx(ui, ctx);
      const buttons = Array.from(container.querySelectorAll("button"));
      // The add button is the only one styled with color === C.bg (search
      // uses the default C.tx; the leading section icon uses its accent).
      const addButtons = buttons.filter((b) => b.style.color === C.bg);
      expect(addButtons).toHaveLength(1);
      const add = addButtons[0]!;
      // …and its background must be a real accent, never "transparent".
      expect(add.style.background).not.toBe("transparent");
      expect(add.style.background).not.toBe("");
      // Guard against the exact regression: no flipping light token.
      expect(add.style.color).not.toBe(C.ivory);
      expect(add.style.color).not.toBe(C.cream);
    });
  }
});
