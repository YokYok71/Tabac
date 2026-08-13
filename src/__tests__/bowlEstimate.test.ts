import { describe, it, expect } from "vitest";
import {
  CUT_DENSITY, DEFAULT_CUT_DENSITY,
  chamberVolumeCm3, estimateBowlWeightG, estimateSessionWeight,
  chamberDimsPlausible, shapeVolumeFactor,
  CONICAL_SHAPE_FACTOR_MILD, CONICAL_SHAPE_FACTOR_STRONG,
  CONICAL_SHAPES_MILD, CONICAL_SHAPES_STRONG,
} from "../utils/bowlEstimate";

describe("chamberVolumeCm3", () => {
  it("computes a cylinder volume in cm³ from mm dimensions", () => {
    // 19 mm × 40 mm → π·9.5²·40 / 1000 ≈ 11.34 cm³
    expect(chamberVolumeCm3(19, 40)).toBeCloseTo(11.341, 2);
    expect(chamberVolumeCm3("20", "40")).toBeCloseTo(12.566, 2); // strings parse
  });
  it("returns null when either dimension is missing / non-positive / garbage", () => {
    expect(chamberVolumeCm3(0, 40)).toBeNull();
    expect(chamberVolumeCm3(19, 0)).toBeNull();
    expect(chamberVolumeCm3("", 40)).toBeNull();
    expect(chamberVolumeCm3(19, "abc")).toBeNull();
    expect(chamberVolumeCm3(undefined, undefined)).toBeNull();
  });
});

describe("estimateBowlWeightG", () => {
  it("multiplies volume by the cut's density", () => {
    // 11.34 cm³ × Ribbon 0.22 ≈ 2.49 g
    expect(estimateBowlWeightG(19, 40, "Ribbon")).toBeCloseTo(11.341 * 0.22, 3);
    // denser cut weighs more (Flake rubbed out ≈ Broken Flake density 0.25)
    expect(estimateBowlWeightG(19, 40, "Flake")).toBeCloseTo(11.341 * 0.25, 3);
    expect(estimateBowlWeightG(19, 40, "Flake")!).toBeGreaterThan(estimateBowlWeightG(19, 40, "Ribbon")!);
  });
  it("uses the default density for unknown / 'Autre' / no cut", () => {
    expect(estimateBowlWeightG(19, 40, "Autre")).toBeCloseTo(11.341 * DEFAULT_CUT_DENSITY, 3);
    expect(estimateBowlWeightG(19, 40, "Nope")).toBeCloseTo(11.341 * DEFAULT_CUT_DENSITY, 3);
    expect(estimateBowlWeightG(19, 40)).toBeCloseTo(11.341 * DEFAULT_CUT_DENSITY, 3);
  });
  it("returns null without usable chamber dimensions", () => {
    expect(estimateBowlWeightG(0, 40, "Ribbon")).toBeNull();
  });
  it("every CUTS density is a sane packed value (0.15–0.5 g/cm³)", () => {
    for (const k of Object.keys(CUT_DENSITY)) {
      expect(CUT_DENSITY[k]!).toBeGreaterThanOrEqual(0.15);
      expect(CUT_DENSITY[k]!).toBeLessThanOrEqual(0.5);
    }
  });
});

// ── the two claims public/help.html makes IN PROSE ────────
// The help note on the session weight asserts a dense flake outweighs an airy
// ribbon at equal volume, and that a conical chamber holds LESS than a
// straight one. Both are orderings, so unlike a quoted number they can be
// checked mechanically — the `bowl-weight-estimate` label contract only forces
// a human re-read, and a re-read is the weaker guarantee of the two. If a
// density pass ever inverts one of these, THIS is what should go red first,
// and the help sentence in all 5 languages is what has to change.
describe("the orderings help.html states in prose", () => {
  const VOL = { d: 19, h: 40 };

  it("a dense flake outweighs an airy ribbon at equal volume", () => {
    expect(CUT_DENSITY["Flake"]!).toBeGreaterThan(CUT_DENSITY["Ribbon"]!);
    expect(estimateBowlWeightG(VOL.d, VOL.h, "Flake")!)
      .toBeGreaterThan(estimateBowlWeightG(VOL.d, VOL.h, "Ribbon")!);
  });

  it("every conical family the help names holds less than a straight bowl", () => {
    // The help names the Dublin family and Bulldog/Rhodesian explicitly, so
    // those exact shapes must resolve to a factor < 1 — not merely "some
    // shapes are conical".
    for (const shape of ["Dublin", "Bulldog", "Rhodesian"]) {
      expect(shapeVolumeFactor(shape), shape).toBeLessThan(1);
    }
    for (const shape of [...CONICAL_SHAPES_MILD, ...CONICAL_SHAPES_STRONG]) {
      expect(shapeVolumeFactor(shape), shape).toBeLessThan(1);
    }
    // …and a straight bowl is the unmodified cylinder.
    expect(shapeVolumeFactor("Billiard")).toBe(1);
    expect(shapeVolumeFactor("")).toBe(1);
  });

  it("no chamber dimensions → the global default weight, as the help promises", () => {
    expect(estimateSessionWeight({ chamberDiameter: "", chamberDepth: "" }, { cut: "Flake" }, "4", "g")).toBe("4");
  });
});

