import { describe, it, expect } from "vitest";
import {
  BT, BL, BP, BW, BA, BJ, INIT,
  CATS, CUTS, SHAPES, SHAPE_FAMILIES, BENDS, FILTERS,
  CAT_FAMILIES, CUT_FAMILIES, BOWL_MAT_FAMILIES, STEM_MAT_FAMILIES,
  BOWL_MATS, STEM_MATS, ACC_TYPES, LIGHTER_FUELS,
  CATS_EN, BOWL_MATS_EN, STEM_MATS_EN, BENDS_EN, ACC_TYPES_EN, FILTERS_EN,
  CAT_COLORS,
  GDRIVE_FILE_PREFIX, GDRIVE_AUTO_FILENAME, GDRIVE_MAX_MANUAL,
} from "../constants";

// ── Template defaults ─────────────────────────────────────────────────────────

describe("BT (tobacco template)", () => {
  it("has empty string fields", () => {
    expect(BT.name).toBe("");
    expect(BT.brand).toBe("");
    expect(BT.category).toBe("");
    expect(BT.blend).toBe("");
    expect(BT.cut).toBe("");
    expect(BT.tastingNotes).toBe("");
    expect(BT.description).toBe("");
    expect(BT.imageUrl).toBe("");
    expect(BT.agingMax).toBe("");
  });

  it("has zero numeric ratings", () => {
    expect(BT.force).toBe(0);
    expect(BT.roomNote).toBe(0);
    expect(BT.taste).toBe(0);
    expect(BT.rating).toBe(0);
  });

  it("has rebuy null (undecided)", () => {
    expect(BT.rebuy).toBeNull();
  });

  it("has empty lots array", () => {
    expect(BT.lots).toEqual([]);
  });
});

describe("BL (lot template)", () => {
  it("defaults to cellar status", () => {
    expect(BL.status).toBe("cellar");
  });

  it("defaults to 50g", () => {
    expect(BL.weightG).toBe("50");
  });

  it("has empty date fields", () => {
    expect(BL.datePurchased).toBe("");
    expect(BL.dateProduction).toBe("");
    expect(BL.dateOpened).toBe("");
    expect(BL.dateFinished).toBe("");
  });

  it("is not disposed by default", () => {
    expect(BL.disposed).toBe(false);
  });
});

describe("BP (pipe template)", () => {
  it("defaults to Billiard shape", () => {
    expect(BP.shape).toBe("Billiard");
  });

  it("defaults to active status", () => {
    expect(BP.status).toBe("active");
  });

  it("has zero rating", () => {
    expect(BP.rating).toBe(0);
  });

  it("has empty measurement fields", () => {
    expect(BP.length).toBe("");
    expect(BP.weight).toBe("");
    expect(BP.chamberDiameter).toBe("");
    expect(BP.chamberDepth).toBe("");
  });
});

describe("BW (wishlist template)", () => {
  it("defaults to medium priority", () => {
    expect(BW.priority).toBe("medium");
  });

  it("has zero numeric fields", () => {
    expect(BW.force).toBe(0);
    expect(BW.roomNote).toBe(0);
    expect(BW.taste).toBe(0);
  });
});

describe("BA (accessory template)", () => {
  it("defaults to Briquet type", () => {
    expect(BA.type).toBe("Briquet");
  });

  it("defaults to active status", () => {
    expect(BA.status).toBe("active");
  });

  it("has zero rating", () => {
    expect(BA.rating).toBe(0);
  });
});

describe("BJ (session template)", () => {
  it("has empty references", () => {
    expect(BJ.tobaccoId).toBe("");
    expect(BJ.pipeId).toBe("");
    expect(BJ.lotId).toBe("");
  });

  it("has zero rating", () => {
    expect(BJ.rating).toBe(0);
  });
});

describe("INIT (initial app data)", () => {
  it("starts with empty arrays", () => {
    expect(INIT.tobaccos).toEqual([]);
    expect(INIT.wishlist).toEqual([]);
    expect(INIT.pipes).toEqual([]);
    expect(INIT.accessories).toEqual([]);
    expect(INIT.sessions).toEqual([]);
  });

  it("starts all ID counters at 1", () => {
    expect(INIT.nxT).toBe(1);
    expect(INIT.nxW).toBe(1);
    expect(INIT.nxP).toBe(1);
    expect(INIT.nxA).toBe(1);
    expect(INIT.nxJ).toBe(1);
  });
});

// ── Enumerations ──────────────────────────────────────────────────────────────

describe("CATS", () => {
  it("contains expected categories", () => {
    expect(CATS).toContain("Virginia");
    expect(CATS).toContain("Latakia");
    expect(CATS).toContain("Autre");
  });

  it("ends with Autre", () => {
    expect(CATS[CATS.length - 1]).toBe("Autre");
  });
});

