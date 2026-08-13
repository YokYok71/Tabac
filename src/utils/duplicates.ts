// The duplicate finder, and the merge that heals it.
//
// WHY THIS EXISTS. `migrateData` backfills a RANDOM uid, so two devices that
// shared a cellar BEFORE uids existed mint different ones for the SAME row.
// The merge engine then correctly refuses to collapse them (a wrong collapse
// loses a row and cross-contaminates its lots and sessions, irreversibly) and
// adds a duplicate instead. The import recap makes that visible;
// it could not HEAL installs that had already diverged, because nothing in the
// data separates "one row whose identity diverged" from "two genuinely
// different items". Only the user knows. So this module finds the candidates
// and gives them the facts; the decision — and the merge — is theirs.
//
// Pure: no React, no storage, no network. The caller owns persistence.

import { monotonicId } from "../utils.ts";

export type DupKind = "tobacco" | "pipe" | "accessory" | "wishlist";

export interface DupMember {
  id: any;
  uid: string;
  /** Live lots (tobacco only). */
  lotCount: number;
  /** Sum of non-finished lot weights, as typed (tobacco only). */
  weight: number;
  /** Sessions pointing at this row (tobacco / pipe). */
  sessionCount: number;
  updatedAt: string;
  /** Non-empty inventory numbers on this row's live lots, in order. */
  boxNumbers: string[];
}

export interface DupGroup {
  kind: DupKind;
  /** Lowercased brand|name — the key the rows collide on. */
  key: string;
  brand: string;
  name: string;
  members: DupMember[];
  /**
   * Inventory numbers carried by ≥2 members of this group AND by nothing else
   * in the cellar (see `boxNumberTally`). Two lots under such a number are
   * almost certainly the same physical tin — the strongest signal available
   * here, because the user wrote it on the box by hand and it travelled through
   * the backups intact, where the machine-minted uid did not. A number the user
   * never really assigned (the add-form default sitting on dozens of jars) is
   * excluded by the cellar-wide count, so it can never pair unrelated tins.
   */
  sharedBoxNumbers: string[];
}

const _s = (v: any) => String(v == null ? "" : v).trim();

/**
 * How often each inventory number occurs across the WHOLE live cellar.
 *
 * The scope is the point, and it took two corrections to get right. Lots that
 * go to the cellar get an incrementing number; jars are not numbered — they end
 * up empty, or carrying the add-form's default. Reported by the user: most of
 * their jars read "1", the ones created early on, while newer lots increment
 * properly.
 *
 * A first version asked "does this number appear once among THIS row's lots?".
 * That is wrong exactly here: "1" appears once per row and on dozens of rows,
 * so it would have passed as identifying and paired tins that are not the same.
 * A number is only a label if it is RARE IN THE CELLAR, which is what
 * `nextBoxNumber` guarantees for properly incremented ones. Counting globally
 * also keeps the rule true if the form's default ever changes — hard-coding
 * "1" would not.
 */
export function boxNumberTally(data: any): Record<string, number> {
  const tally: Record<string, number> = Object.create(null);
  ((data && data.tobaccos) || []).forEach((tb: any) => {
    if (!tb || tb.deletedAt) return;
    (tb.lots || []).forEach((l: any) => {
      if (!l || l.deletedAt) return;
      const b = _s(l.boxNumber);
      if (!b) return;
      tally[b] = (tally[b] || 0) + 1;
    });
  });
  return tally;
}

/** Non-empty inventory numbers on a row's live lots, in order. */
export function rowBoxNumbers(lots: any[] | null | undefined): string[] {
  return (lots || [])
    .filter((l: any) => l && !l.deletedAt)
    .map((l: any) => _s(l.boxNumber))
    .filter((b: string) => !!b);
}

function _collectionOf(data: any, kind: DupKind): any[] {
  if (kind === "tobacco") return (data && data.tobaccos) || [];
  if (kind === "pipe") return (data && data.pipes) || [];
  if (kind === "accessory") return (data && data.accessories) || [];
  return (data && data.wishlist) || [];
}

/** How many live lots inside THIS group carry the number. */
function _groupOccurrences(rs: any[], box: string): number {
  let n = 0;
  rs.forEach((r: any) => { rowBoxNumbers(r.lots).forEach((b) => { if (b === box) n++; }); });
  return n;
}

function _dupKey(r: any): string {
  return String(_s(r && r.brand) + "|" + _s(r && r.name)).toLowerCase();
}

