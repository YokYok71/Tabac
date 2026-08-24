import type { Tobacco, Lot, Pipe, WishlistItem, Accessory, Session, AppData } from "./types";

export var SK = "pipe-cellar-v6";
// Schema version stamped into every export / backup. Reads
// the suffix of `SK` so they stay in lock-step. Strip in
// useImportConfirm.stageImport. Future migrations can branch on this
// instead of guessing.
// The first-run flag. It was duplicated as three separate local
// consts (WelcomeModal / StartupNoticeModal / ThemeModeNoticeModal) plus one
// bare inline literal in Overlays.tsx, while every neighbouring storage key
// lives here. It is the SEQUENCING gate for every launch-time pop-up, so a
// rename in one place silently inverts three others — either a new user gets
// the welcome modal, the broadcast notice AND the language toast stacked on
// first launch, or the announcements never fire again.
export var WELCOME_KEY = "cave-curator-welcomed";

export var SCHEMA_VERSION = "v6";
import { langAssets } from "./i18n/languages.ts";

export var APP_VERSION = "1.0";

/**
 * The UPDATE EPOCH, and the only thing that survives a
 * version renumbering.
 *
 * `isRemoteNewer` refuses a version DOWNGRADE, deliberately: that guard
 * exists because a rolled-back or partially-deployed `version.json` drove
 * an infinite purge-and-reload loop. The consequence nobody had needed until
 * now is that the display version is a ONE-WAY RATCHET — publish 1.0 over a
 * 1.5 and every installed client computes `1.0 < 1.5` and never offers it.
 *
 * MEASURED, and it is why this is a small field rather than a big worry: the
 * service worker serves HTML network-first (`sw.js`), so a relaunch
 * while online fetches the new `index.html` and its content-hashed chunks
 * WITHOUT consulting this comparison at all. A downgrade therefore strands
 * nobody — it only silences the in-session flow (the pill, the countdown, the
 * silent data-only path) until the user happens to cold-start. That gap is
 * small and invisible, which is exactly the kind worth closing before it is
 * needed rather than during.
 *
 * So: a monotonic integer, compared BEFORE version and build. **Bump it IN the
 * renumbering release itself, not in the one before.** Worked through: a client
 * on generation 1 sees generation 2 and accepts, whatever the version says, so
 * one release is enough. Bumping it EARLY is worse than useless — the client
 * would adopt generation 2 first, and the renumbering release would then land
 * on an EQUAL generation and fall through to the version comparison, which is
 * the refusal this field exists to bypass. The comment here said the opposite
 * until it was walked through; do not restore it.
 *
 * It is NOT a second version number and must never be shown to a user: the
 * only question it answers is "is the server's app a later generation of this
 * app than the one I am running". Bump it ONLY when the version number is
 * about to move backwards or restart.
 */
export var APP_GENERATION = 2;
export var APP_BUILD = "48";

export var CATS = ["Américain","Anglais","Anglais aromatique","Aromatique","Balkan","Burley","Cavendish","Cigare","Dark Fired","Écossais","Lakeland","Latakia","Oriental","Perique","Turkish","VaPer","Virginia","Virginia/Burley","Virginia/Latakia","Autre"] as const;
export var CATS_EN: Record<string, string> = {"Américain":"American",Anglais:"English","Anglais aromatique":"English aromatic",Aromatique:"Aromatic",Balkan:"Balkan",Burley:"Burley",Cavendish:"Cavendish",Cigare:"Cigar","Dark Fired":"Dark Fired","Écossais":"Scottish",Lakeland:"Lakeland",Latakia:"Latakia",Oriental:"Oriental",Perique:"Perique",Turkish:"Turkish",VaPer:"VaPer",Virginia:"Virginia","Virginia/Burley":"Virginia/Burley","Virginia/Latakia":"Virginia/Latakia",Autre:"Other"};
export var CATS_ES: Record<string, string> = {Cigare:"Cigarro","Américain":"Americano",Anglais:"Inglés","Anglais aromatique":"Inglés aromático",Aromatique:"Aromático","Écossais":"Escocés",Turkish:"Turco",Autre:"Otro"};
export var CATS_DE: Record<string, string> = {Cigare:"Zigarre","Américain":"Amerikanisch",Anglais:"Englisch","Anglais aromatique":"Englisch-Aromatisch",Aromatique:"Aromatisch","Écossais":"Schottisch",Turkish:"Türkisch",Autre:"Andere"};
export var CATS_IT: Record<string, string> = {Cigare:"Sigaro","Américain":"Americano",Anglais:"Inglese","Anglais aromatique":"Inglese aromatico",Aromatique:"Aromatico","Écossais":"Scozzese",Oriental:"Orientale",Turkish:"Turco",Autre:"Altro"};
export var CATS_PT: Record<string, string> = {Cigare:"Cigarro","Américain":"Americano",Anglais:"Inglês","Anglais aromatique":"Inglês aromático",Aromatique:"Aromático","Écossais":"Escocês",Turkish:"Turco",Autre:"Outro"};
export var CUTS = ["Broken Flake","Coarse Cut","Coins","Crumble Cake","Cube Cut","Curly Cut","Flake","Loose Cut","Plug","Pressed","Ready Rubbed","Ribbon","Rope","Rough Cut","Shag","Sliced","Twist","Autre"] as const;
export var CUTS_EN: Record<string, string> = {Autre:"Other"};
export var CUTS_ES: Record<string, string> = {Autre:"Otro"};
export var CUTS_DE: Record<string, string> = {Autre:"Andere"};
export var CUTS_IT: Record<string, string> = {Autre:"Altro"};
export var CUTS_PT: Record<string, string> = {Autre:"Outro"};

