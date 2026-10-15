import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shellUrls, primeOfflineShell } from "../utils/offlineShell";

// The page after an install — every update, since doUpdate() purges every
// cache and reloads — is not controlled by the worker, so the files it loads
// are never cached and the next OFFLINE launch stopped on « Chargement… ».
// Reproduced in Chromium; these lock the page half of the fix (the worker half
// is in serviceWorker.test.ts).

const O = "https://t-cellar.app";

describe("shellUrls — what the page hands the worker", () => {
  it("keeps the same-origin scripts, styles and fonts the page loaded", () => {
    expect(shellUrls([
      O + "/assets/index-AbCd1234.js",
      O + "/assets/fr-Zz99Yy88.js",
      O + "/assets/index-Qq11Ww22.css",
      O + "/fonts/inter.woff2",
    ], O)).toEqual([
      O + "/assets/index-AbCd1234.js",
      O + "/assets/fr-Zz99Yy88.js",
      O + "/assets/index-Qq11Ww22.css",
      O + "/fonts/inter.woff2",
    ]);
  });

  it("leaves out other origins — the AI and cloud APIs are never cached", () => {
    expect(shellUrls(["https://api.anthropic.com/v1/messages", "https://www.googleapis.com/drive/v3/files"], O)).toEqual([]);
  });

  it("leaves out a query string — `?_v=` is the uncached version probe", () => {
    expect(shellUrls([O + "/version.json?_v=123", O + "/assets/a.js?x=1"], O)).toEqual([]);
  });

  it("leaves out HTML pages, which stay network-first", () => {
    expect(shellUrls([O + "/", O + "/help.html", O + "/index.html"], O)).toEqual([]);
  });

  it("drops duplicates and garbage", () => {
    expect(shellUrls([O + "/assets/a.js", O + "/assets/a.js", "not a url"], O)).toEqual([O + "/assets/a.js"]);
  });
});

describe("primeOfflineShell — the call itself", () => {
  function fakeWin(entries: string[], active: { postMessage: (m: unknown) => void } | null) {
    return {
      location: { origin: O },
      performance: { getEntriesByType: () => entries.map((name) => ({ name })) },
      navigator: { serviceWorker: { ready: Promise.resolve({ active }) } },
    } as unknown as Window & typeof globalThis;
  }

  it("posts CACHE_URLS with the filtered list to the ACTIVE worker", async () => {
    const postMessage = vi.fn();
    primeOfflineShell(fakeWin([O + "/assets/a.js", "https://api.openai.com/x"], { postMessage }));
    await Promise.resolve(); await Promise.resolve();
    expect(postMessage).toHaveBeenCalledWith({ type: "CACHE_URLS", urls: [O + "/assets/a.js"] });
  });

  it("does nothing, and throws nothing, without a worker or without anything to keep", async () => {
    const postMessage = vi.fn();
    expect(() => primeOfflineShell({ navigator: {} } as unknown as Window & typeof globalThis)).not.toThrow();
    primeOfflineShell(fakeWin(["https://api.openai.com/x"], { postMessage }));
    primeOfflineShell(fakeWin([O + "/assets/a.js"], null));
    await Promise.resolve(); await Promise.resolve();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("is wired at boot, inside the service-worker block and so never in a frame", () => {
    const main = readFileSync(resolve(__dirname, "../main.jsx"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const block = main.slice(main.indexOf("if (!FRAMED && 'serviceWorker' in navigator)"));
    expect(block.indexOf("primeOfflineShell(window)")).toBeGreaterThan(-1);
    expect(block.indexOf("primeOfflineShell(window)")).toBeLessThan(block.indexOf("\n}"));
  });
});
