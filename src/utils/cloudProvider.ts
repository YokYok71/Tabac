// cloudProvider.ts — cloud-backup provider abstraction.
//
// The interface captures the five wire operations the sync layer needs
// from ANY cloud backend: list backups, upload a new file, overwrite an
// existing one, download, delete. `gdriveProvider` is the first
// implementation; a future DropboxProvider implements the same contract
// behind its own auth (step 3b).
//
// Contract decisions (deliberate, to keep the 3a migration mechanical):
//   - Methods return the RAW `Response`. The orchestration layer
//     (useGdriveSync) keeps its existing `.json()` / `.text()` parsing
//     and its 401/403 → tkClear → retry handling byte-identical. A
//     parsed/typed contract can come later once Dropbox forces the
//     error shapes to converge.
//   - Auth is NOT part of this interface. Tokens are produced by the
//     provider-specific auth hook (useGdriveAuth today) and passed in.
//   - `orderBy` strings are passed in their pre-encoded form
//     ("createdTime+desc") so the built URLs stay byte-identical with
//     the inline versions this replaced.

import { GDRIVE_FILE_PREFIX } from "../constants.ts";
import { fetchWithTimeout, fetchRetry } from "./gdriveApi.ts";

// The minimal response surface the orchestration layer
// actually consumes (r.ok / r.status / r.json() / r.text()). A native
// fetch Response satisfies it structurally — gdriveProvider keeps
// returning raw Responses — while dropboxProvider returns lightweight
// adapters that NORMALISE Dropbox's wire shapes into the Drive-flavoured
// JSON the hook already parses ({files:[...]}, {error:{code,message}},
// {id,name}). The Drive shape is the de-facto interface contract.
export interface WireResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}

export interface CloudListOpts {
  // Drive `fields` projection, e.g. "files(id,name,createdTime)".
  fields: string;
  // Pre-encoded orderBy, e.g. "createdTime+desc" / "modifiedTime+desc".
  orderBy: string;
  // Number of network retries (fetchRetry); 0 = single attempt.
  retries?: number;
}

export interface CloudProvider {
  id: string;
  // List backup files in the app's private space.
  list(token: string, opts: CloudListOpts): Promise<WireResponse>;
  // Create a new backup file. `content` is the (possibly encrypted)
  // JSON payload.
  uploadNew(token: string, name: string, content: Blob | string): Promise<WireResponse>;
  // Overwrite an existing file in place, refreshing its name (the
  // count suffix changes on every save).
  overwrite(token: string, fileId: string, name: string, content: Blob | string): Promise<WireResponse>;
  // Download a backup's content. `timeoutMs` is caller-chosen: 180s for
  // the restore picker (full payloads with photos), 30s for the lazy
  // metadata peek.
  download(token: string, fileId: string, timeoutMs: number): Promise<WireResponse>;
  // Delete a backup file.
  remove(token: string, fileId: string): Promise<WireResponse>;
}

// Rationale: 60s timeout for multipart uploads —
// full backups with embedded photos are MB-sized and slow on mobile.
var UPLOAD_TIMEOUT_MS = 60000;

function asBlob(content: Blob | string): Blob {
  return content instanceof Blob
    ? content
    : new Blob([content], { type: "application/json" });
}

// Multipart body shared by POST (create) and PATCH (overwrite). PATCH
// only accepts mutable fields — `parents` is read-only there, so the
// caller passes it only on create.
function buildMultipart(metadata: any, content: Blob | string): FormData {
  var fd = new FormData();
  fd.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  fd.append("file", asBlob(content));
  return fd;
}

export var gdriveProvider: CloudProvider = {
  id: "gdrive",

  list: function (token, opts) {
    var url =
      "https://www.googleapis.com/drive/v3/files?q=name+contains+%27" +
      GDRIVE_FILE_PREFIX +
      "%27&spaces=appDataFolder&fields=" + opts.fields +
      "&orderBy=" + opts.orderBy;
    var init = { headers: { Authorization: "Bearer " + token } };
    return (opts.retries && opts.retries > 0)
      ? fetchRetry(url, init, opts.retries)
      : fetchWithTimeout(url, init);
  },

  uploadNew: function (token, name, content) {
    return fetchWithTimeout(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: buildMultipart(
          { name: name, mimeType: "application/json", parents: ["appDataFolder"] },
          content,
        ),
      },
      UPLOAD_TIMEOUT_MS,
    );
  },

  overwrite: function (token, fileId, name, content) {
    return fetchWithTimeout(
      "https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=multipart",
      {
        method: "PATCH",
        headers: { Authorization: "Bearer " + token },
        body: buildMultipart(
          // No `parents` on PATCH — read-only field there.
          { name: name, mimeType: "application/json" },
          content,
        ),
      },
      UPLOAD_TIMEOUT_MS,
    );
  },

  download: function (token, fileId, timeoutMs) {
    return fetchWithTimeout(
      "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media",
      { headers: { Authorization: "Bearer " + token } },
      timeoutMs,
    );
  },

  remove: function (token, fileId) {
    return fetchWithTimeout(
      "https://www.googleapis.com/drive/v3/files/" + fileId,
      { method: "DELETE", headers: { Authorization: "Bearer " + token } },
    );
  },
};