// ─────────────────────────────────────────────────────────────────────────────
// CAT_MAP / CUT_MAP — the IMPORT CONTRACT: aliases a source or a reviewer may
// write, mapped onto the canonical CATS / CUTS value above.
//
// These lived in a Node catalogue checker before they lived here, and the ONE
// rule to carry forward is: should a Node consumer of them ever return, PARSE
// them back out of this file — do NOT mirror them. A hand-kept second copy is
// the drift this repo has paid for four times (the tag predicate in four
// copies, `FAMILY_AGING_MAX` in the importer, `CATS` in the validator,
// `PIPE_MAX_EXTRA_PHOTOS` in three places), every one of them under a comment
// asking a human to keep two lists in step. `enumMapsSingleSource.test.ts`
// records the three cases that used to guard that arrangement, and why they
// were removed when the last Node reader went.
//
// NULL-PROTOTYPE, and here that is a correctness requirement rather than the
// house style: these are indexed by a string that now comes from a USER-SUPPLIED
// FILE, so on a plain object a row carrying `category: "constructor"` would
// resolve to a member of `Object.prototype` — truthy, not a category, and it
// would defeat the `MAP[c] || c` fallback the two `map*` helpers are built on.
// `tabac-local/no-dynamic-index-plain-map` enforces the shape.
export var CAT_MAP: Record<string, string> = Object.assign(Object.create(null), {
  "Périque": "Perique",
  // Nothing here may shadow a value that is ALREADY canonical (asserted) —
  // these are the ALIASES a source or a reviewer may write, mapped onto the
  // canonical French value. English ones earn their place because whoever
  // fills in a catalogue reads English product pages.
  "Cigar": "Cigare",
  "Cigar Leaf": "Cigare",
  "American": "Américain",
  "Americain": "Américain",
  "Virginia/Cigar": "Cigare",
  // `Anglais aromatique`. Smokingpipes runs a whole
  // "English Aromatics" category and The Country Squire labels products
  // "(English Aromatic)", so the reviewer will write one of these spellings.
  "English Aromatic": "Anglais aromatique",
  "English Aromatics": "Anglais aromatique",
  "Aromatic English": "Anglais aromatique",
  "English/Aromatic": "Anglais aromatique",
  "Anglais Aromatique": "Anglais aromatique",
});
export var CUT_MAP: Record<string, string> = Object.assign(Object.create(null), {
  "Cake": "Crumble Cake",
  "Cavendish": "Loose Cut",
  "Coin": "Coins",
  "Cross Cut": "Ribbon",
  // `Twist` is a CANONICAL cut now, so the alias is gone. It
  // was folded onto Rope because the two are the same construction — leaves
  // layered and spun tight — but that is an argument for the same DENSITY, not
  // for the same name: the trade sells them as two products, and the fold made
  // a twist unnameable in the entry form. Exactly the `Coarse Cut` shape.
  //
  // `Navy Cut` is a PREPARATION TRADITION, not a cut geometry —
  // leaves pressed into a plug or roll (historically with rum) and then sliced.
  // Its OUTPUT is a flake, which the enum already represents, so this is a
  // mapping and NOT a promotion to canonical. Deliberately the opposite call
  // from `Coarse Cut` and `Twist`, and the test is the same one:
  // does the label name an object the app CANNOT represent? A navy cut is how
  // a flake was made. The density confirms it — a pressed-then-sliced Virginia
  // is Flake's 0.25, so a separate CUT_DENSITY entry would duplicate a row.
  // Sources: Wikipedia "Navy cut tobacco"; Dutch Pipe Smoker, "Cut, cut, cut!".
  "Navy Cut": "Flake",
  "Navy Flake": "Flake",
  "Mixed": "Loose Cut",
  "Long Cut": "Loose Cut",
  "Krumble Kake": "Crumble Cake",
  "Roll Cake": "Crumble Cake",
  "Roll Cut": "Coins",
  "Cube": "Cube Cut",
  "Loose cut": "Loose Cut",
  "Ready rubbed": "Ready Rubbed",
  "Loose cut + ready rubbed": "Loose Cut",
  "Ready rubbed + broad ribbon": "Ready Rubbed",
  "Broad Cut": "Loose Cut",
  "Wild Cut": "Rough Cut",
  "Granulated": "Loose Cut",
  "Mixture": "Loose Cut",
});

// THE VALUE A FILE MAY CARRY IS THE VALUE THE FORM OFFERS. The two
// maps above hold the trade labels a source writes; this fold adds the labels
// the APP ITSELF shows. Without it the entry form and the import contract
// disagreed: the form imposes a closed list rendered through `xl()`, so a
// Spanish user picks « Cigarro » on screen — and writing that same word into a
// catalogue CSV was refused, because canonicalisation folded against `CATS`
// (French) and the English aliases alone. MEASURED at the time: 26 of the
// values the guide listed, across the five non-French languages, were ones the
// app rejected. A user cannot be asked to write a word their app never shows
// them.
//
// DERIVED, never typed. The per-language maps ARE the dropdown, so reading them
// here is what stops the two drifting — the failure this repo has paid for with
// `FAMILY_AGING_MAX` mirrored into an importer and `CATS` copied into a
// validator. A new language, or a relabelled value, reaches the import contract
// with no edit here.
//
// Nothing skips a collision on purpose: a translation that lands on an
// already-canonical value must fail LOUDLY in `enumMapsSingleSource.test.ts`
// rather than be silently dropped here, since `mapCategory` reads these maps
// directly and would otherwise misroute it. Canonical values still win inside
// `buildCanon`, which appends them last.
(function foldDisplayLabelsIntoImportMaps() {
  var pairs: [Record<string, string>, Record<string, string>[]][] = [
    [CAT_MAP, [CATS_EN, CATS_ES, CATS_DE, CATS_IT, CATS_PT]],
    [CUT_MAP, [CUTS_EN, CUTS_ES, CUTS_DE, CUTS_IT, CUTS_PT]],
  ];
  for (var i = 0; i < pairs.length; i++) {
    var target = pairs[i]![0], sources = pairs[i]![1];
    for (var j = 0; j < sources.length; j++) {
      var m = sources[j]!;
      for (var canonical in m) {
        var label = m[canonical];
        if (!label || label === canonical) continue;
        if (target[label] === undefined) target[label] = canonical;
      }
    }
  }
})();

