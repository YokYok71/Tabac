/**
 * MULTI-DEVICE CONVERGENCE — a simulation, not a re-implementation.
 *
 * N devices share one cellar through backups. Each performs a stream of
 * ordinary operations (add a tobacco, add a lot, log a bowl, delete, empty the
 * trash, restore it, heal a duplicate), exports, and another device merges that
 * export. fast-check generates the schedules and shrinks any counterexample.
 *
 * WHAT DRIVES THE OPS IS THE REAL ENGINE. Every mutation goes through the real
 * `useTobaccoStore` / `useSessionStore` / `useTrashOps` (mounted with
 * `renderHook`, because that is the only way those paths are reachable), every
 * merge goes through the real `useImportConfirm.stageImport(…, {autoApply:
 * "merge"})`, and every device's cellar passes through the real `migrateData`.
 * Nothing here re-states a merge rule: a simulation that re-implements the
 * merge tests the simulation (CLAUDE.md records exactly that failure — "it
 * re-implemented the hook's rule inline instead of driving the hook").
 *
 * A FIDELITY CHOICE WAS MADE, MEASURED, AND REVERSED — and the reversal is the
 * most useful thing in this file, so it is recorded rather than deleted.
 * `monotonicId()` keeps a MODULE-level counter, so two devices inside ONE test
 * process can never mint the same lot id, while two real devices each seed from
 * their own `Date.now()`. The first version therefore reset that counter at every
 * device switch, on the stated grounds that "without the reset the whole
 * `lot-id-unique-global` class is unreachable from here". That produced, over 120
 * schedules, 33 post-merge invariant failures, 24 post-round-trip ones, 86
 * `lot-id-unique-global` violations and 2 `lot-balance-overflow`. Every one was
 * MANUFACTURED. A diagnostic that printed the colliding id's holders showed the
 * merge's `monotonicId()` re-stamp landing on an id a LOCAL lot already carried —
 * possible only because the reset restarts the clock inside a single test
 * millisecond. Remove the reset and the same 120 schedules yield ZERO violations
 * of any rule. In production the counter is never reset and is bumped past every
 * id this device mints, so the re-stamp cannot collide with the cellar it is
 * being written into.
 *   THE LESSON, which is general: a harness knob that makes a rare class
 * "reachable" can instead make it CERTAIN, and then the failures it produces are
 * measurements of the knob. Reversing it is what let the real findings show.
 *
 * WHAT IS *NOT* SIMULATED, stated so nobody reads more into a green run:
 * photos (`_imageData` never travels — the blobs live in IndexedDB and the
 * merge's photo path is covered by `useImportConfirm.test.ts`), pipes /
 * accessories / wishlist mutations (the tobacco+lot+session triangle is where
 * the balance arithmetic lives), the REPLACE path, the cloud transport, and —
 * following the reversal above — two devices minting the same lot id from a
 * wall-clock collision (a same-millisecond event; `lot-id-unique-global` at
 * save() and `lotIdGlobalRepair.test.ts` are what cover it).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fc from "fast-check";
import { renderHook, act } from "@testing-library/react";

// jsdom has no IndexedDB and the merge's photo write is `.catch`-guarded, so an
// unmocked imgCache swallows silently. Nothing here carries `_imageData`, but
// the module must still resolve — and `imgMap` must be the REAL one, or the
// photo map would silently regain a prototype (see forgedImageUrl.test.ts).
vi.mock("../utils/imgCache.ts", () => ({
  imgCache: {
    put: () => Promise.resolve(true),
    get: () => Promise.resolve(null),
    open: () => Promise.resolve(null),
    clear: () => Promise.resolve(),
  },
  gcOrphans: () => Promise.resolve(0),
  isSafeExternalUrl: () => false,
  safeBgUrl: () => "",
  isLocalPhotoRef: () => false,
  safeImgSrc: () => "",
  imgMap: (...sources: any[]) => Object.assign(Object.create(null), ...sources),
}));

import { useTobaccoStore } from "../hooks/useTobaccoStore.ts";
import { useSessionStore } from "../hooks/useSessionStore.ts";
import { useTrashOps } from "../hooks/useTrashOps.ts";
import { useImportConfirm, type MergeSummary } from "../hooks/useImportConfirm.ts";
import { migrateData, _resetMonotonicIdForTests } from "../utils.ts";
import { checkAllInvariants } from "../utils/lotInvariants.ts";
import { mergeDuplicates, findDuplicateGroups } from "../utils/duplicates.ts";

// ─────────────────────────────────────────────────────────────────────────
// Invented vocabulary. Deliberately SMALL so brand|name collisions across
// devices are the common case rather than a corner — that is the state the
// ambiguity guard and the identity-conflict counter exist for.
// ─────────────────────────────────────────────────────────────────────────
const BRANDS = ["Brackwater", "Halvorsen", "Marlow & Finch", "Vondel"];
const NAMES = ["Duskfall", "Adagio Green", "Nightmoor", "Tallow Row"];

const noop = () => {};

function emptyCellar(): any {
  return migrateData({
    tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [],
    nxT: 1, nxP: 1, nxA: 1, nxJ: 1, nxW: 1,
  });
}

/** A JSON round-trip — what a backup actually is. Nothing may survive it that
 *  would not survive a file. */
