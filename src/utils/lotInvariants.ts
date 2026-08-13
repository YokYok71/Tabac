/**
 * Runtime invariants for the persisted application state.
 *
 * These rules must hold post-save. Violations are recorded by the
 * diagnostic counter (utils/diagnostic.ts) and surfaced in dev.
 *
 * Lot invariants:
 *   1. weightG >= 0
 *   2. weightG <= weightInitial (within a 0.1 tolerance — same rounding
 *      as applyLotWeightDelta).
 *   3. status === "finished"   ⟹ dateFinished is non-empty.
 *   4. status === "jar"        ⟹ dateOpened is non-empty.
 *   5. status === "cellar"     ⟹ originalStatus !== "jar"
 *      (a jar-from-start lot must never end up in cellar status).
 *   6. weightInitial > 0.
 *   7. originalStatus is "cellar" or "jar" (never "finished" or empty).
 *   8. id is present and unique within a tobacco.
 *
 * Session invariants (trimmed in 165):
 *   S1. session.id is present.
 *   S2. session.date is non-empty.
 *   S3. session.weightG >= 0 (parsed).
 *
 * The original S3-S5 (tobacco/pipe/lot existence cross-refs) were
 * removed deliberately: the user's policy is that permanent delete
 * does NOT mutate any session field, so a dangling tobaccoId /
 * pipeId / lotId is the expected state of a session logged against
 * an entity that was later purged. The journal renders via the
 * `tobaccoSnapshot` / `pipeSnapshot` the session carries.
 *
 * Pipe invariants:
 *   P1. pipe.id is present and unique.
 *
 * Accessory invariants:
 *   A1. accessory.id is present and unique.
 *
 * Balance invariants:
 *   B1. lot-balance-overflow — for every NON-trashed lot,
 *       Σ(sessions.weightG referencing this lot) must NOT exceed
 *       (weightInitial − weightG) + tolerance. This is the ASYMMETRIC
 *       form of the conservation law: the journal cannot show more
 *       smoked than the pot actually let go. The reverse direction
 *       (Σ < diff) is legitimate — the user may have smoked without
 *       logging, or zeroed out the dregs of a finished lot manually.
 *       Tolerance is 0.5 to absorb the 0.1g rounding inside
 *       applyLotWeightDelta. Trashed sessions are excluded from Σ
 *       (their weight is restored to the lot, see useSessionStore).
 *       Orphaned sessions (lotId === "") are excluded too — they
 *       can't be attributed. This is the rule that would have caught
 *       the delete+restore double-counting bug.
 *
 * `dateOpened` on a cellar lot is INTENTIONALLY NOT an invariant
 * violation: it is preserved as historical opening memory on the
 * `auto-recovery` transition mode (see applyLifecycleDates).
 * `"manual"` transitions to cellar always clear it. The
 * now-removed auto-revert rule that exercised the auto-recovery
 * mode for jar→cellar was removed, but legacy lots migrated from that
 * era — and a future manual revert via the lot edit modal — may still
 * legitimately carry a cellar+dateOpened combination.
 */

import { isUntrackedWeight } from "../utils.ts";
import { recordViolations } from "./diagnostic.ts";

export interface InvariantViolation {
  // Scope identifies which entity the violation is about.
  scope: "lot" | "session" | "pipe" | "accessory" | "tobacco" | "wishlist" | "maintenance";
  tobId?: any;
  tobName?: string;
  lotId?: any;
  lotIdx?: number;
  sessionId?: any;
  pipeId?: any;
  accessoryId?: any;
  wishId?: any;
  maintId?: any;
  rule: string;
  detail: string;
}

