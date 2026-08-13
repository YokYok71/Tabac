import { describe, it, expect } from "vitest";
import {
  checkLotInvariants,
  checkSessionInvariants,
  checkPipeInvariants,
  checkAccessoryInvariants,
  checkBalanceInvariants,
  checkTobaccoInvariants,
  checkWishInvariants,
  checkMaintenanceInvariants,
  checkAllInvariants,
  checkUidInvariants,
} from "../utils/lotInvariants";

function lot(over: Record<string, any> = {}) {
  return {
    id: "L1",
    status: "cellar",
    originalStatus: "cellar",
    weightG: "50",
    weightInitial: "50",
    dateOpened: "",
    dateFinished: "",
    boxNumber: "",
    price: "",
    seller: "",
    disposed: false,
    ...over,
  };
}

function dat(lots: any[]) {
  return { tobaccos: [{ id: 1, name: "Duskfall", lots }] };
}

describe("checkLotInvariants", () => {
  it("returns no violations for a valid cellar lot", () => {
    expect(checkLotInvariants(dat([lot()]))).toEqual([]);
  });

  // duplicate lot ids within a tobacco are the exact corruption the
  // earlier stripped-index mutation bug could produce — the invariant catches
  // any residual occurrence at save().
  it("flags a duplicate lot id within a tobacco", () => {
    const v = checkLotInvariants(dat([lot({ id: "DUP" }), lot({ id: "DUP", weightG: "30" })]));
    expect(v.some((x) => x.rule === "lot-id-unique")).toBe(true);
  });

  it("does NOT flag two lots with distinct ids", () => {
    const v = checkLotInvariants(dat([lot({ id: "X" }), lot({ id: "Y" })]));
    expect(v.some((x) => x.rule === "lot-id-unique")).toBe(false);
  });

  it("does NOT flag a duplicate id when one of the pair is soft-deleted (trashed)", () => {
    const v = checkLotInvariants(dat([lot({ id: "Z", deletedAt: "2020-01-01T00:00:00.000Z" }), lot({ id: "Z" })]));
    expect(v.some((x) => x.rule === "lot-id-unique")).toBe(false);
  });

  // A single lot whose id equals a prototype member
  // ("toString") must NOT be flagged. The earlier plain-{} seenLotIds map read
  // Object.prototype.toString (truthy) before the first assignment → a false
  // lot-id-unique on every save().
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"])(
    "does NOT flag a single lot whose id is the prototype member '%s'",
    (protoId) => {
      const v = checkLotInvariants(dat([lot({ id: protoId })]));
      expect(v.some((x) => x.rule === "lot-id-unique")).toBe(false);
    },
  );

  it("returns no violations for a valid jar lot", () => {
    expect(checkLotInvariants(dat([
      lot({ status: "jar", dateOpened: "2024-01-15", weightG: "30" }),
    ]))).toEqual([]);
  });

  it("returns no violations for a valid finished lot", () => {
    expect(checkLotInvariants(dat([
      lot({ status: "finished", dateOpened: "2024-01-15", dateFinished: "2024-06-01", weightG: "0" }),
    ]))).toEqual([]);
  });

  it("flags weightG < 0", () => {
    const v = checkLotInvariants(dat([lot({ weightG: "-3" })]));
    expect(v.some(x => x.rule === "weightG-nonneg")).toBe(true);
  });

  it("flags weightG > weightInitial (beyond rounding tolerance)", () => {
    const v = checkLotInvariants(dat([lot({ weightG: "60", weightInitial: "50" })]));
    expect(v.some(x => x.rule === "weightG-le-initial")).toBe(true);
  });

  it("tolerates a 0.1g overshoot from rounding", () => {
    const v = checkLotInvariants(dat([lot({ weightG: "50.1", weightInitial: "50" })]));
    expect(v.some(x => x.rule === "weightG-le-initial")).toBe(false);
  });

  it("flags status=finished without dateFinished", () => {
    const v = checkLotInvariants(dat([lot({ status: "finished", weightG: "0" })]));
    expect(v.some(x => x.rule === "finished-has-dateFinished")).toBe(true);
  });

  it("flags status=jar without dateOpened", () => {
    const v = checkLotInvariants(dat([lot({ status: "jar", weightG: "30" })]));
    expect(v.some(x => x.rule === "jar-has-dateOpened")).toBe(true);
  });

  it("flags status=cellar with originalStatus=jar (impossible)", () => {
    const v = checkLotInvariants(dat([lot({ status: "cellar", originalStatus: "jar" })]));
    expect(v.some(x => x.rule === "cellar-not-jar-origin")).toBe(true);
  });

  it("ACCEPTS status=cellar with dateOpened set (historical opening memory)", () => {
    // dateOpened was preserved on the (since-removed)
    // jar→cellar auto-revert. Legacy migrated lots and any future
    // manual revert via the lot edit modal can still legitimately
    // produce a cellar+dateOpened combination, so this is NOT a
    // violation by design.
    const v = checkLotInvariants(dat([lot({ status: "cellar", dateOpened: "2024-01-15" })]));
    // dateOpened on cellar is NOT a violation by design.
    expect(v.some(x => /cellar.*dateOpened/.test(x.rule))).toBe(false);
  });

  it("flags missing weightInitial", () => {
    const v = checkLotInvariants(dat([lot({ weightInitial: "" })]));
    expect(v.some(x => x.rule === "weightInitial-positive")).toBe(true);
  });

  // A legacy lot the user never weighed
  // (weightG unset) is an ABSENCE of data, not corruption. It must NOT emit
  // weightG-nonneg / weightInitial-positive forever on every save().
  it("does NOT flag a fully-untracked lot (empty weightG AND weightInitial)", () => {
    const v = checkLotInvariants(dat([lot({ weightG: "", weightInitial: "" })]));
    expect(v.some(x => x.rule === "weightG-nonneg")).toBe(false);
    expect(v.some(x => x.rule === "weightInitial-positive")).toBe(false);
  });

  // But a lot with a NUMERIC weightG and a bad weightInitial is still real
  // corruption — untracked must not become a blanket escape hatch.
  it("STILL flags a tracked lot (numeric weightG) with empty weightInitial", () => {
    const v = checkLotInvariants(dat([lot({ weightG: "50", weightInitial: "" })]));
    expect(v.some(x => x.rule === "weightInitial-positive")).toBe(true);
  });

  it("flags invalid originalStatus", () => {
    const v = checkLotInvariants(dat([lot({ originalStatus: "finished" as any })]));
    expect(v.some(x => x.rule === "originalStatus-valid")).toBe(true);
  });

  it("flags missing lot id", () => {
    const v = checkLotInvariants(dat([lot({ id: "" })]));
    expect(v.some(x => x.rule === "id-present")).toBe(true);
  });

  it("returns [] for empty / malformed data", () => {
    expect(checkLotInvariants(null)).toEqual([]);
    expect(checkLotInvariants({})).toEqual([]);
    expect(checkLotInvariants({ tobaccos: null })).toEqual([]);
    expect(checkLotInvariants({ tobaccos: [{ id: 1 }] })).toEqual([]);
  });
});