function backupOf(data: any): any {
  return JSON.parse(JSON.stringify(data));
}

// ─────────────────────────────────────────────────────────────────────────
// The device driver. One mount per device; `box.data` is the committed cellar
// and `save` is the only writer, exactly as App.tsx wires it. The stores read
// the FRESHEST cellar through `latestData` (the `latestDataRef` contract), and
// `useTrashOps` / `useImportConfirm` close over the `data` PROP — so the hook
// is re-rendered after every op, which is what App gets for free from setState.
// ─────────────────────────────────────────────────────────────────────────
interface Device {
  name: string;
  box: { data: any };
  rerender: () => void;
  api: () => any;
  summaries: MergeSummary[];
}

function makeDevice(name: string, initial: any): Device {
  const box = { data: migrateData(backupOf(initial)) };
  const save = (d: any) => { box.data = d; };
  const latestData = () => box.data;
  const fromWishRef = { current: null } as any;

  const h = renderHook(() => ({
    tob: useTobaccoStore({ data: box.data, save, latestData, nav: noop, setSearch: noop, fromWishRef }),
    sess: useSessionStore({ data: box.data, save, latestData, nav: noop, weightUnit: "g" }),
    trash: useTrashOps({ data: box.data, save, weightUnit: "g" }),
    imp: useImportConfirm({
      data: box.data, save, migrateData,
      saveApiKey: noop, setImgLocal: noop, setImportModal: noop, nav: noop,
    } as any),
  }));

  return {
    name,
    box,
    rerender: () => { act(() => { h.rerender(); }); },
    api: () => h.result.current,
    summaries: [],
  };
}

/** Run one mutation and refresh the hook closures. */
function run(dev: Device, fn: (api: any) => void): void {
  act(() => { fn(dev.api()); });
  dev.rerender();
}

const live = (arr: any[] | undefined) => (arr || []).filter((r: any) => r && !r.deletedAt);

// ─────────────────────────────────────────────────────────────────────────
// Operations. Indices are taken modulo the live collection at apply time, so
// a generated schedule is always meaningful whatever the cellar looks like.
// ─────────────────────────────────────────────────────────────────────────
type Op =
  | { k: "addTob"; b: number; n: number }
  | { k: "addLot"; t: number; w: number; jar: boolean }
  | { k: "session"; t: number; w: number }
  | { k: "delSession"; i: number }
  | { k: "delTob"; i: number }
  | { k: "delLot"; t: number; l: number }
  | { k: "openLot"; t: number; l: number }
  | { k: "emptyTrash" }
  | { k: "restoreAll" }
  | { k: "healDup" };

const pick = <T,>(arr: T[], i: number): T | null =>
  arr.length ? arr[Math.abs(i) % arr.length]! : null;