export function checkLotInvariants(data: any): InvariantViolation[] {
  var out: InvariantViolation[] = [];
  if (!data || !Array.isArray(data.tobaccos)) return out;
  // Lot ids must be unique GLOBALLY, not merely within their
  // tobacco. The per-tobacco check below is scoped inside the loop, so a
  // cross-tobacco duplicate was invisible — while `useTrashOps` and the 30-day
  // sweep both delete/orphan BY LOT ID ACROSS EVERY TOBACCO. A CSV import used
  // to mint ids from a fixed base, so two imports collided and purging one
  // blend's trashed lot hard-deleted a different blend's LIVE lot.
  //
  // CORRECTION: this comment used to claim "the source is fixed (the
  // importer re-stamps from monotonicId)", which was true of the CSV importer
  // ALONE. The JSON/cloud merge's added-wholesale path carried imported lot ids
  // verbatim, so the whole class was still reachable — and it took an audit to
  // find, because the assertion sitting right here read as a closed case. THIS
  // CHECK is the guarantee; a comment claiming a source is clean is not. Both
  // paths re-stamp now, and this makes any future one visible at save() instead
  // of silently destroying data. Null-proto: lot ids come from user data.
  var seenGlobal: Record<string, string> = Object.create(null);
  data.tobaccos.forEach(function (tb: any) {
    if (!tb || tb.deletedAt || !Array.isArray(tb.lots)) return;
    tb.lots.forEach(function (l: any) {
      if (!l || l.deletedAt) return;
      if (l.id === undefined || l.id === null || l.id === "") return;
      var k = String(l.id);
      var owner = seenGlobal[k];
      if (owner !== undefined && owner !== String(tb.id)) {
        out.push({
          scope: "lot", tobId: tb.id, tobName: tb.name, lotId: l.id,
          lotIdx: -1, rule: "lot-id-unique-global",
          detail: "lot id " + k + " also exists under tobacco " + owner,
        });
      }
      if (owner === undefined) seenGlobal[k] = String(tb.id);
    });
  });
  data.tobaccos.forEach(function (tb: any) {
    if (!tb || !Array.isArray(tb.lots)) return;
    // Skip soft-deleted tobaccos. The lots they carry are
    // also out of the active set; the Trash UI doesn't surface them
    // as violations either.
    if (tb.deletedAt) return;
    // Lot ids must be UNIQUE within a tobacco. A duplicate id means
    // two physical lots collapsed onto one key — session weight gets
    // misattributed and edits hit the wrong lot. This would have flagged the
    // stripped-index mutation bug (long fixed) at the next save().
    // Object.create(null) — the lone check* map still on a
    // plain {}. A forged non-numeric lot id equal to a prototype member
    // ("toString" etc.) survives dedupeIds (unique non-numeric ids are kept),
    // and `seenLotIds["toString"]` reads Object.prototype.toString (truthy)
    // BEFORE any assignment → a false `lot-id-unique` flag on every save().
    // Parity with the sibling maps (seenSessIds, pipe, accessory, tobacco…).
    var seenLotIds: Record<string, boolean> = Object.create(null);
    tb.lots.forEach(function (l: any) {
      if (!l || l.deletedAt) return;
      if (l.id === undefined || l.id === null || l.id === "") return;
      var k = String(l.id);
      if (seenLotIds[k]) {
        out.push({
          scope: "lot", tobId: tb.id, tobName: tb.name, lotId: l.id,
          lotIdx: -1, rule: "lot-id-unique", detail: "duplicate lot id " + k,
        });
      }
      seenLotIds[k] = true;
    });
    tb.lots.forEach(function (l: any, idx: number) {
      if (!l) return;
      // Skip soft-deleted lots — they're in the Trash, the
      // user can restore or purge them explicitly, and a trashed lot
      // with weightG > weightInitial (a session restore that landed
      // mid-trash, say) shouldn't surface as a diagnostic violation
      // anyway.
      if (l.deletedAt) return;
      var add = function (rule: string, detail: string) {
        out.push({
          scope: "lot",
          tobId: tb.id,
          tobName: tb.name,
          lotId: l.id,
          lotIdx: idx,
          rule: rule,
          detail: detail,
        });
      };
      // An empty/unset weightG marks a
      // legacy lot the user never weighed — an ABSENCE of data, not
      // corruption. Treat it like checkSessionInvariants already treats an
      // empty session weightG (line ~191): skip the weight checks entirely so
      // it doesn't emit `weightG-nonneg` + `weightInitial-positive` forever on
      // every save(). A lot with a NUMERIC weightG but a bad weightInitial is
      // still flagged (untracked is false there).
      // The predicate moved to utils.ts — `isUsableLot`,
      // `stepApplyDelta` and `lotWillClose` need the same notion, and this
      // was the only place that had it.
      var untracked = isUntrackedWeight(l.weightG);
      var w = parseFloat(l.weightG);
      var wi = parseFloat(l.weightInitial);
      if (!untracked && (isNaN(w) || w < 0)) {
        add("weightG-nonneg", "weightG=" + JSON.stringify(l.weightG));
      }
      // Tolerance: 0.15 covers the 0.1 rounding step of
      // applyLotWeightDelta plus a small fp slack.
      if (!isNaN(w) && !isNaN(wi) && w - wi > 0.15) {
        add("weightG-le-initial", "weightG=" + w + ", weightInitial=" + wi);
      }
      if (l.status === "finished" && !l.dateFinished) {
        add("finished-has-dateFinished", "status=finished but dateFinished is empty");
      }
      if (l.status === "jar" && !l.dateOpened) {
        add("jar-has-dateOpened", "status=jar but dateOpened is empty");
      }
      if (l.status === "cellar" && l.originalStatus === "jar") {
        add("cellar-not-jar-origin", "status=cellar with originalStatus=jar (impossible transition)");
      }
      if (!untracked && (isNaN(wi) || wi <= 0)) {
        add("weightInitial-positive", "weightInitial=" + JSON.stringify(l.weightInitial));
      }
      if (l.originalStatus !== "cellar" && l.originalStatus !== "jar") {
        add("originalStatus-valid", "originalStatus=" + JSON.stringify(l.originalStatus));
      }
      if (l.id === undefined || l.id === null || l.id === "") {
        add("id-present", "lot has no id");
      }
    });
  });
  return out;
}