// The three cross-ref rules
//   session-tobacco-exists, session-pipe-exists, session-lot-exists
// were dropped. Sessions are immutable historical records — a
// session logged against an entity the user later purged is the
// expected state, not a bug. The journal renders via the snapshot
// the session carries. Remaining session invariants: id present,
// date present, weightG non-negative.
describe("checkSessionInvariants", () => {
  it("does NOT flag a session whose lotId is now dangling", () => {
    const data = {
      tobaccos: [{ id: "T1", lots: [{ id: "L1", weightG: "50", weightInitial: "50" }] }],
      sessions: [{ id: "S1", date: "2024-06-01", tobaccoId: "T1", lotId: "DELETED", weightG: "5" }],
    };
    const v = checkSessionInvariants(data);
    expect(v.some(x => x.rule === "session-lot-exists")).toBe(false);
  });

  it("does NOT flag a session whose tobaccoId is now dangling", () => {
    const data = {
      tobaccos: [],
      sessions: [{ id: "S1", date: "2024-06-01", tobaccoId: "GONE", lotId: "", weightG: "0" }],
    };
    const v = checkSessionInvariants(data);
    expect(v.some(x => x.rule === "session-tobacco-exists")).toBe(false);
  });

  it("does NOT flag a session whose pipeId is now dangling", () => {
    const data = {
      tobaccos: [{ id: "T1", lots: [{ id: "L1", weightG: "50", weightInitial: "50" }] }],
      pipes: [{ id: "P1" }],
      sessions: [{ id: "S1", date: "2024-06-01", tobaccoId: "T1", lotId: "L1", pipeId: "GONE", weightG: "5" }],
    };
    const v = checkSessionInvariants(data);
    expect(v.some(x => x.rule === "session-pipe-exists")).toBe(false);
  });

  it("flags missing session id and missing date", () => {
    const data = {
      tobaccos: [], sessions: [{ tobaccoId: "T1", lotId: "" } as any],
    };
    const v = checkSessionInvariants(data);
    expect(v.some(x => x.rule === "session-id-present")).toBe(true);
    expect(v.some(x => x.rule === "session-date-present")).toBe(true);
  });

  it("flags negative weightG", () => {
    const data = {
      tobaccos: [{ id: "T1", lots: [{ id: "L1", weightG: "50", weightInitial: "50" }] }],
      sessions: [{ id: "S1", date: "2024-06-01", tobaccoId: "T1", lotId: "L1", weightG: "-3" }],
    };
    const v = checkSessionInvariants(data);
    expect(v.some(x => x.rule === "session-weight-nonneg")).toBe(true);
  });

  // A drifted nxJ counter could mint a
  // duplicate session id — now flagged.
  it("flags duplicate session ids", () => {
    const data = {
      tobaccos: [],
      sessions: [
        { id: "S1", date: "2024-06-01", tobaccoId: "T1", lotId: "", weightG: "0" },
        { id: "S1", date: "2024-06-02", tobaccoId: "T1", lotId: "", weightG: "0" },
      ],
    };
    const v = checkSessionInvariants(data);
    expect(v.some(x => x.rule === "session-id-unique")).toBe(true);
  });

  it("does NOT flag a duplicate session id when one is soft-deleted", () => {
    const data = {
      tobaccos: [],
      sessions: [
        { id: "S1", date: "2024-06-01", tobaccoId: "T1", lotId: "", weightG: "0", deletedAt: "2020-01-01T00:00:00.000Z" },
        { id: "S1", date: "2024-06-02", tobaccoId: "T1", lotId: "", weightG: "0" },
      ],
    };
    const v = checkSessionInvariants(data);
    expect(v.some(x => x.rule === "session-id-unique")).toBe(false);
  });
});

