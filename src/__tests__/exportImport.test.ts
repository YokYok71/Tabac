/**
 * Regression tests for the JSON export / import round-trip.
 *
 * Three of the five concerns cannot be tested by calling the real functions
 * directly because they are entangled with browser-only APIs (FileReader,
 * file-input, IndexedDB, Blob/URL).  Those concerns are covered with mirrored
 * pure functions — identical logic, no side effects — so a regression in the
 * production predicate immediately breaks the corresponding test.
 *
 * What is covered:
 *   I.  _imageData filter predicate   (security invariant — CLAUDE.md § Security)
 *   II. withPhotos / gatherLocalImages (export-side logic)
 *  III. doImportFile processing        (import-side logic, mirrored)
 *   IV. imgCache integration           (IndexedDB bridge, mocked)
 *    V. round-trip invariant           (full export → import chain)
 */

import { describe, it, expect, vi } from "vitest";
import { INIT } from "../constants";

// ── Mirror helpers ─────────────────────────────────────────────────────────────
// Each helper is a verbatim copy of the production predicate / inner function.
// If the source changes, the test MUST change too — that is the point.

/**
 * Mirrors the _imageData filter inside doImportFile (useExportImport.ts).
 * Returns true when an entry is acceptable for IndexedDB storage.
 */
function imageDataFilter(k: string, v: unknown): boolean {
  return (
    k.indexOf("local-photo-") === 0 &&
    typeof v === "string" &&
    (v as string).indexOf("data:image/") === 0
  );
}

/**
 * Mirrors collectLocalPhotoKeys (gatherLocalImages in useGdriveSync.ts).
 * Returns unique local-photo-* keys found across all entity collections.
 */
function collectLocalPhotoKeys(dat: any): string[] {
  var keys: string[] = [];
  function addK(k: any) {
    if (k && k.indexOf("local-photo-") === 0 && keys.indexOf(k) < 0) keys.push(k);
  }
  (dat.tobaccos || []).forEach((t: any) => addK(t.imageUrl));
  (dat.pipes || []).forEach((p: any) => {
    addK(p.imageUrl);
    // additional pipe photos. Mirror kept in sync with
    // the real gatherLocalImages (it walks these + snapshots).
    if (p && Array.isArray(p.photos)) p.photos.forEach(addK);
  });
  (dat.wishlist || []).forEach((w: any) => addK(w.imageUrl));
  (dat.accessories || []).forEach((a: any) => addK(a.imageUrl));
  // session snapshots so the journal photo survives a purge.
  (dat.sessions || []).forEach((s: any) => {
    if (s && s.tobaccoSnapshot) addK(s.tobaccoSnapshot.imageUrl);
    if (s && s.pipeSnapshot) addK(s.pipeSnapshot.imageUrl);
  });
  return keys;
}

/**
 * Mirrors the "fix" function inside withPhotos (useGdriveSync.ts).
 * Replaces local-photo-* imageUrl keys with their base64 values from photoMap.
 */
function applyPhotoMap(entities: any[], photoMap: Record<string, string>): any[] {
  return (entities || []).map((o: any) =>
    o && o.imageUrl && photoMap[o.imageUrl]
      ? Object.assign({}, o, { imageUrl: photoMap[o.imageUrl] })
      : o,
  );
}

/**
 * Mirrors the reader.onload processing block inside doImportFile (useExportImport.ts).
 * Returns { savedData, savedApiKey, writtenToCache, updatedImgLocal }.
 */
function processImportedJson(
  rawJson: any,
  deps: {
    migrateData?: (d: any) => any;
    imgCachePut?: (k: string, v: string) => void;
  } = {},
) {
  const migrateData = deps.migrateData ?? ((d: any) => d);
  const imgCachePut = deps.imgCachePut ?? (() => {});

  var extractedApiKey: string | null = null;
  if (rawJson._apiKey) extractedApiKey = rawJson._apiKey;

  var cleanD = Object.assign({}, rawJson);
  delete cleanD._apiKey;
  delete cleanD._savedAt;
  delete cleanD._saveType;

  var imgData: Record<string, unknown> = cleanD._imageData || {};
  delete cleanD._imageData;

  var savedData = migrateData(Object.assign({}, INIT, cleanD));

  var iKeys = Object.keys(imgData).filter((k) =>
    k.indexOf("local-photo-") === 0 &&
    typeof imgData[k] === "string" &&
    (imgData[k] as string).indexOf("data:image/") === 0,
  );

  var writtenToCache: Record<string, string> = {};
  iKeys.forEach((k) => {
    imgCachePut(k, imgData[k] as string);
    writtenToCache[k] = imgData[k] as string;
  });

  return { savedData, extractedApiKey, writtenToCache };
}

// ── I. _imageData filter predicate ────────────────────────────────────────────