// ── Dropbox implementation (step 3b foundation) ─────────────────────────────
//
// Dropbox splits its API across two hosts: RPC endpoints on
// api.dropboxapi.com (JSON body), content endpoints on
// content.dropboxapi.com (Dropbox-API-Arg header + octet-stream body).
// The app is registered as "Scoped access / App folder", so path "" is
// the app's private folder — the appDataFolder equivalent. File ids
// ("id:xxxx") are accepted anywhere a path is, which is how the
// fileId-based interface maps cleanly.
//
// Shape normalisation: every adapter parses the Dropbox response and
// re-emits the Drive-flavoured JSON the orchestration already handles —
// {files:[{id,name,size,createdTime,modifiedTime}]} for list,
// {id,name} for uploads, {error:{code,message}} for failures (HTTP
// status recycled as error.code so the existing 401-retry branches
// fire identically).
//
// Mapping notes:
//   - Dropbox has no server-side createdTime: client_modified (set at
//     upload time) stands in for it. Both rotation orderings
//     (createdTime / modifiedTime) therefore behave like Drive's.
//   - Dropbox has no server-side orderBy: the adapter sorts client-side
//     according to opts.orderBy.
//   - `overwrite(fileId, name)` emulates Drive's PATCH-with-rename:
//     upload the NEW name (mode add — names are timestamped so they
//     never collide), then best-effort delete the old fileId. If the
//     delete loses a race, deleteLegacyAutos sweeps the leftover on the
//     next quiet save — same convergence guarantee as Drive.

function dbxWire(ok: boolean, status: number, payload: any): WireResponse {
  return {
    ok: ok,
    status: status,
    json: function () { return Promise.resolve(payload); },
    text: function () {
      return Promise.resolve(typeof payload === "string" ? payload : JSON.stringify(payload));
    },
  };
}

function dbxError(status: number, summary: string): WireResponse {
  // Recycle the HTTP status as error.code — the orchestration's
  // `error.code === 401 || error.code === 403` branches then behave
  // exactly as with Drive's JSON errors.
  return dbxWire(false, status, {
    error: { code: status, message: "Dropbox: " + summary },
  });
}

function dbxRpc(
  token: string, endpoint: string, arg: any, retries?: number,
): Promise<Response> {
  // `retries` HONOURED, and it was in the interface all along.
  // `CloudProvider.list`'s option is documented "Number of network retries
  // (fetchRetry); 0 = single attempt", Drive reads it — and this side went
  // straight to `fetchWithTimeout`, so the four callers that ask for two
  // attempts (manual save, restore listing, and BOTH directions of the
  // catalogue stream) had no net at all on Dropbox: one dropped packet lost
  // the whole operation. Optional, so omitting it keeps the single attempt
  // every other Dropbox call has always made.
  var url = "https://api.dropboxapi.com/2/" + endpoint;
  var init = {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(arg),
  };
  return (retries && retries > 0)
    ? fetchRetry(url, init, retries)
    : fetchWithTimeout(url, init);
}

function dbxParse(r: Response): Promise<{ status: number; ok: boolean; body: any }> {
  return r.text().then(function (txt) {
    var body: any;
    try { body = JSON.parse(txt); } catch (_e) { body = { error_summary: txt }; }
    return { status: r.status, ok: r.ok, body: body };
  });
}

function dbxUpload(
  token: string, name: string, content: Blob | string,
  retriesLeft: number = 1,
): Promise<{ status: number; ok: boolean; body: any }> {
  return fetchWithTimeout(
    "https://content.dropboxapi.com/2/files/upload",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Dropbox-API-Arg": JSON.stringify({
          path: "/" + name,
          mode: "add",
          // Switched autorename from false to true to
          // survive same-second name collisions on a rapid double-tap
          // (makeBackupName is granular to the second; two manual saves
          // within < 1 s would otherwise return path/conflict and the
          // user thought they'd saved). With autorename:true the second
          // upload lands as `cave-tabac-…(1).json` — visible in the
          // backup list, restorable, no silent failure.
          autorename: true,
          mute: true,
        }),
        "Content-Type": "application/octet-stream",
      },
      body: asBlob(content),
    },
    UPLOAD_TIMEOUT_MS,
  ).then(dbxParse).then(function (res) {
    // One retry on Dropbox's per-namespace write lock.
    // The delete sweep runs DETACHED, so a follow-up auto-save's
    // upload can briefly overlap an in-flight delete and get a 429
    // `too_many_write_operations`. A single short backoff clears it.
    var summary = (res.body && res.body.error_summary) || "";
    var locked = res.status === 429 || summary.indexOf("too_many_write_operations") >= 0;
    if (!res.ok && locked && retriesLeft > 0) {
      return new Promise(function (resolve) { setTimeout(resolve, 600); })
        .then(function () { return dbxUpload(token, name, content, retriesLeft - 1); });
    }
    return res;
  });
}

