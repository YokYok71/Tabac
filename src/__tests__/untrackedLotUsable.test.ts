/**
 * An OPENED JAR the user never weighed must be smokeable.
 *
 * Reported from the app: « dans mes tabacs disponibles quand je veux lancer
 * une session […] je n'ai pas tous les tabacs en pots (ouverts donc) ».
 *
 * `safeWeight("")` is 0, so a blank weight read as an empty tin and the
 * tobacco disappeared from the session picker entirely — the tin is open on
 * the desk and the app refuses to log a bowl from it. `checkLotInvariants`
 * has drawn the right distinction (a blank weight is an
 * ABSENCE of data, not a zero) and was the only place that had it.
 *
 * The three readers must agree, which is why they are tested together: offer
 * the lot, do not invent a balance for it, and do not announce a closure that
 * will not happen.
 */
import { describe, it, expect } from "vitest";
import { isUsableLot, tobaccoHasUsableLot, stepApplyDelta, stepAutoFinish, lotWillClose, pickJarLot, pickSessionLot } from "../utils/lotUtils.ts";
import { isUntrackedWeight, fmtLotWeight, lotPickerLabel } from "../utils.ts";
import { checkLotInvariants } from "../utils/lotInvariants.ts";
import { safeWeight } from "../utils.ts";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages.ts";
import { translate } from "../i18n.ts";

const jar = (over: any = {}) => ({
  id: 1, status: "jar", originalStatus: "jar", dateOpened: "2026-01-01", ...over,
});

describe("an unweighed lot is held stock, not an empty tin", () => {
  it("offers an opened jar with no recorded weight", () => {
    for (const w of ["", undefined, null]) {
      expect({ w, ok: isUsableLot(jar({ weightG: w })) }).toEqual({ w, ok: true });
    }
  });

  it("still hides a lot the user weighed at ZERO — that one is empty", () => {
    // The distinction the whole fix rests on. An explicit 0 auto-finishes
    // anyway; only an ABSENCE may keep the lot available.
    expect(isUsableLot(jar({ weightG: "0" }))).toBe(false);
  });

  it("puts the tobacco back in the session picker", () => {
    expect(tobaccoHasUsableLot({ lots: [jar({ weightG: "" })] })).toBe(true);
  });

  it("keeps a cellar lot usable too, unweighed", () => {
    expect(isUsableLot({ id: 2, status: "cellar", weightG: "" })).toBe(true);
  });

  it("never offers a finished or trashed lot, weighed or not", () => {
    expect(isUsableLot({ status: "finished", weightG: "" })).toBe(false);
    expect(isUsableLot(jar({ weightG: "", deletedAt: "2026-01-02" }))).toBe(false);
  });

  it("does NOT invent a balance when a session debits it", () => {
    // The load-bearing half: without this, one session would write
    // weightG:"0" (max(0, 0 − 2.5)) and the next step would close the tin.
    const lot = jar({ weightG: "" });
    const after = stepApplyDelta(lot, -2.5, "g");
    expect(after.weightG).toBe("");
    expect(stepAutoFinish(after).status).toBe("jar");
  });

  it("still debits a lot that DOES carry a weight", () => {
    expect(stepApplyDelta(jar({ weightG: "12" }), -2.5, "g").weightG).toBe("9.5");
  });

  it("does not announce a closure that will not happen", () => {
    expect(lotWillClose(jar({ weightG: "" }), 2.5)).toBe(false);
    expect(lotWillClose(jar({ weightG: "2" }), 2.5)).toBe(true);
  });

  it("raises no invariant violation — the sole notion, one definition", () => {
    // The predicate moved out of checkLotInvariants; this asserts the two
    // readers still agree rather than trusting that they do.
    expect(isUntrackedWeight("")).toBe(true);
    expect(isUntrackedWeight("0")).toBe(false);
    const v = checkLotInvariants({ tobaccos: [{ id: 1, name: "T", lots: [jar({ weightG: "", weightInitial: "" })] }] });
    expect(v.map((x: any) => x.rule)).toEqual([]);
  });
});