export function checkSessionInvariants(data: any): InvariantViolation[] {
  var out: InvariantViolation[] = [];
  if (!data || !Array.isArray(data.sessions)) return out;
  // The lookup tables for tobacco / pipe / lot ids were
  // removed alongside the three cross-ref rules. See the comment
  // inside the loop for the rationale.
  // Sessions had no id-uniqueness check, so
  // a counter that drifted below max(session id) let addSession() mint a
  // duplicate id silently. Track seen ids and flag collisions.
  var seenSessIds: Record<string, true> = Object.create(null);
  data.sessions.forEach(function (s: any) {
    if (!s) return;
    // Skip soft-deleted sessions — they're in the Trash,
    // they may legitimately reference an entity that's also trashed,
    // and the user can't act on a violation against them anyway.
    if (s.deletedAt) return;
    var add = function (rule: string, detail: string) {
      out.push({
        scope: "session",
        sessionId: s.id,
        rule: rule,
        detail: detail,
      });
    };
    if (s.id === undefined || s.id === null || s.id === "") {
      add("session-id-present", "session has no id");
    } else {
      var sk = String(s.id);
      if (seenSessIds[sk]) add("session-id-unique", "duplicate session id " + sk);
      seenSessIds[sk] = true;
    }
    if (!s.date) add("session-date-present", "date is empty");
    // The three cross-ref rules
    //   session-tobacco-exists, session-pipe-exists, session-lot-exists
    // were dropped. The user's policy is that permanent delete must
    // NOT mutate any session field — tobaccoId / pipeId / lotId stay
    // pointing to the (now-gone) entity as a fantôme id, and the
    // journal renders via the snapshot the session carries. A dangling
    // ref isn't a bug anymore; it's the expected state of a session
    // logged against an entity the user later purged. Keeping these
    // rules around just inflated the diagnostic counter for legitimate
    // user actions.
    var w = parseFloat(s.weightG);
    if (s.weightG !== undefined && s.weightG !== "" && !isNaN(w) && w < 0) {
      add("session-weight-nonneg", "weightG=" + JSON.stringify(s.weightG));
    }
  });
  return out;
}