/**
 * Live rows of one kind that share a brand+name, grouped, with the facts a
 * human needs to decide. Rows in the trash are ignored: they are already on
 * their way out and merging into them would resurrect them.
 */
export function findDuplicateGroups(data: any, kind: DupKind): DupGroup[] {
  const rows = _collectionOf(data, kind).filter((r: any) => r && !r.deletedAt);
  const cellarTally = boxNumberTally(data);
  const sessions = ((data && data.sessions) || []).filter((s: any) => s && !s.deletedAt);
  const byKey: Record<string, any[]> = Object.create(null);
  rows.forEach((r: any) => {
    const k = _dupKey(r);
    // A row with neither brand nor name keys to "|" — that is not a duplicate
    // signal, it is missing data, and grouping on it would pile unrelated rows
    // together. Skip it.
    if (k === "|") return;
    (byKey[k] = byKey[k] || []).push(r);
  });
  const out: DupGroup[] = [];
  Object.keys(byKey).forEach((k) => {
    const rs = byKey[k]!;
    if (rs.length < 2) return;
    const members: DupMember[] = rs.map((r: any) => {
      const lots = (r.lots || []).filter((l: any) => l && !l.deletedAt);
      let weight = 0;
      lots.forEach((l: any) => {
        if (String(l.status) === "finished") return;
        const n = parseFloat(String(l.weightG || "").replace(",", "."));
        if (!isNaN(n) && n > 0) weight += n;
      });
      const sessionCount = sessions.filter((s: any) =>
        kind === "tobacco" ? String(s.tobaccoId) === String(r.id)
          : kind === "pipe" ? String(s.pipeId) === String(r.id)
            : false).length;
      return {
        id: r.id,
        uid: _s(r.uid),
        lotCount: lots.length,
        weight: Math.round(weight * 100) / 100,
        sessionCount,
        updatedAt: _s(r.updatedAt),
        boxNumbers: rowBoxNumbers(lots),
      };
    });
    // A number is a cross-member signal only when it occurs on ≥2 members of
    // THIS group AND nowhere else in the cellar. The second half is what keeps
    // a default like "1" out: it sits on dozens of rows, so its cellar-wide
    // count exceeds its count here and it never qualifies. A properly
    // incremented number appears exactly where the duplicate put it.
    const inGroup: Record<string, number> = Object.create(null);
    rs.forEach((r: any) => {
      const uniq: Record<string, true> = Object.create(null);
      rowBoxNumbers(r.lots).forEach((b) => { uniq[b] = true; });
      Object.keys(uniq).forEach((b) => { inGroup[b] = (inGroup[b] || 0) + 1; });
    });
    const sharedBoxNumbers = Object.keys(inGroup)
      .filter((b) => inGroup[b]! > 1 && (cellarTally[b] || 0) === _groupOccurrences(rs, b))
      .sort();
    out.push({
      kind, key: k,
      brand: _s(rs[0].brand), name: _s(rs[0].name),
      members, sharedBoxNumbers,
    });
  });
  return out.sort((a, b) => String(a.brand + a.name).localeCompare(String(b.brand + b.name)));
}

/** Total duplicate rows awaiting a decision, across all four kinds. */
export function duplicateCount(data: any): number {
  const kinds: DupKind[] = ["tobacco", "pipe", "accessory", "wishlist"];
  return kinds.reduce((acc, k) =>
    acc + findDuplicateGroups(data, k).reduce((a, g) => a + (g.members.length - 1), 0), 0);
}

export interface MergeDupResult {
  data: any;
  lotsMoved: number;
  sessionsRepointed: number;
  maintenanceMoved: number;
  droppedIds: any[];
}

/**
 * Merge `dropIds` into `keepId`, within one kind.
 *
 * What moves: a tobacco's LOTS and a pipe's MAINTENANCE entries are carried
 * over; sessions pointing at a dropped row are repointed at the kept one, and
 * a session's `lotId` follows its lot to the new id.
 *
 * What does NOT move: the kept row's own descriptive fields win outright. This
 * is a user-driven action on rows they have just compared side by side, so a
 * field-level reconciliation would be second-guessing a choice already made.
 *
 * INVENTORY NUMBERS ARE NEVER REWRITTEN. The number is written on the physical
 * tin; renumbering here would desynchronise the app from the shelf. Two moved
 * lots may therefore end up sharing a number — which is exactly the signal that
 * they are the same tin, and is left visible for the user to resolve.
 *
 * Dropped rows are SOFT-deleted, so the 30-day trash is the undo. Pure: returns
 * a new data object, mutates nothing.
 */
