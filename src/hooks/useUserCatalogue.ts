// The user's own reference catalogue — load it, describe it, remove it.
//
// The app does not ship a catalogue; each user supplies
// their own CSV. `utils/userCatalogue.ts` parses it and `utils/catalogueStore.ts`
// stores it — this hook is the seam between those and the Settings UI.
//
// TWO THINGS IT MUST GET RIGHT, both of which look like plumbing and are not:
//
//   • INVALIDATE the tobaccoDb module cache after any change. That module
//     caches for the whole session, so without it the app keeps answering from
//     the previous catalogue (or the bundled fallback) until a reload — and
//     the user, seeing the old data, concludes the import did not work.
//
//   • REPORT what the import could not read. A catalogue that silently drops a
//     third of its rows looks like a catalogue that loaded fine. The parse
//     result carries the counts; this hook keeps them so the UI can say so.

import React from "react";
import {
  catalogueSave, catalogueClear, catalogueGetMeta, catalogueGetCsv,
  type CatalogueMeta,
} from "../utils/catalogueStore.ts";
import {
  buildCatalogueTemplateCsv, parseCatalogueCsv, MAX_CATALOGUE_ISSUES,
  type CatalogueIssue,
} from "../utils/userCatalogue.ts";
import { tobaccoDbInvalidate } from "../utils/tobaccoDb.ts";

export type CatalogueLoadOutcome =
  | { kind: "ok"; meta: CatalogueMeta }
  | { kind: "parse" }
  | { kind: "write" }
  | { kind: "read" };

/**
 * What « Vérifier mon catalogue » found.
 *
 * Deliberately NARROW, on the user's instruction: the two MANDATORY columns
 * and the two whose values are IMPOSED. Nothing about prose, text length or
 * per-language coverage. Those belonged to a Node checker (deleted with the
 * rest of the catalogue tooling: there is no delivered master to
 * judge any more), which
 * a reviewer runs on a delivery, and they answer a different question from
 * "is my file loadable and fully understood".
 *
 * `rows` and the four counts are EXACT; `issues` is capped (see
 * MAX_CATALOGUE_ISSUES) and `truncated` says so, because a shortened list that
 * does not admit it reads as a complete one.
 */
export interface CatalogueAuditResult {
  rows: number;
  blends: number;
  noIdentity: number;
  duplicates: number;
  badCategory: number;
  badCut: number;
  issues: CatalogueIssue[];
  truncated: boolean;
}

export interface UseUserCatalogue {
  /** What is loaded, or null. Undefined while the first read is in flight. */
  catalogueMeta: CatalogueMeta | null | undefined;
  catalogueBusy: boolean;
  /** Outcome of the LAST load or clear, for the UI to render. Cleared on the
   *  next attempt so a stale error cannot sit under a fresh success. */
  catalogueOutcome: CatalogueLoadOutcome | null;
  loadCatalogueFile: () => void;
  clearCatalogue: () => void;
  downloadCatalogueTemplate: () => void;
  /** Hand the user their own file back. Null when nothing is stored. */
  exportCatalogueCsv: () => void;
  /**
   * Re-read the stored meta.
   *
   * The mount read is not enough: `catalogueLoad` REWRITES the meta when it
   * re-parses after a `CATALOGUE_PARSER_VERSION` change, and that happens
   * inside `tobaccoDb`, which this hook knows nothing about. Without a refresh
   * the Settings panel would go on showing the counts and warnings from before
   * the re-parse until the next app start. Found by rendering the panel over a
   * stale cache, where it read "0 blends · 0 marques" for a catalogue that had
   * just re-parsed to three.
   *
   * Cheap — `catalogueGetMeta` touches neither the CSV nor the parsed cache.
   */
  refreshCatalogueMeta: () => void;
  /** Result of the last audit, or null. */
  catalogueAudit: CatalogueAuditResult | null;
  catalogueAuditBusy: boolean;
  /** Re-read the stored CSV and report its mandatory-field / taxonomy issues. */
  auditCatalogue: () => void;
  clearCatalogueAudit: () => void;
}