/** Canonicalise a delivered / user-supplied category label. Unknown labels are
 *  returned VERBATIM — the CALLER decides whether that is a defect. The one
 *  consumer left is the browser importer, which keeps the label and reports
 *  the row, so the user can see what their own file said. */
export function mapCategory(c: string): string { return CAT_MAP[c] || c; }
/** Canonicalise a delivered / user-supplied cut label. Same contract. */
export function mapCut(c: string): string { return CUT_MAP[c] || c; }

/**
 * THE canonicaliser for a taxonomy label arriving from
 * outside the app. Returns the canonical `CATS` / `CUTS` value, or **null**
 * when the cellar cannot represent the label.
 *
 * WHY IT EXISTS. The catalogue is the USER'S OWN FILE, and
 * `parseCatalogueCsv` deliberately keeps an unrecognised label VERBATIM
 * (silently rewriting someone's vocabulary is worse than reporting it). Both
 * catalogue→cellar writers — `applyCataloguePlan` and `useDbSync` — copied
 * `category` / `cut` straight across, so a catalogue row saying `Pipeweed` /
 * `Zigzag Cut` landed verbatim in the cellar. Reproduced. From there it is
 * the unrepresentable-value defect: no `CUT_DENSITY` for the session bowl-weight estimate,
 * no `xl()` translation (the raw string renders in all six languages), no
 * `FAMILY_AGING_MAX` entry so the blend loses its maturity band entirely, and
 * no matching option in the form's fixed dropdown — so the first time the user
 * opens and saves that fiche, the app rewrites the value itself.
 *
 * NULL, not "Autre", and that is the load-bearing choice: the bulk pass's
 * whole promise is that personal data is never overwritten, so replacing a
 * correct category with `Autre` because the catalogue is approximate would be
 * a downgrade — and on an EMPTY field `Autre` adds nothing anyway. The rule
 * the callers implement is therefore: *a catalogue value the cellar cannot
 * represent is not applied.*
 *
 * FOLD-TOLERANT for the same reason `csvImport` is: the input is hand-filled,
 * so `anglais` and `Anglais` are the same answer. `mapCategory` / `mapCut`
 * stay EXACT because they answer a different question — *is this the trade
 * label the contract knows?* — and widening them would quietly turn a typo
 * into a match, which is the caller's judgement to make, not the map's.
 */
function foldLabel(s: any): string {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
}
function buildCanon(list: readonly string[], map: Record<string, string>): Record<string, string> {
  // Null-proto: the key comes from a user-supplied file, so on a plain object
  // a label of "constructor" would resolve to a member of Object.prototype.
  var out: Record<string, string> = Object.create(null);
  // The MAP first, the canonical list SECOND, so a list value always wins over
  // a map entry that happens to fold onto it. (`enumMapsSingleSource.test.ts`
  // already forbids a map key shadowing a canonical value, so this only makes
  // the precedence explicit rather than incidental.)
  for (var k in map) out[foldLabel(k)] = map[k] as string;
  for (var i = 0; i < list.length; i++) out[foldLabel(list[i])] = list[i] as string;
  return out;
}
var _CANON_CAT = buildCanon(CATS, CAT_MAP as unknown as Record<string, string>);
var _CANON_CUT = buildCanon(CUTS, CUT_MAP as unknown as Record<string, string>);

/** Canonical category, or null when the app cannot represent the label.
 *  An EMPTY value is null too — there is nothing to apply. */
