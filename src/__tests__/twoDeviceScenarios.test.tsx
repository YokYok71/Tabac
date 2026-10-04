// TWO DEVICES, ONE DROPBOX — scenario simulation on the REAL app.
//
// Each device is the real <App /> (CuratorApp replaced by a probe that hands
// us the context, the pattern of saveRevisionGate.test.tsx), mounted with ITS
// OWN storage: jsdom has one localStorage, so a device's storage lives in a
// Map while it is closed and is swapped in when it launches. Only one device
// is mounted at a time; closing and launching again is an app relaunch, which
// is what the launch check (4.5 s), the auto-save (1.2 s after save()) and the
// resume check (visibilitychange) are built around.
//
// The cloud is a fake Dropbox app folder behind the fetch mock: list_folder,
// upload (mode add + autorename, as dropboxProvider sends), download and
// delete_v2, with server_modified taken from the fake clock. Nothing of the
// sync logic is re-implemented here: save(), the quiet save, the guard, the
// banner, the picker (driven through ctx.applyImport) and the reload a
// settings-carrying REPLACE performs are all the shipped code.
//
// Scenarios that currently FAIL are written as `it.fails`, each with the
// observed behaviour in a comment, so the file stays green while they stand
// and turns red the day one is fixed (the marker must then be removed).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

vi.mock("../utils/imgCache.ts", async () => {
  const real: any = await vi.importActual("../utils/imgCache.ts");
  return {
    ...real,
    imgCache: {
      open: () => Promise.resolve(null),
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(true),
      clear: () => Promise.resolve(),
    },
    gcOrphans: () => Promise.resolve(0),
  };
});

let CTX: any = null;
vi.mock("../CuratorApp.tsx", async () => {
  const R: any = await vi.importActual("react");
  const { useAppCtx }: any = await vi.importActual("../AppContext");
  function Probe() {
    CTX = useAppCtx();
    return R.createElement("div", null, "probe");
  }
  return { CuratorApp: Probe, default: Probe };
});

import App from "../App";
import { SK } from "../constants";
import { backupRev } from "../utils/gdriveApi";
import { stableStringify } from "../utils";

// ── the fake Dropbox ────────────────────────────────────────────────────────

type CloudFile = { id: string; name: string; content: string; server_modified: string };
let cloud: Map<string, CloudFile>;
let fileSeq = 0;
// A gate that holds the NEXT upload(s) until released (scenario 7).
// `dropResponse`: the server commits the file when released, but the page
// that sent it never hears back (it reloaded meanwhile).
// One-shot: only the first upload that reaches an armed gate is held.
let uploadGate: { promise: Promise<void>; release: () => void; dropResponse?: boolean; used?: boolean } | null = null;
let offline = false;
function holdUploads(dropResponse = false) {
  let release!: () => void;
  const promise = new Promise<void>((r) => { release = r; });
  uploadGate = { promise, release, dropResponse };
  return uploadGate;
}
let fetchLog: string[] = [];

