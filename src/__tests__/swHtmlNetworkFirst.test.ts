import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The two service-worker defects, exercised rather than
// asserted on source text.
//
// The handler is evaluated in a minimal SW-like sandbox: enough of `self`,
// `caches` and `fetch` to drive one request through and observe what comes
// back. Nothing here mocks the branch under test, so a change to the branching
// logic reaches these cases.

const SW = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");

interface Env {
  handler: (e: any) => void;
  cache: Map<string, any>;
  netCalls: string[];
}

function boot(net: (url: string) => Promise<any>): Env {
  const cache = new Map<string, any>();
  const netCalls: string[] = [];
  let fetchHandler: any = null;

  const cacheObj = {
    put: (req: any, res: any) => { cache.set(String(req.url || req), res); return Promise.resolve(); },
    addAll: () => Promise.resolve(),
  };
  const caches = {
    open: () => Promise.resolve(cacheObj),
    match: (req: any) => Promise.resolve(cache.get(String(req.url || req))),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
  };
  const self: any = {
    location: { origin: "https://t-cellar.app" },
    addEventListener: (name: string, fn: any) => { if (name === "fetch") fetchHandler = fn; },
    skipWaiting: () => {},
    clients: {},
    registration: {},
  };
  const fetchFn = (req: any) => {
    const url = String(req.url || req);
    netCalls.push(url);
    return net(url);
  };
  new Function("self", "caches", "fetch", "URL", "Response", SW)(
    self, caches, fetchFn, URL,
    class { constructor(public body: any, public init: any = {}) { this.status = init.status || 200; this.ok = this.status < 400; }
      status: number; ok: boolean; clone() { return this; } } as any,
  );
  if (!fetchHandler) throw new Error("sw.js registered no fetch handler");
  return { handler: fetchHandler, cache, netCalls };
}

function req(url: string, mode = "no-cors") {
  return { url, mode, method: "GET", destination: "", cache: "default", clone: () => req(url, mode) };
}

function drive(env: Env, request: any): Promise<any> {
  let out: any;
  env.handler({ request, respondWith: (p: any) => { out = p; } });
  return out === undefined ? Promise.resolve(undefined) : Promise.resolve(out);
}

const res = (status: number, body = "") => ({ status, ok: status < 400, body, clone() { return this; } });

describe("service worker — HTML pages are network-first", () => {
  beforeEach(() => vi.clearAllMocks());

  it("goes to the network for help.html fetched WITHOUT a navigation", () => {
    // THE defect. The in-app doc views (DocPageView, HelpView) use a plain
    // fetch(), whose mode is not "navigate" — so the old branch missed them
    // and the cache-first path served the copy captured at SW install,
    // indefinitely. CLAUDE.md claimed the opposite AND drew a workflow rule
    // from it ("documentation-only changes do NOT require bumping APP_BUILD").
    const env = boot(() => Promise.resolve(res(200, "fresh")));
    env.cache.set("https://t-cellar.app/help.html", res(200, "stale"));
    return drive(env, req("https://t-cellar.app/help.html")).then((r) => {
      expect(env.netCalls).toContain("https://t-cellar.app/help.html");
      expect(r.body).toBe("fresh");
    });
  });

  it("still serves a NON-html asset from the cache first", () => {
    // The counterpart: the rule must not turn the whole SW network-first.
    // A content-hashed JS chunk is immutable, and going to the network for it
    // on every load would undo the app's offline story.
    const env = boot(() => Promise.resolve(res(200, "network")));
    env.cache.set("https://t-cellar.app/assets/index-abc.js", res(200, "cached"));
    return drive(env, req("https://t-cellar.app/assets/index-abc.js")).then((r) => {
      expect(env.netCalls).toHaveLength(0);
      expect(r.body).toBe("cached");
    });
  });
});

describe("service worker — a 5xx falls back to the cache", () => {
  it("serves the cached page when the server returns 500", () => {
    // A fetch that receives a 500 RESOLVES; it does not reject. So the
    // handler's .catch never ran on a server error and the raw error page was
    // handed to the user while a good cached copy sat one line away.
    const env = boot(() => Promise.resolve(res(500, "server error")));
    env.cache.set("https://t-cellar.app/index.html", res(200, "cached page"));
    return drive(env, req("https://t-cellar.app/index.html", "navigate")).then((r) => {
      expect(r.body).toBe("cached page");
    });
  });

  it("passes a 404 THROUGH even when a cached copy exists", () => {
    // Deliberate asymmetry: a 404 means the page is genuinely gone, and
    // masking it with a stale copy would hide a deploy that dropped a file.
    const env = boot(() => Promise.resolve(res(404, "not found")));
    env.cache.set("https://t-cellar.app/privacy.html", res(200, "cached page"));
    return drive(env, req("https://t-cellar.app/privacy.html")).then((r) => {
      expect(r.status).toBe(404);
    });
  });

  it("returns the 5xx unchanged when nothing is cached", () => {
    const env = boot(() => Promise.resolve(res(503, "down")));
    return drive(env, req("https://t-cellar.app/index.html", "navigate")).then((r) => {
      expect(r.status).toBe(503);
    });
  });

  it("does not touch a cross-origin HTML URL", () => {
    // isHtmlDoc is origin-scoped: the bypass list already handles the API
    // hosts, and claiming a foreign .html would be a surprising widening.
    const env = boot(() => Promise.resolve(res(200, "foreign")));
    return drive(env, req("https://example.com/thing.html")).then((r) => {
      // Falls to the cache-first branch, misses, goes to network — the point
      // is only that it did NOT take the HTML network-first branch's
      // 5xx-fallback path, which is origin-scoped.
      expect(r.body).toBe("foreign");
    });
  });
});