// tobaccos + wishlist items gained an
// id-uniqueness check (previously only pipes + accessories had one). This is
// the safety net for the silent-corruption path the migrateData counter
// reconciliation now closes.
describe("checkTobaccoInvariants", () => {
  it("returns no violations for distinct ids", () => {
    expect(checkTobaccoInvariants({ tobaccos: [{ id: 1 }, { id: 2 }] })).toEqual([]);
  });
  it("flags duplicate tobacco ids", () => {
    const v = checkTobaccoInvariants({ tobaccos: [{ id: 1 }, { id: 1 }] });
    expect(v.some(x => x.rule === "tobacco-id-unique" && x.scope === "tobacco")).toBe(true);
  });
  it("flags a missing tobacco id", () => {
    const v = checkTobaccoInvariants({ tobaccos: [{ name: "x" }] });
    expect(v.some(x => x.rule === "tobacco-id-present")).toBe(true);
  });
  it("ignores soft-deleted rows when checking uniqueness", () => {
    const v = checkTobaccoInvariants({ tobaccos: [{ id: 1, deletedAt: "2020-01-01T00:00:00.000Z" }, { id: 1 }] });
    expect(v.some(x => x.rule === "tobacco-id-unique")).toBe(false);
  });
  it("returns [] for malformed data", () => {
    expect(checkTobaccoInvariants(null)).toEqual([]);
    expect(checkTobaccoInvariants({ tobaccos: null })).toEqual([]);
  });
});

describe("checkWishInvariants", () => {
  it("flags duplicate wishlist ids", () => {
    const v = checkWishInvariants({ wishlist: [{ id: 1 }, { id: 1 }] });
    expect(v.some(x => x.rule === "wishlist-id-unique" && x.scope === "wishlist")).toBe(true);
  });
  it("does NOT flag distinct ids", () => {
    expect(checkWishInvariants({ wishlist: [{ id: 1 }, { id: 2 }] })).toEqual([]);
  });
  it("ignores soft-deleted wishlist rows", () => {
    const v = checkWishInvariants({ wishlist: [{ id: 1, deletedAt: "2020-01-01T00:00:00.000Z" }, { id: 1 }] });
    expect(v.some(x => x.rule === "wishlist-id-unique")).toBe(false);
  });
});