export function canonCategory(v: any): string | null {
  var f = foldLabel(v);
  return f ? (_CANON_CAT[f] || null) : null;
}
/** Canonical cut, or null. Same contract. */
export function canonCut(v: any): string | null {
  var f = foldLabel(v);
  return f ? (_CANON_CUT[f] || null) : null;
}
export var SHAPES = ["Acorn","Apple","Author","Ball","Barrel","Belge","Bent Apple","Bent Billiard","Bent Bulldog","Billiard","Blowfish","Brandy","Bullcap","Bulldog","Bullmoose","Calabash","Canadian","Cavalier","Cherrywood","Chimney","Churchwarden","Cobra","Cutty","Dawes","Diplomat","Dublin","Duke","Egg","Elephant Foot","Freehand","Gourd Calabash","Hawkbill","Horn","Liverpool","Lovat","Lumberman","Midwakh","Nautilus","Nose Warmer","Oom Paul","Oval","Panel","Pear","Pickaxe","Poker","Pot","Prince","Reverse Calabash","Rhodesian","Round Apple","Sebsi","Sitter","Skater","Stack","Straight Rhodesian","Tavern","Tomato","Tulipe","Ukelele","Vest Pocket","Volcano","Wide Apple","Woodstock","Zulu","Autre"] as const;
// Pipe-shape families for the grouped <optgroup> select in the pipe
// form. THE single source of truth — every SHAPES value must appear in exactly
// one group (locked by constants.test.ts). Group labels resolve via
// t("shape_family_<key>"); member labels via xl(shape, SHAPES_EN). Add a new
// shape to both SHAPES and the matching group here.
export var SHAPE_FAMILIES: { key: string; shapes: string[] }[] = [
  { key: "billiard", shapes: ["Barrel", "Belge", "Bent Billiard", "Billiard", "Canadian", "Cherrywood", "Chimney", "Diplomat", "Duke", "Liverpool", "Lovat", "Lumberman", "Panel", "Poker", "Pot", "Stack"] },
  { key: "round", shapes: ["Apple", "Author", "Ball", "Bent Apple", "Brandy", "Egg", "Prince", "Round Apple", "Tomato", "Wide Apple"] },
  { key: "dublin", shapes: ["Acorn", "Cutty", "Dublin", "Horn", "Pear", "Pickaxe", "Tulipe", "Volcano", "Woodstock", "Zulu"] },
  { key: "bulldog", shapes: ["Bent Bulldog", "Bullcap", "Bulldog", "Bullmoose", "Rhodesian", "Straight Rhodesian"] },
  { key: "calabash", shapes: ["Calabash", "Gourd Calabash", "Reverse Calabash"] },
  // Keyed on the AXIS, not one end of it. This group held
  // "Longues (lecture)" — and a Nose Warmer (fr brûle-gueule, lit. "face
  // burner") is the SHORTEST pipe there is: the bowl sits under your nose.
  // Filing it under "long, for reading" was backwards twice over. The two
  // belong together all the same, and the sources say why: both are defined
  // by LENGTH ALONE and not by bowl form — smokingpipes, "the only
  // requirement for a pipe to be considered a Churchwarden is its length",
  // and "a Nosewarmer is virtually any pipe short enough to almost warm the
  // nose … can manifest almost any shape". So the group is right and its
  // NAME was wrong; it now names both ends.
  { key: "length", shapes: ["Churchwarden", "Nose Warmer"] },
  { key: "fancy", shapes: ["Blowfish", "Cavalier", "Cobra", "Dawes", "Elephant Foot", "Freehand", "Hawkbill", "Nautilus", "Oval", "Sitter", "Skater", "Ukelele", "Vest Pocket"] },
  { key: "regional", shapes: ["Midwakh", "Oom Paul", "Sebsi", "Tavern"] },
  { key: "other", shapes: ["Autre"] },
];
// Grouped <optgroup> partitions for the other long form selects —
// tobacco category (tobacco + wishlist forms) and pipe bowl/stem material (pipe
// form). Each MUST cover its enum exactly once (locked by constants.test.ts).
// `labelKey` resolves via t(); member labels via xl(value, <ENUM>_EN). The
// shared `fam_other` key labels every trailing "Autre" group.
export var CAT_FAMILIES: { labelKey: string; values: string[] }[] = [
  { labelKey: "cat_fam_virginia", values: ["Virginia", "VaPer", "Virginia/Burley", "Virginia/Latakia"] },
  { labelKey: "cat_fam_burley", values: ["Burley", "Américain"] },
  { labelKey: "cat_fam_english", values: ["Anglais", "Balkan", "Latakia", "Oriental", "Turkish", "Écossais"] },
  { labelKey: "cat_fam_aromatic", values: ["Anglais aromatique", "Aromatique", "Cavendish", "Lakeland"] },
  { labelKey: "cat_fam_robust", values: ["Dark Fired", "Perique", "Cigare"] },
  { labelKey: "fam_other", values: ["Autre"] },
];
export var BOWL_MAT_FAMILIES: { labelKey: string; values: string[] }[] = [
  { labelKey: "bowlmat_fam_wood", values: ["Bambou", "Bruyère", "Cerisier", "Chêne", "Érable", "Morta", "Noyer", "Olivier", "Poirier"] },
  { labelKey: "bowlmat_fam_mineral", values: ["Argile", "Meerschaum", "Métal", "Pierre (stéatite)", "Porcelaine"] },
  { labelKey: "bowlmat_fam_organic", values: ["Maïs", "Os"] },
  { labelKey: "fam_other", values: ["Autre"] },
];
export var STEM_MAT_FAMILIES: { labelKey: string; values: string[] }[] = [
  { labelKey: "stemmat_fam_natural", values: ["Ambre", "Bois", "Canne", "Corne", "Os"] },
  { labelKey: "stemmat_fam_synthetic", values: ["Acrylique", "Cumberland", "Delrin", "Ivoirite", "Lucite", "Ébonite"] },
  { labelKey: "fam_other", values: ["Autre"] },
];
// Tobacco-cut families (tobacco + wishlist forms).
export var CUT_FAMILIES: { labelKey: string; values: string[] }[] = [
  { labelKey: "cut_fam_pressed", values: ["Broken Flake", "Crumble Cake", "Flake", "Plug", "Pressed", "Sliced"] },
  { labelKey: "cut_fam_spun", values: ["Coins", "Curly Cut", "Rope", "Twist"] },
  { labelKey: "cut_fam_loose", values: ["Coarse Cut", "Cube Cut", "Loose Cut", "Ready Rubbed", "Ribbon", "Rough Cut", "Shag"] },
  { labelKey: "fam_other", values: ["Autre"] },
];
export var SHAPES_EN: Record<string, string> = {Tulipe:"Tulip",Autre:"Other"};
export var SHAPES_ES: Record<string, string> = {Tulipe:"Tulipán",Autre:"Otro"};
export var SHAPES_DE: Record<string, string> = {Tulipe:"Tulpe",Autre:"Andere"};
export var SHAPES_IT: Record<string, string> = {Tulipe:"Tulipano",Autre:"Altro"};
export var SHAPES_PT: Record<string, string> = {Tulipe:"Tulipa",Autre:"Outro"};
export var BENDS = ["Droite","Semi-courbée","Courbée"] as const;
export var BENDS_EN: Record<string, string> = {Droite:"Straight","Semi-courbée":"Semi-bent","Courbée":"Bent"};
export var BENDS_ES: Record<string, string> = {Droite:"Recta","Semi-courbée":"Semicurva","Courbée":"Curva"};
export var BENDS_DE: Record<string, string> = {Droite:"Gerade","Semi-courbée":"Halbgebogen","Courbée":"Gebogen"};
export var BENDS_IT: Record<string, string> = {Droite:"Dritta","Semi-courbée":"Semicurva","Courbée":"Curva"};
// pt-PT agreement note: the pipe is `o cachimbo`, MASCULINE — unlike la pipe /
// la pipa / la pipa above. So curvature and finish take masculine endings
// (Reto / Curvo / Liso / Areado), and the three Romance siblings are not a
// model to copy here.
export var BENDS_PT: Record<string, string> = {Droite:"Reto","Semi-courbée":"Semicurvo","Courbée":"Curvo"};
export var FILTERS = ["9mm","6mm","Balsa","Métal","Hybride 6mm","Hybride 9mm","Autre"] as const;
// FILTERS extended with Métal + the two Hybride sizes.
// EN map covers the FR-canonical entries — 9mm / 6mm / Balsa are
// universal symbols (numbers + a brand-neutral material) so no
// translation needed.
export var FILTERS_EN: Record<string, string> = {
  "Métal": "Metal",
  "Hybride 6mm": "Hybrid 6mm",
  "Hybride 9mm": "Hybrid 9mm",
  "Autre": "Other",
};
export var FILTERS_ES: Record<string, string> = {"Métal":"Metal","Hybride 6mm":"Híbrido 6mm","Hybride 9mm":"Híbrido 9mm","Autre":"Otro"};
export var FILTERS_DE: Record<string, string> = {"Métal":"Metall","Hybride 6mm":"Hybrid 6mm","Hybride 9mm":"Hybrid 9mm","Autre":"Andere"};
export var FILTERS_IT: Record<string, string> = {"Métal":"Metallo","Hybride 6mm":"Ibrido 6mm","Hybride 9mm":"Ibrido 9mm","Autre":"Altro"};
export var FILTERS_PT: Record<string, string> = {"Métal":"Metal","Hybride 6mm":"Híbrido 6mm","Hybride 9mm":"Híbrido 9mm","Autre":"Outro"};
export var BOWL_MATS = ["Argile","Bambou","Bruyère","Cerisier","Chêne","Érable","Maïs","Meerschaum","Métal","Morta","Noyer","Olivier","Os","Pierre (stéatite)","Poirier","Porcelaine","Autre"] as const;
export var BOWL_MATS_EN: Record<string, string> = {Argile:"Clay",Bambou:"Bamboo","Bruyère":"Briar",Cerisier:"Cherry wood","Chêne":"Oak","Érable":"Maple","Maïs":"Corn cob",Meerschaum:"Meerschaum","Métal":"Metal",Morta:"Morta",Noyer:"Walnut",Olivier:"Olive wood",Os:"Bone","Pierre (stéatite)":"Soapstone",Poirier:"Pear wood",Porcelaine:"Porcelain",Autre:"Other"};
export var BOWL_MATS_ES: Record<string, string> = {Argile:"Arcilla",Bambou:"Bambú","Bruyère":"Brezo",Cerisier:"Cerezo","Chêne":"Roble","Érable":"Arce","Maïs":"Mazorca","Métal":"Metal",Noyer:"Nogal",Olivier:"Olivo",Os:"Hueso","Pierre (stéatite)":"Esteatita",Poirier:"Peral",Porcelaine:"Porcelana",Autre:"Otro"};
export var BOWL_MATS_DE: Record<string, string> = {Argile:"Ton",Bambou:"Bambus","Bruyère":"Bruyère",Cerisier:"Kirschholz","Chêne":"Eiche","Érable":"Ahorn","Maïs":"Maiskolben","Métal":"Metall",Noyer:"Nussbaum",Olivier:"Olivenholz",Os:"Knochen","Pierre (stéatite)":"Speckstein",Poirier:"Birnbaum",Porcelaine:"Porzellan",Autre:"Andere"};
export var BOWL_MATS_IT: Record<string, string> = {Argile:"Argilla",Bambou:"Bambù","Bruyère":"Radica",Cerisier:"Ciliegio","Chêne":"Quercia","Érable":"Acero","Maïs":"Pannocchia","Métal":"Metallo",Noyer:"Noce",Olivier:"Olivo",Os:"Osso","Pierre (stéatite)":"Steatite",Poirier:"Pero",Porcelaine:"Porcellana",Autre:"Altro"};
export var BOWL_MATS_PT: Record<string, string> = {Argile:"Argila",Bambou:"Bambu","Bruyère":"Briar",Cerisier:"Cerejeira",Meerschaum:"Espuma do mar","Chêne":"Carvalho","Érable":"Bordo","Maïs":"Milho","Métal":"Metal",Noyer:"Nogueira",Olivier:"Oliveira",Os:"Osso","Pierre (stéatite)":"Esteatite",Poirier:"Pereira",Porcelaine:"Porcelana",Autre:"Outro"};
export var STEM_MATS = ["Acrylique","Ambre","Bois","Canne","Corne","Cumberland","Delrin","Ivoirite","Lucite","Os","Ébonite","Autre"] as const;
export var STEM_MATS_EN: Record<string, string> = {Acrylique:"Acrylic",Ambre:"Amber",Bois:"Wood",Canne:"Reed",Corne:"Horn",Cumberland:"Cumberland",Delrin:"Delrin",Ivoirite:"Ivorite",Lucite:"Lucite",Os:"Bone","Ébonite":"Ebonite",Autre:"Other"};
export var STEM_MATS_ES: Record<string, string> = {Acrylique:"Acrílico",Ambre:"Ámbar",Bois:"Madera",Canne:"Caña",Corne:"Cuerno",Ivoirite:"Ivorite",Os:"Hueso","Ébonite":"Ebonita",Autre:"Otro"};
export var STEM_MATS_DE: Record<string, string> = {Acrylique:"Acryl",Ambre:"Bernstein",Bois:"Holz",Canne:"Rohr",Corne:"Horn",Ivoirite:"Ivorite",Os:"Knochen","Ébonite":"Ebonit",Autre:"Andere"};
export var STEM_MATS_IT: Record<string, string> = {Acrylique:"Acrilico",Ambre:"Ambra",Bois:"Legno",Canne:"Canna",Corne:"Corno",Ivoirite:"Ivorite",Os:"Osso","Ébonite":"Ebanite",Autre:"Altro"};
export var STEM_MATS_PT: Record<string, string> = {Acrylique:"Acrílico",Ambre:"Âmbar",Bois:"Madeira",Canne:"Cana",Corne:"Corno",Ivoirite:"Ivorite",Os:"Osso","Ébonite":"Ebonite",Autre:"Outro"};
// Pipe surface finish. Tight set — the three canonical
// finishes (smooth / sandblasted / rusticated) plus Autre. Same enum
// convention as BOWL_MATS / STEM_MATS: FR canonical value, EN map for
// xl(), "Autre" last.
export var FINISHES = ["Lisse","Rustiquée","Sablée","Teintée","Autre"] as const;
export var FINISHES_EN: Record<string, string> = {Lisse:"Smooth","Rustiquée":"Rusticated","Sablée":"Sandblasted","Teintée":"Stained",Autre:"Other"};
export var FINISHES_ES: Record<string, string> = {Lisse:"Lisa","Rustiquée":"Rusticada","Sablée":"Arenada","Teintée":"Teñida",Autre:"Otro"};
export var FINISHES_DE: Record<string, string> = {Lisse:"Glatt","Rustiquée":"Rustiziert","Sablée":"Sandgestrahlt","Teintée":"Gebeizt",Autre:"Andere"};
export var FINISHES_IT: Record<string, string> = {Lisse:"Liscia","Rustiquée":"Rusticata","Sablée":"Sabbiata","Teintée":"Tinta",Autre:"Altro"};
export var FINISHES_PT: Record<string, string> = {Lisse:"Liso","Rustiquée":"Rusticado","Sablée":"Areado","Teintée":"Tingido",Autre:"Outro"};
export var ACC_TYPES = ["Briquet","Blague à tabac","Bourre-pipe","Porte-pipe","Autre"] as const;
export var ACC_TYPES_EN: Record<string, string> = {Briquet:"Lighter","Blague à tabac":"Tobacco pouch","Bourre-pipe":"Pipe tamper","Porte-pipe":"Pipe stand",Autre:"Other"};
export var ACC_TYPES_ES: Record<string, string> = {Briquet:"Encendedor","Blague à tabac":"Petaca","Bourre-pipe":"Atacador","Porte-pipe":"Soporte para pipa",Autre:"Otro"};
export var ACC_TYPES_DE: Record<string, string> = {Briquet:"Feuerzeug","Blague à tabac":"Tabakbeutel","Bourre-pipe":"Stopfer","Porte-pipe":"Pfeifenständer",Autre:"Andere"};
export var ACC_TYPES_IT: Record<string, string> = {Briquet:"Accendino","Blague à tabac":"Borsa da tabacco","Bourre-pipe":"Pigino","Porte-pipe":"Portapipe",Autre:"Altro"};
export var ACC_TYPES_PT: Record<string, string> = {Briquet:"Isqueiro","Blague à tabac":"Bolsa de tabaco","Bourre-pipe":"Calcador","Porte-pipe":"Suporte para cachimbo",Autre:"Outro"};
// Pipe maintenance-log action types ("Carnet d'entretien").
// Same enum convention as BOWL_MATS / FINISHES: FR canonical value stored,
// _<CODE> maps for xl(), "Autre" last.
// Pipe maintenance is now "cleaning kind + checked tasks".
// A maintenance entry picks ONE kind (light / full / none) and checks any
// number of tasks. Only the light + full cleaning kinds feed the maintenance
// reminder counter (see pipeMaint.ts); "none" logs an intervention (repair,
// waxing…) WITHOUT resetting the reminder. Labels resolve via
// t("maint_kind_<k>") / t("maint_task_<k>") — plain i18n keys, NOT the xl()
// enum-translation path the old MAINT_TYPES used.
export var MAINT_KINDS = ["light", "full", "none"] as const;
export var MAINT_TASKS = ["swab", "bowl", "ream", "saltalcohol", "stem", "wax", "repair", "rest", "other"] as const;
// The legacy MAINT_TYPES → { kind, tasks } migration table is
// inlined in migrateData (utils.ts) — utils.ts doesn't import constants, and
// the map has a single consumer, so it lives at the migration site.
export var LIGHTER_FUELS = ["Gaz","Essence","Électrique","Allumettes","Autre"] as const;
export var LIGHTER_FUELS_EN: Record<string, string> = {Gaz:"Gas",Essence:"Petrol","Électrique":"Electric",Allumettes:"Matches",Autre:"Other"};
export var LIGHTER_FUELS_ES: Record<string, string> = {Gaz:"Gas",Essence:"Gasolina","Électrique":"Eléctrico",Allumettes:"Cerillas",Autre:"Otro"};
export var LIGHTER_FUELS_DE: Record<string, string> = {Gaz:"Gas",Essence:"Benzin","Électrique":"Elektrisch",Allumettes:"Streichhölzer",Autre:"Andere"};
export var LIGHTER_FUELS_IT: Record<string, string> = {Gaz:"Gas",Essence:"Benzina","Électrique":"Elettrico",Allumettes:"Fiammiferi",Autre:"Altro"};
export var LIGHTER_FUELS_PT: Record<string, string> = {Gaz:"Gás",Essence:"Gasolina","Électrique":"Elétrico",Allumettes:"Fósforos",Autre:"Outro"};

