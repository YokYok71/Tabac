/**
 * Tests for the orphan-photo garbage collector.
 *
 * `gcOrphans(referenced)` walks every key in imgCache and deletes any
 * `local-photo-*` that isn't in the referenced set. Two safety guards:
 *   - never touches non-local-photo keys (URL cache entries stay put)
 *   - skips keys whose embedded timestamp is < 5 minutes old (a photo
 *     attached in a form mid-session must survive a reload during
 *     that window)
 *
 * Mocks: imgCache.keys / imgCache.del are stubbed so we don't actually
 * hit IndexedDB. The mock is wired up per-test for clarity.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { imgCache, gcOrphans } from "../utils/imgCache";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("gcOrphans", () => {
  it("deletes local-photo-* keys not in the referenced set", async () => {
    // Keys old enough to GC (timestamps from a year ago, 1.7e12 ms).
    vi.spyOn(imgCache, "keys").mockResolvedValue([
      "local-photo-1700000000000",
      "local-photo-1700000000001",
      "local-photo-1700000000002",
    ]);
    const del = vi.spyOn(imgCache, "del").mockResolvedValue(true as any);

    const referenced = new Set<string>(["local-photo-1700000000001"]);
    const count = await gcOrphans(referenced);

    expect(count).toBe(2);
    expect(del).toHaveBeenCalledWith("local-photo-1700000000000");
    expect(del).toHaveBeenCalledWith("local-photo-1700000000002");
    expect(del).not.toHaveBeenCalledWith("local-photo-1700000000001");
  });

  it("never deletes URL cache entries (non local-photo-* keys)", async () => {
    vi.spyOn(imgCache, "keys").mockResolvedValue([
      "https://example.com/photo.jpg",
      "https://corsproxy.io/?u=foo",
      "local-photo-1700000000000",
    ]);
    const del = vi.spyOn(imgCache, "del").mockResolvedValue(true as any);

    const referenced = new Set<string>(); // nothing referenced
    const count = await gcOrphans(referenced);

    expect(count).toBe(1);
    expect(del).toHaveBeenCalledWith("local-photo-1700000000000");
    expect(del).not.toHaveBeenCalledWith("https://example.com/photo.jpg");
    expect(del).not.toHaveBeenCalledWith("https://corsproxy.io/?u=foo");
  });

  it("preserves photos created within the last 5 minutes (age guard)", async () => {
    // Fresh key created 30 seconds ago.
    const recent = "local-photo-" + (Date.now() - 30_000);
    // Old key (1 year ago) — should be GC'd if not referenced.
    const old = "local-photo-1700000000000";
    vi.spyOn(imgCache, "keys").mockResolvedValue([recent, old]);
    const del = vi.spyOn(imgCache, "del").mockResolvedValue(true as any);

    const count = await gcOrphans(new Set<string>());
    expect(count).toBe(1);
    expect(del).toHaveBeenCalledWith(old);
    expect(del).not.toHaveBeenCalledWith(recent);
  });

  it("treats unparseable local-photo-* keys (no embedded timestamp) as old enough to GC", async () => {
    // A key shaped local-photo-* but with no numeric suffix — defensive
    // path for old or hand-edited entries. Should be GC'd if unreferenced.
    vi.spyOn(imgCache, "keys").mockResolvedValue(["local-photo-legacy"]);
    const del = vi.spyOn(imgCache, "del").mockResolvedValue(true as any);

    const count = await gcOrphans(new Set<string>());
    expect(count).toBe(1);
    expect(del).toHaveBeenCalledWith("local-photo-legacy");
  });

  it("resolves with 0 when no keys are present", async () => {
    vi.spyOn(imgCache, "keys").mockResolvedValue([]);
    const del = vi.spyOn(imgCache, "del").mockResolvedValue(true as any);

    const count = await gcOrphans(new Set<string>());
    expect(count).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });

  it("resolves with 0 when every old key is in the referenced set", async () => {
    vi.spyOn(imgCache, "keys").mockResolvedValue([
      "local-photo-1700000000000",
      "local-photo-1700000000001",
    ]);
    const del = vi.spyOn(imgCache, "del").mockResolvedValue(true as any);

    const referenced = new Set<string>([
      "local-photo-1700000000000",
      "local-photo-1700000000001",
    ]);
    const count = await gcOrphans(referenced);
    expect(count).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });
});
