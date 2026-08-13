// bowlEstimate.ts — pure bowl-weight estimation.
//
// Estimates the tobacco weight for one bowl from the PIPE's chamber size +
// shape and the TOBACCO's cut. The chamber is approximated as a cylinder,
// trimmed by a per-shape taper factor (conical bowls hold less);
// the cut sets a typical packed density (g/cm³). Because the cut lives on the
// tobacco (not the pipe), this only resolves at SESSION time — SessionFormView
// + TastingView call estimateSessionWeight when a pipe AND/OR tobacco is
// picked. Pure, no React, so it's unit-testable and shared by both entry points.
//
// Density table: a single effective value per cut (not "brim-full") so the
// estimate lands near real bowl weights (a medium 19×40 mm bowl ≈ 11 cm³ →
// Ribbon ~2.5 g, Flake ~2.8 g, Rope ~4.1 g). Flakes are rubbed out before
// packing, so Flake/Sliced share Broken Flake's density (0.25), NOT a
// pressed-block value; Cube Cut packs airy (0.21, below Ribbon). Both
// calibrated against real per-bowl weights (a density research pass). Keyed by
// the canonical CUTS
// values in constants.ts; unknown cut / "Autre" / no cut → DEFAULT_CUT_DENSITY.

// LABEL-CONTRACT:start bowl-weight-estimate — see scripts/label-contracts.json
export var CUT_DENSITY: Record<string, number> = {
  "Loose Cut": 0.20,
  "Cube Cut": 0.21,
  // « ribbon avec de petits morceaux » — c'est du ruban,
  // simplement plus grossier, d'où la meme valeur que Ribbon. Placement
  // raisonne a partir des definitions du metier, non calibre sur des pesees
  // reelles comme le reste de la table : il remplace un mapping vers Loose
  // Cut (0.20), donc l'ecart pour les fiches concernees reste minime.
  "Coarse Cut": 0.22,
  "Ribbon": 0.22,
  "Rough Cut": 0.23,
  "Shag": 0.24,
  "Broken Flake": 0.25,
  "Flake": 0.25,
  "Sliced": 0.25,
  "Ready Rubbed": 0.26,
  "Crumble Cake": 0.28,
  "Coins": 0.30,
  "Curly Cut": 0.30,
  "Pressed": 0.30,
  "Plug": 0.30,
  "Rope": 0.36,
  "Twist": 0.36,
};
export var DEFAULT_CUT_DENSITY = 0.25; // "Autre" / unknown / no cut yet
var GRAMS_PER_OZ = 28.3495;

// Plausible pipe chamber ranges (mm) — outside these, PipeFormView shows an
// advisory warning (a mis-entered dimension, e.g. cm typed as mm, would blow
// up the session weight estimate). Generous bounds so unusual-but-real pipes
// don't false-warn.
export var CHAMBER_DIAMETER_MIN = 8, CHAMBER_DIAMETER_MAX = 40;
export var CHAMBER_DEPTH_MIN = 12, CHAMBER_DEPTH_MAX = 90;

/** Per-field plausibility of the chamber dimensions. An empty / non-positive
 *  value is "ok" (no warning — the field is simply unset); only a positive
 *  value OUTSIDE the range flags. */
export function chamberDimsPlausible(diameterMm: any, depthMm: any): { diameterOk: boolean; depthOk: boolean } {
  var d = parseFloat(String(diameterMm));
  var h = parseFloat(String(depthMm));
  return {
    diameterOk: !(d > 0) || (d >= CHAMBER_DIAMETER_MIN && d <= CHAMBER_DIAMETER_MAX),
    depthOk: !(h > 0) || (h >= CHAMBER_DEPTH_MIN && h <= CHAMBER_DEPTH_MAX),
  };
}

/** Chamber volume in cm³ from diameter + depth in mm (cylinder). null when
 *  either dimension is missing / non-positive / unparseable. */
export function chamberVolumeCm3(diameterMm: any, depthMm: any): number | null {
  var d = parseFloat(String(diameterMm));
  var h = parseFloat(String(depthMm));
  if (!(d > 0) || !(h > 0)) return null;
  return (Math.PI * (d / 2) * (d / 2) * h) / 1000;
}

