"use strict";
/**
 * IS `dist/` THE CODE WE ARE ABOUT TO JUDGE?
 *
 * Three checks measure the BUILT app — `size:check`, `i18n:layout` and
 * `theme:contrast` — and all three used existence as their only precondition,
 * so running one after editing a source file reported a confident verdict on
 * the PREVIOUS bundle. `size:check` learned that the expensive way (a heavy
 * import got a green local check and met the regression post-merge, in
 * Lighthouse) and grew this rule; the two browser checks never got it.
 *
 * IT IS NOT HYPOTHETICAL, and the demonstration was on me: two full
 * `theme:contrast` campaigns measured a bundle an hour out of date, which is
 * how a stable 2566-element count became 2565 across a rebuild with no source
 * change in between. Both were green, so nothing announced that the subject had
 * moved — which is the whole failure mode: a check reporting on the wrong
 * artefact looks exactly like a check reporting on the right one.
 *
 * Extracted rather than copied a third time. CI is unaffected either way (the
 * workflows always build first); this is for humans following the checklist.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Source files newer than the build, or [] when the build is current.
 *
 * A FILESYSTEM failure is tolerated (returns []), but a ReferenceError or
 * TypeError is rethrown — that means the guard ITSELF is broken, and a guard
 * that silently no-ops reads as « verified » while verifying nothing. It did
 * exactly that on its first run: an undefined root threw, the catch swallowed
 * it, and the check reported OK on a stale bundle.
 */
function staleSources(srcDir, indexHtml) {
  try {
    const builtAt = fs.statSync(indexHtml).mtimeMs;
    const stale = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        // Tests never enter the bundle, so they cannot make it stale.
        if (e.isDirectory()) { if (e.name !== "__tests__") walk(full); continue; }
        if (fs.statSync(full).mtimeMs > builtAt) stale.push(full);
      }
    };
    walk(srcDir);
    return stale;
  } catch (e) {
    if (e instanceof ReferenceError || e instanceof TypeError) throw e;
    return [];
  }
}

/**
 * The message every caller shows, so the remedy is worded once.
 *
 * It carries NO check name: two of the three callers funnel through a `die()`
 * that already prefixes one, and a helper that adds its own printed
 * « theme:contrast — theme:contrast: … ». The caller owns its own identity.
 */
function staleMessage(stale, repoRoot) {
  return [
    `dist/ is STALE — ${stale.length} file(s) under src/ are newer than the build.`,
    `  e.g. ${stale.slice(0, 3).map((f) => path.relative(repoRoot, f)).join(", ")}`,
    "  Run `npm run build` first, or this measures the previous bundle.",
  ].join("\n");
}

module.exports = { staleSources, staleMessage };