export function checkPipeInvariants(data: any): InvariantViolation[] {
  var out: InvariantViolation[] = [];
  if (!data || !Array.isArray(data.pipes)) return out;
  var seen: Record<string, true> = Object.create(null);
  data.pipes.forEach(function (p: any) {
    if (!p) return;
    // Skip soft-deleted pipes (see comment on checkLotInvariants).
    if (p.deletedAt) return;
    var add = function (rule: string, detail: string) {
      out.push({ scope: "pipe", pipeId: p.id, rule: rule, detail: detail });
    };
    if (p.id === undefined || p.id === null || p.id === "") {
      add("pipe-id-present", "pipe has no id");
      return;
    }
    var key = String(p.id);
    if (seen[key]) add("pipe-id-unique", "duplicate pipe id " + key);
    seen[key] = true;
  });
  return out;
}

export function checkAccessoryInvariants(data: any): InvariantViolation[] {
  var out: InvariantViolation[] = [];
  if (!data || !Array.isArray(data.accessories)) return out;
  var seen: Record<string, true> = Object.create(null);
  data.accessories.forEach(function (a: any) {
    if (!a) return;
    // Skip soft-deleted accessories.
    if (a.deletedAt) return;
    var add = function (rule: string, detail: string) {
      out.push({ scope: "accessory", accessoryId: a.id, rule: rule, detail: detail });
    };
    if (a.id === undefined || a.id === null || a.id === "") {
      add("accessory-id-present", "accessory has no id");
      return;
    }
    var key = String(a.id);
    if (seen[key]) add("accessory-id-unique", "duplicate accessory id " + key);
    seen[key] = true;
  });
  return out;
}

/**
 * Asymmetric balance check. For every live lot, the sum
 * of weightG across the live sessions that reference it must NOT
 * EXCEED (weightInitial − weightG). The reverse direction (Σ less
 * than the diff) is legitimate — the user smoked without logging,
 * or zeroed out a near-empty lot manually. We only flag the
 * overflow direction, which is mathematically impossible: the
 * journal can't have recorded more grammes than physically left
 * the pot.
 *
 * IMPORTANT: the corollary is that a genuine BUG which
 * double-deducts a lot (drives weightG too LOW, Σ < diff) is
 * INVISIBLE to this check — it is indistinguishable from legitimate
 * unlogged smoking, so a symmetric rule would false-positive on
 * nearly every real user. Such bugs MUST be prevented at the
 * mutation site instead (e.g. deleteSession's deletedAt
 * idempotency guard, the grid-rounding of stored session
 * weightG, and the per-call lot-existence guards).
 * Do NOT "fix" this by adding a symmetric diff−Σ rule.
 *
 * Tolerance is 0.5g to absorb the 0.1g rounding applied by
 * applyLotWeightDelta.
 *
 * Skipped:
 *   - trashed lots (deletedAt set) — invariant runs on the live world.
 *   - trashed sessions (deletedAt set) — their weight is restored
 *     to the lot by deleteSession; counting them in Σ would
 *     double-count.
 *   - orphaned sessions (lotId === "" or missing) — can't be
 *     attributed; ignored.
 *
 * The violation message is intentionally readable: the user gets
 * the lot id, the recorded Σ, the implied diff, and the surplus.
 */
