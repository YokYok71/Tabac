/**
 * The category palette must be complete in BOTH modes.
 *
 * WHY. `catColor()` used to read raw hex from constants.ts, so the category
 * accents did not follow the light/dark mode: on the parchment ground
 * "Virginia" rendered at 2:1, well under AA. `npm run theme:contrast` measured
 * it; option B was chosen — keep the bright identity for dark mode and give
 * every family a darkened light-mode variant.
 *
 * That makes the palette a pair of tables joined by a slug, which is exactly
 * the kind of coupling that rots silently: add a category and forget its
 * `--c-cat-<slug>` override, and it simply stays bright on cream, unreadable,
 * with nothing failing. These cases are that join.
 *
 * The contrast VALUES are re-derived here rather than trusted: the light
 * variants were computed to clear 4.6:1 on the darker of the two light grounds,
 * so the arithmetic is checked, not just the presence of a key.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CATS, CAT_COLORS } from "../constants";
import { MODE_LIGHT } from "../theme-curator";

/** WCAG relative luminance / contrast, same maths as scripts/theme-contrast.cjs. */
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const hex2rgb = (h: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lum = (h: string) => {
  const [r, g, b] = hex2rgb(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: string, b: string) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// The two light grounds. The PAGE is the darker one, so it is the worst case
// for dark ink — that is what the variants were computed against.
const LIGHT_PAGE = MODE_LIGHT["--c-bg"]!;
const LIGHT_CARD = MODE_LIGHT["--c-bg2"]!;

const slugOf = (value: string) => {
  const m = value.match(/^var\((--c-cat-[a-z0-9-]+),/);
  return m ? m[1]! : "";
};

describe("category palette — dark identity, light legibility", () => {
  it("the two light grounds are what the variants were computed against", () => {
    // If someone retunes MODE_LIGHT's surfaces, the ratios below move — this
    // pins the assumption so the failure names the real cause.
    expect(LIGHT_PAGE.toLowerCase()).toBe("#e7ddc6");
    expect(LIGHT_CARD.toLowerCase()).toBe("#f2ecdb");
    expect(lum(LIGHT_PAGE)).toBeLessThan(lum(LIGHT_CARD));
  });

  it("every CATS entry has an accent", () => {
    const missing = (CATS as readonly string[]).filter((c) => !CAT_COLORS[c]);
    expect(missing).toEqual([]);
  });

  it("every accent has a light-mode override under the same slug", () => {
    const missing: string[] = [];
    for (const cat of CATS as readonly string[]) {
      const slug = slugOf(CAT_COLORS[cat] || "");
      expect(slug, `${cat}: value is not a var() with a slug`).toBeTruthy();
      if (!MODE_LIGHT[slug]) missing.push(`${cat} (${slug})`);
    }
    expect(missing, "categories with no light-mode colour — they would stay bright on cream").toEqual([]);
  });

  it("every light-mode accent clears AA on BOTH light grounds", () => {
    const bad: string[] = [];
    for (const cat of CATS as readonly string[]) {
      const light = MODE_LIGHT[slugOf(CAT_COLORS[cat] || "")]!;
      const onPage = ratio(light, LIGHT_PAGE);
      const onCard = ratio(light, LIGHT_CARD);
      if (onPage < 4.5 || onCard < 4.5) {
        bad.push(`${cat} ${light}: page ${onPage.toFixed(2)}:1, card ${onCard.toFixed(2)}:1`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the DARK fallbacks are untouched — the vault look must not shift", () => {
    // Option B kept the bright identity for dark mode; the fallback in each
    // var() is what paints there. A change here is a visual change to four
    // screens and should be deliberate.
    expect(CAT_COLORS["Virginia"]).toContain("#d4a03a");
    expect(CAT_COLORS["Burley"]).toContain("#a06eff");
    expect(CAT_COLORS["Balkan"]).toContain("#4a9eff");
  });

  it("no light override is left over for a category that no longer exists", () => {
    const live = new Set((CATS as readonly string[]).map((c) => slugOf(CAT_COLORS[c] || "")));
    const stale = Object.keys(MODE_LIGHT)
      .filter((k) => k.startsWith("--c-cat-"))
      .filter((k) => !live.has(k));
    expect(stale, "light overrides for removed categories").toEqual([]);
  });

  it("every --c-cat-* var is cleared by applyTheme (THEME_VARS)", () => {
    // applyTheme wipes THEME_VARS before applying a palette; a var missing
    // there would survive a switch back to dark and paint the light colour.
    const src = readFileSync("src/theme-curator.ts", "utf8");
    // Slice from the opening bracket of the ARRAY, not the `string[]` type
    // annotation that precedes it (my first attempt cut at that `]`).
    const decl = src.indexOf("export const THEME_VARS");
    const open = src.indexOf("= [", decl) + 3;
    const listed = src.slice(open, src.indexOf("];", open));
    for (const cat of CATS as readonly string[]) {
      const slug = slugOf(CAT_COLORS[cat] || "");
      expect(listed, `${slug} missing from THEME_VARS`).toContain(`"${slug}"`);
    }
  });
});
