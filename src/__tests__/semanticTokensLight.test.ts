/**
 * The light-mode SEMANTIC text tokens must clear AA.
 *
 * WHY. `theme:contrast` measures all six theme×mode combinations, but only over
 * the screens in its shared SCREENS list — which, until this build, contained no
 * fiche and no modal. Four semantic tokens had every one of their TEXT instances
 * on exactly those surfaces, so all four sat under AA in light mode with nothing
 * reporting them:
 *
 *   steel-hi    3.87:1  the "Collections" label, on all three fiches
 *   ember       4.22:1  accessory brand; the trash kind label at 9px
 *   amber       4.27:1  the trash + shopping status lines
 *   oxblood-hi  4.34:1  pipe brand, the aging Notice, both modal delete actions
 *
 * The pass retuned seven light tokens the same way and stopped there;
 * these four were simply never visible to it. Adding the missing screens fixes
 * the blind spot, but the browser check is OPT-IN (it needs a browser and is not
 * a CI gate), so it can go months without running. These cases are the part that
 * runs on every commit: they re-derive the arithmetic rather than pinning hexes,
 * so a future retune that lands under AA fails here first.
 *
 * The two tokens deliberately NOT required to clear AA are asserted as such,
 * with the reason — a rule with an unexplained exception invites someone to
 * "fix" the exception.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MODE_LIGHT, THEME_VARS } from "../theme-curator";

/** WCAG relative luminance / contrast — same maths as scripts/theme-contrast.cjs. */
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: string, b: string) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// The PAGE is the darker of the two light grounds, so it is the worst case for
// dark ink — and it is what every light value in this palette was computed
// against (see the note in CLAUDE.md).
const PAGE = MODE_LIGHT["--c-bg"]!;
const CARD = MODE_LIGHT["--c-bg2"]!;

// Every semantic token that is used as TEXT somewhere in the app.
const TEXT_TOKENS = [
  "--c-oxblood", "--c-oxblood-hi",
  "--c-sage", "--c-sage-hi",
  "--c-amber",
  "--c-ember",
  "--c-steel-hi",
];

// Used ONLY as a fill, never as text — so WCAG 1.4.3 does not apply to them and
// darkening them to satisfy a text rule would damage what they exist for.
const FILL_ONLY: Record<string, string> = {
  "--c-amber-hi": "the mid step of the activity-calendar cell ramp",
  "--c-steel": "a chart / fill colour",
};

