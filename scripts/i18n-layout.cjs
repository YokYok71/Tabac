#!/usr/bin/env node
/**
 * i18n LAYOUT CHECK — does the UI survive every language at a narrow phone
 * width?
 *
 * WHY THIS EXISTS. `doc:check` warns when a translation is > 1.4× the French
 * length ("may overflow tight layouts"). Today that is ~280 keys across de/es/
 * it/en, which is far too many to re-read on each commit — so the warning had
 * become noise nobody could act on. The question it is really asking ("does
 * anything actually break?") is not answerable by reading strings: it depends
 * on the box each string lands in. So answer it by RENDERING.
 *
 * A hand pass did exactly that and found the layouts absorb everything —
 * no clipping, no overflow, in any language. This script is that measurement,
 * committed, so the next language (or the next dense screen) is one command
 * instead of rebuilding the scaffolding from scratch.
 *
 * NOT part of CI, and Playwright is deliberately NOT a dependency: this needs a
 * real browser, which would cost every install and every CI run for a check
 * that is meaningful only when the UI or the dictionaries change shape. Run it
 * when you add a language, add a dense surface, or before a release.
 *
 *   npm run build                        # the check runs against dist/
 *   npm i --no-save playwright-core      # once per machine
 *   npm run i18n:layout                  # add -- --shots to also write PNGs
 *   npm run i18n:layout -- --langs pt    # one language while iterating
 *
 * TWO RUN MODES — pick deliberately:
 *
 *   PRE-RELEASE (the default): the whole matrix — EVERY language in the
 *   LANGUAGES registry (not a literal list: see registryLangs) × every screen ×
 *   2 text sizes × 2 widths. Six languages over 36 screens is 864 renders.
 *   It FANS OUT, one process per language over one shared preview server
 *   (`parallelRun.cjs`): MEASURED at ~10 min, against the ~55 it took in
 *   series. That is the difference between a check run before a release and one
 *   that competes with an hour of waiting — which is how an opt-in check stops
 *   being run at all.
 *
 *   ITERATION: one combination, ~45 s — while fixing something the full matrix
 *   just reported. Narrowing to a single language also means a single process,
 *   with no fan-out at all. Flags or the equivalent env vars:
 *     npm run i18n:layout -- --langs de --scales l --widths 360
 *     I18N_LAYOUT_LANGS=de I18N_LAYOUT_SCALES=l I18N_LAYOUT_WIDTHS=360 \
 *       npm run i18n:layout
 *   --langs also takes a list: `-- --langs pt,de`. A flag wins over its env var.
 *   German at "L" and 360 px is the worst case on every axis at once (longest
 *   translations × largest text × narrowest viewport), so it is the right
 *   single combination when you only run one.
 *
 * TWO AXES, because a string's length is only half the question:
 *   - SCREENS. The six dock pages are the easy ones. The dense surfaces are the
 *     FORMS and SETTINGS — label + field + hint on every row, and the place
 *     German runs longest — and neither is reachable by a dock click, so the
 *     first version of this script never looked at them. They are navigated to
 *     here (add-tobacco, add-pipe, and all four Settings tabs).
 *   - TEXT SIZE. `cave-font-scale` = "l" multiplies EVERY font size by 1.12 on
 *     top of the translation's own length. A German label at 1.4x the French,
 *     rendered 12% larger, is the real worst case — so the whole matrix runs at
 *     M and at L. Set I18N_LAYOUT_SCALES=m to halve the runtime while iterating.
 *
 * Selectors are resolved from the DICTIONARIES themselves (the script parses
 * src/i18n/<lang>.ts and looks up e.g. `btn_settings`), so it clicks the right
 * control in each language instead of guessing at a position — and a renamed
 * key fails the run loudly rather than silently skipping the screen.
 *
 * WHAT IT ASSERTS (exit 1 on either):
 *   1. No horizontal document overflow — the page never scrolls sideways.
 *   2. No CLIPPED text — no element whose content is wider than its box while
 *      unable to show it (`nowrap` / `overflow:hidden` / ellipsis). Wrapping is
 *      fine: the design wraps on purpose, so a longer word making a card taller
 *      is not a defect.
 *
 * WHAT IT ONLY REPORTS (never fails): the tobacco card's footer row, where the
 * weight sits left and the status badges right. It has ~206 px of usable width
 * and French uses 152, so it is the tightest row in the app — the canary. Every
 * language except fr/en wraps it in some configuration (it 222-246 px; es 207
 * and de 199 + the row's 8 px gap once a third badge such as the ✕ no-rebuy
 * marker is present) — and at the "L" text size even ENGLISH does (206 of 206),
 * which says the row is at its limit rather than any language being at fault.
 * That is a WRAP, not a clip: the row is `flexWrap`, so the
 * card just gets ~29 px taller. Measured and accepted — do NOT
 * "fix" it by shortening translations (a pass tried `BARATTOLO` → `BARAT.`;
 * at 199 + 8 > 206 it still wrapped, so it bought nothing and only made the
 * word vaguer). The honest lever, if the single line is ever wanted back, is
 * the layout: the 8 px row gap or the badge letter-spacing.
 *
 * THE SEED MATTERS. Lists are grouped-and-collapsed by default, so without
 * `cave-default-grouped=0` no card renders at all and the whole check passes
 * vacuously. It therefore asserts that it actually saw cards, and fails if it
 * did not — a green run must mean "measured", never "found nothing to measure".
 */

"use strict";

const PAR = require("./parallelRun.cjs");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.I18N_LAYOUT_PORT || 4173);
const URL = `http://localhost:${PORT}/`;
// Two viewports. 360 is the narrow phone the app is designed for;
// 820 clears the 760px column cap so the two-column Home grids, the wide
// Stats charts and the centred dock pill are exercised at full width — no
// automated check had ever looked at that layout.
// A CLI flag alongside --shots, because `-- --shots` is already the
// documented idiom and reaching for an env var to narrow one axis is not. The
// env vars still work — they are what the header has always documented — and
// the flag simply wins when both are given.
function opt(name, env, fallback) {
  const i = process.argv.indexOf("--" + name);
  const flag = i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1] : "";
  return String(flag || process.env[env] || fallback).split(",").map((x) => x.trim()).filter(Boolean);
}

// Two viewports. 360 is the narrow phone the app is designed for;
// 820 clears the 760px column cap.
const WIDTHS = opt("widths", "I18N_LAYOUT_WIDTHS", "360,820").map(Number);

// DERIVED from the registry, never a literal list. This line once
// read "fr,en,es,de,it" — so the full run silently skipped Portuguese, in the
// one script whose job is to verify a newly added language. That is the same
// silent-subset shape as the six sites LANG_ASSETS replaced, in the checker
// itself: it reported a clean matrix while measuring five of six languages.
// Locked by i18nLayoutHarness.test.ts.
function registryLangs() {
  const src = fs.readFileSync(path.join(ROOT, "src/i18n/languages.ts"), "utf8");
  const block = src.slice(src.indexOf("LANGUAGES"), src.indexOf("];", src.indexOf("LANGUAGES")));
  const codes = [...block.matchAll(/code:\s*"([a-z]{2,3})"/g)].map((m) => m[1]);
  if (!codes.length) throw new Error("i18n-layout: could not read LANGUAGES from src/i18n/languages.ts");
  return codes;
}
const LANGS = opt("langs", "I18N_LAYOUT_LANGS", registryLangs().join(","));

// "m" = the default 1.0 scale, "l" = the "Taille du texte: L" setting (1.12).
const SCALES = opt("scales", "I18N_LAYOUT_SCALES", "m,l");
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = path.join(ROOT, "i18n-layout-shots");

const RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", DIM = "\x1b[2m", OFF = "\x1b[0m";

function die(msg) {
  console.error(`${RED}i18n:layout — ${msg}${OFF}`);
  process.exit(1);
}

// ── Seed: enough of a cellar that every screen has something to lay out ──────
const day = 86400000;
const iso = (d) => new Date(Date.now() - d * day).toISOString().slice(0, 10);
let lotId = 1;
const lot = (o) =>
  Object.assign(
    {
      id: 1e12 + lotId++, status: "cellar", weightG: "50", weightInitial: "50",
      datePurchased: iso(2200), dateProduction: iso(2400), dateOpened: "",
      dateFinished: "", boxNumber: "1", price: "12", seller: "", disposed: false,
    },
    o,
  );

const DATA = {
  tobaccos: [
    { id: 1, brand: "Halvorsen", name: "Duskfall", category: "Anglais", cut: "Ribbon",
      force: 4, roomNote: 3, taste: 4, rating: 5, rebuy: true, agingMax: "8",
      // TAGS. Without them TagChipRow never renders, so its
      // "Collections" label — 3.87:1 in light mode, the worst finding of the
      // fiche/modal coverage pass — was absent from every screen either check could see.
      // It is shared by all three fiches, hence tags on all three entity types.
      tags: ["voyage", "cadeaux"], lots: [
        // The FIRST lot row carries a PINNED id and three sessions
        // against it (below). `modal-lot` opens this row, and that modal gained a
        // "sessions smoked from this lot" list — with every
        // seeded session on `lotId: ""` the list rendered its EMPTY state, so
        // the populated case (date · time · grams, one row per bowl, the part
        // that can actually overflow at 360px in German at "L") was measured by
        // nothing. The rule: the seed is a screen GATE.
        //
        // `weightG` is 50 − (2.5 + 2.8 + 3.1) = 41.6 so the lot BALANCES. An
        // unbalanced lot trips useLotIntegrityProbe 1.5s after load, which
        // turns the Settings diagnostic section oxblood and would silently
        // change what the settings-app screen measures.
        lot({ id: 1e12, status: "jar", dateOpened: iso(400), weightG: "41.6" }),
        lot({ status: "jar", dateOpened: iso(200) }),
        lot({}), lot({}), lot({}), lot({ datePurchased: iso(5000), dateProduction: iso(5200) }),
      ] },
    { id: 2, brand: "Pellworm", name: "North Light", category: "Virginia/Burley", cut: "Flake",
      force: 2, roomNote: 2, taste: 3, rating: 4, rebuy: false, agingMax: "20", lots: [
        lot({ status: "jar", dateOpened: iso(60) }), lot({}), lot({ datePurchased: iso(1500) }),
      ] },
    { id: 3, brand: "Marlow & Finch", name: "Crown of the North", category: "Burley", cut: "Ribbon",
      force: 3, roomNote: 3, taste: 3, rating: 4, rebuy: true, agingMax: "", lots: [
        lot({ status: "finished", weightG: "0", dateFinished: iso(30) }),
      ] },
    // A LOW-STOCK row, which is what puts the shopping list's
    // "À racheter" section on screen — `computeShoppingList` requires
    // `totalActive > 0 && <= threshold`, so the already-empty tobacco above does
    // NOT qualify (an empty tin is not "running low"). Without this the modal
    // opened showing the wishlist only and the screen's arrival check failed,
    // which is the check working: it refused to measure a half-rendered screen.
    // NAME LENGTH IS A DELIBERATE CHOICE HERE. A 41-char name ("Kendal Kentucky
    // Dark Fired Ribbon Reserve") was tried first and turned the run red in five
    // places — the Home suggestion rows (296px needed, 228px box) and the
    // shopping row (286/153) — every one of them an ellipsis the design intends:
    // a constrained row shows a truncated name and the fiche is the full record.
    // Encoding that as a FAILURE would freeze a design decision as permanent red
    // and pressure the next person into "fixing" correct code, which is the
    // over-strict-guard trap this repo has already paid for once. So the fixture
    // uses a realistic length, and the measurement is recorded here instead: at
    // 360px the shopping row fits ~21 characters and a Home suggestion row ~31.
    // If a row ever gets TIGHTER than that, this name stops fitting and the run
    // goes red — which is the regression worth catching.
    // "Aromatique" + "Virginia/Burley" above are the two LONGEST canonical
    // category labels (71px and 88px at the default text size in French). They
    // are seeded on purpose: the Home "Familles" row gave its label 66px, so
    // both were clipped on every user's home screen — and the fixture's previous
    // categories (Anglais / Virginia / Burley / Dark Fired) all happened to fit,
    // which is precisely why no run ever reported it. A real export did.
    { id: 4, brand: "Saltcote", name: "Marram",
      category: "Aromatique", cut: "Ribbon", force: 4, roomNote: 4, taste: 4,
      rating: 4, rebuy: true, agingMax: "7", lots: [
        lot({ status: "jar", weightG: "8", weightInitial: "50", dateOpened: iso(90) }),
      ] },
  ],
  pipes: [
    { id: 1, brand: "Halvorsen", name: "Sherlock Holmes", shape: "Bent Billiard",
      courbure: "Semi-courbée", length: "140", weight: "45", filterType: "9mm",
      chamberDiameter: "20", chamberDepth: "42", bowlMaterial: "Bruyère",
      stemMaterial: "Ébonite", finish: "Lisse", rating: 5, status: "active",
      datePurchased: "2020", price: "180", tags: ["quotidienne"],
      // Two maintenance entries: the "Carnet d'entretien" section on the pipe
      // fiche is empty without them, and an empty section renders no text.
      maintenance: [
        { id: 1, date: iso(20), kind: "light", tasks: ["swab"], notes: "" },
        { id: 2, date: iso(120), kind: "full", tasks: ["ream", "saltalcohol"], notes: "Note" },
      ] },
    { id: 2, brand: "Savinelli", name: "Roma 320", shape: "Billiard", courbure: "Droite",
      length: "135", weight: "40", filterType: "6mm", chamberDiameter: "19",
      chamberDepth: "40", bowlMaterial: "Bruyère", stemMaterial: "Acrylique",
      finish: "Rustiquée", rating: 4, status: "active", datePurchased: "2022",
      price: "90", maintenance: [] },
    // A RETIRED pipe. The fixture held only `status:"active"` rows, so
    // PipeCard's retired branch never rendered on any of the screens then covered — which
    // is why neither check ever saw that a whole-card `opacity: 0.55` put its
    // text at ~2.3:1 in all six theme×mode combos. A fixture that only walks the
    // happy path makes both browser checks green on the happy path only.
    { id: 3, brand: "Brackwater", name: "Shell Briar", shape: "Bulldog", courbure: "Droite",
      length: "132", weight: "38", filterType: "Aucun", chamberDiameter: "18",
      chamberDepth: "38", bowlMaterial: "Bruyère", stemMaterial: "Ébonite",
      finish: "Sablée", rating: 3, status: "finished", datePurchased: "2015",
      price: "150", maintenance: [] },
  ],
  accessories: [
    { id: 1, brand: "IM Corona", name: "Old Boy", type: "Briquet", fuel: "Gaz",
      datePurchased: "2021", price: "220", rating: 5, status: "active",
      tags: ["voyage"], seller: "Au Bureau de Tabac", notes: "Note" },
    // A RETIRED accessory — same reason as the retired pipe above.
    { id: 2, brand: "Czech", name: "Outil 3-en-1", type: "Bourre-pipe",
      datePurchased: "2018", price: "8", rating: 2, status: "retired" },
    // A SOFT-DELETED row. The trash indicator only renders when
    // something carries `deletedAt`, so with no such row the trash modal was
    // unreachable — and that is the screen whose German label column collapses
    // to 21px. A long name on purpose: the row's defect is that its label column
    // is starved by the restore button, which a short name would hide.
    { id: 3, brand: "Vauen", name: "Cure-pipe de voyage en laiton", type: "Autre",
      datePurchased: "2019", price: "15", rating: 3, status: "active",
      deletedAt: new Date(Date.now() - 2 * 864e5).toISOString() },
  ],
  wishlist: [
    { id: 1, brand: "Cranmere", name: "Salt Marsh", category: "Balkan", cut: "Broken Flake",
      force: 3, roomNote: 3, taste: 4, priority: "medium", agingMax: "10" },
  ],
  sessions: [
    // Sessions 1/3/4 are attributed to Duskfall's first lot (id
    // 1e12) so the lot modal's session list renders POPULATED. Session 2 keeps
    // `lotId: ""` on purpose — an unattributed bowl is an ordinary state (the
    // merge-time lot detach, accounting turned off, a legacy row) and the journal
    // must stay measured with one of each.
    { id: 1, date: iso(5), time: "20:30", tobaccoId: 1, pipeId: 1, duration: "55",
      rating: 5, notes: "Note", weightG: "2.5", lotId: "1000000000000", aromas: ["leather", "smoky"] },
    { id: 2, date: iso(3), time: "18:00", tobaccoId: 2, pipeId: 2, duration: "40",
      rating: 4, notes: "", weightG: "2.2", lotId: "", aromas: ["hay"] },
    { id: 3, date: iso(18), time: "09:15", tobaccoId: 1, pipeId: 1, duration: "35",
      rating: 4, notes: "", weightG: "2.8", lotId: "1000000000000", aromas: ["smoky"] },
    { id: 4, date: iso(46), time: "", tobaccoId: 1, pipeId: 2, duration: "70",
      rating: 3, notes: "", weightG: "3.1", lotId: "1000000000000", aromas: [] },
  ],
  nxT: 5, nxP: 4, nxA: 4, nxJ: 5, nxW: 2,
};

// ── Steady-state flags the harness seeds ────────────────────────────────────
// Named (not inline) so the harness's own assumptions are testable. TWO of
// these were learned by debugging, and dropping either silently breaks the run:
//   cave-default-grouped=0  — lists are grouped-and-COLLAPSED by default, so
//     without it no card renders and the whole check passes having measured
//     nothing (that guard fired on the very first run).
//   cave-last-export-ts     — a cellar that has never been exported shows the
//     export-reminder banner, `position:fixed` at the top, which COVERS the
//     TopBar: it swallowed the "+" and the gear, and the Settings modal even
//     opened on the wrong tab because the tab click landed on the banner.
// "@now" is resolved to Date.now() inside the page.
//
// THE CATALOGUE IS A SEED NOW, and forgetting it would have
// cost three screens silently. The app used to ship one; it is now
// the user's own file, so a harness that seeds nothing renders the
// EMPTY state on `catalog`, loses the catalogue group from `modal-search`, and
// loses the one-tap fill offer from both entry forms — all four still
// "reachable" (the markers are TopBar strings), all four measuring a page no
// user with a catalogue has. Verbatim the clipping-ancestor finding: a green run over
// an empty state is the most reassuring way to miss a screen.
//
// It is written to IndexedDB rather than localStorage because that is where
// `catalogueStore` keeps it. Only the RAW CSV + a deliberately STALE parser
// version are seeded: `catalogueLoad` then re-parses through the REAL parser,
// so the harness cannot drift from the app's own normalisation by seeding a
// cache the current code would never produce.
const SEED_KEYS = {
  "cave-terms-accepted": "1",
  "cave-curator-welcomed": "1",
  "cave-default-grouped": "0",
  "cave-last-export-ts": "@now",
};

// ── The one screen that needs MORE ROWS THAN THE SEED HAS ───────────────────
//
// The flat lists render a bounded prefix (`useProgressiveList`, 60 rows) with a
// « Afficher la suite (N) » footer below it. That footer is a CONTROL — a mono
// uppercase label with letter-spacing, in six languages — and the shared seed
// holds 18 tobaccos, so it never rendered and neither check had ever measured
// it. Verbatim the rule this harness keeps re-learning: **the seed is a screen
// GATE**, and a green run over a state the seed cannot reach is the most
// reassuring way to miss a control.
//
// The clones are DELIBERATELY MINIMAL and each carries ONE BALANCED LOT. A
// lot-less tobacco is filtered out of the default "Actifs" list (`countActive`
// requires a non-finished lot), so it would never reach the list at all; and an
// unbalanced one trips `useLotIntegrityProbe` 1.5 s after load, which turns the
// diagnostic oxblood and silently changes what the screen measures. Ids start
// far above anything in DATA so nothing collides.
const BIG_LIST_ROWS = 80;
function bigListCellar() {
  const extra = [];
  for (let i = 0; i < BIG_LIST_ROWS; i++) {
    extra.push({
      id: 9000 + i, uid: "seed-big-" + i,
      brand: "Vondel", name: "Overflow " + (i + 1),
      category: "Virginia", cut: "Flake", force: 3, roomNote: 2, taste: 3,
      rating: 4, rebuy: null, tastingNotes: "", description: "", imageUrl: "",
      agingMax: "", tags: [],
      lots: [{
        id: 9e11 + i, status: "cellar", weightG: "50", weightInitial: "50",
        datePurchased: "2025-01-01", dateProduction: "", dateOpened: "",
        dateFinished: "", boxNumber: String(i + 1), price: "12", seller: "",
        disposed: false,
      }],
    });
  }
  return Object.assign({}, DATA, {
    tobaccos: DATA.tobaccos.concat(extra),
    nxT: 9000 + BIG_LIST_ROWS + 1,
  });
}

/** Swap the cellar for the screen about to run. Needs a RELOAD: the app reads
 *  localStorage once at boot, so writing it under a live page changes nothing
 *  — the same reason the catalogue swap re-navigates. */
/**
 * WAIT FOR THE ENTRY ANIMATION, NEVER SLEEP THROUGH IT.
 *
 * Every card fades in through `useEnter` — `opacity: entered ? 1 : 0` over a
 * 460 ms CSS transition, with a per-row delay capped at ENTER_MAX_DELAY_MS
 * (700), so the tail settles ~1160 ms after mount. The fixed 700 ms wait after
 * a dock click is short of that, and on a LONG list the whole tail is still
 * mid-fade.
 *
 * That is invisible to the layout check — a row at opacity 0 still has its
 * geometry — and catastrophic for the contrast one, which folds ancestor
 * opacity into the foreground: `theme:contrast` reported 443 unreadable
 * combinations on `inv-long`, with the SAME string over the SAME two colours
 * measuring 4.23:1, 2.28:1 and 1.51:1 in three different rows. Identical
 * colours cannot give different ratios; only an opacity can, which is what
 * identified the animation rather than the palette.
 *
 * It filters to CSSTransition ON PURPOSE. The app runs INFINITE WAAPI
 * animations (the Spinner, the dock's brass indicator), so "no running
 * animation" is never true and a naive wait would always burn its full budget.
 * `useEnter` is a CSS transition; those are not.
 *
 * BOUNDED: a transition that never ends shortens the wait instead of hanging
 * the run — the same trade `drainScheduler` makes.
 */
async function settle(page, budgetMs = 2500) {
  await page.waitForFunction(() => {
    const anims = document.getAnimations ? document.getAnimations() : [];
    return !anims.some((a) =>
      a.playState === "running" && a.constructor && a.constructor.name === "CSSTransition");
  }, undefined, { timeout: budgetMs }).catch(() => {});
}

async function setCellar(page, payload, pinned) {
  await page.evaluate(([json, pin]) => {
    localStorage.setItem("pipe-cellar-v6", json);
    // Tells the context's init script to leave the cellar alone on the reload
    // that follows — see the guard there.
    if (pin) localStorage.setItem("__harness-cellar-pinned", "1");
    else localStorage.removeItem("__harness-cellar-pinned");
  }, [JSON.stringify(payload), !!pinned]);
}

// The excerpt the test suite already uses (28 real rows over 26 brands), so
// the harness and the unit tests measure the same catalogue.
const CATALOGUE_CSV = fs.readFileSync(
  path.join(ROOT, "src/__tests__/fixtures/catalogue-excerpt.csv"), "utf8");

/** Put the catalogue in IndexedDB (or remove it) for the screen about to run. */
async function setCatalogue(page, csv) {
  await page.evaluate(async (text) => {
    await new Promise((resolve) => {
      // This body runs in the PAGE via page.evaluate, not in Node.
      // eslint-disable-next-line no-undef -- `indexedDB` is resolved in the page
      const req = indexedDB.open("cave-catalogue", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("c")) db.createObjectStore("c");
      };
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("c", "readwrite");
        const st = tx.objectStore("c");
        if (text) {
          st.put(text, "csv");
          // parserVersion 0 forces catalogueLoad to re-parse from the CSV with
          // the CURRENT parser — see the SEED_KEYS note.
          st.put({ parserVersion: 0, db: null }, "parsed");
          st.put({ name: "harness.csv", loadedAt: Date.now(), blends: 0, brands: 0,
                   langs: [], skippedNoIdentity: 0, duplicateKeys: 0,
                   unknownCategories: [], unknownCuts: [], parserVersion: 0,
                   csvChars: text.length }, "meta");
        } else {
          st.delete("csv"); st.delete("parsed"); st.delete("meta");
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      };
    });
  }, csv);
}

// ── Dictionary lookup, so we click the right control in every language ──────
// Parsing the .ts dictionary with a regex is the same trick doc-check.cjs uses;
// it needs the one-key-per-line `key:"value"` shape the repo already enforces.
function readDict(code) {
  const src = fs.readFileSync(path.join(ROOT, "src/i18n", code + ".ts"), "utf8");
  const out = Object.create(null);
  const re = /^\s*([A-Za-z0-9_]+)\s*:\s*"((?:[^"\\]|\\.)*)"/gm;
  let m;
  while ((m = re.exec(src))) out[m[1]] = m[2].replace(/\\"/g, '"');
  return out;
}
// A missing key must FAIL, not silently skip the screen — a skipped dense
// screen is exactly the blind spot this pass exists to close.
function label(dict, key, lang) {
  const v = dict[key];
  if (!v) die(`i18n key "${key}" missing from src/i18n/${lang}.ts — the layout check\n` +
              "  navigates by label, so it can no longer reach that screen. Fix the key or\n" +
              "  update SCREENS in scripts/i18n-layout.cjs.");
  return v;
}

