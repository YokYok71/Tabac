#!/usr/bin/env node
/**
 * THEME CONTRAST CHECK — is every theme × light/dark combination readable?
 *
 * WHY THIS EXISTS. The palette is two independent axes — three colour themes
 * (brass / steel / english) × two modes (dark / light) = SIX palettes — and
 * every token is a CSS variable, so a whole palette swaps with no React render
 * and no code path of its own. Nothing verified five of those six: the app was
 * designed and hand-tuned in dark brass. CLAUDE.md states the invariant plainly
 * ("every text/background colour combination must hit WCAG AA") and lists the
 * pairs that sit closest to the line (`tx3` on `card` is exactly 4.54:1), which
 * is precisely the kind of claim that rots the first time a token moves.
 *
 * Unlike the layout warnings, a finding here is a real defect: unreadable text
 * is unreadable, not merely taller.
 *
 * It reuses the layout harness's screens, localStorage seed, CATALOGUE seed,
 * CELLAR swap, marker resolution and dictionary lookup (scripts/i18n-layout.cjs
 * exports all of them), so the two checks cannot drift apart on how they reach a
 * screen. That sentence was FALSE THREE TIMES, and the count is the point: the
 * catalogue seed was added to the layout harness and not exported, so this check
 * reached the catalogue screens with no catalogue and reported them unreachable;
 * then `markerText` was added there and read raw here, so `inv-long` reported
 * unreachable; then the `bigList` cellar swap was added there and never read
 * here, so `inv-long` reported unreachable AGAIN, this time for the seed rather
 * than the marker. Every time, under a header asserting the two could not
 * diverge, and every time the symptom reads as a NAVIGATION problem rather than
 * as a seed that never arrived. Reuse EVERY seed component, and if you add one,
 * wire both consumers in the same commit — `i18nLayoutHarness.test.ts` now
 * derives the axis list from the screen entries themselves and asserts both
 * scripts read each one, so a fourth axis is covered without anyone adding it
 * to a list by hand.
 * One language is enough — contrast does not depend on the words.
 *
 *   npm run build
 *   npm i --no-save playwright-core
 *   npm run theme:contrast
 *
 * It FANS OUT, one process per palette over one shared preview server
 * (`parallelRun.cjs`) — MEASURED at ~2 min against the ~45 it took in series.
 * Narrowing to one palette (THEME_CONTRAST_THEMES / _MODES) runs a single
 * process with no fan-out.
 *
 * WHAT IT MEASURES. For every visible text element: its computed colour against
 * the first opaque background colour above it, with ancestor opacity folded in,
 * as a WCAG 2.1 contrast ratio. Large text (≥ 24 px, or ≥ 18.66 px bold) is held
 * to 3:1, everything else to 4.5:1 — the AA thresholds.
 *
 * WHAT IT SKIPS, and why that is honest rather than convenient:
 *   - Elements over a gradient or image background. The effective backdrop is
 *     not a single colour, so any ratio computed against the fallback would be
 *     fiction. The app uses gradients on a handful of focal surfaces (the "Ce
 *     soir ?" hero, the CTA); those stay a manual judgement.
 *   - Text with no background colour anywhere up the tree (nothing to compare).
 *
 * NO ACCEPTED CLASS. This check once shipped one: `catColor()` read an unthemed
 * raw-hex palette, so on the parchment ground those hues landed at 2:1 as text,
 * and unifying the two category palettes was a design decision rather than a
 * patch. That decision was later made (keep the bright identity for dark mode, give
 * every family a computed darkened light variant, delete the divergent second
 * palette), so the acceptance was DELETED — a live acceptance would hide the
 * next instance of the same class.
 *
 * SEVERITY. Below 3:1 for normal text is FAILURE — that is not a near-miss, it
 * is unreadable. Between 3:1 and the AA threshold is reported as a warning, so
 * the check is usable today (the palette has decorative dim text at the line)
 * without pretending the app is AA-perfect everywhere. Tighten by lowering
 * FAIL_BELOW once the warnings are triaged.
 */

"use strict";

const PAR = require("./parallelRun.cjs");
const path = require("node:path");
const fs = require("node:fs");

const H = require("./i18n-layout.cjs");


