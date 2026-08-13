/**
 * Tests for the additions to src/utils/gdriveApi.ts — the
 * helpers that became public surface when they moved out of
 * useGdriveSync.ts (step 1 of the Drive split):
 *
 *   - makeBackupName    (was module-private in the hook)
 *   - pruneByType       (was closure-local inside the hook)
 *   - fetchWithTimeout  (was module-private in the hook)
 *
 * parseBackupCounts / classifyBackup were already exported + covered —
 * their suite lives in parseBackupCounts.test.ts (import path updated).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeBackupName,
  parseBackupCounts,
  backupDeviceName,
  classifyBackup,
  fetchWithTimeout,
  pruneByType,
  findNewerCloudBackup,
  explainCloudBackups,
  summariseCloudDevices,
  autoFileDeviceId,
  ownAutoFiles,
  chooseAutoSaveTarget,
  pickKeepAuto,
} from "../utils/gdriveApi";
import { GDRIVE_FILE_PREFIX, GDRIVE_AUTO_PREFIX } from "../constants";

// `ownStamped` became `ownStampedSince`, a timestamp. These
// cases previously passed `true` meaning "this device has stamped"; the
// faithful translation is "stamped long ago", so every fixture file (dated
// 2026) is NEWER than the stamp moment and the old expectations still read
// the same way — except where the point IS the new behaviour.
const OLD_STAMP = new Date("2020-01-01T00:00:00Z").getTime();

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── makeBackupName ────────────────────────────────────────────────────────────

describe("makeBackupName", () => {
  const data = {
    tobaccos: [{}, {}], pipes: [{}], wishlist: [],
    accessories: [{}, {}, {}], sessions: new Array(12).fill({}),
  };

  it("uses the manual prefix and a timestamp + counts suffix", () => {
    const name = makeBackupName(data, "manual");
    expect(name.startsWith(GDRIVE_FILE_PREFIX)).toBe(true);
    expect(name.startsWith(GDRIVE_AUTO_PREFIX)).toBe(false);
    expect(name).toMatch(/^cave-tabac-\d{8}-\d{6}-t2-p1-w0-a3-j12\.json$/);
  });

  it("uses the auto prefix for type auto", () => {
    const name = makeBackupName(data, "auto");
    expect(name.startsWith(GDRIVE_AUTO_PREFIX)).toBe(true);
  });

  it("tolerates null / missing arrays (all-zero counts)", () => {
    const name = makeBackupName(null, "manual");
    expect(name).toMatch(/-t0-p0-w0-a0-j0\.json$/);
  });

  it("round-trips through parseBackupCounts and classifyBackup", () => {
    const manual = makeBackupName(data, "manual");
    const auto = makeBackupName(data, "auto");
    expect(parseBackupCounts(manual)).toEqual({
      tobaccos: 2, pipes: 1, wishlist: 0, accessories: 3, sessions: 12,
    });
    expect(parseBackupCounts(auto)).toEqual(parseBackupCounts(manual));
    expect(classifyBackup(manual)).toBe("manual");
    expect(classifyBackup(auto)).toBe("auto");
  });

  // ── device-stamped auto filenames ─────────────────────
  it("weaves a device id into the auto filename after the prefix", () => {
    const name = makeBackupName(data, "auto", "k3f9x2");
    expect(name.startsWith(GDRIVE_AUTO_PREFIX + "k3f9x2-")).toBe(true);
    // counts + classify still parse through the stamped name
    expect(classifyBackup(name)).toBe("auto");
    expect(parseBackupCounts(name)).toEqual({
      tobaccos: 2, pipes: 1, wishlist: 0, accessories: 3, sessions: 12,
    });
  });

  it("ignores the device id for manual names", () => {
    const name = makeBackupName(data, "manual", "k3f9x2");
    expect(name.startsWith(GDRIVE_FILE_PREFIX)).toBe(true);
    expect(name).not.toContain("k3f9x2");
  });

  it("sanitises a tampered device id to [0-9a-z] so parsing can't break", () => {
    const name = makeBackupName(data, "auto", "AB-c.d/9");
    // dashes/dots/slashes stripped, lower-cased → "abcd9"
    expect(name.startsWith(GDRIVE_AUTO_PREFIX + "abcd9-")).toBe(true);
    expect(parseBackupCounts(name)).toEqual({
      tobaccos: 2, pipes: 1, wishlist: 0, accessories: 3, sessions: 12,
    });
    expect(autoFileDeviceId(name)).toBe("abcd9");
  });

  it("omits the segment when the sanitised device id is empty", () => {
    const name = makeBackupName(data, "auto", "---");
    expect(autoFileDeviceId(name)).toBeNull();
  });

  // ── human-readable device NAME slug (tail segment) ──────────
  it("appends a sanitised device-name slug at the end of a MANUAL name", () => {
    const name = makeBackupName(data, "manual", undefined, "MacBook Pro");
    expect(name.startsWith(GDRIVE_FILE_PREFIX)).toBe(true);
    expect(name).toMatch(/-t2-p1-w0-a3-j12-macbookpro\.json$/);
    // The counts still parse around the trailing name slug.
    expect(parseBackupCounts(name)).toEqual({
      tobaccos: 2, pipes: 1, wishlist: 0, accessories: 3, sessions: 12,
    });
    expect(classifyBackup(name)).toBe("manual");
  });

  it("appends the name slug AFTER the counts on an AUTO name and keeps the front deviceId parseable", () => {
    const name = makeBackupName(data, "auto", "k3f9x2", "iPhone de Rémy");
    // accents folded, spaces/punct stripped, capped at 16 → "iphonederemy"
    expect(name).toMatch(/-j12-iphonederemy\.json$/);
    expect(autoFileDeviceId(name)).toBe("k3f9x2"); // front id still parses
    expect(parseBackupCounts(name)).toEqual({
      tobaccos: 2, pipes: 1, wishlist: 0, accessories: 3, sessions: 12,
    });
    expect(classifyBackup(name)).toBe("auto");
  });

  it("a device named 'auto' does NOT flip a manual name to auto (slug is at the tail)", () => {
    const name = makeBackupName(data, "manual", undefined, "auto");
    expect(classifyBackup(name)).toBe("manual");
    expect(name).toMatch(/-auto\.json$/);
  });

  it("omits the name slug when the device name is empty / all-punctuation", () => {
    expect(makeBackupName(data, "manual", undefined, "")).toMatch(/-j12\.json$/);
    expect(makeBackupName(data, "manual", undefined, "  —  ")).toMatch(/-j12\.json$/);
  });

  it("caps the name slug at 16 chars", () => {
    const name = makeBackupName(data, "manual", undefined, "abcdefghijklmnopqrstuvwxyz");
    const m = name.match(/-j12-([a-z0-9]+)\.json$/);
    expect(m).not.toBeNull();
    expect(m![1]!.length).toBe(16);
  });
});

// ── autoFileDeviceId ──────────────────────────────────────────────────────────

describe("autoFileDeviceId", () => {
  const data = { tobaccos: [{}], pipes: [], wishlist: [], accessories: [], sessions: [] };

  it("extracts the id from a stamped auto name", () => {
    const name = makeBackupName(data, "auto", "abc123");
    expect(autoFileDeviceId(name)).toBe("abc123");
  });

  it("returns null for a legacy unstamped auto name", () => {
    const legacy = makeBackupName(data, "auto"); // no device id
    expect(autoFileDeviceId(legacy)).toBeNull();
  });

  it("returns null for a manual name", () => {
    expect(autoFileDeviceId(makeBackupName(data, "manual"))).toBeNull();
  });

  it("returns null for the historical singleton + junk", () => {
    expect(autoFileDeviceId("cave-tabac-auto.json")).toBeNull();
    expect(autoFileDeviceId("")).toBeNull();
    expect(autoFileDeviceId("random.json")).toBeNull();
  });

  it("distinguishes two different devices", () => {
    const a = makeBackupName(data, "auto", "devicea");
    const b = makeBackupName(data, "auto", "deviceb");
    expect(autoFileDeviceId(a)).toBe("devicea");
    expect(autoFileDeviceId(b)).toBe("deviceb");
    expect(autoFileDeviceId(a)).not.toBe(autoFileDeviceId(b));
  });
});

// ── pruneByType ───────────────────────────────────────────────────────────────

describe("pruneByType", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchSpy as any;
  });

  const file = (id: string, name: string, createdTime: string) =>
    ({ id, name, createdTime });

  // pruneByType now takes a provider-agnostic
  // remove(token, id) fn and deletes SEQUENTIALLY (Dropbox 429s on
  // concurrent writes; the old version also hard-coded the Drive URL so
  // a Dropbox token hit googleapis.com and silently failed).
  let remove: any;
  beforeEach(() => {
    remove = vi.fn().mockResolvedValue({ ok: true });
  });

  it("keeps the newest N of the requested type and deletes the rest", async () => {
    const files = [
      file("old", "cave-tabac-20260101-000000-t1-p0-w0-a0-j0.json", "2026-01-01T00:00:00Z"),
      file("mid", "cave-tabac-20260201-000000-t1-p0-w0-a0-j0.json", "2026-02-01T00:00:00Z"),
      file("new", "cave-tabac-20260301-000000-t1-p0-w0-a0-j0.json", "2026-03-01T00:00:00Z"),
    ];
    await pruneByType(files, "manual", 2, "tok", remove);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("tok", "old");
  });

  it("never touches files of the other type", async () => {
    const files = [
      file("a1", "cave-tabac-auto-20260101-000000-t1-p0-w0-a0-j0.json", "2026-01-01T00:00:00Z"),
      file("m1", "cave-tabac-20250101-000000-t1-p0-w0-a0-j0.json", "2025-01-01T00:00:00Z"),
    ];
    // keep 0 manual → m1 deleted, a1 (auto) untouched.
    await pruneByType(files, "manual", 0, "tok", remove);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("tok", "m1");
  });

  it("sorts defensively when the listing is not createdTime-desc", async () => {
    const files = [
      file("oldest", "cave-tabac-20240101-000000-t1-p0-w0-a0-j0.json", "2024-01-01T00:00:00Z"),
      file("newest", "cave-tabac-20260101-000000-t1-p0-w0-a0-j0.json", "2026-01-01T00:00:00Z"),
      file("middle", "cave-tabac-20250101-000000-t1-p0-w0-a0-j0.json", "2025-01-01T00:00:00Z"),
    ];
    await pruneByType(files, "manual", 1, "tok", remove);
    const deleted = remove.mock.calls.map((c: any[]) => c[1]);
    expect(deleted).toContain("oldest");
    expect(deleted).toContain("middle");
    expect(deleted).not.toContain("newest");
  });

  it("deletes sequentially, not concurrently (Dropbox write-lock safety)", async () => {
    const files = [
      file("d1", "cave-tabac-20260101-000000-t1-p0-w0-a0-j0.json", "2026-01-01T00:00:00Z"),
      file("d2", "cave-tabac-20250101-000000-t1-p0-w0-a0-j0.json", "2025-01-01T00:00:00Z"),
    ];
    let inFlight = 0;
    let maxInFlight = 0;
    remove.mockImplementation(() => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((res) => setTimeout(() => { inFlight--; res({ ok: true }); }, 0));
    });
    await pruneByType(files, "manual", 0, "tok", remove);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1); // never two deletes at once
  });

  it("is a no-op on empty / null input", async () => {
    await pruneByType([], "manual", 2, "tok", remove);
    await pruneByType(null as any, "auto", 0, "tok", remove);
    expect(remove).not.toHaveBeenCalled();
  });
});

// ── fetchWithTimeout ──────────────────────────────────────────────────────────

describe("fetchWithTimeout", () => {
  it("resolves with the response when fetch finishes in time", async () => {
    const resp = { ok: true };
    globalThis.fetch = vi.fn().mockResolvedValue(resp) as any;
    await expect(fetchWithTimeout("https://x.test/", {})).resolves.toBe(resp);
  });

  it("passes the abort signal through to fetch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchSpy as any;
    await fetchWithTimeout("https://x.test/", { method: "POST" });
    const opts = fetchSpy.mock.calls[0]![1];
    expect(opts.method).toBe("POST");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts the request once timeoutMs elapses", async () => {
    vi.useFakeTimers();
    let captured: AbortSignal | null = null;
    globalThis.fetch = vi.fn().mockImplementation((_u: any, o: any) => {
      captured = o.signal;
      return new Promise((_res, rej) => {
        o.signal.addEventListener("abort", () =>
          rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    }) as any;
    const p = fetchWithTimeout("https://x.test/", {}, 5000);
    const guard = expect(p).rejects.toMatchObject({ name: "AbortError" });
    vi.advanceTimersByTime(5001);
    await guard;
    expect(captured!.aborted).toBe(true);
  });
});

// ── findNewerCloudBackup (multi-device guard) ─────────────────

describe("findNewerCloudBackup", () => {
  const T0 = new Date("2026-06-10T10:00:00Z").getTime();
  const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
  const HOUR = 3600000;

  it("returns null for empty / null listings", () => {
    expect(findNewerCloudBackup([], 0, 0)).toBeNull();
    expect(findNewerCloudBackup(null as any, 0, 0)).toBeNull();
  });

  it("returns the newest file when it beats localRef + margin", () => {
    const files = [
      { name: "cave-tabac-a.json", modifiedTime: iso(1 * HOUR) },
      { name: "cave-tabac-b.json", modifiedTime: iso(3 * HOUR) },
      { name: "cave-tabac-c.json", modifiedTime: iso(2 * HOUR) },
    ];
    const hit = findNewerCloudBackup(files, T0, 0);
    expect(hit).not.toBeNull();
    expect(hit!.name).toBe("cave-tabac-b.json");
    expect(hit!.ts).toBe(T0 + 3 * HOUR);
  });

  it("ignores files within the clock-skew margin of localRef (self-save)", () => {
    const files = [{ name: "cave-tabac-a.json", modifiedTime: iso(60000) }];
    // 60s newer than localRef, default margin 120s → not a hit.
    expect(findNewerCloudBackup(files, T0, 0)).toBeNull();
  });

  it("honours a custom margin", () => {
    const files = [{ name: "cave-tabac-a.json", modifiedTime: iso(60000) }];
    expect(findNewerCloudBackup(files, T0, 0, 30000)).not.toBeNull();
  });

  it("suppresses backups at or below the dismissed ts", () => {
    const files = [{ name: "cave-tabac-a.json", modifiedTime: iso(3 * HOUR) }];
    expect(findNewerCloudBackup(files, T0, T0 + 3 * HOUR)).toBeNull();
    // A strictly newer file than the dismissal resurfaces.
    const newer = [{ name: "cave-tabac-b.json", modifiedTime: iso(5 * HOUR) }];
    expect(findNewerCloudBackup(newer, T0, T0 + 3 * HOUR)).not.toBeNull();
  });

  it("flags ANY backup when the device never saved (localRef = 0)", () => {
    const files = [{ name: "cave-tabac-a.json", modifiedTime: iso(0) }];
    expect(findNewerCloudBackup(files, 0, 0)).not.toBeNull();
  });

  it("skips malformed entries (no name / no date / unparseable date)", () => {
    const files = [
      { name: "", modifiedTime: iso(3 * HOUR) },
      { name: "x.json" },
      { name: "y.json", modifiedTime: "garbage" },
      null,
    ];
    expect(findNewerCloudBackup(files as any, 0, 0)).toBeNull();
  });

  // The provider file id is propagated so the Home
  // banner can fetch the payload directly (one-tap auto-restore).
  it("returns the provider file id alongside name + ts", () => {
    const files = [
      { id: "drive-abc-123", name: "cave-tabac-a.json", modifiedTime: iso(3 * HOUR) },
    ];
    const hit = findNewerCloudBackup(files, T0, 0);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe("drive-abc-123");
  });

  it("emits an empty id when the listing omits it (legacy / Dropbox lite)", () => {
    const files = [
      { name: "cave-tabac-a.json", modifiedTime: iso(3 * HOUR) },
    ];
    const hit = findNewerCloudBackup(files, T0, 0);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe("");
  });

  // name-based dedup skips a file whose name matches
  // the last dismissed banner — skew-proof guard against multi-device
  // clock skew that would otherwise spam the banner on every save.
  it("skips a file matching dismissedName regardless of ts", () => {
    const files = [
      { id: "f1", name: "cave-tabac-dismissed.json", modifiedTime: iso(3 * HOUR) },
      { id: "f2", name: "cave-tabac-fresh.json", modifiedTime: iso(2 * HOUR) },
    ];
    const hit = findNewerCloudBackup(files, T0, 0, 120000, "cave-tabac-dismissed.json");
    expect(hit).not.toBeNull();
    expect(hit!.name).toBe("cave-tabac-fresh.json");
  });

  it("returns null when every newer file matches dismissedName", () => {
    const files = [
      { id: "f1", name: "cave-tabac-only.json", modifiedTime: iso(3 * HOUR) },
    ];
    const hit = findNewerCloudBackup(files, T0, 0, 120000, "cave-tabac-only.json");
    expect(hit).toBeNull();
  });

  // A device's own stamped auto file must never be flagged
  // as "newer cloud backup" — even when the local last-save ts didn't
  // advance. This is the single-device false-positive the user hit.
  it("skips this device's own stamped auto file (ownDeviceId)", () => {
    const files = [
      { id: "mine", name: "cave-tabac-auto-deva-20260610-130000-t1-p0-w0-a0-j0.json", modifiedTime: iso(3 * HOUR) },
    ];
    // Without ownDeviceId it would flag (newer than localRef).
    expect(findNewerCloudBackup(files, T0, 0)).not.toBeNull();
    // With ownDeviceId = "deva", the own file is skipped → null.
    expect(findNewerCloudBackup(files, T0, 0, 120000, null, "deva")).toBeNull();
  });

  it("still flags a FOREIGN device's stamped auto file", () => {
    const files = [
      { id: "theirs", name: "cave-tabac-auto-devb-20260610-130000-t1-p0-w0-a0-j0.json", modifiedTime: iso(3 * HOUR) },
    ];
    const hit = findNewerCloudBackup(files, T0, 0, 120000, null, "deva");
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe("theirs");
  });

  it("still flags a legacy unstamped auto file when ownDeviceId is set", () => {
    const files = [
      { id: "legacy", name: "cave-tabac-auto-20260610-130000-t1-p0-w0-a0-j0.json", modifiedTime: iso(3 * HOUR) },
    ];
    const hit = findNewerCloudBackup(files, T0, 0, 120000, null, "deva");
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe("legacy");
  });

  // Once this device is stamped (ownStamped),
  // skip its own legacy unstamped AUTO files (it drains them on save), so
  // A single-device user isn't nagged to restore their own earlier
  // file after a clock skew. MANUAL backups and foreign-stamped autos must
  // still flag normally.
  it("skips an unstamped AUTO file written BEFORE this device started stamping", () => {
    // The intent, unchanged: our own pre-stamping leftover must not
    // nag us. The timestamped marker only narrows WHICH files that covers — the stamp
    // moment must postdate the file for it to be ours.
    const files = [
      { id: "legacy-auto", name: "cave-tabac-auto-20260610-130000-t1-p0-w0-a0-j0.json", modifiedTime: iso(3 * HOUR) },
    ];
    expect(findNewerCloudBackup(files, T0, 0, 120000, null, "deva")).not.toBeNull();
    const stampedAfter = new Date(iso(4 * HOUR)).getTime();
    expect(findNewerCloudBackup(files, T0, 0, 120000, null, "deva", stampedAfter)).toBeNull();
  });

  it("SURFACES an unstamped AUTO file written AFTER we started stamping", () => {
    // THE fix. The old boolean dropped every unstamped auto file for ever, so a
    // second device that had LOST its cave-device-id (ITP eviction, site-data
    // clear, a storage error) wrote legacy-shaped names and was never announced
    // — it could save all week in silence. Once we have been stamping since
    // before the file was written, the file cannot be ours.
    const files = [
      { id: "foreign-unstamped", name: "cave-tabac-auto-20260610-130000-t1-p0-w0-a0-j0.json", modifiedTime: iso(3 * HOUR) },
    ];
    const stampedBefore = new Date(iso(1 * HOUR)).getTime();
    const hit = findNewerCloudBackup(files, T0, 0, 120000, null, "deva", stampedBefore);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe("foreign-unstamped");
  });

  it("an unstable device id never suppresses anything (storage-blocked devices)", () => {
    // getDeviceId falls back to a shared constant when storage is unavailable.
    // Two such devices would each read the other's files as their own and go
    // mutually silent; the guard is passed "" instead, so nothing is skipped.
    const files = [
      { id: "other", name: "cave-tabac-auto-device-20260610-130000-t1-p0-w0-a0-j0.json", modifiedTime: iso(3 * HOUR) },
    ];
    expect(findNewerCloudBackup(files, T0, 0, 120000, null, "device")).toBeNull();
    expect(findNewerCloudBackup(files, T0, 0, 120000, null, "")).not.toBeNull();
  });

  it("ownStamped still flags a MANUAL backup (deviceId-less but not auto)", () => {
    const files = [
      { id: "manual", name: "cave-tabac-20260610-130000-t1-p0-w0-a0-j0.json", modifiedTime: iso(3 * HOUR) },
    ];
    const hit = findNewerCloudBackup(files, T0, 0, 120000, null, "deva", OLD_STAMP);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe("manual");
  });

  it("ownStamped still flags a FOREIGN device's stamped auto file", () => {
    const files = [
      { id: "theirs", name: "cave-tabac-auto-devb-20260610-130000-t1-p0-w0-a0-j0.json", modifiedTime: iso(3 * HOUR) },
    ];
    const hit = findNewerCloudBackup(files, T0, 0, 120000, null, "deva", OLD_STAMP);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe("theirs");
  });
});

// ── extracted convergence-decision helpers ──────────────────────────

describe("ownAutoFiles / chooseAutoSaveTarget / pickKeepAuto", () => {
  // Auto files already filtered to classifyBackup === "auto", newest-first.
  const mine1 = { id: "m1", name: "cave-tabac-auto-deva-20260104-120000-t1-p0-w0-a0-j0.json" };
  const mine2 = { id: "m2", name: "cave-tabac-auto-deva-20260103-120000-t1-p0-w0-a0-j0.json" };
  const legacy = { id: "lg", name: "cave-tabac-auto-20260102-120000-t1-p0-w0-a0-j0.json" };
  const foreign = { id: "fg", name: "cave-tabac-auto-devb-20260105-120000-t1-p0-w0-a0-j0.json" };
  const autos = [foreign, mine1, mine2, legacy]; // listing order (newest-first-ish)

  it("ownAutoFiles keeps own + legacy, drops foreign, preserves order", () => {
    const own = ownAutoFiles(autos, "deva");
    expect(own.map((f) => f.id)).toEqual(["m1", "m2", "lg"]);
    expect(own).not.toContainEqual(foreign);
  });

  it("ownAutoFiles tolerates empty/null", () => {
    expect(ownAutoFiles([], "deva")).toEqual([]);
    expect(ownAutoFiles(null as any, "deva")).toEqual([]);
  });

  it("chooseAutoSaveTarget reuses the tracked fid when it still lists", () => {
    expect(chooseAutoSaveTarget(autos, "m2", "deva")).toBe("m2");
  });

  it("chooseAutoSaveTarget falls back to the newest own/legacy when fid is stale", () => {
    // storedFid not in the listing → newest own (m1).
    expect(chooseAutoSaveTarget(autos, "gone", "deva")).toBe("m1");
    expect(chooseAutoSaveTarget(autos, null, "deva")).toBe("m1");
  });

  it("chooseAutoSaveTarget never targets a FOREIGN file even if the stored fid points at it (review fix)", () => {
    // Multi-device data-loss guard: opening the restore/manage picker could
    // leave AUTO_FID_KEY pointing at another device's auto file. storedFid is
    // now matched against ownAutoFiles only, so a foreign id is ignored and we
    // fall back to this device's own newest — never overwrite a foreign backup.
    expect(chooseAutoSaveTarget(autos, "fg", "deva")).toBe("m1"); // was "fg" before the fix
    // With ONLY a foreign file present and a foreign stored fid → POST fresh (null).
    expect(chooseAutoSaveTarget([foreign], "fg", "deva")).toBeNull();
    expect(chooseAutoSaveTarget([foreign], "gone", "deva")).toBeNull();
  });

  it("pickKeepAuto returns the newest own/legacy id, null when none", () => {
    expect(pickKeepAuto(autos, "deva")).toBe("m1");
    expect(pickKeepAuto([foreign], "deva")).toBeNull();
    expect(pickKeepAuto([], "deva")).toBeNull();
  });
});

describe("explainCloudBackups (read-only diagnostic)", () => {
  const AUTO = (dev: string, hhmmss: string, iso: string) =>
    ({ id: "id-" + dev + hhmmss, name: `cave-tabac-auto-${dev}-20260705-${hhmmss}-t5-p2-w14-a2-j22.json`, modifiedTime: iso });

  it("mirrors the user's case: newer foreign file is proposed, own file ignored", () => {
    const own = AUTO("8udtad7", "161000", "2026-07-05T16:10:00.000Z");
    const dev2 = AUTO("qsekqav94e", "235700", "2026-07-05T23:57:00.000Z");
    const localRef = new Date(own.modifiedTime).getTime();
    const rows = explainCloudBackups([own, dev2], localRef, 0, 120000, null, "8udtad7", OLD_STAMP);
    const find = (n: string) => rows.find(r => r.name === n)!;
    expect(find(dev2.name).status).toBe("proposed");
    expect(find(own.name).status).toBe("ignored");
    expect(find(own.name).reason).toBe("own_device");
  });

  it("reports the muted-by-'seen'-marker reason (the actual bug symptom)", () => {
    const dev2 = AUTO("qsekqav94e", "235700", "2026-07-05T23:57:00.000Z");
    // dismissedTs later than the file → the launch banner would mute it.
    const dismissedTs = new Date("2026-07-06T02:00:00.000Z").getTime();
    const rows = explainCloudBackups([dev2], 0, dismissedTs, 120000, null, "8udtad7", OLD_STAMP);
    expect(rows[0]!.status).toBe("ignored");
    expect(rows[0]!.reason).toBe("dismissed_ts");
  });

  it("classifies every reason: own_legacy, older, dismissed_name, bad_date", () => {
    const legacy = { id: "l", name: "cave-tabac-auto-20260705-120000-t1-p1-w1-a1-j1.json", modifiedTime: "2026-07-05T12:00:00.000Z" };
    const older = AUTO("foreign", "010000", "2026-07-04T01:00:00.000Z");
    const dismissedByName = AUTO("foreign", "030000", "2026-07-05T03:00:00.000Z");
    const bad = AUTO("foreign", "040000", "not-a-date");
    const rows = explainCloudBackups(
      [legacy, older, dismissedByName, bad],
      new Date("2026-07-05T02:00:00.000Z").getTime(),
      // The stamp moment must POSTDATE the legacy file for it to be
      // ours — a boolean could not express that, which is the whole fix.
      0, 120000, dismissedByName.name, "8udtad7",
      new Date("2026-07-06T00:00:00.000Z").getTime(),
    );
    const find = (n: string) => rows.find(r => r.name === n)!;
    expect(find(legacy.name).reason).toBe("own_legacy");       // stamped after it → ours
    expect(find(older.name).reason).toBe("older");
    expect(find(dismissedByName.name).reason).toBe("dismissed_name");
    expect(find(bad.name).reason).toBe("bad_date");
  });

  it("stays in lock-step with findNewerCloudBackup: the proposed row === the hit", () => {
    const files = [
      AUTO("8udtad7", "161000", "2026-07-05T16:10:00.000Z"),
      AUTO("qsekqav94e", "235700", "2026-07-05T23:57:00.000Z"),
      AUTO("thirddev", "180000", "2026-07-05T18:00:00.000Z"),
    ];
    const args = [files, 0, 0, 120000, null, "8udtad7", OLD_STAMP] as const;
    const hit = findNewerCloudBackup(...args);
    const rows = explainCloudBackups(...args);
    const proposed = rows.find(r => r.status === "proposed");
    expect(proposed?.name).toBe(hit?.name);
    expect(proposed?.name).toBe(files[1]!.name); // qsekqav94e is newest foreign
  });

  it("no proposal when nothing is eligible (all older / own)", () => {
    const own = AUTO("8udtad7", "161000", "2026-07-05T16:10:00.000Z");
    const rows = explainCloudBackups([own], Date.now(), 0, 120000, null, "8udtad7", OLD_STAMP);
    expect(rows.every(r => r.status !== "proposed")).toBe(true);
  });
});

// ── summariseCloudDevices ─────────────────────────────────────────
describe("summariseCloudDevices", () => {
  // Minimal CloudBackupDiag-shaped rows (only the fields the helper reads).
  const row = (deviceId: string | null, kind: "auto" | "manual", ts: number): any =>
    ({ deviceId, kind, ts });

  it("groups auto files by device and keeps each device's newest ts + count", () => {
    const rows = [
      row("devA", "auto", 300),
      row("devA", "auto", 500),   // newer for devA
      row("devB", "auto", 400),
    ];
    const out = summariseCloudDevices(rows, "devA");
    expect(out).toHaveLength(2);
    // Sorted newest-first → devA (500) before devB (400).
    expect(out[0]!.deviceId).toBe("devA");
    expect(out[0]!.isOwn).toBe(true);
    expect(out[0]!.count).toBe(2);
    expect(out[0]!.latestTs).toBe(500);
    expect(out[1]!.deviceId).toBe("devB");
    expect(out[1]!.isOwn).toBe(false);
    expect(out[1]!.count).toBe(1);
  });

  it("separates unstamped manual vs legacy-auto files under the null bucket", () => {
    const rows = [
      row(null, "manual", 200),
      row(null, "manual", 250),
      row(null, "auto", 100),   // legacy auto (no device id)
    ];
    const out = summariseCloudDevices(rows, "devX");
    // manual (2) and legacy-auto (1) are distinct groups, both deviceId null.
    expect(out).toHaveLength(2);
    const manual = out.find(o => o.kind === "manual");
    const legacy = out.find(o => o.kind === "auto");
    expect(manual!.count).toBe(2);
    expect(manual!.latestTs).toBe(250);
    expect(legacy!.count).toBe(1);
    expect(out.every(o => o.isOwn === false)).toBe(true);
  });

  it("returns [] for empty / null input", () => {
    expect(summariseCloudDevices([], "d")).toEqual([]);
    expect(summariseCloudDevices(null, "d")).toEqual([]);
  });
});

// The other device's NAME was in the filenames all along.
//
// makeBackupName appends the writing device's name slug at the tail of every
// backup, and the sync diagnostic showed an opaque id anyway.
// Reported with a screenshot whose own file list ended in `-iphone.json` /
// `-ipad.json` while the per-device roll-up said "Cet appareil 8udtad73xz".
describe("backupDeviceName + name-aware device roll-up", () => {
  it("reads the slug off both auto and manual filenames", () => {
    expect(backupDeviceName("cave-tabac-auto-8udtad73xz-20260729-003303-t58-p20-w16-a2-j32-iphone.json"))
      .toBe("iphone");
    expect(backupDeviceName("cave-tabac-20260729-031147-t58-p20-w16-a2-j32-ipad.json"))
      .toBe("ipad");
  });

  it("returns \"\" — never a guess — when the file carries no slug", () => {
    expect(backupDeviceName("cave-tabac-auto-qsekqav94e-20260717-231409-t56-p20-w15-a2-j27.json")).toBe("");
    expect(backupDeviceName("cave-tabac-20260612-101010-t5-p2-w0-a1-j9.json")).toBe("");
    expect(backupDeviceName("")).toBe("");
    expect(backupDeviceName("garbage.json")).toBe("");
  });

  it("agrees with parseBackupCounts about where the counts end", () => {
    const n = "cave-tabac-auto-abc-20260729-003303-t58-p20-w16-a2-j32-iphone.json";
    expect(parseBackupCounts(n)).toMatchObject({ tobaccos: 58, sessions: 32 });
    expect(backupDeviceName(n)).toBe("iphone");
  });

  it("carries the foreign device's name into the roll-up", () => {
    const rows = explainCloudBackups([
      { id: "a", name: "cave-tabac-auto-8udtad73xz-20260729-003303-t58-p20-w16-a2-j32-iphone.json", modifiedTime: "2026-07-29T00:33:03Z" },
      { id: "b", name: "cave-tabac-auto-unr52hzxv1-20260729-030725-t58-p20-w16-a2-j32-ipad.json", modifiedTime: "2026-07-29T03:07:25Z" },
    ], 0, 0, 120000, null, "unr52hzxv1", OLD_STAMP);
    const devs = summariseCloudDevices(rows, "unr52hzxv1");
    const foreign = devs.find(d => d.deviceId === "8udtad73xz")!;
    expect(foreign.deviceName).toBe("iphone");
    expect(foreign.isOwn).toBe(false);
    const own = devs.find(d => d.deviceId === "unr52hzxv1")!;
    expect(own.isOwn).toBe(true);
  });

  it("splits the manual pile by device name instead of lumping it", () => {
    // Manual filenames carry NO device id — only the name slug — so before
    // the name-aware roll-up, three manual backups from two devices read as one anonymous
    // "Sauvegardes manuelles · 3 fichiers".
    const rows = explainCloudBackups([
      { id: "a", name: "cave-tabac-20260729-031147-t58-p20-w16-a2-j32-ipad.json", modifiedTime: "2026-07-29T03:11:47Z" },
      { id: "b", name: "cave-tabac-20260728-100010-t58-p20-w16-a2-j32-iphone.json", modifiedTime: "2026-07-28T10:00:10Z" },
      { id: "c", name: "cave-tabac-20260725-121505-t58-p20-w16-a2-j31-iphone.json", modifiedTime: "2026-07-25T12:15:05Z" },
    ], 0, 0, 120000, null, "unr52hzxv1", OLD_STAMP);
    const devs = summariseCloudDevices(rows, "unr52hzxv1");
    const byName: Record<string, number> = {};
    devs.forEach(d => { byName[d.deviceName] = d.count; });
    expect(byName["ipad"]).toBe(1);
    expect(byName["iphone"]).toBe(2);
  });

  it("keeps nameless unstamped files in their own bucket", () => {
    const rows = explainCloudBackups([
      { id: "a", name: "cave-tabac-20260612-101010-t5-p2-w0-a1-j9.json", modifiedTime: "2026-06-12T10:10:10Z" },
    ], 0, 0, 120000, null, "own", OLD_STAMP);
    const devs = summariseCloudDevices(rows, "own");
    expect(devs.length).toBe(1);
    expect(devs[0]!.deviceName).toBe("");
    expect(devs[0]!.deviceId).toBeNull();
  });

  it("uses the name from the NEWEST file when a device was renamed", () => {
    const rows = explainCloudBackups([
      { id: "a", name: "cave-tabac-auto-dev1-20260101-000000-t1-p0-w0-a0-j0-oldname.json", modifiedTime: "2026-01-01T00:00:00Z" },
      { id: "b", name: "cave-tabac-auto-dev1-20260701-000000-t1-p0-w0-a0-j0-newname.json", modifiedTime: "2026-07-01T00:00:00Z" },
    ], 0, 0, 120000, null, "own", OLD_STAMP);
    const devs = summariseCloudDevices(rows, "own");
    expect(devs[0]!.deviceName).toBe("newname");
  });
});