// The FIFTH reader, found by a review of the session
// mechanics shipped. `_persistSession` caps the recorded
// weight to the lot's balance so a session can never claim more than the tin
// holds; against an UNWEIGHED lot that cap is `Math.min(w, 0)`, so every
// session logged on the very path the unweighed-lot rule opened was stored at 0 g —
// silently, and un-correctable by editing (both edit branches capped too).
describe("the weight cap must not read an absence as an empty tin", () => {
  const cap = (w: number, lotW: any) =>
    isUntrackedWeight(lotW) ? w : Math.min(w, safeWeight(lotW));

  it("records the weight the user typed on an unweighed lot", () => {
    for (const lotW of ["", undefined, null]) {
      expect({ lotW, w: cap(2.5, lotW) }).toEqual({ lotW, w: 2.5 });
    }
  });

  it("STILL caps against a lot that really does carry a balance", () => {
    // The cap is not disabled — that is the whole point of the carve-out.
    expect(cap(2.5, "12")).toBe(2.5);
    expect(cap(2.5, "1")).toBe(1);
    expect(cap(2.5, "0")).toBe(0);
  });

  it("keeps the three call sites in step", async () => {
    // The defect was ONE of three caps; the two edit branches had it too, so a
    // 0 g session could not be fixed by hand. Asserted on source because the
    // store needs a full React context to exercise.
    const src = await readFile("src/hooks/useSessionStore.ts", "utf8");
    const caps = src.split("\n").filter((l) => /Math\.min\([^)]*safeW\(cap/.test(l) || /avail = safeW\(cap/.test(l));
    expect(caps.length, "three caps read a lot balance").toBe(3);
    for (const line of caps) {
      expect(line.includes("isUntrackedWeight") || /avail = safeW/.test(line),
        `a cap ignores the untracked case: ${line.trim()}`).toBe(true);
    }
    // The `avail` one guards on its enclosing `if`, so check that too.
    expect(src).toMatch(/if \(capL && !isUntrackedWeight\(capL\.weightG\)\) \{/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The audit of the session mechanic. Three defects, one
// root: two predicates disagreed about which lots a session may charge.
// ─────────────────────────────────────────────────────────────────────────
describe("pickJarLot and isUsableLot agree", () => {
  it("never auto-selects a lot the picker refuses to list", () => {
    // REPRODUCED before the fix: usable = [C], picked = J. A tobacco with a
    // 0 g jar and a full cellar lot is offered in both session pickers (the
    // cellar lot makes it usable); the auto-select landed on the EMPTY JAR,
    // which is absent from the picker's option list — so the <select>
    // displayed the cellar lot while the state held the jar, and the session
    // was capped to 0 g against it.
    const tob = { id: 1, lots: [
      { id: "J", status: "jar", weightG: "0", dateOpened: "2025-01-01" },
      { id: "C", status: "cellar", weightG: "50", datePurchased: "2024-01-01" },
    ] };
    const usable = tob.lots.filter(isUsableLot);
    expect(usable.map((l: any) => l.id)).toEqual(["C"]);
    expect(pickJarLot(tob, "g")).toBeNull();
    // and the shared session picker falls through to the cellar lot.
    expect(pickSessionLot(tob, "g")!.id).toBe("C");
  });

  it("still prefers a usable jar over a cellar lot", () => {
    const tob = { id: 1, lots: [
      { id: "J", status: "jar", weightG: "12", dateOpened: "2025-01-01" },
      { id: "C", status: "cellar", weightG: "50", datePurchased: "2024-01-01" },
    ] };
    expect(pickSessionLot(tob, "g")!.id).toBe("J");
  });

  it("picks an UNWEIGHED jar — the rule holds through the picker", () => {
    const tob = { id: 1, lots: [{ id: "J", status: "jar", weightG: "", dateOpened: "2025-01-01" }] };
    expect(pickSessionLot(tob, "g")!.id).toBe("J");
  });

  it("takes the OLDEST usable cellar lot when no jar is open", () => {
    const tob = { id: 1, lots: [
      { id: "C2", status: "cellar", weightG: "50", datePurchased: "2025-06-01" },
      { id: "C1", status: "cellar", weightG: "50", datePurchased: "2023-01-01" },
      { id: "C0", status: "cellar", weightG: "0", datePurchased: "2020-01-01" },
    ] };
    expect(pickSessionLot(tob, "g")!.id).toBe("C1");
  });

  it("returns null when nothing is usable", () => {
    const tob = { id: 1, lots: [{ id: "F", status: "finished", weightG: "0" }] };
    expect(pickSessionLot(tob, "g")).toBeNull();
  });

  it("both entry points call the SHARED picker, not a fourth copy", () => {
    // An earlier release had already had to fix the same `.filter()` in both files,
    // which is the argument for extracting it.
    for (const f of ["src/views/curator/SessionFormView.tsx", "src/views/curator/TastingView.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("pickSessionLot(tob, weightUnit)");
      // the inlined cellar fallback must be gone from both
      expect(src.replace(/\/\/[^\n]*/g, ""), f).not.toContain('l.status === "cellar" && isUsableLot(l)');
    }
  });
});

describe("an absent weight reads the same everywhere", () => {
  it("renders an unweighed lot as an em dash, not as 0", () => {
    expect(fmtLotWeight("", "fr", "g")).toBe("—");
    expect(fmtLotWeight(undefined, "fr", "g")).toBe("—");
    expect(fmtLotWeight(null, "fr", "g")).toBe("—");
  });

  it("keeps 0 distinguishable from unweighed — the whole point of the rule", () => {
    expect(fmtLotWeight("0", "fr", "g")).toBe("0g");
  });

  it("the picker label no longer leaves a hole where the weight goes", () => {
    const label = lotPickerLabel({ id: "J", status: "jar", weightG: "" }, { weightUnit: "g" });
    expect(label).not.toMatch(/·\s+g/);
    expect(label).toContain("—");
  });

  it("the fiche's lot row and its detail modal both use the shared formatter", () => {
    const src = readFileSync("src/views/curator/InventoryDetailView.tsx", "utf8");
    expect(src).toContain("fmtLotWeight(lot.weightG, lang, weightUnit)");
    // the two old spellings — `|| "0"` on the row, a ternary in the modal
    expect(src).not.toContain('fmtNum(lot.weightG || "0", lang)');
    expect(src).not.toContain('lot.weightG ? `${fmtNum(lot.weightG, lang)}${weightUnit}` : "—"');
  });
});

describe("the auto-end tells the truth and stays put", () => {
  const hook = readFileSync("src/hooks/useTastingSession.ts", "utf8");
  const store = readFileSync("src/hooks/useSessionStore.ts", "utf8");

  it("does not navigate away from whatever the user is doing", () => {
    // It fires from a timer, possibly over an open form — and a direct nav()
    // bypasses the unsaved-changes guard, which only goBack consults.
    expect(hook).toContain("addSessionFromTasting(form, { navigate: !auto })");
    expect(store).toContain("if (!opts || opts.navigate !== false) nav(\"journal\")");
  });

  it("does not announce success when the session was NOT saved", () => {
    // The auto path clears the tasting state either way, so a failed save used
    // to vanish under « clôturée automatiquement après N min ».
    expect(hook).toContain("auto && !ok && setSaveError");
    expect(hook).toContain("tasting_err_autoend_failed");
    // …and that message must resolve in every language.
    for (const code of LANGUAGES.map((l) => l.code)) {
      const s = translate(code, "tasting_err_autoend_failed");
      expect(s, code).not.toBe("tasting_err_autoend_failed");
      expect(String(s).length, code).toBeGreaterThan(20);
    }
  });
});

describe("ignite requires a resolvable, usable lot", () => {
  const src = readFileSync("src/views/curator/TastingView.tsx", "utf8");

  it("gates the CTA on a selected lot when accounting is on", () => {
    expect(src).toContain("(tastingWeight > 0 && !!selectedLot)");
  });

  it("resolves the selection against the USABLE lots, not every lot", () => {
    // findById over `selTob.lots` also returns a finished or trashed lot.
    expect(src).toContain("selUsableLots.find((l: any) => String(l.id) === String(tasting.lotId))");
  });

  it("shows an empty option when the value matches nothing", () => {
    // A <select> whose value is unknown displays its FIRST option, so the
    // screen showed one lot while the state held another.
    expect(src).toContain('!selUsableLots.some((l: any) => String(l.id) === String(tasting.lotId))');
  });

  it("reports a failed cellar-open instead of doing nothing (parity)", () => {
    expect(src).toContain("tasting_open_err");
    for (const code of LANGUAGES.map((l) => l.code)) {
      expect(translate(code, "tasting_open_err"), code).not.toBe("tasting_open_err");
    }
  });

  it("keeps the current tobacco listed even once it stops being usable", () => {
    expect(src).toContain("String(tb.id) === String(tasting.tobaccoId)");
  });
});

describe("tobaccoHasUsableLot is live in production", () => {
  it("is called by both session entry points, not re-inlined", () => {
    // It was exported, unit-tested and DEAD — the shape, invisible
    // to knip because its own test counts as a consumer.
    for (const f of ["src/views/curator/SessionFormView.tsx", "src/views/curator/TastingView.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toContain("tobaccoHasUsableLot(tb)");
    }
  });
});
