// The `imgLocal` map is rebuilt in NINE places, and one
// `Object.assign({}, prev, …)` at any of them restores the prototype and
// re-opens the forged-`imageUrl` hole (see forgedImageUrl.test.ts for what
// that cost: a permanently bricked app from one imported file).
//
// A comment asking nine call sites to stay in step is not a mechanism — this
// repo has recorded that lesson at the mirrored enum tables, the
// "must mirror src/utils.ts" importer copy (168), and the tag predicate that
// lived in four copies until 190. So this is the sweep.
//
// It keys on the SETTER, not on a spelling of the rebuild: any `setImgLocal`
// updater that constructs its result with a bare `{}` fails, however it is
// written. Comments are blanked first — a prose mention of
// `Object.assign({}, prev)` explaining the fix must not read as a violation
// (the trap CLAUDE.md records at doc:check gate 15 and).

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

// Every file that owns a rebuild of the map.
const OWNERS = [
  "App.tsx",
  "hooks/useImportConfirm.ts",
  "views/curator/AccessoryFormView.tsx",
  "views/curator/WishFormView.tsx",
  "views/curator/PipeFormView.tsx",
];

function sourceWithoutComments(rel: string): string {
  const raw = readFileSync(join(ROOT, rel), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

describe("the imgLocal map is never rebuilt with a prototype", () => {
  it("finds the setter in every file this sweep claims to cover", () => {
    // Non-vacuity: if a file stops calling setImgLocal the sweep below would
    // pass by checking nothing, which is the failure mode it exists to stop.
    for (const rel of OWNERS) {
      expect(sourceWithoutComments(rel), rel).toContain("setImgLocal(");
    }
  });

  it("no setImgLocal updater constructs its result with a bare {}", () => {
    const offenders: string[] = [];
    for (const rel of OWNERS) {
      const src = sourceWithoutComments(rel);
      // Take a generous window after each setImgLocal( — the updaters are
      // short, and a multi-statement one still lands inside it.
      let i = src.indexOf("setImgLocal(");
      while (i !== -1) {
        const body = src.slice(i, i + 420);
        if (/Object\.assign\(\s*\{\s*\}/.test(body)) {
          const line = src.slice(0, i).split("\n").length;
          offenders.push(`${rel}:${line}`);
        }
        i = src.indexOf("setImgLocal(", i + 1);
      }
    }
    expect(offenders, "these updaters restore Object.prototype on the photo map").toEqual([]);
  });

  it("the initial state is built by imgMap, not by a literal", () => {
    const app = sourceWithoutComments("App.tsx");
    expect(app).toMatch(/useState<Record<string,\s*any>>\(imgMap\(\)\)/);
  });

  it("imgMap is the ONE builder — it lives in imgCache and is exported", () => {
    const mod = sourceWithoutComments("utils/imgCache.ts");
    expect(mod).toMatch(/export function imgMap\(/);
    expect(mod).toContain("Object.create(null)");
  });
});