function applyOp(dev: Device, op: Op): void {
  const d = dev.box.data;
  switch (op.k) {
    case "addTob": {
      const brand = BRANDS[Math.abs(op.b) % BRANDS.length]!;
      const name = NAMES[Math.abs(op.n) % NAMES.length]!;
      run(dev, a => a.tob.addTobacco({ brand, name, lots: [] }));
      return;
    }
    case "addLot": {
      const t = pick(live(d.tobaccos), op.t);
      if (!t) return;
      run(dev, a => a.tob.addLotToTobacco(t.id, {
        status: op.jar ? "jar" : "cellar",
        weightG: String(op.w),
        weightInitial: String(op.w),
        price: String(op.w),
      }));
      return;
    }
    case "session": {
      // Only a JAR lot with a positive balance can back a session —
      // `_persistSession` refuses a cellar lot outright.
      const cands: Array<{ tid: any; lid: any }> = [];
      live(d.tobaccos).forEach((t: any) => {
        live(t.lots).forEach((l: any) => {
          if (l.status === "jar" && Number(l.weightG) > 0) cands.push({ tid: t.id, lid: String(l.id) });
        });
      });
      const c = pick(cands, op.t);
      if (!c) return;
      run(dev, a => a.sess.addSessionFromTasting({
        date: "2026-03-01", time: "18:00", tobaccoId: c.tid, pipeId: "",
        duration: "30", rating: 0, notes: "", weightG: String(op.w), lotId: c.lid,
      }, { navigate: false }));
      return;
    }
    case "delSession": {
      const s = pick(live(d.sessions), op.i);
      if (!s) return;
      run(dev, a => a.sess.deleteSession(s.id));
      return;
    }
    case "delTob": {
      const t = pick(live(d.tobaccos), op.i);
      if (!t) return;
      run(dev, a => a.tob.deleteTobacco(t.id));
      return;
    }
    case "delLot": {
      const t = pick(live(d.tobaccos), op.t);
      if (!t) return;
      const l = pick(live(t.lots), op.l);
      if (!l) return;
      run(dev, a => a.tob.removeLot(t.id, l.id));
      return;
    }
    case "openLot": {
      const t = pick(live(d.tobaccos), op.t);
      if (!t) return;
      const l = pick(live(t.lots).filter((x: any) => x.status === "cellar"), op.l);
      if (!l) return;
      run(dev, a => a.tob.changeLotStatus(t.id, l.id, "jar"));
      return;
    }
    case "emptyTrash":
      run(dev, a => a.trash.emptyTrash());
      return;
    case "restoreAll":
      run(dev, a => a.trash.restoreAllFromTrash());
      return;
    case "healDup": {
      // The app's own duplicate-healing tool. Pure, so it is composed rather
      // than driven — the caller owns persistence, exactly as SettingsModal does.
      const groups = findDuplicateGroups(d, "tobacco");
      const g = groups[0];
      if (!g || g.members.length < 2) return;
      const keep = g.members[0]!.id;
      const drop = g.members.slice(1).map(m => m.id);
      const res = mergeDuplicates(d, "tobacco", keep, drop);
      dev.box.data = res.data;
      dev.rerender();
      return;
    }
  }
}

/** Merge `source`'s backup INTO `target`, through the real engine. */
function mergeInto(target: Device, source: Device): MergeSummary {
  const payload = backupOf(source.box.data);
  let summary: MergeSummary | null = null;
  act(() => {
    target.api().imp.stageImport(payload, "file", {
      autoApply: "merge",
      onMerged: (s: MergeSummary) => { summary = s; },
    });
  });
  target.rerender();
  // A merge that matched nothing and added nothing legitimately reports no
  // summary; normalise so callers never branch on null.
  const s: MergeSummary = summary || {
    tobaccosAdded: 0, lotsAppended: 0, blendsToppedUp: 0, sessionsUpdated: 0,
    entitiesUpdated: 0, identityConflicts: 0, maintenanceAppended: 0,
    photosAppended: 0, tobaccosMatched: 0, lotsTrashedSkipped: 0, trashedSkipped: 0,
  };
  target.summaries.push(s);
  return s;
}

beforeEach(() => { _resetMonotonicIdForTests(); });

// ─────────────────────────────────────────────────────────────────────────
// Arbitraries
// ─────────────────────────────────────────────────────────────────────────
// Weights are not decoration: a schedule that is mostly deletes never builds a
// cellar worth merging, and one that never deletes never reaches the trash
// rules. Creation is weighted up so an average schedule holds real data.
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { arbitrary: fc.record({ k: fc.constant("addTob" as const), b: fc.nat(7), n: fc.nat(7) }), weight: 5 },
  { arbitrary: fc.record({ k: fc.constant("addLot" as const), t: fc.nat(7), w: fc.integer({ min: 10, max: 100 }), jar: fc.boolean() }), weight: 6 },
  { arbitrary: fc.record({ k: fc.constant("session" as const), t: fc.nat(7), w: fc.integer({ min: 1, max: 40 }).map(x => x / 10) }), weight: 6 },
  { arbitrary: fc.record({ k: fc.constant("delSession" as const), i: fc.nat(7) }), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant("delTob" as const), i: fc.nat(7) }), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant("delLot" as const), t: fc.nat(7), l: fc.nat(7) }), weight: 2 },
  { arbitrary: fc.record({ k: fc.constant("openLot" as const), t: fc.nat(7), l: fc.nat(7) }), weight: 3 },
  { arbitrary: fc.constant({ k: "emptyTrash" as const }), weight: 1 },
  { arbitrary: fc.constant({ k: "restoreAll" as const }), weight: 1 },
  { arbitrary: fc.constant({ k: "healDup" as const }), weight: 1 },
);

