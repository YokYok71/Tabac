import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

// Every grid track in the UI must be allowed to shrink.
//
// `1fr` is `minmax(auto, 1fr)` and an implicit track is `auto`. BOTH floor the
// track at its content's min-content width, so ONE wide child makes the whole
// grid refuse to fit its container — and, because the container above it is
// usually `overflow-y: auto` (which makes CSS compute overflow-x to `auto`
// too), the page becomes draggable sideways.
//
// That is not a hypothesis. It shipped twice:
//   - Settings → Données: the "Clé API" row's min-content of 361px
//     sized the whole section's column, and the tab slid left and right under
//     a finger. Reported from the app.
//   - the lot form modal: the same shape, found by the new
//     i18n:layout scroller gate on its first honest run — before a user saw it,
//     which is the whole point of the gate.
//
// `minmax(0, …)` removes only the FLOOR. When there is room, nothing changes —
// which is why the sweep across 20 grids was safe and measured clean at both
// text sizes and both widths.
//
// A deliberately content-sized track is still allowed: `auto` may appear
// explicitly (CatalogView pairs `auto` with `minmax(0, 1fr)` for an icon column
// beside flexible text). What is banned is the SILENT floor — an implicit
// track, or a bare `1fr`.

const ROOT = resolve(__dirname, "..");
const SKIP = new Set(["__tests__", "data", "i18n"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(tsx|jsx)$/.test(e)) out.push(p);
  }
  return out;
}

// Template interpolations are flattened FIRST: a style object routinely holds
// `border: `1px solid ${C.rule}`` and those braces break the exclusion below,
// so the object goes unmatched — which is not a false positive, it is a silent
// MISS. Probed: without this line, dropping `gridTemplateColumns` from
// LotFormModal's card leaves this file green.
const flatten = (s: string) => s.replace(/\$\{[^{}]*\}/g, "TPL");

// A style object literal, brace-bounded so it ends at its own closing brace
// rather than swallowing the next declaration.
// Comments blanked, length-preserving. The explanation above each fix quotes
// the very strings asserted below, and a check satisfied by prose stays green
// under probe — this file's neighbourhood has hit that trap three times.
const strip = (s: string) => flatten(s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " ")));

const STYLE_OBJ = /\{[^{}]*display:\s*"grid"[^{}]*\}/g;

describe("grid tracks can shrink", () => {
  const files = sources(ROOT);

  it("finds the grids at all", () => {
    const n = files.reduce((a, f) => a + (strip(readFileSync(f, "utf8")).match(STYLE_OBJ) || []).length, 0);
    // Non-vacuous: if the matcher stops finding grids, every assertion below
    // passes for the wrong reason.
    expect(n).toBeGreaterThanOrEqual(15);
  });

  it("declares gridTemplateColumns on every grid — no implicit `auto` track", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const blk of strip(readFileSync(f, "utf8")).match(STYLE_OBJ) || []) {
        if (!blk.includes("gridTemplateColumns")) bad.push(`${f.replace(ROOT, "src")}: ${blk.slice(0, 70)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("never uses a bare `1fr` — it floors the track at min-content", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/gridTemplateColumns:\s*"([^"]*)"/g)) {
        const value = m[1]!;
        // Strip the legitimate wrappers, then look for anything left saying 1fr.
        const rest = value.replace(/minmax\(\s*0\s*,\s*[^)]*\)/g, "");
        if (/\b1fr\b/.test(rest)) bad.push(`${f.replace(ROOT, "src")}: "${value}"`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * Every JSX opening tag in `src`, as raw text from its `<` to the matching
 * `>`. Brace depth is tracked so a `style={{ … }}` prop cannot end the tag
 * early, and string literals are skipped so a `>` inside one cannot either.
 *
 * This exists so the scroller assertions below can ask about ONE ELEMENT
 * instead of about a whole file — see the note on that block.
 */
function openingTags(src: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "<" || !/[A-Za-z]/.test(src[i + 1] || "")) continue;
    let depth = 0;
    let j = i + 1;
    let ok = false;
    for (; j < src.length; j++) {
      const c = src[j]!;
      if (c === '"' || c === "'" || c === "`") {
        const q = c;
        j++;
        while (j < src.length && src[j] !== q) { if (src[j] === "\\") j++; j++; }
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === "<" && depth === 0) break;      // not an opening tag
      else if (c === ">" && depth === 0) { ok = true; break; }
    }
    if (ok) { out.push(src.slice(i, j + 1)); i = j; }
  }
  return out;
}

const HSCROLL_DECL = /overflowX:\s*"(auto|scroll)"/;

describe("the i18n:layout scroller gate knows which scrollers are deliberate", () => {
  // The gate fails on any element that can be dragged sideways unless it
  // carries `data-hscroll`. Presence is an ACKNOWLEDGEMENT, not a claim of
  // correctness — the same philosophy as the no-unscoped-lot-read ESLint rule.
  //
  // THIS BLOCK USED TO PROMISE "the marker sits on the element that actually
  // scrolls" AND CHECK NOTHING OF THE KIND: two independent `toContain` calls
  // over the whole FILE, so moving `data-hscroll` onto any other element in
  // the same file left it green while the real scroller went unacknowledged
  // and the layout gate went red for a reason nobody could see here.
  //
  // The unit is the JSX OPENING TAG now: the marker and the `overflowX`
  // declaration must belong to the same element, in both directions — a marker
  // on a non-scrolling element acknowledges nothing either.
  const owners = [
    "components/curator/FilterControls.tsx",
    "views/curator/StatsView.tsx",
  ] as const;

  owners.forEach((rel) => {
    it(`${rel} marks the element that actually scrolls`, () => {
      const tags = openingTags(strip(readFileSync(resolve(ROOT, rel), "utf8")));
      const marked = tags.filter((tg) => tg.includes("data-hscroll"));
      expect(marked.length, "no element in this file carries data-hscroll").toBe(1);
      expect(HSCROLL_DECL.test(marked[0]!),
        "the marked element does not declare a horizontal scroller of its own").toBe(true);
    });
  });

  it("finds the opening tags at all", () => {
    // Non-vacuous: a scanner that stops returning tags makes every assertion
    // in this block pass by examining nothing.
    const n = sources(ROOT).reduce(
      (a, f) => a + openingTags(strip(readFileSync(f, "utf8"))).length, 0);
    expect(n).toBeGreaterThan(500);
  });

  it("nothing else in the app declares a horizontal scroller", () => {
    // A new one is not forbidden — it just has to be marked ON ITSELF, which
    // is exactly the conversation this assertion forces.
    const found: string[] = [];
    for (const f of sources(ROOT)) {
      for (const tg of openingTags(strip(readFileSync(f, "utf8")))) {
        const scrolls = HSCROLL_DECL.test(tg);
        const marked = tg.includes("data-hscroll");
        if (scrolls !== marked) {
          found.push(`${f.replace(ROOT, "src")}: ${scrolls ? "unmarked scroller" : "marker on a non-scroller"} — ${tg.slice(0, 80).replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});
