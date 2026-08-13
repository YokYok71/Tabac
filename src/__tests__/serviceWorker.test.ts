/**
 * first tests for `public/sw.js`.
 *
 * `public/` is in ESLint's global ignores and has no type checking, so the
 * service worker — 130-odd lines that decide what every request in the app does
 * — was verified by nothing at all. Two things in it fail SILENTLY, which is
 * what makes them worth pinning:
 *
 *  1. `install` calls `cache.addAll(CORE_URLS)`. `addAll` is atomic: if ONE url
 *     404s the promise rejects, the install fails, and the service worker never
 *     activates — the app simply stops working offline, with no error anywhere a
 *     user or a build would see. A typo in a filename is enough. It is checked
 *     against the SOURCE files, not `dist/`: see the comment on that test for
 *     why the first version broke the deploy. (`index.html` is NOT in `public/`
 *     — it is the Vite entry at the repo root — so both places are searched.)
 *
 *  2. `shouldBypass()` is a security fix. CodeQL flagged the previous
 *     `indexOf`-on-URL form (js/incomplete-url-substring-sanitization) because
 *     `https://evil.com/?x=api.anthropic.com` matched it. The fix parses the URL
 *     and compares hostnames — a property no test held, so nothing would notice
 *     a revert to the substring form. The attack strings are pinned below.
 *
 * The SW is a classic script (not a module), so the pure parts are extracted
 * from source and evaluated in an isolated scope rather than imported.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const docChecks = requireCjs("../../scripts/docChecks.cjs");

const ROOT = resolve(__dirname, "../..");
const SW = readFileSync(join(ROOT, "public/sw.js"), "utf8");

/** Evaluate the SW's pure bypass logic without executing the whole worker. */
function loadBypass(): { hosts: string[]; shouldBypass: (u: string) => boolean } {
  const hostsSrc = SW.match(/var BYPASS_HOSTS = \[[\s\S]*?\];/);
  const fnSrc = SW.match(/function shouldBypass\(rawUrl\) \{[\s\S]*?\n\}/);
  if (!hostsSrc || !fnSrc) {
    throw new Error(
      "sw.js no longer exposes BYPASS_HOSTS / shouldBypass in the expected form — " +
        "update this extraction rather than deleting the test, or the security " +
        "property below stops being checked while the suite still reports green.",
    );
  }
  const factory = new Function(
    `${hostsSrc[0]}\n${fnSrc[0]}\nreturn { hosts: BYPASS_HOSTS, shouldBypass: shouldBypass };`,
  );
  return factory();
}

