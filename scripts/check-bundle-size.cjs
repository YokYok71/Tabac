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
  // editing a source file reported a confident OK for the PREVIOUS build — a
  // developer following the local checklist after adding a heavy import got a
  // green size:check and met the regression only post-merge, in Lighthouse.
  // CI is unaffected (lighthouse.yml always builds first); this is for humans.
  try {
    const builtAt = fs.statSync(INDEX_HTML).mtimeMs;
    const stale = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        // Tests never enter the bundle, so they cannot make it stale.
        if (e.isDirectory()) { if (e.name !== "__tests__") walk(full); continue; }
        if (fs.statSync(full).mtimeMs > builtAt) stale.push(full);
      }
    };
    walk(SRC);
    if (stale.length) {
      console.error(`check-bundle-size: dist/ is STALE — ${stale.length} file(s) under src/ are newer than the build.`);
      console.error(`  e.g. ${stale.slice(0, 3).map((f) => path.relative(REPO, f)).join(", ")}`);
      console.error("  Run `npm run build` first, or this measures the previous bundle.");
      process.exit(1);
    }
  } catch (e) {
    // Only a real filesystem failure may be tolerated. A ReferenceError/TypeError
    // here means the guard itself is broken — and a guard that silently no-ops
    // reads as "verified" while verifying nothing (it did exactly that on its
    // first run: an undefined ROOT threw, this catch swallowed it, and the check
    // reported OK on a stale bundle).
    if (e instanceof ReferenceError || e instanceof TypeError) throw e;
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

  // Eager total
  let eagerTotal = 0;
  for (const name of eagerNames) {
    const p = path.join(ASSETS, name);
    if (!fs.existsSync(p)) continue;
    eagerTotal += gz(p);
  }
  rows.push(["eager scripts (home)", eagerTotal, BUDGETS.eagerGzip]);
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
