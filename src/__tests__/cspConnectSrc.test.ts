// CSP connect-src tripwire.
//
// Goal: prevent shipping a new network endpoint (fetch / XHR / proxy)
// whose host isn't whitelisted in the index.html
// `Content-Security-Policy` `connect-src` directive. A fetch to an
// un-whitelisted host is silently blocked by the browser at runtime —
// this test turns that into a build-time failure instead.
//
// Mechanism: scan every production source file (src/, excluding tests)
// for literal `https://<host>` URLs, then assert each host is either
//   (a) present in the CSP connect-src directive, OR
//   (b) on the documented ALLOWLIST below — hosts that legitimately
//       appear as a URL literal WITHOUT being a fetch target (a
//       script-src CDN, an anchor href, a window.open link, a doc
//       URL in a comment, an example in a prompt/SSRF docstring).
//
// When this test fails, the offending host is NEW. Decide:
//   - it IS a fetch/connect target → add it to connect-src in
//     index.html (and document why in CLAUDE.md Security section);
//   - it is NOT a fetch (link / comment / example) → add it to
//     ALLOWLIST here with a one-line justification.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");

/** Hosts that appear as https:// literals in src/ but are NOT fetch
 *  targets, so they don't need a connect-src entry. Keep each line
 *  justified — an unexplained entry defeats the tripwire. */
const ALLOWLIST = new Set<string>([
  "cdnjs.cloudflare.com",   // JSZip CDN — loaded via <script> (script-src), SRI-pinned, not fetched
  "www.google.com",         // image-search window.open(...) link, not a fetch
  "t-cellar.app",           // the app's own public site — help-page anchor href
  "developers.google.com",  // Google Identity docs URL inside a code comment
  "example.com",            // placeholder host in comments / SSRF-guard docstrings / AI-prompt examples
  "cdn.example.com",        // placeholder host in comments / examples
  "evil.example.com",       // negative-example host in SSRF-guard docstrings
  "www.dropbox.com",        // OAuth authorize page — full-page NAVIGATION (location.assign), never fetched, so connect-src doesn't apply
  "www.openstreetmap.org",  // session-location map — loaded inside an <iframe>, governed by frame-src (not connect-src)
]);

function readConnectSrcHosts(): Set<string> {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const m = html.match(/connect-src([^;]*)/);
  if (!m) throw new Error("CSP connect-src directive not found in index.html");
  const hosts = new Set<string>();
  const re = /https:\/\/([a-z0-9.-]+)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(m[1]!)) !== null) hosts.add(hit[1]!);
  return hosts;
}

function walkSrc(dir: string, acc: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__") continue; // tests carry mock/placeholder URLs
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkSrc(full, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

function collectHttpsHosts(files: string[]): Map<string, string> {
  // host -> first file where it appears (for a helpful failure message)
  const found = new Map<string, string>();
  const re = /https:\/\/([a-z0-9.-]+)/g;
  for (const f of files) {
    const txt = readFileSync(f, "utf8");
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(txt)) !== null) {
      const host = hit[1]!;
      if (!found.has(host)) found.set(host, f.replace(ROOT + "/", ""));
    }
  }
  return found;
}

describe("CSP connect-src tripwire", () => {
  it("every https host literal in src/ is whitelisted in connect-src or the documented ALLOWLIST", () => {
    const connectSrc = readConnectSrcHosts();
    const files = walkSrc(join(ROOT, "src"), []);
    const hosts = collectHttpsHosts(files);

    const offenders: string[] = [];
    for (const [host, file] of hosts) {
      if (connectSrc.has(host)) continue;
      if (ALLOWLIST.has(host)) continue;
      offenders.push(`${host}  (first seen in ${file})`);
    }

    expect(
      offenders,
      "New https host(s) found in src/ that are neither in the CSP "
        + "connect-src nor the test ALLOWLIST. If it's a fetch target, add "
        + "it to connect-src in index.html; otherwise add it to ALLOWLIST "
        + "with a justification:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("connect-src still covers the known provider endpoints (canary)", () => {
    const connectSrc = readConnectSrcHosts();
    // The hosts our code actively fetches/connects to. Removing any of
    // these from index.html's connect-src would silently break the
    // corresponding feature at runtime.
    for (const host of [
      "api.anthropic.com",
      "api.openai.com",
      "generativelanguage.googleapis.com",
      "www.googleapis.com",
      "accounts.google.com",
      "oauth2.googleapis.com",
    ]) {
      expect(connectSrc.has(host), `connect-src must include ${host}`).toBe(true);
    }
  });
});