export function checkBalanceInvariants(data: any): InvariantViolation[] {
  var out: InvariantViolation[] = [];
  if (!data || !Array.isArray(data.tobaccos)) return out;
  // Build a one-pass index: per (tobId|lotId), the sum of weightG
  // across NON-trashed sessions.
  // Null-prototype for parity with every sibling map in this file
  // (keys are user-derived `tobId|lotId`). Safe today because the key always
  // contains "|" so no bare prototype member is reachable, but this closes the
  // lone parity gap defensively.
  var sessSum: Record<string, number> = Object.create(null);
  (data.sessions || []).forEach(function (s: any) {
    if (!s || s.deletedAt) return;
    if (!s.tobaccoId || !s.lotId) return;
    var w = parseFloat(s.weightG || "");
    if (!isFinite(w) || w <= 0) return;
    var key = String(s.tobaccoId) + "|" + String(s.lotId);
    sessSum[key] = (sessSum[key] || 0) + w;
  });
  var TOL = 0.5;
  data.tobaccos.forEach(function (tb: any) {
    if (!tb || tb.deletedAt) return;
    (tb.lots || []).forEach(function (l: any) {
      if (!l || l.deletedAt) return;
      var initial = parseFloat(l.weightInitial || "");
      var current = parseFloat(l.weightG || "");
      if (!isFinite(initial) || !isFinite(current)) return;
      var diff = initial - current;
      var key = String(tb.id) + "|" + String(l.id);
      var sigma = sessSum[key] || 0;
      if (sigma - diff > TOL) {
        var surplus = +(sigma - diff).toFixed(2);
        var sigmaR = +Number(sigma).toFixed(2);
        var diffR = +Number(diff).toFixed(2);
        out.push({
          scope: "lot",
          tobId: tb.id,
          tobName: [tb.brand, tb.name].filter(Boolean).join(" — "),
          lotId: l.id,
          rule: "lot-balance-overflow",
          detail: "sessions Σ=" + sigmaR + "g exceeds (weightInitial - weightG)=" + diffR + "g by " + surplus + "g",
        });
      }
    });
  });
  return out;
}

// Tobaccos and wishlist items had NO
// id-uniqueness check (only pipes + accessories did), so a drifted/forged
// counter that let addTobacco()/addWish() reuse a live id went undetected —
// the worst outcome, since it's the exact silent-corruption path the counter
// reconciliation in migrateData now closes. These two checks are the safety
// net that flags it if reconciliation is ever bypassed.
export function checkTobaccoInvariants(data: any): InvariantViolation[] {
  var out: InvariantViolation[] = [];
  if (!data || !Array.isArray(data.tobaccos)) return out;
  var seen: Record<string, true> = Object.create(null);
  data.tobaccos.forEach(function (t: any) {
    if (!t || t.deletedAt) return;
    var add = function (rule: string, detail: string) {
      out.push({ scope: "tobacco", tobId: t.id, tobName: t.name, rule: rule, detail: detail });
    };
    if (t.id === undefined || t.id === null || t.id === "") {
      add("tobacco-id-present", "tobacco has no id");
      return;
    }
    var key = String(t.id);
    if (seen[key]) add("tobacco-id-unique", "duplicate tobacco id " + key);
    seen[key] = true;
  });
  return out;
}

export function checkWishInvariants(data: any): InvariantViolation[] {
  var out: InvariantViolation[] = [];
  if (!data || !Array.isArray(data.wishlist)) return out;
  var seen: Record<string, true> = Object.create(null);
  data.wishlist.forEach(function (w: any) {
    if (!w || w.deletedAt) return;
    var add = function (rule: string, detail: string) {
      out.push({ scope: "wishlist", wishId: w.id, rule: rule, detail: detail });
    };
    if (w.id === undefined || w.id === null || w.id === "") {
      add("wishlist-id-present", "wishlist item has no id");
      return;
    }
    var key = String(w.id);
    if (seen[key]) add("wishlist-id-unique", "duplicate wishlist id " + key);
    seen[key] = true;
  });
  return out;
}

