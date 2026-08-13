// The catalogue is its own cloud stream, and every cellar
// mechanism must IGNORE it.
//
// WHY A SEPARATE STREAM. A user catalogue measured 3.77 MB, and the cellar
// backup is written on every change (the auto-save debounces 1.2 s after any
// edit) while the catalogue changes only when the user loads one. Embedding it
// would make logging a single session upload 3.77 MB of data that did not
// move; separating them pays that once per catalogue load.
//
// WHY THIS FILE IS THE RISKY PART. `classifyBackup` returned "manual" for
// ANYTHING not starting with the auto prefix, and manual backups ROTATE over
// GDRIVE_MAX_MANUAL. So a catalogue file would have been deleted from the
// cloud by the user's own cellar saves — silently, after three. The
// multi-device guard had no type filter at all, so it would have offered a CSV
// as a cellar backup to restore, on a banner whose button stages an import of
// the whole cellar.
//
// This is the area three separate releases were each spent on: auto-save
// deleting other devices' files, the 14-auto-file pile, the Dropbox 429s. Every
// exclusion below is asserted rather than assumed.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifyBackup, pruneByType, ownAutoFiles, pickKeepAuto,
  findNewerCloudBackup, explainCloudBackups, summariseCloudDevices,
} from "../utils/gdriveApi.ts";
import { GDRIVE_CATALOGUE_PREFIX, GDRIVE_AUTO_PREFIX, GDRIVE_FILE_PREFIX } from "../constants.ts";

const CAT = GDRIVE_CATALOGUE_PREFIX + "8udtad73xz-20260811-120000.csv";
const AUTO = GDRIVE_AUTO_PREFIX + "8udtad73xz-20260811-120000-t1-p1-w0-a0-j0.json";
const MANUAL = GDRIVE_FILE_PREFIX + "20260811-120000-t1-p1-w0-a0-j0.json";

