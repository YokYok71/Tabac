// `public/reset.html` must never make the breakage worse.
//
// It is the far end of index.html's « Rien ne se passe ? Réparer
// l'application » link, so it is reached when a load has ALREADY failed — and
// the commonest reason for that is the network, not a corrupt cache. Until
// this guard it unregistered every service worker and deleted every cache
// unconditionally, then reloaded: on a bad connection that destroys the
// offline copy which was the user's only remaining way in. Reported from the
// installed iOS PWA, where tapping it changed nothing for the better.
//
// WHY THIS TEST EXISTS AT ALL: this file is outside doc:check's source tree
// and had no coverage of any kind, which is how it also came to be missing a
// Portuguese row and to be writing an unvalidated `lang` attribute. It is the
// page a user reaches when everything else is broken; it deserves the same
// treatment as the code that sends them here.
//
// The script is EXECUTED rather than pattern-matched. A source assertion would
// pass on a guard that exists and is never reached — the wiring is the thing
// that rots.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LANGUAGES } from "../i18n/languages.ts";

const HTML = readFileSync(resolve(__dirname, "../../public/reset.html"), "utf8");
const SCRIPT = (() => {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  if (!m || !m[1]) throw new Error("reset.html: no inline script found");
  return m[1];
})();
const BODY = (() => {
  const m = HTML.match(/<body>([\s\S]*?)<script>/);
  if (!m || !m[1]) throw new Error("reset.html: no body markup found");
  return m[1];
})();

type Probe = { ok: boolean; body: string } | "throw";

/** Drive the REAL page against a stubbed world. Returns what it did. */
async function run(opts: { online?: boolean; probe?: Probe; lang?: string }) {
  const deleted: string[] = [];
  const unregistered: string[] = [];
  document.body.innerHTML = BODY;
  document.documentElement.lang = "";

  try { localStorage.setItem("cave-lang", opts.lang ?? "fr"); } catch { /* ignore */ }

  Object.defineProperty(navigator, "onLine", {
    value: opts.online !== false, configurable: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      getRegistrations: async () => [
        { unregister: async () => { unregistered.push("sw"); return true; } },
      ],
    },
    configurable: true,
  });
  (globalThis as any).caches = {
    keys: async () => ["cave-tabac-v1-0-1"],
    delete: async (k: string) => { deleted.push(k); return true; },
  };

  const fetchMock = vi.fn(async () => {
    const p = opts.probe ?? { ok: true, body: '<div id="root"></div>' };
    if (p === "throw") throw new TypeError("Failed to fetch");
    return { ok: p.ok, text: async () => p.body } as any;
  });
  (globalThis as any).fetch = fetchMock;

  // INDIRECT eval, so the script runs in global scope exactly as it does in
  // the browser — `var L` becomes a global, which is what lets the
  // language-table case below read the page's own evaluated data rather than
  // re-parsing its source.
  (0, eval)(SCRIPT);
  // The chain is probe → decide → purge; a handful of microtask turns covers
  // it. The 1.5 s redirect timer is deliberately never advanced (jsdom cannot
  // navigate, and the redirect is not what these cases are about).
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 12; i++) await Promise.resolve();

  return {
    deleted, unregistered, fetchMock,
    msg: document.getElementById("msg")?.textContent || "",
    actions: Array.from(document.getElementById("act")?.children || [])
      .map((el) => ({ tag: el.tagName, text: el.textContent || "" })),
  };
}

