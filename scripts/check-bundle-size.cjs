// Build-time bundle-size guard.
//
// Runs against dist/ after `npm run build`. Guards the failure mode that once
// turned the Lighthouse job red: something large became EAGER (a data blob
// merged into the entry chunk, an extra dictionary, an un-split view) and,
// because a chunk that loads on the home screen counts toward Lighthouse's
// script-transfer budget, eager JS blew past the 500 KB hard limit.
//
// This is a fast, deterministic pre-check that fails at build time (exit 1)
// with a clear message BEFORE the slower 3-run Lighthouse pass — so a size
// regression is caught in seconds, not after a full LH run.
//
//   node scripts/check-bundle-size.cjs
//
// Budgets are gzip transfer sizes (what the browser actually downloads),
// mirroring how Lighthouse's resource-summary:script:size is measured.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const FRESH = require("./distFreshness.cjs");

const DIST = path.join(__dirname, "..", "dist");
const ASSETS = path.join(DIST, "assets");
const INDEX_HTML = path.join(DIST, "index.html");
const REPO = path.join(__dirname, "..");
const SRC = path.join(REPO, "src");

// Budgets (gzip bytes). Set with generous headroom over the current baseline
// so normal growth doesn't nag, but a structural regression (a whole extra
// dictionary, a data blob back in the entry chunk, an un-split view) trips
// immediately.
const BUDGETS = {
  // Everything index.html loads eagerly on first paint (entry + static deps:
  // index, vendor-react, rolldown-runtime). This is the number Lighthouse
  // scores against on the home screen. Only ENGLISH is compiled in; every
  // other UI language is a lazy chunk of ~16 KB, so adding one costs nothing
  // here. The script PRINTS the current figure and its percentage — read that
  // rather than trusting a number written down in a comment.
  eagerGzip: 340_000,
  // There is deliberately NO catalogue budget: a user's catalogue is a CSV
  // they load at runtime into IndexedDB, never bundled. The runtime guard is
  // `MAX_CATALOGUE_ROWS` in userCatalogue.ts, which refuses a pathological
  // file at parse time — and the whole point of IndexedDB over localStorage is
  // that a real catalogue (3.77 MB of CSV, measured) has room.
};

function gz(file) {
  return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
}
function kb(n) { return (n / 1024).toFixed(1) + " KB"; }

function main() {
  if (!fs.existsSync(ASSETS) || !fs.existsSync(INDEX_HTML)) {
    console.error("check-bundle-size: dist/ not found — run `npm run build` first.");
    process.exit(1);
  }

  // Existence used to be the ONLY precondition, so running this after
  // editing a source file reported a confident OK for the PREVIOUS build.
  // The rule now lives in one place — the two browser checks measure `dist/`
  // too and never had it; see `distFreshness.cjs` for the history.
  const stale = FRESH.staleSources(SRC, INDEX_HTML);
  if (stale.length) {
    console.error("check-bundle-size: " + FRESH.staleMessage(stale, REPO));
    process.exit(1);
  }

  const html = fs.readFileSync(INDEX_HTML, "utf8");
  // Eager = every /assets/*.js referenced by index.html (script src +
  // modulepreload). Parsing the HTML is robust to hash changes and to
  // Vite renaming chunks — we measure exactly what the browser fetches.
  const eagerNames = new Set();
  const re = /(?:src|href)\s*=\s*"[^"]*\/assets\/([^"]+\.js)"/g;
  let m;
  while ((m = re.exec(html)) !== null) eagerNames.add(m[1]);

  const errors = [];
  const rows = [];

  // NON-VACUITE, et elle manquait. `eagerNames` vient d'un regex sur le HTML
  // bati ; le jour ou Vite change la forme de ses chemins (un sous-dossier,
  // une base differente), le regex ne matche plus rien et la boucle ci-dessous
  // additionne ZERO. MESURE en cassant le motif : la porte imprime
  // « [ok ] eager scripts (home) 0.0 KB / 332.0 KB » puis
  // « check-bundle-size OK », et sort 0. Un budget respecte parce qu'on n'a
  // rien pese n'est pas un budget respecte.
  if (eagerNames.size === 0) {
    console.error("check-bundle-size FAILED: aucun script /assets/*.js reference par index.html —\n" +
      "  le motif de lecture ne correspond plus a la sortie du build, donc ce budget\n" +
      "  serait vert en n'ayant rien pese. Corriger le motif, pas le budget.");
    process.exit(1);
  }

  // Eager total
  let eagerTotal = 0;
  const manquants = [];
  for (const name of eagerNames) {
    const p = path.join(ASSETS, name);
    // UN FICHIER REFERENCE ET INTROUVABLE EST UNE ERREUR, pas une omission.
    // Le `continue` silencieux qui vivait ici retirait son poids du total :
    // l'omission rendait la porte PLUS FACILE a passer, et ne se voyait nulle
    // part. C'est en outre un defaut a part entiere — le navigateur, lui,
    // demandera ce fichier et recevra un 404.
    if (!fs.existsSync(p)) { manquants.push(name); continue; }
    eagerTotal += gz(p);
  }
  if (manquants.length) {
    console.error("check-bundle-size FAILED: index.html reference " + manquants.length +
      " script(s) absent(s) de dist/assets :\n  • " + manquants.join("\n  • ") +
      "\n  Leur poids manquerait au total ET le navigateur recevrait un 404.");
    process.exit(1);
  }
  rows.push([`eager scripts (home, ${eagerNames.size} fichier(s))`, eagerTotal, BUDGETS.eagerGzip]);
  if (eagerTotal > BUDGETS.eagerGzip)
    errors.push(`eager scripts ${kb(eagerTotal)} > budget ${kb(BUDGETS.eagerGzip)} — something heavy is loading on first paint (index.html eager set: ${[...eagerNames].join(", ")})`);

  // (the catalogue chunk checks used to live here — see the BUDGETS note.)

  // Report
  const w = Math.max(...rows.map((r) => r[0].length));
  for (const [label, size, budget] of rows) {
    const ok = size <= budget ? "ok " : "OVER";
    console.log(`  [${ok}] ${label.padEnd(w)}  ${kb(size).padStart(9)}  / ${kb(budget)}`);
  }

  if (errors.length) {
    console.error("\ncheck-bundle-size FAILED:\n  • " + errors.join("\n  • "));
    process.exit(1);
  }
  console.log("check-bundle-size OK — eager scripts within budget.");
}

main();
