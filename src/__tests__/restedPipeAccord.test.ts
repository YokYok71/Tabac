// The Home's suggested pipe: it has to VARY, and it has to make sense with
// tonight's tobacco.
//
// Reported from the app: « dans la pipe du jour à fumer en proposition c'est
// un peu toujours la même. Tu es sûr que tu fais une rotation ? Tu accordes
// aussi la pipe avec le style de tabac le cas échéant ? » — two questions, and
// measuring them gave two different answers.
//
// ROTATION was happening and was nonetheless useless. `suggestRestedPipe`
// rotated over `min(5, n)`, and a never-smoked pipe counted as INFINITE rest,
// so a handful of untouched pipes owned the top of the ranking permanently.
// MEASURED before changing anything, on twelve pipes smoked in turn over two
// months: 5 distinct pipes over 14 launches, and SEVEN never proposed once.
// The fix is a pool sized by how many pipes are actually RESTED
// (REST_SATURATION_DAYS) rather than by a flat five. Same fixture after: 9
// distinct, and the three left out are the ones smoked 1, 6 and 11 days ago,
// i.e. genuinely not rested yet.
//
// It shipped with a second half that turned out to do nothing — a clamp
// pinning Infinity rest down to the threshold. A probe stayed GREEN with the
// clamp deleted, and the layer absorbing it was the pool rule itself:
// `Infinity >= 14` exactly as `90 >= 14`, so the pool held the same pipes and
// the clamp only reordered a set the rotation traverses whole. Removed rather
// than kept "just in case" — see the constant. The cases below are written
// against the THRESHOLD, never against a clamped rank, which is why they
// survived its removal unchanged.
//
// THE ACCORD did not exist at all. There was only a NEGATIVE filter
// (`ghostExclude` — avoid ghosting tonight's tobacco); nothing ever said "this
// pipe suits this bowl". `preferIds` is that, and it is applied to the POOL,
// so rest stays a hard constraint and the family match only decides among
// pipes already rested enough. Note the deliberate consequence: when a single
// pipe accords, it IS returned every time — that is not the pinning bug this
// engine was fixed for twice, because the pin is to TONIGHT'S TOBACCO and the
// tobacco itself rotates.

import { describe, it, expect } from "vitest";
import {
  suggestRestedPipe, REST_SATURATION_DAYS, FEATURE_ROTATE_MS,
} from "../utils/suggest.ts";
import { pipeAccordsWithFamily } from "../utils/ghosting.ts";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 864e5).toISOString().slice(0, 10);

/** n active pipes, ids 1..n. */
const mkPipes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: "P" + (i + 1), status: "active", rating: i % 5 }));

/** One session per pipe, spaced `gap` days apart: pipe k rested k*gap+1 days. */
const mkSessions = (n: number, gap: number, tobaccoId: any = 1) =>
  Array.from({ length: n }, (_, k) => ({ id: 100 + k, pipeId: k + 1, tobaccoId, date: iso(k * gap + 1) }));

/** The sequence of picks over `launches` successive app opens. */
function sequence(pipes: any[], sessions: any[], launches: number, prefer?: any) {
  const out: string[] = [];
  for (let s = 1; s <= launches; s++) {
    const r = suggestRestedPipe(
      pipes, sessions, NOW, null, FEATURE_ROTATE_MS, NOW + s * FEATURE_ROTATE_MS, prefer ?? null,
    );
    out.push(r ? r.pipeId : "-");
  }
  return out;
}

