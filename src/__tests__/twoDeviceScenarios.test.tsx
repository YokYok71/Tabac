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

// Each device has its OWN photo store (build 54 — the photo pack): swapped
// in with its localStorage, so a restore really has to bring photos over.
vi.mock("../utils/imgCache.ts", async () => {
  const real: any = await vi.importActual("../utils/imgCache.ts");
  const store = (): Map<string, string> => (globalThis as any).__PHOTOS || new Map();
  return {
    ...real,
    imgCache: {
      open: () => Promise.resolve(null),
      get: (k: string) => Promise.resolve(store().get(k)),
      put: (k: string, v: string) => { store().set(k, v); return Promise.resolve(true); },
      keys: () => Promise.resolve([...store().keys()]),
      del: (k: string) => { store().delete(k); return Promise.resolve(true); },
      clear: () => { store().clear(); return Promise.resolve(); },
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
let failPackUploads = false;
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
    if (failPackUploads && String(arg.path).indexOf("/cave-tabac-photos-") === 0) {
      fetchLog.push("upload-failed " + String(arg.path).replace(/^\//, ""));
      return wire(500, { error_summary: "internal_error/" });
    }
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

type Device = { name: string; ls: Map<string, string>; ss: Map<string, string>; photos: Map<string, string> };
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
  return { name, ls, ss: new Map(), photos: new Map() };
}

function swapIn(dev: Device) {
  (globalThis as any).__PHOTOS = dev.photos;
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
  failPackUploads = false;
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
  it("1a REPLACE on B: B gets the edit and uploads NOTHING (A's file descends from B's cellar), then A (launch and resume) and B are silent", async () => {
    const { A, B } = await pairedDevices();
    const aFile = await aEditsAlpha(A);
    expect(tobNames(contentOf(aFile))).toContain("Alpha");
    await launch(B);
    expect(offered(), "B is offered A's edit").toBe(aFile.name);
    const bFileBefore = autoFileOf("ipad1")!.name;
    await restoreOffered("replace");
    expect(tobNames(stored())).toContain("Alpha");
    expect(offered(), "B, after its own restore").toBeNull();
    await close();
    // Build 46: B held nothing A's file lacks, so B sends nothing back. Its
    // file keeps a revision A has HELD — which is why A stays silent below.
    expect(autoFileOf("ipad1")!.name, "no upload from B").toBe(bFileBefore);
    expect(JSON.parse(A.ls.get("cave-cellar-revs")!)).toContain(backupRev(bFileBefore));
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

/** A smokes a session on lot-1 through the real save(), the way the session
 *  store writes it: the session row, and the lot debited. */
async function aSmokesSession(A: Device) {
  await launch(A);
  const d = JSON.parse(JSON.stringify(CTX.dataRaw));
  d.sessions.push({
    id: d.nxJ, uid: "sess-a1", date: "2026-10-04", tobaccoId: 1, pipeId: 1,
    lotId: "lot-1", weightG: "3", duration: 45, rating: 4, notes: "",
  });
  d.nxJ += 1;
  const lot = d.tobaccos[0].lots[0];
  lot.weightG = Number(lot.weightG) - 3;
  await act(async () => { CTX.save(d); });
  await advance(100);
  await close();
  wait(5 * 60000);
  return autoFileOf("iphone1")!;
}

// THE USER'S CASE, reported from the iPhone after builds 41–45: a session on
// one device, MERGED on the other, and the first device is offered its own
// data back. A merge detaches incoming sessions from their lot, so its result
// never equals the file and save() stamps a fresh revision — which B then
// uploaded. B held nothing A lacked: the file's lineage says so (build 46).
describe("11 — a session smoked on A, then restored on B", () => {
  for (const mode of ["merge", "replace"] as const) {
    it("11 " + mode + ": the picker recommends Replace, B uploads nothing, A is not offered anything", async () => {
      const { A, B } = await pairedDevices();
      const aFile = await aSmokesSession(A);
      expect(contentOf(aFile)._revs, "the backup carries its lineage").toContain(B.ls.get("cave-cellar-rev"));
      const bFileBefore = autoFileOf("ipad1")!.name;
      await launch(B);
      expect(offered()).toBe(aFile.name);
      await act(async () => { CTX.restoreCloudNewerBackup(); });
      await advance(500);
      expect(CTX.importConfirm.replaceIsLossless, "Replace is recommended").toBe(true);
      expect(CTX.importConfirm.parsed._revs, "the lineage is not staged into the cellar").toBeUndefined();
      await act(async () => { CTX.applyImport(mode); });
      await advance(100);
      await reloadIfAsked();
      await advance(8000);
      expect((stored().sessions || []).length, "B has the session").toBe(1);
      expect(stored()._revs).toBeUndefined();
      expect(localStorage.getItem("cave-pending-sync"), "nothing left to send").toBeNull();
      expect(offered()).toBeNull();
      await resume();
      await close();
      expect(autoFileOf("ipad1")!.name, "B uploaded nothing").toBe(bFileBefore);
      if (mode === "replace") {
        // A faithful copy: the session keeps its lot, the lot keeps its debit.
        expect(storedOf(B).sessions[0].lotId).toBe("lot-1");
        expect(Number(storedOf(B).tobaccos[0].lots[0].weightG)).toBe(97);
      }
      wait(5 * 60000);
      await launch(A);
      expect(offered(), "A is not offered its own session back (launch)").toBeNull();
      await resume();
      expect(offered(), "…nor on resume").toBeNull();
      await close();
      wait(5 * 60000);
      await launch(B);
      expect(offered()).toBeNull();
      await close();
    });
  }

  it("11 B's next edit reaches A, and A's restore of it sends nothing back either", async () => {
    const { A, B } = await pairedDevices();
    await aSmokesSession(A);
    const offers = await settle(B, A, "merge");
    expect(offers.length, offers.join("\n")).toBe(1);
    await launch(B); await addTobacco("Beta"); await close(); wait(5 * 60000);
    const bFile = autoFileOf("ipad1")!;
    const aFileBefore = autoFileOf("iphone1")!.name;
    await launch(A);
    expect(offered(), "B's edit is genuinely new for A").toBe(bFile.name);
    expect(contentOf(bFile)._revs, "B's lineage holds A's revision").toContain(A.ls.get("cave-cellar-rev"));
    await act(async () => { CTX.restoreCloudNewerBackup(); });
    await advance(500);
    expect(CTX.importConfirm.replaceIsLossless).toBe(true);
    await act(async () => { CTX.applyImport("merge"); });
    await advance(8000);
    await close();
    expect(autoFileOf("iphone1")!.name, "A uploaded nothing").toBe(aFileBefore);
    expect(tobNames(storedOf(A))).toContain("Beta");
    wait(5 * 60000);
    await launch(B);
    expect(offered(), "B is not offered A's copy of B's edit").toBeNull();
    await close();
  });

  it("11 a device with an edit of its own still uploads after the restore (the file does not contain it)", async () => {
    const { A, B } = await pairedDevices();
    const aFile = await aSmokesSession(A);
    offline = true;
    await launch(B); await addTobacco("Beta"); await close(); wait(60000);
    offline = false;
    await launch(B);
    expect(offered()).toBe(aFile.name);
    await act(async () => { CTX.restoreCloudNewerBackup(); });
    await advance(500);
    expect(CTX.importConfirm.replaceIsLossless, "Beta is not in A's file").toBeFalsy();
    await act(async () => { CTX.applyImport("merge"); });
    await advance(8000);
    await close();
    expect(tobNames(contentOf(autoFileOf("ipad1")))).toContain("Beta");
    wait(5 * 60000);
    await launch(A);
    expect(offered(), "A is offered B's Beta").toBe(autoFileOf("ipad1")!.name);
    await close();
  });
});

// Build 47, asked by the user: an iPad left OPEN on the app learned of the
// iPhone's work only once put down and picked up again (launch / resume).
describe("12 — a device left open in the foreground", () => {
  async function aFileWhileBOpen(hiddenMeanwhile: boolean) {
    const { A, B } = await pairedDevices();
    const aFile = await aEditsAlpha(A);
    cloud.delete(aFile.id);              // not there yet when B opens
    await launch(B);
    expect(offered()).toBeNull();
    if (hiddenMeanwhile) Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    cloud.set(aFile.id, Object.assign({}, aFile, { server_modified: isoNow() }));  // A uploads now
    return { A, B, aFile };
  }
  it("12 the other device's upload is offered within 5 minutes, with no launch or resume", async () => {
    const { aFile } = await aFileWhileBOpen(false);
    await advance(3 * 60000);
    expect(offered(), "not before 5 minutes since the last check").toBeNull();
    await advance(2 * 60000 + 20000);  // 5 min after the launch check, plus one tick
    expect(offered()).toBe(aFile.name);
    await close();
  });
  it("12 nothing runs while the app is hidden", async () => {
    await aFileWhileBOpen(true);
    const lists = () => fetchLog.filter((l) => l.indexOf("list") === 0).length;
    const before = lists();
    await advance(12 * 60000);
    expect(lists(), "no listing in the background").toBe(before);
    expect(offered()).toBeNull();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    await close();
  });
  it("12 it stands down while the restore picker is open", async () => {
    const { aFile } = await aFileWhileBOpen(false);
    await advance(5 * 60000 + 20000);
    expect(offered()).toBe(aFile.name);
    await act(async () => { CTX.restoreCloudNewerBackup(); });
    await advance(500);
    expect(CTX.importConfirm).not.toBeNull();
    const lists = () => fetchLog.filter((l) => l.indexOf("list") === 0).length;
    const before = lists();
    await advance(12 * 60000);
    expect(lists(), "no check under the picker").toBe(before);
    await act(async () => { CTX.applyImport("replace"); });
    await advance(100);
    await reloadIfAsked();
    await advance(6 * 60000);
    expect(offered(), "the applied file is not offered again").toBeNull();
    await close();
  });
});

// Build 49, reported from the iPhone: switching destination offered a file
// the other device had left there weeks before, over a cellar edited that day.
// Modelled the other way round (the fake cloud is Dropbox): B was on Drive and
// switches to Dropbox, where A's file already sits.
describe("13 — switching destination", () => {
  // The 28/08 report: a destination this device had never checked.
  it("13 never checked from here: a file already there is not offered; one written after the switch is", async () => {
    const { A, B } = await pairedDevices();
    const aFile = await aEditsAlpha(A);
    B.ls.set("cave-cloud-provider", "gdrive");
    B.ls.delete("cave-cloud-seen-dropbox");    // as if B had never checked Dropbox
    await launch(B);
    expect(offered()).toBeNull();
    const t0 = Date.now();
    await act(async () => { CTX.saveCloudProviderId("dropbox"); });
    expect(Number(localStorage.getItem("cave-cloud-switched-dropbox")), "cut-off = the switch").toBeGreaterThanOrEqual(t0);
    const lists = () => fetchLog.filter((l) => l.indexOf("list") === 0).length;
    const before = lists();
    await advance(5 * 60000 + 20000);   // the periodic check runs on Dropbox
    expect(lists(), "a check did run").toBeGreaterThan(before);
    expect(offered(), "A's file predates the switch").toBeNull();
    cloud.set(aFile.id, Object.assign({}, aFile, { server_modified: isoNow() }));  // A uploads again, now
    await advance(5 * 60000 + 20000);
    expect(offered(), "written after the switch: offered").toBe(aFile.name);
    await close();
  });

  // Build 51: switching BACK must not lose what the other device wrote while
  // this one was away — the window build 49 opened.
  it("13 switching back: a file the other device wrote while this one was away IS offered", async () => {
    const { A, B } = await pairedDevices();
    const seen = Number(B.ls.get("cave-cloud-seen-dropbox"));
    expect(seen, "B's checks on Dropbox found nothing — recorded").toBeGreaterThan(0);
    const aFile = await aEditsAlpha(A);       // written after B's last look
    B.ls.set("cave-cloud-provider", "gdrive");
    await launch(B);
    await act(async () => { CTX.saveCloudProviderId("dropbox"); });
    expect(Number(localStorage.getItem("cave-cloud-switched-dropbox")), "cut-off = B's last empty check").toBe(seen);
    await advance(5 * 60000 + 20000);
    expect(offered()).toBe(aFile.name);
    await close();
  });

  // The Settings offer is the ordinary manual save; after it the destination
  // holds this cellar's revision, which is what the offer reads (build 51).
  it("13 « Y envoyer ma cave » uploads this cellar and records its revision for that destination", async () => {
    const { B } = await pairedDevices();
    expect(B.ls.get("cave-saved-rev-dropbox"), "every upload records its revision").toBe(B.ls.get("cave-cellar-rev"));
    B.ls.set("cave-cloud-provider", "gdrive");
    offline = true;
    await launch(B);
    await addTobacco("Beta");                // the cellar changes away from Dropbox
    offline = false;
    await act(async () => { CTX.saveCloudProviderId("dropbox"); });
    expect(localStorage.getItem("cave-saved-rev-dropbox"), "Dropbox lacks this cellar").not.toBe(localStorage.getItem("cave-cellar-rev"));
    const uploads = () => fetchLog.filter((l) => l.indexOf("upload ") === 0);
    const before = uploads().length;
    await act(async () => { CTX.gdriveSave(); });
    await advance(5000);
    expect(uploads().length, "the cellar went up").toBeGreaterThan(before);
    expect(uploads().some((u) => /^upload cave-tabac-\d{8}/.test(u)), "a manual backup of this device").toBe(true);
    expect(localStorage.getItem("cave-saved-rev-dropbox"), "…and the offer's condition is gone").toBe(localStorage.getItem("cave-cellar-rev"));
    await close();
  });
});

// Reported from the iPad (build 52): « fusionner est sans effet — 53 séances
// sur l'iPhone, toujours 52 après fusion ». A session logged through the REAL
// session form (not a crafted row), uploaded, then merged on the other device.
describe("14 — a session logged through the form on A, merged on B", () => {
  it("14 B gains exactly that session", async () => {
    const { A, B } = await pairedDevices();
    await launch(A);
    // The base lot is sealed (cellar); the form's confirm opens it first.
    await act(async () => { CTX.changeLotStatus(1, "lot-1", "jar"); });
    await advance(100);
    await act(async () => {
      CTX.setSessForm(Object.assign({}, CTX.BJ, {
        date: "2026-10-06", time: "21:15", tobaccoId: 1, pipeId: 1, lotId: "lot-1",
        weightG: "3", duration: "40", rating: 4,
      }));
    });
    await act(async () => { CTX.addSession(); });
    await advance(100);
    const aSess = (stored().sessions || []).filter((x: any) => !x.deletedAt);
    expect(aSess.length, "A logged it").toBe(1);
    expect(aSess[0].uid, "with its own uid").toBeTruthy();
    await close(); wait(5 * 60000);
    const aFile = autoFileOf("iphone1")!;
    expect((contentOf(aFile).sessions || []).length, "A's upload carries it").toBe(1);
    const bBefore = (storedOf(B).sessions || []).length;
    await launch(B);
    expect(offered()).toBe(aFile.name);
    await restoreOffered("merge");
    expect((stored().sessions || []).filter((x: any) => !x.deletedAt).length, "B gained it").toBe(bBefore + 1);
    await close();
  });
});

// Build 53, reported from the iPhone: a session ended, the phone was put
// away, and the session reached the cloud only at the next opening. A new
// session's auto-save now skips the 1.2 s debounce; other edits keep it.
describe("15 — a new session goes to the cloud at once", () => {
  const uploadsOf = (dev: string) => fetchLog.filter((l) => l.indexOf("upload cave-tabac-auto-" + dev + "-") === 0).length;
  it("15 the session's upload starts with no debounce", async () => {
    const { A } = await pairedDevices();
    await launch(A);
    await act(async () => { CTX.changeLotStatus(1, "lot-1", "jar"); });
    await advance(5000);                       // that edit's own debounced upload
    const before = uploadsOf("iphone1");
    await act(async () => {
      CTX.setSessForm(Object.assign({}, CTX.BJ, {
        date: "2026-10-06", time: "21:15", tobaccoId: 1, pipeId: 1, lotId: "lot-1",
        weightG: "3", duration: "40", rating: 4,
      }));
    });
    await act(async () => { CTX.addSession(); });
    await advance(50);                         // far below the 1.2 s debounce
    expect(uploadsOf("iphone1"), "uploaded without waiting").toBe(before + 1);
    await advance(5000);
    expect(uploadsOf("iphone1"), "…and only once").toBe(before + 1);
    expect(localStorage.getItem("cave-pending-sync")).toBeNull();
    await close();
  });

  it("15 any other edit keeps the debounce", async () => {
    const { A } = await pairedDevices();
    await launch(A);
    const before = uploadsOf("iphone1");
    await addTobacco("Gamma");                 // advances 100 ms
    expect(uploadsOf("iphone1"), "not yet").toBe(before);
    await advance(1500);
    expect(uploadsOf("iphone1")).toBe(before + 1);
    await close();
  });
});

// Build 54 — THE PHOTO PACK. The auto file stops carrying the photos; a
// per-device pack does, re-sent only when the photo set changes.
describe("16 — the auto-save's photo pack", () => {
  const PHOTO = (k: string) => "data:image/jpeg;base64," + Buffer.from("img-" + k).toString("base64");
  const packs = () => [...cloud.values()].filter((f) => f.name.indexOf("cave-tabac-photos-") === 0);
  const packUploads = () => fetchLog.filter((l) => l.indexOf("upload cave-tabac-photos-") === 0).length;
  /** A, open: put a photo in A's store and on the first tobacco, then save. */
  async function aSetsPhoto(key: string) {
    (globalThis as any).__PHOTOS.set(key, PHOTO(key));
    const d = JSON.parse(JSON.stringify(CTX.dataRaw));
    d.tobaccos[0].imageUrl = key;
    await act(async () => { CTX.save(d); });
    await advance(5000);
  }
  async function aWithPhoto() {
    const p = await pairedDevices();
    await launch(p.A);
    await aSetsPhoto("local-photo-a1");
    await close(); wait(5 * 60000);
    return p;
  }

  it("16a the auto file names the pack and carries no photo; the pack carries it", async () => {
    await aWithPhoto();
    const auto = contentOf(autoFileOf("iphone1"));
    expect(auto._imageData, "no photo inside the auto file").toBeUndefined();
    expect(auto._photoPack.keys).toEqual(["local-photo-a1"]);
    const pk = packs();
    expect(pk.length).toBe(1);
    expect(auto._photoPack.name).toBe(pk[0]!.name);
    expect(JSON.parse(pk[0]!.content).images["local-photo-a1"]).toBe(PHOTO("local-photo-a1"));
    expect(pk[0]!.name, "named after the device, like the auto file").toMatch(/^cave-tabac-photos-iphone1-\d{8}-\d{6}-iphone\.json$/);
  });

  it("16b a session or an edit without a photo change does NOT re-send the pack", async () => {
    const { A } = await aWithPhoto();
    const before = packUploads();
    const packName = packs()[0]!.name;
    await launch(A);
    await addTobacco("Delta");
    await advance(5000);
    await close();
    expect(packUploads(), "pack not re-sent").toBe(before);
    expect(contentOf(autoFileOf("iphone1"))._photoPack.name, "still names the same pack").toBe(packName);
    expect(tobNames(contentOf(autoFileOf("iphone1")))).toContain("Delta");
  });

  it("16c a new photo re-sends the pack, and the old one is deleted once the auto file names the new one", async () => {
    const { A } = await aWithPhoto();
    const oldName = packs()[0]!.name;
    wait(2000);                                 // the next pack gets another timestamp
    await launch(A);
    await aSetsPhoto("local-photo-a2");
    await advance(20000);                       // the detached sweep
    await close();
    const pk = packs();
    expect(pk.length, "one pack per device").toBe(1);
    expect(pk[0]!.name).not.toBe(oldName);
    expect(Object.keys(JSON.parse(pk[0]!.content).images)).toEqual(["local-photo-a2"]);
    expect(contentOf(autoFileOf("iphone1"))._photoPack.name).toBe(pk[0]!.name);
  });

  it("16d B restores A's file and gets the photo; with the photo already there, the pack is not downloaded", async () => {
    const { A, B } = await aWithPhoto();
    expect(B.photos.size).toBe(0);
    await launch(B);
    expect(offered(), "the auto file is offered, never the pack").toMatch(/^cave-tabac-auto-iphone1-/);
    await restoreOffered("replace");
    await close();
    expect(B.photos.get("local-photo-a1"), "the photo came over").toBe(PHOTO("local-photo-a1"));
    // Second round: A edits (no photo change); B already holds the photo.
    wait(5 * 60000);
    await launch(A); await addTobacco("Epsilon"); await close(); wait(5 * 60000);
    const downloadsBefore = fetchLog.filter((l) => l.indexOf("download cave-tabac-photos-") === 0).length;
    await launch(B);
    await restoreOffered("replace");
    await close();
    expect(tobNames(storedOf(B))).toContain("Epsilon");
    expect(fetchLog.filter((l) => l.indexOf("download cave-tabac-photos-") === 0).length, "pack not downloaded").toBe(downloadsBefore);
  });

  it("16e a pack deleted from the cloud is sent again at the next save", async () => {
    const { A } = await aWithPhoto();
    for (const f of packs()) cloud.delete(f.id);
    const before = packUploads();
    await launch(A);
    await addTobacco("Zeta");
    await advance(5000);
    await close();
    expect(packUploads()).toBe(before + 1);
    expect(packs().length).toBe(1);
    expect(contentOf(autoFileOf("iphone1"))._photoPack.name).toBe(packs()[0]!.name);
  });

  it("16f a failed pack upload sends nothing: the auto file is not sent, the cellar stays unsynced", async () => {
    const { A } = await pairedDevices();
    const autoBefore = autoFileOf("iphone1")!.name;
    await launch(A);
    failPackUploads = true;
    await aSetsPhoto("local-photo-a1");
    expect(fetchLog.some((l) => l.indexOf("upload-failed cave-tabac-photos-") === 0), "the pack was tried").toBe(true);
    expect(autoFileOf("iphone1")!.name, "no auto file naming a pack that is not there").toBe(autoBefore);
    expect(localStorage.getItem("cave-pending-sync")).toBe("1");
    failPackUploads = false;
    await resume();
    await close();
    expect(packs().length).toBe(1);
    expect(contentOf(autoFileOf("iphone1"))._photoPack.name).toBe(packs()[0]!.name);
  });

  it("16g a pack that cannot be had does not block the restore: the cellar comes, the shortfall is said", async () => {
    const { B } = await aWithPhoto();
    for (const f of packs()) cloud.delete(f.id);
    await launch(B);
    await act(async () => { CTX.restoreCloudNewerBackup(); });
    await advance(500);
    expect(String(CTX.gdriveStatus || ""), "the shortfall is said").toBe(CTX.t("photo_pack_missing").replace("{n}", "1"));
    expect(CTX.importConfirm, "and the picker is open all the same").not.toBeNull();
    await act(async () => { CTX.applyImport("replace"); });
    await advance(100);
    await reloadIfAsked();
    expect(tobNames(stored())).toContain("Duskfall");
    expect((globalThis as any).__PHOTOS.has("local-photo-a1"), "no photo").toBe(false);
    await close();
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
  it("3 both end with both edits and the loop terminates", async () => {
    const { A, B } = await pairedDevices();
    offline = true;
    await launch(A); await addTobacco("Alpha"); await close(); wait(60000);
    await launch(B); await addTobacco("Beta"); await close(); wait(60000);
    offline = false;
    const offers = await settle(A, B, "merge", 10);
    dbg("3", { offers });
    expect(tobNames(storedOf(A))).toEqual(["Alpha", "Beta", "Duskfall", "Seed"]);
    expect(tobNames(storedOf(B))).toEqual(["Alpha", "Beta", "Duskfall", "Seed"]);
    expect(offers.length, offers.join("\n")).toBeLessThanOrEqual(2);
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
  it("the adopted revision survives the reload, and nothing is uploaded (the file descends from B's cellar)", async () => {
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
    expect(localStorage.getItem("cave-pending-sync"), "nothing to send: B had nothing A lacks").toBeNull();
    const bFileBefore = autoFileOf("ipad1")!.name;
    await reloadIfAsked();               // remount + 8 s: launch check
    expect(localStorage.getItem("cave-cellar-rev")).toBe(backupRev(aFile.name));
    expect(localStorage.getItem("cave-pending-sync")).toBeNull();
    expect(autoFileOf("ipad1")!.name, "no upload across the reload").toBe(bFileBefore);
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

describe("was FAILING, fixed in build 45 (1b) and build 46 (3) — the merge echo", () => {
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

  // WAS: iPad ← A(Alpha); iPhone ← B(union); iPad ← A(union, again). A's
  // merge result had the same content as B's file but other local ids, so a
  // fresh revision was stamped and B was offered A's union: an echo. Fixed by
  // the lineage (build 46): B's merge records A's revision as an ANCESTOR, so
  // A finds its own revision in B's file, holds nothing B lacks, and uploads
  // nothing after its merge.
  it("3 divergence + merges: at most two offers (no echo)", async () => {
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