// Enum-label translation registry, keyed by the canonical English map
// OBJECT so every `xl(value, XXX_EN)` call site stays unchanged. French
// is canonical (stored value) → no `fr` entry needed. ADD A LANGUAGE:
// define the `_<CODE>` maps above and add a `<code>: XXX_<CODE>` entry to
// each row here — this is the ONLY place enum translations wire in.
// lang-axis-ok: `fr` is deliberately absent from every row — it is the
// CANONICAL stored value and xl() returns it unchanged. Gate 14 verifies
// these rows against the discovered dictionaries, minus fr.
export var ENUM_TRANSLATIONS: Map<Record<string, string>, Record<string, Record<string, string>>> = new Map([
  [CATS_EN,          { en: CATS_EN,          es: CATS_ES,          de: CATS_DE,          it: CATS_IT, pt: CATS_PT }],
  [CUTS_EN,          { en: CUTS_EN,          es: CUTS_ES,          de: CUTS_DE,          it: CUTS_IT, pt: CUTS_PT }],
  [SHAPES_EN,        { en: SHAPES_EN,        es: SHAPES_ES,        de: SHAPES_DE,        it: SHAPES_IT, pt: SHAPES_PT }],
  [BENDS_EN,         { en: BENDS_EN,         es: BENDS_ES,         de: BENDS_DE,         it: BENDS_IT, pt: BENDS_PT }],
  [FILTERS_EN,       { en: FILTERS_EN,       es: FILTERS_ES,       de: FILTERS_DE,       it: FILTERS_IT, pt: FILTERS_PT }],
  [BOWL_MATS_EN,     { en: BOWL_MATS_EN,     es: BOWL_MATS_ES,     de: BOWL_MATS_DE,     it: BOWL_MATS_IT, pt: BOWL_MATS_PT }],
  [STEM_MATS_EN,     { en: STEM_MATS_EN,     es: STEM_MATS_ES,     de: STEM_MATS_DE,     it: STEM_MATS_IT, pt: STEM_MATS_PT }],
  [FINISHES_EN,      { en: FINISHES_EN,      es: FINISHES_ES,      de: FINISHES_DE,      it: FINISHES_IT, pt: FINISHES_PT }],
  [ACC_TYPES_EN,     { en: ACC_TYPES_EN,     es: ACC_TYPES_ES,     de: ACC_TYPES_DE,     it: ACC_TYPES_IT, pt: ACC_TYPES_PT }],
  [LIGHTER_FUELS_EN, { en: LIGHTER_FUELS_EN, es: LIGHTER_FUELS_ES, de: LIGHTER_FUELS_DE, it: LIGHTER_FUELS_IT, pt: LIGHTER_FUELS_PT }],
]);


