/**
 * Tests for `parseBackupCounts` and `classifyBackup`
 * (src/utils/gdriveApi.ts — moved from useGdriveSync.ts,
 * step 1 of the Drive split).
 *
 * Both helpers parse backup filenames written to Google Drive's
 * appDataFolder. They drive the restore picker UI (counts per type,
 * 🔄 / 💾 badging) and the auto vs manual rotation logic. A forged
 * filename could otherwise produce Infinity counts or wrong type
 * tags — covered by the cap and the prefix-anchored regex.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseBackupCounts, classifyBackup } from "../utils/gdriveApi";

describe("parseBackupCounts", () => {
  it("returns null for falsy / non-matching names", () => {
    expect(parseBackupCounts("")).toBe(null);
    expect(parseBackupCounts(null as any)).toBe(null);
    expect(parseBackupCounts(undefined as any)).toBe(null);
    expect(parseBackupCounts("cave-tabac-20250101.json")).toBe(null); // no count suffix
    expect(parseBackupCounts("random.json")).toBe(null);
  });

  it("parses a canonical manual backup name", () => {
    var out = parseBackupCounts("cave-tabac-20250101-120000-t12-p3-w5-a2-j47.json");
    expect(out).toEqual({
      tobaccos: 12, pipes: 3, wishlist: 5, accessories: 2, sessions: 47,
    });
  });

  it("parses a canonical auto backup name", () => {
    var out = parseBackupCounts("cave-tabac-auto-20250101-120000-t12-p3-w5-a2-j47.json");
    expect(out).toEqual({
      tobaccos: 12, pipes: 3, wishlist: 5, accessories: 2, sessions: 47,
    });
  });

  it("accepts zero counts (empty inventory)", () => {
    var out = parseBackupCounts("cave-tabac-20250101-t0-p0-w0-a0-j0.json");
    expect(out).toEqual({
      tobaccos: 0, pipes: 0, wishlist: 0, accessories: 0, sessions: 0,
    });
  });

  it("caps each count at 1,000,000 (forged-name DoS protection)", () => {
    // A name with a 20-digit count would round through Number → Infinity.
    var forged = "cave-tabac-t99999999999999999999-p0-w0-a0-j0.json";
    var out = parseBackupCounts(forged);
    expect(out).not.toBe(null);
    expect(out!.tobaccos).toBe(1_000_000);
    expect(Number.isFinite(out!.tobaccos)).toBe(true);
  });

  it("property: every count is a finite non-negative integer ≤ 1M", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 0, max: 999 }),
          fc.integer({ min: 0, max: 999 }),
          fc.integer({ min: 0, max: 999 }),
          fc.integer({ min: 0, max: 999 }),
          fc.integer({ min: 0, max: 999 }),
        ),
        function (tup) {
          var name = "cave-tabac-t" + tup[0] +
            "-p" + tup[1] + "-w" + tup[2] +
            "-a" + tup[3] + "-j" + tup[4] + ".json";
          var out = parseBackupCounts(name);
          expect(out).not.toBe(null);
          Object.values(out!).forEach(function (n) {
            expect(Number.isFinite(n)).toBe(true);
            expect(n).toBeGreaterThanOrEqual(0);
            expect(n).toBeLessThanOrEqual(1_000_000);
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: never throws on arbitrary string input", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        function (s) {
          expect(() => parseBackupCounts(s)).not.toThrow();
          var out = parseBackupCounts(s);
          if (out !== null) {
            Object.values(out).forEach(function (n) {
              expect(Number.isFinite(n)).toBe(true);
            });
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("classifyBackup", () => {
  it("returns 'manual' for falsy input (defensive default)", () => {
    expect(classifyBackup("")).toBe("manual");
    expect(classifyBackup(null as any)).toBe("manual");
    expect(classifyBackup(undefined as any)).toBe("manual");
  });

  it("classifies auto-prefixed names as 'auto'", () => {
    expect(classifyBackup("cave-tabac-auto-20250101-120000.json")).toBe("auto");
    expect(classifyBackup("cave-tabac-auto-20250101-120000-t1-p0-w0-a0-j0.json"))
      .toBe("auto");
  });

  it("classifies non-auto-prefixed cave-tabac names as 'manual'", () => {
    expect(classifyBackup("cave-tabac-20250101-120000.json")).toBe("manual");
    expect(classifyBackup("cave-tabac-20250101-120000-t1-p0-w0-a0-j0.json"))
      .toBe("manual");
  });

  it("classifies unrelated names as 'manual' (defensive default)", () => {
    expect(classifyBackup("random.json")).toBe("manual");
    expect(classifyBackup("backup.json")).toBe("manual");
  });

  it("property: returns exactly 'auto' or 'manual' on any input", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        function (s) {
          var c = classifyBackup(s);
          expect(c === "auto" || c === "manual").toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
