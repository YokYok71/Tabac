// Did the last local write of the cellar FAIL? Held in MEMORY, deliberately:
// it matters exactly when localStorage is full, which is also when a flag
// written there would fail to land.
//
// Why it exists: the cloud auto-save uploads what is ON DISK (`lsGet(SK)`)
// and, when disk has not moved during the upload, declares the cellar synced.
// After a failed local save the in-memory edits exist nowhere on disk, so it
// uploaded the OLD copy and cleared « non synchronisé » — the user was told
// their latest changes were safe in the cloud while they were in neither
// place. While this is set, the auto-save skips (diag `skip-local-write-failed`)
// and the unsynced state stays up; the next successful save() clears it.

var failed = false;

export function setLocalWriteFailed(v: boolean): void {
  failed = !!v;
}

export function localWriteFailed(): boolean {
  return failed;
}
