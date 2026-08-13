// Curator design tokens — dark vault palette, brass / oxblood / sage accents.
// Imported as `C` (palette) + `F` (fonts) everywhere a colour or typeface
// is needed. Inline styles only — no className, no CSS file.

export const C = {
  // The surface tokens (page grounds + card + borders) are
  // themeable too — var-with-fallback so first paint / SSR shows the classic
  // warm "vault" hex, and a theme (see THEMES) can re-tint the whole
  // atmosphere + depth, not just the accent. Kept in lock-step with the
  // fallbacks below; a themed surface swap flows through CARD_BG (= C.bg2)
  // and every layered bg/card/rule automatically.
  bg:        "var(--c-bg, #0e1311)",
  bg2:       "var(--c-bg2, #131a17)",
  bg3:       "var(--c-bg3, #181f1c)",
  card:      "var(--c-card, #1a221e)",
  cardHi:    "var(--c-card-hi, #202924)",
  rule:      "var(--c-rule, #26312b)",
  rule2:     "var(--c-rule2, #33403a)",

  // The BottomDock's frosted glass pill. It used to be a raw
  // `rgba(18,24,21,0.24)` inline in BottomDock.tsx — a DARK tint, which stayed
  // dark in light mode and left the gold labels at 2.27:1 on it (found by
  // `npm run theme:contrast`). Tokenised so light mode can flip it; the dark
  // fallback is byte-identical to the value, so the dark PWA look —
  // which can only be verified on the installed iOS app — is untouched.
  dockPill: "var(--c-dock-pill, rgba(18,24,21,0.24))",
  // The dock pill's elevation. It was a raw, hardcoded
  // `0 14px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)`
  // inline in BottomDock.tsx — the LAST mode-blind value on the dock, and
  // measurably identical in both modes. Both halves are pure-neutral rgba, so
  // the tinted-rgba lint rule exempts them on the stated reasoning
  // that "a neutral value is a scrim or a drop shadow and reads the same in
  // both modes". That holds for the DROP SHADOW; it does not hold for the
  // INSET WHITE bevel, whose entire job is to catch light on a dark surface.
  // On a near-white light-mode pill it does nothing, while a 0.5-alpha 40px
  // black shadow is far heavier than a cream page wants. Dark fallback is
  // BYTE-IDENTICAL to the value, so the installed-PWA look — the
  // one thing headless cannot verify — is untouched.
  dockShadow: "var(--c-dock-shadow, 0 14px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04))",
  // The brass "gold" identity is the one themeable accent family
  // (drives home/primary/CTAs/most chips + the dominant dock + card accents).
  // Each is a CSS var with the classic brass hex as fallback, so first paint
  // and any var-less render (SSR/tests) show brass untouched; `applyTheme`
  // overrides the vars on <html> to swap the whole gold identity (see THEMES).
  brass:     "var(--c-brass, #d4a661)",
  brassHi:   "var(--c-brass-hi, #ecc789)",
  brassDim:  "var(--c-brass-dim, #8a6e3d)",

  // Colour of the large serif DISPLAY titles (Home masthead +
  // "Bibliothèque" + the emphasised word in every page title). Separate
  // themeable token because the accent that reads rich as a small chip can
  // read weak as a huge title — steel's pale blue looked washed there, so
  // the steel theme points `--c-title` at a crisp near-white instead of the
  // accent. Default = the brass gold (fallback); themes override per identity.
  title:     "var(--c-title, #d4a661)",

  // The semantic + text tokens are var-with-fallback too, so the
  // light/parchment MODE (see MODE_LIGHT) can flip the whole palette to dark
  // text on a cream ground. Fallbacks = the classic dark-mode values.
  amber:     "var(--c-amber, #e89556)",
  // Bright amber, the mid step of the activity-calendar cell ramp
  // (Home + Stats): dim amber → amberHi → oxbloodHi for the 4+/day "attention"
  // level. Mirrors the sageHi/brassHi pattern.
  amberHi:   "var(--c-amber-hi, #f2b183)",
  ember:     "var(--c-ember, #df6a40)",

  oxblood:   "var(--c-oxblood, #a8453f)",
  oxbloodHi: "var(--c-oxblood-hi, #d27b6f)",

  sage:      "var(--c-sage, #8fbf9c)",
  sageHi:    "var(--c-sage-hi, #b5deba)",

  // The one cool accent in the otherwise warm vault palette.
  // A muted steel blue that reads as "chosen", not neon. `steel` (5.57:1 on
  // `card`) is the fill/chart shade; `steelHi` (~8.4:1 on `card`)
  // is the AA-comfortable shade for small text — it drives the blue slot in
  // the list-card accent rotation (CARD_ACCENTS), where the accent doubles
  // as the brand label. `steel` feeds CURATOR_CHART_COLORS (fills, no text).
  steel:     "var(--c-steel, #6f9ec4)",
  steelHi:   "var(--c-steel-hi, #a6c9e6)",

  ivory:     "var(--c-ivory, #f1e9d2)",
  cream:     "var(--c-cream, #e5dcc0)",
  // Warm near-black for text/icons sitting ON a brass/amber/sage accent
  // surface (buttons, gradient CTAs, the sage banner). In the light mode the
  // accent is DARK, so `--c-ink` flips to a light cream (text-on-dark-accent).
  ink:       "var(--c-ink, #1a1408)",

  // The "Démarrer une dégustation" CTA is a FILLED focal button —
  // it keeps its vivid dark-mode flame gradient + light text in BOTH modes.
  // (In light mode the themed ember/oxblood/ivory all darken for text-on-cream
  // legibility, which made this filled button read muddy/too-dark.) Fixed hex,
  // NOT mode-flipped — a filled focal has its own contrast, not the text rule.
  ctaFrom:   "#a8453f", // gradient start (bright oxblood-red)
  ctaTo:     "#df6a40", // gradient end (bright ember-orange)
  ctaInk:    "#f1e9d2", // light cream text/icons on the flame

  // The ambient top-of-page wash (ScreenWash). On the dark vault a
  // faint white top-light adds depth; on the light parchment white-on-cream is
  // invisible → the top read flat/"triste". MODE_LIGHT overrides it to a warm
  // amber glow so the top of every page gets some life in light mode.
  washTop:   "var(--c-wash-top, rgba(255,255,255,0.05))",

  tx:        "var(--c-tx, #dcd4ba)",
  tx2:       "var(--c-tx2, #b5ad95)",
  // Tertiary text (dates, meta lines, sub-labels) — ~198 sites.
  //
  // #8e8773 -> #958e7a (+7 per channel). This was the last
  // sub-AA TEXT in dark mode, and the last item left open by the earlier contrast
  // audit. Measured against every dark ground, before -> after:
  //   page (bg)                                        5.24 -> 5.74  ✓
  //   CARD_BG (= bg2, THE card ground) 4.94 -> 5.41  ✓
  //   steel card                                       4.61 -> 5.06  ✓
  //   C.card  (#1a221e — no longer a card background)  4.54 -> 4.98  ✓
  //   english card                                     4.29 -> 4.71  ✓  was ✗
  //   C.cardHi                                         4.18 -> 4.58  ✓  was ✗
  //
  // The figures this replaces were themselves wrong, which is why the change
  // got made at all: the old comment claimed "~4.54 on card, 4.39 on cardHi".
  // The first was accurate about `C.card` — a token that STOPPED being the card
  // ground — so it warned about the wrong surface; the second
  // overstated cardHi by 0.21, i.e. erred toward reassurance. Neither mentioned
  // the english card. Re-measuring is what turned "0.2 short somewhere" into a
  // decision worth taking.
  //
  // The cost, stated plainly: every tertiary line in the app is ~3% lighter in
  // dark mode. VERIFIED by `npm run theme:contrast` over 33 screens x 6 palettes
  // after the change: the two residuals it had reported since it existed (the
  // journal's "2 séances" at 4.18 brass/dark and 4.29 english/dark) are gone,
  // nothing else moved, and every remaining tx3 line in the report is a DISABLED
  // control ("Ajouter" before the required fields, "Chercher" with no API key) —
  // i.e. WCAG 1.4.3-exempt, and that exemption was narrowed to cover
  // only genuinely inactive controls rather than anything dimmed.
  // VERIFIED on the installed iOS PWA (english/dark, the journal's year header —
  // "2026" beside its "32 séances" count, the worst case at 4.29:1). The
  // measurement settles legibility; what it cannot settle is whether the grey
  // still reads as a THIRD level rather than merging into the secondary text,
  // and that is the real risk of lightening it. Checked on the device: the
  // hierarchy holds.
  // Still do NOT shrink tx3 below 13px.
  tx3:       "var(--c-tx3, #958e7a)",

  // Decorative dark tints that used to be one-off hex literals
  // across the Curator (consolidated so `#hex` is banned in curator source —
  // same rationale as `ink`). These are custom warm/cool washes with no
  // existing token equivalent.
  // Varized too — in the LIGHT mode the text tokens flip to dark,
  // so these decorative BACKGROUND tints must flip to light or text lands
  // dark-on-dark (TastingView bg, TermsGate focal, doc error panels/badges).
  panelWarn:    "var(--c-panel-warn, #2a1816)", // oxblood-tinted panel behind error/warn callouts (DocPage/Help)
  washEmber:    "var(--c-wash-ember, #2a1612)", // warm radial-gradient focal (TastingView background)
  washMoss:     "var(--c-wash-moss, #1a1f1c)",  // cool-green radial-gradient focal (TermsGate + cold-start shell)
  docBadgeCave: "var(--c-doc-cave, #1f2818)",   // help-doc "cave" status badge background
  docBadgePot:  "var(--c-doc-pot, #2a2210)",    // help-doc "pot" status badge background
  docBadgeFin:  "var(--c-doc-fin, #1e1e1e)",    // help-doc "finished" status badge background
} as const;

