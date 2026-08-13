import { describe, it, expect } from "vitest";
import {
  planCatalogueApply, applyCataloguePlan,
  APPLIED_FIELDS, PROTECTED_FIELDS,
} from "../utils/catalogueApply.ts";
import { BT, BW } from "../constants.ts";
import { migrateData } from "../utils.ts";
import { readFileSync } from "node:fs";

// The bulk catalogue pass.
//
// This feature is one promise: "personal data is never overwritten". Over 200
// rows nobody can verify that by looking, so it is asserted here field by
// field — and the fixtures are built FROM THE TEMPLATES (BT / BW) so a new
// personal field added to Tobacco later is covered by the sweep below rather
// than silently exposed.

const HIT = {
  brandDisplay: "Halvorsen", name: "Duskfall",
  category: "Anglais", cut: "Ribbon", blend: "Virginia, Latakia, Perique",
  force: 4, roomNote: 3, taste: 4, agingMax: "6-10",
  description: "La prose du catalogue.",
};
const lookup = (b: string, n: string) =>
  (b.toLowerCase() === "halvorsen" && n.toLowerCase() === "duskfall") ? HIT : null;

const tob = (over: any = {}) => Object.assign({}, BT, { id: 1, brand: "Halvorsen", name: "Duskfall" }, over);
const wish = (over: any = {}) => Object.assign({}, BW, { id: 7, brand: "Halvorsen", name: "Duskfall" }, over);
const plan = (d: any) => planCatalogueApply(d, "fr", lookup);
const run = (d: any) => applyCataloguePlan(d, plan(d), "2026-07-30T10:00:00.000Z");

describe("catalogueLock — the per-fiche opt-out", () => {
  it("skips a pinned tobacco entirely and counts it apart", () => {
    // The promise is "never overwritten", so the row must not even reach the
    // lookup. It is counted in `locked` and NOT in unmatched/alreadyCurrent:
    // folding it into either would misreport it in the confirm modal, which
    // is the one place the user decides.
    const p = plan({ tobaccos: [tob({ catalogueLock: true })], wishlist: [] });
    expect(p.entries).toEqual([]);
    expect(p.locked).toBe(1);
    expect(p.unmatched).toBe(0);
    expect(p.alreadyCurrent).toBe(0);
    expect(p.tobaccosChanged).toBe(0);
  });

  it("skips a pinned wishlist item the same way", () => {
    const p = plan({ tobaccos: [], wishlist: [wish({ catalogueLock: true })] });
    expect(p.entries).toEqual([]);
    expect(p.locked).toBe(1);
    expect(p.wishesChanged).toBe(0);
  });

  it("leaves a pinned row byte-identical through a real apply", () => {
    // The plan is empty, but assert the OUTCOME rather than the plan: a future
    // refactor could reintroduce the write on the apply side.
    const before = tob({ catalogueLock: true, category: "Aromatique", force: 1 });
    const data = { tobaccos: [before], wishlist: [wish()] };
    const after = run(data).tobaccos[0];
    expect(after).toEqual(before);
    expect(after.updatedAt).toBeUndefined();   // not even touched by LWW
  });

  it("does not stop the pass for everyone else", () => {
    // A lock is per-row. The unpinned sibling must still be updated, or the
    // feature would quietly become a global off switch.
    const p = plan({
      tobaccos: [tob({ id: 1, catalogueLock: true }), tob({ id: 2 })],
      wishlist: [],
    });
    expect(p.locked).toBe(1);
    expect(p.tobaccosChanged).toBe(1);
    expect(p.entries[0]!.id).toBe(2);
  });

  it("treats absent and false as the same thing", () => {
    // Legacy rows carry no field at all; the template seeds `false`. Neither
    // may be read as a lock, or the pass would silently do nothing on an old
    // cellar — the worst failure mode, since it looks like success.
    const legacy = tob(); delete (legacy as any).catalogueLock;
    const p = plan({ tobaccos: [legacy, tob({ id: 2, catalogueLock: false })], wishlist: [] });
    expect(p.locked).toBe(0);
    expect(p.tobaccosChanged).toBe(2);
  });

  it("names the flag itself as protected", () => {
    // Unreachable today (a locked row never enters the plan) but stated, so
    // the pass can never clear the flag that keeps a row out of it.
    expect([...PROTECTED_FIELDS]).toContain("catalogueLock");
  });

  it("is seeded by both templates, so a fresh fiche starts unlocked", () => {
    expect((BT as any).catalogueLock).toBe(false);
    expect((BW as any).catalogueLock).toBe(false);
  });
});

