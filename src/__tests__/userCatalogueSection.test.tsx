// The Settings section that loads a user's catalogue.
//
// Verified END TO END in a real browser first (real file picker → parse →
// IndexedDB → panel): "3 blends · 3 marques", the load date, the file name and
// all three warning lines. What that run cannot do is fail in CI, so this file
// locks the decisions that rendering surfaced.
//
// It also records a defect the browser found and no assertion would have: the
// section first sat BELOW « Effacer toutes les données », so the destructive
// action was no longer the last thing on the tab. CLAUDE.md's own note on
// the catalogue-apply trigger is about exactly that placement, one control over.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages.ts";
import { translate, ensureLang } from "../i18n.ts";

const SETTINGS = readFileSync("src/views/curator/SettingsModal.tsx", "utf8");
const HOOK = readFileSync("src/hooks/useUserCatalogue.ts", "utf8");
// Length-preserving comment blanking — three earlier releases each shipped a check
// satisfied by the comment explaining the fix.
const code = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
const SET_CODE = code(SETTINGS);
const HOOK_CODE = code(HOOK);

describe("placement in the Données tab", () => {
  it("the destructive reset stays the LAST thing in Données", () => {
    // Measured in a browser: the section first rendered under
    // « Effacer toutes les données », which pushed a whole-cellar destructive
    // action into the middle of the tab.
    const cat = SET_CODE.indexOf('t("sec_catalogue")');
    const reset = SET_CODE.indexOf('t("btn_reset_all_data")');
    expect(cat, "the catalogue section exists").toBeGreaterThan(-1);
    expect(reset, "the reset button exists").toBeGreaterThan(-1);
    expect(cat, "the catalogue section must come BEFORE the reset").toBeLessThan(reset);
  });

  it("lives in the Données tab", () => {
    const i = SET_CODE.indexOf('t("sec_catalogue")');
    const guard = SET_CODE.lastIndexOf('activeTab === "data"', i);
    expect(guard, "no data-tab guard above the section").toBeGreaterThan(-1);
    expect(i - guard, "the guard should be the section's own").toBeLessThan(600);
  });
});