export function mergeDuplicates(
  data: any,
  kind: DupKind,
  keepId: any,
  dropIds: any[],
): MergeDupResult {
  const drop = (dropIds || []).map((x) => String(x)).filter((x) => x !== String(keepId));
  const res: MergeDupResult = {
    data, lotsMoved: 0, sessionsRepointed: 0, maintenanceMoved: 0, droppedIds: [],
  };
  if (!data || drop.length === 0) return res;

  const next = Object.assign({}, data);
  const listKey = kind === "tobacco" ? "tobaccos"
    : kind === "pipe" ? "pipes"
      : kind === "accessory" ? "accessories" : "wishlist";
  const rows = (next[listKey] || []).slice();
  const keepIdx = rows.findIndex((r: any) => r && String(r.id) === String(keepId) && !r.deletedAt);
  if (keepIdx < 0) return res;

  // lot id remap, so a session's lotId can follow its lot.
  const lotRemap: Record<string, any> = Object.create(null);
  let keep = Object.assign({}, rows[keepIdx]);

  drop.forEach((did) => {
    const i = rows.findIndex((r: any) => r && String(r.id) === did && !r.deletedAt);
    if (i < 0) return;
    const src = rows[i];
    const stamp = new Date().toISOString();
    // Fields to patch onto the dropped row alongside its deletedAt. Collected
    // rather than assigned to `src`, which IS the caller's object (`rows` is a
    // shallow array copy) — this module promises to mutate nothing.
    const srcPatch: any = { deletedAt: stamp };
    if (kind === "tobacco") {
      const moved = (src.lots || []).filter((l: any) => l && !l.deletedAt).map((l: any) => {
        const nid = monotonicId();
        if (l.id !== undefined && l.id !== "") lotRemap[did + ":" + String(l.id)] = nid;
        res.lotsMoved++;
        // boxNumber carried VERBATIM — see the note above.
        return Object.assign({}, l, { id: nid });
      });
      if (moved.length) keep = Object.assign({}, keep, { lots: (keep.lots || []).concat(moved) });
      // This is a MOVE, so the source's live lots must stop being
      // live. It used to be a COPY — the lots were re-stamped onto the kept row
      // and left untouched on the dropped one — and the trash is documented as
      // this merge's undo, so restoring the dropped row (one tap, no warning)
      // put the SAME physical tins in the cellar twice. Measured on the test
      // fixture: 150 g of live stock where there were 100.
      // SOFT-deleted, not removed: the trashed row still records what it held,
      // so nothing is destroyed that the user could not get back. They stay
      // hidden while the parent is trashed (TrashModal lists a soft-deleted lot
      // only when its parent tobacco is live — invariant #22), so this adds no
      // noise to the trash.
      srcPatch.lots = (src.lots || []).map((l: any) =>
        (l && !l.deletedAt) ? Object.assign({}, l, { deletedAt: stamp }) : l);
    } else if (kind === "pipe") {
      const moved = (src.maintenance || []).filter((m: any) => !!m).map((m: any) => {
        res.maintenanceMoved++;
        return Object.assign({}, m, { id: monotonicId() });
      });
      if (moved.length) {
        keep = Object.assign({}, keep, { maintenance: (keep.maintenance || []).concat(moved) });
      }
    }
    rows[i] = Object.assign({}, src, srcPatch);
    res.droppedIds.push(src.id);
  });

  rows[keepIdx] = keep;
  next[listKey] = rows;

  if (kind === "tobacco" || kind === "pipe") {
    const field = kind === "tobacco" ? "tobaccoId" : "pipeId";
    next.sessions = ((next.sessions || []) as any[]).map((s: any) => {
      if (!s) return s;
      const owner = String(s[field]);
      if (drop.indexOf(owner) < 0) return s;
      const patch: any = {};
      patch[field] = keepId;
      if (kind === "tobacco" && s.lotId !== undefined && s.lotId !== "") {
        const mapped = lotRemap[owner + ":" + String(s.lotId)];
        // A session whose lot did not come across (already trashed) would keep
        // a dangling id, so clear it — the standing rule: keep a lot reference
        // only when it is provably still the right lot.
        patch.lotId = mapped !== undefined ? mapped : "";
      }
      res.sessionsRepointed++;
      return Object.assign({}, s, patch);
    });
  }

  res.data = next;
  return res;
}