export const F = {
  display: `"Newsreader", "Source Serif Pro", Georgia, serif`,
  body:    `"DM Sans", -apple-system, system-ui, sans-serif`,
  mono:    `"IBM Plex Mono", ui-monospace, monospace`,
} as const;

// ─────────────────────────────────────────────────────────────
// alpha() — translucent tint of a token
// ─────────────────────────────────────────────────────────────
// Replaces the historical `C.brass + "22"` / `${C.brass}88` 8-digit-hex
// alpha concatenation, which produces INVALID CSS once a token is a
// `var(--c-brass, …)` string (`"var(…)22"`). `color-mix(in srgb, T X%,
// transparent)` is the equivalent that works with a var() colour AND is
// visually identical to `#RRGGBBAA` (mixing X% of the colour with
// transparent = the colour at alpha X/100). `aa` is the SAME 2-hex-digit
// alpha suffix the old code used, so migration is a pure textual swap and
// every tint keeps its exact opacity. Supported iOS Safari 16.2+ / all
// evergreen browsers.
export function alpha(color: string, aa: string): string {
  var n = parseInt(aa, 16);
  if (!isFinite(n)) return color;
  var pct = Math.round((n / 255) * 1000) / 10;
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

// ─────────────────────────────────────────────────────────────
// Colour themes — swap the brass "gold" identity
// ─────────────────────────────────────────────────────────────
// The brass/brassHi/brassDim tokens are `var(--c-brass*, <brass hex>)`,
// so overriding those three CSS variables on <html> re-tints the whole
// primary accent identity live — no React re-render (same mechanism as
// `--cave-font-scale`). Every derived palette (DOCK_ACCENT, CARD_ACCENTS,
// CURATOR_CHART_COLORS, and CAT_COLORS in constants.ts) holds the var() string, so it
// follows the swap automatically. `vars: {}` (the "brass" default) means
// "clear the overrides → the fallback hex applies". Semantic accents
// (oxblood danger / sage success / amber warn / ember) intentionally stay
// warm so status colour-coding survives the theme switch.
//
// Steel-blue values are lightness-matched to the brass trio so every
// contrast relationship carries over (brass #d4a661 → #7fb0d8 ≈ 6.8:1 on
// card; brassHi → the AA-comfortable #a6c9e6; brassDim → #4f7594).
// `vars` = the DARK-mode overrides (accent + title + surfaces for steel/
// english; empty for brass = the fallback vault). `lightAccent` = the accent
// trio + title recoloured for the LIGHT/parchment mode (the accent must be
// DARK to read on cream). In light mode we apply `MODE_LIGHT` (shared
// parchment surfaces + dark text + darkened semantics) THEN the theme's
// `lightAccent`. Every value validated for WCAG AA.
// Null-proto (a forged cave-theme id must not resolve to
// Object.prototype and defeat the `THEMES[id] || THEMES.brass` fallback).
export const THEMES: Record<string, { label: string; vars: Record<string, string>; lightAccent: Record<string, string> }> = Object.assign(Object.create(null), {
  brass: {
    label: "theme_brass",
    vars: {},
    lightAccent: {
      "--c-brass":     "#7a5c17",
      "--c-brass-hi":  "#695018",
      "--c-brass-dim": "#5a4712",
      "--c-title":     "#6f5416",
      // Per-theme light-mode top glow — warm amber/gold for brass.
      "--c-wash-top":  "rgba(198,128,40,0.30)",
    },
  },
  steel: {
    label: "theme_steel",
    vars: {
      // Accent (the gold identity → steel blue)
      "--c-brass":     "#7fb0d8",
      "--c-brass-hi":  "#a6c9e6",
      "--c-brass-dim": "#4f7594",
      // Large display titles → a crisp cool near-white (the pale blue
      // accent read washed-out as a huge serif title).
      "--c-title":     "#dbe6f2",
      // Surfaces — the warm green-black vault → a cool
      // blue-slate one. Blue-shifted at matched luminance so every
      // text/border contrast relationship carries over (tx3 on card stays
      // ≥ 4.5:1). This is what makes it a real theme, not a re-tinted accent.
      "--c-bg":        "#0c1017",
      "--c-bg2":       "#111722",
      "--c-bg3":       "#161d29",
      "--c-card":      "#181f2c",
      "--c-card-hi":   "#1a212e",
      "--c-rule":      "#273140",
      "--c-rule2":     "#334052",
    },
    lightAccent: {
      "--c-brass":     "#2f6088",
      "--c-brass-hi":  "#2c587a",
      "--c-brass-dim": "#244a68",
      "--c-title":     "#284f70",
      // Cool steel-blue top glow
      "--c-wash-top":  "rgba(52,110,166,0.28)",
    },
  },
  english: {
    label: "theme_english",
    vars: {
      // Accent (gold → a deep British forest / racing green)
      // #4e9a63 → #509d66. It measured 4.488:1 on this theme's
      // card ground — 0.012 short of AA, which `theme:contrast` reported as a
      // standing warning on the pipe fiche ("2026" at 22px). A warning that can
      // never be cleared is what erodes the list into noise, and the fix is two
      // hex digits for an imperceptible lightening (4.49 → 4.66 on card, 4.93 on
      // the page). Only reachable at all once the fiches entered SCREENS.
      "--c-brass":     "#509d66",
      "--c-brass-hi":  "#8ecb9f",
      "--c-brass-dim": "#375f42",
      // Display titles → a deep leaf-green, on-brand for the forest theme.
      "--c-title":     "#6fbe86",
      // Surfaces — a deeper, greener vault than the (already green-ish)
      // default, so "anglais" reads as its own forest atmosphere, not just
      // a green accent on the classic ground. Contrast validated
      // (tx3-on-card 4.55:1, tx3-on-cardHi 4.29:1 — ≥ the warm baseline).
      "--c-bg":        "#0a120c",
      "--c-bg2":       "#0f1a12",
      "--c-bg3":       "#142017",
      "--c-card":      "#16231a",
      "--c-card-hi":   "#1a281d",
      "--c-rule":      "#263528",
      "--c-rule2":     "#33473a",
    },
    lightAccent: {
      "--c-brass":     "#2f6b43",
      "--c-brass-hi":  "#295e3b",
      "--c-brass-dim": "#234f32",
      "--c-title":     "#275737",
      // Forest-green top glow
      "--c-wash-top":  "rgba(64,138,78,0.28)",
    },
  },
});

// The LIGHT / parchment mode — a warm cream ground + dark text +
// darkened semantics, SHARED by all three themes (only the accent differs,
// per THEMES[id].lightAccent). Applied on top of the accent so every token
// flips together. Contrast validated: dark text ≥ 4.5:1 on card, every
// semantic used as text ≥ 4.5:1, ink (light) ≥ 4.5:1 on each dark accent.
export const MODE_LIGHT: Record<string, string> = {
  // Surfaces — warm parchment (card a step lighter than the page ground)
  "--c-bg":        "#e7ddc6",
  "--c-bg2":       "#f2ecdb",
  "--c-bg3":       "#dccfb2",
  "--c-card":      "#f2ecdb",
  "--c-card-hi":   "#f9f4e9",
  "--c-rule":      "#d6c9aa",
  "--c-rule2":     "#c4b590",
  // A LIGHT frosted pill: the dark glass left the dock labels at 2.27:1 in
  // light mode (theme:contrast). Same translucency, opposite tint.
  //
  // The alpha really is the same now. The tint was flipped
  // AND raised the alpha 0.24 → 0.72, while the comment claimed "same
  // translucency" — so light mode was three times more opaque than dark and read
  // as a near-solid cream slab instead of frosted glass. Reported from the app.
  // The 2.27:1 finding was caused by the dark TINT under dark-gold labels, not
  // by the opacity: at 0.24 the contrast check still reports zero dock-label
  // warnings across all six theme×mode combinations. Parity is now asserted by
  // theme.test.ts rather than claimed in a comment nothing checked — which is
  // exactly how the two drifted apart in the first place.
  "--c-dock-pill": "rgba(255,252,244,0.24)",
  // Lighter elevation and NO white bevel: on cream, a 0.5-alpha shadow reads
  // as a smudge and a white top highlight is invisible on a near-white pill.
  "--c-dock-shadow": "0 8px 24px rgba(0,0,0,0.14)",
  // The per-family category accents (CAT_COLORS in constants.ts).
  // Bright hues designed for the dark vault; these are the same hues darkened
  // to clear 4.6:1 on the page ground, saturation capped at 0.72.
  // Computed, not eyeballed — `npm run theme:contrast` proves them.
  "--c-cat-anglais": "#84571a",
  "--c-cat-virginia": "#7c5b1b",
  "--c-cat-aromatique": "#356c3b",
  "--c-cat-balkan": "#1c61af",
  "--c-cat-vaper": "#a04435",
  "--c-cat-burley": "#7339df",
  "--c-cat-oriental": "#b91e4f",
  "--c-cat-ecossais": "#196c61",
  "--c-cat-dark-fired": "#6b5f4e",
  "--c-cat-virginia-burley": "#974c19",
  "--c-cat-autre": "#655846",
  "--c-cat-latakia": "#506277",
  "--c-cat-cavendish": "#8a5429",
  "--c-cat-perique": "#9b3a6a",
  "--c-cat-turkish": "#705f1b",
  "--c-cat-americain": "#436b11",
  "--c-cat-virginia-latakia": "#a41db0",
  "--c-cat-cigare": "#434de0",
  "--c-cat-lakeland": "#af2c60",
  // `Anglais aromatique`. The hue was CHOSEN, not eyeballed —
  // it maximises the minimum CIE76 dE against all 19 existing category colours
  // in BOTH modes at once. The first candidate (149°, the widest HSL hue gap)
  // measured dE 8.2 from `Aromatique` on parchment, tighter than the tightest
  // pair already shipping (12.7) and between exactly the two categories a
  // reader has to tell apart: an HSL gap is not a perceptual one.
  "--c-cat-anglais-aromatique": "#186595",
  // Text — dark warm on parchment
  "--c-tx":        "#2e2a1e",
  "--c-tx2":       "#5a5340",
  "--c-tx3":       "#67604a",
  "--c-ivory":     "#241f14",
  "--c-cream":     "#2e2a1e",
  "--c-ink":       "#f4eede", // text/icon ON the (now dark) accent → light
  // Semantic — darkened so status coding stays legible on cream.
  //
  // FOUR of these were under AA as text, and none of them was
  // reported by anything. `theme:contrast` measures the six palettes but only
  // over its 14 SCREENS, which contain no fiche and no modal — so a token whose
  // only text instances live on a detail page or inside a dialog was invisible
  // to it. Found by rendering the 24 missing screens (8,958 elements, 144
  // renders): steel-hi 3.87:1 (the "Collections" label on all three fiches),
  // ember 4.22:1 (accessory brand; trash kind label at 9px), amber 4.27:1
  // (trash + shopping status lines), oxblood-hi 4.34:1 (pipe brand, the aging
  // Notice, both modal delete actions). All computed exactly as the // retune did — hue and saturation held, lightness reduced until the ratio
  // clears 4.6:1 against the DARKER of the two light grounds (the page
  // #e7ddc6, not the card) — so the status colour coding is unchanged.
  "--c-oxblood":   "#9e3f3a",
  "--c-oxblood-hi":"#a1423c", // was #a8453f — 4.34:1
  "--c-sage":      "#346c45",
  "--c-sage-hi":   "#305d3f",
  "--c-amber":     "#8e5118", // was #965619 — 4.27:1
  // NOT retuned, deliberately: amber-hi is 2.99:1 on the page, which looks like
  // a hard failure and is not one — it is never used as text. Its only two call
  // sites are the mid step of the activity-calendar cell ramp
  // (alpha(amber,55) → amberHi → oxbloodHi, HomeViewV2 + StatsView), i.e. a
  // background fill. Darkening it to satisfy a text rule would flatten the ramp
  // it exists to define. Same reasoning for `--c-steel`, which is a chart/fill
  // colour with no text site: this is why the pairs below can look "inverted"
  // (a *-hi lighter than its base) without repeating the sage-hi
  // defect — that rule is about an emphasis pair where BOTH are text, and here
  // only the *-hi member ever is.
  "--c-amber-hi":  "#b07028",
  "--c-ember":     "#9f4619", // was #a94a1b — 4.22:1
  "--c-steel":     "#356690",
  "--c-steel-hi":  "#34658b", // was #3a719c — 3.87:1
  // Decorative background tints → light so dark text reads on them
  "--c-panel-warn":"#f3e1d9",
  "--c-wash-ember":"#ece0cf",
  "--c-wash-moss": "#e8e4d6",
  "--c-doc-cave":  "#dfe8d4",
  "--c-doc-pot":   "#efe4cd",
  "--c-doc-fin":   "#e5dfd1",
  // Warm amber top-glow so the parchment head isn't flat (stronger
  // + richer — the 0.20 version read washed-out on cream)
  "--c-wash-top":  "rgba(198,128,40,0.30)",
};

// Every CSS var any theme/mode may set — cleared before each apply so a
// switch never leaves a stale override (the fallback hex = dark-mode default).
// The <meta name="theme-color"> tint (iOS status bar / letterbox).
// A meta's `content` needs a LITERAL hex — a var() is not resolved there — so
// App.tsx used to hardcode both values. The light one was `#e7ddc6`, i.e. the
// light page ground duplicated by hand from MODE_LIGHT with nothing watching it,
// and CLAUDE.md quotes that exact literal as the reference ground for every
// computed light-mode value. Deriving it means a future light-ground retune
// carries the status bar with it instead of silently desyncing.
//
// DARK is deliberately NOT `C.bg`'s #0e1311: it is a darker neutral letterbox,
// a separate decision, so it stays an explicit constant here (this file owns
// the palette literals and is exempt from the no-hex rule for that reason).
export const THEME_COLOR_META = {
  light: MODE_LIGHT["--c-bg"] as string,
  dark: "#0a0a0a",
} as const;

export const THEME_VARS: string[] = [
  "--c-cat-lakeland",
  "--c-cat-anglais-aromatique",
  "--c-cat-anglais",
  "--c-cat-virginia",
  "--c-cat-aromatique",
  "--c-cat-balkan",
  "--c-cat-vaper",
  "--c-cat-burley",
  "--c-cat-oriental",
  "--c-cat-ecossais",
  "--c-cat-dark-fired",
  "--c-cat-virginia-burley",
  "--c-cat-autre",
  "--c-cat-latakia",
  "--c-cat-cavendish",
  "--c-cat-perique",
  "--c-cat-turkish",
  "--c-cat-americain",
  "--c-cat-virginia-latakia",
  "--c-cat-cigare",
  "--c-dock-pill",
  "--c-dock-shadow",
  "--c-brass", "--c-brass-hi", "--c-brass-dim", "--c-title",
  "--c-bg", "--c-bg2", "--c-bg3", "--c-card", "--c-card-hi", "--c-rule", "--c-rule2",
  "--c-tx", "--c-tx2", "--c-tx3", "--c-ivory", "--c-cream", "--c-ink",
  "--c-oxblood", "--c-oxblood-hi", "--c-sage", "--c-sage-hi",
  "--c-amber", "--c-amber-hi", "--c-ember", "--c-steel", "--c-steel-hi",
  "--c-panel-warn", "--c-wash-ember", "--c-wash-moss",
  "--c-doc-cave", "--c-doc-pot", "--c-doc-fin", "--c-wash-top",
];

// Apply a theme + mode by (re)writing the CSS vars on <html>. Clears all
// theme vars first (→ dark-mode fallbacks), then sets the active set:
//   dark  → THEMES[id].vars (accent + surfaces; brass = none)
//   light → MODE_LIGHT (parchment base) + THEMES[id].lightAccent
// No React re-render — same live mechanism as --cave-font-scale. SSR/test-safe.
export function applyTheme(id: string, mode?: string): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  var theme = THEMES[id] || THEMES.brass!;
  var el = document.documentElement;
  THEME_VARS.forEach(function (v) { el.style.removeProperty(v); });
  var vars: Record<string, string> = mode === "light"
    ? Object.assign({}, MODE_LIGHT, theme.lightAccent)
    : theme.vars;
  Object.keys(vars).forEach(function (k) {
    var val = vars[k];
    if (val) el.style.setProperty(k, val);
  });
}