// Localized short month names for chart axes / journal group labels.
// Indexed 0-11 (month-of-year minus one); 13-element variants that index 1-12
// are the views' problem, not this one.
//
// The five MONTHS_<CODE>_SHORT arrays this used to read are
// GONE. The data moved into LANG_ASSETS and the arrays were left behind, dead —
// and left this comment telling the next person to localize by "adding a
// MONTHS_<code>_SHORT array above", which by then localized nothing. Add the
// months to that language's LANG_ASSETS row; doc:check gate 13 fails if the
// row is missing, which is more than the dead arrays ever offered.
export function monthsShort(lang?: string): readonly string[] {
  return langAssets(lang).monthsShort;
}

// Localized single-letter weekday initials for the calendar heatmap rows
// (index 0=Mon … 6=Sun; the heatmap only renders Mon/Wed/Fri = 0/2/4).
export function heatmapDayInitials(lang?: string): readonly string[] {
  return langAssets(lang).dayInitials;
}

// Per-family accent, consumed by catColor() (theme-curator.ts) and therefore by
// Home / the tobacco fiche / journal / catalogue / lot modal — and by StatsView
// too (it used a SECOND, divergent palette until it was unified, so a family
// was one colour on Stats and another everywhere else).
//
// Each value is a CSS var with the BRIGHT hex as its fallback, so the
// dark theme is byte-identical while light mode can substitute a darkened
// variant (MODE_LIGHT in theme-curator.ts). Before that these were raw hex and
// did not follow the mode: on the parchment ground "Virginia" rendered at 2:1,
// well under AA — measured by `npm run theme:contrast`, which is what surfaced
// the whole problem. The light values are computed to clear 4.6:1 on the DARKER
// of the two light grounds (the page, #e7ddc6), keeping hue and capping
// saturation at 0.72 because parchment reads badly under fully-saturated ink.
//
// CONSEQUENCE FOR CALLERS: a var() cannot be hex-concatenated. Use
// `alpha(catColor(x), "22")`, never `catColor(x) + "22"`, and set SVG colours
// via `style={{ fill }}` — WebKit does not evaluate var() in a presentation
// attribute.
export var CAT_COLORS: Record<string, string> = {"Anglais":"var(--c-cat-anglais, #cb8528)","Virginia":"var(--c-cat-virginia, #d4a03a)","Aromatique":"var(--c-cat-aromatique, #6fb876)","Balkan":"var(--c-cat-balkan, #4a9eff)","VaPer":"var(--c-cat-vaper, #c25848)","Burley":"var(--c-cat-burley, #a06eff)","Oriental":"var(--c-cat-oriental, #ff6e9c)","Écossais":"var(--c-cat-ecossais, #48d4c2)","Dark Fired":"var(--c-cat-dark-fired, #8f7f68)","Virginia/Burley":"var(--c-cat-virginia-burley, #ff9248)","Autre":"var(--c-cat-autre, #655846)","Latakia":"var(--c-cat-latakia, #7b8fa6)","Cavendish":"var(--c-cat-cavendish, #c4773a)","Perique":"var(--c-cat-perique, #9b3a6a)","Turkish":"var(--c-cat-turkish, #d4b84a)","Américain":"var(--c-cat-americain, #6da32b)","Virginia/Latakia":"var(--c-cat-virginia-latakia, #cc72d4)","Cigare":"var(--c-cat-cigare, #858ce9)","Lakeland":"var(--c-cat-lakeland, #dd8fb4)","Anglais aromatique":"var(--c-cat-anglais-aromatique, #4d9bcb)"};
// PIPE_COLORS removed — StatsView uses CURATOR_CHART_COLORS
// from theme-curator.ts (imported as PIPE_COLORS via `as` alias).