// LABEL-CONTRACT:start dropbox-wire — see scripts/label-contracts.json
export var dropboxProvider: CloudProvider = {
  id: "dropbox",

  list: function (token, opts) {
    return dbxRpc(token, "files/list_folder", {
      path: "",
      recursive: false,
      limit: 500,
    }, opts.retries)
      .then(dbxParse)
      .then(function (res) {
        if (!res.ok) {
          return dbxError(res.status, (res.body && res.body.error_summary) || "list failed");
        }
        var files = ((res.body && res.body.entries) || [])
          .filter(function (e: any) {
            return e[".tag"] === "file" &&
              typeof e.name === "string" &&
              e.name.indexOf(GDRIVE_FILE_PREFIX) === 0;
          })
          .map(function (e: any) {
            return {
              id: e.id,
              name: e.name,
              size: String(e.size != null ? e.size : ""),
              createdTime: e.client_modified || "",
              modifiedTime: e.server_modified || "",
            };
          });
        var desc = /\+desc$/.test(opts.orderBy);
        var key = opts.orderBy.indexOf("modifiedTime") === 0 ? "modifiedTime" : "createdTime";
        files.sort(function (a: any, b: any) {
          var da = a[key] ? new Date(a[key]).getTime() : 0;
          var db = b[key] ? new Date(b[key]).getTime() : 0;
          return desc ? db - da : da - db;
        });
        return dbxWire(true, 200, { files: files });
      });
  },

  uploadNew: function (token, name, content) {
    return dbxUpload(token, name, content).then(function (res) {
      if (!res.ok) {
        return dbxError(res.status, (res.body && res.body.error_summary) || "upload failed");
      }
      return dbxWire(true, 200, { id: res.body.id, name: res.body.name });
    });
  },

  overwrite: function (token, _fileId, name, content) {
    // NO internal delete of the old fileId here. Dropbox
    // serializes writes per namespace and 429s concurrent ones — firing
    // this delete in parallel with the caller's sweep (and the upload
    // that just finished) was part of why nothing got deleted. The auto
    // file cleanup is owned entirely by useGdriveSync.sweepOwnAutoStragglers,
    // which runs the deletes SEQUENTIALLY after the upload resolves. The
    // overwrite target is always one of this device's own/legacy auto
    // files, so the sweep deletes it (its id !== the new keepId). `name`
    // stays in the signature for interface parity with Drive's PATCH.
    return dbxUpload(token, name, content).then(function (res) {
      if (!res.ok) {
        return dbxError(res.status, (res.body && res.body.error_summary) || "upload failed");
      }
      return dbxWire(true, 200, { id: res.body.id, name: res.body.name });
    });
  },

  download: function (token, fileId, timeoutMs) {
    // Content endpoint: arg goes in the Dropbox-API-Arg header, the
    // response body IS the file content — a raw Response already
    // satisfies WireResponse (.ok/.status/.text()).
    return fetchWithTimeout(
      "https://content.dropboxapi.com/2/files/download",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Dropbox-API-Arg": JSON.stringify({ path: fileId }),
        },
      },
      timeoutMs,
    );
  },

  remove: function (token, fileId) {
    // One retry on Dropbox's write-lock rejection. Even
    // with sequential deletes, Dropbox can briefly 429
    // (`too_many_write_operations`) or 409 (`too_many_write_operations`
    // under the lock_conflict tag) right after an upload while the
    // namespace lock settles. A single retry after a short backoff clears
    // the transient case; a hard failure still normalises to dbxError.
    function attempt(retriesLeft: number): Promise<WireResponse> {
      return dbxRpc(token, "files/delete_v2", { path: fileId })
        .then(dbxParse)
        .then(function (res) {
          if (res.ok) return dbxWire(true, 200, {});
          var summary = (res.body && res.body.error_summary) || "";
          var locked =
            res.status === 429 || summary.indexOf("too_many_write_operations") >= 0;
          if (locked && retriesLeft > 0) {
            return new Promise(function (resolve) {
              setTimeout(resolve, 500);
            }).then(function () { return attempt(retriesLeft - 1); });
          }
          return dbxError(res.status, summary || "delete failed");
        });
    }
    return attempt(1);
  },
};
// LABEL-CONTRACT:end dropbox-wire
