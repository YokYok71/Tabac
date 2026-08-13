// A forged `imageUrl` could beacon out of the form preview.
//
// `migrateData` has blanked external image refs made the app
// local-photos-only, but it anchored on `^https?://` — which is the losing
// side of the question. TWO shapes walked straight past that anchor:
//
//   //evil.com/beacon.png          protocol-relative; resolves against https
//   data:image/svg+xml;base64,…    not in the allowed mime list
//
// All 38 background sites route through `safeBgUrl`, which correctly returns
// "" for both. The form's photo PREVIEW does not — it is the one bare
// `<img src>` in the app, fed by `imgLocal?.[form.imageUrl] || form.imageUrl`,
// so a lookup miss puts the raw string in `src`. Opening the edit form of an
// imported item therefore fired a request to the attacker's host: IP,
// User-Agent, and confirmation that the file was imported. A tracking beacon
// inside a shared backup, contradicting `public/privacy.html` verbatim.
//
// Reachable via JSON import (BOTH replace and merge — `migrateData` runs on
// the merge result too) and via cloud restore. NOT via CSV: `parseTobaccoCsv`
// forces `imageUrl: ""`.
//
// The fix is an ALLOWLIST at both ends sharing one predicate — the source so
// nothing poisoned is stored, and the sink so a value arriving any other way
// still cannot beacon.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { migrateData } from "../utils.ts";
import { isLocalPhotoRef, safeImgSrc, safeBgUrl } from "../utils/imgCache.ts";

const LEGIT_KEY = "local-photo-1706000000000-ab12cd34";
// The quota fallback: the blob could not be written to IndexedDB,
// so the data URI is carried inline in `imageUrl`. It MUST keep working.
const LEGIT_DATA = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

const FORGED = [
  "//evil.com/beacon.png",
  "https://evil.com/beacon.png",
  "http://evil.com/beacon.png",
  "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
  "data:text/html,<script>1</script>",
  "javascript:alert(1)",
  "\\\\evil.com\\x.png",
  " //evil.com/x.png",
];

describe("isLocalPhotoRef is an allowlist", () => {
  it("accepts the two legitimate shapes", () => {
    expect(isLocalPhotoRef(LEGIT_KEY)).toBe(true);
    expect(isLocalPhotoRef(LEGIT_DATA)).toBe(true);
    for (const m of ["jpeg", "jpg", "png", "webp", "gif"]) {
      expect(isLocalPhotoRef(`data:image/${m};base64,AA`), m).toBe(true);
    }
  });

  it("refuses everything else, including the two the old anchor missed", () => {
    for (const v of FORGED) expect(isLocalPhotoRef(v), v).toBe(false);
    expect(isLocalPhotoRef("")).toBe(false);
    expect(isLocalPhotoRef(null)).toBe(false);
    expect(isLocalPhotoRef(undefined)).toBe(false);
    expect(isLocalPhotoRef(42)).toBe(false);
    expect(isLocalPhotoRef({})).toBe(false);
  });
});

describe("migrateData blanks a forged imageUrl", () => {
  const rows = (imageUrl: string) => ({
    tobaccos: [{ id: 1, brand: "B", name: "N", imageUrl, lots: [] }],
    pipes: [{ id: 1, brand: "B", name: "N", imageUrl }],
    accessories: [{ id: 1, brand: "B", name: "N", imageUrl }],
    wishlist: [{ id: 1, brand: "B", name: "N", imageUrl }],
    sessions: [{ id: 1, date: "2026-01-01", tobaccoId: 1, pipeId: 1,
      tobaccoSnapshot: { brand: "B", name: "N", imageUrl },
      pipeSnapshot: { brand: "B", name: "N", imageUrl } }],
    nxT: 2, nxP: 2, nxA: 2, nxW: 2, nxJ: 2,
  });

  const every = (d: any) => [
    d.tobaccos[0].imageUrl, d.pipes[0].imageUrl, d.accessories[0].imageUrl,
    d.wishlist[0].imageUrl,
    d.sessions[0].tobaccoSnapshot.imageUrl, d.sessions[0].pipeSnapshot.imageUrl,
  ];

  for (const v of FORGED) {
    it(`blanks ${JSON.stringify(v)} on every entity and both snapshots`, () => {
      const out: any = migrateData(rows(v));
      expect(every(out)).toEqual(["", "", "", "", "", ""]);
    });
  }

  it("leaves both legitimate shapes alone", () => {
    expect(every(migrateData(rows(LEGIT_KEY)) as any))
      .toEqual(Array(6).fill(LEGIT_KEY));
    expect(every(migrateData(rows(LEGIT_DATA)) as any),
      "the quota fallback stores a data URI in imageUrl")
      .toEqual(Array(6).fill(LEGIT_DATA));
  });
});