export var BT: Omit<Tobacco, "id"> = {name:"",brand:"",category:"",blend:"",cut:"",force:0,roomNote:0,taste:0,rating:0,rebuy:null,tastingNotes:"",description:"",imageUrl:"",lots:[],agingMax:"",tags:[],catalogueLock:false};
export var BL: Lot = {status:"cellar",originalStatus:"cellar",weightG:"50",weightInitial:"50",datePurchased:"",dateProduction:"",dateOpened:"",dateFinished:"",boxNumber:"",storageLocation:"",price:"",seller:"",sellerUrl:"",disposed:false};
// The cap on a pipe's ADDITIONAL photos (`pipe.photos`).
// Lived as a local const in PipeFormView until the cross-device merge needed
// it too; a second copy would have drifted from the form the first time
// either moved.
export var PIPE_MAX_EXTRA_PHOTOS = 6;

export var BP: Omit<Pipe, "id"> = {name:"",brand:"",shape:"Billiard",courbure:"",length:"",weight:"",filterType:"",chamberDiameter:"",chamberDepth:"",bowlMaterial:"",stemMaterial:"",finish:"",datePurchased:"",dateProduction:"",price:"",seller:"",sellerUrl:"",description:"",notes:"",imageUrl:"",photos:[],rating:0,status:"active",maintenance:[],tags:[]};
export var BW: Omit<WishlistItem, "id"> = {name:"",brand:"",category:"",blend:"",cut:"",force:0,roomNote:0,taste:0,description:"",tastingNotes:"",imageUrl:"",notes:"",priority:"medium",agingMax:"",catalogueLock:false};
export var BA: Omit<Accessory, "id"> = {name:"",brand:"",type:"Briquet",fuel:"",status:"active",datePurchased:"",price:"",seller:"",sellerUrl:"",notes:"",imageUrl:"",rating:0,tags:[]};
export var BJ: Omit<Session, "id"> = {tobaccoId:"",pipeId:"",date:"",duration:"",rating:0,notes:"",weightG:"",lotId:"",aromas:[]};
export var INIT: AppData = {tobaccos:[],wishlist:[],pipes:[],accessories:[],sessions:[],nxT:1,nxW:1,nxP:1,nxA:1,nxJ:1};

