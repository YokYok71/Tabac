// The cleaning TIME has to survive a backup round-trip — and an old cellar
// full of untimed sessions has to keep working.
//
// Asked before this was written, and it had NOT been checked: the engine and
// migrateData were tested in isolation, the RESTORE path was not. That is the
// wiring, which is what rots — a field the engine reads correctly is worth
// nothing if the door it comes through drops it.
//
// Three doors, and they behave differently:
//   - REPLACE restore / JSON import → migrateData over the whole blob
//   - MERGE                          → maintenance appended per pipe
//   - CSV                            → maintenance is not in it at all
//
// The last one needs no test; the first two do.

import { describe, it, expect } from "vitest";
import { migrateData } from "../utils.ts";
import { maintMergeKey } from "../hooks/useImportConfirm.ts";
import { computePipeMaintenanceReminders, pipeSessionsSinceMaint } from "../utils/pipeMaint.ts";

const DAY = "2026-08-21";

/** A cellar shaped like a real export: an old pipe whose sessions predate the
 *  `time` field entirely, and a cleaning logged today WITH a time. */
function cellar() {
  return {
    tobaccos: [], wishlist: [], accessories: [],
    pipes: [{
      id: 1, uid: "p-1", brand: "Luigi Viprati", name: "Bent Billiard", status: "active",
      maintenance: [
        { id: 1, uid: "m-old", date: "2026-06-01", kind: "full", tasks: ["ream"], notes: "" },
        { id: 2, uid: "m-new", date: DAY, time: "14:00", kind: "full", tasks: ["swab"], notes: "" },
      ],
    }],
    // Deliberately NO `time` on the older bowls — the state of every session
    // logged before v1.3 — and one timed bowl after today's cleaning.
    sessions: [
      { id: 1, uid: "s-1", pipeId: 1, tobaccoId: 1, date: "2026-05-02", duration: "40", weightG: "0", lotId: "" },
      { id: 2, uid: "s-2", pipeId: 1, tobaccoId: 1, date: "2026-07-11", duration: "40", weightG: "0", lotId: "" },
      { id: 3, uid: "s-3", pipeId: 1, tobaccoId: 1, date: DAY, time: "17:30", duration: "40", weightG: "0", lotId: "" },
    ],
    nxT: 1, nxP: 2, nxA: 1, nxJ: 4, nxW: 1,
  };
}

/** What a JSON backup actually is: the blob serialised and read back. */
const roundTrip = (d: any) => migrateData(JSON.parse(JSON.stringify(d)));

describe("a REPLACE restore keeps the cleaning time", () => {
  it("the time survives serialisation and migrateData", () => {
    const out: any = roundTrip(cellar());
    const m = out.pipes[0].maintenance;
    expect(m.find((x: any) => x.uid === "m-new").time).toBe("14:00");
    // …and the untouched legacy entry still has no time, rather than acquiring
    // an invented one.
    expect(m.find((x: any) => x.uid === "m-old").time).toBeUndefined();
  });

  it("the restored cellar still reports the pipe as due", () => {
    // The end-to-end point: restore this backup and the bowl smoked at 17:30,
    // after the 14:00 cleaning, must still be counted. This is the case the
    // user reported and the one a restore must not quietly undo.
    const out: any = roundTrip(cellar());
    expect(pipeSessionsSinceMaint(out.pipes[0], out.sessions, DAY).sessionsSince).toBe(1);
    expect(computePipeMaintenanceReminders(out.pipes, out.sessions, 1, 0, DAY)).toHaveLength(1);
  });

  it("sessions with NO time are not broken by the moment comparison", () => {
    // The old bowls carry no `time` at all. They must still be countable —
    // they simply read as noon — and in particular the two that predate the
    // cleaning must NOT resurface as "since".
    const d: any = cellar();
    d.pipes[0].maintenance = [d.pipes[0].maintenance[1]];   // only today's cleaning
    const out: any = roundTrip(d);
    const r = pipeSessionsSinceMaint(out.pipes[0], out.sessions, DAY);
    expect(r.sessionsSince, "only the 17:30 bowl is after the 14:00 cleaning").toBe(1);

    // And with NO cleaning at all, every bowl counts — untimed ones included,
    // which is what makes an old cellar work at all.
    const d2: any = cellar();
    d2.pipes[0].maintenance = [];
    const out2: any = roundTrip(d2);
    expect(pipeSessionsSinceMaint(out2.pipes[0], out2.sessions, DAY).sessionsSince).toBe(3);
  });

  it("a forged time in the file cannot reach the engine", () => {
    const d: any = cellar();
    d.pipes[0].maintenance[1].time = "99:99";
    const out: any = roundTrip(d);
    expect(out.pipes[0].maintenance[1].time).toBeUndefined();
  });
});

describe("a MERGE keeps it too", () => {
  it("maintMergeKey deliberately EXCLUDES the time", () => {
    // This looks like an omission and is not, so it is pinned with its reason.
    // The key is the CONTENT fallback for entries with no uid — i.e. legacy
    // ones, which by definition have no time either. Including the time would
    // break the case it exists for: a legacy entry edited on one device to add
    // a time would stop matching the other device's untimed copy, and the
    // merge would append a DUPLICATE cleaning. Post-fix entries all carry a
    // uid and dedup by that, so nothing needs the time here.
    const a = { date: DAY, kind: "full", tasks: ["swab"], notes: "" };
    const b = Object.assign({}, a, { time: "14:00" });
    expect(maintMergeKey(b)).toBe(maintMergeKey(a));
  });

  // "an appended entry carries its time across" LIVED HERE and was VACUOUS.
  // It built `Object.assign({}, imported, { id })` itself and asserted the
  // result still had a `time` — a property of the JavaScript language, not of
  // this app. It would have passed with the merge branch deleted outright.
  //
  // It now lives in `useImportConfirm.test.ts`, beside the merge harness that
  // can actually drive the real code path, under the same name. The lesson is
  // the one this repo keeps re-learning: a test that re-implements the thing
  // it is checking is checking its own arithmetic.
});