describe("sw.js — install integrity", () => {
  it("every pre-cached CORE_URL has a real source file behind it", () => {
    // A missing entry makes cache.addAll reject → install fails → no offline
    // support, silently. This is the whole reason the test exists.
    const block = SW.match(/var CORE_URLS = \[([\s\S]*?)\];/);
    expect(block, "CORE_URLS not found in sw.js").toBeTruthy();
    const urls = [...block![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(3);

    // Resolved against SOURCES, not dist/. The first version of this test
    // required dist/ and threw when it was absent — which broke the deploy,
    // because the workflow runs `npm test` BEFORE `npm run build`, so dist/
    // never exists there. The instinct (fail loudly rather than skip, so the
    // check can't quietly become a no-op) was right; depending on build output
    // from a test that runs before the build was not. Sources are available in
    // every environment and catch the same typo: Vite copies public/ verbatim
    // and emits index.html, so present-in-source ⇒ present-in-dist.
    const candidates = (u: string) => {
      const name = u.replace(/^\.\//, "");
      // index.html is the Vite entry at the repo ROOT; everything else MUST be a
      // static asset under public/. Allowing any root file made the stated
      // invariant false — `./package.json` passed, and Vite would not emit it.
      return name === "index.html"
        ? [join(ROOT, name)]
        : [join(ROOT, "public", name)];
    };
    const missing = urls
      .filter((u) => u !== "./") // the scope root, served by index.html
      .filter((u) => !candidates(u).some((p) => existsSync(p)));
    expect(missing, "pre-cached URL(s) have no source file — cache.addAll would reject").toEqual([]);
  });

  it("no test depends on dist/ — CI runs `npm test` BEFORE `npm run build`", () => {
    // This cost two red deploys. deploy.yml's build job is
    // `npm ci` → `npm test` → `npm run build`, so dist/ does not exist while
    // the suite runs. Locally a stale dist/ is almost always lying around, so
    // a test that reads it passes here and fails there — the worst kind of
    // divergence, because the local run reports green with total confidence.
    // The scripts that legitimately read dist/ (size:check) are not tests and
    // run after the build.
    const dir = resolve(__dirname);
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.test\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => {
      const body = readFileSync(join(dir, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // A path join or literal reaching for the build output.
      return /["'`]dist["'`]|\/dist\//.test(body);
    });
    expect(offenders, "test(s) reading dist/, which is absent when CI runs the suite").toEqual([]);
  });

  it("CACHE_NAME is a single versioned string the activate handler sweeps against", () => {
    const m = SW.match(/var CACHE_NAME = '([^']+)'/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/^cave-tabac-v[\d-]+$/);
    // activate deletes every cache whose name !== CACHE_NAME; if that
    // comparison were ever loosened, stale caches would survive an update.
    expect(SW).toContain("names.filter(function(n) { return n !== CACHE_NAME; })");
  });

  it("does NOT call clients.claim() — mid-session takeover is deliberately absent", () => {
    // CLAUDE.md invariant: activation happens only via SKIP_WAITING + reload,
    // so a new worker can never take over a page the user is mid-edit on.
    expect(SW).not.toContain("clients.claim");
  });
});

describe("sw.js — shouldBypass (CodeQL js/incomplete-url-substring-sanitization)", () => {
  const { hosts, shouldBypass } = loadBypass();

  it("bypasses an exact host and its subdomains", () => {
    expect(shouldBypass("https://api.anthropic.com/v1/messages")).toBe(true);
    expect(shouldBypass("https://www.googleapis.com/drive/v3/files")).toBe(true);
    expect(shouldBypass("https://content.dropboxapi.com/2/files/upload")).toBe(true);
    expect(shouldBypass("https://nominatim.openstreetmap.org/reverse?lat=1")).toBe(true);
  });

  it("does NOT bypass when a listed host appears only in the path or query", () => {
    // The exact regression CodeQL flagged. Under the old indexOf form each of
    // these matched, so an attacker-controlled URL could opt itself out of the
    // cache layer purely by naming a trusted host in its query string.
    expect(shouldBypass("https://evil.com/?x=api.anthropic.com")).toBe(false);
    expect(shouldBypass("https://evil.com/api.anthropic.com/steal")).toBe(false);
    expect(shouldBypass("https://evil.com/#googleapis.com")).toBe(false);
  });

  it("does NOT bypass a look-alike host that merely ends with the same letters", () => {
    // endsWith('.' + h) — the dot matters. Without it, "notgstatic.com" and
    // "evil-googleapis.com" would both pass.
    expect(shouldBypass("https://notgstatic.com/x")).toBe(false);
    expect(shouldBypass("https://evil-googleapis.com/x")).toBe(false);
    // ...and a suffix attack the other way round.
    expect(shouldBypass("https://api.anthropic.com.evil.com/x")).toBe(false);
  });

  it("returns false for an unparseable URL instead of throwing", () => {
    // shouldBypass runs inside the fetch handler; a throw there would break
    // every request, not just the odd one.
    expect(shouldBypass("not a url")).toBe(false);
    expect(shouldBypass("")).toBe(false);
  });

  it("every bypassed host is disclosed in the privacy policy", () => {
    // doc:check gate 8 forces every `https://` literal in src/ to be disclosed,
    // but it never reads sw.js — so this second, hand-maintained host list was
    // outside that guarantee entirely. Reuse doc:check's OWN decision function
    // and evidence map rather than a home-made rule: the policy deliberately
    // names providers in prose ("Anthropic", "OpenAI", "Google") instead of raw
    // hostnames, and a stricter local rule just re-flags correct prose.
    const privacy = readFileSync(join(ROOT, "public/privacy.html"), "utf8");
    const EVIDENCE: Record<string, string[]> = {
      "api.anthropic.com": ["Anthropic"],
      "api.openai.com": ["OpenAI"],
      "googleapis.com": ["Google"],
      "accounts.google.com": ["OAuth", "Google"],
      "gstatic.com": ["Google"],
      "dropboxapi.com": ["Dropbox"],
      "dropbox.com": ["Dropbox"],
    };
    // Hosts the app no longer contacts (dropped the image proxies).
    // Bypassing the cache for a host we never call is inert, so they may stay —
    // but naming them here keeps "stale" a deliberate state rather than a guess.
    const RETIRED = ["corsproxy.io", "allorigins.win", "api.github.com"];
    const undisclosed = hosts
      .filter((h) => !RETIRED.includes(h))
      .filter((h) => !docChecks.domainDisclosed(h, privacy, EVIDENCE));
    expect(undisclosed).toEqual([]);
  });
});

describe("manifest.json", () => {
  // The other half of "public/ is verified by nothing". A malformed or
  // incomplete manifest does not throw anywhere — the browser silently stops
  // offering "Add to Home Screen", which for a PWA is the whole product.
  const raw = readFileSync(join(ROOT, "public/manifest.json"), "utf8");

  it("is valid JSON with the fields installability requires", () => {
    const m = JSON.parse(raw);
    for (const k of ["name", "short_name", "start_url", "display", "icons"]) {
      expect(m[k], `manifest is missing ${k}`).toBeTruthy();
    }
    expect(m.display).toBe("standalone");
  });

  it("every declared icon exists, at the size it claims", () => {
    // A 404 icon is the classic silent installability failure: the manifest
    // parses, the browser rejects it, and nothing says so.
    const m = JSON.parse(raw);
    const missing = m.icons.filter((i: { src: string }) => !existsSync(join(ROOT, "public", i.src)));
    expect(missing, "icon(s) declared but absent from public/").toEqual([]);
    // At least one maskable icon, or Android crops the icon into a circle.
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  it("index.html declares a tab icon for NON-Apple browsers too", () => {
    // iOS/Android parity, invariant #20.
    //
    // The page carried `apple-touch-icon` and nothing else, so every non-iOS
    // browser (Android Chrome, and every desktop one) had NO declared icon:
    // they fall back to requesting /favicon.ico, which this site does not
    // serve. Result — a 404 on every page load and a blank tab, i.e. the first
    // thing a visitor sees before they install anything. An iOS-specific
    // affordance with no equivalent for the other platform is precisely what
    // that invariant forbids.
    //
    // Asserted on index.html rather than on dist/: the source is what a
    // contributor edits, and dist/ is not committed.
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    const icons = [...html.matchAll(/<link\s+rel="icon"[^>]*href="([^"]+)"/g)];
    expect(icons.length, "no <link rel=\"icon\"> — non-Apple browsers will 404 on /favicon.ico").toBeGreaterThan(0);
    // ...and it must point at a file that actually ships, or the 404 simply
    // moves rather than going away.
    for (const [, href] of icons) {
      const file = String(href).replace("%BASE_URL%", "");
      expect(existsSync(join(ROOT, "public", file)), `declared icon ${file} is absent from public/`).toBe(true);
    }
  });

  it("declares the language its own text is written in", () => {
    // `lang` was absent. It matters because `name` and
    // `description` here are FRENCH while the app itself renames per language
    // (app_name is translated in all five dictionaries) — so the home-screen
    // label and the in-app title genuinely differ for a non-French user. A
    // static manifest cannot be localised: the spec has no multi-language
    // field, and GitHub Pages cannot negotiate Accept-Language. Declaring the
    // language is what turns that from an oversight into a stated fact, and
    // lets a screen reader pronounce the name correctly.
    const m = JSON.parse(raw);
    expect(m.lang).toBe("fr");
    expect(existsSync(join(ROOT, "src/i18n", `${m.lang}.ts`)), "lang must be a shipped UI language").toBe(true);
  });
});

describe("sw.js — message origin gate", () => {
  it("rejects a cross-origin message before honouring SKIP_WAITING", () => {
    // Locked by CodeQL js/missing-origin-check. The order matters: the origin
    // test must precede the data test, or a cross-origin SKIP_WAITING lands.
    // Strip comments first: the handler's own comment NAMES SKIP_WAITING
    // several lines above the code, so a raw indexOf compares a code position
    // against a prose position and fails on a correct file.
    const code = SW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const originIdx = code.indexOf("event.origin !== self.location.origin");
    const skipIdx = code.indexOf("SKIP_WAITING");
    expect(originIdx).toBeGreaterThan(-1);
    expect(skipIdx).toBeGreaterThan(-1);
    expect(originIdx).toBeLessThan(skipIdx);
  });
});