describe("rest saturates", () => {
  it("a never-smoked pipe does not outrank a long-rested one", () => {
    // The heart of the first defect: these two must be interchangeable.
    // Pipe 1 rested 90 days, pipe 2 never smoked. With Infinity rest, pipe 2
    // won for ever. Both are past the threshold, so both are in the pool and
    // the rotation alternates between them.
    const pipes = mkPipes(2);
    const sessions = [{ id: 1, pipeId: 1, tobaccoId: 1, date: iso(90) }];
    expect(new Set(sequence(pipes, sessions, 6)).size).toBe(2);
  });

  it("an unrested pipe never joins the pool while a rested one exists", () => {
    // The threshold must not flatten everything — a pipe smoked yesterday is
    // NOT as rested as one untouched for a month, and must not be offered
    // while a rested one exists. This is the case that killed the first
    // implementation, which floored the pool at five unconditionally and so
    // offered BOTH pipes on a two-pipe collection.
    const pipes = mkPipes(2);
    const sessions = [
      { id: 1, pipeId: 1, tobaccoId: 1, date: iso(1) },
      { id: 2, pipeId: 2, tobaccoId: 1, date: iso(REST_SATURATION_DAYS + 5) },
    ];
    expect(new Set(sequence(pipes, sessions, 6))).toEqual(new Set(["2"]));
  });

  it("restDays reports the TRUE rest — the threshold ranks, it never rewrites", () => {
    // The threshold decides who is in the pool. Reporting 14 for a pipe
    // rested 90 days would be the app stating something false on screen.
    const r = suggestRestedPipe(mkPipes(1), [{ id: 1, pipeId: 1, tobaccoId: 1, date: iso(90) }], NOW);
    expect(r?.restDays).toBe(90);
  });
});

describe("the pool covers every rested pipe", () => {
  it("twelve pipes, most of them rested — the rotation reaches nine", () => {
    // The reported fixture. `gap: 5` → rest 1, 6, 11, 16, 21 … so pipes 4..12
    // are saturated and 1..3 are not. Nine is exactly the saturated count:
    // the pool is no longer a flat five.
    const pipes = mkPipes(12);
    const seq = sequence(pipes, mkSessions(12, 5), 14);
    expect(new Set(seq).size).toBe(9);
    // and the three it never offers are the three genuinely-unrested ones
    expect(new Set(seq).has("1")).toBe(false);
    expect(new Set(seq).has("2")).toBe(false);
    expect(new Set(seq).has("3")).toBe(false);
  });

  it("keeps a floor of five when nothing has saturated yet", () => {
    // A heavily-rotated collection: every pipe smoked within the fortnight, so
    // `saturated` is 0. Falling to a pool of 0 would return nothing at all;
    // the floor keeps offering the five most-rested, which there IS the answer.
    const pipes = mkPipes(10);
    const sessions = mkSessions(10, 1); // rest 1..10, all under the threshold
    expect(new Set(sequence(pipes, sessions, 10)).size).toBe(5);
  });

  it("never proposes a retired pipe, saturated or not", () => {
    const pipes = mkPipes(3).map((p) => (p.id === 3 ? { ...p, status: "finished" } : p));
    expect(new Set(sequence(pipes, [], 8)).has("3")).toBe(false);
  });
});