describe("chamberDimsPlausible", () => {
  it("passes typical pipe dimensions", () => {
    expect(chamberDimsPlausible(19, 40)).toEqual({ diameterOk: true, depthOk: true });
    expect(chamberDimsPlausible(22, 55)).toEqual({ diameterOk: true, depthOk: true });
  });
  it("treats empty / non-positive values as ok (unset, no warning)", () => {
    expect(chamberDimsPlausible("", "")).toEqual({ diameterOk: true, depthOk: true });
    expect(chamberDimsPlausible(0, 0)).toEqual({ diameterOk: true, depthOk: true });
  });
  it("flags an out-of-range diameter or depth (e.g. cm typed as mm)", () => {
    expect(chamberDimsPlausible(190, 400)).toEqual({ diameterOk: false, depthOk: false });
    expect(chamberDimsPlausible(19, 400).depthOk).toBe(false);
    expect(chamberDimsPlausible(2, 40).diameterOk).toBe(false);  // too small
    expect(chamberDimsPlausible(19, 5).depthOk).toBe(false);     // too shallow
  });
});

describe("shapeVolumeFactor", () => {
  it("is 1.0 for straight-chamber shapes, empty, and unknown", () => {
    expect(shapeVolumeFactor("Billiard")).toBe(1);
    expect(shapeVolumeFactor("Pot")).toBe(1);
    expect(shapeVolumeFactor("Churchwarden")).toBe(1); // straight
    expect(shapeVolumeFactor("Calabash")).toBe(1);
    expect(shapeVolumeFactor("Hawkbill")).toBe(1);
    expect(shapeVolumeFactor("")).toBe(1);
    expect(shapeVolumeFactor(undefined)).toBe(1);
    expect(shapeVolumeFactor("Nope")).toBe(1);
  });
  it("is the mild factor for the Bulldog family (incl. its later variants)", () => {
    ["Bulldog", "Bullmoose", "Rhodesian", "Bullcap", "Bent Bulldog", "Straight Rhodesian"].forEach((s) =>
      expect(shapeVolumeFactor(s)).toBe(CONICAL_SHAPE_FACTOR_MILD));
  });
  it("is the strong factor for the Dublin family", () => {
    ["Dublin", "Zulu", "Cutty", "Acorn", "Horn", "Pickaxe", "Pear", "Tulipe", "Woodstock"].forEach((s) =>
      expect(shapeVolumeFactor(s)).toBe(CONICAL_SHAPE_FACTOR_STRONG));
  });
  it("keeps Volcano at 1.0 — its chamber is wide at the heel (inverse Dublin)", () => {
    expect(shapeVolumeFactor("Volcano")).toBe(1);
  });
});

describe("estimateBowlWeightG — shape factor", () => {
  it("trims the volume for conical shapes", () => {
    const cyl = estimateBowlWeightG(19, 40, "Ribbon", "Billiard")!;
    const mild = estimateBowlWeightG(19, 40, "Ribbon", "Bulldog")!;
    const strong = estimateBowlWeightG(19, 40, "Ribbon", "Dublin")!;
    expect(mild).toBeCloseTo(cyl * 0.90, 5);
    expect(strong).toBeCloseTo(cyl * 0.80, 5);
    expect(strong).toBeLessThan(mild);
    expect(mild).toBeLessThan(cyl);
  });
  it("no shape → cylinder (factor 1.0), unchanged", () => {
    expect(estimateBowlWeightG(19, 40, "Ribbon")).toBeCloseTo(11.341 * 0.22, 3);
  });
});

describe("estimateSessionWeight", () => {
  const pipe = { chamberDiameter: "19", chamberDepth: "40" };

  it("estimates from chamber × cut, rounded to 1 decimal (g)", () => {
    // 11.34 × 0.22 = 2.495 → "2.5"
    expect(estimateSessionWeight(pipe, { cut: "Ribbon" }, "3", "g")).toBe("2.5");
    // 11.34 × 0.25 = 2.835 → "2.8" (Flake rubbed out ≈ Broken Flake density)
    expect(estimateSessionWeight(pipe, { cut: "Flake" }, "3", "g")).toBe("2.8");
  });

  it("uses the default density when the tobacco cut is unknown / missing", () => {
    // 11.34 × 0.25 = 2.835 → "2.8"
    expect(estimateSessionWeight(pipe, { cut: "Autre" }, "3", "g")).toBe("2.8");
    expect(estimateSessionWeight(pipe, null, "3", "g")).toBe("2.8");
  });

  it("applies the pipe's shape factor", () => {
    // Dublin (strong conical, 0.80): 11.34 × 0.80 × 0.22 = 1.996 → "2"
    expect(estimateSessionWeight({ ...pipe, shape: "Dublin" }, { cut: "Ribbon" }, "3", "g")).toBe("2");
    // Straight billiard unchanged → "2.5"
    expect(estimateSessionWeight({ ...pipe, shape: "Billiard" }, { cut: "Ribbon" }, "3", "g")).toBe("2.5");
  });

  it("converts to oz (2 decimals) when the unit is oz", () => {
    // 2.495 g / 28.3495 ≈ 0.088 → "0.09"
    expect(estimateSessionWeight(pipe, { cut: "Ribbon" }, "0.1", "oz")).toBe("0.09");
  });

  it("falls back to the global default when the pipe has no chamber dimensions", () => {
    expect(estimateSessionWeight({ chamberDiameter: "", chamberDepth: "" }, { cut: "Ribbon" }, "3", "g")).toBe("3");
    expect(estimateSessionWeight(null, { cut: "Ribbon" }, "3", "g")).toBe("3");
    // no pipe + no setting → unit-aware hard fallback
    expect(estimateSessionWeight(null, { cut: "Ribbon" }, "", "g")).toBe("3");
    expect(estimateSessionWeight(null, { cut: "Ribbon" }, "", "oz")).toBe("0.1");
  });
});
