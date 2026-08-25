import React from "react";
import { collectSettings } from "../utils/appSettings.ts";
import { wipeAppStorage } from "../utils/appStorage.ts";
import { INIT, SCHEMA_VERSION } from "../constants.ts";
import { daysSince, fmtDate, fmtNum, isTrashed, stripDeleted, isPlausibleBackup, monotonicId, today, localDayKey } from "../utils.ts";
import { sanitizeAromas, aromaLabelKey } from "../utils/aromas.ts";
import { imgCache } from "../utils/imgCache.ts";
import { buildCollectionReport } from "../utils/collectionReport.ts";
import { parseTobaccoCsv } from "../utils/csvImport.ts";
import { CATS_EN, SHAPES_EN, ACC_TYPES_EN } from "../constants.ts";

var useState = React.useState;

export function useExportImport({
  data,
  save,
  withPhotos,
  nav,
  t,
  // Enum resolver for the collection report's category / shape /
  // accessory-type cells (stored canonical FRENCH — see collectionReport.ts).
  xl,
  excludeApiKey,
  apiKey,
  aiProvider,
  weightUnit,
  lengthUnit,
  currencySymbol,
  ageLabel,
  dateFormat,
  // Active UI language — the collection report's decimal separator (see
  // `formatNumber` in collectionReport.ts). NOT used for anything else here:
  // the CSV is French by construction (see the `lang-axis-ok` note below).
  lang,
  stageImport,
  markExported,
  setImportRecap,
}: {
  data: any;
  save: (d: any) => void;
  withPhotos: (d: any) => Promise<any>;
  nav: (v: string) => void;
  t: (k: string) => string;
  // Same shape as AppContext's `xl` — the _EN maps are Record<string,string>.
  xl?: ((v: any, map: readonly string[] | Record<string, string>) => string) | undefined;
  excludeApiKey: boolean;
  apiKey: string;
  aiProvider: string;
  weightUnit: string;
  lengthUnit: string;
  currencySymbol: string;
  ageLabel: (d: any) => string;
  dateFormat?: string;
  lang?: string;
  stageImport: (parsed: any, source: "file" | "drive", options?: { autoApply?: "replace" | "merge"; onMerged?: (summary: any) => void; keepModalOpen?: boolean }) => void;
  markExported?: () => void;
  // Non-blocking recap sink (App's setImportRecap). When present,
  // the CSV import outcome shows as a Notice toast instead of window.alert.
  // Carries an optional `view` for the tap-through (CSV → inventory).
  setImportRecap?: (r: { msg: string; view?: string; tobId?: number }) => void;
}) {
  var _bk = useState<string | null>(null),
    backupStatus = _bk[0],
    setBackupStatus = _bk[1];
  // ONE TAP, ONE ARTIFACT — the re-entry guard for the two exports that stay
  // tappable for SECONDS while nothing visible happens.
  //
  // `doExport` walks the whole photo store and `doBackupZip` additionally
  // waits on a CDN and then builds a ZIP with every photo in memory, so the
  // button is live long after the tap. A second tap used to start a second
  // run beside the first: two full passes, two `dlFile` calls — and on iOS,
  // where `canShare({files})` is true, the second `navigator.share` rejects
  // with `InvalidStateError` (a share is already in flight), which is NOT
  // `AbortError`, so `dlFile` falls through to the anchor download and the
  // user gets a share sheet AND a file from one intent.
  //
  // A REF, not state: the guard must be readable synchronously inside the
  // same handler, and React has not re-rendered between two taps in one
  // burst. Fixed field names rather than a keyed map — the keys are internal
  // and a dynamic index into a plain object is the prototype-safety class
  // this repo keeps paying for.
  //
  // EVERY exit RELEASES, failures included: a guard that stuck would turn
  // "my photo store is unreadable" into "my export button stopped working",
  // which is a worse report than the defect it hides. The non-vacuity cases
  // in exportReentry.test.ts exist for exactly that.
  //
  // SCOPE, stated so the absence reads as a decision: the three synchronous
  // exports (CSV, collection report, CSV template) are NOT guarded. They
  // hand back a file within the gesture, so their re-entry window is one tap
  // wide rather than seconds, and a guard there would be machinery with no
  // window to protect.
  var busyRef = React.useRef({ json: false, zip: false });
  // What the last CSV cellar import could not read.
  //
  // The recap TOAST says how many; this says WHICH ROW. It cannot go in the
  // toast: that is `maxWidth`-bounded and self-dismissing, and thirty row
  // numbers there would be unreadable — so it renders as a panel under the
  // button that produced it (the action→feedback adjacency rule),
  // exactly like the catalogue check's.
  var _ci = useState<any>(null),
    csvIssues = _ci[0],
    setCsvIssues = _ci[1];
  function clearCsvIssues() { setCsvIssues(null); }
  // The import-confirm picker state + apply/cancel logic
  // moved to `useImportConfirm` so the Drive restore flow can hand off
  // to the same picker. `doImportFile` below now just parses the file
  // and calls `stageImport(parsed, "file")` — the hook owner runs the
  // merge/replace and the modal lifecycle.

  // DlFile REPORTS whether the file actually reached the user.
  //
  // It used to fire `navigator.share(...)` fire-and-forget and `return` — no
  // await, no fallback, no signal — while every caller unconditionally called
  // `markExported()`, which bumps `cave-last-export-ts` and suppresses the "you
  // have not backed up" reminder for 30 days. `doBackupZip` additionally set
  // `backupStatus = st_done`, a false success message. On iOS, where
  // `canShare({files})` is true, this is the ONLY export path — so dismissing
  // the share sheet, an entirely routine gesture, silently disarmed the app's own
  // backup safety net.
  //
  // AbortError is the user dismissing the sheet on purpose: report false and do
  // NOT fall back to a download, which would be a surprising second artifact
  // after they said no. Any OTHER rejection is a share that FAILED, so the
  // anchor download still runs — losing the export because the share mechanism
  // is broken would be the worse outcome.
  function dlFile(content: any, filename: any, mime: any): Promise<boolean> {
    var blob = new Blob([content], { type: mime });
    if (navigator.share && navigator.canShare) {
      var file = new File([blob], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file] })
          .then(function () { return true; })
          .catch(function (e: any) {
            if (e && e.name === "AbortError") return false;
            return _anchorDownload(blob, filename);
          });
      }
    }
    return Promise.resolve(_anchorDownload(blob, filename));
  }

  function _anchorDownload(blob: Blob, filename: string): boolean {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function doExport() {
    // See `busyRef`. One tap, one file.
    if (busyRef.current.json) return;
    busyRef.current.json = true;
    var base = Object.assign({}, data, {
      _apiKey: excludeApiKey ? "" : apiKey || "",
      // Remember which provider this key belongs to so
      // the import path writes it into the right slot. See useImportConfirm.
      _apiKeyProvider: excludeApiKey ? "" : aiProvider || "",
      _schemaVersion: SCHEMA_VERSION,
      // The app's PREFERENCES travel with the export, so restoring
      // onto a new phone does not mean re-picking language, units, currency,
      // theme, text size and thresholds by hand. An ALLOWLIST — never a sweep
      // of localStorage, which holds live credentials (see utils/appSettings).
      _settings: collectSettings(),
    });
    withPhotos(base)
      .then(function (exp: any) {
        // The reminder is only disarmed if the file actually
        // reached the user — a dismissed share sheet is not an export.
        return dlFile(
          JSON.stringify(exp, null, 2),
          "cave-tabac-export.json",
          "application/json",
        ).then(function (ok: boolean) {
          // Bump the "last export" clock so the reminder
          // banner doesn't fire for another 30 days.
          if (ok && markExported) markExported();
        });
      })
      // Surface the failure instead of silently dropping it.
      // gatherLocalImages can reject on a broken IndexedDB (private
      // mode, evicted storage) — without this the user believed the export
      // succeeded while no file was ever produced.
      .catch(function (e: any) {
        alert(exportFailMsg(e));
      })
      // Release on BOTH paths — `.catch` resolves, so this tail runs whether
      // the export succeeded, was declined, or failed.
      .then(function () {
        busyRef.current.json = false;
      });
  }

  // The photo store being unreadable is the ONE failure here with a
  // cause the user can act on (storage full / private mode), and it now arrives
  // as a machine-readable code rather than English prose — see gatherLocalImages
  // and the no-English-prose-in-thrown-errors rule. Anything else keeps the generic message with its
  // detail appended, which is the only diagnostic we have for it.
  function exportFailMsg(e: any): string {
    var m = String((e && e.message) || e);
    if (m === "photo-store-unreadable") {
      return t("err_export_failed") + " " + t("err_photos_unreadable");
    }
    return t("err_export_failed") + " " + m.slice(0, 120);
  }

  function csvEsc(v: any) {
    var s = String(v == null ? "" : v);
    // CSV injection mitigation:
    // cells whose first non-whitespace character is =, +, -, @, tab,
    // CR or | are interpreted as formulas (or DDE) by Excel /
    // LibreOffice / Numbers on open. Prefix with an apostrophe so
    // the cell renders literally. The check trims leading whitespace
    // AND zero-width chars (U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ,
    // U+FEFF BOM) so a leading-space or leading-zero-width payload
    // (e.g. an invisible char followed by "=cmd") can't sneak
    // past — Excel trims those before parsing.
    // `u` flag added so typescript-eslint 8.60's
    // no-misleading-character-class doesn't flag the ZWJ codepoint
    // inside the class (it's a standalone trim target here, not a
    // joiner inside an emoji sequence).
    var stripped = String(s).replace(/^(?:\s|\u200B|\u200C|\u200D|\uFEFF)+/u, "");
    if (/^[=+\-@\t\r|]/.test(stripped)) s = "'" + s;
    s = String(s).replace(/\r?\n/g, " ").replace(/"/g, '""');
    return '"' + s + '"';
  }

  // lang-axis-ok: the CSV is FRENCH by construction, in every UI language, and
  // must stay that way. `parseTobaccoCsv` matches columns by header NAME against
  // an FR+EN alias table, and the status cells it reads are Cave/Pot/Fini — so
  // localising these headers would silently break re-import of a file exported
  // under another UI language, which is the one thing a round-trip must survive.
  // The two cells that DO localise (Arômes values, Age) are free text the parser
  // never matches on. See CLAUDE.md, "what is deliberately NOT translated".
  function buildCsvLines() {
    var sep = ";";
    var lines: string[] = [];
    lines.push(
      [
        "Marque",
        "Nom",
        "Categorie",
        "Composition",
        "Coupe",
        "Force",
        "Room Note",
        "Gout",
        "Description",
        "Note",
        "A reprendre",
        "Notes degustation",
        "Age max cave (ans)",
        "Statut",
        "Éliminé",
        "Poids (" + weightUnit + ")",
        "Poids initial (" + weightUnit + ")",
        "Statut origine",
        "Date achat",
        "Date production",
        "Date mise en pot",
        "Date fin",
        "No boite",
        "Lieu de stockage",
        "Prix (" + currencySymbol + ")",
        "Vendeur",
        "Site vendeur",
        "Age",
        "Image URL",
      ]
        .map(csvEsc)
        .join(sep),
    );
    // The CSV is a working snapshot of the live inventory —
    // soft-deleted rows belong in the JSON / Drive backups (they survive
    // restore so the user keeps the safety net) but NOT in the CSV.
    // A trashed tobacco filters its entire block; a trashed lot inside
    // a non-trashed tobacco filters just that row.
    (data.tobaccos || []).forEach(function (tb: any) {
      if (isTrashed(tb)) return;
      var liveLots = stripDeleted(tb.lots);
      var lots = liveLots.length ? liveLots : [{}];
      lots.forEach(function (l: any) {
        var age =
          l.dateProduction || l.datePurchased
            ? ageLabel(daysSince(l.dateProduction || l.datePurchased))
            : "";
        var st =
          l.status === "cellar"
            ? "Cave"
            : l.status === "jar"
              ? "Pot"
              : l.status === "finished"
                ? "Termine"
                : "";
        var rb = tb.rebuy === true ? "Oui" : tb.rebuy === false ? "Non" : "";
        lines.push(
          [
            tb.brand,
            tb.name,
            tb.category,
            tb.blend,
            tb.cut,
            tb.force || "",
            tb.roomNote || "",
            tb.taste || "",
            tb.description,
            tb.rating || "",
            rb,
            tb.tastingNotes || "",
            tb.agingMax || "",
            st,
            l.disposed ? "Oui" : "",
            l.weightG || "",
            l.weightInitial || "",
            l.originalStatus === "jar" ? "Pot" : l.originalStatus === "cellar" ? "Cave" : "",
            l.datePurchased ? fmtDate(l.datePurchased, dateFormat) : "",
            l.dateProduction ? fmtDate(l.dateProduction, dateFormat) : "",
            l.dateOpened ? fmtDate(l.dateOpened, dateFormat) : "",
            l.dateFinished ? fmtDate(l.dateFinished, dateFormat) : "",
            l.boxNumber || "",
            l.storageLocation || "",
            l.price || "",
            l.seller || "",
            l.sellerUrl || "",
            age,
            tb.imageUrl &&
            (tb.imageUrl.indexOf("data:") === 0 ||
              tb.imageUrl.indexOf("local-photo-") === 0)
              ? ""
              : tb.imageUrl || "",
          ]
            .map(csvEsc)
            .join(sep),
        );
      });
    });
    lines.push("");
    lines.push(csvEsc("=== PIPES ==="));
    lines.push(
      [
        "Marque",
        "Modele",
        "Forme",
        "Courbure",
        // The unit column reflects the user's CURRENT
        // global preference, not the unit the value was stored in
        // (which is the same number, just display-only — see
        // CLAUDE.md §16). Header annotation makes the ambiguity
        // visible for downstream consumers.
        "Longueur (" + lengthUnit + ")",
        "Poids (" + weightUnit + ")",
        "Filtre",
        "Diam. foyer (mm)",
        "Prof. foyer (mm)",
        "Matiere bol",
        "Matiere bec",
        "Finition",
        "Date achat",
        "Date production",
        "Prix (" + currencySymbol + ")",
        "Vendeur",
        "Note",
        "Statut",
        "Description",
        "Remarque",
        "Image URL",
      ]
        .map(csvEsc)
        .join(sep),
    );
    (data.pipes || []).forEach(function (p: any) {
      if (isTrashed(p)) return; // Skip trashed
      lines.push(
        [
          p.brand,
          p.name,
          p.shape,
          p.courbure || "",
          p.length || "",
          p.weight || "",
          p.filterType || "",
          p.chamberDiameter || "",
          p.chamberDepth || "",
          p.bowlMaterial || "",
          p.stemMaterial || "",
          p.finish || "",
          // Pipe dates are year-only (`YYYY`) — emit raw.
          p.datePurchased || "",
          p.dateProduction || "",
          p.price || "",
          p.seller || "",
          p.rating || "",
          (p.status || "active") === "active" ? "Active" : "Finie",
          p.description || "",
          p.notes || "",
          p.imageUrl &&
          (p.imageUrl.indexOf("data:") === 0 ||
            p.imageUrl.indexOf("local-photo-") === 0)
            ? ""
            : p.imageUrl || "",
        ]
          .map(csvEsc)
          .join(sep),
      );
    });
    lines.push("");
    lines.push(csvEsc("=== WISHLIST ==="));
    lines.push(
      [
        "Nom",
        "Marque",
        "Categorie",
        "Composition",
        "Coupe",
        "Force",
        "Room Note",
        "Gout",
        "Description",
        "Age max cave (ans)",
        "Note",
        "Remarque",
        "Priorite",
        "Image URL",
      ]
        .map(csvEsc)
        .join(sep),
    );
    (data.wishlist || []).forEach(function (w: any) {
      if (isTrashed(w)) return; // Skip trashed
      lines.push(
        [
          w.name,
          w.brand,
          w.category || "",
          w.blend || "",
          w.cut || "",
          w.force || "",
          w.roomNote || "",
          w.taste || "",
          w.description || "",
          w.agingMax || "",
          w.tastingNotes || "",
          w.notes || "",
          w.priority,
          w.imageUrl || "",
        ]
          .map(csvEsc)
          .join(sep),
      );
    });
    lines.push("");
    lines.push(csvEsc("=== ACCESSOIRES ==="));
    lines.push(
      [
        "Type",
        "Marque",
        "Nom",
        "Carburant",
        "Statut",
        "Date achat",
        "Prix (" + currencySymbol + ")",
        "Vendeur",
        "Note",
        "Remarques",
        "Image URL",
      ]
        .map(csvEsc)
        .join(sep),
    );
    (data.accessories || []).forEach(function (a: any) {
      if (isTrashed(a)) return; // Skip trashed
      lines.push(
        [
          a.type || "",
          a.brand || "",
          a.name || "",
          a.fuel || "",
          a.status || "",
          // Accessory datePurchased is year-only — raw.
          a.datePurchased || "",
          a.price || "",
          a.seller || "",
          a.rating || "",
          a.notes || "",
          a.imageUrl || "",
        ]
          .map(csvEsc)
          .join(sep),
      );
    });
    lines.push("");
    lines.push(csvEsc("=== SEANCES ==="));
    lines.push(
      [
        "Date",
        "Heure",
        "Tabac",
        "Pipe",
        "Durée (min)",
        "Quantité fumée (" + weightUnit + ")",
        "Note",
        "Remarques",
        "Arômes",
        "Lieu",
        "Commune",
        "Pays",
        "Latitude",
        "Longitude",
      ]
        .map(csvEsc)
        .join(sep),
    );
    // NULL-PROTOTYPE: the WRITE key is an entity id and the READ key is
    // `session.tobaccoId` / `session.pipeId`, both of which come straight out
    // of an imported backup. On a plain object a forged `tobaccoId:
    // "toString"` makes `map[id]` resolve to `Object.prototype.toString` — a
    // FUNCTION, and truthy — so `labelOrSnapshot` returns it, TypeScript
    // cannot see it (the index is `any`), and the CSV cell reads
    // `function toString() { [native code] }`.
    //
    // Worse than the cosmetic damage: that truthy value SHORT-CIRCUITS the
    // snapshot fallback three lines down, which exists precisely so a session
    // whose entity is gone still exports an identifiable label. So the export
    // loses the very information the fallback was added to preserve.
    var tobMap: Record<string | number, string> = Object.create(null);
    (data.tobaccos || []).forEach(function (tb: any) {
      tobMap[tb.id] = [tb.brand || "", tb.name || ""].filter(Boolean).join(" ");
    });
    var pipeMap: Record<string | number, string> = Object.create(null);
    (data.pipes || []).forEach(function (p: any) {
      pipeMap[p.id] = [p.brand || "", p.name || ""].filter(Boolean).join(" ");
    });
    // Session label fallback to the snapshot (brand+name
    // captured at save time). Without it, a session referencing a tabac/pipe
    // that's been hard-deleted exported an empty CSV cell — the journal
    // shows the snapshot, so the CSV silently lost identifiable info.
    function labelOrSnapshot(map: Record<string | number, string>, id: any, snap: any): string {
      if (id && map[id]) return map[id];
      if (snap && (snap.brand || snap.name)) {
        return [snap.brand || "", snap.name || ""].filter(Boolean).join(" ");
      }
      return "";
    }
    // The tobacco/pipe lookup maps above keep trashed entities so a
    // (still-live) session referencing a trashed entity can resolve a
    // human-readable label — but the session row itself is skipped if
    // the session is trashed.
    (data.sessions || []).forEach(function (s: any) {
      if (isTrashed(s)) return; // Skip trashed
      lines.push(
        [
          s.date ? fmtDate(s.date, dateFormat) : "",
          s.time || "",
          labelOrSnapshot(tobMap, s.tobaccoId, s.tobaccoSnapshot),
          labelOrSnapshot(pipeMap, s.pipeId, s.pipeSnapshot),
          s.duration || "",
          s.weightG || "",
          s.rating || "",
          s.notes || "",
          sanitizeAromas(s.aromas).map(function (k) { return t(aromaLabelKey(k)); }).join(" · "),
          s.locationName || "",
          s.locationCity || "",
          s.locationCountry || "",
          typeof s.lat === "number" ? String(s.lat) : "",
          typeof s.lng === "number" ? String(s.lng) : "",
        ]
          .map(csvEsc)
          .join(sep),
      );
    });
    return lines;
  }

  function doExportCSV() {
    var lines = buildCsvLines();
    dlFile(
      "﻿" + lines.join("\r\n"),
      "cave-tabac-export.csv",
      "text/csv;charset=utf-8",
    ).then(function (ok: boolean) { if (ok && markExported) markExported(); });
  }

  // Collection / insurance report — a printable, self-contained
  // HTML document of the whole live collection with per-item purchase values
  // and totals. Built by the pure `buildCollectionReport`; downloaded via the
  // same `dlFile` blob path as the other exports.
  function doCollectionReport() {
    var now = new Date();
    var pad = function (n: number) { return String(n).padStart(2, "0"); };
    var compact = String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate());
    // The LOCAL day, like `compact` above and like the HH:MM appended
    // below. It was `toISOString().slice(0,10)` — the UTC day — so from the
    // late afternoon westward the document a user files with an insurer was
    // stamped TOMORROW, and disagreed with the name of the file it arrived in.
    var human = fmtDate(localDayKey(now.getTime()), dateFormat) +
      " " + pad(now.getHours()) + ":" + pad(now.getMinutes());
    var labels = {
      title: t ? t("report_title") : "Rapport de collection",
      generated: t ? t("report_generated") : "Généré le",
      summary: t ? t("report_summary") : "Résumé",
      totalValue: t ? t("report_total_value") : "Valeur d'achat totale",
      tobaccos: t ? t("nav_tobaccos") : "Tabacs",
      pipes: t ? t("stat_pipes_word") : "Pipes",
      accessories: t ? t("nav_acc") : "Accessoires",
      colBrand: t ? t("f_brand") : "Marque",
      colName: t ? t("f_name") : "Nom",
      colCategory: t ? t("report_col_category") : "Catégorie",
      colLots: t ? t("report_col_lots") : "Lots",
      // The weight column is split. Reuses the inventory chip
      // labels, so the report says exactly what the app says.
      colCellar: t ? t("f_cellar") : "En cave",
      colJar: t ? t("f_jars") : "En pot",
      colShape: t ? t("lbl_shape") : "Forme",
      colType: t ? t("lbl_type") : "Type",
      colValue: t ? t("report_col_value") : "Valeur",
      items: t ? t("report_items") : "articles",
      itemsOne: t ? t("report_items_one") : "article",
      subtotal: t ? t("report_subtotal") : "Sous-total",
      disclaimer: t ? t("report_disclaimer") : "Valeurs basées sur les prix d'achat saisis. Document généré localement par Ma Cave à Tabac.",
    };
    var html = buildCollectionReport(data, {
      currencySymbol: currencySymbol, weightUnit: weightUnit, dateStr: human, labels: labels,
      // The report's headers were translated while its enum CELLS
      // stayed canonical French. The maps live here, the module stays neutral.
      xlEnum: function (v: string, kind: string) {
        if (!v || !xl) return v;
        var m = kind === "category" ? CATS_EN : kind === "shape" ? SHAPES_EN : ACC_TYPES_EN;
        return xl(v, m);
      },
      // The report printed a DOT decimal in a comma-decimal UI —
      // `12.50 €` in a document generated from a screen that says `12,50 €`.
      // `fmtNum` is the app's single source of truth for the separator, and it
      // lives in `utils.ts`, which imports `LANG`; passing it IN keeps
      // `collectionReport.ts` language-neutral (its design premise) instead of
      // dragging the i18n machinery into a string-only module.
      formatNumber: function (v: string) { return fmtNum(v, lang); },
      // `<html lang>` : le document n'en portait aucun. Validé dans le module,
      // jamais recopié tel quel — un `cave-lang` corrompu écrivait déjà
      // `lang="constructor"` sur `public/reset.html`.
      lang: lang,
    });
    dlFile(html, "cave-tabac-rapport-" + compact + ".html", "text/html;charset=utf-8")
      .then(function (ok: boolean) { if (ok && markExported) markExported(); });
  }

  // Le modèle CSV prêt à remplir.
  //
  // SON COMMENTAIRE PROMETTAIT « la même forme d'en-tête que l'export, donc ça
  // fait l'aller-retour » — et l'export a VINGT-HUIT colonnes contre
  // vingt-quatre ici. Diff complet des cinq écarts, parce que la nuance est
  // tout le sujet : TROIS sont corrects et un seul était un manque.
  //
  //   · `Age` — colonne CALCULÉE à l'export, et `HEADER_ALIASES` n'a
  //     délibérément aucun mappage pour elle. La demander à l'utilisateur
  //     serait lui faire calculer ce que l'app dérive.
  //   · `Image URL` — le lecteur force `imageUrl: ""` (l'app n'a plus que des
  //     photos locales), donc la colonne serait un champ sans effet.
  //   · `Statut origine` — déduit par `migrateData` et purement informatif ;
  //     le demander serait demander de deviner.
  //   · `Éliminé` — lu par le lecteur, mais c'est le drapeau « jeté sans
  //     l'avoir fumé » : hors sujet sur un modèle qui sert à SAISIR une cave.
  //   · `Composition` — LE manque. Le lecteur la lit (`composition` → `blend`),
  //     l'export l'écrit, et sans elle aucune voie CSV ne permet de renseigner
  //     la composition d'un mélange. Ajoutée.
  //
  // Donc ce n'est PAS la forme d'en-tête de l'export, et ça ne doit pas
  // l'être : c'est le sous-ensemble qu'un humain peut remplir. Le commentaire
  // est corrigé plutôt que supprimé — une promesse fausse en dit plus sur ce
  // qui a dérivé qu'une absence de commentaire.
  //
  // Les unités et la devise des en-têtes suivent les préférences ; le lecteur
  // retire les « (…) », donc n'importe quelle unité fait l'aller-retour.
  function doDownloadCsvTemplate() {
    var headers = [
      "Marque", "Nom", "Categorie", "Composition", "Coupe", "Force", "Room Note", "Gout", "Note",
      "A reprendre", "Age max cave (ans)", "Statut", "Poids (" + weightUnit + ")",
      "Poids initial (" + weightUnit + ")", "Date achat", "Date production",
      // The two lifecycle columns. This template's own comment says
      // it uses "the same header shape the export uses" — and it did not: the
      // export emits these two and the template omitted them, so its `Pot`
      // example row imported without an opening date and tripped
      // `jar-has-dateOpened` at the next save. The parser now back-fills as
      // well (any hand-built CSV can do the same), but the template should
      // demonstrate the column rather than rely on the repair.
      "Date mise en pot", "Date fin",
      "Prix (" + currencySymbol + ")", "Vendeur", "Site vendeur", "No boite", "Lieu de stockage",
      "Description", "Notes degustation",
    ];
    // THE EXAMPLE BLEND IS INVENTED, AND MUST STAY INVENTED. This file is
    // DISTRIBUTED — every user downloads it from Réglages → Données — and it
    // used to ship a real blend carrying a full attribute set: category, cut,
    // Force 3 / Room Note 2 / Taste 3, a personal rating of 4, an ageing
    // ceiling, a description and a tasting note. Naming a real product is fine
    // and is done elsewhere on purpose (the form placeholders, the guide's
    // fuzzy-match examples); ATTRIBUTING ratings and prose to it is not, because
    // a plausible F/RN/T triplet beside a real name is indistinguishable from a
    // catalogue row whether the numbers were researched or invented.
    // `Halvorsen | Duskfall` is the same invented pair the CATALOGUE template
    // uses, so the two downloads speak one vocabulary. The numbers stay: on an
    // invented blend they assert nothing about any product, and the column
    // still has to be demonstrated. The retailer is real and stays — a seller
    // is neither an attribute of the blend nor anyone's research, and it is the
    // clearest way to show what the "Site vendeur" column wants.
    var ex1 = ["Halvorsen", "Duskfall", "Virginia/Burley", "Virginia, Burley", "Flake", "3", "2", "3", "4",
      "Oui", "12", "Pot", "40", "50", "2024-03-15", "2022", "2025-06-01", "", "14.90", "smokingpipes.com",
      "www.smokingpipes.com", "A12", "Armoire A",
      "Exemple : votre description du blend.", "Exemple : vos notes de degustation."];
    var ex2 = ["Halvorsen", "Duskfall", "Virginia/Burley", "Virginia, Burley", "Flake", "3", "2", "3", "4",
      "Oui", "12", "Cave", "100", "100", "2025-01-10", "2024", "", "", "15.50", "", "",
      "A13", "Armoire A", "", ""];
    var lines = [headers, ex1, ex2].map(function (row) {
      return row.map(csvEsc).join(";");
    });
    dlFile("﻿" + lines.join("\r\n"), "cave-tabac-modele.csv", "text/csv;charset=utf-8");
  }

  // Import tobaccos + lots from a CSV file. Parsed by the pure
  // `parseTobaccoCsv` then MERGED (never replaced) via the shared import
  // pipeline — a tobaccos-only payload leaves pipes / accessories / sessions
  // untouched, and merge dedups by brand+name so a re-import can't duplicate.
  function doImportCsvFile() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var raw = String(reader.result || "");
          // Hand the parser today's date so it can back-fill the
          // lifecycle date a status implies (a "Pot" row with no opening date).
          // `today()`, not the UTC day: this value is WRITTEN into the
          // cellar as the lifecycle date a status implies, so a western user
          // importing in the evening got a lot "mise en pot" tomorrow — and
          // nothing warns, since `daysSince` clamps a negative age to 0.
          var parsed = parseTobaccoCsv(raw, { todayIso: today() });
          // A stale panel must never outlive the file that produced it.
          setCsvIssues(null);
          // Re-stamp every lot id from the canonical unique-id
          // source. `parseTobaccoCsv` is deliberately PURE and deterministic
          // (it is fuzzed), so it mints lot ids from a fixed base — meaning two
          // separate CSV imports produce the SAME lot ids under different
          // tobaccos. Reproduced: two one-line CSVs both yield lot id 100001.
          // That silently breaks the app-wide assumption that lot ids are
          // globally unique (monotonicId guarantees it everywhere else), and
          // the trash operations sweep by lot id ACROSS all tobaccos — so
          // permanently deleting one blend's trashed lot also hard-deleted a
          // different blend's LIVE lot, and the 30-day auto-sweep orphaned its
          // sessions with no user action at all. Safe to do here because the
          // CSV payload is tobaccos-only: there are no sessions to re-link.
          parsed.tobaccos.forEach(function (tb: any) {
            if (!tb || !Array.isArray(tb.lots)) return;
            tb.lots.forEach(function (l: any) { if (l) l.id = monotonicId(); });
          });
          if (!parsed.tobaccos.length) {
            // Explicit diagnosis instead of a generic "empty" message:
            var head = raw.replace(/^\uFEFF/, "").trim();
            var looksJson = head.charAt(0) === "{" || head.charAt(0) === "[" || head.indexOf("\"tobaccos\"") >= 0;
            var msg = looksJson
              ? (t ? t("csv_import_json") : "Ce fichier est une sauvegarde JSON, pas un CSV de tabacs. Utilisez « Importer fichier (.json) » pour le restaurer.")
              : (t ? t("csv_import_empty") : "Aucun tabac valide trouvé. Vérifiez que le fichier CSV contient les colonnes « Marque » et « Nom » (téléchargez le modèle CSV).");
            try { window.alert(msg); } catch (_e) {}
            return;
          }
            // Capture the merge recap (lot-level merge now tops up
            // an existing blend's lots) so the feedback reflects what really
            // changed instead of the older add-only claim.
            var _summary: any = null;
            // Computed BEFORE the import because it decides
            // whether Settings stays open — the row-level panel renders there,
            // and `_runImport` closes the modal for a "file" source.
            var _coerced = (parsed.badCategory || 0) + (parsed.badCut || 0) + (parsed.badNumber || 0);
            var _hasIssues = parsed.skipped > 0 || _coerced > 0;
            stageImport({ tobaccos: parsed.tobaccos }, "file", {
              autoApply: "merge",
              onMerged: function (s: any) { _summary = s; },
              keepModalOpen: _hasIssues,
            });
            // An IMPORT does not count as a backup. This called
            // `markExported()`, which bumps `cave-last-export-ts` and silences
            // the "you have not backed up in a while" reminder for 30 days —
            // immediately after the data CHANGED, which is precisely when the
            // reminder is most warranted. The reminder is about the cellar
            // leaving the device, and nothing left it here.
            try {
            // The "already present" count comes from the MERGE, not
            // from a re-computation.
            //
            // It used to be recomputed here by dupKey against live rows, which
            // knew nothing about what the merge had actually done — so a row the
            // merge REFUSED to match (several local rows share that brand+name,
            // so it cannot tell which one this is) counted as "matched", while a
            // complete duplicate tobacco had just been created. The message read
            // « 1 tabac déjà présent : aucun nouveau lot ajouté » for an import
            // that added a row. And it compounded: one duplicate pair makes every
            // later import of that blend add another copy, each reported as a
            // no-op. Measured by the audit at 54 of 800 randomised CSV
            // round-trips, all attributable to this.
            var _matched = _summary ? (_summary.tobaccosMatched || 0) : 0;
            var done = String(t ? t("csv_import_done") : "{n} tabac(s) et {l} lot(s) importés (fusionnés).")
              .replace("{n}", String(parsed.tobaccos.length))
              .replace("{l}", String(parsed.lots));
            // New lots added onto already-present tabacs (lot-level merge).
            if (_summary && _summary.lotsAppended > 0) {
              done += "\n\n" + String(t ? t("merge_recap_lots") : "{l} nouveau(x) lot(s) ajouté(s) à {m} tabac(s) déjà présent(s).")
                .replace("{l}", String(_summary.lotsAppended))
                .replace("{m}", String(_summary.blendsToppedUp));
            }
            // Matched tabacs that gained no new lot AND no field update were
            // already fully present. (`entitiesUpdated` counts a dup refreshed by
            // LWW — that is a change, not a no-op, so it must not be reported as
            // "nothing to do".)
            var _uptodate = _matched
              - (_summary ? _summary.blendsToppedUp : 0)
              - (_summary ? (_summary.entitiesUpdated || 0) : 0);
            if (_uptodate > 0) {
              done += "\n\n" + String(t ? t("csv_import_uptodate") : "{m} tabac(s) déjà présent(s) : aucun nouveau lot ajouté (la fusion CSV n'ajoute que des lots).")
                .replace("{m}", String(_uptodate));
            }
            // A row added as a visible duplicate — several of your
            // fiches share that brand+name, so the merge could not tell which one
            // this row was. Silence here is what let the duplication compound.
            if (_summary && (_summary.identityConflicts || 0) > 0) {
              done += "\n\n" + String(t ? t("merge_recap_identity") : "{n} fiche(s) portent le même nom qu'une fiche existante sans pouvoir y être rattachées : ajoutée(s) séparément, à fusionner à la main si besoin.")
                .replace("{n}", String(_summary.identityConflicts));
            }
            // Rows left alone because they are in the trash.
            if (_summary && (_summary.trashedSkipped || 0) > 0) {
              done += "\n\n" + String(t ? t("merge_recap_trashed") : "{n} élément(s) sont déjà dans votre corbeille : rien n'a été ajouté. Restaurez-les depuis la corbeille si vous les voulez de nouveau.")
                .replace("{n}", String(_summary.trashedSkipped));
            }
            // The full CSV export is multi-section — warn that only tabacs came in.
            if (parsed.sectioned) {
              done += "\n\n" + (t ? t("csv_import_sections") : "Un export CSV contient aussi pipes, accessoires et séances : seuls les tabacs ont été importés. Pour tout restaurer, utilisez une sauvegarde JSON.");
            }
            // What the PARSER could not read, which the recap
            // had never mentioned even though it was already counted.
            //
            // `skipped` was in the result long before any caller
            // read it, so a file that lost rows for want of a brand or a
            // name reported the same success as a clean one — verbatim the
            // silent-drop lesson, one importer over. And an unrecognised family
            // or cut is snapped to « Autre » (deliberately: the fiche's
            // dropdown is fixed, so keeping it verbatim would be rewritten on
            // the first save), which is defensible only if the app
            // SAYS so.
            // ONE line, no counts: `keepModalOpen` fires on exactly this
            // condition, so the panel carrying the counts AND the rows is
            // always on screen when this appears. Measured at 360 px in German
            // at "L", the two-paragraph version covered the Settings modal
            // while telling the reader to look at a panel it was hiding.
            if (_hasIssues) {
              done += "\n\n" + (t ? t("csv_import_issues") : "Certaines lignes n'ont pas pu être lues telles quelles : le détail est sous le bouton d'import.");
            }
            // The file exceeded the row cap — surface it rather than
            // silently truncating.
            if (parsed.capped) {
              done += "\n\n" + String(t ? t("csv_import_capped") : "Fichier volumineux : seules les {n} premières lignes ont été importées.")
                .replace("{n}", String(parsed.rows));
            }
            // Non-blocking Notice toast (fall back to alert only when
            // no sink was wired — older callers / tests). A CSV import brings in
            // tabacs, so the recap taps through to the inventory.
            if (setImportRecap) setImportRecap({ msg: done, view: "inv" });
            else window.alert(done);
            // The row-level detail, for the panel. Raised only when there is
            // something to say: an always-present "0 problems" panel after
            // every clean import would be noise, and the recap toast already
            // confirms the import landed.
            if (_hasIssues) {
              setCsvIssues({
                rows: parsed.rows,
                skipped: parsed.skipped,
                badCategory: parsed.badCategory || 0,
                badCut: parsed.badCut || 0,
                badNumber: parsed.badNumber || 0,
                issues: parsed.issues || [],
                truncated: !!parsed.issuesTruncated,
              });
            }
          } catch (_e2) {}
        } catch (_e) {
          try { window.alert(t ? t("err_import_failed") : "Échec de l'import du fichier."); } catch (_e3) {}
        }
      };
      // A FileReader failure is NOT the same as a file that parses badly:
      // the file moved, the media is unreadable, permission was refused. With
      // only `onload` wired the button looked dead — nothing on screen, no
      // state change, no message. `useUserCatalogue.loadCatalogueFile` has
      // handled this all along, which is what identifies the omission as an
      // oversight rather than a decision.
      reader.onerror = function () {
        try { window.alert(t ? t("err_import_failed") : "Échec de l'import du fichier."); } catch (_e) {}
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function doBackupZip() {
    // See `busyRef`. The claim is taken BEFORE the `window.JSZip` check, so
    // it covers the CDN wait too: a second tap while the script is in flight
    // returns here instead of appending a second <script> whose own `onload`
    // would run `_runZip` a second time.
    if (busyRef.current.zip) return;
    busyRef.current.zip = true;
    function releaseZip() {
      busyRef.current.zip = false;
    }
    function _runZip() {
      withPhotos(data).then(function (rd: any) {
        var zip = new window.JSZip();
        // Preferences ride along (allowlist — utils/appSettings).
        var stamped = Object.assign({}, rd, {
          _schemaVersion: SCHEMA_VERSION,
          _settings: collectSettings(),
        });
        zip.file("cave-tabac-data.json", JSON.stringify(stamped, null, 2));
        zip.file(
          "cave-tabac-export.csv",
          "﻿" + buildCsvLines().join("\r\n"),
        );
        var imgF = zip.folder("images-tabacs"),
          imgP = zip.folder("images-pipes"),
          imgA = zip.folder("images-accessoires"),
          imgW = zip.folder("images-wishlist");
        var allImgs: any[] = [];
        (rd.tobaccos || []).forEach(function (tb: any) {
          if (tb.imageUrl)
            allImgs.push({
              url: tb.imageUrl,
              name: String(tb.brand + "-" + tb.name).replace(/[^a-zA-Z0-9]/g, "_"),
              folder: imgF,
            });
        });
        (rd.pipes || []).forEach(function (p: any) {
          if (p.imageUrl)
            allImgs.push({
              url: p.imageUrl,
              name: String(p.brand + "-" + p.name).replace(/[^a-zA-Z0-9]/g, "_"),
              folder: imgP,
            });
        });
        (rd.accessories || []).forEach(function (a: any) {
          if (a.imageUrl)
            allImgs.push({
              url: a.imageUrl,
              name: String(
                (a.brand || "") +
                (a.brand && (a.name || a.type) ? "-" : "") +
                (a.name || a.type || "acc")
              ).replace(/[^a-zA-Z0-9]/g, "_"),
              folder: imgA,
            });
        });
        (rd.wishlist || []).forEach(function (w: any) {
          if (w.imageUrl)
            allImgs.push({
              url: w.imageUrl,
              name: String(
                (w.brand || "") +
                (w.brand && w.name ? "-" : "") +
                (w.name || "wish")
              ).replace(/[^a-zA-Z0-9]/g, "_"),
              folder: imgW,
            });
        });
        var total = allImgs.length;
        // Shared failure path for the two generateAsync sites.
        // JSZip failures (OOM on a huge photo set, blob alloc) used to
        // strand backupStatus on "st_zipping" forever with no feedback.
        function zipFail(e: any) {
          setBackupStatus(null);
          alert(t("err_export_failed") + " " + String((e && e.message) || e).slice(0, 120));
        }
        // ONE tail for the two generateAsync sites — they were byte-near
        // duplicates, and the re-entry guard needs a single place to release
        // rather than a copy of the same three lines in each.
        function emitZip() {
          zip.generateAsync({ type: "blob" }).then(function (c: any) {
            return dlFile(c, "cave-tabac-export.zip", "application/zip").then(function (ok: boolean) {
              // A dismissed share sheet is not a backup — neither
              // the reminder nor the "✓ OK" status may claim one happened.
              if (!ok) { setBackupStatus(null); return; }
              if (markExported) markExported();
              setBackupStatus(t("st_done"));
              setTimeout(function () {
                setBackupStatus(null);
              }, 3000);
            });
          }).catch(zipFail).then(releaseZip);
        }
        function dlN(idx: any) {
          if (idx >= allImgs.length) {
            setBackupStatus(t("st_zipping"));
            emitZip();
            return;
          }
          setBackupStatus(t("st_images") + " " + (idx + 1) + "/" + total);
          var it = allImgs[idx];
          // Local-photos-only. `withPhotos` has already resolved
          // every `local-photo-*` key to a `data:` URL; anything else (a rare
          // not-yet-migrated legacy URL) is skipped — no proxy fetch.
          if (it.url.indexOf("data:image/") === 0) {
            var m = String(it.url).match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (m) {
              // Both capture groups are provably present when `m` is truthy
              // (the regex requires them); noUncheckedIndexedAccess can't see it.
              var ext = m[1]!.indexOf("png") >= 0 ? ".png" : ".jpg";
              it.folder.file(it.name + ext, m[2]!, { base64: true });
            }
          }
          dlN(idx + 1);
        }
        if (total > 0) dlN(0);
        // A photo-less cellar skips straight to the blob. Deliberately NO
        // `st_zipping` here — that is what the pre-extraction code did, and
        // adding a status flash to this branch would be a behaviour change
        // smuggled into a re-entry fix.
        else emitZip();
      }).catch(function (e: any) {
        // WithPhotos rejection (broken IndexedDB) — same
        // visibility rule as doExport.
        releaseZip();
        setBackupStatus(null);
        alert(exportFailMsg(e));
      });
    }
    // LABEL-CONTRACT:start jszip-cdn — see scripts/label-contracts.json
    if (window.JSZip) {
      _runZip();
      return;
    }
    setBackupStatus(t("loading"));
    var script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.integrity =
      "sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG";
    script.crossOrigin = "anonymous";
    // LABEL-CONTRACT:end jszip-cdn
    script.onload = _runZip;
    script.onerror = function () {
      // Re-arm: a CDN blip is exactly the case where the user's remedy is to
      // tap again, so the guard must not survive the failure.
      releaseZip();
      setBackupStatus(null);
      alert(t("err_jszip"));
    };
    document.head.appendChild(script);
  }

  // A factory reset now erases the CREDENTIALS too, and says
  // so before it runs. It used to wipe the cellar and the photo store and
  // leave behind `dropbox-rt` (a refresh token that renews indefinitely),
  // `gdrive-tk`, the three AI API keys and `gdrive-account-hint` — an e-mail
  // address. See `wipeAppStorage` for why a reset SWEEPS where an export
  // allowlists; the two rules point opposite ways on purpose.
  //
  // It RELOADS, and that is not tidiness: language, theme, mode and font
  // scale are read once pre-mount in main.jsx, and the terms gate keys on a
  // localStorage flag read at mount — so after the wipe the running app holds
  // preferences that no longer exist on disk. Same reasoning as the
  // post-restore reload. The IndexedDB clear is AWAITED first, or the reload
  // can outrun the transaction and leave the photos behind.
  function resetAll() {
    if (!window.confirm(t("confirm_reset"))) return;
    save(Object.assign({}, INIT));
    // THE WIPE IS SYNCHRONOUS AND IMMEDIATE, and that ordering is the fix
    // rather than tidiness.
    //
    // `save(INIT)` writes the emptied cellar to localStorage and sets
    // `pendingSync`, which ARMS the 1.2 s debounced `gdriveSaveQuiet` in
    // useGdriveSync. That quiet save reads the cellar out of localStorage —
    // by then INIT — and the only thing standing between it and an upload is
    // its own `lsGet("cave-autosave") !== "1"` re-check. So the flag has to
    // be gone before the timer can fire.
    //
    // It used to be wiped inside `done`, i.e. only after an AWAITED
    // `imgCache.clear()`. Clearing a photo store holding hundreds of base64
    // blobs can outlast 1.2 s on a phone, and in that window the reset
    // uploaded an EMPTY cellar over the user's cloud backup and stamped it as
    // the newest save — destroying the one copy that could undo a reset
    // tapped by mistake. `appStorage.set` writes inside its executor, so
    // `save` has already touched storage by the time this line runs; wiping
    // here leaves exactly the fresh-install state (no cellar key, no pending
    // flag) instead of resurrecting them.
    //
    // The photo clear still gates the RELOAD below: restarting over an
    // in-flight IndexedDB transaction is how blobs survive a wipe.
    wipeAppStorage();
    var done = function () {
      try { window.location.reload(); } catch (_e) { nav("home"); }
    };
    try {
      var p = imgCache.clear ? imgCache.clear() : null;
      if (p && typeof p.then === "function") p.then(done, done);
      else done();
    } catch (_e) { done(); }
  }

  // File picker now stages the parsed payload into
  // `importConfirm` instead of committing immediately. The SettingsModal
  // renders a 3-way picker (Replace / Merge / Cancel) based on the
  // staged duplicate stats, then calls `applyImport(mode)` to finalise.
  function doImportFile() {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = function (e) {
      var file = (e.target as HTMLInputElement).files![0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var d = JSON.parse((ev.target as FileReader).result as string);
          if (!isPlausibleBackup(d)) {
            alert(t("alert_json_invalid"));
            return;
          }
          stageImport(d, "file");
        } catch (err) {
          alert(t("alert_invalid_file") + ": " + (err as Error).message);
        }
      };
      // A FileReader failure is NOT the same as a file that parses badly:
      // the file moved, the media is unreadable, permission was refused. With
      // only `onload` wired the button looked dead — nothing on screen, no
      // state change, no message. `useUserCatalogue.loadCatalogueFile` has
      // handled this all along, which is what identifies the omission as an
      // oversight rather than a decision.
      reader.onerror = function () {
        try { window.alert(t ? t("err_import_failed") : "Échec de l'import du fichier."); } catch (_e) {}
      };
      reader.readAsText(file);
    };
    inp.click();
  }

  return {
    backupStatus,
    dlFile,
    doExport,
    doExportCSV,
    buildCsvLines,
    doBackupZip,
    doCollectionReport,
    doDownloadCsvTemplate,
    doImportCsvFile,
    csvIssues,
    clearCsvIssues,
    resetAll,
    doImportFile,
  };
}