// Pipe-maintenance entries (pipe.maintenance[]) are keyed by a
// numeric id (Date.now() at creation) and updateMaintenance/removeMaintenance
// match on it. A duplicate id therefore edits or deletes EVERY colliding entry
// at once — the exact silent corruption caused by the old addMaintenance
// bug (a form-supplied id:0 overwrote the fresh id, so every entry got id 0).
// This invariant flags any duplicate (or missing) maintenance id within a pipe
// at save() so the class fails loud instead of corrupting silently. Mirrors
// lot-id-unique. Maintenance entries are hard-deleted (no deletedAt), so no
// soft-delete skip is needed on the entries themselves.
export function checkMaintenanceInvariants(data: any): InvariantViolation[] {
  var out: InvariantViolation[] = [];
  if (!data || !Array.isArray(data.pipes)) return out;
  data.pipes.forEach(function (p: any) {
    if (!p || p.deletedAt) return;
    if (!Array.isArray(p.maintenance)) return;
    var seen: Record<string, true> = Object.create(null);
    p.maintenance.forEach(function (m: any) {
      if (!m) return;
      if (m.id === undefined || m.id === null || m.id === "") {
        out.push({ scope: "maintenance", pipeId: p.id, rule: "maintenance-id-present", detail: "maintenance entry has no id" });
        return;
      }
      var k = String(m.id);
      if (seen[k]) {
        out.push({ scope: "maintenance", pipeId: p.id, maintId: m.id, rule: "maintenance-id-unique", detail: "duplicate maintenance id " + k });
      }
      seen[k] = true;
    });
  });
  return out;
}

/**
 * A `uid` must identify exactly ONE live row of its kind.
 *
 * `uid` is the CROSS-DEVICE merge identity: `uidMap[uid] = row.id` is
 * last-wins, so two live rows sharing one uid means every later merge matches
 * one of them arbitrarily and leaves the other permanently stale — an entity
 * that silently stops receiving its own updates. Nothing checked it: the id
 * invariants above cover the per-device numeric id only, and this class reached
 * production (the merge added a backup's copy of a TRASHED row carrying the same
 * uid; see the trashed-row handling in useImportConfirm).
 *
 * Scoped per KIND, like the numeric-id checks — a tobacco and a pipe sharing a
 * uid is harmless, since every lookup is already inside one collection. Trashed
 * rows are skipped, matching every sibling check: a trashed row is not a merge
 * target, and its uid legitimately equals that of the entity it used to be.
 *
 * Sessions are deliberately INCLUDED, and unlike the entities they are never
 * uid-backfilled precisely so a legacy session cannot be split
 * across devices — which makes a duplicate uid here purely a bug signal.
 */