function isoNow(): string {
  return new Date(Date.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function wire(status: number, body: any) {
  const txt = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(txt),
    json: () => Promise.resolve(typeof body === "string" ? JSON.parse(body || "null") : body),
  };
}
async function bodyText(b: any): Promise<string> {
  if (b == null) return "";
  if (typeof b === "string") return b;
  if (typeof b.text === "function") return b.text();
  return await new Promise<string>((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.readAsText(b);
  });
}
async function fakeFetch(url: any, init: any = {}) {
  const u = String(url);
  if (offline && u.includes("dropbox")) throw new TypeError("Failed to fetch");
  const headers = (init && init.headers) || {};
  const arg = headers["Dropbox-API-Arg"] ? JSON.parse(headers["Dropbox-API-Arg"]) : null;
  if (u.includes("/2/files/list_folder")) {
    fetchLog.push("list");
    const entries = [...cloud.values()].map((f) => ({
      ".tag": "file", id: f.id, name: f.name, size: f.content.length,
      client_modified: f.server_modified, server_modified: f.server_modified,
    }));
    return wire(200, { entries, has_more: false });
  }
  if (u.includes("/2/files/upload")) {
    const content = await bodyText(init.body);
    const gate = uploadGate && !uploadGate.used ? uploadGate : null;
    if (gate) { gate.used = true; await gate.promise; }
    let name = String(arg.path).replace(/^\//, "");
    if ([...cloud.values()].some((f) => f.name === name)) {
      let n = 1;
      const base = name.replace(/\.json$/, "");
      while ([...cloud.values()].some((f) => f.name === base + " (" + n + ").json")) n++;
      name = base + " (" + n + ").json";
    }
    const id = "id:" + (++fileSeq);
    cloud.set(id, { id, name, content, server_modified: isoNow() });
    fetchLog.push("upload " + name);
    if (gate && gate.dropResponse) return new Promise(() => {});
    return wire(200, { id, name, ".tag": "file" });
  }
  if (u.includes("/2/files/download")) {
    const f = cloud.get(arg.path);
    fetchLog.push("download " + (f ? f.name : arg.path));
    if (!f) return wire(409, { error_summary: "path/not_found/" });
    return wire(200, f.content);
  }
  if (u.includes("/2/files/delete_v2")) {
    const body = JSON.parse(await bodyText(init.body));
    const f = cloud.get(body.path);
    fetchLog.push("delete " + (f ? f.name : body.path));
    if (!f) return wire(409, { error_summary: "path_lookup/not_found/" });
    cloud.delete(body.path);
    return wire(200, { metadata: { name: f.name } });
  }
  if (u.includes("oauth2/token")) {
    return wire(200, { access_token: "tok", expires_in: 14400, token_type: "bearer" });
  }
  return wire(404, "");
}

// ── devices ─────────────────────────────────────────────────────────────────

type Device = { name: string; ls: Map<string, string>; ss: Map<string, string> };
let mounted: { dev: Device; unmount: () => void } | null = null;
let reloadSpy: ReturnType<typeof vi.fn>;

const BASE_CELLAR = {
  tobaccos: [
    {
      id: 1, uid: "tob-duskfall", brand: "Halvorsen", name: "Duskfall",
      lots: [{ id: "lot-1", uid: "lotu-1", status: "cellar", weightG: 100, weightInitial: 100, originalStatus: "cellar" }],
    },
  ],
  pipes: [{ id: 1, uid: "pipe-1", brand: "Brackwater", name: "Billiard" }],
  accessories: [], sessions: [], wishlist: [],
  nxT: 2, nxP: 2, nxA: 1, nxJ: 1, nxW: 1,
};

function newDevice(name: string, id: string, cellar: any | null): Device {
  const ls = new Map<string, string>();
  ls.set("cave-terms-accepted", "1");
  ls.set("cave-curator-welcomed", "1");
  ls.set("cave-last-export-ts", String(Date.now()));
  ls.set("cave-device-id", id);
  ls.set("cave-device-name", name);
  ls.set("cave-cloud-provider", "dropbox");
  ls.set("cave-autosave", "1");
  ls.set("dropbox-rt", "rt-" + id);
  ls.set("dropbox-tk", JSON.stringify({ t: "tok-" + id, x: Date.now() + 365 * 86400000 }));
  if (cellar) ls.set(SK, JSON.stringify(cellar));
  return { name, ls, ss: new Map() };
}

function swapIn(dev: Device) {
  localStorage.clear();
  sessionStorage.clear();
  dev.ls.forEach((v, k) => localStorage.setItem(k, v));
  dev.ss.forEach((v, k) => sessionStorage.setItem(k, v));
}
function swapOut(dev: Device) {
  dev.ls = new Map();
  dev.ss = new Map();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    dev.ls.set(k, localStorage.getItem(k)!);
  }
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i)!;
    dev.ss.set(k, sessionStorage.getItem(k)!);
  }
  localStorage.clear();
  sessionStorage.clear();
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Launch the app on `dev` and let the launch work run: the pending auto-save
 *  (1.2 s), the launch check (4.5 s), and anything they chain. */
async function launch(dev: Device, settleMs = 8000) {
  if (mounted) throw new Error("another device is open");
  swapIn(dev);
  CTX = null;
  let r: any;
  await act(async () => { r = render(<App />); });
  mounted = { dev, unmount: () => r.unmount() };
  await advance(settleMs);
  await reloadIfAsked();
}
/** Let everything in flight finish, then close the app and put the device's
 *  storage away. */
async function close() {
  if (!mounted) return;
  await advance(20000);
  await reloadIfAsked();
  const m = mounted;
  await act(async () => { m.unmount(); });
  mounted = null;
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  swapOut(m.dev);
}
/** A REPLACE that carried preferences reloads the page (useImportConfirm).
 *  Modelled as unmount + remount on the same storage. */
async function reloadIfAsked() {
  while (reloadSpy.mock.calls.length) {
    reloadSpy.mockClear();
    await remount();
    await advance(8000);
  }
}
/** The page reloads: same storage (a reload keeps localStorage), a fresh app. */
async function remount() {
  const m = mounted!;
  await act(async () => { m.unmount(); });
  mounted = null;
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  CTX = null;
  let r: any;
  await act(async () => { r = render(<App />); });
  mounted = { dev: m.dev, unmount: () => r.unmount() };
}
/** Leave the app in the background for `ms`, then bring it back (resume). */
async function resume(ms = 3 * 60 * 1000) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await advance(ms);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await advance(8000);
}
/** Time passing while no app is open. */
function wait(ms: number) { vi.setSystemTime(Date.now() + ms); }

function stored(): any { return JSON.parse(localStorage.getItem(SK) || "null"); }
function storedOf(dev: Device): any { return JSON.parse(dev.ls.get(SK) || "null"); }
function tobNames(d: any): string[] {
  return ((d && d.tobaccos) || []).filter((t: any) => !t.deletedAt).map((t: any) => t.name).sort();
}

