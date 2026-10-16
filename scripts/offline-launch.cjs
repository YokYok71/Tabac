"use strict";
/**
 * DOES THE APP STILL START WITHOUT A NETWORK?
 *
 * Build 57 fixed two ways an offline launch failed, both reported from the
 * iPhone (« sans connexion l'app ne s'est pas lancée ») and both reproduced in
 * Chromium before being fixed. This replays them against the BUILT app, so a
 * change to public/sw.js, src/utils/offlineShell.ts or the boot sequence that
 * brings either back fails the deploy instead of reaching a phone.
 *
 *   1. AFTER AN UPDATE. doUpdate() purges every cache and reloads; the page that
 *      follows is not controlled by the new worker, so nothing it loads passes
 *      through it. Unless the page hands its files to the worker (CACHE_URLS),
 *      the next offline launch stops on « Chargement… ».
 *   2. ON A SILENT NETWORK. A connection that is up but never answers — a weak
 *      signal, a Wi-Fi with no Internet behind it. Without a deadline on the
 *      HTML request the app waits for ever, with a good copy in the cache.
 *
 * WHY ITS OWN SERVER, and not `vite preview` plus Playwright's offline switch:
 * that switch does NOT reach the service worker — measured, 17 requests landed
 * on the server during an « offline » run — so a test built on it passes while
 * testing nothing. Here the server itself goes down (every connection dropped)
 * or silent (nothing ever answered). It also sends `Cache-Control: no-store`,
 * so the browser's own HTTP cache cannot quietly stand in for the worker's:
 * that is the state of a phone more than GitHub Pages' 10-minute max-age after
 * its last visit, and the one the first false green came from.
 *
 * EACH SCENARIO CHECKS THAT IT APPLIED before believing its own result: the
 * dropped server must have been asked (the launch did go to the network), and
 * the silent launch must have waited at least the worker's deadline (the
 * request really hung). A green that cannot show its simulation ran is a fail.
 *
 *   npm run build && npm run offline:check
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const FRESH = require("./distFreshness.cjs");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const INDEX = path.join(DIST, "index.html");
const PORT = Number(process.env.OFFLINE_CHECK_PORT || 4176);
const URL_ = `http://localhost:${PORT}/`;
const RED = "\x1b[31m", GRN = "\x1b[32m", DIM = "\x1b[2m", OFF = "\x1b[0m";

// The worker's own deadline, read from the file it lives in — a copy here
// would let the two drift, and the silent-network assertion depends on it.
function navTimeoutMs() {
  const src = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
  const m = src.match(/var NAV_TIMEOUT_MS = (\d+);/);
  if (!m) throw new Error("offline:check: NAV_TIMEOUT_MS not found in public/sw.js");
  return Number(m[1]);
}

function die(msg) { console.error(`${RED}offline:check — ${msg}${OFF}`); process.exit(1); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };

/** A static server for dist/ that can be told to drop or ignore every request. */
function startServer() {
  const state = { mode: "ok", hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits++;
    if (state.mode === "down") { req.socket.destroy(); return; }
    if (state.mode === "silent") return; // never answered
    const u = new URL(req.url, URL_);
    let p = path.join(DIST, decodeURIComponent(u.pathname));
    if (!p.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    if (u.pathname.endsWith("/")) p = path.join(p, "index.html");
    fs.readFile(p, (e, body) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(PORT, () => resolve({ state, close: () => { server.closeAllConnections?.(); server.close(); } }));
  });
}

function findChromium(chromium) {
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
  return exe;
}

// A page whose navigation hangs never finishes closing — measured: the first
// version of this check, faced with a hanging request, did not FAIL, it hung
// until the runner killed it. Every close is bounded.
function bounded(p, ms) { return Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, ms))]); }

