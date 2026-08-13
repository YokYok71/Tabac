// Shared <MaturityChip> primitive — a single-lot maturity badge
// covering ALL four bands (young / optimal / peak / tooOld).
//
// Used per-lot in the tobacco detail (LotRow) and, aggregated with counts,
// on the inventory card ("lots mixtes" indicator). The colour /
// label / warn-icon table is locked here so every call site renders the
// same chip; adding a band = edit this one file + the mat_* i18n keys.
//
// ABSORBED the former <AgingBadge>. That component named the SAME two
// states in different words, so the app shipped four strings for two states in
// every language: the "Trop âgé" filter chip listed cards reading "TROP VIEUX",
// and in EN "Overaged / Nearing peak" filtered to "Too old / Near peak". The
// resolution keeps the better half of each pair rather than one whole family —
// `mat_old` took the domain term (Overaged / Überreif / añejo / invecchiato),
// `mat_peak` kept its shorter phrasing (a chip is the app's tightest row, and
// "NÄHERT SICH DEM HÖHEPUNKT" does not fit one) — then `aging_warn`/`aging_soon`
// were deleted so there is one key per band and nothing left to re-diverge.

import { alpha, fs, C, F } from "../../theme-curator.ts";

export type MaturityBucket = "young" | "optimal" | "peak" | "tooOld";
export type MaturityChipSize = "sm" | "md" | "lg";

/** `lotAgingStatus()` speaks the two-state warn vocabulary; the chip speaks the
 *  four-band one. The old <AgingBadge> was folded in here, so this is the
 *  one place that bridges them. */
export function bucketFromAgingStatus(status: "overaged" | "approaching"): MaturityBucket {
  return status === "overaged" ? "tooOld" : "peak";
}

export interface MaturityChipProps {
  bucket: MaturityBucket;
  /** Rendered as a "· N" suffix. By default shown only when > 1 (a lone lot
   *  needs no count); pass alwaysCount to show it even for a single lot (the
   *  fiche "maturity distribution" wants the number on every band). */
  count?: number | undefined;
  /** Show the count suffix even when count === 1. Default false. */
  alwaysCount?: boolean | undefined;
  /** sm = LotRow (compact, bordered), md = inventory card,
   *  lg = LotFormModal banner (sentence case, body font). Default "md". */
  size?: MaturityChipSize | undefined;
  t?: ((k: string) => string) | undefined;
}

// fg = text/border colour ; base = the hue whose alpha tints the background ;
// warn = whether to prefix the ⚠ glyph (peak / tooOld are the "attention" bands).
const BAND: Record<MaturityBucket, { fg: string; base: string; warn: boolean; key: string; fallback: string }> = {
  young:   { fg: C.sage,      base: C.sage,    warn: false, key: "mat_young",   fallback: "Jeune" },
  optimal: { fg: C.brassHi,   base: C.brass,   warn: false, key: "mat_optimal", fallback: "Optimale" },
  peak:    { fg: C.amber,     base: C.amber,   warn: true,  key: "mat_peak",    fallback: "Pic proche" },
  tooOld:  { fg: C.oxbloodHi, base: C.oxblood, warn: true,  key: "mat_old",     fallback: "Trop âgé" },
};

const SIZE_MAP: Record<MaturityChipSize, { fontSize: string; padding: string; radius: number; border: boolean }> = {
  sm: { fontSize: fs(11), padding: "2px 6px",  radius: 3, border: true  },
  md: { fontSize: fs(12), padding: "2px 7px",  radius: 4, border: false },
  // The retired <AgingBadge> lg variant. Its GEOMETRY and typography
  // are reproduced exactly; its alpha TIERS are not — AgingBadge keyed them on
  // `overaged`, this keys them on `warn`, and peak.warn is true, so an
  // approaching lot goes 1c->22 background and 44->55 border. That is the
  // intended unification (one table for four bands), but an earlier comment
  // claiming it was "inherited verbatim" was simply inaccurate. It is
  // a banner inside the lot edit modal, so it reads as a sentence (body font,
  // no uppercase, no letter-spacing) rather than as a compact pill.
  lg: { fontSize: fs(14), padding: "6px 10px", radius: 5, border: true  },
};

export function MaturityChip({ bucket, count, alwaysCount, size = "md", t }: MaturityChipProps) {
  const b = BAND[bucket];
  const cfg = SIZE_MAP[size];
  const label = t ? t(b.key) : b.fallback;
  const showCount = count != null && count > 0 && (alwaysCount ? true : count > 1);
  const suffix = showCount ? " · " + count : "";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontFamily: size === "lg" ? F.body : F.mono,
      fontSize: cfg.fontSize, fontWeight: size === "lg" ? 600 : 700,
      letterSpacing: size === "lg" ? 0 : (size === "sm" ? 1.2 : 0.6),
      textTransform: size === "lg" ? "none" : "uppercase",
      padding: cfg.padding, borderRadius: cfg.radius,
      // Was `b.base + (b.warn ? "22" : "1c")`. Since the palette tokens
      // became `var()` values, `b.base` is `var(--c-sage, #8fbf9c)`, so that
      // concatenation produced `var(--c-sage, #8fbf9c)22` — invalid CSS, which
      // the browser drops silently. MEASURED: every maturity chip in the app was
      // rendering with backgroundColor rgba(0,0,0,0), i.e. no tint at all, on
      // the inventory cards, the lot rows and the lot modal. It reads as
      // coloured text rather than a pill, which is subtle enough to survive
      // unnoticed — and an audit pass explicitly cleared this category, having
      // grepped the `${C.x}AA` template shape and not a `+` with a ternary.
      background: alpha(b.base, b.warn ? "22" : "1c"),
      color: b.fg,
      // Same defect on the sm border (`${b.base}55` → `var(--c-sage, #8fbf9c)55`),
      // so the bordered LotRow variant was drawing no border either.
      border: cfg.border ? `1px solid ${alpha(b.base, b.warn ? "55" : "44")}` : "none",
    }}>{b.warn ? "⚠ " : ""}{label}{suffix}</span>
  );
}
