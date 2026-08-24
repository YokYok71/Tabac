/**
 * Tests for the i18n layout HARNESS itself (scripts/i18n-layout.cjs).
 *
 * WHY. The layout check is opt-in and needs a browser, so it can go months
 * without running — exactly long enough for the app to drift out from under it.
 * Three of its assumptions were learned by debugging and exist only as prose:
 *
 *   1. Every navigated screen proves it arrived by looking for a string that
 *      exists ONLY there (`expect`, resolved through the dictionary). If that
 *      key is renamed, the screen becomes unreachable — a failure, but only
 *      when someone remembers to run the check.
 *   2. The seed suppresses two states that once broke the run silently: lists
 *      are grouped-and-collapsed by default (no cards → a vacuous pass), and a
 *      never-exported cellar shows the export-reminder banner, which covers the
 *      TopBar and swallowed the "+" and the gear.
 *   3. The seed has to exercise the surfaces being measured at all.
 *
 * These run in `npm test`, need no browser, and fail the moment a dictionary
 * key is renamed out from under the harness — months before anyone would
 * otherwise notice.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages";
import { checkAllInvariants } from "../utils/lotInvariants";
import { migrateData } from "../utils";
import { PROGRESSIVE_STEP } from "../hooks/useProgressiveList";

const requireCjs = createRequire(import.meta.url);
const H = requireCjs("../../scripts/i18n-layout.cjs");
const i18n = requireCjs("../../scripts/i18nChecks.cjs");

// Derived from the registry. It was the literal five codes, so
// this suite silently stopped covering a sixth language the day one was
// added — a guard reporting success on the languages it happened to look at.
const LANGS = LANGUAGES.map((l) => l.code);
// Null-proto: indexed by a language code in a loop, so the repo's own
// tabac-local/no-dynamic-index-plain-map rule applies here too (it caught this).
const dicts: Record<string, any> = Object.create(null);
for (const c of LANGS) {
  dicts[c] = i18n.parseDictSource(readFileSync(`src/i18n/${c}.ts`, "utf8"));
}

describe("the harness's navigation keys resolve in every language", () => {
  it("every screen's `expect` marker key exists in all five dictionaries", () => {
    const expected = H.SCREENS.filter((s: any) => s.expect);
    // A guard that checks nothing is worse than none: if the dense screens ever
    // lose their markers, this must fail rather than pass vacuously.
    expect(expected.length).toBeGreaterThanOrEqual(6);
    for (const scr of expected) {
      for (const c of LANGS) {
        expect(dicts[c][scr.expect], `${scr.name}: "${scr.expect}" missing from ${c}.ts`)
          .toBeTruthy();
      }
    }
  });

  it("the keys it navigates BY exist in all five dictionaries", () => {
    // The script clicks a control by its TRANSLATED label; a renamed key makes
    // the screen unreachable, so every key any `go()` resolves must exist.
    //
    // This list used to be HARDCODED (`btn_add`, `btn_settings`,
    // `tab_*`) — so the two screens added that build navigated by two keys this
    // guard could not see. A test that only checks the keys someone remembered
    // to list is the same blind spot the build is about. The keys are now READ
    // OUT of the source of every `go()` body, so a new screen is covered the
    // moment it is written.
    const src = readFileSync(requireCjs.resolve("../../scripts/i18n-layout.cjs"), "utf8");
    const found = new Set<string>();
    // `label(dict, "some_key", lang)` — the one accessor every go() uses. The
    // trailing `,` is required so a CONCATENATED argument (`"tab_" + tab`) is
    // not mistaken for a whole key: without it the extraction yielded the bare
    // prefix "tab_" and the guard failed on a key that does not exist.
    for (const m of src.matchAll(/\blabel\(\s*dict\s*,\s*"([A-Za-z0-9_]+)"\s*,/g)) found.add(m[1]!);
    // Plus the tab keys, built dynamically as "tab_" + tab.
    for (const tab of ["prefs", "data", "app", "help"]) found.add("tab_" + tab);

    // Non-vacuity: if the extraction ever stops matching, fail loudly rather
    // than pass with an empty set.
    expect(found.size, "extracted no nav keys — has label(dict, \"key\") changed shape?")
      .toBeGreaterThanOrEqual(6);
    expect(found.has("btn_add"), "btn_add should be among the extracted nav keys").toBe(true);

    for (const k of found) {
      for (const c of LANGS) {
        expect(dicts[c][k], `nav key "${k}" missing from ${c}.ts`).toBeTruthy();
      }
    }
  });

  it("renders the RETIRED slices, not just the active ones", () => {
    // The fixture used to hold only status:"active" rows AND both lists default
    // to active-only, so the retired card branch never reached a measurement —
    // which is how a whole-card opacity dropping its text to ~2.3:1 in all six
    // theme×mode combos went unseen by both browser checks. Data AND screen are
    // needed; assert both, or the next fixture tidy-up quietly undoes it.
    expect(H.DATA.pipes.some((p: any) => p.status !== "active"),
      "the fixture needs a retired PIPE").toBe(true);
    expect(H.DATA.accessories.some((a: any) => a.status !== "active"),
      "the fixture needs a retired ACCESSORY").toBe(true);
    const names = H.SCREENS.map((s: any) => s.name);
    expect(names).toContain("pipes-retired");
    expect(names).toContain("acc-retired");
  });

  it("covers the dense surfaces, not just the dock pages", () => {
    const names = H.SCREENS.map((s: any) => s.name);
    expect(names).toContain("form-tobacco");
    expect(names).toContain("form-pipe");
    for (const tab of ["prefs", "data", "app", "help"]) {
      expect(names).toContain("settings-" + tab);
    }
  });

  // ── the FICHES and the MODALS ────────────────────────────
  // Neither browser check had ever rendered a detail page or a dialog. That
  // gap hid four sub-AA light-mode tokens whose every text instance lives on
  // one of those surfaces, and a trash row that clipped 84% of the item name
  // in German. Both checks share this list, so both gained the coverage.
  it("covers the three fiches and the modals", () => {
    const names = H.SCREENS.map((s: any) => s.name);
    for (const n of ["fiche-tobacco", "fiche-pipe", "fiche-acc",
                     "modal-lot", "modal-trash", "modal-shopping"]) {
      expect(names, `screen "${n}" is no longer measured`).toContain(n);
    }
  });

  it("seeds what those screens need in order to exist at all", () => {
    // Each of these is a screen GATE, not decoration: without the row the
    // control is absent, the navigation cannot land, and the screen would be
    // skipped — which is how a surface silently stops being measured.
    const softDeleted = [...H.DATA.accessories, ...H.DATA.tobaccos, ...H.DATA.pipes]
      .some((x: any) => x.deletedAt);
    expect(softDeleted, "no soft-deleted row → the trash indicator never renders").toBe(true);

    // computeShoppingList's restock needs 0 < activeWeight <= threshold, so an
    // already-empty tobacco does NOT qualify. Without a genuinely low-stock row
    // the modal opens showing the wishlist only and the arrival check fails.
    const lowStock = H.DATA.tobaccos.some((t: any) => {
      if (t.rebuy === false) return false;
      const w = (t.lots || [])
        .filter((l: any) => l.status !== "finished" && !l.deletedAt)
        .reduce((a: number, l: any) => a + (parseFloat(l.weightG) || 0), 0);
      return w > 0 && w <= 25;
    });
    expect(lowStock, "no low-stock rebuy tobacco → the cart icon never renders").toBe(true);

    expect(H.DATA.tobaccos.some((t: any) => (t.tags || []).length),
      "no tags → TagChipRow never renders, and its label was the worst finding").toBe(true);
    expect(H.DATA.pipes.some((p: any) => (p.maintenance || []).length),
      "no maintenance entries → the pipe fiche's log section is empty").toBe(true);
  });

  // ── the FORMS and the remaining overlays ──────────────────
  // An earlier release promoted the six surfaces that had findings; the audit had actually
  // rendered 24. "Measured clean once" is not "covered" — nothing stopped those
  // from regressing. The forms are the priority of what was left: label + field
  // + hint per row is where German runs longest.
  it("covers the forms and the remaining overlays", () => {
    const names = H.SCREENS.map((s: any) => s.name);
    for (const n of ["form-session", "form-acc", "form-wish",
                     "edit-tobacco", "edit-pipe",
                     "modal-lot-form", "modal-maint", "modal-session",
                     "tasting-setup"]) {
      expect(names, `screen "${n}" is no longer measured`).toContain(n);
    }
  });

  it("the lot FORM modal is a distinct screen from the lot DETAIL modal", () => {
    // Different components (LotFormModal vs the read-only modal in
    // InventoryDetailView) and different markers. Collapsing them would silently
    // stop measuring the one with the dense field grid.
    const byName = new Map<string, any>((H.SCREENS as any[]).map((s) => [s.name, s]));
    const detail = byName.get("modal-lot"), form = byName.get("modal-lot-form");
    expect(detail?.expect).toBe("lbl_current");
    expect(form?.expect).toBe("lbl_initial_weight");
    expect(detail?.expect).not.toBe(form?.expect);
  });

  it("every screen marker is unique, so no screen can pass by measuring another", () => {
    // The defect in one assertion: `modal-lot` used `lbl_initial`,
    // which the fiche also renders, so the run reported it reached while
    // measuring the fiche underneath. Two screens MAY share a marker only when
    // the navigation path is what distinguishes them — the two edit forms use
    // `lbl_edit`, the edit-mode overline, because an edit form is literally the
    // same component as its add form and no marker can separate them.
    // A marker may be shared ONLY when the screens are the same COMPONENT in a
    // different state — an edit form is literally its add form, and a retired
    // pipe's fiche is the pipe fiche. There, no marker can separate them and the
    // navigation path is what does. What the rule forbids is a marker shared
    // across DIFFERENT components, which is the defect: `lbl_initial`
    // let the lot modal report "reached" while measuring the fiche underneath.
    const SHARED_BY_DESIGN = new Set(["lbl_edit", "sec_specs"]);
    const seen = new Map<string, string[]>();
    for (const s of H.SCREENS as any[]) {
      if (!s.expect) continue;
      seen.set(s.expect, [...(seen.get(s.expect) || []), s.name]);
    }
    for (const [key, screens] of seen) {
      if (screens.length > 1 && !SHARED_BY_DESIGN.has(key)) {
        throw new Error(`marker "${key}" is used by ${screens.join(", ")} — a shared marker means one of them can report "reached" while measuring the other`);
      }
    }
    // Non-vacuity: every exemption must actually be in use, or it is dead
    // licence that quietly widens next time someone needs a marker.
    expect(seen.get("lbl_edit")?.length, "lbl_edit should be shared by the 2 edit forms").toBe(2);
    expect(seen.get("sec_specs")?.length, "sec_specs should be shared by the 2 pipe fiches").toBe(2);
  });

  // ── the last three surfaces + one variant ────────────────
  // After this the committed coverage matches exactly what the audit rendered
  // once, so nothing is left "clean but unprotected".
  it("covers the last three surfaces the audit had rendered", () => {
    const names = H.SCREENS.map((s: any) => s.name);
    for (const n of ["wishlist", "catalog", "modal-search"]) {
      expect(names, `screen "${n}" is no longer measured`).toContain(n);
    }
  });

  it("covers a RETIRED pipe's fiche, not just an active one", () => {
    // Same component, different branch — and that branch is what hid the
    // whole-card opacity (text at ~2.3:1 in all six theme×mode combos)
    // for as long as the fixture held only active pipes. A list screen showing
    // the retired CARD is not the same as its fiche.
    const names = H.SCREENS.map((s: any) => s.name);
    expect(names).toContain("fiche-pipe-retired");
    expect(H.DATA.pipes.some((p: any) => p.status !== "active" && p.name === "Shell Briar"),
      "the retired pipe the fiche screen navigates to must exist by that name").toBe(true);
  });

  it("seeds the LONGEST canonical category labels", () => {
    // A real export settled this: the fixture's categories all happened to be
    // short, so the Home "Familles" row clipping "Aromatique" (71px) and
    // "Virginia/Burley" (88px) in a 66px box — at the DEFAULT text size, in
    // French, on every user's home screen — was unreachable by any run. These
    // are enum VALUES, not invented strings, so seeding them is free realism.
    const cats = H.DATA.tobaccos.map((t: any) => t.category);
    expect(cats, "the longest category label must be exercised").toContain("Virginia/Burley");
    expect(cats).toContain("Aromatique");
  });
});

describe("the seed keeps suppressing what once broke the run", () => {
  it("turns default grouping OFF so cards actually render", () => {
    // Without this the lists are collapsed, nothing is measured, and the check
    // reports OK having looked at nothing.
    expect(H.SEED_KEYS["cave-default-grouped"]).toBe("0");
  });

  it("stamps a recent export so the reminder banner cannot cover the TopBar", () => {
    // The banner is position:fixed at the top; it swallowed the "+" and the
    // gear, and the Settings modal opened on the wrong tab because the tab
    // click landed on the banner.
    expect(H.SEED_KEYS["cave-last-export-ts"]).toBe("@now");
  });

  it("gets past the terms gate and the welcome modal", () => {
    expect(H.SEED_KEYS["cave-terms-accepted"]).toBe("1");
    expect(H.SEED_KEYS["cave-curator-welcomed"]).toBe("1");
  });

  it("only seeds keys the app actually reads", () => {
    // A stale key would silently stop doing its job, so each must appear
    // somewhere in the source.
    //
    // This used to read a HARDCODED list of five remembered files —
    // and it broke the moment `cave-curator-welcomed` was centralised into
    // constants.ts (a strict improvement: it had been three local consts plus
    // one inline literal). A guard that only looks where someone remembered to
    // point it fails on good changes and passes on bad ones, which is the exact
    // blind-spot shape this whole build is about. It now walks all of src/.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = dir + "/" + e.name;
        if (e.isDirectory()) { if (e.name !== "__tests__") walk(full); continue; }
        if (/\.(ts|tsx|js|jsx)$/.test(e.name)) files.push(full);
      }
    };
    walk("src");
    // Non-vacuity: an empty sweep would make every assertion below trivially
    // true, which is how a broken guard reads as a passing one.
    expect(files.length, "walked no source files").toBeGreaterThan(100);
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const k of Object.keys(H.SEED_KEYS)) {
      expect(src.includes(k), `${k} is seeded but no source file reads it`).toBe(true);
    }
  });
});

describe("the seed exercises the surfaces being measured", () => {
  it("has tobaccos with jar AND cellar AND finished lots", () => {
    const lots = H.DATA.tobaccos.flatMap((t: any) => t.lots || []);
    for (const st of ["jar", "cellar", "finished"]) {
      expect(lots.some((l: any) => l.status === st), `no ${st} lot in the seed`).toBe(true);
    }
  });

  // The seed must be a cellar the APP considers healthy.
  //
  // An earlier release added a "sessions smoked from this lot" list to the lot detail
  // modal, and every seeded session carried `lotId: ""`, so `modal-lot`
  // measured the EMPTY state in all 24 combinations — the populated case, the
  // One that can overflow, was covered by nothing. The rule again:
  // the seed is a screen GATE, not decoration.
  //
  // Attributing sessions to a lot makes the BALANCE load-bearing. An
  // unbalanced lot trips `useLotIntegrityProbe` 1.5 s after load, which turns
  // the Settings diagnostic section oxblood — silently changing what the
  // settings-app screen measures, in a way a green run would never mention.
  it("is a cellar the app's own invariants accept", () => {
    const v = checkAllInvariants(migrateData(JSON.parse(JSON.stringify(H.DATA))));
    expect(v.map((x: any) => `${x.rule} ${x.detail || ""}`)).toEqual([]);
  });

  it("attributes sessions to a lot, so the lot modal lists something", () => {
    const lots = H.DATA.tobaccos.flatMap((t: any) => t.lots || []);
    const withSess = lots.filter((l: any) =>
      H.DATA.sessions.some((s: any) => String(s.lotId || "") === String(l.id)));
    expect(withSess.length, "no lot is referenced by any session").toBeGreaterThan(0);
    // Several rows, not one: a single row cannot show a list overflowing.
    const n = H.DATA.sessions.filter((s: any) => String(s.lotId || "") === String(withSess[0]!.id)).length;
    expect(n, "one row does not exercise a list").toBeGreaterThanOrEqual(3);
  });

  it("keeps an UNATTRIBUTED session too — both journal states stay measured", () => {
    // An orphaned bowl is ordinary (the detach, accounting off, a
    // legacy row), so the fixture must not be uniformly tidy.
    expect(H.DATA.sessions.some((s: any) => !s.lotId)).toBe(true);
  });

  it("has a no-rebuy tobacco — the third badge that tips the tight row over", () => {
    // The card footer row (weight | badges) only reaches its limit once a third
    // badge appears; without one the canary would never fire.
    expect(H.DATA.tobaccos.some((t: any) => t.rebuy === false)).toBe(true);
  });

  it("populates every list the check visits", () => {
    expect(H.DATA.pipes.length).toBeGreaterThan(1);
    expect(H.DATA.accessories.length).toBeGreaterThan(0);
    expect(H.DATA.wishlist.length).toBeGreaterThan(0);
    expect(H.DATA.sessions.length).toBeGreaterThan(1);
  });

  it("carries enum values in their CANONICAL French form", () => {
    // Enum values are stored canonical and translated at render (xl()). A seed
    // holding "English" instead of "Anglais" would render as "Autre" and the
    // check would measure the wrong strings.
    const cats = H.DATA.tobaccos.map((t: any) => t.category);
    expect(cats).toContain("Anglais");
    expect(H.DATA.pipes[0].bowlMaterial).toBe("Bruyère");
    expect(H.DATA.accessories[0].type).toBe("Briquet");
  });
});

describe("the enlarged cellar reaches the control it exists for", () => {
  // The flat lists render a bounded prefix, so the « Afficher la suite (N) »
  // footer only appears above `PROGRESSIVE_STEP` rows — and the shared seed
  // holds 18 tobaccos, so neither browser check had ever measured that control
  // in any language. The `inv-long` screen swaps in a bigger cellar for itself.
  const big = H.bigListCellar();

  it("holds more rows than the cap, or the footer never renders", () => {
    expect(big.tobaccos.length).toBeGreaterThan(PROGRESSIVE_STEP);
    // With margin: a step that grew slightly must not silently un-reach it.
    expect(big.tobaccos.length).toBeGreaterThanOrEqual(PROGRESSIVE_STEP + 20);
  });

  it("is itself a cellar the app's own invariants accept", () => {
    // Same rule as the base seed. An unbalanced clone would trip
    // `useLotIntegrityProbe` 1.5 s after load and change what the screen
    // measures, without the run saying a word.
    const v = checkAllInvariants(migrateData(JSON.parse(JSON.stringify(big))));
    expect(v.map((x: any) => `${x.rule} ${x.detail || ""}`)).toEqual([]);
  });

  it("its clones survive the ACTIVE filter", () => {
    // A lot-less tobacco is excluded from the default list (`countActive`
    // requires a non-finished lot), so clones without one would never reach the
    // list at all and the screen would measure the ordinary 18 rows.
    const clones = big.tobaccos.filter((t: any) => String(t.uid || "").startsWith("seed-big-"));
    expect(clones.length).toBe(H.BIG_LIST_ROWS);
    for (const c of clones) {
      expect((c.lots || []).some((l: any) => l.status !== "finished"),
        `clone ${c.uid} has no active lot`).toBe(true);
    }
  });

  it("the screen exists, asks for the footer by name, and is the only bigList one", () => {
    const scr = H.SCREENS.filter((x: any) => x.bigList);
    expect(scr.length, "exactly one screen should carry the enlarged cellar").toBe(1);
    expect(scr[0].expect, "the marker must prove the FOOTER is on screen, not just the list")
      .toBe("list_more");
  });

  it("pins the cellar across the reload it needs", () => {
    // THE DEFECT THIS CAUGHT, and it is the reason the case exists rather than
    // a comment: `addInitScript` runs before EVERY page load in the context, so
    // the reload a cellar swap requires immediately overwrote the swapped
    // cellar. The screen then reported as unreachable — a seed that never
    // arrived, dressed as a navigation problem, which is exactly the diagnosis
    // this harness has been fooled by before.
    const src = readFileSync("scripts/i18n-layout.cjs", "utf8");
    expect(src).toMatch(/__harness-cellar-pinned/);
    expect(src, "the init script must honour the pin, not just set it")
      .toMatch(/if \(localStorage\.getItem\("__harness-cellar-pinned"\) !== "1"\)/);
    expect(src, "the swap must set the pin, or the reload undoes it")
      .toMatch(/setCellar\(page, scr\.bigList \? bigListCellar\(\) : DATA, !!scr\.bigList\)/);
  });

  it("a marker carrying a placeholder is matched on what the app renders", () => {
    // `list_more` is "Mehr anzeigen ({n})" and the app interpolates the count,
    // so the raw dictionary value never appears on the page. Truncating at the
    // placeholder is the fix; the LENGTH GUARD is what keeps it honest, since a
    // value beginning with its placeholder would leave a prefix short enough to
    // match half the page and turn "screen reached" into a vacuous pass.
    expect(H.markerText("Mehr anzeigen ({n})", "list_more")).toBe("Mehr anzeigen (");
    expect(H.markerText("Arômes", "x")).toBe("Arômes");
    expect(() => H.markerText("{n} restants", "x")).toThrow();
  });

  it("does not leave the enlarged cellar behind for the next screen", () => {
    // The catalogue swap taught this: a state a screen sets must be restored, or
    // every screen after it measures a page no user has.
    const src = readFileSync("scripts/i18n-layout.cjs", "utf8");
    expect(src).toMatch(/if \(scr\.bigList \|\| prevBigList\)/);
    expect(src).toMatch(/setCellar\(page, scr\.bigList \? bigListCellar\(\) : DATA,/);
  });
});

describe("the axes are what the docs claim", () => {
  it("renders both text sizes and both viewports by default", () => {
    expect(H.SCALES).toEqual(["m", "l"]);
    expect(H.WIDTHS).toEqual([360, 820]);
  });

  it("820px clears the 760px column cap", () => {
    // Below ~784 the column is width-limited by the viewport, so the wide
    // layout (two-column grids, the centred dock pill) is never exercised.
    const wide = Math.max(...H.WIDTHS);
    expect(wide).toBeGreaterThan(760 + 12 * 2);
  });
});

/**
 * The checker must check EVERY language.
 *
 * Until then `LANGS` defaulted to the literal "fr,en,es,de,it", so the full
 * `npm run i18n:layout` measured five languages and reported a clean matrix —
 * in the one script whose stated purpose includes "run it when you add a
 * language". Portuguese was never rendered by a default run; the clipped dock
 * label that fixed only surfaced because I happened to pass
 * I18N_LAYOUT_LANGS=pt by hand.
 *
 * That is the same silent-subset shape as the six sites LANG_ASSETS replaced,
 * except located in the guard itself — which is the worst place for it, because
 * a green report from a checker is what stops anyone looking further.
 */
describe("the language axis is derived, not copied", () => {
  it("covers every language in the registry by default", () => {
    for (const { code } of LANGUAGES) {
      expect(H.LANGS, `i18n:layout would not render "${code}" in a default run`).toContain(code);
    }
  });

  it("does not render a language that has no dictionary", () => {
    // The reverse drift: a code left in the list after its dictionary is gone
    // would fail every screen for a reason unrelated to layout.
    const codes = LANGUAGES.map((l) => l.code);
    for (const l of H.LANGS) expect(codes, `"${l}" has no dictionary`).toContain(l);
  });

  it("reads the codes out of languages.ts rather than restating them", () => {
    // Probed by deletion: a literal list passes the two cases above on the day
    // it is written and rots the moment a language is added, which is exactly
    // what happened. Assert the mechanism, not just today's result.
    const src = readFileSync("scripts/i18n-layout.cjs", "utf8");
    expect(src).toMatch(/function registryLangs\(\)/);
    expect(src, "the default must not be a hardcoded language list")
      .not.toMatch(/I18N_LAYOUT_LANGS[^)]*"(?:[a-z]{2,3},){2}/);
  });
});
