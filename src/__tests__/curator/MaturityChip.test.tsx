// Unit tests for src/components/curator/MaturityChip.tsx.

import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MaturityChip, bucketFromAgingStatus } from "../../components/curator/MaturityChip";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("MaturityChip", () => {
  it("renders each band's label via t() with the ⚠ prefix on warn bands only", () => {
    const t = (k: string) => k;
    expect(render(<MaturityChip bucket="young" t={t} />).container.textContent).toBe("mat_young");
    expect(render(<MaturityChip bucket="optimal" t={t} />).container.textContent).toBe("mat_optimal");
    expect(render(<MaturityChip bucket="peak" t={t} />).container.textContent).toBe("⚠ mat_peak");
    expect(render(<MaturityChip bucket="tooOld" t={t} />).container.textContent).toBe("⚠ mat_old");
  });

  it("falls back to French labels when no t() is supplied", () => {
    expect(render(<MaturityChip bucket="young" />).container.textContent).toBe("Jeune");
    expect(render(<MaturityChip bucket="tooOld" />).container.textContent).toBe("⚠ Trop âgé");
  });

  it("appends a count suffix only when count > 1", () => {
    const t = (k: string) => k;
    expect(render(<MaturityChip bucket="tooOld" count={1} t={t} />).container.textContent).toBe("⚠ mat_old");
    expect(render(<MaturityChip bucket="tooOld" count={3} t={t} />).container.textContent).toBe("⚠ mat_old · 3");
    expect(render(<MaturityChip bucket="peak" count={2} t={t} />).container.textContent).toBe("⚠ mat_peak · 2");
  });

  it("alwaysCount shows the suffix even for a single lot", () => {
    const t = (k: string) => k;
    expect(render(<MaturityChip bucket="optimal" count={1} alwaysCount t={t} />).container.textContent).toBe("mat_optimal · 1");
    expect(render(<MaturityChip bucket="young" count={4} alwaysCount t={t} />).container.textContent).toBe("mat_young · 4");
    // count 0 / undefined never shows a suffix, even with alwaysCount.
    expect(render(<MaturityChip bucket="young" count={0} alwaysCount t={t} />).container.textContent).toBe("mat_young");
    expect(render(<MaturityChip bucket="young" alwaysCount t={t} />).container.textContent).toBe("mat_young");
  });

  it("renders a solid border in sm size, none in md", () => {
    const sm = render(<MaturityChip bucket="peak" size="sm" />).container.querySelector("span")!;
    const md = render(<MaturityChip bucket="peak" size="md" />).container.querySelector("span")!;
    expect(sm.style.cssText).toContain("solid");
    expect(md.style.cssText).not.toContain("solid");
  });

  // ── the absorbed <AgingBadge> ──────────────────────────────
  // Its own suite was deleted with the component, so its distinguishing
  // behaviour is re-pinned here or it would be silently uncovered.

  it("lg is the banner variant: bordered, sentence case, no letter-spacing", () => {
    const lg = render(<MaturityChip bucket="tooOld" size="lg" />).container.querySelector("span")!;
    expect(lg.style.textTransform).toBe("none");
    expect(lg.style.letterSpacing).toBe("0px");
    expect(lg.style.cssText).toContain("solid");
    // md stays a compact uppercase pill — the two must not converge.
    const md = render(<MaturityChip bucket="tooOld" size="md" />).container.querySelector("span")!;
    expect(md.style.textTransform).toBe("uppercase");
    // The retired AgingBadge suite pinned lg's geometry; this replacement did
    // not, leaving both uncovered when that file was deleted. Re-pinned.
    expect(lg.style.padding).toBe("6px 10px");
    // `toContain("14")` also matched fs(114) — probed. Pin the exact size.
    expect(lg.style.fontSize).toMatch(/(^|\D)14px/);
    expect(lg.style.borderRadius).toBe("5px");
  });

  it("every size tints its background through alpha(), never hex concatenation", () => {
    // The regression this pins: the palette is var(), so
    // `token + "22"` yields `var(--c-oxblood, #a8453f)22` — invalid CSS the
    // browser DROPS, leaving the chip with no tint and no error. Measured live
    // at rgba(0,0,0,0). jsdom keeps the declaration verbatim, so
    // asserting the color-mix() form is what catches a relapse here.
    for (const size of ["sm", "md", "lg"] as const) {
      const el = render(<MaturityChip bucket="tooOld" size={size} />).container.querySelector("span")!;
      expect(el.style.background || el.style.backgroundColor).toContain("color-mix");
      expect(el.style.cssText).not.toMatch(/var\([^)]*\)[0-9a-f]{2}/i);
    }
  });

  it("bucketFromAgingStatus bridges the two-state vocabulary onto the bands", () => {
    expect(bucketFromAgingStatus("overaged")).toBe("tooOld");
    expect(bucketFromAgingStatus("approaching")).toBe("peak");
  });

  it("the aging vocabulary is unified — one key per band, no aging_* duplicates", () => {
    // An earlier release deleted aging_warn / aging_soon after they drifted from
    // mat_old / mat_peak in all five languages. If someone re-adds a second key
    // for the same state, this fails before the wording can diverge again.
    const fr = readFileSync(resolve(__dirname, "../../i18n/fr.ts"), "utf8");
    expect(fr).not.toMatch(/^\s*aging_(warn|soon):/m);
    expect(fr).toMatch(/^\s*mat_old:"Trop âgé",/m);
  });
});