// Map a tobacco category to its accent (uses CAT_COLORS from constants when known).
import { CAT_COLORS } from "./constants.ts";
export function catColor(cat: string): string {
  // Same guard as `xl` / `effectiveAgingMax` / `CUT_DENSITY`.
  // `CAT_COLORS` is a plain object literal, so a forged category equal to a
  // prototype member returns `Object.prototype` — truthy, so the `|| C.brass`
  // fallback never fires — and an object handed to a CSS colour is dropped
  // silently, leaving the label unstyled. No crash, but a wrong result the
  // user cannot explain. Reachable from a user catalogue.
  if (!cat || !Object.prototype.hasOwnProperty.call(CAT_COLORS, cat)) return C.brass;
  return CAT_COLORS[cat] || C.brass;
}

// Map a dock entry to its section accent.
export const DOCK_ACCENT: Record<string, string> = {
  home:    C.brass,
  inv:     C.amber,
  pipes:   C.oxbloodHi,
  acc:     C.ember,
  journal: C.sage,
  stats:   C.brassHi,
};

// Stats-chart palette (donut, bars). Rotating brass / oxblood / sage / amber.
export const CURATOR_CHART_COLORS: string[] = [
  C.brass, C.oxbloodHi, C.sage, C.steel,
  C.amber, C.brassHi, C.ember, C.sageHi,
  C.brassDim, "#7a9e8e", "#b87e4a", "#9e5d57", "#c4a86a",
];