describe("checkPipeInvariants", () => {
  it("returns no violations for distinct ids", () => {
    expect(checkPipeInvariants({ pipes: [{ id: "P1" }, { id: "P2" }] })).toEqual([]);
  });
  it("flags duplicate pipe ids", () => {
    const v = checkPipeInvariants({ pipes: [{ id: "P1" }, { id: "P1" }] });
    expect(v.some(x => x.rule === "pipe-id-unique")).toBe(true);
  });
  it("flags missing pipe id", () => {
    const v = checkPipeInvariants({ pipes: [{ name: "x" }] });
    expect(v.some(x => x.rule === "pipe-id-present")).toBe(true);
  });
});

describe("checkAccessoryInvariants", () => {
  it("flags duplicate accessory ids", () => {
    const v = checkAccessoryInvariants({ accessories: [{ id: "A1" }, { id: "A1" }] });
    expect(v.some(x => x.rule === "accessory-id-unique")).toBe(true);
  });
});

describe("checkMaintenanceInvariants", () => {
  it("returns no violations for distinct maintenance ids", () => {
    const data = { pipes: [{ id: "P1", maintenance: [{ id: 1 }, { id: 2 }] }] };
    expect(checkMaintenanceInvariants(data)).toEqual([]);
  });
  it("flags duplicate maintenance ids within a pipe (the id:0 corruption class)", () => {
    const data = { pipes: [{ id: "P1", maintenance: [{ id: 0 }, { id: 0 }] }] };
    const v = checkMaintenanceInvariants(data);
    expect(v.some(x => x.rule === "maintenance-id-unique")).toBe(true);
    expect(v[0]!.scope).toBe("maintenance");
  });
  it("flags a maintenance entry with no id", () => {
    const data = { pipes: [{ id: "P1", maintenance: [{ date: "2026-01-01" }] }] };
    const v = checkMaintenanceInvariants(data);
    expect(v.some(x => x.rule === "maintenance-id-present")).toBe(true);
  });
  it("does not cross pipes — same id on two different pipes is fine", () => {
    const data = { pipes: [{ id: "P1", maintenance: [{ id: 5 }] }, { id: "P2", maintenance: [{ id: 5 }] }] };
    expect(checkMaintenanceInvariants(data)).toEqual([]);
  });
  it("skips soft-deleted pipes", () => {
    const data = { pipes: [{ id: "P1", deletedAt: "2026-01-01", maintenance: [{ id: 0 }, { id: 0 }] }] };
    expect(checkMaintenanceInvariants(data)).toEqual([]);
  });
  it("is included in checkAllInvariants", () => {
    const data = { pipes: [{ id: "P1", maintenance: [{ id: 0 }, { id: 0 }] }] };
    expect(checkAllInvariants(data).some(x => x.rule === "maintenance-id-unique")).toBe(true);
  });
});

describe("checkAllInvariants", () => {
  it("aggregates violations across all entity scopes", () => {
    const data = {
      // duplicate tobacco id T1 also exercises the new tobacco scope.
      tobaccos: [
        { id: "T1", lots: [{ id: "L1", status: "jar", weightG: "50", weightInitial: "50" /* missing dateOpened */ }] },
        { id: "T1", lots: [] },
      ],
      // cross-ref session rules were dropped, so we need a
      // surviving rule (negative weightG) to keep the session scope hit.
      sessions: [{ id: "S1", date: "2024-06-01", tobaccoId: "T1", lotId: "L1", weightG: "-3" }],
      pipes: [{ id: "P1" }, { id: "P1" }],
      accessories: [{ id: "A1" }, { id: "A1" }],
      wishlist: [{ id: "W1" }, { id: "W1" }],
    };
    const v = checkAllInvariants(data);
    expect(v.some(x => x.scope === "lot")).toBe(true);
    expect(v.some(x => x.scope === "session")).toBe(true);
    expect(v.some(x => x.scope === "pipe")).toBe(true);
    expect(v.some(x => x.scope === "accessory")).toBe(true);
    // The two new scopes flow through the aggregator too.
    expect(v.some(x => x.scope === "tobacco" && x.rule === "tobacco-id-unique")).toBe(true);
    expect(v.some(x => x.scope === "wishlist" && x.rule === "wishlist-id-unique")).toBe(true);
  });
});