/** A genuine edit through the real save(): add a tobacco. */
async function addTobacco(name: string) {
  const d = JSON.parse(JSON.stringify(CTX.dataRaw));
  d.tobaccos.push({ id: d.nxT, uid: "tob-" + name.toLowerCase().replace(/\W/g, ""), brand: "Test", name, lots: [] });
  d.nxT += 1;
  await act(async () => { CTX.save(d); });
  await advance(100);
}
async function renameFirst(name: string) {
  const d = JSON.parse(JSON.stringify(CTX.dataRaw));
  d.tobaccos[0].name = name;
  await act(async () => { CTX.save(d); });
  await advance(100);
}

/** Banner « Restaurer » → picker → Replace / Merge. */
async function restoreOffered(mode: "replace" | "merge") {
  expect(CTX.cloudNewerBackup, "a backup must be on offer").not.toBeNull();
  await act(async () => { CTX.restoreCloudNewerBackup(); });
  await advance(500);
  expect(CTX.importConfirm, "the picker must be open").not.toBeNull();
  await act(async () => { CTX.applyImport(mode); });
  await advance(100);
  await reloadIfAsked();
  // let the post-restore upload run
  await advance(8000);
}

function offered(): string | null { return CTX.cloudNewerBackup ? CTX.cloudNewerBackup.name : null; }
function cloudNames(): string[] { return [...cloud.values()].map((f) => f.name).sort(); }
function autoFileOf(devId: string): CloudFile | undefined {
  return [...cloud.values()].find((f) => f.name.indexOf("cave-tabac-auto-" + devId + "-") === 0);
}
function contentOf(f: CloudFile | undefined): any { return f ? JSON.parse(f.content) : null; }

/** Two devices that already share one cellar: A uploaded it, B was set up by
 *  REPLACE-restoring A's file, and both have since been through a launch. */
