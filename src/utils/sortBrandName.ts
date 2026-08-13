/**
 * THE brand-then-name comparator, in one place.
 *
 * The inventory list has sorted by brand then name since long before this file
 * existed (`sortBy === "brand"` in App.tsx), and the collection report was
 * given the same order. Writing it twice is how this repo keeps getting bitten:
 * the tag predicate lived in four copies, `FAMILY_AGING_MAX` was
 * mirrored into the importer, and `CATS` into the validator, each for a long
 * time before anyone noticed. A printed report that quietly stops matching the list on
 * screen is the same failure with a longer fuse.
 *
 * Its own module rather than `utils.ts` because `collectionReport.ts` is
 * deliberately DEPENDENCY-FREE and language-neutral — that is its whole design
 * premise — and `utils.ts` imports `LANG`. A four-line comparator must not drag
 * the i18n machinery into a string-only module.
 *
 * The comparison is `localeCompare` on the RAW value, not a lowercased one:
 * that is what App.tsx has always done, and matching it is the point. A missing
 * brand becomes `""` and therefore sorts first, which is also what the app does.
 * The receiver is `String(...)`-coerced because a stored field can be anything
 * a hand-edited backup put there — the `tabac-local/string-locale-compare` rule
 * exists for exactly the crash that caused.
 */

export interface BrandNamed {
  brand?: unknown;
  name?: unknown;
}

/** Brand first, then name. Stable for equal pairs (Array#sort is stable). */
export function compareByBrandThenName(a: BrandNamed, b: BrandNamed): number {
  const byBrand = String((a && a.brand) || "").localeCompare(String((b && b.brand) || ""));
  if (byBrand !== 0) return byBrand;
  return String((a && a.name) || "").localeCompare(String((b && b.name) || ""));
}

/** A sorted COPY — callers must never reorder the array they were handed. */
export function sortByBrandThenName<T extends BrandNamed>(list: readonly T[] | null | undefined): T[] {
  return (Array.isArray(list) ? list.slice() : []).sort(compareByBrandThenName);
}