describe("CATS_EN", () => {
  it("maps every CATS entry except Autre to an English name", () => {
    const untranslated = (CATS as readonly string[]).filter(
      (c) => c !== "Autre" && !CATS_EN[c]
    );
    expect(untranslated).toEqual([]);
  });

  it("maps Autre to Other", () => {
    expect(CATS_EN["Autre"]).toBe("Other");
  });
});

describe("CUTS", () => {
  it("contains common cut types", () => {
    expect(CUTS).toContain("Flake");
    expect(CUTS).toContain("Ribbon");
    expect(CUTS).toContain("Autre");
  });
});

describe("SHAPES", () => {
  it("contains Billiard (default pipe shape)", () => {
    expect(SHAPES).toContain("Billiard");
  });

  it("ends with Autre", () => {
    expect(SHAPES[SHAPES.length - 1]).toBe("Autre");
  });

  it("includes the shapes from the pipe-shape chart", () => {
    const added = [
      "Author", "Diplomat", "Belge", "Cavalier", "Volcano", "Duke",
      "Vest Pocket", "Oval", "Blowfish", "Nautilus", "Elephant Foot", "Bullcap",
      "Bent Apple", "Dawes", "Skater", "Ukelele", "Gourd Calabash",
      "Straight Rhodesian", "Bent Bulldog",
    ];
    added.forEach((s) => expect(SHAPES).toContain(s));
  });

  it("has no duplicate entries", () => {
    expect(new Set(SHAPES).size).toBe(SHAPES.length);
  });
});

