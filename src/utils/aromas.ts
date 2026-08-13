// Aroma wheel.
//
// A structured, tappable vocabulary of aroma descriptors — the pipe-tobacco
// equivalent of a coffee / whisky flavour wheel — captured per session
// alongside the free-text notes and the star rating. Over many sessions the
// tags aggregate into the user's personal "taste profile" (StatsView).
//
// Keys are STABLE and canonical (never localized text): the session stores
// `["vanilla","leather"]`, and the UI resolves each key to a label via the
// aromaLabelKey() / groupLabelKey() helpers below (they build the i18n key,
// keeping the "aroma_" literal out of every t(...) call site so doc:check's
// key scanner isn't confused by the concatenation).
//
// Adding / renaming an aroma:
//   1. edit AROMA_WHEEL below (add the key to a group)
//   2. add the matching aroma_<key> entry to EVERY dictionary under src/i18n/
//      (doc:check enforces parity, so a missing one fails the gate)
//   3. that's it — the picker, the journal chips and the stats profile all
//      iterate the wheel, so no view code changes.

export interface AromaGroup {
  key: string;        // group id → groupLabelKey(key) → i18n
  aromas: string[];   // ordered aroma ids → aromaLabelKey(id) → i18n
}

// i18n key builders — keep the literal prefix here (not inline in t("…"+x))
// so the doc:check scanner never captures a partial "aroma_" key.
export function aromaLabelKey(key: string): string { return "aroma_" + key; }
export function groupLabelKey(key: string): string { return "aroma_group_" + key; }

// Six families, five descriptors each (30 total). Curated for pipe tobacco.
export var AROMA_WHEEL: AromaGroup[] = [
  { key: "sweet",  aromas: ["caramel", "honey", "vanilla", "chocolate", "molasses"] },
  { key: "fruity", aromas: ["citrus", "dried_fruit", "fig", "plum", "berry"] },
  { key: "spicy",  aromas: ["pepper", "clove", "nutmeg", "cinnamon", "anise"] },
  { key: "earthy", aromas: ["earthy", "leather", "wood", "hay", "mushroom"] },
  { key: "smoky",  aromas: ["smoky", "peat", "campfire", "tar", "incense"] },
  { key: "floral", aromas: ["floral", "grassy", "herbal", "tea", "nutty"] },
];

// Flat, ordered list of every valid aroma key.
export var ALL_AROMAS: string[] = AROMA_WHEEL.reduce<string[]>(
  function (acc, g) { return acc.concat(g.aromas); }, [],
);

var AROMA_SET: Record<string, true> = ALL_AROMAS.reduce<Record<string, true>>(
  function (acc, k) { acc[k] = true; return acc; }, {},
);

// True when `key` is a known aroma. Used to sanitise imported / legacy data
// so an unknown tag can't leak into the picker or the profile.
export function isValidAroma(key: any): boolean {
  return typeof key === "string" && AROMA_SET[key] === true;
}

// Normalises a raw value (session.aromas from any source) to a clean,
// de-duplicated array of valid aroma keys in wheel order.
export function sanitizeAromas(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  var seen: Record<string, true> = {};
  raw.forEach(function (k: any) { if (isValidAroma(k)) seen[k] = true; });
  return ALL_AROMAS.filter(function (k) { return seen[k] === true; });
}

// Index tobaccoId → the set of aroma keys aggregated across that
// tobacco's sessions. Powers the inventory aroma filter (and could feed any
// per-tobacco aroma lookup). Pure; keys are sanitised.
export function buildTobaccoAromaIndex(
  sessions: any[] | null | undefined,
): Record<string, Set<string>> {
  // Object.create(null) — a forged session with
  // `tobaccoId:"__proto__"` would otherwise make `idx[k]` resolve to
  // Object.prototype (truthy → the `new Set` init is skipped), and the
  // subsequent `set.add(x)` throws (Object.prototype has no `.add`),
  // crashing the filtered-inventory memo. Parity with tasteProfile.ts /
  // stats.ts, which already key user data through a null-proto map.
  var idx: Record<string, Set<string>> = Object.create(null);
  if (!Array.isArray(sessions)) return idx;
  sessions.forEach(function (s: any) {
    if (!s || s.tobaccoId === undefined || s.tobaccoId === null) return;
    var a = sanitizeAromas(s.aromas);
    if (a.length === 0) return;
    var k = String(s.tobaccoId);
    if (!idx[k]) idx[k] = new Set<string>();
    var set = idx[k] as Set<string>;
    a.forEach(function (x) { set.add(x); });
  });
  return idx;
}

// True when the tobacco's aggregated aromas include EVERY wanted key (AND).
// An empty want-list matches everything (filter inactive).
export function tobaccoMatchesAromas(
  idx: Record<string, Set<string>>,
  tobaccoId: any,
  wanted: string[] | null | undefined,
): boolean {
  if (!Array.isArray(wanted) || wanted.length === 0) return true;
  var set = idx[String(tobaccoId)];
  if (!set) return false;
  var ss = set;
  return wanted.every(function (x) { return ss.has(x); });
}