describe("the hook's two load-bearing behaviours", () => {
  it("INVALIDATES the tobaccoDb cache after a load and after a clear", () => {
    // Without this the app keeps answering from the previous catalogue — or
    // the bundled fallback — until a reload, and the user concludes the
    // import did not work.
    expect(HOOK_CODE).toContain("tobaccoDbInvalidate");
    const load = HOOK_CODE.slice(HOOK_CODE.indexOf("function loadCatalogueFile"), HOOK_CODE.indexOf("function clearCatalogue"));
    const clear = HOOK_CODE.slice(HOOK_CODE.indexOf("function clearCatalogue"), HOOK_CODE.indexOf("function downloadCatalogueTemplate"));
    expect(load, "load path").toContain("tobaccoDbInvalidate()");
    expect(clear, "clear path").toContain("tobaccoDbInvalidate()");
  });

  it("invalidates only when the write SUCCEEDED", () => {
    // Dropping the cache after a refused write would send the app back to the
    // bundled catalogue while the user's own is still stored.
    const clear = HOOK_CODE.slice(HOOK_CODE.indexOf("function clearCatalogue"), HOOK_CODE.indexOf("function downloadCatalogueTemplate"));
    const okBranch = clear.indexOf("if (ok)");
    const inv = clear.indexOf("tobaccoDbInvalidate()");
    expect(okBranch).toBeGreaterThan(-1);
    expect(inv).toBeGreaterThan(okBranch);
  });

  it("owns the clock, so the store stays pure", () => {
    // `catalogueSave(csv, name, nowMs)` — the applyCataloguePlan convention.
    expect(HOOK_CODE).toMatch(/catalogueSave\([\s\S]{0,80}Date\.now\(\)\)/);
  });

  it("re-reads the meta on demand — the mount read is not enough", () => {
    // `catalogueLoad` rewrites the meta when it re-parses after a parser
    // version change, and that happens inside tobaccoDb, which the hook
    // cannot see.
    expect(HOOK_CODE).toContain("function refreshCatalogueMeta");
    expect(SET_CODE, "and the panel asks for it when it mounts").toContain("refreshCatalogueMeta()");
  });

  it("reuses dlFile instead of growing a second download path", () => {
    // useExportImport's dlFile handles the iOS share sheet and reports whether
    // The file reached the user.
    expect(HOOK_CODE).toContain("dlFile");
    expect(HOOK_CODE).not.toMatch(/createElement\("a"\)/);
  });

  it("prefixes a BOM on both downloads, or a spreadsheet mojibakes the accents", () => {
    const tpl = HOOK_CODE.slice(HOOK_CODE.indexOf("function downloadCatalogueTemplate"));
    expect(tpl).toMatch(/dlFile\("\\uFEFF"|dlFile\("\uFEFF"/);
    const exp = HOOK_CODE.slice(HOOK_CODE.indexOf("function exportCatalogueCsv"));
    expect(exp).toMatch(/dlFile\("\\uFEFF"|dlFile\("\uFEFF"/);
  });
});

describe("CatalogueStatus tells the three states apart", () => {
  it("says NOTHING while the first read is in flight", () => {
    // `undefined` = reading, `null` = none. Collapsing them flashes
    // "no catalogue loaded" on every open of the screen where the user
    // manages their data.
    const fn = SET_CODE.slice(SET_CODE.indexOf("function CatalogueStatus"));
    expect(fn).toContain("if (meta === undefined) return null;");
  });

  it("surfaces every count the parser reports", () => {
    // A catalogue that silently dropped a third of its rows looks exactly
    // like one that loaded fine.
    const fn = SET_CODE.slice(SET_CODE.indexOf("function CatalogueStatus"));
    for (const k of ["skippedNoIdentity", "duplicateKeys", "unknownCategories", "unknownCuts"]) {
      expect(fn, k).toContain(k);
    }
  });

  it("renders the export and remove actions ONLY when one is loaded", () => {
    expect(SET_CODE).toMatch(/\{catalogueMeta && \([\s\S]{0,300}btn_cat_export/);
    expect(SET_CODE).toMatch(/\{catalogueMeta && \([\s\S]{0,400}btn_cat_remove/);
  });

  it("confirms before removing", () => {
    const i = SET_CODE.indexOf('t("btn_cat_remove")');
    expect(SET_CODE.slice(i, i + 500)).toContain("window.confirm");
  });
});

describe("every new string resolves in every language", () => {
  const KEYS = [
    "sec_catalogue", "cat_none_hint", "btn_cat_template", "btn_cat_load",
    "btn_cat_export", "btn_cat_remove", "cat_loaded_n", "cat_loaded_on",
    "cat_err_parse", "cat_err_write", "cat_err_read",
    "cat_warn_skipped", "cat_warn_dupes", "cat_warn_unknown",
    "cat_confirm_remove",
  ];

  it("resolves, and is not the raw key", async () => {
    for (const { code: lang } of LANGUAGES) {
      await ensureLang(lang);
      for (const k of KEYS) {
        const s = translate(lang, k);
        expect(s, `${lang}.${k}`).not.toBe(k);
        expect(String(s).length, `${lang}.${k}`).toBeGreaterThan(2);
      }
    }
  });

  it("keeps every interpolation placeholder in every language", async () => {
    // A dropped `{n}` renders a sentence with a hole where the number was.
    const need: Record<string, string[]> = {
      cat_loaded_n: ["{n}", "{b}"],
      cat_loaded_on: ["{d}"],
      cat_warn_skipped: ["{n}"],
      cat_warn_dupes: ["{n}"],
      cat_warn_unknown: ["{v}"],
    };
    for (const { code: lang } of LANGUAGES) {
      await ensureLang(lang);
      for (const k of Object.keys(need)) {
        for (const ph of need[k]!) {
          expect(translate(lang, k), `${lang}.${k} missing ${ph}`).toContain(ph);
        }
      }
    }
  });
});

describe("the template is reachable and is a valid catalogue", () => {
  it("the button calls the generator", () => {
    expect(SET_CODE).toMatch(/onClick=\{downloadCatalogueTemplate\}/);
  });

  it("and the generator's output parses", async () => {
    const { buildCatalogueTemplateCsv } = await import("../utils/userCatalogue.ts");
    const { parseCatalogueCsv } = await import("../utils/userCatalogue.ts");
    const r = parseCatalogueCsv(buildCatalogueTemplateCsv());
    expect(r.error).toBeNull();
    expect(r.blends).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The catalogue cloud actions answer UNDER their own buttons.
//
// An earlier release wrote their status to the shared `gdriveStatus`, whose Notice is
// pinned under the CELLAR save button in the Section ABOVE — so the answer
// appeared several rows up the scroll, off screen on a phone. Reported from
// the app with a screenshot. It repeats the « check cloud backups » defect
// verbatim, one release after that entry was written; and the comment at the call site NAMED the conflict and
// shipped anyway.
describe("catalogue cloud status", () => {
  const HOOKG = code(readFileSync("src/hooks/useGdriveSync.ts", "utf8"));
  const bodies = (() => {
    const a = HOOKG.indexOf("function catalogueCloudSave");
    const b = HOOKG.indexOf("function catalogueCloudRestore");
    const end = HOOKG.indexOf("\n  return {", b);
    return HOOKG.slice(a, end);
  })();

  it("neither catalogue cloud function writes to the shared gdriveStatus", () => {
    expect(bodies.length, "found both function bodies").toBeGreaterThan(500);
    expect(bodies, "the shared channel renders in ANOTHER Section").not.toContain("setGdriveStatus(");
  });

  it("they write to catalogueCloudStatus instead", () => {
    expect(bodies).toContain("setCatCloudStatus(");
    expect(HOOKG, "and it is exposed on the hook").toContain("catalogueCloudStatus,");
  });

  it("Settings renders that status AFTER both buttons, inside the catalogue section", () => {
    const save = SET_CODE.indexOf('t("cat_cloud_save")');
    const fetchB = SET_CODE.indexOf('t("cat_cloud_restore")');
    const notice = SET_CODE.indexOf("catalogueCloudStatus &&");
    const reset = SET_CODE.indexOf('t("btn_reset_all_data")');
    expect(save, "save button").toBeGreaterThan(-1);
    expect(fetchB, "fetch button").toBeGreaterThan(-1);
    expect(notice, "the status Notice").toBeGreaterThan(-1);
    expect(notice, "must come after the save button").toBeGreaterThan(save);
    expect(notice, "must come after the fetch button").toBeGreaterThan(fetchB);
    expect(notice, "and must stay inside the catalogue section").toBeLessThan(reset);
  });
});

// ── OPACITY ON TEXT PUSHED THE STATUS LINE UNDER AA ───────────────────────
//
// « Chargé le … · fichier.csv » carried `opacity: 0.85`. Inside a
// `Notice tone="success"` the text is light-mode sage, which measures 4.61:1
// on the light page ground at full strength — comfortably AA — and 3.53:1
// once the 0.85 composites. Reported by `theme:contrast` in all THREE light
// palettes (brass / steel / english); it was the only live warning of the 69,
// the other 66 being disabled controls, which WCAG 1.4.3 exempts.
//
// CLAUDE.md already settled this rule for the inventory card badges:
// **never use `opacity` to de-emphasise TEXT — reach for a dimmer token, so
// the ratio stays measurable.** It also records why the checker could see it
// at all: the "deliberately dimmed" exemption was narrowed so reduced opacity
// ALONE no longer claims it. The mechanism worked; this is newer code that
// walked into the rule.
//
// Nothing is lost by removing it: the line above is `fontWeight: 700`, so the
// hierarchy is carried by WEIGHT, which costs no contrast.
describe("the catalogue status line is readable in light mode", () => {
  it("de-emphasises by WEIGHT, never by opacity", () => {
    // Scoped to the CatalogueStatus block so an unrelated opacity elsewhere in
    // this large file cannot fail it — and so the assertion names the element
    // the checker flagged.
    // Anchored on the block, not on the first key: `fontWeight: 700` opens the
    // span ABOVE `cat_loaded_n`, so a forward-only window misses it — which is
    // what the first version of this case did.
    const at = SET_CODE.indexOf('cat_loaded_n');
    expect(at, "the catalogue status block moved — re-point this check")
      .toBeGreaterThan(0);
    const block = SET_CODE.slice(Math.max(0, at - 300), at + 900);
    expect(block, "opacity on text: it composites below AA in light mode")
      .not.toMatch(/opacity:\s*0?\.\d/);
    // Non-vacuity + the half that must survive: the bold first line IS the
    // hierarchy, so removing the opacity must not have removed that too.
    expect(block).toMatch(/fontWeight:\s*700/);
  });
});