// ── checkBalanceInvariants ───────────────────────────────────────
// Asymmetric balance: Σ(sessions.weightG) on a given lot MUST NOT exceed
// (weightInitial − weightG). The reverse direction (Σ smaller than diff) is
// legitimate (user smoked without logging, zeroed the dregs manually) and is
// tolerated. The rule catches the delete+restore double-counting
// bug and any future drift that records more grammes than left the pot.

describe("checkBalanceInvariants", () => {
  function makeData(over: Record<string, any> = {}) {
    return {
      tobaccos: [],
      sessions: [],
      pipes: [], wishlist: [], accessories: [],
      ...over,
    };
  }
  function lotAt(weightG: string, weightInitial: string, lotId = "L1") {
    return {
      id: lotId, status: "jar", weightG, weightInitial,
      originalStatus: "jar", dateOpened: "2024-01-01",
    };
  }

  it("Σ === diff is OK (tight equality, no violation)", () => {
    // Lot at 50→45 (consumed 5g), one session of 5g matches exactly.
    const data = makeData({
      tobaccos: [{ id: 1, lots: [lotAt("45", "50")] }],
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "5" }],
    });
    expect(checkBalanceInvariants(data)).toEqual([]);
  });

  it("Σ < diff is OK (user smoked without logging)", () => {
    // Lot consumed 10g (50→40), only 3g actually logged. Legit.
    const data = makeData({
      tobaccos: [{ id: 1, lots: [lotAt("40", "50")] }],
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "3" }],
    });
    expect(checkBalanceInvariants(data)).toEqual([]);
  });

  it("Σ = 0, diff > 0 is OK (zeroed-out dregs)", () => {
    // Lot 50→0 manually (finished IRL), no session logged. Legit.
    const data = makeData({
      tobaccos: [{ id: 1, lots: [lotAt("0", "50")] }],
      sessions: [],
    });
    expect(checkBalanceInvariants(data)).toEqual([]);
  });

  it("Σ > diff + tolerance fires a 'lot-balance-overflow' violation", () => {
    // Lot at 100g (no consumption recorded on the pot), but a session
    // claims it smoked 5g. Reproduces the bug scenario.
    const data = makeData({
      tobaccos: [{ id: 1, brand: "X", name: "Y", lots: [lotAt("100", "100")] }],
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "5" }],
    });
    const v = checkBalanceInvariants(data);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("lot-balance-overflow");
    expect(v[0]!.lotId).toBe("L1");
    expect(v[0]!.tobId).toBe(1);
    expect(v[0]!.detail).toContain("Σ=5");
    expect(v[0]!.detail).toContain("by 5");
  });

  it("absorbs 0.5g floating-point tolerance", () => {
    // Σ=10.3, diff=10 → 0.3 above. Tolerance is 0.5 → tolerated.
    const data = makeData({
      tobaccos: [{ id: 1, lots: [lotAt("40", "50")] }],
      sessions: [
        { id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "5.1" },
        { id: "S2", tobaccoId: 1, lotId: "L1", date: "2025-01-02", weightG: "5.2" },
      ],
    });
    expect(checkBalanceInvariants(data)).toEqual([]);
  });

  it("excludes trashed sessions from Σ (their weight is restored to the lot)", () => {
    // Lot at 100→100 (no consumption). Trashed session of 5g must NOT
    // count — otherwise the invariant would fire on every soft-delete.
    const data = makeData({
      tobaccos: [{ id: 1, lots: [lotAt("100", "100")] }],
      sessions: [{
        id: "S1", tobaccoId: 1, lotId: "L1",
        date: "2025-01-01", weightG: "5",
        deletedAt: "2026-05-15T10:00:00Z",
      }],
    });
    expect(checkBalanceInvariants(data)).toEqual([]);
  });

  it("excludes orphaned sessions (lotId === '') from Σ", () => {
    // Session with lotId="" can't be attributed; safely ignored.
    const data = makeData({
      tobaccos: [{ id: 1, lots: [lotAt("100", "100")] }],
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "", date: "2025-01-01", weightG: "5" }],
    });
    expect(checkBalanceInvariants(data)).toEqual([]);
  });

  it("ignores trashed lots and trashed tobaccos", () => {
    // Trashed lot with an overflowing Σ — must NOT report.
    const trashedLot = Object.assign(lotAt("100", "100"), {
      deletedAt: "2026-05-15T10:00:00Z",
    });
    const data = makeData({
      tobaccos: [{ id: 1, lots: [trashedLot] }],
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "5" }],
    });
    expect(checkBalanceInvariants(data)).toEqual([]);
    // Same for a trashed top-level tobacco.
    const data2 = makeData({
      tobaccos: [{ id: 1, lots: [lotAt("100", "100")], deletedAt: "2026-05-15T10:00:00Z" }],
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "5" }],
    });
    expect(checkBalanceInvariants(data2)).toEqual([]);
  });

  it("aggregates Σ across multiple sessions on the same lot", () => {
    // Three sessions on the same lot: 4 + 3 + 2 = 9. Diff = 5.
    // Surplus = 4 → above tolerance → violation.
    const data = makeData({
      tobaccos: [{ id: 1, lots: [lotAt("45", "50")] }],
      sessions: [
        { id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "4" },
        { id: "S2", tobaccoId: 1, lotId: "L1", date: "2025-01-02", weightG: "3" },
        { id: "S3", tobaccoId: 1, lotId: "L1", date: "2025-01-03", weightG: "2" },
      ],
    });
    const v = checkBalanceInvariants(data);
    expect(v).toHaveLength(1);
    expect(v[0]!.detail).toContain("Σ=9");
  });

  it("sessions are attributed to the right lot (tobId|lotId composite key)", () => {
    // Two lots with the same lotId across different tobaccos — the
    // composite key prevents cross-attribution.
    const data = makeData({
      tobaccos: [
        { id: 1, brand: "A", lots: [lotAt("50", "50", "L1")] },
        { id: 2, brand: "B", lots: [lotAt("100", "100", "L1")] },
      ],
      sessions: [
        { id: "S1", tobaccoId: 2, lotId: "L1", date: "2025-01-01", weightG: "5" },
      ],
    });
    const v = checkBalanceInvariants(data);
    // Tabac 1 has no sessions → no overflow.
    // Tabac 2: Σ=5, diff=100-100=0 → overflow.
    expect(v).toHaveLength(1);
    expect(v[0]!.tobId).toBe(2);
  });

  it("checkAllInvariants includes balance violations", () => {
    // Make sure the new rule is wired into the aggregate.
    const data = makeData({
      tobaccos: [{ id: 1, lots: [lotAt("100", "100")] }],
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "5" }],
    });
    const v = checkAllInvariants(data);
    expect(v.some(x => x.rule === "lot-balance-overflow")).toBe(true);
  });
});