describe("classification", () => {
  it("recognises the three streams", () => {
    expect(classifyBackup(CAT)).toBe("catalogue");
    expect(classifyBackup(AUTO)).toBe("auto");
    expect(classifyBackup(MANUAL)).toBe("manual");
  });

  it("the catalogue test comes FIRST, so it cannot fall through to manual", () => {
    // The default is "manual"; a prefix reaching it would be rotated away.
    const src = readFileSync("src/utils/gdriveApi.ts", "utf8");
    const fn = src.slice(src.indexOf("export function classifyBackup"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body.indexOf("GDRIVE_CATALOGUE_PREFIX"))
      .toBeLessThan(body.indexOf("GDRIVE_AUTO_PREFIX"));
    expect(body.indexOf("GDRIVE_CATALOGUE_PREFIX")).toBeLessThan(body.lastIndexOf('return "manual"'));
  });

  it("an empty or odd name is still manual, unchanged", () => {
    expect(classifyBackup("")).toBe("manual");
    expect(classifyBackup("something-else.json")).toBe("manual");
  });

  it("a device NAMED like the prefix cannot flip the classification", () => {
    // makeBackupName appends the device-name slug at the TAIL for exactly this
    // reason. Asserted here for the new prefix too.
    const sneaky = GDRIVE_FILE_PREFIX + "20260811-120000-t1-p0-w0-a0-j0-cavetabaccatalogue.json";
    expect(classifyBackup(sneaky)).toBe("manual");
  });
});

describe("the MANUAL rotation must never touch it", () => {
  it("pruneByType('manual') leaves catalogue files alone", async () => {
    // The defect this file exists for: three cellar saves would otherwise have
    // deleted the user's catalogue.
    const removed: string[] = [];
    const remove = vi.fn(async (_t: string, id: string) => { removed.push(id); });
    const files = [
      { id: "c1", name: CAT, createdTime: "2026-08-11T12:00:00Z" },
      { id: "m1", name: MANUAL, createdTime: "2026-08-11T11:00:00Z" },
      { id: "m2", name: GDRIVE_FILE_PREFIX + "20260810-120000-t1-p0-w0-a0-j0.json", createdTime: "2026-08-10T12:00:00Z" },
      { id: "m3", name: GDRIVE_FILE_PREFIX + "20260809-120000-t1-p0-w0-a0-j0.json", createdTime: "2026-08-09T12:00:00Z" },
    ];
    await pruneByType(files, "manual", 2, "tok", remove);
    expect(removed).toEqual(["m3"]);
    expect(removed, "the catalogue must survive every rotation").not.toContain("c1");
  });

  it("…even when it is the OLDEST file in the account", async () => {
    const removed: string[] = [];
    const remove = vi.fn(async (_t: string, id: string) => { removed.push(id); });
    const files = [
      { id: "c1", name: CAT, createdTime: "2020-01-01T00:00:00Z" },
      { id: "m1", name: MANUAL, createdTime: "2026-08-11T11:00:00Z" },
    ];
    await pruneByType(files, "manual", 0, "tok", remove);
    expect(removed).toEqual(["m1"]);
  });
});

describe("the AUTO sweep must never touch it", () => {
  it("ownAutoFiles / pickKeepAuto never see a catalogue file", () => {
    // Both take a list already filtered to classifyBackup === "auto". The
    // filter is what protects them, so assert the filter's verdict.
    const all = [{ id: "c1", name: CAT }, { id: "a1", name: AUTO }];
    const autos = all.filter((f) => classifyBackup(f.name) === "auto");
    expect(autos.map((f) => f.id)).toEqual(["a1"]);
    expect(ownAutoFiles(autos, "8udtad73xz").map((f) => f.id)).toEqual(["a1"]);
    expect(pickKeepAuto(autos, "8udtad73xz")).toBe("a1");
  });

  it("pruneByType('auto') leaves it alone too", async () => {
    const removed: string[] = [];
    await pruneByType(
      [{ id: "c1", name: CAT, createdTime: "2020-01-01T00:00:00Z" }],
      "auto", 0, "tok", async (_t: string, id: string) => { removed.push(id); },
    );
    expect(removed).toEqual([]);
  });
});

describe("the multi-device guard must never OFFER it", () => {
  const newer = "2026-08-11T12:00:00Z";

  it("a catalogue file is not a 'newer cloud backup'", () => {
    // Its « Restaurer » stages an import of the whole cellar. `stageImport`
    // would refuse a CSV — so without this exclusion the user
    // gets a banner that cannot do what it says.
    const hit = findNewerCloudBackup(
      [{ id: "c1", name: CAT, modifiedTime: newer }],
      0, 0, 0, null, null, 0,
    );
    expect(hit).toBeNull();
  });

  it("…while a genuine foreign backup in the same listing still IS", () => {
    // Non-vacuity: the exclusion must be about the KIND, not about the guard
    // having stopped working.
    const hit = findNewerCloudBackup(
      [
        { id: "c1", name: CAT, modifiedTime: newer },
        { id: "m1", name: MANUAL, modifiedTime: newer },
      ],
      0, 0, 0, null, null, 0,
    );
    expect(hit && hit.id).toBe("m1");
  });

  it("the DIAGNOSTIC mirrors the exclusion instead of inventing a reason", () => {
    // The whole value of explainCloudBackups is that it reproduces the guard's
    // ladder exactly; a missing rung would explain a decision never made.
    const rows = explainCloudBackups(
      [{ id: "c1", name: CAT, modifiedTime: newer }],
      0, 0, 0, null, null, 0,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ignored");
    expect(rows[0]!.reason).toBe("catalogue");
    expect(rows[0]!.kind).toBe("catalogue");
  });

  it("summariseCloudDevices tolerates the new kind", () => {
    const rows = explainCloudBackups(
      [{ id: "c1", name: CAT, modifiedTime: newer }, { id: "a1", name: AUTO, modifiedTime: newer }],
      0, 0, 0, null, null, 0,
    );
    const sum = summariseCloudDevices(rows, "8udtad73xz");
    expect(Array.isArray(sum)).toBe(true);
    expect(sum.length).toBeGreaterThan(0);
  });
});

describe("the restore PICKER must never list it", () => {
  it("filters catalogue files out before building the options", () => {
    // Source-level: the picker lives inside a promise chain in useGdriveSync
    // that a unit test cannot reach without mocking the whole provider.
    const src = readFileSync("src/hooks/useGdriveSync.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(src).toMatch(/cellarFiles\s*=\s*\(\(list\.files[\s\S]{0,200}classifyBackup\(fi\.name\) !== "catalogue"/);
    expect(src, "and the options are built from the FILTERED list")
      .toMatch(/var options = cellarFiles\.map/);
  });

  it("an account holding only catalogue files reports 'no backup'", () => {
    // The filter runs BEFORE the emptiness check, so the user is told there is
    // nothing to restore rather than shown a picker of unusable rows.
    const src = readFileSync("src/hooks/useGdriveSync.ts", "utf8");
    const filter = src.indexOf('classifyBackup(fi.name) !== "catalogue"');
    const empty = src.indexOf('if (!cellarFiles.length)');
    expect(filter).toBeGreaterThan(-1);
    expect(empty).toBeGreaterThan(filter);
  });
});
