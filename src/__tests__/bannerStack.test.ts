import { describe, it, expect } from "vitest";
import { pickTopBanner, TOP_BANNER_ORDER } from "../utils/bannerStack.ts";

// Five overlays share `position: fixed; top: 0`, so any two
// visible at once are stacked in the same rectangle. Mutual exclusion used to
// be pairwise and incomplete; this locks the ONE ordered decision.
describe("pickTopBanner — exactly one top:0 banner, always", () => {
  it("returns null when nothing is pending", () => {
    expect(pickTopBanner({})).toBeNull();
    expect(pickTopBanner(null)).toBeNull();
    expect(pickTopBanner(undefined)).toBeNull();
  });

  it("never returns more than one — it returns one id or none", () => {
    const all = {
      saveError: "boom", saveWarn: "quota", photoErr: "photo",
      cloudNewerBackup: { id: "f1" }, exportReminder: true,
    };
    expect(pickTopBanner(all)).toBe("saveError");
  });

  it("orders failures above data above nags", () => {
    expect(pickTopBanner({ saveWarn: "q", photoErr: "p", cloudNewerBackup: {}, exportReminder: true }))
      .toBe("saveWarn");
    expect(pickTopBanner({ photoErr: "p", cloudNewerBackup: {}, exportReminder: true }))
      .toBe("photoErr");
    // THE REPORTED COLLISION: these two shared z-index 489, and the export
    // reminder rendered last so it painted over the cloud-newer offer while
    // the taller offer stuck out below it on a narrow screen. Tapping the
    // green bar opens Settings → Données, i.e. the backup screen.
    expect(pickTopBanner({ cloudNewerBackup: {}, exportReminder: true }))
      .toBe("cloudNewer");
    expect(pickTopBanner({ exportReminder: true })).toBe("exportReminder");
  });

  it("the photo error yields to the quota warning (it used to yield only to saveError)", () => {
    expect(pickTopBanner({ saveWarn: "q", photoErr: "p" })).toBe("saveWarn");
  });

  it("stands the cloud-newer bar down on Home, which renders its own in-flow", () => {
    expect(pickTopBanner({ cloudNewerBackup: {}, isHome: true })).toBeNull();
    // …and lets a lower-priority banner through in that case, rather than
    // blocking the row for a banner that is not being drawn.
    expect(pickTopBanner({ cloudNewerBackup: {}, isHome: true, exportReminder: true }))
      .toBe("exportReminder");
  });

  it("the declared order matches the implementation, for every single-flag case", () => {
    const flag: Record<string, string> = {
      saveError: "saveError", saveWarn: "saveWarn", photoErr: "photoErr",
      cloudNewer: "cloudNewerBackup", exportReminder: "exportReminder",
    };
    TOP_BANNER_ORDER.forEach(id => {
      expect(pickTopBanner({ [flag[id]!]: true })).toBe(id);
    });
  });

  it("is exhaustive: every id the order declares is reachable, and nothing else is returned", () => {
    const seen = new Set<string>();
    // 2^5 combinations — the pick must always be null or a declared id.
    for (let m = 0; m < 32; m++) {
      const s = {
        saveError: !!(m & 1) || undefined,
        saveWarn: !!(m & 2) || undefined,
        photoErr: !!(m & 4) || undefined,
        cloudNewerBackup: !!(m & 8) || undefined,
        exportReminder: !!(m & 16) || undefined,
      };
      const got = pickTopBanner(s);
      if (got !== null) {
        expect(TOP_BANNER_ORDER).toContain(got);
        seen.add(got);
      }
    }
    expect(seen.size).toBe(TOP_BANNER_ORDER.length);
  });
});

// No banner may paint over an open modal.
//
// The five sit at z489-492; the shared Modal is z200 and the lightbox z250. A
// banner raised while one is open covers its header (including the 44px close
// X) and sits outside the modal's focus trap. The reachable case is
// destructive: with Settings open, "Vérifier les sauvegardes cloud" can raise
// the cloud-newer banner, whose "Restaurer" replaces the whole cellar with no
// confirmation — landing exactly where the user reaches to close Settings.
describe("pickTopBanner — stands down while a modal is open", () => {
  it("suppresses even the most urgent banner while Settings is open", () => {
    expect(pickTopBanner({ saveError: "boom", importModal: true })).toBeNull();
  });

  it("suppresses the destructive cloud-newer offer over Settings", () => {
    expect(pickTopBanner({ cloudNewerBackup: { id: "f1" }, importModal: true })).toBeNull();
  });

  it("covers every modal surface, not just Settings", () => {
    expect(pickTopBanner({ exportReminder: true, searchOpen: true })).toBeNull();
    expect(pickTopBanner({ exportReminder: true, trashOpen: true })).toBeNull();
    expect(pickTopBanner({ exportReminder: true, lightbox: "local-photo-1" })).toBeNull();
  });

  it("loses nothing — the same state shows the banner once the modal closes", () => {
    const s = { cloudNewerBackup: { id: "f1" } };
    expect(pickTopBanner({ ...s, importModal: true })).toBeNull();
    expect(pickTopBanner(s)).toBe("cloudNewer");
  });

  it("a falsy lightbox key does not count as an open modal", () => {
    expect(pickTopBanner({ exportReminder: true, lightbox: null })).toBe("exportReminder");
    expect(pickTopBanner({ exportReminder: true, lightbox: "" })).toBe("exportReminder");
    expect(pickTopBanner({ exportReminder: true, importModal: false })).toBe("exportReminder");
  });
});

// The hook-order violation, locked at the source level.
// `cloudProviderId` is live ctx state and CuratorOverlays is mounted with no
// key, so an early return above the hooks changes a MOUNTED component's hook
// count when the user flips the destination in Settings.
describe("CuratorDriveExpiredBanner — provider gate sits BELOW the hooks", () => {
  it("has no cloudProviderId early return before its first useState", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/views/curator/Overlays.tsx", "utf8");
    const start = src.indexOf("export function CuratorDriveExpiredBanner");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, start + 4000);
    const firstHook = body.indexOf("useState(");
    const gate = body.indexOf('cloudProviderId === "dropbox"');
    expect(firstHook).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    // Strip comments so the explanatory note above the hooks cannot match.
    const codeBeforeHook = body.slice(0, firstHook).replace(/\/\/[^\n]*/g, "");
    expect(codeBeforeHook).not.toContain('cloudProviderId === "dropbox"');
    expect(gate).toBeGreaterThan(firstHook);
  });
});