describe("the <img> sink refuses a forged src", () => {
  it("safeImgSrc returns '' for everything migrateData would blank", () => {
    for (const v of FORGED) expect(safeImgSrc(v), v).toBe("");
  });

  it("and passes the two legitimate shapes", () => {
    expect(safeImgSrc(LEGIT_KEY)).toBe(LEGIT_KEY);
    expect(safeImgSrc(LEGIT_DATA)).toBe(LEGIT_DATA);
  });

  it("is wired into the form's photo preview — the one bare <img> in the app", () => {
    // Source-level, because the value that reaches it is a prop from four
    // different form views and the point is that NO caller can bypass it.
    const src = readFileSync("src/components/curator/FormFields.tsx", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "));
    expect(code, "a bare <img src={preview}> is the beacon")
      .not.toMatch(/<img\s+src=\{preview\}/);
    expect(code).toMatch(/<img\s+src=\{safeImgSrc\(preview\)\}/);
  });

  it("safeBgUrl already refused both, which is why only this sink was reachable", () => {
    expect(safeBgUrl("//evil.com/x.png")).toBe("");
    expect(safeBgUrl("data:image/svg+xml;base64,AA")).toBe("");
    expect(safeBgUrl(LEGIT_DATA)).toContain("url(");
  });
});

// ────────────────────────────────────────────────────────────────────────
// The "an imported API key replaced yours" notice could never be seen.
//
// An earlier release wrote it into `importRecap` — plain React state with an 8 s
// auto-dismiss — and ~85 lines later the same function reloads the page when
// `settingsApplied > 0`, in a microtask. The two conditions COINCIDE BY
// CONSTRUCTION: `settingsApplied` is non-zero only on a REPLACE, which is the
// same branch that writes the key, and `collectSettings()` returns a
// non-empty block on essentially every device (`cave-lang` is seeded pre-mount
// on first launch), so every backup on carries one.
//
// That left the replace-only rule as the ONLY live protection on an
// imported key — and the consequence is a billing relationship with whoever
// wrote the file, plus tin photos going to their provider account via
// « Scanner la boîte ».
describe("the imported-API-key notice survives the reload", () => {
  it("the marker is written before the reload, and read once at mount", () => {
    const hook = readFileSync("src/hooks/useImportConfirm.ts", "utf8");
    const app = readFileSync("src/App.tsx", "utf8");
    // ORDER is the whole point: a marker written after `location.reload()`
    // would never be written at all.
    const set = hook.indexOf("lsSet(APIKEY_REPLACED_KEY");
    const reload = hook.indexOf("window.location.reload()");
    expect(set, "the marker write is missing").toBeGreaterThan(-1);
    expect(reload, "the reload anchor moved — re-read this test").toBeGreaterThan(-1);
    expect(set, "the marker must be written BEFORE the reload").toBeLessThan(reload);
    // and consumed exactly once, cleared immediately (the cave-lang-auto shape)
    expect(app).toMatch(/lsGet\(APIKEY_REPLACED_KEY\)/);
    expect(app).toMatch(/lsRemove\(APIKEY_REPLACED_KEY\)/);
    expect(app).toMatch(/setImportRecap\(\{ msg: t\("import_apikey_replaced"\) \}\)/);
  });

  it("the key it announces exists in every language", async () => {
    const { LANGUAGES } = await import("../i18n/languages.ts");
    const { translate, ensureLang } = await import("../i18n.ts");
    for (const { code } of LANGUAGES) {
      await ensureLang(code);
      const s = translate(code, "import_apikey_replaced");
      expect(s, code).not.toBe("import_apikey_replaced");
      expect(String(s).length, code).toBeGreaterThan(10);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// The cloud-newer banner said "sync" and did a REPLACE.
//
// `restoreCloudNewerBackup` is the app's only `autoApply: "replace"` call
// site: it skips the Replace/Merge picker, shows no diff, and offers no undo.
// The banner's own text told the user the opposite — « Restaurez-la pour
// synchroniser cet appareil » / "Restore it to sync this device" — and "sync"
// is the MERGE word.
//
// It matters most for the exact user it appears to: `findNewerCloudBackup`
// compares the cloud file against THIS DEVICE'S LAST CLOUD SAVE, not its last
// local edit, so the banner surfaces precisely when there is unsynced local
// work to lose.
//
// Only the wording is changed here. Whether the action deserves a confirm
// reverses a decision recorded in `useImportConfirm` ("no useful choice"), and
// that is the user's call, not a fresh reading's.
describe("the cloud-newer banner says what it does", () => {
  it("names the replacement, and never calls it a sync, in any language", async () => {
    const { LANGUAGES } = await import("../i18n/languages.ts");
    const { translate, ensureLang } = await import("../i18n.ts");
    // Each language's own word for what actually happens. A banner that used
    // Its neighbour's vocabulary would be the defect again.
    const REPLACES: Record<string, RegExp> = {
      fr: /remplace/i, en: /replaces?/i, es: /sustituye/i,
      de: /ersetzt/i, it: /sostituisce/i, pt: /substitui/i,
    };
    const SYNC = /synchronis|sincroniz|synchronisier|sync\b/i;
    for (const { code } of LANGUAGES) {
      await ensureLang(code);
      const s = String(translate(code, "cloud_newer_banner"));
      expect(s, code).toContain("{date}");
      expect(REPLACES[code], `no expectation written for ${code}`).toBeTruthy();
      expect(s, `${code} must name the replacement`).toMatch(REPLACES[code]!);
      expect(s, `${code} still calls a replace a sync`).not.toMatch(SYNC);
    }
  });

  // ── REVERSED, on the user's decision ─────────────────────
  // This asserted "exactly ONE autoApply:\"replace\" call site", on the
  // reasoning that the wording is only honest while the action stays
  // the one it describes. The action changed instead: the banner now routes
  // through the Replace/Merge PICKER, so there is NO auto-replace caller left
  // in production and the honest wording still stands (the picker's own
  // Replace option does exactly what the banner says).
  it("and no caller auto-applies a replace any more", () => {
    const strip = (f: string) => readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const f of ["src/hooks/useGdriveSync.ts", "src/hooks/useExportImport.ts",
                     "src/hooks/useImportConfirm.ts"]) {
      expect((strip(f).match(/autoApply:\s*"replace"/g) || []).length,
        `${f} auto-applies a replace`).toBe(0);
    }
    // The option itself stays — `useImportConfirm` still READS it, and
    // `"merge"` has a live caller (the CSV import) sharing the same code path.
    expect(readFileSync("src/hooks/useImportConfirm.ts", "utf8"))
      .toMatch(/autoApply === "replace"|autoApply\b/);
  });
});