/** The part of a dictionary value the app ACTUALLY RENDERS.
 *
 *  A marker is matched as a substring of the page, and several values carry a
 *  `{n}` the app interpolates — so the raw value never appears and the screen
 *  reports as unreachable. That is exactly what happened to `inv-long`'s
 *  `list_more` ("Mehr anzeigen ({n})"): the run failed on a marker problem
 *  dressed as a navigation problem.
 *
 *  Truncating at the first placeholder is the fix, and the LENGTH GUARD is what
 *  keeps it honest: a value beginning with its placeholder would leave a prefix
 *  short enough to match half the page, turning "screen reached" into a
 *  vacuous pass — the failure this whole marker mechanism exists to prevent. */
function markerText(v, key) {
  const i = String(v).indexOf("{");
  const head = (i === -1 ? String(v) : String(v).slice(0, i)).trim();
  if (head.length < 3) {
    die(`i18n key "${key}" starts with a placeholder, so it leaves nothing\n` +
        "  distinctive to match. Pick a marker whose literal text the app renders.");
  }
  return head;
}

// Each screen knows how to reach itself from the one before. `dock` is an index
// in the bottom bar; `go` is a custom navigation run against the page.
const SCREENS = [
  { name: "home", dock: null },
  { name: "inv", dock: 1 },
  { name: "pipes", dock: 2 },
  { name: "acc", dock: 3 },
  { name: "journal", dock: 4 },
  { name: "stats", dock: 5 },
  // ── The dense surfaces ─────────────────────────────────────────────────────
  {
    // `expect` is a dictionary key whose text must be on screen afterwards —
    // proof the navigation actually landed. Counting inputs was NOT enough:
    // the inventory list has filter <select>s (so a form that never opened
    // still looked "reached") while the App and Help tabs have none at all.
    name: "form-tobacco", dock: 1, expect: "sec_flavour",
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "btn_add", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    name: "form-pipe", dock: 2, expect: "sec_dimensions",
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "btn_add", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    // The « Afficher la suite (N) » footer. `bigList` swaps in a cellar with
    // more tobaccos than `PROGRESSIVE_STEP`, which is the only way this control
    // reaches the screen. The marker is `list_more` — unique to that footer, so
    // it proves the CONTROL is on screen and not merely the list behind it.
    name: "inv-long", dock: 1, bigList: true, expect: "list_more",
  },
  // ── The RETIRED slices ─────────────────────────────────────────────────────
  // Adding a retired pipe / accessory to DATA is not enough on its own: both
  // lists default to showing ACTIVE ONLY, so the retired CARD still never
  // renders. These two screens tap the "Retirées" / "Retirés" filter chip, which
  // is what finally puts that branch in front of the measurement — it had a
  // whole-card `opacity: 0.55` dropping its text to ~2.3:1 in every one of the
  // six theme×mode combos and neither check could see it.
  //
  // Clicked by TEXT resolved from the dictionary (like every other control here),
  // so a renamed key fails the run loudly instead of silently skipping a screen.
  {
    name: "pipes-retired", dock: 2, expect: "pipe_retired_lbl",
    async go(page, dict, lang) {
      await page.getByText(label(dict, "f_retired_pipes", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    name: "acc-retired", dock: 3, expect: "acc_retired",
    async go(page, dict, lang) {
      // getByRole, not getByText. The chip label and the count line
      // above it can share a word — a translation fix moved the Italian count line to
      // the plural "ritirati", which is what the chip says, so `.first()`
      // silently started clicking the (inert) count line and four screens went
      // unreachable. A correct translation fix must not be able to do that.
      await page.getByRole("button", { name: label(dict, "f_retired_acc", lang), exact: true })
        .first().click({ force: true });
    },
  },
  // ── The FICHES and the MODALS ─────────────────────────────────────────────
  // The list above had walked lists, forms and Settings — and not one detail
  // page or dialog, in either check, ever. That gap cost real defects: FOUR
  // light-mode semantic tokens were under AA as text with every instance living
  // on a fiche or inside a modal (steel-hi 3.87:1, ember 4.22, amber 4.27,
  // oxblood-hi 4.34), and the trash row clipped 84% of the item name in German
  // at the L text size — a CLIPPED failure by this script's own rule, on the one
  // screen whose purpose is telling you what you are about to delete for ever.
  // Both were invisible because neither surface was ever rendered.
  //
  // A fiche opens by tapping the first card, so `go` clicks the brand text (a
  // stable string from DATA, not a dictionary key) and `expect` is a
  // fiche-ONLY key — a card list would satisfy a brand-name check on its own.
  {
    name: "fiche-tobacco", dock: 1, expect: "sec_lots",
    async go(page) {
      await page.getByText("Duskfall", { exact: false }).first().click({ force: true });
    },
  },
  {
    name: "fiche-pipe", dock: 2, expect: "sec_specs",
    async go(page) {
      await page.getByText("Sherlock Holmes", { exact: false }).first().click({ force: true });
    },
  },
  {
    name: "fiche-acc", dock: 3, expect: "sec_acquisition",
    async go(page) {
      await page.getByText("Old Boy", { exact: false }).first().click({ force: true });
    },
  },
  // The lot detail modal — reached THROUGH the tobacco fiche, so this screen
  // also proves the fiche→modal path still works. The lot rows carry an
  // aria-label built from the status tag + "Nº n"; "Nº" is language-independent.
  {
    // `lbl_current` ("Actuel") is rendered UNCONDITIONALLY and ONLY inside this
    // modal — checked against the source. The first attempt used `lbl_initial`,
    // which the fiche can also render, so the layout run reported this screen as
    // reached while measuring the fiche underneath; the contrast run, at a
    // different width, reported it unreachable. Two checks disagreeing about the
    // same screen is what exposed the marker as the bug, not the screen.
    name: "modal-lot", dock: 1, expect: "lbl_current",
    async go(page, dict, lang) {
      await page.getByText("Duskfall", { exact: false }).first().click({ force: true });
      await page.waitForTimeout(700);
      // KEYBOARD activation, not a second click. The card tap that opened the
      // fiche fired through PressCard's pointer path, which installs a one-shot
      // document capture listener to swallow the trusted click that follows
      // (the ghost-click defence) — so an immediate programmatic
      // click on the lot row was eaten and the modal never opened. Pressing
      // Enter goes through the row's onKeyDown handler instead, which also means
      // this screen exercises the keyboard path the a11y invariants require.
      // The stable hook, NOT the aria-label: production added `data-lot-row`
      // precisely because selecting on "Nº " coupled the selector
      // to a French literal. This harness kept doing it, so Portuguese ("N.º ")
      // could not reach the screen at all.
      const row = page.locator("[data-lot-row]").first();
      await row.focus();
      await page.keyboard.press("Enter");
      void dict; void lang;
    },
  },
  // The two modals opened from a top-bar icon. Both are gated on the fixture
  // producing something to show: the trash indicator only renders when a row
  // carries `deletedAt`, and the cart only when the shopping list is non-empty
  // (DATA's finished-lot tobacco with rebuy:true is the low-stock row, and the
  // wishlist supplies the rest) — so the seed and the screen must stay in step.
  {
    name: "modal-trash", dock: 1, expect: "trash_days_left",
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "aria_open_trash", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    name: "modal-shopping", dock: 1, expect: "shopping_restock",
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "shopping_title", lang), { exact: false }).first().click({ force: true });
    },
  },
  // ── The FORMS and the remaining overlays ─────────────────────────────────
  // An earlier pass added the three fiches + three modals — the six surfaces that had
  // findings. The audit had actually RENDERED 24 screens; the rest were measured
  // clean once and then left unprotected, which is not the same as covered. The
  // forms are the priority of what was left: label + field + hint on every row is
  // where German runs longest, and that is exactly why form-tobacco / form-pipe
  // were added first.
  //
  // EVERY `expect` below was checked for exclusivity against src/views +
  // src/components before being used, because that pass got this wrong once:
  // `lbl_initial` also renders on the fiche, so the layout run reported the lot
  // modal as reached while measuring the fiche underneath.
  //
  // The two EDIT forms use `lbl_edit` — the edit-mode overline, shared by all
  // five form views but present on no fiche and no list. So it proves "a form,
  // in edit mode"; which form is settled by the navigation path. That is a
  // weaker claim than the others and deliberately so: an edit form IS the same
  // component as its add form, so no marker can separate them.
  {
    // NOT `btn_add`: the journal's "+" is labelled `btn_new_session` (it
    // pre-fills today's date + time, so it is its own control). The first
    // version used btn_add and timed out — which is the guard working: an
    // unreachable screen fails the run instead of being skipped.
    name: "form-session", dock: 4, expect: "sec_when_how_much",
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "btn_new_session", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    name: "form-acc", dock: 3, expect: "acc_new_overline",
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "btn_add", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    // The wishlist is a SUB-STATE of the tobacco inventory (view "inv" +
    // statusFilter "wish"), so its form is reached by selecting the chip first —
    // and its own controls row is separate, which a filter-disclosure pass discovered.
    name: "form-wish", dock: 1, expect: "sec_wishlist",
    async go(page, dict, lang) {
      await page.getByText(label(dict, "lbl_wishlist", lang), { exact: false }).first().click({ force: true });
      await page.waitForTimeout(700);
      await page.getByLabel(label(dict, "btn_add", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    name: "edit-tobacco", dock: 1, expect: "lbl_edit",
    async go(page, dict, lang) {
      await page.getByText("Duskfall", { exact: false }).first().click({ force: true });
      // 1200ms, not 600: the card tap fires through PressCard's pointer path,
      // which installs a one-shot capture listener to swallow the trusted click
      // that follows (the ghost-click defence). Waiting past that window is what
      // lets the next click reach the Edit button.
      await page.waitForTimeout(1200);
      await page.getByLabel(label(dict, "btn_edit", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    name: "edit-pipe", dock: 2, expect: "lbl_edit",
    async go(page, dict, lang) {
      await page.getByText("Sherlock Holmes", { exact: false }).first().click({ force: true });
      await page.waitForTimeout(1200);
      await page.getByLabel(label(dict, "btn_edit", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    // The lot FORM modal, distinct from the lot DETAIL modal already covered:
    // different component (LotFormModal), and the one with the dense field grid.
    name: "modal-lot-form", dock: 1, expect: "lbl_initial_weight",
    async go(page, dict, lang) {
      await page.getByText("Duskfall", { exact: false }).first().click({ force: true });
      await page.waitForTimeout(1200);
      await page.getByText(label(dict, "btn_add_lot", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    name: "modal-maint", dock: 2, expect: "maint_new_title",
    async go(page, dict, lang) {
      await page.getByText("Sherlock Holmes", { exact: false }).first().click({ force: true });
      await page.waitForTimeout(1200);
      await page.getByText(label(dict, "maint_add", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    name: "modal-session", dock: 4, expect: "lbl_session_overline",
    async go(page, dict, lang) {
      // Sessions are grouped by month; the seed expands the latest month, so the
      // rows are visible. Keyboard-activated for the same ghost-click reason as
      // the lot row.
      const row = page.getByLabel(/Duskfall|Virginia/).first();
      if (await row.count()) { await row.focus(); await page.keyboard.press("Enter"); }
      else await page.getByText("55", { exact: false }).first().click({ force: true });
      void dict; void lang;
    },
  },
  {
    name: "tasting-setup", dock: 4, expect: "sec_pipe_lbl",
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "tasting_title", lang), { exact: false }).first().click({ force: true });
    },
  },
  // ── The last three surfaces + one variant ────────────────────────────────
  // What remained of the 24 the audit had rendered. After this the committed
  // coverage matches exactly what was measured once, so nothing is left in the
  // "clean but unprotected" state.
  {
    // The wishlist LIST — a sub-state of the tobacco inventory (view "inv" +
    // statusFilter "wish"), distinct from the wish FORM above.
    // `ttl_wanted` is the TopBar title rendered ONLY in that mode.
    name: "wishlist", dock: 1, expect: "ttl_wanted",
    async go(page, dict, lang) {
      await page.getByText(label(dict, "lbl_wishlist", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    // The reference catalogue: search + chips + a brand select, over the
    // seeded excerpt. Reached by the book icon on the inventory TopBar.
    //
    // The marker is `catalog_results`, not `catalog_title`, and that is the
    // point rather than a detail. The title
    // renders in BOTH states, so with the catalogue seed missing this screen
    // would report itself reached while measuring the empty page — the
    // clipping-ancestor finding (a green run over an empty state is the most
    // reassuring way to miss a screen), one state deeper. `catalog_results` is
    // the "N/M blends" line, which exists only when there IS a catalogue.
    name: "catalog", dock: 1, expect: "catalog_results",
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "catalog_open_aria", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    // The catalogue page with NO catalogue, which is what every new user
    // sees the first time they open it.
    // `noCatalogue` makes the runner clear the store before this screen and
    // re-seed after, so the state is covered permanently rather than measured
    // once and written down. Its marker is the notice itself, not a TopBar
    // string: the page title renders in both states, so keying on it would
    // report the screen reached while measuring the populated list.
    name: "catalog-empty", dock: 1, expect: "cat_missing_hint", noCatalogue: true,
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "catalog_open_aria", lang), { exact: false }).first().click({ force: true });
    },
  },
  {
    // The global search modal. Its group headers only render once there are
    // RESULTS, so the query is part of reaching the screen — which is right:
    // an empty search modal is a text field, and the layout question is about
    // the result rows.
    name: "modal-search", dock: 1, expect: "search_grp_tobacco",
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "btn_search", lang), { exact: false }).first().click({ force: true });
      await page.waitForTimeout(600);
      const input = page.locator("input[type=text], input:not([type])").first();
      await input.fill("Night");
      await page.waitForTimeout(600);
    },
  },
  {
    // A RETIRED pipe's fiche. Same component as fiche-pipe, different branch —
    // and that branch is precisely what hid the whole-card opacity
    // (its text sat at ~2.3:1 in all six theme×mode combos) for as long as the
    // fixture held only active pipes.
    name: "fiche-pipe-retired", dock: 2, expect: "sec_specs",
    async go(page, dict, lang) {
      await page.getByText(label(dict, "f_retired_pipes", lang), { exact: false }).first().click({ force: true });
      await page.waitForTimeout(700);
      await page.getByText("Shell Briar", { exact: false }).first().click({ force: true });
    },
  },
  {
    // ── The USER GUIDE ──────────────────────────────────────────────────────
    // The longest page in the app, and neither check had ever rendered it —
    // `help.html` is fetched at runtime, so it is invisible to anything that
    // only walks the React views. That mattered the day three
    // features were added to it: the new prose went out unmeasured in six languages, on
    // the one surface whose whole content is dense text, tables and badges.
    //
    // Reached the way a user reaches it: Settings → Aide → "Mode d'emploi".
    // The doc page hides the dock (dockVisibility.ts) and `openDocFromSettings`
    // closes the modal on the way, so this screen also proves that path works.
    //
    // The marker is `btn_collapse_all`, and it carries more than arrival: the
    // button is gated on `sections && allKeys.length > 0`, i.e. help.html was
    // FETCHED and PARSED into sections for this language. A screen that renders
    // the shell over a failed fetch would report unreachable instead of quietly
    // measuring an empty page. It reads "collapse" rather than "expand" because
    // sections default to EXPANDED (`cave-help-sections` absent), which is also
    // the state worth measuring — every section's body laid out at once.
    name: "help", dock: 0, expect: "btn_collapse_all",
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "btn_settings", lang), { exact: false }).first().click({ force: true });
      await page.waitForTimeout(800);
      const tab = page.getByText(label(dict, "tab_help", lang), { exact: true }).first();
      if (await tab.count()) await tab.click({ force: true });
      await page.waitForTimeout(600);
      await page.getByText(label(dict, "btn_help", lang), { exact: false }).first().click({ force: true });
      // The guide is a runtime fetch of a ~74 KB document, then a per-section
      // source slice — slower to settle than any React-only screen here.
      await page.waitForTimeout(1500);
    },
  },
  ...[
    { tab: "prefs", expect: "lbl_font_scale" },
    { tab: "data", expect: "sec_export_import" },
    { tab: "app", expect: "sec_diagnostic" },
    { tab: "help", expect: "btn_licenses" },
  ].map(({ tab, expect }) => ({
    name: "settings-" + tab, dock: 0, expect,
    async go(page, dict, lang) {
      await page.getByLabel(label(dict, "btn_settings", lang), { exact: false }).first().click({ force: true });
      await page.waitForTimeout(800);
      const l = page.getByText(label(dict, "tab_" + tab, lang), { exact: true }).first();
      if (await l.count()) await l.click({ force: true });
    },
  })),
];

// ── The in-page measurement (serialised into the browser) ───────────────────
function measure() {
  const out = { docOverflow: document.documentElement.scrollWidth - window.innerWidth, clipped: [], rows: [], cards: 0, fields: 0, hscroll: [], cutOff: [] };
  // The document is not the only thing that can slide sideways.
  // A modal panel has its own scroll container, so a row too wide for it made
  // the whole page draggable left and right with `document.scrollWidth`
  // unchanged — this check measured nothing there, and the Settings-tab defect
  // reached a phone with every gate green.
  //
  // THE TRAP THAT CREATES THEM: `overflow-y: auto` alone. CSS computes the
  // OTHER axis to `auto` as soon as one is not `visible`, so a container that
  // only ever meant to scroll vertically becomes horizontally draggable the
  // moment anything inside it overflows. SettingsModal's body is exactly that.
  //
  // Deliberate scrollers carry `data-hscroll` (ScrollableChipRow, the Stats
  // calendar). Presence is an ACKNOWLEDGEMENT, not a claim of correctness —
  // same philosophy as the no-unscoped-lot-read ESLint rule: a guard that tries
  // to judge intent either misses the interesting cases or gets correct code
  // rewritten to please it.
  for (const el of document.querySelectorAll("div, section, main, ul, ol")) {
    if (el.hasAttribute("data-hscroll")) continue;
    if (el.closest("[data-hscroll]")) continue;
    const ovx = getComputedStyle(el).overflowX;
    if (ovx !== "auto" && ovx !== "scroll") continue;
    const by = el.scrollWidth - el.clientWidth;
    if (by <= 1 || el.clientWidth <= 0) continue;
    out.hscroll.push({
      by,
      box: el.clientWidth,
      txt: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 44),
    });
  }
  for (const el of document.querySelectorAll("span, div, button, a, label, h1, h2, h3")) {
    if (el.children.length > 0) continue;
    const txt = (el.textContent || "").trim();
    if (txt.length < 2) continue;
    const cs = getComputedStyle(el);
    const cannotShow =
      cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre" ||
      cs.overflowX === "hidden" || cs.textOverflow === "ellipsis";
    if (el.scrollWidth > el.clientWidth + 1 && cannotShow) {
      out.clipped.push({ txt: txt.slice(0, 44), scroll: el.scrollWidth, box: el.clientWidth });
    }
  }
  // The FOURTH failure mode — text painted PAST a clipping ancestor.
  //
  // The three rules above ask whether an element clips its OWN text, whether
  // the DOCUMENT slides sideways, and whether some container became draggable.
  // A case that is none of them: the lot modal's Close/Delete/Edit
  // row needed 349px in a 340px panel in German at the DEFAULT text size, and
  // the third button read « BEARBE ». The row is not a text leaf, so the
  // `clipped` rule skipped it; it has no `overflow-x: auto`, so the `hscroll`
  // rule skipped it; and the shared `Modal` panel is `overflow: hidden`, which
  // both swallows the excess and keeps `document.scrollWidth` unchanged. The
  // screen WAS in this checker's list and passed. So: an element whose content
  // is painted outside a hidden-overflow ancestor is invisible to every rule
  // we had, and the failure it hides is the worst kind — a control the user
  // cannot read or reach, with the page looking perfectly composed.
  //
  // Measured as GEOMETRY against the real clipping boundary rather than as an
  // element's own scrollWidth: the leaf carries the text, the ancestor decides
  // whether the overflow is reachable. Walking up stops at the FIRST ancestor
  // that settles the question — `auto`/`scroll` (or a `data-hscroll` marker)
  // means the content is reachable by dragging and belongs to the `hscroll`
  // rule, so those clear the element instead of accusing it.
  //
  // Leaves only, and only leaves with text: a decorative gradient bleeding out
  // of a rounded `overflow: hidden` card is the intended use of that property,
  // and reporting it would be the over-strict mistake this file keeps
  // recording. What is never intended is a WORD cut in half.
  for (const el of document.querySelectorAll("span, div, button, a, label, h1, h2, h3, p, li")) {
    if (el.children.length > 0) continue;
    const txt = (el.textContent || "").trim();
    if (txt.length < 2) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    let clip = null;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p.hasAttribute("data-hscroll")) break;
      const pcs = getComputedStyle(p);
      const ox = pcs.overflowX;
      if (ox === "auto" || ox === "scroll") break;
      if (ox === "hidden" || ox === "clip") {
        // A SIGNPOSTED truncation is not a silent cut. `text-overflow:
        // ellipsis` renders a "…", which tells the reader there is more —
        // and whether that is the right call is an EDITORIAL judgement this
        // checker must not make. The search modal decided it both ways in one
        // component: wrong for the search subtitle (two enum values, closed
        // set, computable maximum — so it wraps) and RIGHT for the title
        // above it (a blend name is user-supplied and unbounded). A rule that
        // flagged both would force the second one to be "fixed" into
        // unbounded wrapping, which is the over-strict mistake this file
        // keeps recording. The `clipped` rule above already owns the ellipsis
        // case on its own terms.
        if (pcs.textOverflow === "ellipsis") break;
        clip = p;
        break;
      }
    }
    if (!clip) continue;
    const cr = clip.getBoundingClientRect();
    // clientLeft skips the border; clientWidth excludes it and any scrollbar.
    const over = Math.round(r.right - (cr.left + clip.clientLeft + clip.clientWidth));
    if (over > 1) {
      out.cutOff.push({ txt: txt.slice(0, 44), over, box: clip.clientWidth });
    }
  }
  // The tightest row in the app: the tobacco card's footer — weight on the
  // left, status badges on the right. Keyed on the LEFT child looking like a
  // weight ("300g" / "10.5 oz"): every settings row is also a wrapping
  // space-between pair, and reporting those buried the one row worth watching.
  for (const el of document.querySelectorAll("div")) {
    const st = el.getAttribute("style") || "";
    if (!st.includes("space-between") || !st.includes("wrap")) continue;
    const kids = Array.from(el.children);
    if (kids.length !== 2 || !kids[1].textContent.trim()) continue;
    if (!/^[\d\s.,]+\s*(g|oz)\b/i.test(kids[0].textContent.trim())) continue;
    const a = kids[0].getBoundingClientRect(), b = kids[1].getBoundingClientRect();
    out.rows.push({
      left: kids[0].textContent.trim().slice(0, 12),
      right: kids[1].textContent.trim().slice(0, 30),
      sameLine: Math.abs(a.top - b.top) < 12,
      used: Math.round(a.width + b.width),
      avail: Math.round(el.clientWidth),
    });
  }
  // Proof that something was actually rendered: how many of the seeded entities
  // are on screen. Keyed on the DATA, not on a class or attribute a refactor
  // can rename — the point is to make a vacuous pass impossible.
  const body = document.body.innerText || "";
  out.cards = ["Duskfall", "North Light", "Crown of the North", "Sherlock Holmes",
    "Roma 320", "Old Boy", "Salt Marsh"].filter((n) => body.includes(n)).length;
  // Marker for the dense screens: a form or the Settings modal always carries
  // real inputs. If a `go` step silently failed we would otherwise re-measure
  // the list underneath and call it a pass.
  out.fields = document.querySelectorAll("input, textarea, select").length;
  return out;
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, "dist/index.html"))) {
    die("dist/ not built — run `npm run build` first (the check measures the real bundle).");
  }
  // ONE SHARD PER LANGUAGE, and the language is the right axis rather than the
  // scale or the width: a shard carries its own browser and its own dictionary
  // read, and the languages are what a translation change actually touches, so
  // `-- --langs de` narrows to a single process with no fan-out at all. Returns
  // false when this process IS a shard (or there is only one), and never returns
  // otherwise — it exits with the worst shard's code.
  if (await PAR.maybeFanOut({
    label: "i18n:layout", script: "i18n-layout.cjs",
    envVar: "I18N_LAYOUT_LANGS", shards: LANGS,
    portVar: "I18N_LAYOUT_PORT", port: PORT, url: URL,
  })) return;
  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    die("playwright-core not installed. It is deliberately NOT a dependency (a browser\n" +
        "  would cost every install for a check that runs a few times a year). Install it\n" +
        "  for this run only:  npm i --no-save playwright-core");
  }

  // Resolve a browser: Playwright's own resolution first, then the pre-installed
  // Chromium some environments provide.
  let exe = process.env.CHROME_PATH || "";
  if (!exe) {
    try {
      const p = chromium.executablePath();
      if (p && fs.existsSync(p)) exe = p;
    } catch { /* fall through to the scan below */ }
  }
  if (!exe) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
    if (fs.existsSync(base)) {
      for (const d of fs.readdirSync(base)) {
        const c = path.join(base, d, "chrome-linux/chrome");
        if (d.startsWith("chromium") && !d.includes("headless") && fs.existsSync(c)) { exe = c; break; }
      }
    }
  }
  if (!exe) die("no Chromium found — set CHROME_PATH, or run `npx playwright install chromium`.");

  // Adopts a server already listening — which is how N shards share ONE
  // preview, and how a `npm run preview` you already have open is reused.
  const pre = await PAR.startPreview(PORT, URL);
  const stop = pre.stop;
  if (pre.failed) die(`preview server never came up on ${URL}`);

  if (SHOTS && !fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ executablePath: exe });
  const failures = [];
  const rowNotes = [];
  let totalCards = 0;

  const unreached = [];
  for (const width of WIDTHS) {
  for (const scale of SCALES) {
    for (const lang of LANGS) {
      const dict = readDict(lang);
      const ctx = await browser.newContext({ viewport: { width, height: 780 } });
      const page = await ctx.newPage();
      await page.addInitScript(([d, l, sc, seedKeys]) => {
        // THE GUARD IS NOT DECORATION. This script runs before EVERY page load
        // in the context, so without it the reload that a per-screen cellar
        // swap needs would immediately overwrite the swapped cellar — and the
        // screen reports as unreachable, which reads as a navigation problem
        // rather than as a seed that never arrived. `setCellar` sets the flag.
        if (localStorage.getItem("__harness-cellar-pinned") !== "1") {
          localStorage.setItem("pipe-cellar-v6", d);
        }
        localStorage.setItem("cave-lang", l);
        // "Taille du texte" — "l" scales every font size by 1.12.
        localStorage.setItem("cave-font-scale", sc);
        for (const [k, v] of Object.entries(seedKeys)) {
          localStorage.setItem(k, v === "@now" ? String(Date.now()) : v);
        }
      }, [JSON.stringify(DATA), lang, scale, SEED_KEYS]);
      await page.goto(URL, { waitUntil: "networkidle" });
      await page.waitForTimeout(900);

      let prevNoCatalogue = false;
      let prevBigList = false;
      // Seed once before the first screen; the loop keeps it in step after.
      await setCatalogue(page, CATALOGUE_CSV);
      for (const scr of SCREENS) {
        // Reload before every screen. The forms and the Settings modal cover
        // the page AND the dock hides itself on a full-screen form, so trying
        // to navigate back out of them left the run stuck inside the previous
        // screen — which then measured the wrong page (Settings rows showed up
        // in the form-tobacco report) and reported three screens unreachable.
        // A reload always lands on Home with no modal, no filter, no form.
        // networkidle + a settle: the app boots asynchronously (React mount,
        // then load() from localStorage), and a shorter wait clicked before the
        // dock existed — which looked exactly like "navigation drifted".
        await page.goto(URL, { waitUntil: "networkidle" });
        await page.waitForTimeout(1000);
        // The catalogue lives in IndexedDB, which survives the reload above —
        // so set it for THIS screen before navigating, and let the next screen
        // set it back. (Same page, one context per language/scale/width.)
        await setCatalogue(page, scr.noCatalogue ? "" : CATALOGUE_CSV);
        if (scr.noCatalogue || prevNoCatalogue) {
          // The app reads the store once per boot and caches it in module
          // memory, so a change needs a fresh JS context to be observed.
          await page.goto(URL, { waitUntil: "networkidle" });
          await page.waitForTimeout(1000);
        }
        prevNoCatalogue = !!scr.noCatalogue;
        // Same shape as the catalogue swap above, and for the same reason: the
        // cellar is read once per boot, so a change needs a fresh JS context.
        if (scr.bigList || prevBigList) {
          await setCellar(page, scr.bigList ? bigListCellar() : DATA, !!scr.bigList);
          await page.goto(URL, { waitUntil: "networkidle" });
          await page.waitForTimeout(1000);
        }
        prevBigList = !!scr.bigList;
        if (scr.dock !== null) {
          const btns = await page.locator("nav button, [role=navigation] button").all();
          if (btns.length > scr.dock) await btns[scr.dock].click({ force: true }).catch(() => {});
          await page.waitForTimeout(700);
        }
        if (scr.go) {
          try {
            await scr.go(page, dict, lang);
            await page.waitForTimeout(1200);
          } catch (e) {
            unreached.push(`${width}px/${scale}/${lang}/${scr.name} (${String(e && e.message || e).split("\n")[0].slice(0, 90)})`);
            continue;
          }
        }
        // Same condition as the contrast check, and it earns its place here too:
        // `useEnter` animates translateY as well as opacity, so a row measured
        // mid-fade is measured mid-MOVE — its box has not reached its final
        // position. Cheap when nothing is running.
        await settle(page);
        // A dense screen that never opened would measure a page we already
        // covered — a silent pass. Every navigated screen proves it arrived.
        if (scr.expect) {
          const marker = markerText(label(dict, scr.expect, lang), scr.expect);
          const seen = await page.getByText(marker, { exact: false }).count();
          if (!seen) {
            unreached.push(`${width}px/${scale}/${lang}/${scr.name} (no "${marker}")`);
            if (process.env.I18N_LAYOUT_DEBUG) {
              await page.screenshot({ path: `/tmp/dbg-${width}-${scale}-${lang}-${scr.name}.png`, fullPage: true });
              console.log("   debug:", (await page.evaluate(() => document.body.innerText)).slice(0, 120).replace(/\n/g, " | "));
            }
            continue;
          }
        }
        const r = await page.evaluate(measure);
        totalCards += r.cards;
        const where = `${width}px/${scale}/${lang}/${scr.name}`;
        if (r.docOverflow > 0) {
          failures.push(`${where}: page overflows horizontally by ${r.docOverflow}px`);
        }
        for (const c of r.clipped) {
          failures.push(`${where}: clipped "${c.txt}" (needs ${c.scroll}px, box ${c.box}px)`);
        }
        for (const h of r.hscroll) {
          failures.push(`${where}: slides sideways by ${h.by}px — an unmarked horizontal scroller (box ${h.box}px) around "${h.txt}"`);
        }
        for (const c of r.cutOff) {
          failures.push(`${where}: "${c.txt}" is cut off — painted ${c.over}px past a hidden-overflow ancestor (box ${c.box}px)`);
        }
        for (const row of r.rows) {
          if (!row.sameLine) {
            rowNotes.push(`${where}: "${row.left}" + "${row.right}" wrapped (${row.used}px used of ${row.avail}px)`);
          }
        }
        if (SHOTS) {
          await page.screenshot({ path: path.join(SHOT_DIR, `${width}-${scale}-${lang}-${scr.name}.png`), fullPage: true });
        }
      }
      await ctx.close();
      console.log(`${DIM}  ✓ ${lang} @ ${scale} · ${width}px${OFF}`);
    }
  }
  }
  if (unreached.length) {
    // Not a layout defect — but a screen that was never opened was never
    // checked, and reporting OK for it would be a lie.
    failures.push(`${unreached.length} screen(s) could not be reached (navigation drifted): ` +
      unreached.slice(0, 8).join(", ") + (unreached.length > 8 ? " …" : ""));
  }
  await browser.close();
  stop();

  if (totalCards === 0) {
    die("measured 0 cards — the seed or the selectors drifted, so a pass here would\n" +
        "  mean nothing. Check the localStorage seed (cave-default-grouped) before trusting this.");
  }

  if (rowNotes.length) {
    console.log(`\n${YEL}Tight rows that wrapped (informational — the design wraps on purpose):${OFF}`);
    for (const n of rowNotes) console.log("  · " + n);
  }
  if (failures.length) {
    console.log(`\n${RED}i18n:layout FAILED — ${failures.length} issue(s):${OFF}`);
    for (const f of failures) console.log("  ✗ " + f);
    process.exit(1);
  }
  console.log(`\n${GRN}i18n:layout OK${OFF} — ${LANGS.length} languages × ${SCREENS.length} screens × ${SCALES.length} text size(s) × ${WIDTHS.length} width(s) (${WIDTHS.join("/")}px): no overflow, no clipped text, no stray horizontal scroller, nothing cut off by a hidden-overflow ancestor.`);
}

