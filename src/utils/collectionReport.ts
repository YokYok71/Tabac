/**
 * Collection / insurance report.
 *
 * `buildCollectionReport(data, opts)` returns a self-contained, printable
 * HTML document string listing the whole live collection with per-item
 * purchase values and totals — the kind of itemised valuation an insurer
 * (or the user's own archive) wants. Pure + string-only: no React, no DOM,
 * no network. The hook downloads it via the existing `dlFile` blob path, so
 * the user can open it, print to PDF, or share it.
 *
 * All user-facing labels arrive pre-translated in `opts.labels` (the hook
 * assembles them from `t()`), so this module stays language-neutral and
 * testable. Every user-controlled string is HTML-escaped — the report is a
 * document the user opens in a browser, so a `<script>`-laced blend name
 * must never execute.
 *
 * Values are the recorded PURCHASE prices (the only price data the app
 * holds): tobacco = sum of its lots' prices, pipe / accessory = its price.
 * The disclaimer says so — it's an acquisition-cost baseline, not a live
 * market appraisal. Soft-deleted rows (and soft-deleted lots) are excluded,
 * matching the CSV "working snapshot" convention.
 */

import { sortByBrandThenName } from "./sortBrandName.ts";

export interface CollectionReportLabels {
  title: string;
  generated: string;
  summary: string;
  totalValue: string;
  tobaccos: string;
  pipes: string;
  accessories: string;
  colBrand: string;
  colName: string;
  colCategory: string;
  colLots: string;
  /** The weight column split in two. A single "Poids" told
   *  you how much you own; it did not say how much is still SEALED. For a
   *  document filed with an insurer that is the more useful of the two, and
   *  the app already distinguishes them everywhere else. */
  colCellar: string;
  colJar: string;
  colShape: string;
  colType: string;
  colValue: string;
  items: string;       // "articles" / "items"
  disclaimer: string;
}

export interface CollectionReportOpts {
  currencySymbol: string;
  weightUnit: string;
  dateStr: string;      // pre-formatted generation date
  labels: CollectionReportLabels;
  /** Resolver for ENUM cell values (category / shape / accessory
   *  type). Those are stored CANONICAL FRENCH, so the report printed `Anglais`,
   *  `Briquet`, `Écossais` under headers that WERE translated — an en/es/de/it
   *  user sent an insurer a document half in French. Passed IN rather than
   *  importing `xl` here, so this module stays language-neutral and string-only
   *  (its whole design premise). Defaults to identity, which keeps the
   *  pre-existing tests and any caller that does not care unchanged.
   *
   *  Why no lint rule caught it: `tabac-local/no-raw-enum-render` is scoped to
   *  the Curator VIEWS, so `src/utils/**` is unguarded — and the rule looks for
   *  a JSX container, which a hand-built HTML string is not. */
  xlEnum?: ((value: string, kind: EnumKind) => string) | undefined;
}

/** Which enum table a cell value belongs to (the caller owns the maps). */
export type EnumKind = "category" | "shape" | "accType";