describe("reset.html refuses to purge when the app cannot be re-fetched", () => {
  beforeEach(() => { vi.useRealTimers(); });
  afterEach(() => {
    delete (globalThis as any).caches;
    delete (globalThis as any).fetch;
    try { localStorage.removeItem("cave-lang"); } catch { /* ignore */ }
  });

  it("deletes NOTHING when the device is offline", async () => {
    const r = await run({ online: false });
    expect(r.deleted, "an offline purge leaves the user with no way in at all").toEqual([]);
    expect(r.unregistered).toEqual([]);
    // …and it does not even ask: `navigator.onLine === false` is the one
    // cheap, reliable half of the question.
    expect(r.fetchMock).not.toHaveBeenCalled();
  });

  it("deletes NOTHING when the probe cannot reach the server", async () => {
    const r = await run({ probe: "throw" });
    expect(r.deleted).toEqual([]);
    expect(r.unregistered).toEqual([]);
  });

  it("deletes NOTHING on a server error", async () => {
    const r = await run({ probe: { ok: false, body: "" } });
    expect(r.deleted).toEqual([]);
  });

  it("deletes NOTHING behind a captive portal", async () => {
    // `navigator.onLine` is true, the fetch succeeds, the status is 200 — and
    // the body is the hotel's login page. This is exactly the case `res.ok`
    // alone would wave through, and the reason the probe reads the body.
    const r = await run({ probe: { ok: true, body: "<h1>Wi-Fi login</h1>" } });
    expect(r.deleted, "a 200 from something that is not our app is not reachability").toEqual([]);
  });

  it("offers a retry and a way back instead of a dead end", async () => {
    const r = await run({ online: false });
    expect(r.msg, "the refusal must say nothing was deleted").toBeTruthy();
    expect(r.actions.map((a) => a.tag)).toEqual(["BUTTON", "A"]);
    expect(r.actions[0]!.text, "a retry, since the network may come back").toBeTruthy();
    expect(r.actions[1]!.text, "and a way back to the app").toBeTruthy();
  });

  it("purges when the app IS reachable — the guard is not a blanket refusal", async () => {
    // The other direction, so the fix cannot degrade into "never repairs".
    const r = await run({});
    expect(r.deleted).toEqual(["cave-tabac-v1-0-1"]);
    expect(r.unregistered).toEqual(["sw"]);
  });

  it("probes past the service worker and past the cache", async () => {
    // `cache: 'no-store'` is load-bearing, not decoration: sw.js returns early
    // for such a request, so the probe reaches the network instead of being
    // answered by the very cache it is deciding whether to destroy. Without
    // it, a stale cached index.html would satisfy the probe while the network
    // was dead — the guard would pass exactly when it must refuse.
    const r = await run({});
    expect(r.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (r.fetchMock as any).mock.calls[0];
    expect(String(url), "cache-busted, so no intermediary can answer from a copy").toContain("_probe=");
    expect(init?.cache).toBe("no-store");
  });
});

describe("reset.html speaks every shipped language", () => {
  it("carries a complete row per registry code", async () => {
    // The Portuguese row was once missing here while it existed in LANGUAGES,
    // so a Portuguese reader got English on the one page you reach when
    // nothing works. doc:check's language-axis gate cannot see this file.
    //
    // Read from the EVALUATED table rather than from the source. The first
    // version counted quote characters and was simply wrong: the French and
    // Italian rows use double quotes precisely BECAUSE they contain
    // apostrophes, so it reported five and a half strings. Evaluating asks the
    // question directly and cannot be fooled by how a string is spelled.
    await run({ online: false });
    const L = (globalThis as any).L as Record<string, string[]>;
    expect(L, "expected the page's own L table after evaluation").toBeTruthy();
    LANGUAGES.forEach((l) => {
      const row = L[l.code];
      expect(row, `no row for « ${l.code} »`).toBeTruthy();
      // Six slots: three status lines plus the offline refusal, its retry and
      // its way back. A short row renders `undefined` on screen.
      expect(row!.length, `« ${l.code} » must carry 6 strings`).toBe(6);
      row!.forEach((s, i) => {
        expect(typeof s === "string" && s.trim().length > 0, `« ${l.code} »[${i}] is empty`).toBe(true);
      });
    });
    expect(Object.keys(L).length, "a row for a code the app does not ship").toBe(LANGUAGES.length);
  });

  it("validates the lang attribute against the table", async () => {
    // A corrupt `cave-lang` used to be written verbatim, so the document
    // announced `lang="constructor"` — not a BCP-47 tag — while rendering in
    // English. Same defect main.jsx was fixed for; this sibling page was
    // missed. Leaving the attribute alone keeps a valid one.
    await run({ lang: "constructor", online: false });
    expect(document.documentElement.lang).not.toBe("co");
    await run({ lang: "de", online: false });
    expect(document.documentElement.lang).toBe("de");
  });
});