describe("SHAPE_FAMILIES", () => {
  const grouped = SHAPE_FAMILIES.flatMap((f) => f.shapes);

  it("partitions SHAPES exactly — every shape in exactly one family", () => {
    expect([...grouped].sort()).toEqual([...(SHAPES as readonly string[])].sort());
  });

  it("has no shape assigned to two families", () => {
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("references no shape absent from SHAPES", () => {
    const known = new Set(SHAPES as readonly string[]);
    grouped.forEach((s) => expect(known.has(s)).toBe(true));
  });

  it("puts Autre in the 'other' family", () => {
    const other = SHAPE_FAMILIES.find((f) => f.key === "other");
    expect(other?.shapes).toContain("Autre");
  });
});

describe("category / material families", () => {
  const cases: [string, readonly string[], { labelKey: string; values: string[] }[]][] = [
    ["CAT_FAMILIES", CATS, CAT_FAMILIES],
    ["CUT_FAMILIES", CUTS, CUT_FAMILIES],
    ["BOWL_MAT_FAMILIES", BOWL_MATS, BOWL_MAT_FAMILIES],
    ["STEM_MAT_FAMILIES", STEM_MATS, STEM_MAT_FAMILIES],
  ];
  cases.forEach(([name, enumArr, fams]) => {
    const grouped = fams.flatMap((f) => f.values);
    it(`${name} partitions its enum exactly`, () => {
      expect([...grouped].sort()).toEqual([...(enumArr as readonly string[])].sort());
    });
    it(`${name} assigns no value to two families`, () => {
      expect(new Set(grouped).size).toBe(grouped.length);
    });
    it(`${name} references no value absent from the enum`, () => {
      const known = new Set(enumArr as readonly string[]);
      grouped.forEach((v) => expect(known.has(v)).toBe(true));
    });
    it(`${name} ends with the shared fam_other group holding Autre`, () => {
      const last = fams[fams.length - 1]!;
      expect(last.labelKey).toBe("fam_other");
      expect(last.values).toEqual(["Autre"]);
    });
  });
});

describe("BENDS", () => {
  it("has exactly 3 entries", () => {
    expect(BENDS).toHaveLength(3);
  });

  it("maps all entries to English", () => {
    (BENDS as readonly string[]).forEach((b) => {
      expect(BENDS_EN[b]).toBeTruthy();
    });
  });
});

describe("BOWL_MATS", () => {
  it("contains Bruyère (most common bowl material)", () => {
    expect(BOWL_MATS).toContain("Bruyère");
  });

  it("maps all entries to English", () => {
    (BOWL_MATS as readonly string[]).forEach((m) => {
      expect(BOWL_MATS_EN[m]).toBeTruthy();
    });
  });
});

describe("STEM_MATS", () => {
  it("maps all entries to English", () => {
    (STEM_MATS as readonly string[]).forEach((m) => {
      expect(STEM_MATS_EN[m]).toBeTruthy();
    });
  });
});

describe("ACC_TYPES", () => {
  it("contains Briquet (default accessory type)", () => {
    expect(ACC_TYPES).toContain("Briquet");
  });

  it("maps all entries to English", () => {
    (ACC_TYPES as readonly string[]).forEach((a) => {
      expect(ACC_TYPES_EN[a]).toBeTruthy();
    });
  });
});

describe("FILTERS", () => {
  it("contains common filter sizes", () => {
    expect(FILTERS).toContain("9mm");
    expect(FILTERS).toContain("6mm");
  });

  it("contains Métal and the two Hybride sizes", () => {
    expect(FILTERS).toContain("Métal");
    expect(FILTERS).toContain("Hybride 6mm");
    expect(FILTERS).toContain("Hybride 9mm");
  });

  it("ends with Autre", () => {
    expect(FILTERS[FILTERS.length - 1]).toBe("Autre");
  });
});

describe("FILTERS_EN", () => {
  it("maps FR-canonical entries to English", () => {
    expect(FILTERS_EN["Métal"]).toBe("Metal");
    expect(FILTERS_EN["Hybride 6mm"]).toBe("Hybrid 6mm");
    expect(FILTERS_EN["Hybride 9mm"]).toBe("Hybrid 9mm");
    expect(FILTERS_EN["Autre"]).toBe("Other");
  });

  it("leaves universally-recognised entries untranslated", () => {
    // 9mm, 6mm and Balsa are universal — no entry, the renderer passes
    // the canonical value through.
    expect(FILTERS_EN["9mm"]).toBeUndefined();
    expect(FILTERS_EN["6mm"]).toBeUndefined();
    expect(FILTERS_EN["Balsa"]).toBeUndefined();
  });

  it("only contains keys that exist in FILTERS", () => {
    const canonical = new Set(FILTERS);
    Object.keys(FILTERS_EN).forEach((k) => {
      expect(canonical.has(k as (typeof FILTERS)[number])).toBe(true);
    });
  });
});

describe("LIGHTER_FUELS", () => {
  it("contains Gaz and Essence", () => {
    expect(LIGHTER_FUELS).toContain("Gaz");
    expect(LIGHTER_FUELS).toContain("Essence");
  });
});

// ── Colors ────────────────────────────────────────────────────────────────────

describe("CAT_COLORS", () => {
  // Each value became `var(--c-cat-<slug>, <bright hex>)` so light
  // mode can substitute a darkened variant — the raw hex did not follow the
  // mode, and on the parchment ground "Virginia" rendered at 2:1. The FALLBACK
  // is what the dark theme paints, so it is still asserted to be a real hex.
  const VAR_WITH_HEX = /^var\(--c-cat-[a-z0-9-]+, (#[0-9a-f]{6})\)$/i;

  it("every value is a themed var with a valid hex fallback", () => {
    Object.values(CAT_COLORS).forEach((c) => {
      expect(c).toMatch(VAR_WITH_HEX);
    });
  });

  it("is never hex-concatenable — callers must use alpha()", () => {
    // `catColor(x) + "22"` would produce `var(…)22`, which is invalid CSS and
    // silently paints nothing. The var() shape is what forces alpha().
    Object.values(CAT_COLORS).forEach((c) => {
      expect(c.startsWith("#")).toBe(false);
    });
  });

  it("covers the most common categories", () => {
    ["Anglais", "Virginia", "Aromatique", "Balkan", "Burley", "Latakia"].forEach((c) => {
      const color = CAT_COLORS[c] ?? "";
      expect(color).toMatch(VAR_WITH_HEX);
    });
  });

  it("names its var after the category, so the light override can match", () => {
    // The light values live in MODE_LIGHT (theme-curator.ts) keyed by the same
    // slug; a mismatch would silently leave that family unthemed.
    expect(CAT_COLORS["Virginia"]).toContain("--c-cat-virginia");
    expect(CAT_COLORS["Dark Fired"]).toContain("--c-cat-dark-fired");
    expect(CAT_COLORS["Écossais"]).toContain("--c-cat-ecossais");
    expect(CAT_COLORS["Virginia/Burley"]).toContain("--c-cat-virginia-burley");
  });

  it("has a dedicated color for every CATS entry", () => {
    const withoutColor = (CATS as readonly string[]).filter((c) => !CAT_COLORS[c]);
    expect(withoutColor).toEqual([]);
  });
});

// ── Google Drive config ───────────────────────────────────────────────────────

describe("GDRIVE_FILE_PREFIX", () => {
  it("starts with cave-tabac-", () => {
    expect(GDRIVE_FILE_PREFIX).toBe("cave-tabac-");
  });
});

describe("GDRIVE_AUTO_FILENAME", () => {
  it("starts with the file prefix and ends with .json", () => {
    expect(GDRIVE_AUTO_FILENAME).toMatch(/^cave-tabac-.*\.json$/);
  });
  it("is distinct from any timestamped backup name (no date segment)", () => {
    expect(GDRIVE_AUTO_FILENAME).not.toMatch(/\d{8}-\d{6}/);
  });
});

describe("GDRIVE_MAX_MANUAL", () => {
  it("is a positive integer of at least 3", () => {
    expect(GDRIVE_MAX_MANUAL).toBeGreaterThanOrEqual(3);
    expect(Number.isInteger(GDRIVE_MAX_MANUAL)).toBe(true);
  });
});
