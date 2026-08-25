"use strict";
/**
 * FAN OUT THE TWO BROWSER CHECKS ACROSS PROCESSES.
 *
 * WHY. Both checks render a matrix in ONE browser, screen after screen:
 * `i18n:layout` is 6 languages × 36 screens × 2 text sizes × 2 widths (864
 * renders, measured at ~55 min) and `theme:contrast` is 6 palettes × 36 screens
 * (~45 min). That cost is what makes them opt-in, and opt-in is what let `prune`
 * sit red for nine releases — a check nobody runs is documentation. Worse, it
 * distorts the work around them: validating a WIDENED checker means a full
 * campaign, so the honest move (measure it) competes with an hour of waiting.
 *
 * The axes are independent, so the matrix is embarrassingly parallel. Splitting
 * a real `theme:contrast` run six ways took it from ~45 min to ~10.
 *
 * WHAT THIS IS NOT. It does not parallelise a single shard — inside one process
 * the screens stay sequential, because they share one page whose seed and module
 * memory carry from screen to screen (the catalogue is read once per boot, the
 * cellar swap needs a reload). The unit of parallelism is a whole shard.
 *
 * THE SERVER IS THE PARENT'S. Each script used to spawn its own `vite preview`
 * with `--strictPort`, so six shards would mean five failures on a taken port.
 * The parent starts ONE and hands every shard the same port; `startPreview`
 * probes first and reuses whatever is already serving. That also makes the two
 * checks usable against a `npm run preview` you already have open.
 *
 * ONE SHARD PER AXIS VALUE, never a count. A shard is « this language » or
 * « this palette », which means a failure names a thing rather than an index,
 * and the sharding cannot drop or duplicate a combination the way a
 * round-robin over a flattened matrix can get wrong by one.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const RED = "\x1b[31m", GRN = "\x1b[32m", DIM = "\x1b[2m", OFF = "\x1b[0m";

/** Marks a process as a shard, so it runs the check instead of fanning out again. */
const SHARD_ENV = "TABAC_CHECK_SHARD";

/**
 * Start the preview server, or adopt one already serving at `url`.
 *
 * The probe is what lets N shards share a server: only the parent spawns, and a
 * shard finds it up. It also means a stale server from an earlier run is reused
 * rather than fatal — `--strictPort` would otherwise kill the run outright, and
 * the message ("preview server never came up") points at the wrong thing.
 */
async function startPreview(port, url) {
  try {
    if ((await fetch(url)).ok) return { stop: () => {}, adopted: true };
  } catch { /* nothing listening — start one */ }
  const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"],
    { cwd: ROOT, stdio: "ignore" });
  const stop = () => { try { server.kill(); } catch { /* already gone */ } };
  process.on("exit", stop);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { if ((await fetch(url)).ok) return { stop, adopted: false }; } catch { /* not yet */ }
  }
  stop();
  return { stop, failed: true };
}

/**
 * Split this run into one child per shard value, unless we ARE a shard.
 *
 * Returns false when the caller should just run normally (it is a shard, or the
 * user asked for a single job); otherwise runs every shard and never returns —
 * it exits with the worst child's code, so a red shard stays red.
 *
 * @param {object} o
 * @param {string} o.label        human name of the check, for the report
 * @param {string} o.script       the .cjs to re-spawn
 * @param {string} o.envVar       env var each child gets its shard value in
 * @param {string[]} o.shards     one value per child
 * @param {string} o.portVar      env var carrying the shared preview port
 * @param {number} o.port         that port
 * @param {string} o.url          the preview URL, for the readiness probe
 */
async function maybeFanOut(o) {
  if (process.env[SHARD_ENV]) return false;
  if (o.shards.length < 2) return false;

  console.log(`${DIM}  ${o.label}: ${o.shards.length} shards in parallel${OFF}`);
  const pre = await startPreview(o.port, o.url);
  if (pre.failed) {
    console.error(`${RED}${o.label} — preview server never came up on ${o.url}${OFF}`);
    process.exit(1);
  }

  const results = await Promise.all(o.shards.map((shard) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, o.script)], {
      cwd: ROOT,
      // The child inherits the parent's narrowing flags through argv? NO — it
      // does not, deliberately. A shard's axis comes through the env var alone,
      // so a `--langs pt` on the parent narrows `o.shards` here and the child is
      // told exactly one value. Passing argv through as well would give the
      // child two sources for the same axis and one of them would eventually win
      // by accident.
      env: Object.assign({}, process.env, {
        [SHARD_ENV]: "1", [o.envVar]: shard, [o.portVar]: String(o.port),
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { out += b; });
    child.on("close", (code) => {
      // One line per shard AS IT LANDS, so a long run is not silent — the full
      // reports are printed grouped below, because six interleaved reports are
      // unreadable.
      console.log(code === 0
        ? `${GRN}  ✓ ${shard}${OFF}`
        : `${RED}  ✗ ${shard}${OFF}`);
      resolve({ shard, code: code || 0, out });
    });
  })));

  pre.stop();
  for (const r of results) {
    if (!r.out.trim()) continue;
    console.log(`\n${DIM}── ${r.shard} ${"─".repeat(Math.max(0, 60 - r.shard.length))}${OFF}`);
    process.stdout.write(r.out.endsWith("\n") ? r.out : r.out + "\n");
  }
  const bad = results.filter((r) => r.code !== 0);
  if (bad.length) {
    console.error(`\n${RED}${o.label} FAILED — ${bad.length}/${results.length} shard(s): ` +
      `${bad.map((b) => b.shard).join(", ")}${OFF}`);
    process.exit(1);
  }
  console.log(`\n${GRN}${o.label} OK${OFF} — ${results.length} shards, all green.`);
  process.exit(0);
}

module.exports = { maybeFanOut, startPreview, SHARD_ENV };