describe("light-mode semantic text tokens", () => {
  for (const tok of TEXT_TOKENS) {
    it(`${tok} clears AA on the page ground`, () => {
      const v = MODE_LIGHT[tok];
      expect(v, `${tok} has no light-mode value`).toBeTruthy();
      const r = ratio(v!, PAGE);
      expect(r, `${tok} ${v} on ${PAGE} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      // The card ground is lighter, so it follows — asserted anyway, because a
      // future ground retune could invert that assumption silently.
      expect(ratio(v!, CARD)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("the four tokens fixed are genuinely above their old ratios", () => {
    // Guards against a revert that keeps the key but restores the old hex.
    const OLD = {
      "--c-steel-hi": 3.87, "--c-ember": 4.22, "--c-amber": 4.27, "--c-oxblood-hi": 4.34,
    };
    for (const [tok, was] of Object.entries(OLD)) {
      const now = ratio(MODE_LIGHT[tok]!, PAGE);
      expect(now, `${tok} is back at or below its pre-fix ${was}:1`).toBeGreaterThan(was + 0.1);
    }
  });

  it("hue is preserved — the fix darkened, it did not recolour", () => {
    // A status palette that drifts in hue stops being status coding. Each fixed
    // token must stay in the same hue family as its dark-mode sibling: red stays
    // red, amber amber, blue blue. Compared as the dominant channel ordering.
    const order = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [["r", r], ["g", g], ["b", b]].sort((x, y) => (y[1] as number) - (x[1] as number))
        .map((p) => p[0]).join("");
    };
    // Dark-mode values live in the C palette's var() fallbacks; read them from
    // the source so this cannot drift out of step with the real defaults.
    const src = readFileSync(resolve(__dirname, "../theme-curator.ts"), "utf8");
    const darkOf = (name: string) => {
      const m = new RegExp(`var\\(${name.replace(/[-]/g, "\\-")},\\s*(#[0-9a-f]{6})\\)`, "i").exec(src);
      return m ? m[1]! : "";
    };
    for (const tok of ["--c-steel-hi", "--c-ember", "--c-amber", "--c-oxblood-hi"]) {
      const dark = darkOf(tok);
      expect(dark, `no dark fallback found for ${tok}`).toBeTruthy();
      expect(order(MODE_LIGHT[tok]!), `${tok} changed hue family`).toBe(order(dark));
    }
  });

  it("the fill-only tokens are exempt, and the reason is recorded", () => {
    // These are BELOW AA and that is correct. Stating it here stops the next
    // sweep from "completing" the job and flattening the calendar ramp.
    for (const [tok, why] of Object.entries(FILL_ONLY)) {
      expect(MODE_LIGHT[tok], `${tok} lost its light value`).toBeTruthy();
      expect(why.length, `${tok} needs a stated reason`).toBeGreaterThan(10);
    }
    // amber-hi really is the one that would look like a hard failure.
    expect(ratio(MODE_LIGHT["--c-amber-hi"]!, PAGE)).toBeLessThan(4.5);
  });

  it("every token asserted here is in THEME_VARS, or the light value sticks in dark mode", () => {
    // applyTheme clears the light overrides via removeProperty over THEME_VARS.
    // A var missing from that list keeps its light value after switching back to
    // dark — the failure mode is invisible in light mode, which is where anyone
    // adding a token is looking.
    for (const tok of [...TEXT_TOKENS, ...Object.keys(FILL_ONLY)]) {
      expect(THEME_VARS, `${tok} is not cleared on theme apply`).toContain(tok);
    }
  });
});

/**
 * DARK-mode tertiary text.
 *
 * `tx3` is the third grey — dates, meta lines, sub-labels, ~198 sites. It was
 * the last sub-AA TEXT anywhere in the app: 4.29:1 on the english card and
 * 4.18:1 on `cardHi`, against a 4.5 threshold. Raised #8e8773 -> #958e7a.
 *
 * These cases live in `npm test` rather than only in the opt-in browser check
 * for the same reason as the light-mode block above: `theme:contrast` needs a
 * browser, is not a CI gate, and can go months unrun. They re-derive the
 * arithmetic against the real grounds instead of pinning a hex, so a future
 * retune that lands under AA fails here first.
 */
describe("dark-mode tertiary text", () => {
  // Read the dark fallbacks out of the source so this cannot drift from the
  // real defaults — the failure being guarded against is a comment or a test
  // that describes a value the code no longer has, which is what prompted the
  // change in the first place.
  const src = readFileSync(resolve(__dirname, "../theme-curator.ts"), "utf8");
  const darkOf = (name: string) => {
    const m = new RegExp(`var\\(${name.replace(/-/g, "\\-")},\\s*(#[0-9a-f]{6})\\)`, "i").exec(src);
    if (!m) throw new Error(`no dark fallback found for ${name}`);
    return m[1]!;
  };

  const TX3 = darkOf("--c-tx3");
  // Every ground tx3 is rendered on, including the two theme cards.
  const GROUNDS: Record<string, string> = {
    page: darkOf("--c-bg"),
    cardBg: darkOf("--c-bg2"),
    card: darkOf("--c-card"),
    cardHi: darkOf("--c-card-hi"),
    englishCard: "#1a281d",
    steelCard: "#181f2c",
  };

  it("clears AA on every dark ground, including cardHi and the english card", () => {
    for (const [name, ground] of Object.entries(GROUNDS)) {
      const r = ratio(TX3, ground);
      expect(r, `tx3 ${TX3} on ${name} ${ground} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is above the pre-fix value — a revert that keeps the token fails here", () => {
    // The two that were actually failing. Asserting "above 4.5" alone would let
    // a revert to #8e8773 pass on the four grounds that always cleared it.
    expect(ratio(TX3, GROUNDS.cardHi!), "cardHi was 4.18:1").toBeGreaterThan(4.4);
    expect(ratio(TX3, GROUNDS.englishCard!), "english card was 4.29:1").toBeGreaterThan(4.5);
  });

  it("stays a TERTIARY grey — dimmer than tx2, or the hierarchy collapses", () => {
    // The cheap way to pass the assertions above is to keep lightening tx3
    // until it is indistinguishable from the secondary text. Three greys that
    // read as one grey is a worse outcome than 0.3 of a ratio point.
    const tx2 = darkOf("--c-tx2"), tx = darkOf("--c-tx");
    expect(lum(TX3), "tx3 must stay dimmer than tx2").toBeLessThan(lum(tx2));
    expect(lum(tx2), "tx2 must stay dimmer than tx").toBeLessThan(lum(tx));
  });
});