// ONE shared list-card accent rotation, used identically by the
// three inventory lists (tobaccos, pipes, accessories) to colour BOTH the
// card top-bar AND the brand label — so brand always matches its bar. The
// rotation is index-based (`CARD_ACCENTS[idx % length]`), so a mixed list
// alternates hues down the page regardless of category/type. C.steelHi (the
// AA-comfortable blue token) sits at index 3 — the one cool accent in the
// rotation; the hi shade is used because the accent doubles as the brand label.
export const CARD_ACCENTS: string[] = [
  C.brass, C.oxbloodHi, C.sage, C.steelHi,
  C.amber, C.brassHi, C.ember, C.sageHi,
];

// "encaissé" (recessed) card/panel surface. THE single source of
// truth for every browse-page card & panel ground: a step darker than the old
// lifted `C.card`, matching the interior tone of the Home "À surveiller" rows.
// Retune the whole app's card ground in ONE place here. Colour now lives only
// in text/labels/chips — the old top-accent "filets" were removed everywhere
// except the Home dashboard stat tiles (their left accent bar). New cards must
// reference `CARD_BG`, never a raw `C.bg2`, so the tone stays retunable.
export const CARD_BG = C.bg2;

// Shared soft lift for browse-page cards / tiles. A gentler echo
// of the Home "Ce soir ?" hero shadow (0 14px 34px / 0.4). THE single source
// of truth: retune every card's drop shadow in one place. Validated on the
// parchment (light-mode) ground; a plain black rgba reads well in both modes.
export const CARD_SHADOW = "0 6px 16px rgba(0,0,0,0.28)";


// ─────────────────────────────────────────────────────────────
// Type scale + runtime "Taille du texte" (S/M/L)
// ─────────────────────────────────────────────────────────────
//
// The whole app expresses font sizes through `fs(px)`, which returns a
// `calc()` string multiplied by the CSS variable `--cave-font-scale`
// (set on <html> by App.tsx from the `cave-font-scale` setting). This
// makes the S/M/L text-size preference a single-variable change with NO
// React re-render — the browser rescales every `fs()`-based size live.
//
// The S/M/L factors (0.9 / 1 / 1.12) are applied by App.tsx, which writes
// `--cave-font-scale` on <html> from the `cave-font-scale` setting.

// fs(px) → a scale-aware font-size string. `--cave-font-scale` defaults to 1
// so SSR / tests / a missing variable all render the plain baseline.
export function fs(px: number): string {
  return `calc(${px}px * var(--cave-font-scale, 1))`;
}

// Form inputs must never compute below 16px or iOS Safari zooms on focus
// (CLAUDE.md §20). Floor the scaled value at 16px so the S (0.9) setting
// can't reintroduce the zoom. max() is supported everywhere calc() is.
export function fsInput(px: number): string {
  return `max(16px, calc(${px}px * var(--cave-font-scale, 1)))`;
}