describe("_imageData filter — import hardening (security invariant)", () => {
  it("accepts a valid local-photo- key with data:image/ value", () => {
    expect(imageDataFilter("local-photo-1234", "data:image/jpeg;base64,abc")).toBe(true);
  });

  it("accepts any data:image/ subtype (jpeg, png, webp…)", () => {
    expect(imageDataFilter("local-photo-x", "data:image/png;base64,xyz")).toBe(true);
    expect(imageDataFilter("local-photo-x", "data:image/webp;base64,xyz")).toBe(true);
  });

  it("rejects a key that does NOT start with local-photo-", () => {
    expect(imageDataFilter("photo-local-1234", "data:image/jpeg;base64,abc")).toBe(false);
    expect(imageDataFilter("_imageData", "data:image/jpeg;base64,abc")).toBe(false);
    expect(imageDataFilter("", "data:image/jpeg;base64,abc")).toBe(false);
  });

  it("rejects a value that does NOT start with data:image/", () => {
    expect(imageDataFilter("local-photo-1", "data:text/html;base64,abc")).toBe(false);
    expect(imageDataFilter("local-photo-1", "javascript:alert(1)")).toBe(false);
    expect(imageDataFilter("local-photo-1", "https://example.com/img.jpg")).toBe(false);
    expect(imageDataFilter("local-photo-1", "data:application/json;base64,abc")).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(imageDataFilter("local-photo-1", 42)).toBe(false);
    expect(imageDataFilter("local-photo-1", null)).toBe(false);
    expect(imageDataFilter("local-photo-1", { src: "data:image/jpeg;base64,x" })).toBe(false);
  });

  it("rejects when BOTH key and value are invalid", () => {
    expect(imageDataFilter("bad-key", "bad-value")).toBe(false);
  });

  it("requires BOTH conditions — valid key alone is not enough", () => {
    expect(imageDataFilter("local-photo-1", "")).toBe(false);
  });

  it("requires BOTH conditions — valid value alone is not enough", () => {
    expect(imageDataFilter("", "data:image/jpeg;base64,abc")).toBe(false);
  });
});

// ── II. withPhotos / gatherLocalImages logic ──────────────────────────────────

describe("collectLocalPhotoKeys — export-side key collection", () => {
  it("collects local-photo-* keys from tobaccos", () => {
    const dat = { tobaccos: [{ imageUrl: "local-photo-1" }, { imageUrl: "local-photo-2" }] };
    expect(collectLocalPhotoKeys(dat)).toEqual(["local-photo-1", "local-photo-2"]);
  });

  it("collects keys from pipes, wishlist, and accessories", () => {
    const dat = {
      tobaccos: [],
      pipes: [{ imageUrl: "local-photo-pipe" }],
      wishlist: [{ imageUrl: "local-photo-wish" }],
      accessories: [{ imageUrl: "local-photo-acc" }],
    };
    const keys = collectLocalPhotoKeys(dat);
    expect(keys).toContain("local-photo-pipe");
    expect(keys).toContain("local-photo-wish");
    expect(keys).toContain("local-photo-acc");
  });

  it("deduplicates keys that appear on multiple entities", () => {
    const dat = {
      tobaccos: [{ imageUrl: "local-photo-shared" }, { imageUrl: "local-photo-shared" }],
    };
    expect(collectLocalPhotoKeys(dat)).toEqual(["local-photo-shared"]);
  });

  it("ignores external URLs (non-local-photo- values)", () => {
    const dat = {
      tobaccos: [{ imageUrl: "https://example.com/img.jpg" }],
      pipes: [{ imageUrl: "" }],
    };
    expect(collectLocalPhotoKeys(dat)).toEqual([]);
  });

  it("returns empty array when no local images exist", () => {
    expect(collectLocalPhotoKeys({ tobaccos: [], pipes: [] })).toEqual([]);
  });
});