// The two neighbouring paths an adversarial review of the lock found, both
// fixed. They live here rather than in their own stores' suites
// because what they guard is THIS module's promise.
describe("the lock travels with the data it protects", () => {
  it("survives wishToInv — a locked wish becomes a locked tobacco", async () => {
    // wishToInv copies an allowlist of 12 fields, and it is the CURATED ones:
    // composition, force, description, tasting notes. Dropping the lock would
    // hand the next bulk pass exactly the fields the wish was locked to keep.
    const { useWishStore } = await import("../hooks/useWishStore.ts");
    void useWishStore;   // imported for the path, driven through the source below
    const src = readFileSync("src/hooks/useWishStore.ts", "utf8");
    const fn = src.slice(src.indexOf("function wishToInv"), src.indexOf("function toggleWishGroup"));
    expect(fn, "could not isolate wishToInv — this test must not pass vacuously").toContain("agingMax");
    expect(fn, "wishToInv must carry catalogueLock across the conversion").toContain("catalogueLock");
  });

  it("is normalised to a strict boolean on load", () => {
    // A hand-edited backup can carry anything. `"no"` is TRUTHY, so a `!!`
    // coercion would read it as LOCKED — the check has to be `=== true`.
    const migrated: any = migrateData({
      tobaccos: [{ id: 1, name: "N", brand: "B", lots: [], catalogueLock: "no" }],
      wishlist: [{ id: 2, name: "N", brand: "B", catalogueLock: 1 }],
      pipes: [], accessories: [], sessions: [],
    });
    expect(migrated.tobaccos[0].catalogueLock).toBe(false);
    expect(migrated.wishlist[0].catalogueLock).toBe(false);
    // A real lock survives, and a row that never had the key keeps not having
    // it — absent and false mean the same thing, and rewriting every legacy
    // row to add a false would be churn for nothing.
    const kept: any = migrateData({
      tobaccos: [{ id: 1, name: "N", brand: "B", lots: [], catalogueLock: true },
                 { id: 2, name: "M", brand: "B", lots: [] }],
      wishlist: [], pipes: [], accessories: [], sessions: [],
    });
    expect(kept.tobaccos[0].catalogueLock).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(kept.tobaccos[1], "catalogueLock")).toBe(false);
  });
});

describe("planCatalogueApply — what would change", () => {
  it("fills the factual fields the catalogue can speak for", () => {
    const p = plan({ tobaccos: [tob()], wishlist: [] });
    expect(p.tobaccosChanged).toBe(1);
    const fields = p.entries[0]!.changes.map((c) => c.field).sort();
    expect(fields).toEqual([...APPLIED_FIELDS].sort());
  });

  it("counts a row that already matches as alreadyCurrent, and plans nothing", () => {
    // Load-bearing: a user who runs the pass twice must see "nothing to do",
    // not a second round of identical writes bumping every updatedAt.
    const done = tob({
      category: "Anglais", cut: "Ribbon", blend: "Virginia, Latakia, Perique",
      force: 4, roomNote: 3, taste: 4, agingMax: "6-10",
      description: "La prose du catalogue.",
    });
    const p = plan({ tobaccos: [done], wishlist: [] });
    expect(p.entries).toEqual([]);
    expect(p.alreadyCurrent).toBe(1);
  });

  it("compares numbers and strings by value, so 3 and \"3\" are the same", () => {
    // The cellar stores force/roomNote/taste as numbers; a catalogue or an
    // import may hand over strings. Without this, every run would report the
    // same three fields as changed for ever.
    const p = plan({ tobaccos: [tob({ force: "4", roomNote: "3", taste: "4" })], wishlist: [] });
    const fields = p.entries[0]!.changes.map((c) => c.field);
    expect(fields).not.toContain("force");
    expect(fields).not.toContain("roomNote");
    expect(fields).not.toContain("taste");
  });

  it("counts an unmatched blend and leaves it out", () => {
    const p = plan({ tobaccos: [tob({ brand: "Marque Inconnue", name: "Rien" })], wishlist: [] });
    expect(p.entries).toEqual([]);
    expect(p.unmatched).toBe(1);
  });

  it("skips a trashed row — restoring it must not surprise the user", () => {
    const p = plan({ tobaccos: [tob({ deletedAt: "2026-07-01T00:00:00.000Z" })], wishlist: [] });
    expect(p.entries).toEqual([]);
    expect(p.unmatched + p.alreadyCurrent).toBe(0);
  });

  it("never proposes a field the catalogue leaves empty", () => {
    const thin = { brandDisplay: "Halvorsen", name: "Duskfall", category: "Anglais" };
    const p = planCatalogueApply({ tobaccos: [tob()], wishlist: [] }, "fr", () => thin);
    expect(p.entries[0]!.changes.map((c) => c.field)).toEqual(["category"]);
  });

  it("covers the wishlist as well as the cellar", () => {
    const p = plan({ tobaccos: [tob()], wishlist: [wish()] });
    expect(p.tobaccosChanged).toBe(1);
    expect(p.wishesChanged).toBe(1);
  });
});