function esc(v: any): string {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function num(v: any): number {
  var n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function money(n: number, sym: string): string {
  return Number(n).toFixed(2) + " " + sym;
}

function weight(n: number, unit: string): string {
  // up to 1 decimal, trailing .0 stripped
  var r = Math.round(n * 10) / 10;
  return (Number.isInteger(r) ? String(r) : Number(r).toFixed(1)) + " " + unit;
}

function notTrashed(row: any): boolean {
  return !!row && !row.deletedAt;
}

export function buildCollectionReport(data: any, opts: CollectionReportOpts): string {
  var L = opts.labels;
  var sym = opts.currencySymbol || "€";
  var wu = opts.weightUnit || "g";
  // Identity default: a caller that passes nothing gets the old behaviour.
  var xe = opts.xlEnum || function (v: string) { return v; };

  // Every section reads by BRAND then NAME. A document you print
  // and file is scanned by looking a maker up, which insertion order (the id
  // counter) does not support at any collection size. The comparator is shared
  // with the app's own list sorts, so the printed order equals the on-screen
  // one — see utils/sortBrandName.ts for why it is not written twice.
  var tobs = sortByBrandThenName(((data && data.tobaccos) || []).filter(notTrashed));
  var pipes = sortByBrandThenName(((data && data.pipes) || []).filter(notTrashed));
  var accs = sortByBrandThenName(((data && data.accessories) || []).filter(notTrashed));

  // ── tobacco rows ──────────────────────────────────────────────────────────
  var tobTotal = 0, tobCellar = 0, tobJar = 0;
  var tobRows = tobs.map(function (tb: any) {
    var lots = ((tb && tb.lots) || []).filter(notTrashed);
    var value = 0, cellarW = 0, jarW = 0;
    lots.forEach(function (l: any) {
      value += num(l.price);
      // The finished-lot rule is UNCHANGED and deliberate: weight excludes
      // them, value does not (settled with the user — the value column is an
      // acquisition-cost baseline, not a live appraisal of the shelf).
      //
      // `else` rather than `=== "cellar"`: a lot whose status is neither jar
      // nor finished still counts, as cellar. Splitting on two exact matches
      // would make a hand-edited backup silently REDUCE the reported total,
      // and unopened is both the safer reading and the `BL` template default.
      if (l.status === "finished") return;
      if (l.status === "jar") jarW += num(l.weightG);
      else cellarW += num(l.weightG);
    });
    tobTotal += value;
    tobCellar += cellarW;
    tobJar += jarW;
    return (
      "<tr><td>" + esc(tb.brand) + "</td><td>" + esc(tb.name) +
      "</td><td>" + esc(xe(String(tb.category || ""), "category")) + "</td><td class=\"n\">" + lots.length +
      "</td><td class=\"n\">" + esc(weight(cellarW, wu)) +
      "</td><td class=\"n\">" + esc(weight(jarW, wu)) +
      "</td><td class=\"n\">" + esc(money(value, sym)) + "</td></tr>"
    );
  }).join("");

  // ── pipe rows ─────────────────────────────────────────────────────────────
  var pipeTotal = 0;
  var pipeRows = pipes.map(function (p: any) {
    var value = num(p.price);
    pipeTotal += value;
    return (
      "<tr><td>" + esc(p.brand) + "</td><td>" + esc(p.name) +
      "</td><td>" + esc(xe(String(p.shape || ""), "shape")) + "</td><td class=\"n\">" + esc(money(value, sym)) + "</td></tr>"
    );
  }).join("");

  // ── accessory rows ────────────────────────────────────────────────────────
  var accTotal = 0;
  var accRows = accs.map(function (a: any) {
    var value = num(a.price);
    accTotal += value;
    return (
      "<tr><td>" + esc(a.brand) + "</td><td>" + esc(a.name) +
      "</td><td>" + esc(xe(String(a.type || ""), "accType")) + "</td><td class=\"n\">" + esc(money(value, sym)) + "</td></tr>"
    );
  }).join("");

  var grand = tobTotal + pipeTotal + accTotal;

  /**
   * `extraSubtotals` are pre-formatted cells placed just before the
   * value cell on the subtotal row, and they SHRINK the label's colspan by the
   * same count — so the row still spans the table exactly. Optional, so the
   * pipe and accessory sections are untouched.
   */
  function section(heading: string, count: number, headerCells: string[], rows: string,
                   subtotal: number, extraSubtotals?: string[]): string {
    if (count === 0) return "";
    var extra = extraSubtotals || [];
    var ths = headerCells.map(function (h, i) {
      return "<th" + (i === headerCells.length - 1 ? " class=\"n\"" : "") + ">" + esc(h) + "</th>";
    }).join("");
    var extraCells = extra.map(function (v) {
      return "<td class=\"n\">" + esc(v) + "</td>";
    }).join("");
    return (
      "<h2>" + esc(heading) + " <span class=\"count\">" + count + " " + esc(L.items) + "</span></h2>" +
      "<table><thead><tr>" + ths + "</tr></thead><tbody>" + rows +
      "<tr class=\"subtotal\"><td colspan=\"" + (headerCells.length - 1 - extra.length) + "\">" + esc(L.totalValue) +
      "</td>" + extraCells + "<td class=\"n\">" + esc(money(subtotal, sym)) + "</td></tr></tbody></table>"
    );
  }

  var style =
    "*{box-sizing:border-box}" +
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
    "color:#1c1c1c;background:#fff;margin:0;padding:32px;line-height:1.5}" +
    ".wrap{max-width:900px;margin:0 auto}" +
    "h1{font-size:26px;margin:0 0 4px}" +
    ".meta{color:#666;font-size:13px;margin:0 0 24px}" +
    "h2{font-size:18px;margin:28px 0 8px;border-bottom:2px solid #c9a24b;padding-bottom:4px}" +
    ".count{font-size:13px;color:#888;font-weight:400}" +
    "table{width:100%;border-collapse:collapse;font-size:13px;margin:0 0 8px}" +
    "th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e5e5}" +
    "th{background:#f6f2e8;font-weight:600}" +
    "td.n,th.n{text-align:right;white-space:nowrap}" +
    "tr.subtotal td{font-weight:700;border-top:2px solid #ccc;border-bottom:none}" +
    ".summary{display:flex;flex-wrap:wrap;gap:16px;margin:0 0 8px}" +
    ".summary .box{flex:1 1 140px;border:1px solid #e5e5e5;border-radius:8px;padding:12px 14px}" +
    ".summary .box .k{font-size:12px;color:#888}" +
    ".summary .box .v{font-size:20px;font-weight:700;margin-top:2px}" +
    ".grand{border-color:#c9a24b;background:#fbf7ee}" +
    ".disclaimer{margin-top:28px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px}" +
    "@media print{body{padding:0}h2{page-break-after:avoid}tr{page-break-inside:avoid}}";

  var summary =
    "<div class=\"summary\">" +
    "<div class=\"box\"><div class=\"k\">" + esc(L.tobaccos) + "</div><div class=\"v\">" + tobs.length + "</div></div>" +
    "<div class=\"box\"><div class=\"k\">" + esc(L.pipes) + "</div><div class=\"v\">" + pipes.length + "</div></div>" +
    "<div class=\"box\"><div class=\"k\">" + esc(L.accessories) + "</div><div class=\"v\">" + accs.length + "</div></div>" +
    "<div class=\"box grand\"><div class=\"k\">" + esc(L.totalValue) + "</div><div class=\"v\">" + esc(money(grand, sym)) + "</div></div>" +
    "</div>";

  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<title>" + esc(L.title) + "</title><style>" + style + "</style></head><body><div class=\"wrap\">" +
    "<h1>" + esc(L.title) + "</h1>" +
    "<p class=\"meta\">" + esc(L.generated) + " " + esc(opts.dateStr) + "</p>" +
    "<h2>" + esc(L.summary) + "</h2>" + summary +
    section(L.tobaccos, tobs.length,
      [L.colBrand, L.colName, L.colCategory, L.colLots,
       L.colCellar + " (" + wu + ")", L.colJar + " (" + wu + ")", L.colValue],
      tobRows, tobTotal,
      // The two weight totals belong on the subtotal row for the same reason
      // the split exists: how much of the cellar is still sealed is the
      // question an inventory document is asked.
      [weight(tobCellar, wu), weight(tobJar, wu)]) +
    section(L.pipes, pipes.length, [L.colBrand, L.colName, L.colShape, L.colValue], pipeRows, pipeTotal) +
    section(L.accessories, accs.length, [L.colBrand, L.colName, L.colType, L.colValue], accRows, accTotal) +
    "<p class=\"disclaimer\">" + esc(L.disclaimer) + "</p>" +
    "</div></body></html>"
  );
}