// Chamber-taper factor by pipe shape. Most chambers are near-
// cylindrical (1.0). Two conical tiers, verified against pipe-shape references
// (Pipedia / smokingpipes / Peterson pipe notes):
//   - MILD twin-cone (Bulldog family) → 0.90
//   - STRONG flare  (Dublin family)   → 0.80
// Keyed by the canonical SHAPES value; anything unlisted / empty → 1.0.
// Densities are unchanged (calibrated for a straight wall); this only trims
// the cylinder volume for conical bowls. Churchwarden / Calabash / Hawkbill
// are STRAIGHT (defined by stem/shank or a rounded — not tapered — chamber).
export var CONICAL_SHAPE_FACTOR_MILD = 0.90;
export var CONICAL_SHAPE_FACTOR_STRONG = 0.80;
// The bulldog / rhodesian FAMILY variants added with the pipe-shape
// chart share the same mild twin-cone chamber, so they get the MILD factor
// (confirmed by a shape-reference research pass). Every other new shape stays
// 1.0 — they're defined by a stem/shank feature or a freehand/novelty exterior,
// not a chamber that narrows toward the heel. NOTE: Volcano is deliberately NOT
// conical here — it's the INVERSE of a Dublin (wide/flat heel tapering UP to a
// narrow rim), so its chamber doesn't narrow toward the heel; 0.80 would
// under-estimate its capacity, hence 1.0.
export var CONICAL_SHAPES_MILD = ["Bulldog", "Bullmoose", "Rhodesian", "Bullcap", "Bent Bulldog", "Straight Rhodesian"];
export var CONICAL_SHAPES_STRONG = [
  "Acorn", "Cutty", "Dublin", "Horn", "Pear", "Pickaxe", "Tulipe", "Woodstock", "Zulu",
];
export function shapeVolumeFactor(shape?: string): number {
  if (!shape) return 1;
  if (CONICAL_SHAPES_STRONG.indexOf(shape) >= 0) return CONICAL_SHAPE_FACTOR_STRONG;
  if (CONICAL_SHAPES_MILD.indexOf(shape) >= 0) return CONICAL_SHAPE_FACTOR_MILD;
  return 1;
}

/** Estimated bowl weight in GRAMS = cylinder volume × shape factor × cut
 *  density. null when the pipe has no usable chamber dimensions. */
export function estimateBowlWeightG(diameterMm: any, depthMm: any, cut?: string, shape?: string): number | null {
  var vol = chamberVolumeCm3(diameterMm, depthMm);
  if (vol == null) return null;
  // Own-property check so a poisoned cut like "constructor"
  // or "toString" resolves an inherited function (→ NaN weight) instead of a
  // density. Normal paths canonicalise `cut` to the enum or "Autre"; this is
  // defence-in-depth against a forged import.
  var density = (cut && Object.prototype.hasOwnProperty.call(CUT_DENSITY, cut) && CUT_DENSITY[cut] != null)
    ? CUT_DENSITY[cut] : DEFAULT_CUT_DENSITY;
  return vol * shapeVolumeFactor(shape) * density;
}

// LABEL-CONTRACT:end bowl-weight-estimate

/** The default session weight (as a string, in the user's weightUnit) when a
 *  pipe is picked. Uses the chamber-size × cut-density estimate when the pipe
 *  carries usable chamber dimensions; otherwise falls back to the global
 *  sessDefaultWeight setting (then a unit-aware 3 g / 0.1 oz). Rounded to 1
 *  decimal in grams, 2 in oz. */
export function estimateSessionWeight(
  pipe: any, tobacco: any, sessDefaultWeight: any, weightUnit?: string,
): string {
  var grams = pipe ? estimateBowlWeightG(pipe.chamberDiameter, pipe.chamberDepth, tobacco ? tobacco.cut : "", pipe.shape) : null;
  if (grams == null) {
    return sessDefaultWeight || (weightUnit === "oz" ? "0.1" : "3");
  }
  if (weightUnit === "oz") {
    return String(Math.round((grams / GRAMS_PER_OZ) * 100) / 100);
  }
  return String(Math.round(grams * 10) / 10);
}