describe("the accord with tonight's family", () => {
  // Pipe 1 is dedicated to Virginia (4 of 5 sessions), pipe 2 to Latakia.
  // Both are long-rested so the accord decides, not the rest.
  const TOBS = [
    { id: 10, category: "Virginia" }, { id: 11, category: "Latakia" },
  ];
  const DEDICATED = [
    ...[0, 1, 2, 3].map((k) => ({ id: 200 + k, pipeId: 1, tobaccoId: 10, date: iso(40 + k) })),
    { id: 209, pipeId: 1, tobaccoId: 11, date: iso(50) },
    ...[0, 1, 2, 3].map((k) => ({ id: 300 + k, pipeId: 2, tobaccoId: 11, date: iso(40 + k) })),
  ];

  it("recognises a dedication, and only a real one", () => {
    expect(pipeAccordsWithFamily(1, "Virginia", DEDICATED, TOBS)).toBe(true);
    expect(pipeAccordsWithFamily(2, "Latakia", DEDICATED, TOBS)).toBe(true);
    expect(pipeAccordsWithFamily(1, "Latakia", DEDICATED, TOBS)).toBe(false);
    // Below MIN_TOTAL: one session is not a pattern.
    expect(pipeAccordsWithFamily(9, "Virginia",
      [{ id: 1, pipeId: 9, tobaccoId: 10, date: iso(5) }], TOBS)).toBe(false);
    // An empty category must never match a pipe with no history.
    expect(pipeAccordsWithFamily(1, "", DEDICATED, TOBS)).toBe(false);
  });

  it("prefers the accorded pipe and SAYS it did", () => {
    const r = suggestRestedPipe(mkPipes(2), DEDICATED, NOW, null, FEATURE_ROTATE_MS, NOW, ["1"]);
    expect(r?.pipeId).toBe("1");
    expect(r?.matched).toBe(true);
  });

  it("reports matched:false when no accord drove the pick", () => {
    // `matched` is rendered on the Home. Claiming an accord that did not
    // happen would be the app explaining itself with a reason it did not use.
    const r = suggestRestedPipe(mkPipes(2), DEDICATED, NOW, null, FEATURE_ROTATE_MS, NOW, null);
    expect(r?.matched).toBe(false);
    const none = suggestRestedPipe(mkPipes(2), DEDICATED, NOW, null, FEATURE_ROTATE_MS, NOW, ["77"]);
    expect(none?.matched).toBe(false);
  });

  it("REST WINS over the accord — an accorded pipe smoked yesterday is not offered", () => {
    // The load-bearing rule. `preferIds` applies to the POOL, so it can only
    // choose among pipes already rested enough; preferring an unrested pipe
    // would contradict the single thing this function promises.
    const pipes = mkPipes(8);
    const sessions = [
      { id: 1, pipeId: 1, tobaccoId: 10, date: iso(0) }, // accorded, smoked today
      ...mkSessions(8, 5).slice(1),
    ];
    const r = suggestRestedPipe(pipes, sessions, NOW, null, FEATURE_ROTATE_MS, NOW, ["1"]);
    expect(r?.pipeId).not.toBe("1");
    expect(r?.matched).toBe(false);
  });

  it("a single accorded pipe is returned every time — wanted, not a regression", () => {
    // Recorded because it LOOKS like the pinning bug this engine was fixed for
    // twice. It is not: the pin is to tonight's tobacco, which rotates, so the
    // pipe follows it. Collapsing to one is how an accord is supposed to feel.
    const seq = sequence(mkPipes(6), mkSessions(6, 20), 5, ["4"]);
    expect(new Set(seq)).toEqual(new Set(["4"]));
  });

  it("an accord that excludes everything is ignored rather than obeyed", () => {
    // Same defence as excludeIds: a suggestion beats none.
    const seq = sequence(mkPipes(4), mkSessions(4, 20), 4, ["999"]);
    expect(seq.every((x) => x !== "-")).toBe(true);
  });
});

describe("the accord is wired and visible", () => {
  it("HomeViewV2 computes preferIds and passes them", () => {
    const src = require("node:fs").readFileSync("src/views/curator/HomeViewV2.tsx", "utf8");
    expect(src).toMatch(/pipeAccordsWithFamily\(/);
    // The pool argument must actually REACH suggestRestedPipe — a preferIds
    // set computed and never handed over is the "button does nothing" class.
    expect(src).toMatch(/suggestRestedPipe\([^;]*accordPrefer\)/);
  });

  it("the Home renders the accord word, in every language", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync("src/views/curator/HomeViewV2.tsx", "utf8");
    expect(src).toMatch(/restedPipe\.matched/);
    expect(src).toMatch(/home_pair_accord/);
    for (const code of ["fr", "en", "es", "de", "it", "pt"]) {
      expect(fs.readFileSync(`src/i18n/${code}.ts`, "utf8"), code).toMatch(/home_pair_accord:"/);
    }
  });
});
