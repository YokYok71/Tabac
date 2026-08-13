/**
 * Integration tests for useExportImport hook.
 *
 * The export/import logic (imageData filter, gatherLocalImages, withPhotos,
 * import processing) is already covered via mirrors in exportImport.test.ts.
 * buildCsvLines is covered in buildCsvLines.test.ts.
 *
 * This file covers hook-level integration that the mirrors cannot test:
 *   A. doExport  — excludeApiKey toggle, withPhotos integration
 *   B. resetAll  — confirm dialog and nav behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useExportImport } from "../hooks/useExportImport";
import { INIT } from "../constants";
import { parseTobaccoCsv } from "../utils/csvImport";
import { checkAllInvariants } from "../utils/lotInvariants";
import { buildCatalogueTemplateCsv } from "../utils/userCatalogue";

function makeProps(overrides: Record<string, any> = {}) {
  return {
    data: { ...INIT },
    save: vi.fn(),
    withPhotos: vi.fn().mockImplementation((d: any) => Promise.resolve(d)),
    nav: vi.fn(),
    t: (k: string) => k,
    excludeApiKey: false,
    apiKey: "sk-test-key",
    weightUnit: "g",
    lengthUnit: "mm",
    ageLabel: () => "",
    stageImport: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // dlFile creates an <a> and calls URL.createObjectURL — stub both.
  (globalThis as any).URL.createObjectURL = vi.fn().mockReturnValue("blob:fake");
  (globalThis as any).URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── A0. doExport / doBackupZip — error surfacing ──────────────────
// withPhotos rejection (broken IndexedDB) used to vanish: no alert, no
// file, no status change — the user believed the export had succeeded.

describe("doExport / doBackupZip — withPhotos rejection surfaces an error", () => {
  it("doExport alerts with err_export_failed when withPhotos rejects", async () => {
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const withPhotos = vi.fn().mockRejectedValue(new Error("IDB broken"));
    const props = makeProps({ withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doExport(); });
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const msg = String(alertSpy.mock.calls[0]![0]);
    expect(msg).toContain("err_export_failed");
    expect(msg).toContain("IDB broken");
  });

  it("doBackupZip alerts and resets backupStatus when withPhotos rejects", async () => {
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    // JSZip must be present so the guard passes before withPhotos runs.
    (window as any).JSZip = function () { return { file: vi.fn(), folder: vi.fn() }; };
    const withPhotos = vi.fn().mockRejectedValue(new Error("IDB broken"));
    const props = makeProps({ withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doBackupZip(); });
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(String(alertSpy.mock.calls[0]![0])).toContain("err_export_failed");
    await waitFor(() => expect(result.current.backupStatus).toBeNull());
    delete (window as any).JSZip;
  });
});

// ── A. doExport ───────────────────────────────────────────────────────────────

describe("doExport — excludeApiKey toggle and withPhotos integration", () => {
  it("passes _apiKey to withPhotos when excludeApiKey=false", async () => {
    const withPhotos = vi.fn().mockResolvedValue({});
    const props = makeProps({ apiKey: "sk-real", excludeApiKey: false, withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doExport(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalled());
    const arg = withPhotos.mock.calls[0]![0];
    expect(arg._apiKey).toBe("sk-real");
  });

  it("passes _apiKey: '' to withPhotos when excludeApiKey=true", async () => {
    const withPhotos = vi.fn().mockResolvedValue({});
    const props = makeProps({ apiKey: "sk-real", excludeApiKey: true, withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doExport(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalled());
    const arg = withPhotos.mock.calls[0]![0];
    expect(arg._apiKey).toBe("");
  });

  it("passes _apiKey: '' when apiKey prop is an empty string", async () => {
    const withPhotos = vi.fn().mockResolvedValue({});
    const props = makeProps({ apiKey: "", excludeApiKey: false, withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doExport(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalled());
    const arg = withPhotos.mock.calls[0]![0];
    expect(arg._apiKey).toBe("");
  });

  it("calls withPhotos with all original data fields present", async () => {
    const withPhotos = vi.fn().mockResolvedValue({});
    const data = { ...INIT, tobaccos: [{ id: 1, name: "T" }] };
    const props = makeProps({ data, withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doExport(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalled());
    const arg = withPhotos.mock.calls[0]![0];
    expect(arg.tobaccos).toEqual(data.tobaccos);
    expect(arg.pipes).toEqual(data.pipes);
  });

  it("does not mutate the original data prop", async () => {
    const withPhotos = vi.fn().mockResolvedValue({});
    const data = { ...INIT };
    const props = makeProps({ data, withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doExport(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalled());
    expect((data as any)._apiKey).toBeUndefined();
  });

  // Every export embeds a `_schemaVersion` stamp so future
  // migrations can branch precisely instead of guessing the layout.
  it("stamps _schemaVersion on the payload passed to withPhotos", async () => {
    const withPhotos = vi.fn().mockResolvedValue({});
    const props = makeProps({ withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doExport(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalled());
    const payload = withPhotos.mock.calls[0]![0];
    expect(payload._schemaVersion).toBe("v6");
  });

  // soft-deleted rows ARE part of the JSON / Drive backup so
  // restore restores the trash too — the user keeps their 30-day safety
  // net across reinstall, device migration, accidental wipe. (Only the
  // CSV strips the trash; that's covered in buildCsvLines.test.ts.)
  it("keeps deletedAt rows in the JSON export payload", async () => {
    const withPhotos = vi.fn().mockResolvedValue({});
    const data = {
      ...INIT,
      tobaccos: [
        { id: 1, name: "Alive", brand: "X", lots: [] },
        { id: 2, name: "Trashed", brand: "Y", lots: [],
          deletedAt: "2026-05-15T10:00:00Z" },
      ],
      pipes: [
        { id: 3, name: "TrashedPipe", brand: "Z",
          deletedAt: "2026-05-15T10:00:00Z" },
      ],
    };
    const props = makeProps({ data, withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doExport(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalled());
    const arg = withPhotos.mock.calls[0]![0];
    expect(arg.tobaccos).toHaveLength(2);
    expect(arg.tobaccos.find((t: any) => t.id === 2).deletedAt).toBeTruthy();
    expect(arg.pipes).toHaveLength(1);
    expect(arg.pipes[0].deletedAt).toBeTruthy();
  });
});

// ── B. resetAll ───────────────────────────────────────────────────────────────

describe("resetAll — confirmation dialog and navigation", () => {
  it("calls save(INIT) when user confirms", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const save = vi.fn();
    const nav = vi.fn();
    const props = makeProps({ save, nav });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.resetAll(); });
    expect(save).toHaveBeenCalledOnce();
    const savedArg = (save as any).mock.calls[0]![0];
    expect(savedArg.tobaccos).toEqual(INIT.tobaccos);
    expect(savedArg.sessions).toEqual(INIT.sessions);
    // REVERSED: this used to assert nav("home"). The reset now
    // RELOADS instead — after wiping every preference key the running app
    // holds a language, theme and terms flag that no longer exist on disk
    // (main.jsx reads those once, pre-mount). `nav("home")` survives only as
    // the fallback for an environment that refuses to reload.
    expect(nav).not.toHaveBeenCalledWith("home");
  });

  it("does not call save when user cancels the confirm dialog", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const save = vi.fn();
    const props = makeProps({ save });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.resetAll(); });
    expect(save).not.toHaveBeenCalled();
  });

  it("does not navigate when user cancels the confirm dialog", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const nav = vi.fn();
    const props = makeProps({ nav });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.resetAll(); });
    expect(nav).not.toHaveBeenCalled();
  });
});

// ── doCollectionReport ───────────────────────────────────────────
describe("doCollectionReport", () => {
  // `markExported` now waits for the download to actually
  // happen, so this case awaits a microtask. A dismissed share sheet must not
  // disarm the 30-day backup reminder — see the block at the end.
  it("downloads an HTML report named cave-tabac-rapport-* and marks exported", async () => {
    // Capture the anchor download name + the blob passed to createObjectURL.
    let blob: any = null;
    (globalThis as any).URL.createObjectURL = vi.fn().mockImplementation((b: any) => { blob = b; return "blob:fake"; });
    const created: any[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: any) => {
      const el = origCreate(tag);
      if (tag === "a") created.push(el);
      return el;
    });
    const markExported = vi.fn();
    const props = makeProps({
      currencySymbol: "€",
      data: { ...INIT, pipes: [{ id: 1, brand: "Halvorsen", name: "Sherlock", shape: "Billiard", price: "80" }] },
      markExported,
    });
    const { result } = renderHook(() => useExportImport(props as any));
    await act(async () => { result.current.doCollectionReport(); await Promise.resolve(); await Promise.resolve(); });

    expect(markExported).toHaveBeenCalledOnce();
    expect(blob).toBeTruthy();
    expect(blob.type).toContain("text/html");
    const a = created[created.length - 1];
    expect(a.download).toMatch(/^cave-tabac-rapport-\d{8}\.html$/);
  });
});

// ── CSV template + import ────────────────────────────────────────
describe("doDownloadCsvTemplate", () => {
  it("downloads cave-tabac-modele.csv with a header + example rows", () => {
    let blob: any = null;
    (globalThis as any).URL.createObjectURL = vi.fn().mockImplementation((b: any) => { blob = b; return "blob:fake"; });
    const created: any[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: any) => {
      const el = origCreate(tag);
      if (tag === "a") created.push(el);
      return el;
    });
    const props = makeProps({ currencySymbol: "€", weightUnit: "g" });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doDownloadCsvTemplate(); });
    expect(blob).toBeTruthy();
    expect(blob.type).toContain("text/csv");
    const a = created[created.length - 1];
    expect(a.download).toBe("cave-tabac-modele.csv");
  });

  // ──────────────────────────────────────────────────────────────────────
  // Importing the app's OWN template turned the Settings → Diagnostic panel red.
  // The template had a `Statut = Pot` example row and no "Date mise en pot"
  // column, so the lot arrived opened-with-no-opening-date and tripped
  // `jar-has-dateOpened` at the next save() — on the exact path the help
  // documents: download the template, fill it, import it. This drives the REAL
  // shipped template through the REAL parser and the REAL invariants, because
  // asserting the header list would have passed the day the parser regressed.
  it("round-trips through the parser with ZERO invariant violations", () => {
    let text = "";
    // jsdom Blobs expose no synchronous text(), so the payload is captured from
    // the Blob constructor below.
    (globalThis as any).URL.createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const props = makeProps({ currencySymbol: "€", weightUnit: "g" });
    const { result } = renderHook(() => useExportImport(props as any));
    // dlFile is internal, so capture the payload from the Blob constructor.
    const RealBlob = globalThis.Blob;
    (globalThis as any).Blob = class extends RealBlob {
      constructor(parts: any[], o: any) { super(parts, o); text = String(parts[0]); }
    };
    act(() => { result.current.doDownloadCsvTemplate(); });
    (globalThis as any).Blob = RealBlob;

    expect(text, "captured the template").toContain("Marque");
    const parsed = parseTobaccoCsv(text, { todayIso: "2026-07-30" });
    expect(parsed.tobaccos.length).toBe(1);
    expect(parsed.lots).toBe(2);
    const payload: any = {
      ...INIT, tobaccos: parsed.tobaccos,
      pipes: [], accessories: [], wishlist: [], sessions: [],
    };
    const v = checkAllInvariants(payload);
    expect(v.map((x: any) => x.rule), JSON.stringify(v)).toEqual([]);
  });

  it("attributes no rating or prose to a real blend — this file is DISTRIBUTED", () => {
    // The template used to ship `Halvorsen | Early Tide` carrying a full
    // attribute set: category, cut, Force 3 / Room Note 2 / Taste 3, a personal
    // rating of 4, an ageing ceiling, a description and a tasting note. Naming
    // a real product is fine and is done deliberately elsewhere (the form
    // placeholders, the guide's fuzzy-match examples); ATTRIBUTING ratings and
    // prose to it is not — a plausible triplet beside a real name reads as a
    // catalogue row whether the numbers were researched or invented, and every
    // user downloads this file.
    let text = "";
    const RealBlob = globalThis.Blob;
    (globalThis as any).Blob = class extends RealBlob {
      constructor(parts: any[], o: any) { super(parts, o); text = String(parts[0]); }
    };
    const props = makeProps({ currencySymbol: "€", weightUnit: "g" });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doDownloadCsvTemplate(); });
    (globalThis as any).Blob = RealBlob;

    // Non-vacuity: the rating columns really are populated, so the check below
    // is about WHOSE blend they describe and not about an empty template.
    // csvEsc quotes cells, so unwrap before comparing.
    const unq = (s: string) => String(s).replace(/^"|"$/g, "").replace(/""/g, '"');
    const rows = text.trim().split("\r\n").slice(1).map((r) => r.split(";").map(unq));
    expect(rows.length).toBe(2);
    expect(rows[0]![4]).toBe("3");   // Force
    expect(rows[0]![7]).toBe("4");   // Note (a personal judgement)

    // The identity columns must not name a real product.
    const REAL = /peterson|university flake|solani|capstan|cornell|pease|gawith|esoterica|dunhill|orlik|sutliff|rattray|mac ?baren|nightcap|wessex|penzance|stonehaven|escudo|haunted bookshop/i;
    for (const r of rows) {
      expect(REAL.test(String(r[0])), `brand: ${r[0]}`).toBe(false);
      expect(REAL.test(String(r[1])), `blend: ${r[1]}`).toBe(false);
    }
    // …and it speaks the same invented vocabulary as the catalogue template,
    // so the two downloads cannot drift into naming different things.
    expect(buildCatalogueTemplateCsv()).toContain(String(rows[0]![0]));
  });

  it("demonstrates the lifecycle columns rather than relying on the repair", () => {
    // The template's own comment promises "the same header shape the export
    // uses" — and it omitted these two, which is how the Pot row shipped
    // date-less. The parser back-fill is the safety net for a HAND-built file.
    let text = "";
    const RealBlob = globalThis.Blob;
    (globalThis as any).Blob = class extends RealBlob {
      constructor(parts: any[], o: any) { super(parts, o); text = String(parts[0]); }
    };
    const props = makeProps({ currencySymbol: "€", weightUnit: "g" });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doDownloadCsvTemplate(); });
    (globalThis as any).Blob = RealBlob;
    expect(text).toContain("Date mise en pot");
    expect(text).toContain("Date fin");
    const parsed = parseTobaccoCsv(text, { todayIso: "2026-07-30" });
    const jar = parsed.tobaccos[0]!.lots.find((l: any) => l.status === "jar");
    // The value came from the FILE, not from the back-fill.
    expect(jar!.dateOpened).toBe("2025-06-01");
  });
});

describe("doImportCsvFile", () => {
  it("merges parsed tobaccos via stageImport(autoApply:merge)", async () => {
    const stageImport = vi.fn();
    const markExported = vi.fn();
    vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const props = makeProps({ stageImport, markExported });
    const { result } = renderHook(() => useExportImport(props as any));

    // Stub the file input + FileReader so onchange/onload fire with CSV text.
    const csv = "Marque;Nom;Statut;Poids (g)\nBrackwater;Duskfall;Pot;25";
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null;
      result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;

    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });

    expect(stageImport).toHaveBeenCalledOnce();
    const [payload, source, options] = stageImport.mock.calls[0]!;
    expect(source).toBe("file");
    expect(options.autoApply).toBe("merge");
    expect(typeof options.onMerged).toBe("function"); // merge recap callback
    expect(payload.tobaccos).toHaveLength(1);
    expect(payload.tobaccos[0].brand).toBe("Brackwater");
    expect(payload.pipes).toBeUndefined();   // tobaccos-only payload → merge preserves other kinds
    // ── REVERSAL, recorded so it is not "fixed" back ──
    // This used to assert markExported WAS called. An import is not a backup:
    // `markExported` bumps `cave-last-export-ts` and silences the "you have not
    // backed up in a while" reminder for 30 days — immediately after the data
    // CHANGED, which is exactly when that reminder is most warranted. The
    // reminder is about the cellar leaving the device, and nothing left it here.
    expect(markExported, "an import must not disarm the backup reminder").not.toHaveBeenCalled();
  });

  // ── The fail-closed front door, on the JSON side ────────────────────
  //
  // An earlier release audit: `doImportFile` refuses a file that is not a plausible
  // backup instead of staging it, and deleting that check left all 3754 tests
  // green. `useImportConfirm.stageImport` has the same guard as a last line of
  // defence, so the damage is bounded — but the two are separate checks with
  // separate messages, and the whole point of the outer one is that the user
  // is told "this is not a backup" while holding the file picker, rather than
  // watching a picker open on a payload full of zeroes.
  it("refuses a JSON file that is not a plausible backup (front door)", () => {
    const stageImport = vi.fn();
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const props = makeProps({ stageImport });
    const { result } = renderHook(() => useExportImport(props as any));

    // Valid JSON, plainly not a cellar: a Drive error envelope is the shape a
    // user most plausibly saves by accident.
    const notABackup = JSON.stringify({ error: { code: 401, message: "Unauthorized" } });
    const fakeInput: any = { click: vi.fn(), files: [new Blob([notABackup])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null;
      result: any = null;
      readAsText() { this.result = notABackup; if (this.onload) this.onload({ target: this }); }
    }
    (globalThis as any).FileReader = FakeReader;

    act(() => { result.current.doImportFile(); });
    act(() => { fakeInput.onchange({ target: fakeInput }); });

    expect(stageImport).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("alert_json_invalid");
  });

  it("stages a well-formed backup file (the front door is not simply shut)", () => {
    // The other half: a guard that refuses everything would pass the test
    // above and break the feature.
    const stageImport = vi.fn();
    vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const props = makeProps({ stageImport });
    const { result } = renderHook(() => useExportImport(props as any));

    const backup = JSON.stringify({
      tobaccos: [{ id: 1, brand: "Halvorsen", name: "Duskfall", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    });
    const fakeInput: any = { click: vi.fn(), files: [new Blob([backup])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null;
      result: any = null;
      readAsText() { this.result = backup; if (this.onload) this.onload({ target: this }); }
    }
    (globalThis as any).FileReader = FakeReader;

    act(() => { result.current.doImportFile(); });
    act(() => { fakeInput.onchange({ target: fakeInput }); });

    expect(stageImport).toHaveBeenCalledOnce();
    expect(stageImport.mock.calls[0]![1]).toBe("file");
  });

  // ── every CSV lot id is re-stamped from monotonicId ──────────
  //
  // An earlier release audit: this fix had no lock. Deleting the re-stamp line left all
  // 3754 tests green, and the consequence is the one the comment
  // spells out: `parseTobaccoCsv` is deliberately PURE and deterministic (it is
  // fuzzed), so it mints lot ids from a FIXED base — two separate CSV imports
  // hand back the SAME lot id under different tobaccos. Lot ids are assumed
  // globally unique app-wide, and the trash operations sweep by lot id ACROSS
  // all tobaccos: permanently deleting one blend's trashed lot then also
  // hard-deletes a different blend's LIVE lot, and the 30-day auto-sweep
  // orphans its sessions with no user action at all.
  //
  // The existing coverage could not see it — csvImport.test.ts tests the pure
  // parser (whose determinism is the POINT), and the hook test above asserts
  // the payload's brand, not its ids. The collision only exists ACROSS two
  // imports, so it takes two.
  function importCsvOnce(result: any, csv: string) {
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null;
      result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;
    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });
  }

  it("mints a FRESH lot id on every CSV import — two imports never collide", () => {
    const stageImport = vi.fn();
    vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const props = makeProps({ stageImport });
    const { result } = renderHook(() => useExportImport(props as any));

    importCsvOnce(result, "Marque;Nom;Statut;Poids (g)\nBrackwater;Duskfall;Pot;25");
    importCsvOnce(result, "Marque;Nom;Statut;Poids (g)\nHalvorsen;Irish Flake;Cave;50");

    expect(stageImport).toHaveBeenCalledTimes(2);
    const first = stageImport.mock.calls[0]![0].tobaccos[0].lots[0].id;
    const second = stageImport.mock.calls[1]![0].tobaccos[0].lots[0].id;
    expect(first).toBeTypeOf("number");
    expect(second).toBeTypeOf("number");
    // THE assertion: two different blends imported from two different files
    // must not share a lot id. Without the re-stamp both are the parser's
    // fixed base and this is an equality.
    expect(second).not.toBe(first);
  });

  it("mints a distinct id for every lot INSIDE one CSV import too", () => {
    const stageImport = vi.fn();
    vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const props = makeProps({ stageImport });
    const { result } = renderHook(() => useExportImport(props as any));

    // Two blends, three lots (the CSV is one row per lot, tobacco repeated).
    importCsvOnce(
      result,
      [
        "Marque;Nom;Statut;Poids (g)",
        "Brackwater;Duskfall;Pot;25",
        "Brackwater;Duskfall;Cave;50",
        "Halvorsen;Irish Flake;Cave;100",
      ].join("\n"),
    );

    const payload = stageImport.mock.calls[0]![0];
    const ids = payload.tobaccos.flatMap((tb: any) => tb.lots.map((l: any) => l.id));
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    // Every id must be a real minted id, never a falsy/zero placeholder — the
    // trash sweep matches on id, so a 0 would collide with every other 0.
    ids.forEach((id: any) => expect(id).toBeTruthy());
  });

  it("surfaces the 'already up to date' note when a CSV row matches an existing blend with no new lot", () => {
    const stageImport = vi.fn();
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    // Local already has Brackwater · Duskfall → the merge would skip it (add-only).
    const props = makeProps({
      stageImport, t: (k: string) => k,
      data: { ...INIT, tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [] }] },
    });
    const { result } = renderHook(() => useExportImport(props as any));
    const csv = "Marque;Nom;Statut;Poids (g)\nBrackwater;Duskfall;Pot;25";
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;

    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });

    expect(stageImport).toHaveBeenCalledOnce();
    const alertText = String(alertSpy.mock.calls[alertSpy.mock.calls.length - 1]![0]);
    // ── REVERSAL, recorded here so it is not "fixed" back ──
    // This case used to assert the opposite, and its own comment explained why:
    // "stageImport is mocked here, so onMerged never fires (_summary stays null)
    // → the matched row counts as already up to date". That fallback was the
    // DEFECT — the count was recomputed by dupKey against live rows, which knew
    // nothing about what the merge had done, so a row the merge REFUSED to match
    // (several local fiches share that brand+name) was reported as "already
    // present, no new lot" while a complete duplicate had just been created.
    // The recap now reports only what the merge tells it, so with no summary it
    // claims NOTHING. The line is still produced in production, where the
    // summary always arrives — see the two cases below, which drive onMerged.
    expect(alertText).not.toContain("csv_import_uptodate");
  });

  it("says 'already up to date' when the MERGE reports a matched row", () => {
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    // The mock plays the merge's part: one staged row matched, nothing added.
    const stageImport = vi.fn((_p: any, _s: any, opts: any) => {
      opts.onMerged({ tobaccosMatched: 1, blendsToppedUp: 0, entitiesUpdated: 0, lotsAppended: 0, identityConflicts: 0, trashedSkipped: 0, sessionsUpdated: 0, tobaccosAdded: 0 });
    });
    const props = makeProps({
      stageImport, t: (k: string) => k,
      data: { ...INIT, tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [] }] },
    });
    const { result } = renderHook(() => useExportImport(props as any));
    const csv = "Marque;Nom;Statut;Poids (g)\nBrackwater;Duskfall;Pot;25";
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;
    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });
    const alertText = String(alertSpy.mock.calls[alertSpy.mock.calls.length - 1]![0]);
    expect(alertText).toContain("csv_import_uptodate");
  });

  it("reports the DUPLICATE instead of 'already present' when the merge refused", () => {
    // The reported defect: a row the merge could not attach to any of several
    // same-name fiches is added as a visible duplicate. Calling that "already
    // present, no new lot" is how the duplication went on compounding.
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const stageImport = vi.fn((_p: any, _s: any, opts: any) => {
      opts.onMerged({ tobaccosMatched: 0, blendsToppedUp: 0, entitiesUpdated: 0, lotsAppended: 0, identityConflicts: 1, trashedSkipped: 0, sessionsUpdated: 0, tobaccosAdded: 1 });
    });
    const props = makeProps({
      stageImport, t: (k: string) => k,
      data: { ...INIT, tobaccos: [
        { id: 1, brand: "Brackwater", name: "Duskfall", lots: [] },
        { id: 2, brand: "Brackwater", name: "Duskfall", lots: [] },
      ] },
    });
    const { result } = renderHook(() => useExportImport(props as any));
    const csv = "Marque;Nom;Statut;Poids (g)\nBrackwater;Duskfall;Pot;25";
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;
    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });
    const alertText = String(alertSpy.mock.calls[alertSpy.mock.calls.length - 1]![0]);
    expect(alertText).toContain("merge_recap_identity");
    expect(alertText).not.toContain("csv_import_uptodate");
  });

  it("does NOT surface the matched note when all CSV rows are new blends", () => {
    const stageImport = vi.fn();
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const props = makeProps({ stageImport, t: (k: string) => k, data: { ...INIT, tobaccos: [] } });
    const { result } = renderHook(() => useExportImport(props as any));
    const csv = "Marque;Nom;Statut;Poids (g)\nBrackwater;Duskfall;Pot;25";
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;

    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });

    const alertText = String(alertSpy.mock.calls[alertSpy.mock.calls.length - 1]![0]);
    expect(alertText).not.toContain("csv_import_uptodate");
  });

  it("alerts and does not import when the CSV has no valid tobacco", () => {
    const stageImport = vi.fn();
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const props = makeProps({ stageImport, t: (k: string) => k });
    const { result } = renderHook(() => useExportImport(props as any));

    const csv = "Prix;Poids\n10;20";   // no brand/name column
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;

    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });

    expect(stageImport).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("csv_import_empty");
  });

  it("shows the JSON-backup message when a JSON file is fed to the CSV importer", () => {
    const stageImport = vi.fn();
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const props = makeProps({ stageImport, t: (k: string) => k });
    const { result } = renderHook(() => useExportImport(props as any));

    const json = '{"tobaccos":[{"id":1,"brand":"Brackwater","name":"Duskfall"}],"pipes":[]}';
    const fakeInput: any = { click: vi.fn(), files: [new Blob([json])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = json; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;

    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });

    expect(stageImport).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("csv_import_json");
  });

  it("imports the tabac section and warns when given the multi-section export CSV", () => {
    const stageImport = vi.fn();
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const props = makeProps({ stageImport, t: (k: string) => k });
    const { result } = renderHook(() => useExportImport(props as any));

    const csv = "Marque;Nom;Statut;Poids (g)\nBrackwater;Duskfall;Pot;25\n=== PIPES ===\nHalvorsen;Sherlock;Billiard;80";
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;

    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });

    // only the tabac section imported
    expect(stageImport).toHaveBeenCalledOnce();
    expect(stageImport.mock.calls[0]![0].tobaccos).toHaveLength(1);
    // the success alert carries the "sections" note
    const ac = alertSpy.mock.calls;
    const msg = String(ac[ac.length - 1]![0]);
    expect(msg).toContain("csv_import_sections");
  });
});


// export→import round-trip. buildCsvLines(rich data) → parseTobaccoCsv
// must recover the tobacco fields, locking the export/import column contract
// against future drift (in BOTH fr and en date formats).

function richData() {
  return {
    ...INIT,
    tobaccos: [{
      id: 1, brand: "Halvorsen", name: "Early Tide", category: "Virginia/Burley",
      blend: "VaBur", cut: "Flake", force: 3, roomNote: 2, taste: 4, rating: 5,
      rebuy: true, agingMax: "12", description: "Desc", tastingNotes: "TN", imageUrl: "",
      lots: [
        { id: 10, status: "jar", weightG: "40", weightInitial: "50", originalStatus: "cellar",
          datePurchased: "2024-03-15", dateProduction: "2022", dateOpened: "2024-06-01",
          price: "14.5", seller: "Shop", sellerUrl: "https://shop.example",
          boxNumber: "A12", storageLocation: "Armoire A", disposed: false },
        { id: 11, status: "finished", weightG: "0", weightInitial: "100",
          dateFinished: "2023-01-01", price: "10", disposed: true },
      ],
    }],
  };
}

describe("CSV export → import round-trip", () => {
  function roundTrip(dateFormat: string) {
    const props = makeProps({ data: richData(), weightUnit: "g", currencySymbol: "€",
      dateFormat, ageLabel: () => "" });
    const { result } = renderHook(() => useExportImport(props as any));
    const lines: string[] = result.current.buildCsvLines();
    // parseTobaccoCsv stops at the "=== PIPES ===" marker, so feeding the whole
    // multi-section export only re-reads the tobacco block.
    return parseTobaccoCsv(lines.join("\n"));
  }

  it("recovers every tobacco + lot field (fr date format)", () => {
    const r = roundTrip("fr");
    expect(r.tobaccos).toHaveLength(1);
    const t = r.tobaccos[0];
    expect(t.brand).toBe("Halvorsen");
    expect(t.name).toBe("Early Tide");
    expect(t.category).toBe("Virginia/Burley");
    expect(t.cut).toBe("Flake");
    expect([t.force, t.roomNote, t.taste, t.rating]).toEqual([3, 2, 4, 5]);
    expect(t.rebuy).toBe(true);
    expect(t.agingMax).toBe("12");
    expect(t.description).toBe("Desc");
    expect(t.tastingNotes).toBe("TN");
    expect(t.lots).toHaveLength(2);
    const [l1, l2] = t.lots;
    expect(l1.status).toBe("jar");
    expect(l1.weightG).toBe("40");
    expect(l1.weightInitial).toBe("50");
    expect(l1.datePurchased).toBe("2024-03-15");
    expect(l1.dateProduction).toBe("2022");
    expect(l1.dateOpened).toBe("2024-06-01");
    expect(l1.price).toBe("14.5");
    expect(l1.seller).toBe("Shop");
    expect(l1.sellerUrl).toBe("https://shop.example");
    expect(l1.boxNumber).toBe("A12");
    expect(l1.storageLocation).toBe("Armoire A");
    expect(l1.disposed).toBe(false);
    expect(l2.status).toBe("finished");
    expect(l2.dateFinished).toBe("2023-01-01");
    expect(l2.disposed).toBe(true);
    expect(l2.price).toBe("10");
  });

  it("round-trips lot dates in en date format too", () => {
    const r = roundTrip("en");
    const l1 = r.tobaccos[0].lots[0];
    expect(l1.datePurchased).toBe("2024-03-15");
    expect(l1.dateOpened).toBe("2024-06-01");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// dlFile fired navigator.share fire-and-forget and returned — no await, no
// fallback, no signal — while every caller unconditionally called markExported(),
// which bumps cave-last-export-ts and suppresses the "you have not backed up"
// reminder for 30 days. doBackupZip additionally set backupStatus = st_done, a
// false success message. On iOS, where canShare({files}) is true, this is the ONLY
// export path — so dismissing the share sheet, an entirely routine gesture,
// silently disarmed the app's own backup safety net.
describe("a dismissed share sheet is not an export", () => {
  const withShare = (impl: () => Promise<any>) => {
    (navigator as any).canShare = () => true;
    (navigator as any).share = vi.fn(impl);
    (globalThis as any).File = class { constructor(_p: any, _n: any, _o: any) {} } as any;
  };
  const clearShare = () => {
    delete (navigator as any).share;
    delete (navigator as any).canShare;
  };

  afterEach(() => { clearShare(); });

  it("does NOT mark the cellar exported when the user dismisses the sheet", async () => {
    const err: any = new Error("cancelled"); err.name = "AbortError";
    withShare(() => Promise.reject(err));
    const markExported = vi.fn();
    const props = makeProps({ markExported, t: (k: string) => k });
    const { result } = renderHook(() => useExportImport(props as any));
    await act(async () => { result.current.doExportCSV(); await Promise.resolve(); await Promise.resolve(); });
    expect(markExported, "a cancelled share must not disarm the reminder").not.toHaveBeenCalled();
  });

  it("marks it exported when the share succeeds", async () => {
    withShare(() => Promise.resolve());
    const markExported = vi.fn();
    const props = makeProps({ markExported, t: (k: string) => k });
    const { result } = renderHook(() => useExportImport(props as any));
    await act(async () => { result.current.doExportCSV(); await Promise.resolve(); await Promise.resolve(); });
    expect(markExported).toHaveBeenCalled();
  });

  it("falls back to a download when the share FAILS rather than is cancelled", async () => {
    // Losing the export because the share mechanism is broken would be the worse
    // outcome — but a deliberate dismissal must not produce a surprise second
    // artifact, which is why AbortError is treated differently.
    withShare(() => Promise.reject(new Error("NotAllowedError")));
    const markExported = vi.fn();
    const created: any[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: any) => {
      const el = origCreate(tag);
      if (tag === "a") created.push(el);
      return el;
    });
    (globalThis as any).URL.createObjectURL = vi.fn().mockReturnValue("blob:fake");
    (globalThis as any).URL.revokeObjectURL = vi.fn();
    const props = makeProps({ markExported, t: (k: string) => k });
    const { result } = renderHook(() => useExportImport(props as any));
    await act(async () => { result.current.doExportCSV(); await Promise.resolve(); await Promise.resolve(); });
    expect(created.length, "the anchor download must still run").toBeGreaterThan(0);
    expect(markExported).toHaveBeenCalled();
  });

  it("the ZIP shows no '✓ OK' for a cancelled share either", async () => {
    const err: any = new Error("cancelled"); err.name = "AbortError";
    withShare(() => Promise.reject(err));
    const setBackupStatus = vi.fn();
    const markExported = vi.fn();
    (window as any).JSZip = function () {
      return {
        folder: () => ({ file: vi.fn() }),
        file: vi.fn(),
        generateAsync: () => Promise.resolve(new Blob(["zip"])),
      };
    };
    const props = makeProps({
      setBackupStatus, markExported, t: (k: string) => k,
      withPhotos: (d: any) => Promise.resolve(d),
      data: { ...INIT },
    });
    const { result } = renderHook(() => useExportImport(props as any));
    await act(async () => {
      result.current.doBackupZip();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    delete (window as any).JSZip;
    expect(markExported).not.toHaveBeenCalled();
    expect(setBackupStatus.mock.calls.map((c) => c[0])).not.toContain("st_done");
  });
});

describe("the CSV import says what it could not read", () => {
  // Drives the REAL hook through the REAL parser. What is being locked is the
  // WIRING: `skipped` was computed by the parser and read by
  // nobody, so the recap reported the same success for a file that had lost
  // rows as for a clean one — the lesson, one importer over.
  function runImport(csv: string, extra: Record<string, any> = {}) {
    const setImportRecap = vi.fn();
    const stageImport = vi.fn();
    const props = makeProps({ stageImport, setImportRecap, ...extra });
    const { result } = renderHook(() => useExportImport(props as any));
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;
    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });
    return { result, setImportRecap };
  }

  const HEAD = "Marque,Nom,Categorie,Coupe,Poids (g)";
  const GOOD = "Halvorsen,Duskfall,Anglais,Ribbon,50";

  it("the recap points at the panel — ONE line, no counts", () => {
    // The counts live in the panel, which `keepModalOpen` guarantees is on
    // screen whenever this line appears. Measured at 360 px in German at "L",
    // the first version's two count paragraphs made the toast cover the
    // Settings modal — while telling the reader to look at a panel behind it.
    const { setImportRecap } = runImport([HEAD, GOOD, ",,Anglais,Ribbon,50", "Vondel,633,Pipeweed,Zigzag Cut,50"].join("\n"));
    const msg = String(setImportRecap.mock.calls[0]![0].msg);
    expect(msg).toContain("csv_import_issues");
    expect(msg.split("csv_import_issues").length - 1, "said once").toBe(1);
  });

  it("keeps the Settings modal open, or the panel is unreachable", () => {
    // Found by driving the real file picker in a browser: `_runImport` closes
    // the modal for a "file" source, so the panel rendered perfectly into a
    // tab that had just shut. No test could see it — the panel renders fine in
    // isolation.
    const stageImport = vi.fn();
    const props = makeProps({ stageImport, setImportRecap: vi.fn() });
    const { result } = renderHook(() => useExportImport(props as any));
    const csv = [HEAD, GOOD, ",,Anglais,Ribbon,50"].join("\n");
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;
    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });
    expect(stageImport.mock.calls[0]![2].keepModalOpen).toBe(true);
  });

  it("…and closes it as before when there is nothing to show", () => {
    // The happy path stays byte-identical: the recap's "Voir" chip takes you
    // to your tobaccos, which is where you want to be after a clean import.
    const stageImport = vi.fn();
    const props = makeProps({ stageImport, setImportRecap: vi.fn() });
    const { result } = renderHook(() => useExportImport(props as any));
    const csv = [HEAD, GOOD].join("\n");
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;
    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });
    expect(stageImport.mock.calls[0]![2].keepModalOpen).toBe(false);
  });

  it("raises the row-level panel, with the exact counts", () => {
    const { result } = runImport([HEAD, GOOD, ",,Anglais,Ribbon,50", "Vondel,633,Pipeweed,Zigzag Cut,50"].join("\n"));
    const ci = result.current.csvIssues;
    expect(ci, "no panel payload").toBeTruthy();
    expect(ci.skipped).toBe(1);
    expect(ci.badCategory).toBe(1);
    expect(ci.badCut).toBe(1);
    expect(ci.issues.map((i: any) => i.row).sort()).toEqual([3, 4, 4]);
  });

  it("a COERCION alone keeps the modal open and points at the panel", () => {
    // `_hasIssues` is `skipped > 0 || coerced > 0`, and every fixture until now
    // coupled the two — so a probe deleting the coercion term left the WHOLE
    // suite green. A file whose rows all have an identity but whose taxonomy
    // the app cannot read is the ordinary case for a spreadsheet exported from
    // another app, and it is exactly the one the panel exists for.
    const { result, setImportRecap } = runImport(
      [HEAD, GOOD, "Vondel,633,Pipeweed,Zigzag Cut,50"].join("\n"));
    const ci = result.current.csvIssues;
    expect(ci, "the panel is raised").toBeTruthy();
    expect(ci.skipped, "…with NOTHING skipped, which is the point").toBe(0);
    expect(ci.badCategory).toBe(1);
    expect(ci.badCut).toBe(1);
    expect(String(setImportRecap.mock.calls[0]![0].msg)).toContain("csv_import_issues");
  });

  it("…and that coercion keeps Settings OPEN, or the panel renders into a shut tab", () => {
    // The defect, through the door its own fixtures never opened.
    const stageImport = vi.fn();
    const props = makeProps({ stageImport, setImportRecap: vi.fn() });
    const { result } = renderHook(() => useExportImport(props as any));
    const csv = [HEAD, GOOD, "Vondel,633,Pipeweed,Ribbon,50"].join("\n");
    const fakeInput: any = { click: vi.fn(), files: [new Blob([csv])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = csv; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;
    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });
    expect(stageImport.mock.calls[0]![2].keepModalOpen).toBe(true);
  });

  it("stays SILENT on a clean file — no panel, no extra recap line", () => {
    // An always-present "0 problems" panel after every clean import would be
    // noise; the recap toast already confirms the import landed.
    const { result, setImportRecap } = runImport([HEAD, GOOD].join("\n"));
    expect(result.current.csvIssues).toBeNull();
    const msg = String(setImportRecap.mock.calls[0]![0].msg);
    expect(msg).not.toContain("csv_import_issues");
  });

  it("a trade label the map converts raises nothing", () => {
    // `Navy Cut` -> Flake is the contract, not a defect. Flagging it would
    // send the user 'fixing' a row the app already understands.
    const { result } = runImport([HEAD, "Halvorsen,Duskfall,Anglais,Navy Cut,50"].join("\n"));
    expect(result.current.csvIssues).toBeNull();
  });

  it("clearCsvIssues closes the panel", () => {
    const { result } = runImport([HEAD, GOOD, ",,Anglais,Ribbon,50"].join("\n"));
    expect(result.current.csvIssues).toBeTruthy();
    act(() => { result.current.clearCsvIssues(); });
    expect(result.current.csvIssues).toBeNull();
  });

  it("a second, clean import clears the previous panel", () => {
    // A stale panel must not outlive the file that produced it — it would
    // describe a file the user has already replaced.
    const setImportRecap = vi.fn();
    const props = makeProps({ stageImport: vi.fn(), setImportRecap });
    const { result } = renderHook(() => useExportImport(props as any));
    let text = [HEAD, GOOD, ",,Anglais,Ribbon,50"].join("\n");
    const fakeInput: any = { click: vi.fn(), files: [new Blob([""])] };
    vi.spyOn(document, "createElement").mockReturnValue(fakeInput as any);
    class FakeReader {
      onload: any = null; result: any = null;
      readAsText() { this.result = text; if (this.onload) this.onload(); }
    }
    (globalThis as any).FileReader = FakeReader;
    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });
    expect(result.current.csvIssues).toBeTruthy();
    text = [HEAD, GOOD].join("\n");
    act(() => { result.current.doImportCsvFile(); });
    act(() => { fakeInput.onchange(); });
    expect(result.current.csvIssues, "stale panel survived a clean import").toBeNull();
  });
});
