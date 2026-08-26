// FIVE WAYS THE APP WROTE THE RIGHT DATA TO THE WRONG PLACE.
//
// One shape, five doors: something asynchronous finishes and writes into
// whatever is current NOW, rather than into what asked for it. None of them
// reports anything — the user sees a fiche they did not edit change under
// them, or a field they just typed revert.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useTastingSession } from "../hooks/useTastingSession.ts";

function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

// ── 1. A late reverse-geocode reverted everything typed during a tasting ─────
//
// `tastingSetLocation` wrote `Object.assign({}, tasting, patch)` against the
// `tasting` captured at TAP time, and the window is a GPS fix plus a Nominatim
// round-trip — seconds, on a screen whose whole purpose is writing notes. So
// tapping "Capturer la position" and then typing notes, setting a rating and
// picking aromas ended with all of it blanked when the lookup landed. And
// `writeTasting` persisted the reverted object, so a reload did not recover it.
describe("a late location capture does not revert a live tasting", () => {
  function harness() {
    return renderHook(() => useTastingSession({
      data: { tobaccos: [], pipes: [], sessions: [] },
      save: vi.fn(), t: (k: string) => k, lang: "fr", weightUnit: "g",
      addSessionFromTasting: vi.fn(), loading: false, nav: vi.fn(),
      setSaveError: vi.fn(), setSaveWarn: vi.fn(),
    } as any));
  }

  it("keeps notes, rating and aromas written while the lookup was in flight", async () => {
    const { result } = harness();
    act(() => { result.current.tastingStart({ tobaccoId: "1", pipeId: "1", lotId: "1", weightG: "2" }); });
    act(() => { result.current.tastingIgnite(); });

    // THE FUNCTION REFERENCE IS GRABBED HERE, not called through
    // `result.current` later — that is the whole reproduction. `renderHook`
    // refreshes `result.current` after every `act`, so calling it at the end
    // would invoke the LATEST closure, which already holds the typed values:
    // the first version of this case did exactly that, and the probe stayed
    // green with the fix removed. What the app really does is hand
    // `captureTastingLocation` the callback built in the render where the
    // button was tapped, which is this one.
    const staleHandler = result.current.tastingSetLocation;
    const capture = () => staleHandler(48.85, 2.35, { name: "Parc", city: "Paris", country: "France" });

    act(() => { result.current.tastingUpdate({ notes: "calme, fin de journée" }); });
    act(() => { result.current.tastingUpdate({ rating: 4 }); });
    act(() => { result.current.tastingUpdate({ aromas: ["leather", "vanilla"] }); });

    act(() => { capture(); });   // …the geocode lands only now

    const live = result.current.tasting!;
    expect(live.notes, "the notes were reverted").toBe("calme, fin de journée");
    expect(live.rating).toBe(4);
    expect(live.aromas).toEqual(["leather", "vanilla"]);
    expect(live.locationCity, "…and the place must still land").toBe("Paris");
  });

  it("persists the merged state, not the snapshot", async () => {
    // The half that made it unrecoverable: `writeTasting` wrote the reverted
    // object to `cave-tasting-active`, so a reload did not bring the notes back.
    const { result } = harness();
    act(() => { result.current.tastingStart({ tobaccoId: "1", pipeId: "1", lotId: "1", weightG: "2" }); });
    act(() => { result.current.tastingIgnite(); });
    const staleHandler = result.current.tastingSetLocation;
    act(() => { result.current.tastingUpdate({ notes: "gardé" }); });
    act(() => { staleHandler(48.85, 2.35, { name: "P", city: "Paris", country: "France" }); });
    const stored = JSON.parse(localStorage.getItem("cave-tasting-active") || "{}");
    expect(stored.notes).toBe("gardé");
    expect(stored.locationCity).toBe("Paris");
  });

  it("still refuses to write once the tasting has ended", async () => {
    // Non-vacuity for moving the guards INSIDE the updater: they must still
    // fire, and now against the CURRENT state rather than the captured one —
    // so a geocode landing after the session was saved cannot resurrect it.
    const { result } = harness();
    act(() => { result.current.tastingStart({ tobaccoId: "1", pipeId: "1", lotId: "1", weightG: "2" }); });
    act(() => { result.current.tastingCancel(); });
    act(() => { result.current.tastingSetLocation(48.85, 2.35, undefined); });
    expect(result.current.tasting).toBe(null);
  });
});