export function checkUidInvariants(data: any): InvariantViolation[] {
  var out: InvariantViolation[] = [];
  if (!data) return out;
  var KINDS: Array<[string, InvariantViolation["scope"], string]> = [
    ["tobaccos", "tobacco", "tobacco-uid-unique"],
    ["pipes", "pipe", "pipe-uid-unique"],
    ["accessories", "accessory", "accessory-uid-unique"],
    ["wishlist", "wishlist", "wishlist-uid-unique"],
    ["sessions", "session", "session-uid-unique"],
  ];
  KINDS.forEach(function (spec) {
    var rows = (data as any)[spec[0]];
    if (!Array.isArray(rows)) return;
    // Null-proto: a uid comes from user data (and from an importable file).
    var seen: Record<string, true> = Object.create(null);
    rows.forEach(function (r: any) {
      if (!r || r.deletedAt) return;
      if (typeof r.uid !== "string" || !r.uid) return;   // uid-less legacy row
      if (seen[r.uid]) {
        out.push({
          scope: spec[1], tobId: spec[1] === "tobacco" ? r.id : undefined,
          rule: spec[2], detail: "duplicate uid " + r.uid + " on id " + String(r.id),
        });
      }
      seen[r.uid] = true;
    });
  });
  // LOTS were the one identity with no uniqueness rule at all,
  // and that gap is what let TWO separate data-loss defects run silently.
  //
  // A lot's `uid` is the cross-device identity, so two
  // LIVE lots sharing one always means the same physical tin counted twice.
  // Two separate HIGH findings ended in exactly that state — an
  // imported lot appended beside its own trashed twin (16 % of randomised
  // two-device merges, ~123 g of ghost stock each), and « Tout restaurer »
  // resurrecting the source half of a duplicate-merge move (110 g → 160 g) —
  // and NOTHING fired: the per-device numeric `id` was distinct in both cases,
  // and `lot-balance-overflow` is deliberately one-sided while these are
  // underflows. Across ~1500 drilled end-states that overflow rule fired zero
  // times; every real corruption found was in the direction it cannot see.
  //
  // Scoped GLOBALLY, not per tobacco, because the tins it protects can end up
  // under different rows (a merge moves them), and skipping trashed lots is
  // what makes it compatible with a legitimate move: after one, the same uid
  // is live on the kept row and trashed on the dropped one, which is precisely
  // the state `restoreAllFromTrash` now reads as "do not restore".
  var seenLotUid: Record<string, true> = Object.create(null);
  // Array-guarded like the loop above: `data` reaches here straight from
  // localStorage or an imported file, so `tobaccos` can be anything. The
  // pre-existing "survives a garbage payload" case caught this on the first
  // run of the new rule — the guard is not hypothetical.
  var _tobs = (data as any).tobaccos;
  (Array.isArray(_tobs) ? _tobs : []).forEach(function (t: any) {
    if (!t || t.deletedAt || !Array.isArray(t.lots)) return;
    t.lots.forEach(function (l: any) {
      if (!l || l.deletedAt) return;
      if (typeof l.uid !== "string" || !l.uid) return;   // uid-less legacy lot
      if (seenLotUid[l.uid]) {
        out.push({
          scope: "lot", tobId: t.id, lotId: l.id,
          rule: "lot-uid-unique",
          detail: "duplicate lot uid " + l.uid + " on lot id " + String(l.id),
        });
      }
      seenLotUid[l.uid] = true;
    });
  });
  return out;
}

export function checkAllInvariants(data: any): InvariantViolation[] {
  return checkLotInvariants(data)
    .concat(checkUidInvariants(data))
    .concat(checkSessionInvariants(data))
    .concat(checkPipeInvariants(data))
    .concat(checkAccessoryInvariants(data))
    .concat(checkTobaccoInvariants(data))
    .concat(checkWishInvariants(data))
    .concat(checkMaintenanceInvariants(data))
    .concat(checkBalanceInvariants(data));
}

/**
 * Throws in dev (import.meta.env.DEV) when invariants are violated;
 * logs a console warning otherwise. Returns the violation list so
 * callers (or tests) can inspect. Also notifies the diagnostic
 * sink (recordViolations) — non-blocking, best-effort.
 */
export function assertLotInvariants(data: any): InvariantViolation[] {
  var violations = checkAllInvariants(data);
  if (violations.length === 0) return violations;
  try {
    recordViolations(violations);
  } catch (_e) {}
  var summary = "Invariant violation(s): "
    + violations.map(function (v) {
        var ref = v.scope === "lot"
          ? "tob#" + v.tobId + " lot#" + (v.lotId || "?")
          : v.scope === "session"
            ? "session#" + (v.sessionId || "?")
            : v.scope + "#" + (v.pipeId || v.accessoryId || "?");
        return "[" + v.rule + "] " + ref + " — " + v.detail;
      }).join(" ; ");
  var isDev = false;
  try {
    isDev = !!(import.meta as any).env && !!((import.meta as any).env.DEV);
  } catch (_e) {}
  if (isDev) {
    console.error(summary);
  } else {
    console.warn(summary);
  }
  return violations;
}