// Dropbox app key (public client id — same exposure
// class as GDRIVE_CLIENT_ID; PKCE means no secret exists client-side).
// App type: Scoped access / App folder — Dropbox confines the app to
// /Applications/Ma Cave a Tabac, the appDataFolder equivalent.
export var DROPBOX_APP_KEY = "y8uj8qi0nhx46wa";
export var GDRIVE_CLIENT_ID = "890611313186-qadhr6pqp2vk5toh0rkrpgi3qcd1e4ji.apps.googleusercontent.com";
export var GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export var GDRIVE_FILE_PREFIX = "cave-tabac-";
// Legacy fixed-name auto file kept for migration / backward compat — new
// auto saves use timestamped names starting with GDRIVE_AUTO_PREFIX.
export var GDRIVE_AUTO_FILENAME = "cave-tabac-auto.json";
export var GDRIVE_AUTO_PREFIX = "cave-tabac-auto-";
// Manual saves rotate over GDRIVE_MAX_MANUAL timestamped files.
// Auto-saves overwrite a single file in place — no separate
// cap. The obsolete GDRIVE_MAX_AUTO and the legacy GDRIVE_MAX_BACKUPS alias
// were removed — use GDRIVE_MAX_MANUAL directly.
export var GDRIVE_MAX_MANUAL = 3;
// The catalogue's OWN cloud file, and why it is a separate
// stream rather than a field inside the cellar backup.
//
// A user catalogue MEASURED 3.77 MB. The cellar backup is written on every
// change (the auto-save debounces 1.2 s after any edit), while the catalogue
// changes only when the user loads one — so embedding it would make logging a
// single session upload 3.77 MB, over and over, for data that did not move.
// Separating them makes that cost once per catalogue load.
//
// THE HAZARD THIS CREATES, and the reason `classifyBackup` gained a third
// kind rather than this prefix being bolted on: that function returned
// "manual" for ANYTHING not starting with the auto prefix, and manual backups
// ROTATE over GDRIVE_MAX_MANUAL. A catalogue file would therefore have been
// deleted from the cloud by the user's own cellar saves, silently, after
// three. The multi-device guard had no type filter either, so it would have
// offered a CSV as a cellar backup to restore. Both are excluded explicitly
// and asserted — this is the area three separate releases were each spent on.
export var GDRIVE_CATALOGUE_PREFIX = "cave-tabac-catalogue-";

// How long a soft-deleted entity stays in the Trash before
// the startup cleanup hard-removes it.
// The cellar's OWN storage budget, in JS string characters.
//
// `useStorageQuotaWarning` probes `navigator.storage.estimate()`, which reports
// the ORIGIN quota — what IndexedDB (the photo store) spends. The cellar lives
// in `localStorage`, whose ~5 MB sub-quota the StorageManager commonly does not
// account for at all: MEASURED in Chromium, filling localStorage to failure
// gave a hard ceiling of 5 200 000 chars while `estimate()` reported 0.112 % of
// a 1049 MB quota at the very moment `setItem` threw. A serious collector's
// cellar measured 2 899 338 chars — 55.8 % of the budget that actually fails,
// and three orders of magnitude away from the one being watched.
//
// 5 000 000 rather than the measured 5 200 000: the ceiling is engine-specific
// and this number decides when a user is TOLD to back up, so it errs low. The
// warning fires at the same 80 % as the origin probe.
//
// The consequence it exists to prevent is not a refused write. `save()` calls
// `setData(nd)` BEFORE `appStorage.set`, and the QuotaExceeded retry migrates
// INLINE photos — of which a modern cellar has none, they are already
// `local-photo-*` keys — so the edit stays on screen, looks saved, and is gone
// on the next launch.
export var LOCALSTORAGE_BUDGET_CHARS = 5000000;

export var TRASH_RETENTION_DAYS = 30;
// Stale-pending sweep threshold (ms). Used by BOTH
// the mount-time cleanup in App.tsx AND triggerIosAutosaveReauth in
// useGdriveAuth.ts to recognise an
// in-flight OAuth round that died
// (user closed the OAuth tab, Google bounced without a hash, etc.).
// 60 s is comfortably above the 30 s real upper bound (Google response
// + user reading consent). An audit flagged this as a magic number
// duplicated in 2 places — extracted here to keep them in lock-step.
export var GDRIVE_PENDING_STALE_MS = 60000;