describe("multi-device convergence — the simulation", () => {
  it("is wired to the REAL engine (non-vacuity control)", () => {
    // A property that never actually mutates or merges anything would satisfy
    // every assertion below. This pins that the harness moves data.
    const a = makeDevice("A", emptyCellar());
    applyOp(a, { k: "addTob", b: 0, n: 0 });
    applyOp(a, { k: "addLot", t: 0, w: 50, jar: true });
    applyOp(a, { k: "session", t: 0, w: 2.5 });
    expect(live(a.box.data.tobaccos)).toHaveLength(1);
    expect(live(a.box.data.tobaccos)[0].lots.length).toBeGreaterThanOrEqual(2);
    expect(live(a.box.data.sessions)).toHaveLength(1);
    expect(checkAllInvariants(a.box.data)).toEqual([]);

    const b = makeDevice("B", emptyCellar());
    const s = mergeInto(b, a);
    expect(s.tobaccosAdded).toBe(1);
    expect(live(b.box.data.tobaccos)).toHaveLength(1);
    expect(live(b.box.data.sessions)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The schedule: one shared origin, then two devices diverging in parallel.
// ─────────────────────────────────────────────────────────────────────────
interface Scenario { seed: Op[]; a: Op[]; b: Op[]; }

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  seed: fc.array(opArb, { minLength: 2, maxLength: 6 }),
  a: fc.array(opArb, { minLength: 1, maxLength: 8 }),
  b: fc.array(opArb, { minLength: 1, maxLength: 8 }),
});

function playScenario(sc: Scenario) {
  const origin = makeDevice("origin", emptyCellar());
  sc.seed.forEach(op => applyOp(origin, op));

  const A = makeDevice("A", origin.box.data);
  const B = makeDevice("B", origin.box.data);

  const n = Math.max(sc.a.length, sc.b.length);
  for (let i = 0; i < n; i++) {
    if (i < sc.a.length) applyOp(A, sc.a[i]!);
    if (i < sc.b.length) applyOp(B, sc.b[i]!);
  }
  return { origin, A, B };
}

// ─────────────────────────────────────────────────────────────────────────
// Observation helpers
//
// Every one of these keys on `uid`, never on the per-device numeric `id`:
// two devices mint DIFFERENT ids for the same row by construction, so an
// id-keyed observation would report a defect on every single schedule.
// ─────────────────────────────────────────────────────────────────────────
type UidState = "live" | "trashed";

/**
 * A uid can legitimately appear TWICE — `mergeDuplicates` carries a lot's uid
 * onto the kept row and soft-deletes the source copy, and `lot-uid-unique`
 * skips trashed lots precisely so that state is legal. A LIVE occurrence
 * therefore wins: "is this tin in the cellar?" is the question being asked.
 */
function tobUidStates(data: any): Map<string, UidState> {
  const m = new Map<string, UidState>();
  (data.tobaccos || []).forEach((t: any) => {
    if (!t || !t.uid) return;
    if (m.get(t.uid) === "live") return;
    m.set(t.uid, t.deletedAt ? "trashed" : "live");
  });
  return m;
}

function lotUidStates(data: any): Map<string, { state: UidState; parent: string }> {
  const m = new Map<string, { state: UidState; parent: string }>();
  (data.tobaccos || []).forEach((t: any) => {
    (t.lots || []).forEach((l: any) => {
      if (!l || !l.uid) return;
      const prev = m.get(l.uid);
      if (prev && prev.state === "live") return;
      // A lot under a trashed row is hidden from the cellar (invariant #23),
      // so it counts as trashed whatever its own `deletedAt` says.
      m.set(l.uid, {
        state: (l.deletedAt || t.deletedAt) ? "trashed" : "live",
        parent: String(t.uid || ""),
      });
    });
  });
  return m;
}

/**
 * Rows LIVE on `source` that are nowhere on `target` after a merge, minus the
 * absences a DOCUMENTED rule accounts for. An empty result is the no-silent-loss
 * property; a non-empty one names the uid so the counterexample is readable.
 *
 * The two documented rules that legitimately drop a row:
 *  - the same uid sits in the target's TRASH (`trashedSkipped` /
 *    `lotsTrashedSkipped`) — the entity is already in the cellar, one tap away;
 *  - the lot's PARENT row is in the target's trash, so the whole row was
 *    skipped and its lots never travelled with it.
 */
function unexplained(target: any, source: any): string[] {
  const tTob = tobUidStates(target);
  const sTob = tobUidStates(source);
  const tLot = lotUidStates(target);
  const sLot = lotUidStates(source);
  const out: string[] = [];

  sTob.forEach((state, uid) => {
    if (state !== "live") return;
    if (tTob.has(uid)) return;
    out.push("tobacco:" + uid);
  });

  sLot.forEach((info, uid) => {
    if (info.state !== "live") return;
    if (tLot.has(uid)) return;
    if (info.parent && tTob.get(info.parent) === "trashed") return;
    out.push("lot:" + uid);
  });

  return out;
}

/** How many LIVE rows the cellar holds under each `brand|name` — the merge key. */
function nameCounts(data: any): Map<string, number> {
  const m = new Map<string, number>();
  live(data.tobaccos).forEach((t: any) => {
    const k = String(t.brand || "") + "|" + String(t.name || "");
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
}

/**
 * A REPLAY-STABLE description of a cellar.
 *
 * The first version of the order-independence property compared uid SETS and
 * reported 102 divergences out of 120 — every one an artefact, because
 * `playScenario` mints a fresh `crypto.randomUUID` on each replay, so the two
 * orders were being compared across two unrelated runs. What survives a replay
 * is the SHAPE: which blends are held, how many live lots, how many sessions.
 */
function shapeKey(data: any): string {
  const names = live(data.tobaccos)
    .map((t: any) => String(t.brand || "") + "|" + String(t.name || ""))
    .sort();
  let lots = 0;
  live(data.tobaccos).forEach((t: any) => { lots += live(t.lots).length; });
  return JSON.stringify({ names, lots, sessions: live(data.sessions).length });
}

/**
 * The lot balance, measured in BOTH directions.
 *
 * `lot-balance-overflow` is deliberately one-sided (it only fires when the
 * sessions exceed the drop), so the UNDERFLOW half — grams that left the lot
 * with no session to account for them — is a documented blind spot of the
 * shipped invariant. Keyed on `tobaccoId|lotId`, the same pair
 * `checkLotInvariants` uses, because a lot id alone is not an identity.
 */
const BALANCE_TOL = 0.5;
function balanceGaps(data: any): string[] {
  const smoked = new Map<string, number>();
  live(data.sessions).forEach((s: any) => {
    if (!s.lotId) return;
    const k = String(s.tobaccoId) + "|" + String(s.lotId);
    smoked.set(k, (smoked.get(k) || 0) + (Number(s.weightG) || 0));
  });
  const out: string[] = [];
  live(data.tobaccos).forEach((t: any) => {
    live(t.lots).forEach((l: any) => {
      const wi = String(l.weightInitial ?? "").trim();
      const wg = String(l.weightG ?? "").trim();
      // An empty weight is an ABSENCE of data, not a zero — there is no
      // balance to check (the rule `checkLotInvariants` already applies).
      if (wi === "" || wg === "") return;
      const drop = Number(wi) - Number(wg);
      const sum = smoked.get(String(t.id) + "|" + String(l.id)) || 0;
      if (Math.abs(drop - sum) > BALANCE_TOL) {
        out.push(`${t.id}/${l.id}: drop=${drop} sessions=${sum}`);
      }
    });
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Properties
//
// numRuns is 120 and the seed is fixed. 120 schedules over ~20 operations
// reach every rule this file names at least twice (the floors in the
// designed-outcome case are what prove that), and the whole file runs in a
// couple of seconds — a property test that adds five minutes is a tax on
// every commit.
// ─────────────────────────────────────────────────────────────────────────
const RUNS = 120;
const SEED = 424242;

describe("multi-device convergence — properties", () => {
  it("leaves every invariant satisfied, after a merge and after the round trip", () => {
    let merges = 0;
    let landed = 0;
    fc.assert(fc.property(scenarioArb, sc => {
      const { A, B } = playScenario(sc);
      mergeInto(A, B);
      merges++;
      expect(checkAllInvariants(A.box.data)).toEqual([]);
      mergeInto(B, A);
      merges++;
      expect(checkAllInvariants(B.box.data)).toEqual([]);
      if (live(A.box.data.tobaccos).length > 0) landed++;
    }), { numRuns: RUNS, seed: SEED });
    // Non-vacuity: both merges really ran on every schedule, and the schedules
    // are not all empty cellars (which would satisfy any invariant).
    expect(merges).toBe(RUNS * 2);
    expect(landed).toBeGreaterThan(0);
  });

  it("loses no row without a documented reason (no silent loss)", () => {
    let checked = 0;
    fc.assert(fc.property(scenarioArb, sc => {
      const { A, B } = playScenario(sc);
      mergeInto(A, B);
      checked += tobUidStates(B.box.data).size + lotUidStates(B.box.data).size;
      expect(unexplained(A.box.data, B.box.data)).toEqual([]);
    }), { numRuns: RUNS, seed: SEED });
    // Non-vacuity: an empty source would satisfy the property trivially.
    expect(checked).toBeGreaterThan(RUNS);
  });

  it("never duplicates a row without COUNTING it (no silent duplication)", () => {
    let refusals = 0;
    fc.assert(fc.property(scenarioArb, sc => {
      const { A, B } = playScenario(sc);
      const before = nameCounts(A.box.data);
      const s = mergeInto(A, B);
      const after = nameCounts(A.box.data);
      // What must be reported is a row the MERGE added under a brand|name the
      // target ALREADY held live — the documented refusal to collapse two rows
      // whose stable identities differ.
      //
      // The first version of this compared SETS of names, and a shrunk
      // counterexample showed why that is the wrong question: a cellar that
      // already held two same-name rows before the merge reads as a duplicate
      // the merge created. Counts, not membership.
      let grew = false;
      after.forEach((n, k) => { if (n > (before.get(k) || 0) && (before.get(k) || 0) > 0) grew = true; });
      if (grew) {
        refusals++;
        expect(s.identityConflicts).toBeGreaterThan(0);
      }
    }), { numRuns: RUNS, seed: SEED });
    // Non-vacuity: if the refusal never fired, the assertion never ran.
    expect(refusals).toBeGreaterThan(0);
  });

  it("is idempotent — merging the same backup twice changes nothing", () => {
    let secondMerges = 0;
    fc.assert(fc.property(scenarioArb, sc => {
      const { A, B } = playScenario(sc);
      mergeInto(A, B);
      const after1 = JSON.stringify(A.box.data);
      const s2 = mergeInto(A, B);
      secondMerges++;
      expect(JSON.stringify(A.box.data)).toBe(after1);
      expect(s2.tobaccosAdded).toBe(0);
      expect(s2.lotsAppended).toBe(0);
    }), { numRuns: RUNS, seed: SEED });
    expect(secondMerges).toBe(RUNS);
  });

  it("converges to the same cellar whichever direction merges first", () => {
    let compared = 0;
    fc.assert(fc.property(scenarioArb, sc => {
      const one = playScenario(sc);
      mergeInto(one.A, one.B);
      mergeInto(one.B, one.A);

      const two = playScenario(sc);
      mergeInto(two.B, two.A);
      mergeInto(two.A, two.B);

      compared++;
      expect(shapeKey(one.A.box.data)).toBe(shapeKey(two.A.box.data));
      expect(shapeKey(one.B.box.data)).toBe(shapeKey(two.B.box.data));
    }), { numRuns: RUNS, seed: SEED });
    expect(compared).toBe(RUNS);
  });

  it("keeps every lot balance exact in BOTH directions", () => {
    let lotsSeen = 0;
    fc.assert(fc.property(scenarioArb, sc => {
      const { A, B } = playScenario(sc);
      mergeInto(A, B);
      mergeInto(B, A);
      live(A.box.data.tobaccos).forEach((t: any) => { lotsSeen += live(t.lots).length; });
      expect(balanceGaps(A.box.data)).toEqual([]);
      expect(balanceGaps(B.box.data)).toEqual([]);
    }), { numRuns: RUNS, seed: SEED });
    // Non-vacuity: a cellar with no lots has no balance to violate.
    expect(lotsSeen).toBeGreaterThan(RUNS);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The DESIGNED outcomes.
//
// Each of these is a deliberate refusal, argued at length in CLAUDE.md and NOT
// a defect. What is asserted here is only that the schedules REACH them and
// that the engine REPORTS them — a refusal the user is never told about is the
// half that was ever wrong.
// ─────────────────────────────────────────────────────────────────────────
describe("multi-device convergence — designed outcomes are reached and reported", () => {
  it("reaches every documented refusal across the schedules, and counts each", () => {
    const tally = {
      identityConflicts: 0,
      trashedSkipped: 0,
      lotsTrashedSkipped: 0,
      sessionsDetached: 0,
    };
    fc.assert(fc.property(scenarioArb, sc => {
      const { A, B } = playScenario(sc);
      const s = mergeInto(A, B);
      if (s.identityConflicts > 0) tally.identityConflicts++;
      if (s.trashedSkipped > 0) tally.trashedSkipped++;
      if (s.lotsTrashedSkipped > 0) tally.lotsTrashedSkipped++;
      if ((s.sessionsDetached || 0) > 0) tally.sessionsDetached++;
    }), { numRuns: RUNS, seed: SEED });

    // MEASURED at RUNS=120 / seed 424242, first-direction merges only — the
    // number of SCHEDULES that reached each refusal at least once:
    //   identityConflicts 8 · trashedSkipped 15 · lotsTrashedSkipped 3 ·
    //   sessionsDetached 2.
    // Recorded so the next reader can tell "the schedules stopped reaching this"
    // from "the engine stopped counting it" without re-deriving both.
    //
    // Floors of 1, not the measured figures: the exact counts move with any
    // change to the arbitraries' weights, and a pinned number would then be
    // "fixed" by re-measuring rather than by thinking. What must never happen
    // is a schedule set that reaches NONE of them and reports a clean run.
    expect(tally.identityConflicts).toBeGreaterThan(0);
    expect(tally.trashedSkipped).toBeGreaterThan(0);
    expect(tally.lotsTrashedSkipped).toBeGreaterThan(0);
    expect(tally.sessionsDetached).toBeGreaterThan(0);
  });

  it("reports the trashed-row skip that costs the row its lots", () => {
    // The minimal shape behind the `lot:` explanations in `unexplained`.
    const a = makeDevice("A", emptyCellar());
    applyOp(a, { k: "addTob", b: 0, n: 0 });
    applyOp(a, { k: "addLot", t: 0, w: 50, jar: true });

    const b = makeDevice("B", a.box.data);
    // B adds a second tin; A deletes the whole row.
    applyOp(b, { k: "addLot", t: 0, w: 30, jar: true });
    applyOp(a, { k: "delTob", i: 0 });

    const s = mergeInto(a, b);
    // Nothing is resurrected — the deletion may be a month old and deliberate.
    expect(live(a.box.data.tobaccos)).toHaveLength(0);
    // …and it is COUNTED, because silence here reads as "my backup did not
    // restore my tobacco" while the remedy is one tap away in the trash.
    expect(s.trashedSkipped).toBeGreaterThan(0);
    expect(s.tobaccosAdded).toBe(0);
    // The lots that never travelled are exactly the ones `unexplained` forgives.
    expect(unexplained(a.box.data, b.box.data)).toEqual([]);
  });

  it("reports the same-name refusal that adds a duplicate", () => {
    // Two devices that migrated a pre-uid cellar INDEPENDENTLY mint different
    // uids for the same row, so the merge cannot tell "one row that diverged"
    // from "two different tins" and refuses to collapse them.
    const a = makeDevice("A", emptyCellar());
    applyOp(a, { k: "addTob", b: 0, n: 0 });
    const b = makeDevice("B", emptyCellar());
    applyOp(b, { k: "addTob", b: 0, n: 0 });   // same brand|name, fresh uid

    const s = mergeInto(a, b);
    expect(live(a.box.data.tobaccos)).toHaveLength(2);
    expect(s.identityConflicts).toBeGreaterThan(0);
    expect(checkAllInvariants(a.box.data)).toEqual([]);
  });
});