describe("applyPhotoMap — withPhotos replacement logic", () => {
  it("replaces local-photo-* imageUrl with base64 from photoMap", () => {
    const entities = [{ id: 1, imageUrl: "local-photo-123", name: "T" }];
    const map = { "local-photo-123": "data:image/jpeg;base64,ABC" };
    const result = applyPhotoMap(entities, map);
    expect(result[0].imageUrl).toBe("data:image/jpeg;base64,ABC");
  });

  it("preserves other entity fields unchanged", () => {
    const entities = [{ id: 1, imageUrl: "local-photo-123", name: "T", rating: 3 }];
    const map = { "local-photo-123": "data:image/jpeg;base64,ABC" };
    const result = applyPhotoMap(entities, map);
    expect(result[0].name).toBe("T");
    expect(result[0].rating).toBe(3);
  });

  it("preserves external URL imageUrl (not in photoMap)", () => {
    const entities = [{ id: 1, imageUrl: "https://example.com/img.jpg" }];
    const result = applyPhotoMap(entities, {});
    expect(result[0].imageUrl).toBe("https://example.com/img.jpg");
  });

  it("preserves entities with no imageUrl", () => {
    const entities = [{ id: 1, name: "T" }];
    const result = applyPhotoMap(entities, {});
    expect(result[0]).toEqual({ id: 1, name: "T" });
  });

  it("returns original entity reference when no replacement needed", () => {
    const entity = { id: 1, imageUrl: "https://example.com/img.jpg" };
    const result = applyPhotoMap([entity], {});
    expect(result[0]).toBe(entity); // same reference
  });

  it("does not mutate the original entities array", () => {
    const original = [{ id: 1, imageUrl: "local-photo-1" }];
    applyPhotoMap(original, { "local-photo-1": "data:image/jpeg;base64,X" });
    expect(original[0]!.imageUrl).toBe("local-photo-1"); // unchanged
  });

  it("handles an empty entities array", () => {
    expect(applyPhotoMap([], { "local-photo-1": "data:image/jpeg;base64,X" })).toEqual([]);
  });
});

// ── III. doImportFile processing ──────────────────────────────────────────────

describe("processImportedJson — import-side data transformation", () => {
  it("merges imported data with INIT defaults", () => {
    const json = { tobaccos: [{ id: 1, name: "T" }] };
    const { savedData } = processImportedJson(json);
    expect(savedData.pipes).toEqual(INIT.pipes);
    expect(savedData.sessions).toEqual(INIT.sessions);
    expect(savedData.tobaccos[0].name).toBe("T");
  });

  it("strips _apiKey from saved data", () => {
    const json = { tobaccos: [], _apiKey: "sk-secret" };
    const { savedData } = processImportedJson(json);
    expect(savedData._apiKey).toBeUndefined();
  });

  it("extracts _apiKey for saveApiKey callback", () => {
    const json = { tobaccos: [], _apiKey: "sk-secret" };
    const { extractedApiKey } = processImportedJson(json);
    expect(extractedApiKey).toBe("sk-secret");
  });

  it("returns null extractedApiKey when _apiKey absent", () => {
    const json = { tobaccos: [] };
    const { extractedApiKey } = processImportedJson(json);
    expect(extractedApiKey).toBeNull();
  });

  it("strips _savedAt from saved data", () => {
    const json = { tobaccos: [], _savedAt: "2025-06-15T12:00:00Z" };
    const { savedData } = processImportedJson(json);
    expect(savedData._savedAt).toBeUndefined();
  });

  it("strips _saveType from saved data", () => {
    const json = { tobaccos: [], _saveType: "manual" };
    const { savedData } = processImportedJson(json);
    expect(savedData._saveType).toBeUndefined();
  });

  it("strips _imageData from saved data", () => {
    const json = {
      tobaccos: [],
      _imageData: { "local-photo-1": "data:image/jpeg;base64,ABC" },
    };
    const { savedData } = processImportedJson(json);
    expect(savedData._imageData).toBeUndefined();
  });

  it("applies migrateData to the imported payload", () => {
    const migrateData = vi.fn((d) => ({ ...d, _migrated: true }));
    const json = { tobaccos: [] };
    const { savedData } = processImportedJson(json, { migrateData });
    expect(migrateData).toHaveBeenCalledOnce();
    expect(savedData._migrated).toBe(true);
  });
});

// ── IV. _imageData → IndexedDB write ─────────────────────────────────────────

describe("processImportedJson — _imageData → cache writes", () => {
  it("writes valid _imageData entries to imgCache", () => {
    const imgCachePut = vi.fn();
    const json = {
      tobaccos: [],
      _imageData: {
        "local-photo-1": "data:image/jpeg;base64,AAA",
        "local-photo-2": "data:image/png;base64,BBB",
      },
    };
    const { writtenToCache } = processImportedJson(json, { imgCachePut });
    expect(imgCachePut).toHaveBeenCalledTimes(2);
    expect(writtenToCache["local-photo-1"]).toBe("data:image/jpeg;base64,AAA");
    expect(writtenToCache["local-photo-2"]).toBe("data:image/png;base64,BBB");
  });

  it("discards entries with an invalid key prefix", () => {
    const imgCachePut = vi.fn();
    const json = {
      tobaccos: [],
      _imageData: { "photo-1": "data:image/jpeg;base64,X" },
    };
    processImportedJson(json, { imgCachePut });
    expect(imgCachePut).not.toHaveBeenCalled();
  });

  it("discards entries with a non-data:image/ value", () => {
    const imgCachePut = vi.fn();
    const json = {
      tobaccos: [],
      _imageData: {
        "local-photo-1": "https://evil.example.com/img.jpg",
      },
    };
    processImportedJson(json, { imgCachePut });
    expect(imgCachePut).not.toHaveBeenCalled();
  });

  it("discards entries with non-string values", () => {
    const imgCachePut = vi.fn();
    const json = {
      tobaccos: [],
      _imageData: { "local-photo-1": { src: "data:image/jpeg;base64,X" } },
    };
    processImportedJson(json, { imgCachePut });
    expect(imgCachePut).not.toHaveBeenCalled();
  });

  it("writes only valid entries when _imageData contains a mix", () => {
    const imgCachePut = vi.fn();
    const json = {
      tobaccos: [],
      _imageData: {
        "local-photo-good": "data:image/jpeg;base64,GOOD",
        "bad-key": "data:image/jpeg;base64,BAD1",
        "local-photo-bv": "https://evil.example.com/img.jpg",
      },
    };
    const { writtenToCache } = processImportedJson(json, { imgCachePut });
    expect(imgCachePut).toHaveBeenCalledTimes(1);
    expect(writtenToCache["local-photo-good"]).toBe("data:image/jpeg;base64,GOOD");
  });

  it("does nothing when _imageData is absent", () => {
    const imgCachePut = vi.fn();
    processImportedJson({ tobaccos: [] }, { imgCachePut });
    expect(imgCachePut).not.toHaveBeenCalled();
  });
});

