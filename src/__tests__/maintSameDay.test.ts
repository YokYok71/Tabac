// A pipe cleaned and smoked again the SAME DAY must still be reminded.
//
// Reported from the app, and the report was precise: « nettoyée ce jour mais à
// nouveau fumée. Avec un seuil de 1 séance pour les alertes » — and nothing
// appeared. Not on the Home section, not as an amber chip on the pipe card.
//
// The counter asked which sessions came after the last cleaning, and both
// sides were DATE strings, so it compared them with `>`. A session on the same
// day as the cleaning is neither before nor after at that precision, and `>`
// resolves the tie by dropping it — so the pipe read as "0 sessions since
// cleaning" and left the reminders entirely. At the default threshold of 5
// that is an off-by-one nobody notices; at 1 it is the whole feature.
//
// THREE THINGS ARE WORTH KNOWING ABOUT HOW THIS WAS FOUND.
//
// It is NOT a regression. The same `>` is in every build back to the first
// public commit. What made it surface was a change that had nothing to do with
// it: uncapping the Home's maintenance list from five rows to every overdue
// pipe, which prompted the user to actually clean them — and then smoke one
// the same evening. A latent defect needs an occasion, and shipping a
// usability fix supplied one.
//
// NO PROBE COULD HAVE CAUGHT IT. Every fixture in this repo gave its pipes
// either `maintenance: []` or an old cleaning date; not one modelled
// "cleaned today, smoked today". The bug lived in the single combination the
// fixtures never expressed, which is the argument for building the fixture
// from the REPORT rather than from what is convenient.
//
// AND THE FIX HAD A CHOICE IN IT. Flipping `>` to `>=` also works for this
// case and merely mirrors the error: a pipe smoked in the morning and cleaned
// in the evening would then count that session and read as due the moment it
// was cleaned. The user chose the third option — give the cleaning a TIME, so
// the same-day order is exact in BOTH directions. An entry without one (every
// legacy entry, and anyone who clears the field) reads as NOON, the same
// fallback `sessionStartMs` already applies to an untimed session, so both
// sides of the comparison agree on what a missing time means.

import { describe, it, expect } from "vitest";
import {
  computePipeMaintenanceReminders, pipeSessionsSinceMaint, lastMaintMoment,
} from "../utils/pipeMaint.ts";
import { migrateData } from "../utils.ts";

const DAY = "2026-08-21";
const NEXT = "2026-08-22";

const pipe = (maint: any[]) => ({
  id: 1, brand: "Luigi Viprati", name: "Bent Billiard", status: "active", maintenance: maint,
});
const clean = (date: string, time?: string) =>
  Object.assign({ id: 1, date, kind: "full", tasks: ["swab"], notes: "" }, time ? { time } : {});
const smoke = (date: string, time?: string) =>
  Object.assign({ id: 9, pipeId: 1, tobaccoId: 1, date }, time ? { time } : {});

const since = (maint: any[], sessions: any[], today = DAY) =>
  pipeSessionsSinceMaint(pipe(maint), sessions, today).sessionsSince;

describe("the reported case: cleaned today, smoked again today", () => {
  it("counts the later bowl, so the reminder comes back", () => {
    // THE regression case. Cleaned at 14:00, smoked at 17:00.
    expect(since([clean(DAY, "14:00")], [smoke(DAY, "17:00")])).toBe(1);
    expect(
      computePipeMaintenanceReminders([pipe([clean(DAY, "14:00")])], [smoke(DAY, "17:00")], 1, 0, DAY),
    ).toHaveLength(1);
  });

  it("does NOT count a bowl smoked BEFORE the cleaning that day", () => {
    // The mirror, and the reason a blanket `>=` was rejected: smoking at 09:00
    // and cleaning at 14:00 leaves the pipe clean, and it must not be reported
    // as due the instant it was cleaned.
    expect(since([clean(DAY, "14:00")], [smoke(DAY, "09:00")])).toBe(0);
    expect(
      computePipeMaintenanceReminders([pipe([clean(DAY, "14:00")])], [smoke(DAY, "09:00")], 1, 0, DAY),
    ).toHaveLength(0);
  });

  it("still counts the next day's bowl — the case that always worked", () => {
    expect(since([clean(DAY, "14:00")], [smoke(NEXT, "10:00")], NEXT)).toBe(1);
  });
});

describe("a missing time reads as NOON, on both sides", () => {
  it("legacy cleaning (no time) + evening bowl → counted", () => {
    // The state every existing entry is in. Noon splits the day rather than
    // swallowing it: an evening bowl counts…
    expect(since([clean(DAY)], [smoke(DAY, "17:00")])).toBe(1);
  });

  it("legacy cleaning (no time) + morning bowl → not counted", () => {
    // …and a dawn bowl does not. Neither answer is knowable from a date alone;
    // what matters is that the SAME convention governs both sides.
    expect(since([clean(DAY)], [smoke(DAY, "07:00")])).toBe(0);
  });

  it("both untimed on the same day → not counted, as before this change", () => {
    // Deliberately unchanged: two noons are not ordered, so `>` drops it. The
    // fix is the FIELD; where neither side has one, the old behaviour stands
    // rather than being silently reversed.
    expect(since([clean(DAY)], [smoke(DAY)])).toBe(0);
  });
});

