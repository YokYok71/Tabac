/**
 * User-defined tobacco tags / collections.
 *
 * Free-text labels the user attaches to tobaccos to build their own grouping
 * axis ("voyage", "cadeaux", "matin", "cellar 2030"…). Pure helpers only —
 * no React, no storage. Tags are a personal grouping field, NEVER an identity
 * key; two tobaccos can share any tag.
 */

export var MAX_TAGS_PER_ITEM = 20;
export var MAX_TAG_LEN = 30;

/**
 * Normalise a raw tags value into a clean string[]: keep strings only, trim,
 * collapse inner whitespace, drop empties, cap each to MAX_TAG_LEN, dedup
 * case-insensitively (first spelling wins), cap the count. Deterministic and
 * order-preserving so a round-trip through storage is stable.
 */
export function sanitizeTags(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  var out: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < raw.length; i++) {
    if (out.length >= MAX_TAGS_PER_ITEM) break;
    var v = raw[i];
    if (typeof v !== "string") continue;
    var t = String(v).replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.length > MAX_TAG_LEN) t = t.slice(0, MAX_TAG_LEN).trim();
    var k = String(t).toLowerCase();
    if (seen[k]) continue;
    seen[k] = true;
    out.push(t);
  }
  return out;
}

/** Case-insensitive membership test. */
export function tobaccoHasTag(tob: any, tag: any): boolean {
  if (!tob || !Array.isArray(tob.tags)) return false;
  var want = String(tag == null ? "" : tag).trim().toLowerCase();
  if (!want) return false;
  for (var i = 0; i < tob.tags.length; i++) {
    if (typeof tob.tags[i] === "string" && String(tob.tags[i]).trim().toLowerCase() === want) return true;
  }
  return false;
}

export interface TagCount { tag: string; count: number; }

/**
 * Distinct tags across the given tobaccos with their usage counts, sorted by
 * count desc then alphabetically. The display spelling is the most-frequent
 * spelling of each case-insensitive tag (ties → first seen). Soft-deleted
 * tobaccos are skipped. Pass live tobaccos.
 */
export function tagCounts(tobaccos: any): TagCount[] {
  var list = Array.isArray(tobaccos) ? tobaccos : [];
  // key(lowercase) → { count, spellings: {spelling: n} }
  var acc: Record<string, { count: number; spellings: Record<string, number> }> = Object.create(null);
  list.forEach(function (tob: any) {
    if (!tob || tob.deletedAt || !Array.isArray(tob.tags)) return;
    var seenInItem: Record<string, boolean> = Object.create(null);
    tob.tags.forEach(function (raw: any) {
      if (typeof raw !== "string") return;
      var t = String(raw).trim();
      if (!t) return;
      var k = t.toLowerCase();
      if (seenInItem[k]) return;   // count each tag once per tobacco
      seenInItem[k] = true;
      var e = acc[k] || (acc[k] = { count: 0, spellings: Object.create(null) });
      e.count += 1;
      e.spellings[t] = (e.spellings[t] || 0) + 1;
    });
  });
  var out: TagCount[] = Object.keys(acc).map(function (k) {
    var e = acc[k]!;
    // pick the most-frequent spelling
    var best = "", bestN = -1;
    Object.keys(e.spellings).forEach(function (sp) {
      var n = e.spellings[sp] || 0;
      if (n > bestN) { bestN = n; best = sp; }
    });
    return { tag: best, count: e.count };
  });
  out.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    var al = String(a.tag).toLowerCase(), bl = String(b.tag).toLowerCase();
    return al < bl ? -1 : al > bl ? 1 : 0;
  });
  return out;
}

/** Flat sorted list of distinct tag spellings (for suggestions / filter chips). */
export function allTags(tobaccos: any): string[] {
  return tagCounts(tobaccos).map(function (e) { return e.tag; });
}