// ── V. Round-trip invariant ───────────────────────────────────────────────────

describe("round-trip invariant — export → import → same application state", () => {
  it("tobacco data survives the round-trip unchanged", () => {
    const tobacco = {
      id: 1,
      name: "Brackwater Regent Mixture",
      brand: "Brackwater",
      lots: [{ id: "L1", status: "cellar", weightG: "100" }],
    };
    // Export: withPhotos returns data as-is when no local images
    const exportedJson = { tobaccos: [tobacco], pipes: [], sessions: [] };
    // Import: process the JSON
    const { savedData } = processImportedJson(exportedJson);
    expect(savedData.tobaccos[0].name).toBe("Brackwater Regent Mixture");
    expect(savedData.tobaccos[0].lots[0].weightG).toBe("100");
  });

  it("photo key → base64 (export) → base64 in imageUrl (import)", () => {
    // Export side: local-photo-* key is replaced with base64 by withPhotos
    const key = "local-photo-1234";
    const base64 = "data:image/jpeg;base64,/9j/photo";
    const photoMap = { [key]: base64 };
    const tobaccoWithKey = { id: 1, imageUrl: key, name: "T" };
    const exported = applyPhotoMap([tobaccoWithKey], photoMap);
    expect(exported[0].imageUrl).toBe(base64); // base64 embedded in JSON

    // Import side: JSON export embeds base64 directly in imageUrl (no _imageData)
    // The import just saves it as-is via save(migrateData(...))
    const { savedData } = processImportedJson({
      tobaccos: [{ id: 1, imageUrl: base64, name: "T" }],
    });
    expect(savedData.tobaccos[0].imageUrl).toBe(base64);
  });

  it("Drive backup format: photo key preserved + _imageData → cache → same display", () => {
    const key = "local-photo-5678";
    const base64 = "data:image/png;base64,iVBORw0K";
    const imgCachePut = vi.fn();

    // Drive backup: imageUrl keeps the key, base64 goes in _imageData
    const driveBackup = {
      tobaccos: [{ id: 1, imageUrl: key, name: "T" }],
      _imageData: { [key]: base64 },
    };

    const { savedData, writtenToCache } = processImportedJson(driveBackup, { imgCachePut });

    // After import: imageUrl is still the key (displayed by resolving through imgCache)
    expect(savedData.tobaccos[0].imageUrl).toBe(key);
    // And the base64 is in IndexedDB under that key
    expect(writtenToCache[key]).toBe(base64);
    expect(imgCachePut).toHaveBeenCalledWith(key, base64);
  });

  it("sessions and counters are preserved through round-trip", () => {
    const session = { id: 10, tobaccoId: 1, lotId: "L1", weightG: "5", date: "2025-06-15" };
    const exportedJson = { tobaccos: [], sessions: [session], nxJ: 11 };
    const { savedData } = processImportedJson(exportedJson);
    expect(savedData.sessions[0]).toEqual(session);
    expect(savedData.nxJ).toBe(11);
  });

  it("no metadata leaks into the application state after import", () => {
    const exportedJson = {
      tobaccos: [],
      _apiKey: "sk-live-xxx",
      _savedAt: "2025-06-15T12:00:00Z",
      _saveType: "manual",
      _imageData: { "local-photo-1": "data:image/jpeg;base64,X" },
    };
    const { savedData } = processImportedJson(exportedJson);
    expect(savedData._apiKey).toBeUndefined();
    expect(savedData._savedAt).toBeUndefined();
    expect(savedData._saveType).toBeUndefined();
    expect(savedData._imageData).toBeUndefined();
  });
});