export function useUserCatalogue(opts: {
  /** Reused from useExportImport so a download behaves identically (iOS share
   *  sheet included) instead of growing a second anchor-click implementation. */
  dlFile: (text: string, name: string, mime: string) => Promise<boolean> | boolean;
}): UseUserCatalogue {
  var dlFile = opts.dlFile;
  var [meta, setMeta] = React.useState<CatalogueMeta | null | undefined>(undefined);
  var [busy, setBusy] = React.useState(false);
  var [outcome, setOutcome] = React.useState<CatalogueLoadOutcome | null>(null);
  var [audit, setAudit] = React.useState<CatalogueAuditResult | null>(null);
  var [auditBusy, setAuditBusy] = React.useState(false);

  // Mount read. `catalogueGetMeta` never rejects (no IndexedDB → null), so the
  // undefined→null transition always happens and the UI never hangs on
  // "loading".
  React.useEffect(function () {
    var alive = true;
    catalogueGetMeta().then(function (m) { if (alive) setMeta(m); });
    return function () { alive = false; };
  }, []);

  function loadCatalogueFile() {
    if (busy) return;
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      setBusy(true);
      setOutcome(null);
      var reader = new FileReader();
      reader.onload = function () {
        var raw = String(reader.result || "");
        // The clock is INJECTED into the store (it stays pure); this is the
        // one place that owns it.
        catalogueSave(raw, (file && file.name) || "catalogue.csv", Date.now()).then(function (res) {
          if (res.ok && res.meta) {
            // Before the state update: the next lookup must not be served from
            // the cache this replaces.
            tobaccoDbInvalidate();
            setMeta(res.meta);
            // And this one is worse than stale — without it the
            // panel reports the PREVIOUS file's rows under the new file's name.
            setAudit(null);
            setOutcome({ kind: "ok", meta: res.meta });
          } else {
            setOutcome({ kind: res.reason === "parse" ? "parse" : "write" });
          }
          setBusy(false);
        });
      };
      reader.onerror = function () {
        setOutcome({ kind: "read" });
        setBusy(false);
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function clearCatalogue() {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    catalogueClear().then(function (ok) {
      if (ok) {
        tobaccoDbInvalidate();
        setMeta(null);
        // The report describes a file that no longer exists.
        setAudit(null);
      } else {
        // Say so rather than showing an empty catalogue that is still there.
        setOutcome({ kind: "write" });
      }
      setBusy(false);
    });
  }

  function downloadCatalogueTemplate() {
    // BOM first, like the inventory template: without it a spreadsheet opens
    // the accented French prose as mojibake.
    dlFile("﻿" + buildCatalogueTemplateCsv(), "cave-tabac-catalogue-modele.csv", "text/csv;charset=utf-8");
  }

  function exportCatalogueCsv() {
    catalogueGetCsv().then(function (csv) {
      if (!csv) { setOutcome({ kind: "read" }); return; }
      var name = (meta && meta.name) || "cave-tabac-catalogue.csv";
      dlFile("﻿" + csv, name, "text/csv;charset=utf-8");
    });
  }

  // ── « Vérifier mon catalogue » ───────────────────────────────────────────
  //
  // Re-parses the STORED RAW CSV rather than reading the persisted meta. Three
  // reasons, and the third is the one that decided it:
  //   • the meta carries counts, never the offending rows, and the row number
  //     is the whole point of the feature;
  //   • re-parsing always reflects the CURRENT parser, so a normalisation fix
  //     reaches the report immediately instead of the next re-parse;
  //   • it needs no new stored field, so no `CATALOGUE_PARSER_VERSION` bump and
  //     no migration for catalogues already on disk.
  // MEASURED: 1594 rows parse in 0.5-1.2 s on a desktop. That is
  // far too slow to pay on every catalogue surface — which is why the load
  // caches — and entirely acceptable once, on a deliberate tap, with a busy
  // state under the button.
  function auditCatalogue() {
    if (auditBusy) return;
    setAuditBusy(true);
    setAudit(null);
    catalogueGetCsv().then(function (csv) {
      if (!csv) { setAuditBusy(false); setOutcome({ kind: "read" }); return; }
      var r = parseCatalogueCsv(String(csv));
      setAudit({
        rows: r.rows,
        blends: r.blends,
        noIdentity: r.skippedNoIdentity,
        duplicates: r.duplicateKeys,
        // Counted per ROW, not from the deduped label lists (those report how
        // many DISTINCT bad labels exist, and what the reviewer has to go and
        // fix is rows). Read from the parser's EXACT counters
        // rather than by filtering `r.issues`, which is capped at
        // MAX_CATALOGUE_ISSUES — so a badly-broken file under-reported, and one
        // whose cap filled with no-identity rows first reported ZERO bad
        // categories: the reassuring number, on the panel whose entire job is
        // to say what is wrong.
        badCategory: r.badCategory,
        badCut: r.badCut,
        issues: r.issues,
        truncated: r.issues.length >= MAX_CATALOGUE_ISSUES,
      });
      setAuditBusy(false);
    }).catch(function () {
      setAuditBusy(false);
      setOutcome({ kind: "read" });
    });
  }

  function clearCatalogueAudit() { setAudit(null); }

  function refreshCatalogueMeta() {
    catalogueGetMeta().then(function (m) { setMeta(m); });
  }

  return {
    catalogueMeta: meta,
    refreshCatalogueMeta,
    catalogueBusy: busy,
    catalogueOutcome: outcome,
    loadCatalogueFile,
    clearCatalogue,
    downloadCatalogueTemplate,
    exportCatalogueCsv,
    catalogueAudit: audit,
    catalogueAuditBusy: auditBusy,
    auditCatalogue,
    clearCatalogueAudit,
  };
}