async function pairedDevices() {
  const A = newDevice("iPhone", "iphone1", BASE_CELLAR);
  const B = newDevice("iPad", "ipad1", null);
  await launch(A);
  await renameFirst("Duskfall");        // normalise + a first real save → upload
  await addTobacco("Seed");
  await close();
  wait(60000);
  await launch(B);
  await restoreOffered("replace");
  await close();
  wait(60000);
  await launch(A);
  const aSees = offered();
  await close();
  wait(60000);
  await launch(B);
  const bSees = offered();
  await close();
  wait(60000);
  return { A, B, aSees, bSees };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-04T08:00:00Z"));
  cloud = new Map();
  fileSeq = 0;
  uploadGate = null;
  offline = false;
  fetchLog = [];
  localStorage.clear();
  sessionStorage.clear();
  (globalThis as any).fetch = vi.fn(fakeFetch);
  reloadSpy = vi.fn();
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload: reloadSpy } as any);
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});
afterEach(async () => {
  if (mounted) { const m = mounted; await act(async () => { m.unmount(); }); mounted = null; }
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

// Set TWO_DEVICE_DEBUG=1 to print the cloud and the offers of a scenario.
function dbg(label: string, extra: any = {}) {
  if (!process.env.TWO_DEVICE_DEBUG) return;
  process.stdout.write("DBG " + label + " " + JSON.stringify(Object.assign({ cloud: cloudNames() }, extra), null, 1) + "\n");
}

/** Alternate launches (first, second, first…), restoring whatever is offered
 *  with `mode`, until two launches in a row are silent. Returns every offer. */
async function settle(first: Device, second: Device, mode: "replace" | "merge", maxLaunches = 8) {
  const offers: string[] = [];
  let quiet = 0;
  for (let i = 0; i < maxLaunches && quiet < 2; i++) {
    const d = i % 2 === 0 ? first : second;
    await launch(d);
    let o = offered();
    if (!o) quiet++;
    while (o) {
      offers.push(d.name + " <- " + o);
      quiet = 0;
      await restoreOffered(mode);
      o = offered();
      if (offers.length > 12) break;
    }
    await close();
    wait(60000);
  }
  return offers;
}

/** A edits (Alpha) and auto-saves; returns A's file. */
async function aEditsAlpha(A: Device) {
  await launch(A);
  await addTobacco("Alpha");
  await close();
  wait(5 * 60000);
  return autoFileOf("iphone1")!;
}

/** B (auto-save OFF) edits Beta and saves BY HAND; returns the manual file. */
async function bSavesBetaByHand(B: Device) {
  B.ls.set("cave-autosave", "0");
  await launch(B);
  await addTobacco("Beta");
  await act(async () => { CTX.gdriveSave(); });
  await advance(5000);
  await close();
  wait(5 * 60000);
  return [...cloud.values()].find((f) => f.name.indexOf("cave-tabac-auto-") !== 0)!;
}

/** B's auto-save is uploading (held) when B REPLACE-restores A's file; the
 *  replace reloads the page, so that upload's answer never comes back, but
 *  the server commits it when released — `before` or `after` the new page's
 *  own upload. */
async function staleUploadAcrossReload(order: "before" | "after") {
  const { A, B } = await pairedDevices();
  const aFile = await aEditsAlpha(A);
  await launch(B, 500);
  const gate = holdUploads(true);
  await addTobacco("Beta");
  await advance(5500);                 // B's upload is held; the check offered A's file
  expect(offered()).toBe(aFile.name);
  await act(async () => { CTX.restoreCloudNewerBackup(); });
  await advance(500);
  await act(async () => { CTX.applyImport("replace"); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(reloadSpy).toHaveBeenCalled();
  reloadSpy.mockClear();
  await remount();
  if (order === "before") { gate.release(); await advance(1000); }
  await advance(30000);                // the dead page's lock expires; the new page uploads
  if (order === "after") { gate.release(); await advance(2000); }
  await close();
  wait(5 * 60000);
  const bFiles = [...cloud.values()].filter((f) => f.name.indexOf("auto-ipad1-") >= 0);
  dbg("stale " + order, { bFiles: bFiles.map((f) => [f.name, tobNames(contentOf(f))]) });
  expect(tobNames(storedOf(B))).toEqual(["Alpha", "Duskfall", "Seed"]);
  expect(B.ls.get("cave-pending-sync")).toBeUndefined();
  return { A, B, bFiles };
}

// ═════════════════════════════════════════════════════════════════════════
// PASSING — regression tests
// ═════════════════════════════════════════════════════════════════════════

describe("harness", () => {
  it("baseline: A uploads, B is set up by a REPLACE, then both are silent", async () => {
    const { A, B, aSees, bSees } = await pairedDevices();
    dbg("baseline", { aSees, bSees, fetchLog });
    expect(tobNames(storedOf(B))).toEqual(["Duskfall", "Seed"]);
    expect(tobNames(storedOf(A))).toEqual(["Duskfall", "Seed"]);
    expect(aSees).toBeNull();
    expect(bSees).toBeNull();
    expect(fetchLog.filter((l) => l.indexOf("download") === 0).length, "B really restored").toBe(1);
    expect(backupRev(autoFileOf("ipad1")!.name)).toBe(backupRev(autoFileOf("iphone1")!.name));
  });

  it("a launch and a resume with no edit change neither the revision nor the cloud", async () => {
    const { A } = await pairedDevices();
    const revBefore = A.ls.get("cave-cellar-rev");
    const before = cloudNames();
    await launch(A);
    await resume();
    await close();
    expect(A.ls.get("cave-cellar-rev")).toBe(revBefore);
    expect(cloudNames()).toEqual(before);
  });
});

describe("1 — an edit on A reaches B", () => {
  it("1a REPLACE on B: B gets the edit, its file carries A's revision, then A (launch and resume) and B are silent", async () => {
    const { A, B } = await pairedDevices();
    const aFile = await aEditsAlpha(A);
    expect(tobNames(contentOf(aFile))).toContain("Alpha");
    await launch(B);
    expect(offered(), "B is offered A's edit").toBe(aFile.name);
    await restoreOffered("replace");
    expect(tobNames(stored())).toContain("Alpha");
    expect(offered(), "B, after its own restore").toBeNull();
    await close();
    expect(backupRev(autoFileOf("ipad1")!.name)).toBe(backupRev(aFile.name));
    wait(5 * 60000);
    await launch(A);
    expect(offered(), "A is not offered its own cellar back (launch)").toBeNull();
    await resume();
    expect(offered(), "…nor on resume").toBeNull();
    await close();
    wait(5 * 60000);
    await launch(B);
    expect(offered()).toBeNull();
    await close();
  });

  // Converges, but through ONE echo — see the it.fails 1b below.
  it("1c MERGE on B: both end with the edit and the loop ends within two offers", async () => {
    const { A, B } = await pairedDevices();
    await aEditsAlpha(A);
    const offers = await settle(B, A, "merge");
    dbg("1c", { offers });
    expect(offers.length).toBeLessThanOrEqual(2);
    expect(tobNames(storedOf(A))).toEqual(tobNames(storedOf(B)));
    expect(tobNames(storedOf(B))).toContain("Alpha");
  });
});

describe("2 — identical cellars under different revisions (the state builds 42/43 left)", () => {
  async function splitRevisions() {
    const { A, B } = await pairedDevices();
    // Same content on both; each device holds a revision the other has never
    // seen, its cloud file carries it, and nothing is acknowledged.
    for (const [d, rev] of [[A, "aaaa1111"], [B, "bbbb2222"]] as const) {
      d.ls.set("cave-cellar-rev", rev);
      d.ls.set("cave-cellar-revs", JSON.stringify([rev]));
      d.ls.set("cave-pending-sync", "1");
      for (const k of [...d.ls.keys()]) if (k.indexOf("cave-cloud-newer-") === 0) d.ls.delete(k);
    }
    await launch(A); await close(); wait(60000);
    await launch(B); await close(); wait(60000);
    expect(backupRev(autoFileOf("iphone1")!.name)).toBe("aaaa1111");
    expect(backupRev(autoFileOf("ipad1")!.name)).toBe("bbbb2222");
    return { A, B };
  }
  for (const mode of ["replace", "merge"] as const) {
    it("2 " + mode + ": at most one offer per device, then silence", async () => {
      const { A, B } = await splitRevisions();
      const offers = await settle(A, B, mode, 10);
      dbg("2 " + mode, { offers });
      // measured: replace → 1 offer, merge → 2 (one per device)
      expect(offers.length, offers.join("\n")).toBeLessThanOrEqual(2);
      expect(new Set(offers.map((o) => o.split(" <- ")[0])).size).toBe(offers.length);
      expect(tobNames(storedOf(A))).toEqual(tobNames(storedOf(B)));
    });
  }
});

describe("3 — divergence: both edit offline, then merge", () => {
  // Converges with no loss, but in THREE offers — see the it.fails 3 below.
  it("3 both end with both edits and the loop terminates (three offers)", async () => {
    const { A, B } = await pairedDevices();
    offline = true;
    await launch(A); await addTobacco("Alpha"); await close(); wait(60000);
    await launch(B); await addTobacco("Beta"); await close(); wait(60000);
    offline = false;
    const offers = await settle(A, B, "merge", 10);
    dbg("3", { offers });
    expect(tobNames(storedOf(A))).toEqual(["Alpha", "Beta", "Duskfall", "Seed"]);
    expect(tobNames(storedOf(B))).toEqual(["Alpha", "Beta", "Duskfall", "Seed"]);
    expect(offers.length, offers.join("\n")).toBeLessThanOrEqual(3);
  });
});

describe("4 — dismiss (X), then « Vérifier »", () => {
  it("a dismissed backup stays quiet at launch, comes back on « Vérifier »; once restored, « Vérifier » does not bring it back", async () => {
    const { A, B } = await pairedDevices();
    const aFile = await aEditsAlpha(A);
    await launch(B);
    expect(offered()).toBe(aFile.name);
    await act(async () => { CTX.dismissCloudNewerBackup(); });
    expect(offered()).toBeNull();
    await close(); wait(60000);
    await launch(B);
    expect(offered(), "dismissed: silent at the next launch").toBeNull();
    await resume();
    expect(offered(), "…and on resume").toBeNull();
    await act(async () => { CTX.checkCloudNewerNow(); });
    await advance(2000);
    expect(offered(), "« Vérifier » brings the dismissed backup back").toBe(aFile.name);
    await restoreOffered("merge");
    await act(async () => { CTX.checkCloudNewerNow(); });
    await advance(2000);
    expect(CTX.syncDiag, "the check ran").not.toBeNull();
    expect(offered(), "a restored backup is not offered again by « Vérifier »").toBeNull();
    await close();
  });
});

describe("5 — a backup written before revisions existed (no -r in the name)", () => {
  async function legacyOnCloud() {
    const { A, B } = await pairedDevices();
    // A, still on an older build, uploads an edit under a name with no revision.
    const content = Object.assign(JSON.parse(JSON.stringify(storedOf(A))), {
      _saveType: "auto", _savedAt: new Date().toISOString(), _schemaVersion: 6,
      _settings: { "cave-autosave": "1", "cave-cloud-provider": "dropbox" },
    });
    content.tobaccos.push({ id: content.nxT, uid: "tob-legacy", brand: "Test", name: "Legacy", lots: [] });
    content.nxT += 1;
    for (const f of [...cloud.values()]) if (f.name.indexOf("iphone1") >= 0) cloud.delete(f.id);
    const name = "cave-tabac-auto-iphone1-20261004-093000-t3-p1-w0-a0-j0-iphone.json";
    cloud.set("id:legacy", { id: "id:legacy", name, content: JSON.stringify(content), server_modified: isoNow() });
    wait(5 * 60000);
    return { A, B, name };
  }
  for (const mode of ["replace", "merge"] as const) {
    it("5 " + mode + ": B gets the edit and is not offered the same file again", async () => {
      const { B, name } = await legacyOnCloud();
      await launch(B);
      expect(offered()).toBe(name);
      await restoreOffered(mode);
      expect(tobNames(stored())).toContain("Legacy");
      expect(offered()).toBeNull();
      await close(); wait(60000);
      await launch(B);
      expect(offered()).toBeNull();
      await close();
    });
  }
});

describe("6 — a REPLACE carrying _settings reloads the page", () => {
  it("the adopted revision and the unsynced flag survive the reload, and the upload carries the adopted revision", async () => {
    const { A, B } = await pairedDevices();
    const aFile = await aEditsAlpha(A);
    expect(contentOf(aFile)._settings, "every auto backup carries preferences").toBeTruthy();
    await launch(B, 6000);
    expect(offered()).toBe(aFile.name);
    await act(async () => { CTX.restoreCloudNewerBackup(); });
    await advance(500);
    await act(async () => { CTX.applyImport("replace"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(reloadSpy, "the replace asks for a reload").toHaveBeenCalled();
    expect(localStorage.getItem("cave-cellar-rev")).toBe(backupRev(aFile.name));
    expect(localStorage.getItem("cave-pending-sync")).toBe("1");
    await reloadIfAsked();               // remount + 8 s: auto-save and launch check
    expect(localStorage.getItem("cave-cellar-rev")).toBe(backupRev(aFile.name));
    expect(localStorage.getItem("cave-pending-sync"), "uploaded after the reload").toBeNull();
    expect(backupRev(autoFileOf("ipad1")!.name)).toBe(backupRev(aFile.name));
    expect(offered()).toBeNull();
    await close();
  });
});

describe("7 — an upload already in flight on B when B applies a restore", () => {
  it("7a MERGE while B's own upload hangs: B's single file ends on the merged cellar, and A gets B's edit", async () => {
    const { A, B } = await pairedDevices();
    const aFile = await aEditsAlpha(A);
    await launch(B, 500);
    const gate = holdUploads(false);
    await addTobacco("Beta");
    await advance(6000);                 // upload held; the check offered A's file
    expect(offered()).toBe(aFile.name);
    await restoreOffered("merge");
    gate.release();
    await advance(30000);
    expect(tobNames(stored())).toEqual(["Alpha", "Beta", "Duskfall", "Seed"]);
    await close();
    const bFiles = [...cloud.values()].filter((f) => f.name.indexOf("auto-ipad1-") >= 0);
    expect(bFiles.length).toBe(1);
    expect(tobNames(contentOf(bFiles[0]!))).toEqual(["Alpha", "Beta", "Duskfall", "Seed"]);
    wait(5 * 60000);
    const offers = await settle(A, B, "merge");
    expect(tobNames(storedOf(A))).toEqual(["Alpha", "Beta", "Duskfall", "Seed"]);
    expect(offers.length, offers.join("\n")).toBeLessThanOrEqual(2);
  });

  it("7b REPLACE (reload) — the dead page's upload lands BEFORE the new page's: swept, A silent", async () => {
    const { A, bFiles } = await staleUploadAcrossReload("before");
    expect(bFiles.length).toBe(1);
    await launch(A);
    expect(offered()).toBeNull();
    await close();
  });
});

describe("8 — auto-save off on one device, manual saves", () => {
  it("8a B (auto-save off) merges A's edit, edits, saves by hand; A is offered B's manual backup", async () => {
    const { A, B } = await pairedDevices();
    B.ls.set("cave-autosave", "0");
    await aEditsAlpha(A);
    await launch(B);
    await restoreOffered("merge");
    await addTobacco("Beta");
    await act(async () => { CTX.gdriveSave(); });
    await advance(5000);
    await close();
    const manual = [...cloud.values()].find((f) => f.name.indexOf("cave-tabac-auto-") !== 0)!;
    expect(manual, "B's manual backup is in the cloud").toBeDefined();
    wait(5 * 60000);
    await launch(A);
    expect(offered()).toBe(manual.name);
    await restoreOffered("merge");
    expect(tobNames(stored())).toEqual(["Alpha", "Beta", "Duskfall", "Seed"]);
    await close();
  });
});

describe("9 — other paths", () => {
  it("9a an expired access token is renewed silently and the launch check still offers", async () => {
    const { A, B } = await pairedDevices();
    const aFile = await aEditsAlpha(A);
    B.ls.set("dropbox-tk", JSON.stringify({ t: "dead", x: Date.now() - 1000 }));
    await launch(B);
    expect(offered()).toBe(aFile.name);
    await close();
  });

  it("9b a device that lost its cave-device-id is not offered its own old file; B gets its new one", async () => {
    const { A, B } = await pairedDevices();
    A.ls.delete("cave-device-id");
    await launch(A);
    expect(offered()).toBeNull();
    await addTobacco("Alpha");
    await close();
    wait(5 * 60000);
    expect(A.ls.get("cave-device-id")).not.toBe("iphone1");
    // NOTE: A's file under the OLD id stays in the cloud for good — A now
    // reads it as foreign and never sweeps it.
    expect(autoFileOf("iphone1")).toBeDefined();
    await launch(B);
    const bOffer = offered();
    expect(tobNames(contentOf([...cloud.values()].find((f) => f.name === bOffer)))).toContain("Alpha");
    await restoreOffered("replace");
    expect(offered()).toBeNull();
    await close();
  });

  it("9d B resumed (not relaunched) is offered A's new upload", async () => {
    const { B } = await pairedDevices();
    await launch(B);
    expect(offered()).toBeNull();
    // A acts while B sits in the background. One jsdom cannot run A's app
    // while B's is mounted, so A's next upload is written into the cloud
    // directly: A's file, plus Alpha, under a new revision.
    const aFile = autoFileOf("iphone1")!;
    const c = contentOf(aFile);
    c.tobaccos.push({ id: c.nxT, uid: "tob-alpha", brand: "Test", name: "Alpha", lots: [] });
    c.nxT += 1;
    const name = aFile.name.replace(/-r[0-9a-z]+-t\d+/, "-rzzz999-t3");
    cloud.delete(aFile.id);
    cloud.set("id:a2", { id: "id:a2", name, content: JSON.stringify(c), server_modified: isoNow() });
    await resume();
    expect(offered()).toBe(name);
    await close();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// FAILING TODAY — `it.fails`: each states the DESIRED behaviour; the comment
// says what happens instead. When one is fixed it turns red: drop `.fails`.
// ═════════════════════════════════════════════════════════════════════════

describe("was FAILING, fixed in build 45 (except 3) — the merge echo", () => {
  // OBSERVED: B's merge of A's file yields a cellar byte-identical
  // (stableStringify) to A's — B had nothing A lacked — but save() sees a
  // change on B, so it stamps a FRESH revision and B uploads under it. A has
  // never held that revision, so A is offered B's file: its own cellar back.
  // (cloudRestoreApplied returns early for a merge: useGdriveSync.ts ~3031.)
  it("1b MERGE on B: A is not offered B's copy of A's own cellar", async () => {
    const { A, B } = await pairedDevices();
    const aFile = await aEditsAlpha(A);
    await launch(B);
    expect(offered()).toBe(aFile.name);
    await restoreOffered("merge");
    await close();
    expect(stableStringify(storedOf(B))).toBe(stableStringify(storedOf(A)));
    wait(5 * 60000);
    await launch(A);
    const aOffer = offered();
    await close();
    expect(aOffer, "A must not be offered B's copy of A's own cellar").toBeNull();
  });

  // OBSERVED: iPad ← A(Alpha); iPhone ← B(union); iPad ← A(union, again).
  // A's merge result has the same content as B's file but other local ids
  // (Alpha 3/Beta 4 on A, Beta 3/Alpha 4 on B), so a fresh revision is
  // stamped and B is offered A's union: an echo. B's merge then changes
  // nothing and the loop stops.
  it.fails("3 divergence + merges: at most two offers (no echo)", async () => {
    const { A, B } = await pairedDevices();
    offline = true;
    await launch(A); await addTobacco("Alpha"); await close(); wait(60000);
    await launch(B); await addTobacco("Beta"); await close(); wait(60000);
    offline = false;
    const offers = await settle(A, B, "merge", 10);
    expect(offers.length, offers.join("\n")).toBeLessThanOrEqual(2);
  });
});

describe("was FAILING, fixed in build 45 — revision history", () => {
  // OBSERVED: CELLAR_REVS_MAX = 50. After 51 content-changing saves on A, the
  // revision B adopted when it replaced from A has left A's history, so B's
  // file — A's cellar from 51 edits ago, untouched since — is offered to A as
  // a newer backup. A tap on Remplacer there throws away 51 edits.
  it("9c more than 50 edits on A: B's file carrying A's old revision is not offered to A", async () => {
    const { A } = await pairedDevices();
    const bFile = autoFileOf("ipad1")!;
    expect(A.ls.get("cave-cellar-revs")).toContain(backupRev(bFile.name)!);
    await launch(A);
    for (let i = 0; i < 51; i++) await renameFirst("Duskfall " + i);
    await close();
    wait(5 * 60000);
    await launch(A);
    const aOffer = offered();
    await close();
    expect(aOffer, "B's file is A's own cellar from 51 edits ago").toBeNull();
  });

  // OBSERVED: A {Beta, Duskfall, Seed}, B {Alpha, Duskfall, Seed}, and
  // NEITHER is offered anything. A replaced with B's file (adopting R_b) and
  // B replaced with A's earlier file (adopting R_a); each device still lists
  // the revision it DISCARDED as its own, so each reads the other's upload as
  // an echo. Silent divergence until the next edit.
  it("10 crossed replaces: different cellars are not left with both devices silent", async () => {
    const { A, B } = await pairedDevices();
    offline = true;
    await launch(A); await addTobacco("Alpha"); await close(); wait(60000);
    await launch(B); await addTobacco("Beta"); await close(); wait(60000);
    offline = false;
    await launch(A); await close(); wait(60000);           // A uploads Alpha
    const fa1 = Object.assign({}, autoFileOf("iphone1")!);
    await launch(B);                                         // B uploads Beta, sees A's offer…
    expect(offered()).toBe(fa1.name);
    await close(); wait(60000);                              // …and leaves it for now
    await launch(A);
    expect(offered()).toBe(autoFileOf("ipad1")!.name);
    await restoreOffered("replace");                         // A takes B's cellar
    await close(); wait(60000);
    // Both apps were open side by side: B had listed and downloaded A's Alpha
    // file before A's replace overwrote it. Put that file back for B.
    //
    // FIXED (build 45), and the fix made this path unreachable as modelled:
    // the re-inserted copy is an OLDER file of A's (its name stamp predates
    // A's post-replace upload), so the guard now treats it as a straggler and
    // B is not offered it at all — no crossed replace can start. The other
    // half of the fix (a replace resets the revision history, so a crossed
    // replace that DOES happen is offered on both sides) is locked directly
    // in useGdriveSync.test.ts « crossed replaces are visible ».
    cloud.set("id:fa1-copy", Object.assign({}, fa1, { id: "id:fa1-copy" }));
    await launch(B);
    expect(offered(), "A's older file is a straggler, not news").not.toBe(fa1.name);
    if (offered()) await restoreOffered("replace");
    cloud.delete("id:fa1-copy");
    await close(); wait(60000);
    await launch(A); const aOffer = offered(); await close(); wait(60000);
    await launch(B); const bOffer = offered(); await close();
    dbg("10", { aOffer, bOffer, A: tobNames(storedOf(A)), B: tobNames(storedOf(B)) });
    const same = stableStringify(tobNames(storedOf(A))) === stableStringify(tobNames(storedOf(B)));
    expect(same || !!aOffer || !!bOffer, "different cellars, and neither device is told").toBe(true);
  });
});

describe("was FAILING, fixed in build 45 — the in-flight upload across a replace's reload", () => {
  // OBSERVED: the dead page's upload (B's cellar with Beta, WITHOUT Alpha)
  // commits after the new page's upload. Its name carries the older snapshot
  // time but its server_modified is the newest, it is stamped with B's id
  // (foreign to A) and carries B's pre-replace revision, unknown to A — so A
  // is offered B's discarded cellar, and B keeps two auto files until its
  // next save sweeps one.
  it("7b-after the stale upload lands last: A is not offered B's discarded cellar, B keeps one file", async () => {
    const { A, bFiles } = await staleUploadAcrossReload("after");
    await launch(A);
    const aOffer = offered();
    await close();
    expect(aOffer, "A must not be offered B's discarded pre-replace cellar").toBeNull();
    // B still holds TWO auto files here until its next save sweeps the stale
    // one — accepted: the stale file is now ignored by the other device
    // (« superseded »), which is what mattered. Asserted as such, not hidden.
    expect(bFiles.length).toBe(2);
  });

  // OBSERVED, continuing 7b-after: A takes the offer with Remplacer. A ends
  // with {Beta, Duskfall, Seed} — its own Alpha gone — B with {Alpha,
  // Duskfall, Seed}, and neither is offered anything: A adopted the stale
  // file's revision, which B held before its replace and still counts as its
  // own (same root cause as 10).
  // FIXED (build 45): A is no longer offered the stale file at all, so it
  // cannot replace with it; both devices end on B's chosen cellar.
  it("7c …and A replaces with it: the devices are not left diverged and silent", async () => {
    const { A, B } = await staleUploadAcrossReload("after");
    await launch(A);
    if (offered()) await restoreOffered("replace");
    await close(); wait(60000);
    await launch(B); const bOffer = offered(); await close(); wait(60000);
    await launch(A); const aOffer = offered(); await close();
    const same = stableStringify(tobNames(storedOf(A))) === stableStringify(tobNames(storedOf(B)));
    expect(same || !!aOffer || !!bOffer, "different cellars, and neither device is told").toBe(true);
  });
});

describe("was FAILING, fixed in build 45 — manual backups and preferences", () => {
  // OBSERVED: B's manual backup (Beta) carries no device id, so the guard
  // still cuts it by A's last upload time (gdriveApi.ts findNewerCloudBackup,
  // `!isForeignStamped && ts <= localRefTs + margin`). A had an unsynced edit
  // from an offline session; at launch the auto-save (1.2 s) uploads before
  // the check (4.5 s) looks, so B's backup is "older" and never offered —
  // though its revision is unknown to A and A never saw Beta.
  it("8b A uploaded after B's manual save without having seen it: A is still offered it", async () => {
    const { A, B } = await pairedDevices();
    const manual = await bSavesBetaByHand(B);
    expect(manual).toBeDefined();
    offline = true;
    await launch(A); await addTobacco("Alpha"); await close();
    offline = false;
    wait(5 * 60000);
    await launch(A);
    const aOffer = offered();
    await close();
    expect(aOffer, "B's manual backup holds Beta, which A has never seen").toBe(manual.name);
  });

  // OBSERVED: B's manual backup carries B's preferences, including
  // `cave-autosave: "0"` (appSettings.ts SETTINGS_KEYS). A REPLACE adopts
  // them (useImportConfirm applySettings), so A's auto-save is switched OFF
  // without a word. A's unsynced flag stays "1" and A's cloud file never
  // moves again.
  it("8c A replace-restores B's manual backup: A's auto-save stays on", async () => {
    const { A, B } = await pairedDevices();
    await bSavesBetaByHand(B);
    await launch(A);
    expect(offered()).not.toBeNull();
    await restoreOffered("replace");
    const autosave = localStorage.getItem("cave-autosave");
    await close();
    expect(autosave, "A's auto-save must stay on").toBe("1");
  });
});
