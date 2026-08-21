// Pipe ghosting risk.
//
// "Ghosting" is a real pipe-smoking phenomenon: strong, aromatic or smoky
// tobaccos leave residue in the briar that carries its flavour into later
// smokes. A pipe used mostly for Latakia will taint a delicate Virginia
// smoked in it afterwards. Seasoned smokers "dedicate" a pipe to one family
// to avoid this.
//
// The app already knows what each pipe has smoked (sessions → tobacco →
// category), so it can warn — gently, non-blocking — when the user is about
// to smoke a different profile in a pipe that's clearly dedicated to a
// ghosting-prone family. Pure derivation from existing data; no new field.
//
// Consumed identically by SessionFormView and TastingView (the two session
// entry points MUST stay behaviourally identical), so the whole decision
// lives here.

// Strong / aromatic / smoky families whose residue ghosts a briar. Canonical
// French category values (see CATS in constants.ts). Latakia & Balkan &
// English carry smoke; Aromatics carry casing/topping; Orientals are pungent.
export var GHOSTING_FAMILIES: string[] = [
  "Latakia", "Balkan", "Anglais", "Aromatique", "Oriental",
];

// Need at least this many prior categorized sessions in the pipe before we
// claim a "dedication" — one or two smokes isn't a pattern.
var MIN_TOTAL = 3;
// The dominant family must be at least this fraction of the pipe's history
// to count as dedicated (a 50/50 pipe isn't ghosted to either).
var DOMINANT_SHARE = 0.6;

export interface GhostingRisk {
  dominant: string; // canonical category the pipe is dedicated to
  count: number;    // sessions of the dominant family in this pipe
  total: number;    // total categorized sessions in this pipe
}

// Returns a risk descriptor when smoking `tobaccoId` in `pipeId` would risk
// ghosting, or null when there's no meaningful risk (not enough history, no
// clear dedication, same family, or neither side is ghosting-prone).
export function computePipeGhostingRisk(
  pipeId: any,
  tobaccoId: any,
  sessions: any[] | null | undefined,
  tobaccos: any[] | null | undefined,
): GhostingRisk | null {
  if (pipeId === undefined || pipeId === null || pipeId === "") return null;
  if (tobaccoId === undefined || tobaccoId === null || tobaccoId === "") return null;
  if (!Array.isArray(sessions) || !Array.isArray(tobaccos)) return null;

  // Index tobaccoId → canonical category.
  var catByTob: Record<string, string> = {};
  tobaccos.forEach(function (t: any) {
    if (!t || t.id === undefined) return;
    catByTob[String(t.id)] = String(t.category || "");
  });

  var incoming = catByTob[String(tobaccoId)];
  if (!incoming) return null; // selected tobacco has no category to compare

  // Count categories smoked in this pipe across the passed session set.
  var counts: Record<string, number> = {};
  var total = 0;
  sessions.forEach(function (s: any) {
    if (!s) return;
    if (String(s.pipeId) !== String(pipeId)) return;
    var cat = catByTob[String(s.tobaccoId)];
    if (!cat) return;
    counts[cat] = (counts[cat] || 0) + 1;
    total += 1;
  });
  if (total < MIN_TOTAL) return null;

  // Dominant family.
  var dominant = "";
  var domCount = 0;
  Object.keys(counts).forEach(function (k) {
    var c = counts[k] as number;
    if (c > domCount) { domCount = c; dominant = k; }
  });
  if (!dominant) return null;
  if (domCount / total < DOMINANT_SHARE) return null;

  if (dominant === incoming) return null; // same family — no ghosting concern
  // Only warn when a ghosting-prone family is involved on either side, so we
  // don't nag about e.g. a Virginia pipe smoking a Burley (both mild).
  if (
    GHOSTING_FAMILIES.indexOf(dominant) === -1 &&
    GHOSTING_FAMILIES.indexOf(incoming) === -1
  ) return null;

  return { dominant: dominant, count: domCount, total: total };
}

// The persistent "usage profile" of a pipe — which tobacco families it has
// smoked, most-used first — shown on the pipe fiche. Ghosting is a property
// OF THE PIPE (its history), so this is where the concept lives permanently;
// the session-time warning above is just the point-of-action nudge derived
// from the same data.
export interface PipeFamilyCount { category: string; count: number; }
export interface PipeUsageProfile {
  families: PipeFamilyCount[]; // most-smoked family first
  total: number;               // total categorized sessions in this pipe
  dominant: string | null;     // most-smoked family (null when no history)
  dominantShare: number;       // dominant count / total, 0..1
  ghosted: boolean;            // clearly dedicated (>=3, >=60%) to a ghosting family
}

export function computePipeUsageProfile(
  pipeId: any,
  sessions: any[] | null | undefined,
  tobaccos: any[] | null | undefined,
): PipeUsageProfile {
  var empty: PipeUsageProfile = {
    families: [], total: 0, dominant: null, dominantShare: 0, ghosted: false,
  };
  if (pipeId === undefined || pipeId === null || pipeId === "") return empty;
  if (!Array.isArray(sessions) || !Array.isArray(tobaccos)) return empty;

  var catByTob: Record<string, string> = {};
  tobaccos.forEach(function (t: any) {
    if (!t || t.id === undefined) return;
    catByTob[String(t.id)] = String(t.category || "");
  });

  var counts: Record<string, number> = {};
  var total = 0;
  sessions.forEach(function (s: any) {
    if (!s) return;
    if (String(s.pipeId) !== String(pipeId)) return;
    var cat = catByTob[String(s.tobaccoId)];
    if (!cat) return;
    counts[cat] = (counts[cat] || 0) + 1;
    total += 1;
  });
  if (total === 0) return empty;

  var families: PipeFamilyCount[] = Object.keys(counts)
    .map(function (c) { return { category: c, count: counts[c] as number }; })
    .sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    });

  var top = families[0] as PipeFamilyCount;
  var share = top.count / total;
  var ghosted =
    total >= MIN_TOTAL &&
    share >= DOMINANT_SHARE &&
    GHOSTING_FAMILIES.indexOf(top.category) !== -1;

  return {
    families: families, total: total,
    dominant: top.category, dominantShare: share, ghosted: ghosted,
  };
}

/**
 * Does this pipe ACCORD with a tobacco family — i.e. is it dedicated to it?
 *
 * The positive counterpart of computePipeGhostingRisk, and the reason it lives
 * HERE rather than at the call site: it is the same dedication test
 * (MIN_TOTAL sessions, DOMINANT_SHARE of them in one family), and this repo
 * has paid four times over for a rule written a second time somewhere else.
 * The only difference is the direction — ghosting asks whether the incoming
 * tobacco CLASHES with what the pipe is used to, this asks whether it MATCHES.
 *
 * Note it does NOT require a ghosting-prone family: a pipe dedicated to
 * Virginia accords with Virginia just as much as a Latakia pipe does with
 * Latakia, even though Virginia leaves no ghost to worry about.
 *
 * Drives the Home's pipe suggestion (`preferIds` in suggestRestedPipe): among
 * the pipes rested enough to be offered, prefer one that suits tonight's bowl.
 */
export function pipeAccordsWithFamily(
  pipeId: any,
  category: string | null | undefined,
  sessions: any[] | null | undefined,
  tobaccos: any[] | null | undefined,
): boolean {
  var cat = String(category || "");
  if (!cat) return false;
  var prof = computePipeUsageProfile(pipeId, sessions, tobaccos);
  return prof.total >= MIN_TOTAL
    && prof.dominantShare >= DOMINANT_SHARE
    && prof.dominant === cat;
}