/** Open the app; resolve how long it took to replace the boot shell, or null. */
async function launch(ctx, budgetMs, holdMs = 0) {
  const page = await ctx.newPage();
  const t0 = Date.now();
  page.goto(URL_, { timeout: budgetMs, waitUntil: "commit" }).catch(() => { /* judged by the DOM below */ });
  let took = null;
  while (Date.now() - t0 < budgetMs) {
    // Bounded too: while a navigation hangs, evaluate() can wait for an
    // execution context that never comes.
    const up = await bounded(page.evaluate(() => {
      const r = document.getElementById("root");
      return !!r && r.children.length > 0 && !r.querySelector('a[href$="reset.html"]');
    }), 1000);
    if (up) { took = Date.now() - t0; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (took !== null && holdMs) await page.waitForTimeout(holdMs);
  await bounded(page.close(), 3000);
  return took;
}

async function main() {
  // The last line of defence against the failure mode this check met first:
  // HANGING instead of failing, which in CI means waiting for the job's
  // ceiling and reading as a runner problem.
  setTimeout(() => die("watchdog: no verdict after 150 s — a scenario hung instead of failing"), 150000).unref();
  if (!fs.existsSync(INDEX)) die("dist/ not found — run `npm run build` first.");
  const stale = FRESH.staleSources(path.join(ROOT, "src"), INDEX);
  if (stale.length) die(FRESH.staleMessage(stale, ROOT));
  const NAV = navTimeoutMs();

  let chromium;
  try { ({ chromium } = require("playwright-core")); }
  catch { die("playwright-core not installed (deliberately not a dependency):\n  npm i --no-save playwright-core"); }
  const exe = findChromium(chromium);
  if (!exe) die("no Chromium found — set CHROME_PATH or run `npx playwright-core install chromium`.");

  const srv = await startServer().catch((e) => die(`cannot listen on ${PORT}: ${e.message}`));
  const browser = await chromium.launch({ executablePath: exe });
  const failures = [];
  const ok = (msg) => console.log(`${DIM}  ✓ ${msg}${OFF}`);
  try {
    // 1 — AFTER AN UPDATE. One visit whose page the new worker does not
    // control (a fresh context: exactly the page doUpdate() reloads into),
    // left open long enough to hand its files over, then no network at all.
    {
      const ctx = await browser.newContext();
      srv.state.mode = "ok";
      const first = await launch(ctx, 15000, 8000);
      if (first === null) failures.push("after an update: the app did not even start ONLINE — nothing below can be judged");
      else {
        srv.state.mode = "down"; const before = srv.state.hits;
        const off1 = await launch(ctx, 10000);
        const off2 = await launch(ctx, 10000);
        const asked = srv.state.hits - before;
        if (asked === 0) failures.push("after an update: the dropped server was never asked — the offline simulation did not apply");
        if (off1 === null) failures.push("after an update: the first offline launch did not start (stuck on the boot shell) — the page's files were not kept (CACHE_URLS / primeOfflineShell)");
        else if (off2 === null) failures.push("after an update: the SECOND offline launch did not start");
        else ok(`after an update, offline: started in ${off1} ms, then ${off2} ms (${asked} request(s) dropped by the server)`);
      }
      srv.state.mode = "ok"; await bounded(ctx.close(), 5000);
    }
    // 2 — ON A SILENT NETWORK. Two visits (the second controlled), then a
    // network that takes every request and answers none.
    {
      const ctx = await browser.newContext();
      srv.state.mode = "ok";
      const a = await launch(ctx, 15000, 1500);
      const b = a === null ? null : await launch(ctx, 15000, 1500);
      if (b === null) failures.push("silent network: the app did not start ONLINE — nothing below can be judged");
      else {
        srv.state.mode = "silent"; const before = srv.state.hits;
        const took = await launch(ctx, NAV + 8000);
        const asked = srv.state.hits - before;
        if (asked === 0) failures.push("silent network: the server was never asked — the simulation did not apply");
        if (took === null) failures.push(`silent network: not started within ${NAV + 8000} ms — the HTML request has no deadline (NAV_TIMEOUT_MS / withDeadline)`);
        else if (took < NAV - 500) failures.push(`silent network: started in ${took} ms, before the ${NAV} ms deadline — the request did not really hang, so this proves nothing`);
        else ok(`silent network: started in ${took} ms (deadline ${NAV} ms)`);
      }
      srv.state.mode = "ok"; await bounded(ctx.close(), 5000);
    }
  } finally {
    await bounded(browser.close(), 5000);
    srv.close();
  }
  if (failures.length) {
    console.error(`\n${RED}offline:check FAILED${OFF}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`\n${GRN}offline:check OK${OFF} — the app starts offline after an update, and on a network that never answers.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
