import { describe, it, expect } from "vitest";
import { LANGUAGES } from "../i18n/languages";
import { translate } from "../i18n.ts";

/**
 * A maturity FILTER CHIP must say its own band's word.
 *
 * The four bands are labelled twice: once on the filter chips
 * (`InventoryListView`) and once on the badge (`MaturityChip`). An earlier
 * pass recorded that the two sets had drifted and left it as a product decision,
 * because unifying them changes shipped labels.
 *
 * Measured before touching anything, and the divergence was much narrower than
 * "two vocabularies": `young` differed only by a legitimate PLURAL (Jeunes /
 * Jeune, Jóvenes / Joven), and `peak` and `old` share a key outright. Exactly
 * one band was wrong — `optimal` — and in five languages the chip used a
 * different word entirely: en "At peak", de "Reif", it "A maturità",
 * es "En su punto", pt "No ponto".
 *
 * The English pair is why this had to move rather than stay a preference:
 * band 2's chip said "At peak" while band 3's badge says "Near peak", so the
 * two labels INVERT the real order — a reader takes "at peak" to be further
 * along than "near peak", and filtering "At peak" hands them the band before
 * it. That is not a wording preference, it is the control lying about which
 * slice it selects.
 *
 * THE RULE, and why it is a stem rather than equality: the chip labels a SET,
 * so a plural is right and `f_young` has always been one. What must hold is
 * that chip and badge name the SAME band with the same word.
 */

/** Fold accents and case so "Óptimas"/"Óptima" compare as one word. */
const stem = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 4);

const BANDS = [
  { band: "young", chip: "f_young", badge: "mat_young" },
  { band: "optimal", chip: "f_optimal", badge: "mat_optimal" },
  // `peak` and `old` share one key between chip and badge, so they cannot
  // drift; they are listed to document the full set, not because they need it.
  { band: "peak", chip: "mat_peak", badge: "mat_peak" },
  { band: "old", chip: "mat_old", badge: "mat_old" },
];

describe("maturity chip and badge name the same band", () => {
  const codes = LANGUAGES.map((l) => l.code);

  it("has more than one language and four bands, so it cannot pass vacuously", () => {
    expect(codes.length).toBeGreaterThan(1);
    expect(BANDS.length).toBe(4);
  });

  it("uses the same word on the chip and the badge, in every language", () => {
    for (const { band, chip, badge } of BANDS) {
      for (const code of codes) {
        const c = translate(code, chip), b = translate(code, badge);
        expect(c, `${band}/${code}: the chip key ${chip} does not resolve`).not.toBe(chip);
        expect(b, `${band}/${code}: the badge key ${badge} does not resolve`).not.toBe(badge);
        expect(stem(c),
          `${band}/${code}: the filter chip says "${c}" while the badge says "${b}". ` +
          "A chip must name its own band — see the en At peak / Near peak inversion.")
          .toBe(stem(b));
      }
    }
  });

  it("never lets a chip borrow ANOTHER band's word", () => {
    // The stronger half. The defect was not merely "different words",
    // it was the optimal chip wearing the peak band's vocabulary.
    for (const code of codes) {
      for (const { band, chip } of BANDS) {
        const c = stem(translate(code, chip));
        for (const other of BANDS) {
          if (other.band === band) continue;
          expect(c, `${code}: the ${band} chip and the ${other.band} badge read alike`)
            .not.toBe(stem(translate(code, other.badge)));
        }
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// The fiche's aging BANNER and the per-lot CHIPS describe the same lots —
// `bucketFromAgingStatus` maps `lotAgingStatus`'s "approaching" straight onto
// the `peak` bucket — so the banner must not wear a DIFFERENT band's word.
//
// Spanish did: `aging_nearing_peak` read « cerca del óptimo » while
// `mat_optimal` is « Óptima » and `mat_peak` is « Cerca del pico ». So the
// banner named the band BEFORE the one it was describing, on the same screen
// as the chips that name it correctly. That is the defect — a label
// naming a different band from the one it selects — one surface over.
//
// The other five were already consistent, and two of them legitimately use a
// different word for the same band (fr « approchent la maturité », pt « perto
// da maturidade »): what is forbidden is not a synonym, it is wearing ANOTHER
// band's word.
describe("the aging banner never wears another band's word", () => {
  const fold = (s: string) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  for (const { code } of LANGUAGES) {
    it(`${code}: the banner does not use the optimal band's word`, () => {
      const banner = fold(translate(code, "aging_nearing_peak"));
      const optimal = fold(translate(code, "mat_optimal"));
      const peak = fold(translate(code, "mat_peak"));
      expect(banner.length, `${code} banner missing`).toBeGreaterThan(3);
      // A 4-char stem, like the sibling checks in this file, so a gendered or
      // pluralised form of the SAME word still matches.
      const stem = (w: string) => w.replace(/[^a-z]/g, "").slice(0, 4);
      expect(banner, `${code} says the OPTIMAL band's word in the PEAK banner`)
        .not.toContain(stem(optimal));
      // and it must still be recognisable as the peak band
      expect(banner.indexOf(stem(peak)) >= 0 || banner.length > 8,
        `${code} banner reads as neither band`).toBe(true);
    });
  }
});