const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.THEME_CONTRAST_PORT || 4174);
const URL = `http://localhost:${PORT}/`;
// lang-axis-ok: ONE language on purpose, unlike i18n:layout's full matrix. A
// contrast ratio is a property of the colour tokens, not of the words — the same
// element measures identically in six languages, so rendering all six would cost
// 6× the runtime for identical numbers. Language-dependent failures are LAYOUT
// failures (clipping, overflow) and belong to `npm run i18n:layout`, which does
// derive its axis from LANGUAGES. Override with THEME_CONTRAST_LANG to eyeball a
// screen in another language.
const LANG = process.env.THEME_CONTRAST_LANG || "fr";
const WIDTH = Number(process.env.THEME_CONTRAST_WIDTH || 390);
// A SHARD carries its palette as one `theme/mode` value and it WINS over the two
// axis vars — it is set by the fan-out, so treating it as one more input that
// could be overridden would give the same axis two sources (see the note in
// `parallelRun.cjs` about not forwarding argv for exactly that reason).
const PALETTE = (process.env.THEME_CONTRAST_PALETTE || "").split("/");
const THEMES = PALETTE[0] ? [PALETTE[0]]
  : (process.env.THEME_CONTRAST_THEMES || "brass,steel,english").split(",");
const MODES = PALETTE[1] ? [PALETTE[1]]
  : (process.env.THEME_CONTRAST_MODES || "dark,light").split(",");
/** Below this, normal-size text is unreadable — a failure, not a near-miss. */
const FAIL_BELOW = Number(process.env.THEME_CONTRAST_FAIL_BELOW || 3);


const RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", DIM = "\x1b[2m", OFF = "\x1b[0m";

function die(msg) {
  console.error(`${RED}theme:contrast — ${msg}${OFF}`);
  process.exit(1);
}

// ── The in-page measurement ─────────────────────────────────────────────────
// Serialised into the browser, so it must be self-contained.
function measureContrast() {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  // Blend a possibly-translucent foreground over an opaque backdrop.
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  const out = { findings: [], measured: 0, skipped: 0 };
  for (const el of document.querySelectorAll("span, div, button, a, label, h1, h2, h3, p, td, th, li")) {
    if (el.children.length > 0) continue;                 // leaf text only
    const txt = (el.textContent || "").trim();
    if (txt.length < 2) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;            // not rendered
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;

    // Effective foreground, with every ancestor's opacity folded in. The same
    // walk records whether the text sits inside an INACTIVE CONTROL — see the
    // `dimmed` note below for why that distinction has to be made here.
    let fg = parse(cs.color);
    if (!fg) continue;
    let alpha = fg.a, inactive = false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      const o = parseFloat(ncs.opacity);
      if (!isNaN(o)) alpha *= o;
      if (n.getAttribute("aria-disabled") === "true" || n.disabled === true
          || ncs.cursor === "not-allowed") inactive = true;
    }
    fg = { r: fg.r, g: fg.g, b: fg.b, a: alpha };

    // First opaque background colour above. A gradient / image makes the
    // backdrop non-uniform, so we cannot honestly compute a ratio.
    let bg = null, gradient = false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      if (ncs.backgroundImage && ncs.backgroundImage !== "none") { gradient = true; break; }
      const c = parse(ncs.backgroundColor);
      if (c && c.a > 0.95) { bg = c; break; }
      if (c && c.a > 0) {
        // Translucent tint: blend it onto whatever is under it, continuing up.
        const under = (() => {
          for (let p = n.parentElement; p && p !== document.documentElement; p = p.parentElement) {
            const pc = parse(getComputedStyle(p).backgroundColor);
            if (pc && pc.a > 0.95) return pc;
          }
          return null;
        })();
        if (under) { bg = over(c, under); break; }
      }
    }
    if (gradient || !bg) { out.skipped++; continue; }

    const size = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(over(fg, bg), bg);
    out.measured++;
    if (got < need) {
      out.findings.push({
        txt: txt.slice(0, 34), got: Math.round(got * 100) / 100, need,
        size: Math.round(size * 10) / 10, color: cs.color,
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        // WCAG 1.4.3 exempts INACTIVE components, so a dimmed finding is
        // reported and never failed — the disabled form-submit and the greyed
        // AICard (0.7 x 0.6 with no API key) are exactly that.
        //
        // This exemption was NARROWED. It used to be `alpha < 0.99` alone, i.e. ANY
        // reduced opacity claimed the exemption — and that quietly reclassified
        // a genuine defect as acceptable: the inventory card's POT / CAVE
        // badges wore `opacity: 0.75` as typographic de-emphasis of the word
        // beside its count, measured 3.68:1 / 3.23:1 in light mode at 11px, and
        // were waved through as "deliberately dimmed" on the busiest screen in
        // the app. Reduced opacity is not evidence of disablement; an inactive
        // CONTROL says so (aria-disabled / :disabled / cursor:not-allowed), and
        // that is what the walk above now looks for. A guard that reads as
        // "verified" while exempting real defects is worse than no guard.
        dimmed: alpha < 0.99 && inactive,
      });
    }
  }
  return out;
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, "dist/index.html"))) {
    die("dist/ not built — run `npm run build` first.");
  }
  // ONE SHARD PER PALETTE — the unit this check reports in, so a failing shard
  // names « steel/light » rather than an index. The two axes are folded into one
  // shard value and split back apart below, because fanning out on the themes
  // alone would leave each shard doing both modes and halve the gain.
  if (await PAR.maybeFanOut({
    label: "theme:contrast", script: "theme-contrast.cjs",
    envVar: "THEME_CONTRAST_PALETTE",
    shards: THEMES.flatMap((t) => MODES.map((m) => `${t}/${m}`)),
    portVar: "THEME_CONTRAST_PORT", port: PORT, url: URL,
  })) return;
  let chromium;
  try { ({ chromium } = require("playwright-core")); }
  catch {
    die("playwright-core not installed (deliberately not a dependency):\n" +
        "  npm i --no-save playwright-core");
  }
  let exe = process.env.CHROME_PATH || "";
  if (!exe) { try { const p = chromium.executablePath(); if (p && fs.existsSync(p)) exe = p; } catch { /* scan below */ } }
  if (!exe) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
    if (fs.existsSync(base)) {
      for (const d of fs.readdirSync(base)) {
        const c = path.join(base, d, "chrome-linux/chrome");
        if (d.startsWith("chromium") && !d.includes("headless") && fs.existsSync(c)) { exe = c; break; }
      }
    }
  }
  if (!exe) die("no Chromium found — set CHROME_PATH or run `npx playwright install chromium`.");

  // Adopts a server already listening — how N shards share ONE preview.
  const pre = await PAR.startPreview(PORT, URL);
  const stop = pre.stop;
  if (pre.failed) die(`preview server never came up on ${URL}`);

  const dict = H.readDict(LANG);
  const browser = await chromium.launch({ executablePath: exe });
  const failures = [], warnings = [];
  let totalMeasured = 0;

  for (const theme of THEMES) {
    for (const mode of MODES) {
      const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 840 } });
      const page = await ctx.newPage();
      await page.addInitScript(([d, l, seed, th, md]) => {
        // THE GUARD IS NOT DECORATION — the same one the layout harness carries,
        // for the same reason. This script runs before EVERY page load in the
        // context, so without it the reload a per-screen cellar swap needs would
        // immediately overwrite the swapped cellar, and the screen reports as
        // unreachable — which reads as a navigation problem rather than as a
        // seed that never arrived. `H.setCellar` sets the flag.
        if (localStorage.getItem("__harness-cellar-pinned") !== "1") {
          localStorage.setItem("pipe-cellar-v6", d);
        }
        localStorage.setItem("cave-lang", l);
        localStorage.setItem("cave-theme", th);
        localStorage.setItem("cave-theme-mode", md);
        for (const [k, v] of Object.entries(seed)) {
          localStorage.setItem(k, v === "@now" ? String(Date.now()) : v);
        }
      }, [JSON.stringify(H.DATA), LANG, H.SEED_KEYS, theme, mode]);

      // The catalogue lives in IndexedDB and the app reads it ONCE per boot,
      // caching it in module memory — so it has to be written before the
      // navigation that will observe it. `page.evaluate` needs a document, so
      // land on the app once before the loop.
      await page.goto(URL, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);

      for (const scr of H.SCREENS) {
        await H.setCatalogue(page, scr.noCatalogue ? "" : H.CATALOGUE_CSV);
        // The OTHER per-screen seed axis. `inv-long` exists to render the
        // progressive-list footer, which needs a cellar of ~98 rows; the shared
        // one holds 18, so without this the footer never paints and the screen
        // reported unreachable in all six palettes. Unconditional here — unlike
        // the layout harness, this loop re-navigates on every screen anyway, so
        // it needs no `prevBigList` bookkeeping to put the ordinary cellar back.
        await H.setCellar(page, scr.bigList ? H.bigListCellar() : H.DATA, !!scr.bigList);
        await page.goto(URL, { waitUntil: "networkidle" });
        await page.waitForTimeout(1000);
        if (scr.dock !== null) {
          const btns = await page.locator("nav button, [role=navigation] button").all();
          if (btns.length > scr.dock) await btns[scr.dock].click({ force: true }).catch(() => {});
          await page.waitForTimeout(700);
        }
        if (scr.go) {
          try { await scr.go(page, dict, LANG); await page.waitForTimeout(1200); }
          catch { failures.push(`${theme}/${mode}/${scr.name}: could not be reached`); continue; }
        }
        // A CONDITION, not a longer sleep. Text measured mid-fade carries the
        // entry animation's ancestor opacity, and this check folds that into the
        // foreground — see `settle`. It matters most on a long list, where the
        // stagger's tail outlives every fixed wait above.
        await H.settle(page);
        // Same arrival proof as the layout check — a screen that never opened
        // would report the contrast of a page already covered.
        if (scr.expect) {
          const raw = dict[scr.expect];
          if (!raw) die(`i18n key "${scr.expect}" missing from ${LANG}.ts`);
          // Through the SHARED `markerText`, not the raw dictionary value.
          // A marker carrying a placeholder — `list_more` is
          // « Afficher la suite ({n}) » — never appears verbatim on screen, so
          // the raw value made `inv-long` report as UNREACHABLE in all six
          // palettes: that screen's contrast was measured by nothing. The
          // layout harness had already hit this and fixed it in `markerText`;
          // this consumer of the same screen list never got the fix. The
          // sibling-miss, and the reason the helper is exported.
          const marker = H.markerText(raw, scr.expect);
          if (!(await page.getByText(marker, { exact: false }).count())) {
            failures.push(`${theme}/${mode}/${scr.name}: could not be reached (no "${marker}")`);
            continue;
          }
        }
        // Confirm the theme actually applied: dark is the default, so a broken
        // seed would silently measure dark six times.
        const applied = await page.evaluate(() => ({
          mode: document.documentElement.style.getPropertyValue("--c-bg") || "",
          theme: document.documentElement.style.getPropertyValue("--c-brass") || "",
        }));
        if (mode === "light" && !applied.mode) {
          failures.push(`${theme}/light/${scr.name}: light mode did not apply (--c-bg unset)`);
          continue;
        }
        const r = await page.evaluate(measureContrast);
        totalMeasured += r.measured;
        for (const f of r.findings) {
          const line = `${theme}/${mode}/${scr.name}: "${f.txt}" ${f.got}:1 (needs ${f.need}:1, ${f.size}px, ${f.color} on ${f.bg})`;
          if (f.dimmed) { warnings.push(line + " [deliberately dimmed]"); continue; }
          (f.got < FAIL_BELOW ? failures : warnings).push(line);
        }
      }
      await ctx.close();
      console.log(`${DIM}  ✓ ${theme} · ${mode}${OFF}`);
    }
  }
  await browser.close();
  stop();

  if (totalMeasured === 0) {
    die("measured 0 text elements — the seed or the selectors drifted, so a pass\n" +
        "  here would mean nothing.");
  }
  console.log(`${DIM}  ${totalMeasured} text elements measured${OFF}`);

  // De-duplicate: the same string on the same screen repeats across renders.
  const uniq = (a) => Array.from(new Set(a));
  const warn = uniq(warnings), fail = uniq(failures);

  // Triage aid: the console report is capped, so a full dump is the
  // only way to see the whole warning set at once.
  if (process.env.THEME_CONTRAST_JSON) {
    fs.writeFileSync(process.env.THEME_CONTRAST_JSON,
      JSON.stringify({ warnings: warn, failures: fail, measured: totalMeasured }, null, 1));
    console.log(`${DIM}  full report → ${process.env.THEME_CONTRAST_JSON}${OFF}`);
  }

  if (warn.length) {
    console.log(`\n${YEL}Below AA but above ${FAIL_BELOW}:1 (${warn.length}) — triage, not necessarily defects:${OFF}`);
    for (const w of warn.slice(0, 25)) console.log("  · " + w);
    if (warn.length > 25) console.log(`  · …and ${warn.length - 25} more`);
  }
  if (fail.length) {
    console.log(`\n${RED}theme:contrast FAILED — ${fail.length} unreadable combination(s):${OFF}`);
    for (const f of fail.slice(0, 25)) console.log("  ✗ " + f);
    if (fail.length > 25) console.log(`  ✗ …and ${fail.length - 25} more`);
    process.exit(1);
  }
  console.log(`\n${GRN}theme:contrast OK${OFF} — ${THEMES.length} theme(s) × ${MODES.length} mode(s) × ${H.SCREENS.length} screens: nothing below ${FAIL_BELOW}:1.`);
}

if (require.main === module) {
  main().catch((e) => die(e && e.stack ? e.stack : String(e)));
}

module.exports = { THEMES, MODES, FAIL_BELOW };
