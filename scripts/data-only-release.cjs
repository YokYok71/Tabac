// The "data-only release" helper.
//
//   npm run release:data              silent
//   npm run release:data -- --visible bumps, but with the usual banner
//
// Bumps APP_BUILD in src/constants.ts by 1 and writes
// public/version.json with `data_only: true`. The running app then
// applies it SILENTLY at the next visibilitychange:hidden or pagehide,
// with no banner and no countdown (see the silent path in
// useAppUpdate.ts).
//
// WHAT IT IS FOR, restated because the original three examples have all
// expired and left the script looking purposeless:
//
//   • a catalogue refresh — GONE, the app ships no catalogue;
//   • a help.html update — the service worker serves HTML network-first,
//     so it reaches users with no build at all;
//   • a notice.json broadcast — fetched with a cache-bust on every mount,
//     likewise no build needed.
//
// The live case is a WORDING or TRANSLATION fix. Those DO need a build:
// the dictionaries are bundled into content-hashed chunks, so without a
// bump `version.json` never moves, `checkVersion` never fires, and nobody
// receives the corrected text — which is exactly why the bump gate covers
// `src/i18n/`. And they are precisely what should NOT interrupt anyone
// with a ten-second countdown.
//
// KEEP IT CALLED. Nothing invoked this script for a long stretch, and in
// that time a new required field (`generation`) was added to
// version.json and this writer was never taught to emit it — so it
// produced a file `doc:check` rejects, and no one found out. An uncalled
// script rots exactly this quietly; `dataOnlyRelease.test.ts` is the
// net.

const fs = require("fs");
const path = require("path");

function main(opts) {
  opts = opts || {};
  const silent = opts.silent !== false;
  // WHERE it writes is injected, like `applyCataloguePlan`'s `nowIso` and
  // `catalogueSave`'s `nowMs`. The default is the repo this script lives in, so
  // the CLI is unchanged — what this buys is a caller that must NOT touch the
  // tree being able to say so. `dataOnlyRelease.test.ts` is that caller: it used
  // to snapshot the real `src/constants.ts` and `public/version.json`, let the
  // script bump them, and restore afterwards, which holds only while the process
  // survives to the restore and is the only writer. Neither held — an
  // interrupted run left the repo bumped, and three worktrees running their own
  // suites clobbered each other's files (the test resolves its paths against
  // `process.cwd()`, this script against `__dirname`), leaving a real working
  // copy with a truncated constants.ts and an empty version.json.
  const root = opts.root ? String(opts.root) : path.join(__dirname, "..");
  const constantsPath = path.join(root, "src", "constants.ts");
  const versionPath = path.join(root, "public", "version.json");

  const constSrc = fs.readFileSync(constantsPath, "utf8");
  const m = constSrc.match(/APP_BUILD\s*=\s*"(\d+)"/);
  if (!m) {
    throw new Error("could not parse APP_BUILD from constants.ts");
  }
  const prevBuild = parseInt(m[1], 10);
  const nextBuild = String(prevBuild + 1);
  const constNext = constSrc.replace(
    /APP_BUILD\s*=\s*"\d+"/,
    `APP_BUILD = "${nextBuild}"`,
  );
  fs.writeFileSync(constantsPath, constNext);

  const vm = constSrc.match(/APP_VERSION\s*=\s*"([^"]+)"/);
  if (!vm) {
    // Was a hardcoded "1.2" fallback, which would have written a version
    // OLDER than the running app into version.json — `isRemoteNewer`
    // refuses a downgrade, so the release would simply never be offered.
    // A parse failure must stop the release, not invent one.
    throw new Error("could not parse APP_VERSION from constants.ts");
  }
  const appVersion = vm[1];

  // The epoch. `isRemoteNewer` compares it BEFORE version and build, and
  // doc:check pins version.json's copy to APP_GENERATION — a release
  // written without it fails that gate.
  const gm = constSrc.match(/APP_GENERATION\s*=\s*(\d+)/);
  if (!gm) {
    throw new Error("could not parse APP_GENERATION from constants.ts");
  }
  const generation = parseInt(gm[1], 10);

  const payload = silent
    ? { version: appVersion, build: nextBuild, generation: generation, data_only: true }
    : { version: appVersion, build: nextBuild, generation: generation };
  fs.writeFileSync(versionPath, JSON.stringify(payload) + "\n");
  return { prevBuild, nextBuild, silent };
}

// CLI entry point; `main` is exported so a caller can reuse the logic
// without spawning a child process, and so the test can drive it.
if (require.main === module) {
  const argv = process.argv.slice(2);
  const silent = !argv.includes("--visible");
  const res = main({ silent: silent });
  console.log(`→ APP_BUILD ${res.prevBuild} → ${res.nextBuild}`);
  console.log(`→ wrote public/version.json` + (silent ? " with data_only=true" : " (visible release)"));
}

module.exports = { bumpDataOnly: main };
