// Taste profile + personal recommendation.
//
// Synthesises the three signals the user already records — star ratings,
// tobacco family (category) and the aroma wheel — into a compact "who you
// are as a smoker" profile, plus the top-N tobaccos in the collection that
// best match it. Pure derivation from existing data; no new stored field,
// no network. Rendered as a "Votre profil" section on the Home screen.
//
// Scoring (documented so the ranking is auditable, not magic):
//   familyPts  = 3 / 2 / 1 for the user's #1 / #2 / #3 rated family, else 0
//   aromaOverlap = how many of the tobacco's own tapped aromas are in the
//                  user's signature aroma set
//   score = familyPts*2 + aromaOverlap*2 + rating   (family & aroma weigh 2,
//           the tobacco's own rating weighs 1 as a tie-breaker component)

import { sanitizeAromas } from "./aromas.ts";

export interface FamilyPref { category: string; avg: number; count: number; }
export interface AromaPref { key: string; count: number; }
export interface TasteMatch {
  tobaccoId: string;
  score: number;
  category: string;
  familyMatch: boolean;      // its family is one of the user's top-3
  matchedAromas: string[];   // signature aromas this tobacco also carries
}
export interface TasteProfile {
  families: FamilyPref[];    // categories ranked by average rating, desc
  aromas: AromaPref[];       // signature aromas (top 5), desc by frequency
  top: TasteMatch[];         // best-matching tobaccos, desc by score
  ratedCount: number;        // rated tobaccos that fed the family ranking
  aromaSessions: number;     // sessions carrying at least one aroma
}

// Sessions rated at least this high define the user's PREFERRED aromas
// (what they enjoy), falling back to all sessions when there are too few.
var FAV_RATING = 4;

export function computeTasteProfile(
  tobaccos: any[] | null | undefined,
  sessions: any[] | null | undefined,
  topN: number = 3,
): TasteProfile {
  var empty: TasteProfile = {
    families: [], aromas: [], top: [], ratedCount: 0, aromaSessions: 0,
  };
  if (!Array.isArray(tobaccos)) return empty;
  var sess = Array.isArray(sessions) ? sessions : [];

  // ── families ranked by average tobacco rating ────────────────────────────
  var famSum: Record<string, number> = Object.create(null);
  var famCnt: Record<string, number> = Object.create(null);
  var ratedCount = 0;
  tobaccos.forEach(function (t: any) {
    if (!t || t.deletedAt) return;
    var cat = String(t.category || "");
    if (!cat) return;
    var r = Number(t.rating);
    if (!(r > 0)) return;
    famSum[cat] = (famSum[cat] || 0) + r;
    famCnt[cat] = (famCnt[cat] || 0) + 1;
    ratedCount += 1;
  });
  var families: FamilyPref[] = Object.keys(famCnt).map(function (c) {
    var cnt = famCnt[c] as number;
    return { category: c, avg: Math.round(((famSum[c] as number) / cnt) * 10) / 10, count: cnt };
  }).sort(function (a, b) {
    if (b.avg !== a.avg) return b.avg - a.avg;
    if (b.count !== a.count) return b.count - a.count;
    return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
  });

  // ── signature aromas (prefer favourite sessions) ─────────────────────────
  function tally(rows: any[]): { items: AromaPref[]; tagged: number } {
    var counts: Record<string, number> = Object.create(null);
    var tagged = 0;
    rows.forEach(function (s: any) {
      var a = sanitizeAromas(s && s.aromas);
      if (a.length === 0) return;
      tagged += 1;
      a.forEach(function (k) { counts[k] = (counts[k] || 0) + 1; });
    });
    var items = Object.keys(counts).map(function (k) {
      return { key: k, count: counts[k] as number };
    }).sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    return { items: items, tagged: tagged };
  }
  var favTally = tally(sess.filter(function (s: any) { return s && Number(s.rating) >= FAV_RATING; }));
  var allTally = tally(sess);
  // Prefer the aromas of your favourite (>=4★) sessions; fall back to all
  // sessions only when there aren't enough favourites to be representative.
  var aromas = (favTally.tagged >= 3 ? favTally.items : allTally.items).slice(0, 5);
  var aromaSessions = allTally.tagged;

  // ── per-tobacco aroma sets ───────────────────────────────────────────────
  var aromaByTob: Record<string, Set<string>> = Object.create(null);
  sess.forEach(function (s: any) {
    if (!s || s.tobaccoId === undefined || s.tobaccoId === null) return;
    var a = sanitizeAromas(s.aromas);
    if (a.length === 0) return;
    var key = String(s.tobaccoId);
    if (!aromaByTob[key]) aromaByTob[key] = new Set<string>();
    var set = aromaByTob[key] as Set<string>;
    a.forEach(function (k) { set.add(k); });
  });

  // ── score every tobacco against the profile ──────────────────────────────
  // Object.create(null) — famRank is keyed by user category
  // values, so a forged category "constructor" would otherwise read an inherited
  // prototype member and score NaN (unstable sort). Parity with famSum/famCnt.
  var famRank: Record<string, number> = Object.create(null);
  families.slice(0, 3).forEach(function (f, i) { famRank[f.category] = 3 - i; });

  var matches: TasteMatch[] = [];
  tobaccos.forEach(function (t: any) {
    if (!t || t.id === undefined || t.deletedAt) return;
    var cat = String(t.category || "");
    var famPts = famRank[cat] || 0;
    var tset = aromaByTob[String(t.id)];
    var matched: string[] = [];
    if (tset) {
      var ts = tset;
      aromas.forEach(function (a) { if (ts.has(a.key)) matched.push(a.key); });
    }
    var rating = Number(t.rating);
    if (!(rating > 0)) rating = 0;
    var score = famPts * 2 + matched.length * 2 + rating;
    if (score <= 0) return;
    matches.push({
      tobaccoId: String(t.id), score: score, category: cat,
      familyMatch: famPts > 0, matchedAromas: matched,
    });
  });
  matches.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.tobaccoId < b.tobaccoId ? -1 : a.tobaccoId > b.tobaccoId ? 1 : 0;
  });

  return {
    families: families, aromas: aromas, top: matches.slice(0, topN),
    ratedCount: ratedCount, aromaSessions: aromaSessions,
  };
}