describe("the promise: personal data is never overwritten", () => {
  // A value in every protected field, deliberately unlike anything the
  // catalogue could supply, so a leak is unmistakable.
  const PERSONAL = {
    tastingNotes: "MES notes de dégustation.",
    rating: 5,
    rebuy: false,
    imageUrl: "local-photo-1750000000000-abcd1234",
    tags: ["voyage", "cadeaux"],
    lots: [{ id: 9, status: "jar", weightG: "17", price: "12.50" }],
  };

  it("leaves every protected field untouched on a tobacco", () => {
    const before = tob(PERSONAL);
    const after = run({ tobaccos: [before], wishlist: [] }).tobaccos[0];
    for (const f of PROTECTED_FIELDS) {
      expect(after[f], `${f} must not be rewritten`).toEqual(before[f]);
    }
  });

  it("leaves the wishlist's personal note and priority untouched", () => {
    const before = wish({ notes: "Cadeau pour Paul", priority: "high", tastingNotes: "MES notes." });
    const after = run({ tobaccos: [], wishlist: [before] }).wishlist[0];
    expect(after.notes).toBe("Cadeau pour Paul");
    expect(after.priority).toBe("high");
    expect(after.tastingNotes).toBe("MES notes.");
  });

  it("touches NOTHING outside APPLIED_FIELDS and updatedAt", () => {
    // The general form of the promise: whatever the templates grow later, only
    // the declared factual fields plus the edit stamp may differ.
    const before = tob(PERSONAL);
    const after = run({ tobaccos: [before], wishlist: [] }).tobaccos[0];
    const allowed = new Set<string>([...APPLIED_FIELDS, "updatedAt"]);
    const moved = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    expect(moved.filter((k) => !allowed.has(k))).toEqual([]);
  });

  it("keeps the two field lists disjoint", () => {
    // If an edit ever put a field in both, the guard inside applyCataloguePlan
    // would silently win over the intent. Better to fail here.
    const overlap = (APPLIED_FIELDS as readonly string[]).filter(
      (f) => (PROTECTED_FIELDS as readonly string[]).indexOf(f) !== -1);
    expect(overlap).toEqual([]);
  });

  it("excludes identity — a bulk pass must not rename what the user recognises", () => {
    // The one place this pass is deliberately STRICTER than useDbSync, which
    // does offer name/brand because the user is looking at that single fiche.
    expect(APPLIED_FIELDS).not.toContain("name");
    expect(APPLIED_FIELDS).not.toContain("brand");
    const before = tob({ brand: "halvorsen", name: "duskfall" });   // lower-case variant
    const after = run({ tobaccos: [before], wishlist: [] }).tobaccos[0];
    expect(after.brand).toBe("halvorsen");
    expect(after.name).toBe("duskfall");
  });
});

describe("applyCataloguePlan", () => {
  it("writes the catalogue values and stamps updatedAt", () => {
    const after = run({ tobaccos: [tob()], wishlist: [] }).tobaccos[0];
    expect(after.category).toBe("Anglais");
    expect(after.agingMax).toBe("6-10");
    expect(after.description).toBe("La prose du catalogue.");
    expect(after.updatedAt).toBe("2026-07-30T10:00:00.000Z");
  });

  it("returns the SAME data object when there is nothing to do", () => {
    // So a no-op run cannot dirty the cellar, trigger a cloud save, or bump a
    // single updatedAt.
    const d = { tobaccos: [tob({ brand: "Inconnu", name: "Rien" })], wishlist: [] };
    expect(applyCataloguePlan(d, plan(d), "2026-07-30T10:00:00.000Z")).toBe(d);
  });

  it("leaves rows outside the plan strictly alone", () => {
    const other = tob({ id: 2, brand: "Autre", name: "Chose", rating: 3 });
    const out = run({ tobaccos: [tob(), other], wishlist: [] });
    expect(out.tobaccos[1]).toBe(other);   // same reference, untouched
  });

  it("is idempotent — a second pass finds nothing left to do", () => {
    const first = run({ tobaccos: [tob()], wishlist: [wish()] });
    const second = plan(first);
    expect(second.entries).toEqual([]);
    expect(second.alreadyCurrent).toBe(2);
  });
});
