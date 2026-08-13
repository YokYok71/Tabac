/**
 * colour theme + light/dark mode infrastructure.
 * Covers the pure `alpha()` tint helper + the `THEMES` registry +
 * `MODE_LIGHT` + the mode-aware `applyTheme()` <html> CSS-var writer
 * (the swap mechanism behind the Settings "Thème" + "Mode" toggles).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { alpha, THEMES, THEME_VARS, MODE_LIGHT, applyTheme, C } from "../theme-curator.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("alpha()", () => {
  it("converts a 2-hex-digit alpha suffix to an equivalent color-mix()", () => {
    // "88" = 136/255 ≈ 53.3%
    expect(alpha("#d4a661", "88")).toBe("color-mix(in srgb, #d4a661 53.3%, transparent)");
    // "22" = 34/255 ≈ 13.3%
    expect(alpha(C.brass, "22")).toBe(`color-mix(in srgb, ${C.brass} 13.3%, transparent)`);
  });
  it("works with a var() colour (the whole point — hex concat would be invalid)", () => {
    expect(alpha("var(--c-brass, #d4a661)", "ff"))
      .toBe("color-mix(in srgb, var(--c-brass, #d4a661) 100%, transparent)");
  });
  it("falls back to the raw colour on an unparseable suffix", () => {
    expect(alpha("#123456", "zz")).toBe("#123456");
  });
});

const HEX = /^#[0-9a-f]{6}$/i;

describe("THEMES registry", () => {
  it("ships brass, steel and english with theme_<id> labels", () => {
    expect(Object.keys(THEMES).sort()).toEqual(["brass", "english", "steel"]);
    for (const id of Object.keys(THEMES)) expect(THEMES[id]!.label).toBe("theme_" + id);
  });
  it("brass has no dark overrides (fallback vault); steel/english override real hex vars", () => {
    expect(THEMES.brass!.vars).toEqual({});
    for (const id of ["steel", "english"]) {
      const keys = Object.keys(THEMES[id]!.vars);
      expect(keys.length).toBeGreaterThan(0);
      keys.forEach((k) => expect(THEME_VARS).toContain(k));
      Object.values(THEMES[id]!.vars).forEach((v) => expect(v).toMatch(HEX));
    }
  });
  it("every theme carries a lightAccent (brass trio + title + top glow), all known vars", () => {
    for (const id of Object.keys(THEMES)) {
      expect(Object.keys(THEMES[id]!.lightAccent).sort())
        .toEqual(["--c-brass", "--c-brass-dim", "--c-brass-hi", "--c-title", "--c-wash-top"]);
      Object.keys(THEMES[id]!.lightAccent).forEach((k) => expect(THEME_VARS).toContain(k));
      // accents are hex; the top-glow is an rgba().
      Object.values(THEMES[id]!.lightAccent).forEach((v) =>
        expect(v).toMatch(/^(#[0-9a-f]{6}|rgba?\([\d.,\s]+\))$/i));
    }
  });
  it("MODE_LIGHT only sets known theme vars, all real colours (hex or rgba)", () => {
    Object.keys(MODE_LIGHT).forEach((k) => expect(THEME_VARS).toContain(k));
    // Every theme var used to be a bare colour. `--c-dock-shadow`
    // is the first that is not — it carries a whole box-shadow list, because the
    // dock's elevation has to differ by mode (a white inset bevel is meaningless
    // on a near-white pill, and a 0.5-alpha shadow is far too heavy on cream).
    // Keep the colour rule for everything else rather than loosening it to
    // "anything": an unchecked value is how a junk var would slip in.
    const NON_COLOUR = new Set(["--c-dock-shadow"]);
    Object.entries(MODE_LIGHT).forEach(([k, v]) => {
      if (NON_COLOUR.has(k)) return;
      // Surfaces/text/semantics are hex; the decorative wash is an rgba() glow.
      expect(v, `${k} should be a colour`).toMatch(/^(#[0-9a-f]{6}|rgba?\([\d.,\s]+\))$/i);
    });
    // The shadow still has to BE a shadow: a length offset plus a colour.
    const shadow = MODE_LIGHT["--c-dock-shadow"]!;
    expect(shadow).toMatch(/\d+px/);
    expect(shadow).toMatch(/rgba?\([\d.,\s]+\)|#[0-9a-f]{3,8}/i);
  });

  it("the dock pill is equally translucent in both modes", () => {
    // An earlier release flipped the pill's tint for light mode AND raised its alpha
    // 0.24 → 0.72, while its comment said "same translucency, opposite tint".
    // Nothing checked that claim, so light mode shipped three times more opaque
    // than dark — a near-solid slab where dark had frosted glass. Reported from
    // the app. Only the TINT was ever needed to fix the 2.27:1 label contrast.
    const alphaOf = (s: string) => {
      const m = s.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
      expect(m, `no rgba alpha found in "${s}"`).toBeTruthy();
      return parseFloat(m![1]!);
    };
    // C.dockPill is `var(--c-dock-pill, <dark value>)` — the fallback IS dark mode.
    expect(alphaOf(C.dockPill)).toBe(alphaOf(MODE_LIGHT["--c-dock-pill"]!));
  });

  it("the dock's DARK elevation is byte-identical to the pre-tokenisation value", () => {
    // The dock is the one component whose look can only be trusted on an
    // INSTALLED iOS PWA, so tokenising its shadow was only safe because the dark
    // fallback did not move. Pinning the exact string is what makes that
    // claim checkable rather than asserted.
    expect(C.dockShadow).toBe(
      "var(--c-dock-shadow, 0 14px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04))",
    );
    // Light mode drops the white bevel entirely — an inset highlight exists to
    // catch light on a DARK surface; on cream it is invisible noise.
    expect(MODE_LIGHT["--c-dock-shadow"]).not.toContain("inset");
    expect(MODE_LIGHT["--c-dock-shadow"]).not.toContain("255,255,255");
    // ...and the dock must actually USE it. Asserting only the token strings
    // left the whole fix revertible with nothing red: putting the old
    // literal back in BottomDock passed every test and every lint rule, because
    // the tinted-rgba ban exempts pure-neutral values — which is precisely why
    // the shadow stayed mode-blind for so long. The pill's `background` is
    // caught by no-restricted-syntax; the elevation was guarded by nothing.
    const dock = readFileSync(resolve(__dirname, "../components/curator/BottomDock.tsx"), "utf8");
    expect(dock, "BottomDock must consume C.dockShadow").toContain("boxShadow: C.dockShadow");
    // Target the DEFECT, not every literal. A first version banned any quoted
    // boxShadow and immediately flagged the brass indicator's glow — a correct
    // `\`0 0 10px ${alpha(accent, "aa")}\`` — i.e. it repeated, in a test, the
    // over-strict mistake just fixed in the lint rule: a guard that forces
    // correct code to be rewritten to please it.
    const code = dock.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "the mode-blind shadow must not come back inline")
      .not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.5\)|inset 0 1px 0 rgba\(255,\s*255,\s*255/);
  });
});

describe("applyTheme()", () => {
  beforeEach(() => {
    THEME_VARS.forEach((v) => document.documentElement.style.removeProperty(v));
  });
  const get = (v: string) => document.documentElement.style.getPropertyValue(v);

  it("dark mode sets the steel accent + surface overrides", () => {
    applyTheme("steel", "dark");
    expect(get("--c-brass")).toBe("#7fb0d8");
    expect(get("--c-bg")).toBe("#0c1017");
    // dark mode leaves text/semantic on their fallback (no override)
    expect(get("--c-tx")).toBe("");
  });
  it("light mode applies the parchment base + the theme's dark accent", () => {
    applyTheme("steel", "light");
    // parchment surfaces + dark text from MODE_LIGHT
    expect(get("--c-bg")).toBe("#e7ddc6");
    expect(get("--c-tx")).toBe("#2e2a1e");
    expect(get("--c-ink")).toBe("#f4eede");
    // steel's DARK accent (not the pale dark-mode blue)
    expect(get("--c-brass")).toBe("#2f6088");
    expect(get("--c-title")).toBe("#284f70");
  });
  it("brass light mode still gets the parchment base + a dark gold accent", () => {
    applyTheme("brass", "light");
    expect(get("--c-bg")).toBe("#e7ddc6");
    // The exact value is owned by `npm run theme:contrast` (it must clear AA on
    // the parchment ground, so a triage pass may retune it — one pass moved it
    // from #7d5f18). What this pin proves is the BRANCH: light mode applied the
    // lightAccent map, not the dark vars (whose fallback is a pale #d4a661).
    expect(get("--c-brass")).toBe("#7a5c17");
  });
  it("switching back to dark brass clears every override (fallback dark)", () => {
    applyTheme("steel", "light");
    applyTheme("brass", "dark");
    THEME_VARS.forEach((v) => expect(get(v)).toBe(""));
  });
  it("treats an unknown theme id as the default", () => {
    applyTheme("steel", "dark");
    applyTheme("does-not-exist", "dark");
    THEME_VARS.forEach((v) => expect(get(v)).toBe(""));
  });
});