describe("the counter cannot be silenced by bad data", () => {
  it("a garbage TIME falls back to noon — it cannot produce a NaN moment", () => {
    // Worth pinning because the first version of this file asserted the
    // opposite. `sessionStartMs` guards the time with `_isHHMM` and
    // substitutes "12:00", so a malformed time is simply an untimed entry —
    // there is no NaN path through it. A probe that removed the NaN guard in
    // `pipeSessionsSinceMaint` therefore stayed GREEN against this fixture,
    // which is what exposed the wrong claim. The migrateData sanitisation that
    // strips such a value is about keeping stored data clean, NOT about
    // preventing a crash the engine was never exposed to.
    const bad = [Object.assign(clean(DAY), { time: "banana" })];
    expect(since(bad, [smoke(DAY, "17:00")])).toBe(1);   // as if untimed → noon
    expect(since(bad, [smoke(DAY, "07:00")])).toBe(0);
  });

  it("a garbage DATE that slips past the future-guard counts everything", () => {
    // This IS the reachable NaN path, and the one the guard exists for: a date
    // like "0000-00-00" is a string, is lexically <= today so the future-guard
    // keeps it, and `new Date("0000-00-00T12:00:00")` is an Invalid Date. Every
    // comparison against NaN is false, so without the guard the pipe would
    // count ZERO sessions since cleaning and leave the reminders — the exact
    // defect this build fixes, reproduced through a hand-edited backup. Falling
    // back to "never cleaned" reports too MANY sessions, which is the safe
    // direction: the pipe stays visible.
    const bad = [Object.assign(clean(DAY), { date: "0000-00-00" })];
    expect(since(bad, [smoke(DAY, "17:00"), smoke(NEXT, "10:00")], NEXT)).toBe(2);
  });

  it("a FUTURE-dated cleaning is still ignored", () => {
    // Pre-existing guard, re-asserted because the moment layer sits under it:
    // a fat-fingered 2030 cleaning must not park the reminder past every real
    // session for ever.
    expect(since([clean("2030-01-01", "08:00")], [smoke(DAY, "17:00")])).toBe(1);
  });

  it("a 'none' entry (repair, wax) still does not reset the counter", () => {
    const repair = Object.assign(clean(DAY, "08:00"), { kind: "none" });
    expect(since([repair], [smoke(DAY, "17:00")])).toBe(1);
  });

  it("two cleanings on one day resolve to the LATER time", () => {
    // Otherwise a morning cleaning would mask an afternoon one and the bowl
    // between them would be counted twice over.
    expect(lastMaintMoment(pipe([clean(DAY, "08:00"), clean(DAY, "16:00")]), DAY))
      .toBe(new Date(DAY + "T16:00:00").getTime());
    expect(since([clean(DAY, "08:00"), clean(DAY, "16:00")], [smoke(DAY, "12:00")])).toBe(0);
  });
});

describe("migrateData keeps the stored time clean", () => {
  it("strips a value that is not HH:MM, and keeps one that is", () => {
    // Not a crash guard — the case above establishes that a bad time is
    // harmless at read time. This is about what gets STORED and carried into
    // backups: a garbage value that reads as noon anyway has no reason to
    // survive a load, and leaving it would put it in every export from then on.
    const d: any = migrateData({
      tobaccos: [], pipes: [{ id: 1, name: "P", status: "active", maintenance: [
        { id: 1, date: DAY, time: "banana", kind: "light", tasks: [], notes: "" },
        { id: 2, date: DAY, time: "24:00", kind: "light", tasks: [], notes: "" },
        { id: 3, date: DAY, time: "08:30", kind: "light", tasks: [], notes: "" },
      ] }], wishlist: [], accessories: [], sessions: [],
    });
    const m = d.pipes[0].maintenance;
    expect(m[0].time).toBeUndefined();
    expect(m[1].time, "24:00 is not a valid clock time").toBeUndefined();
    expect(m[2].time).toBe("08:30");
  });
});

describe("one implementation, not two", () => {
  it("the reminder list and the per-pipe count agree by construction", () => {
    // `computePipeMaintenanceReminders` carried its own copy of the counting
    // logic, so the Home section and the pipe-card chips reached the same
    // number by two different paths — free to drift the day either was
    // touched. It delegates now; this pins that they cannot disagree.
    const p = pipe([clean(DAY, "10:00")]);
    const sessions = [smoke(DAY, "11:00"), smoke(DAY, "18:00"), smoke(NEXT, "09:00")];
    const direct = pipeSessionsSinceMaint(p, sessions, NEXT);
    const listed = computePipeMaintenanceReminders([p], sessions, 1, 0, NEXT);
    expect(direct.sessionsSince).toBe(3);
    expect(listed[0]!.sessionsSince).toBe(direct.sessionsSince);
    expect(listed[0]!.lastMaintDate).toBe(direct.lastMaintDate);
  });
});