// ── cross-tobacco lot-id collision ──────────────────────────
// Found by a data-layer audit. `useTrashOps` and the 30-day sweep both act on
// lot ids ACROSS every tobacco, so a collision means purging one blend's
// trashed lot hard-deletes another blend's LIVE lot and orphans its sessions —
// the auto-sweep half firing with no user action at all. The per-tobacco
// uniqueness check is scoped inside the tobacco loop and could never see it.
describe("lot-id-unique-global", () => {
  const mk = (tobId: number, lotId: number) => ({
    id: tobId, brand: "B" + tobId, name: "N" + tobId,
    lots: [{ id: lotId, status: "cellar", weightG: "50", weightInitial: "50" }],
  });

  it("flags the same lot id under two different tobaccos", () => {
    const v = checkLotInvariants({ tobaccos: [mk(1, 100001), mk(2, 100001)], sessions: [] });
    const hit = v.filter((x: any) => x.rule === "lot-id-unique-global");
    expect(hit.length).toBe(1);
    expect(String(hit[0]!.detail)).toContain("100001");
  });

  it("does NOT flag distinct ids, nor the same id inside one tobacco", () => {
    expect(checkLotInvariants({ tobaccos: [mk(1, 1), mk(2, 2)], sessions: [] })
      .filter((x: any) => x.rule === "lot-id-unique-global")).toEqual([]);
    // A within-tobacco duplicate is the OTHER rule's job; this one must stay quiet.
    const dup = { id: 1, brand: "B", name: "N", lots: [
      { id: 7, status: "cellar", weightG: "50", weightInitial: "50" },
      { id: 7, status: "cellar", weightG: "50", weightInitial: "50" },
    ] };
    expect(checkLotInvariants({ tobaccos: [dup], sessions: [] })
      .filter((x: any) => x.rule === "lot-id-unique-global")).toEqual([]);
  });

  it("ignores trashed lots and trashed tobaccos", () => {
    const a = mk(1, 500), b = mk(2, 500);
    (b.lots[0] as any).deletedAt = "2026-01-01T00:00:00.000Z";
    expect(checkLotInvariants({ tobaccos: [a, b], sessions: [] })
      .filter((x: any) => x.rule === "lot-id-unique-global")).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// `uid` is the CROSS-DEVICE merge identity and NOTHING checked that
// it was unique. `uidMap[uid] = row.id` is last-wins, so two live rows sharing a
// uid means every later merge matches one arbitrarily and leaves the other
// permanently stale. The class reached production: the merge added a backup's
// copy of a TRASHED row, carrying the same uid( in
// useImportConfirm). The numeric-id invariants above could not see it — they
// cover the per-device id, which WAS distinct.
describe("uid uniqueness", () => {
  const base = () => ({ tobaccos: [], pipes: [], accessories: [], wishlist: [], sessions: [] });

  it("flags two live tobaccos sharing a uid", () => {
    const d: any = base();
    d.tobaccos = [
      { id: 1, uid: "same", name: "A", lots: [] },
      { id: 2, uid: "same", name: "B", lots: [] },
    ];
    const v = checkUidInvariants(d);
    expect(v.map((x) => x.rule)).toEqual(["tobacco-uid-unique"]);
    expect(v[0]!.detail).toContain("same");
  });

  it("is silent when the uids differ, and when a row has none", () => {
    const d: any = base();
    d.tobaccos = [
      { id: 1, uid: "u1", lots: [] },
      { id: 2, uid: "u2", lots: [] },
      { id: 3, lots: [] },              // legacy, never backfilled
      { id: 4, uid: "", lots: [] },
    ];
    expect(checkUidInvariants(d)).toEqual([]);
  });

  it("skips TRASHED rows — a trashed row is not a merge target", () => {
    // And its uid legitimately equals that of the entity it used to be.
    const d: any = base();
    d.tobaccos = [
      { id: 1, uid: "same", lots: [] },
      { id: 2, uid: "same", lots: [], deletedAt: "2026-07-01T00:00:00.000Z" },
    ];
    expect(checkUidInvariants(d)).toEqual([]);
  });

  it("covers every kind, sessions included", () => {
    const d: any = base();
    d.pipes = [{ id: 1, uid: "p" }, { id: 2, uid: "p" }];
    d.accessories = [{ id: 1, uid: "a" }, { id: 2, uid: "a" }];
    d.wishlist = [{ id: 1, uid: "w" }, { id: 2, uid: "w" }];
    d.sessions = [{ id: 1, uid: "s" }, { id: 2, uid: "s" }];
    expect(checkUidInvariants(d).map((x) => x.rule).sort()).toEqual([
      "accessory-uid-unique", "pipe-uid-unique", "session-uid-unique", "wishlist-uid-unique",
    ]);
  });

  it("does not flag a uid shared ACROSS kinds", () => {
    // Every lookup is already scoped inside one collection, so this is harmless
    // — and flagging it would be noise a user could not act on.
    const d: any = base();
    d.tobaccos = [{ id: 1, uid: "shared", lots: [] }];
    d.pipes = [{ id: 1, uid: "shared" }];
    expect(checkUidInvariants(d)).toEqual([]);
  });

  it("survives a garbage payload", () => {
    expect(checkUidInvariants(null)).toEqual([]);
    expect(checkUidInvariants({ tobaccos: "nope" } as any)).toEqual([]);
    expect(checkUidInvariants({ tobaccos: [null, undefined] } as any)).toEqual([]);
    // a forged uid that is a prototype member must not read as "seen"
    expect(checkUidInvariants({ tobaccos: [{ id: 1, uid: "__proto__" }] } as any)).toEqual([]);
  });

  it("is included in checkAllInvariants", () => {
    const d: any = base();
    d.tobaccos = [{ id: 1, uid: "same", lots: [] }, { id: 2, uid: "same", lots: [] }];
    expect(checkAllInvariants(d).some((v) => v.rule === "tobacco-uid-unique")).toBe(true);
  });
});
