/**
 * Tests for src/utils/cloudProvider.ts (step 3a of the
 * Drive split). Locks the wire contract of gdriveProvider so the
 * useGdriveSync orchestration can rely on it — and so a future
 * DropboxProvider has an executable specification of what the
 * interface's five operations must do.
 *
 * The URL shapes asserted here are byte-identical to the earlier
 * inline fetches in useGdriveSync.ts — that equivalence is the whole
 * point of the mechanical 3a migration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gdriveProvider } from "../utils/cloudProvider";
import { GDRIVE_FILE_PREFIX } from "../constants";

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  globalThis.fetch = fetchSpy as any;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("gdriveProvider.list", () => {
  it("builds the appDataFolder prefix query with the requested fields and orderBy", async () => {
    await gdriveProvider.list("tok", {
      fields: "files(id,name,createdTime)",
      orderBy: "createdTime+desc",
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://www.googleapis.com/drive/v3/files?q=name+contains+%27" +
      GDRIVE_FILE_PREFIX +
      "%27&spaces=appDataFolder&fields=files(id,name,createdTime)&orderBy=createdTime+desc",
    );
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.method).toBeUndefined(); // GET
  });

  it("retries on network failure when retries > 0", async () => {
    vi.useFakeTimers();
    fetchSpy
      .mockRejectedValueOnce(new Error("net down"))
      .mockResolvedValueOnce({ ok: true });
    const p = gdriveProvider.list("tok", {
      fields: "files(id)", orderBy: "createdTime+desc", retries: 2,
    });
    await vi.advanceTimersByTimeAsync(1600); // 1.5s retry pause
    await expect(p).resolves.toMatchObject({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not retry when retries is omitted", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("net down"));
    await expect(
      gdriveProvider.list("tok", { fields: "files(id)", orderBy: "createdTime+desc" }),
    ).rejects.toThrow("net down");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("gdriveProvider.uploadNew", () => {
  it("POSTs multipart with name + appDataFolder parent in the metadata part", async () => {
    await gdriveProvider.uploadNew("tok", "cave-tabac-x.json", "{\"a\":1}");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.body).toBeInstanceOf(FormData);
    const meta = JSON.parse(await (init.body.get("metadata") as Blob).text());
    expect(meta).toEqual({
      name: "cave-tabac-x.json",
      mimeType: "application/json",
      parents: ["appDataFolder"],
    });
    expect(await (init.body.get("file") as Blob).text()).toBe("{\"a\":1}");
  });

  it("accepts a pre-built Blob as content (gdriveSave path)", async () => {
    const blob = new Blob(["{\"b\":2}"], { type: "application/json" });
    await gdriveProvider.uploadNew("tok", "n.json", blob);
    const body = fetchSpy.mock.calls[0]![1].body as FormData;
    expect(await (body.get("file") as Blob).text()).toBe("{\"b\":2}");
  });
});

describe("gdriveProvider.overwrite", () => {
  it("PATCHes the file id with a rename and WITHOUT parents (read-only on PATCH)", async () => {
    await gdriveProvider.overwrite("tok", "fid123", "renamed.json", "{}");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://www.googleapis.com/upload/drive/v3/files/fid123?uploadType=multipart",
    );
    expect(init.method).toBe("PATCH");
    const meta = JSON.parse(await (init.body.get("metadata") as Blob).text());
    expect(meta).toEqual({ name: "renamed.json", mimeType: "application/json" });
    expect(meta.parents).toBeUndefined();
  });
});

describe("gdriveProvider.download", () => {
  it("GETs alt=media with the caller-chosen timeout signal", async () => {
    await gdriveProvider.download("tok", "fid9", 180000);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://www.googleapis.com/drive/v3/files/fid9?alt=media",
    );
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts when the timeout elapses", async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation((_u: any, o: any) =>
      new Promise((_res, rej) => {
        o.signal.addEventListener("abort", () =>
          rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
    );
    const p = gdriveProvider.download("tok", "fid", 30000);
    const guard = expect(p).rejects.toMatchObject({ name: "AbortError" });
    vi.advanceTimersByTime(30001);
    await guard;
    vi.useRealTimers();
  });
});

describe("gdriveProvider.remove", () => {
  it("DELETEs the file id with Bearer auth", async () => {
    await gdriveProvider.remove("tok", "fid7");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://www.googleapis.com/drive/v3/files/fid7");
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });
});

// ── dropboxProvider ────────────────────────────────────────────────
// The adapters must emit Drive-flavoured JSON — that's the WireResponse
// contract the orchestration parses.

import { dropboxProvider } from "../utils/cloudProvider";

describe("dropboxProvider.list", () => {
  it("normalises entries to the Drive shape, filters foreign files, sorts per orderBy", async () => {
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({
        entries: [
          { ".tag": "file", id: "id:b", name: GDRIVE_FILE_PREFIX + "b.json", size: 10,
            client_modified: "2026-02-01T00:00:00Z", server_modified: "2026-02-02T00:00:00Z" },
          { ".tag": "file", id: "id:x", name: "unrelated.txt", size: 5,
            client_modified: "2026-03-01T00:00:00Z", server_modified: "2026-03-01T00:00:00Z" },
          { ".tag": "folder", id: "id:dir", name: GDRIVE_FILE_PREFIX + "dir" },
          { ".tag": "file", id: "id:a", name: GDRIVE_FILE_PREFIX + "a.json", size: 20,
            client_modified: "2026-01-01T00:00:00Z", server_modified: "2026-01-02T00:00:00Z" },
        ],
      })),
    });
    const r = await dropboxProvider.list("tok", {
      fields: "files(id,name,createdTime)", orderBy: "createdTime+desc",
    });
    expect(r.ok).toBe(true);
    const data = await r.json();
    expect(data.files.map((f: any) => f.id)).toEqual(["id:b", "id:a"]);
    expect(data.files[0]).toEqual({
      id: "id:b", name: GDRIVE_FILE_PREFIX + "b.json", size: "10",
      createdTime: "2026-02-01T00:00:00Z", modifiedTime: "2026-02-02T00:00:00Z",
    });
    // RPC endpoint + JSON body
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://api.dropboxapi.com/2/files/list_folder");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ path: "", recursive: false, limit: 500 });
  });

  it("maps an HTTP 401 to the Drive error shape so the retry branches fire", async () => {
    fetchSpy.mockResolvedValue({
      ok: false, status: 401,
      text: () => Promise.resolve(JSON.stringify({ error_summary: "expired_access_token/" })),
    });
    const r = await dropboxProvider.list("tok", { fields: "", orderBy: "createdTime+desc" });
    const data = await r.json();
    expect(data.error.code).toBe(401);
    expect(data.error.message).toContain("expired_access_token");
  });
});

describe("dropboxProvider.uploadNew", () => {
  it("POSTs to the content host with Dropbox-API-Arg and returns {id,name}", async () => {
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({ id: "id:new", name: "n.json" })),
    });
    const r = await dropboxProvider.uploadNew("tok", "n.json", "{}");
    expect((await r.json())).toEqual({ id: "id:new", name: "n.json" });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://content.dropboxapi.com/2/files/upload");
    const arg = JSON.parse(init.headers["Dropbox-API-Arg"]);
    // autorename flipped to true so a same-second name
    // collision lands as `…(1).json` instead of returning path/conflict.
    expect(arg).toEqual({ path: "/n.json", mode: "add", autorename: true, mute: true });
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
  });
});

describe("dropboxProvider.overwrite", () => {
  // overwrite NO LONGER deletes the old fileId internally.
  // Dropbox 429s concurrent writes, so the auto-file cleanup is owned by
  // the SEQUENTIAL sweepOwnAutoStragglers in useGdriveSync instead. The
  // overwrite is now just "upload new name, return new id".
  it("uploads the new name and returns the new id WITHOUT an internal delete", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({ id: "id:new", name: "renamed.json" })),
    });
    const r = await dropboxProvider.overwrite("tok", "id:old", "renamed.json", "{}");
    expect((await r.json()).id).toBe("id:new");
    // Exactly ONE call (the upload). No delete_v2 fired here anymore.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url1] = fetchSpy.mock.calls[0]!;
    expect(String(url1)).toBe("https://content.dropboxapi.com/2/files/upload");
  });

  it("surfaces the upload error", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 401,
      text: () => Promise.resolve(JSON.stringify({ error_summary: "expired_access_token/" })),
    });
    const r = await dropboxProvider.overwrite("tok", "id:old", "n.json", "{}");
    expect((await r.json()).error.code).toBe(401);
  });
});

describe("dropboxProvider.download / remove", () => {
  it("download posts to the content host with the path in Dropbox-API-Arg", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("FILE") });
    const r = await dropboxProvider.download("tok", "id:f", 180000);
    await expect(r.text()).resolves.toBe("FILE");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://content.dropboxapi.com/2/files/download");
    expect(JSON.parse(init.headers["Dropbox-API-Arg"])).toEqual({ path: "id:f" });
  });

  it("remove calls files/delete_v2 and normalises the error shape on failure", async () => {
    fetchSpy.mockResolvedValue({
      ok: false, status: 409,
      text: () => Promise.resolve(JSON.stringify({ error_summary: "path_lookup/not_found/" })),
    });
    const r = await dropboxProvider.remove("tok", "id:gone");
    expect(r.ok).toBe(false);
    expect((await r.json()).error.code).toBe(409);
  });

  // remove retries ONCE on Dropbox's write-lock rejection
  // (429 / too_many_write_operations). This locks the retry-then-success
  // branch (the audit flagged it as the one untested path in the riskiest
  // backup code).
  it("remove retries once on 429 and succeeds on the second attempt", async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: false, status: 429,
        text: () => Promise.resolve(JSON.stringify({ error_summary: "too_many_write_operations/..." })),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({})),
      });
    const r = await dropboxProvider.remove("tok", "id:busy");
    expect(r.ok).toBe(true);
    // Two delete_v2 calls = original + one retry.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("https://api.dropboxapi.com/2/files/delete_v2");
    expect(String(fetchSpy.mock.calls[1]![0])).toBe("https://api.dropboxapi.com/2/files/delete_v2");
  });

  it("remove gives up after one retry if the 429 persists", async () => {
    fetchSpy.mockResolvedValue({
      ok: false, status: 429,
      text: () => Promise.resolve(JSON.stringify({ error_summary: "too_many_write_operations/..." })),
    });
    const r = await dropboxProvider.remove("tok", "id:stuck");
    expect(r.ok).toBe(false);
    expect((await r.json()).error.code).toBe(429);
    // original + exactly one retry = 2 attempts, then it surfaces the error.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