// ── 2-5. Source-level, because each is a WIRING property ────────────────────
//
// These four are about which value a callback reads, which no rendered
// assertion can see: the wrong version passes every behavioural test as long
// as nothing races. What rots is the shape, so the shape is what is pinned.
describe("an async callback writes into the LATEST working copy", () => {
  const FORMS = [
    "src/views/curator/TobaccoFormView.tsx",
    "src/views/curator/WishFormView.tsx",
    "src/views/curator/PipeFormView.tsx",
    "src/views/curator/AccessoryFormView.tsx",
    "src/views/curator/SessionFormView.tsx",
  ];

  for (const f of FORMS) {
    it(`${f.split("/").pop()} patches through an updater`, () => {
      // `handlePhotoUpload` is a FileReader → Image decode → canvas →
      // IndexedDB chain, so its callback fires a fraction of a second after
      // the picker closes holding the `form` from the render in which the
      // button was tapped — reverting anything typed in between.
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, "captures `form` from the render").not.toMatch(
        /const set = \(patch: any\) => setForm\(Object\.assign\(\{\}, form, patch\)\)/);
      expect(src).toMatch(/const set = \(patch: any\) => setForm\(\(prev: any\) =>/);
    });
  }

  it("the pipe gallery APPENDS through an updater too", () => {
    // `onChange([...photos, key])` rebuilt the array from the prop captured at
    // tap time, so a second photo queued before the first landed dropped one.
    const src = blankComments(readFileSync("src/views/curator/PipeFormView.tsx", "utf8"));
    expect(src).not.toMatch(/onChange\(\[\.\.\.photos, key\]\)/);
    expect(src).toMatch(/onAppend\(key\)/);
    expect(src, "the append must read the latest photos").toMatch(/onAppend=\{\(key: string\) => setForm\(\(prev: any\) =>/);
  });
});

describe("an AI answer lands on the fiche that asked for it", () => {
  const src = blankComments(readFileSync("src/hooks/useAiAutoFill.ts", "utf8"));

  it("captures the target id when the run starts", () => {
    // The provider call has a 60 s abort budget and is not cancelled on
    // navigation, so without this the answer merged into whatever working copy
    // was current when it resolved: open tobacco A, tap Rechercher, back out,
    // open tobacco B — and one Save wrote A's data over B's row.
    expect(src).toMatch(/var targetId = type === "pipe" \? pipeForm\.id/);
  });

  it("every one of the three writers checks it", () => {
    // Three setters (pipe / wish / tobacco); a guard on two of them is a fix
    // for two thirds of the doors.
    //
    // THE GUARD WAS STRENGTHENED, NOT REPLACED, AND THIS CASE WENT RED FOR THE
    // RIGHT REASON. It used to match `if (f && f.id !== targetId) return f;`
    // exactly. The residual this file's own header discloses — two successive
    // ADD forms both carry `undefined`, so the id cannot separate them — is now
    // closed by a form-SESSION counter, so each writer tests both terms. The id
    // half is still required here: dropping it would let an answer land on a
    // DIFFERENT fiche opened within the same navigation session.
    const guards = src.match(
      /if \(f && \(f\.id !== targetId \|\| currentFormSession\(\) !== targetSession\)\) return f;/g,
    ) || [];
    expect(guards).toHaveLength(3);
  });

  it("and there are still exactly three writers to guard", () => {
    // Non-vacuity: a fourth writer added later would leave the count above
    // satisfied while the new door stays open.
    const writers = src.match(/set(?:Pipe|Wish)?Form\(function \(f: any\) \{/g) || [];
    expect(writers).toHaveLength(3);
  });
});

describe("the chamber dimensions are millimetres, whatever the length unit", () => {
  const src = blankComments(readFileSync("src/hooks/useAiAutoFill.ts", "utf8"));

  it("the AI does not convert them to inches", () => {
    // `length` and `weight` legitimately follow the user's unit — their labels
    // interpolate it. The chamber pair does not: the form label hardcodes
    // "(mm)", the fiche prints " mm", and CHAMBER_DIAMETER_MIN/MAX are 8-40
    // mm. Written in inches, a 19 mm bowl became 0.75, the bowl-weight
    // estimate collapsed to 0, and `canSave` — which requires a positive
    // weight — greyed the session Save and the tasting Ignite permanently,
    // with nothing on screen saying why.
    const cd = src.match(/var cdVal =[\s\S]{0,240}?;/)?.[0] || "";
    const cdp = src.match(/var cdpVal =[\s\S]{0,240}?;/)?.[0] || "";
    expect(cd, "cdVal not found — the sweep is vacuous").toContain("chamberDiameter");
    expect(cdp).toContain("chamberDepth");
    expect(cd).not.toContain("25.4");
    expect(cdp).not.toContain("25.4");
  });

  it("…while length and weight still do follow it", () => {
    // Non-vacuity: stripping the conversion everywhere would pass the case
    // above and silently store millimetres in a field labelled inches.
    expect(src).toMatch(/lengthUnit === "in"/);
    expect(src).toMatch(/weightUnit === "oz"/);
  });
});

describe("a fiche-local modal does not outlive its fiche", () => {
  it("the lot modals clear when the tobacco changes", () => {
    // Both detail views are mounted unconditionally and self-gate with an
    // early return, so they never unmount and their state survives: open A,
    // open the lot form, tap a dock tab, open B — and the modal is back, over
    // B, holding A's values. `nav()` clears `sessionDetail` for this reason
    // and cannot see these.
    const src = blankComments(readFileSync("src/views/curator/InventoryDetailView.tsx", "utf8"));
    expect(src).toMatch(/useEffect\(\(\) => \{ setLotForm\(null\); setLotDetail\(null\); \}, \[detail\?\.id\]\)/);
  });

  it("the maintenance modal clears when the pipe changes", () => {
    const src = blankComments(readFileSync("src/views/curator/PipesDetailView.tsx", "utf8"));
    expect(src).toMatch(/useEffect\(\(\) => \{ setMaintForm\(null\); \}, \[pipeDet\?\.id\]\)/);
  });
});