// Exported so the harness's own assumptions can be unit-tested WITHOUT a
// browser (src/__tests__/i18nLayoutHarness.test.ts): that every screen's
// `expect` marker key exists in all five dictionaries, and that the seed keeps
// suppressing the banners that once covered the navigation. The run only starts
// when the file is invoked directly.
// EXPORT EVERY SEED COMPONENT, not just the screen list. `theme-contrast.cjs`
// reuses this module so the two checks measure the same app — and when the
// catalogue seed was added here and NOT exported, that check silently stopped
// being able to reach the catalogue screens while its own header asserted the
// two could not drift. If you add a seed step, export it and wire the other
// consumer in the same commit; `i18nLayoutHarness.test.ts` asserts both.
//
// THAT LAST CLAUSE WAS FALSE WHEN IT WAS WRITTEN, and it is corrected here
// rather than deleted: nothing asserted the wiring, so the very next seed step
// (`bigList`) was exported by halves and `theme-contrast` reused the `inv-long`
// screen it could never reach — reported as unreachable in all six palettes,
// which reads as a navigation problem. It is true NOW: that test derives the
// axis list from the SCREENS entries themselves and requires both scripts to
// read each `scr.<axis>`, so a fourth axis needs no one to remember it.
module.exports = {
  SCREENS, DATA, SEED_KEYS, LANGS, SCALES, WIDTHS, readDict,
  // `bigListCellar` BUILDS the payload and `setCellar` WRITES it with the pin
  // flag; exporting only the first is exporting half a seed step, which is how
  // `theme-contrast` came to reuse the `inv-long` screen without ever being
  // able to reach it. Both, or neither.
  BIG_LIST_ROWS, bigListCellar, setCellar,
  markerText, settle,
  setCatalogue, CATALOGUE_CSV,
};

if (require.main === module) {
  main().catch((e) => die(e && e.stack ? e.stack : String(e)));
}
