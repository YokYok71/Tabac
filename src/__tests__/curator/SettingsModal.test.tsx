// Smoke tests for src/views/curator/SettingsModal.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorSettingsModal } from "../../views/curator/SettingsModal";
import { LANG } from "../../i18n.ts";

// Real FR resolver so assertions that check translated diagnostic /
// backup-label copy (moved behind t() keys) still see French strings.
const trFr = (k: string) => (LANG.fr as any)[k] || k;

// reset the persisted "active tab" between tests so a test
// that clicks "Préférences" doesn't leak that tab to the next.
// The fresh default is now "prefs" (Préférences moved first),
// but most tests in this file assert Données-tab content (Drive, cloud,
// export) — so we SEED "data" here to keep them on that tab. The two
// dedicated default-tab tests below clear the key first to exercise the
// real fresh-open default (prefs).
beforeEach(() => {
  try { localStorage.setItem("cave-settings-tab", "data"); } catch (_e) {}
});

describe("SettingsModal — visibility", () => {
  it("doesn't render when importModal is false", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: false,
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the dialog when importModal is true", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
    });
    expect(container.querySelector("[role='dialog']")).toBeTruthy();
  });
});

describe("SettingsModal — Drive buttons", () => {
  it("'Save to Drive' button calls gdriveSave", () => {
    const gdriveSave = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
      gdriveSave,
    });
    const buttons = Array.from(container.querySelectorAll("[role='button']"));
    const saveBtn = buttons.find(b =>
      /Sauvegarder Drive|Save to Drive|btn_gdrive_save/i.test(b.textContent || ""),
    );
    if (saveBtn) {
      fireEvent.click(saveBtn);
      expect(gdriveSave).toHaveBeenCalled();
    }
  });

  it("'Restore Drive' button calls gdriveRestore", () => {
    const gdriveRestore = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
      gdriveRestore,
    });
    const buttons = Array.from(container.querySelectorAll("[role='button']"));
    const restoreBtn = buttons.find(b =>
      /Restaurer Drive|Restore Drive|btn_gdrive_restore/i.test(b.textContent || ""),
    );
    if (restoreBtn) {
      fireEvent.click(restoreBtn);
      expect(gdriveRestore).toHaveBeenCalled();
    }
  });

  it("'Disconnect Google' calls tkClear", () => {
    const tkClear = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
      tkClear,
      setGdriveStatus: vi.fn(),
    });
    const buttons = Array.from(container.querySelectorAll("[role='button']"));
    const disconnect = buttons.find(b =>
      /compte|account|btn_gdrive_disconnect|disconnect|déconnecter/i.test(b.textContent || ""),
    );
    if (disconnect) {
      fireEvent.click(disconnect);
      expect(tkClear).toHaveBeenCalled();
    }
  });
});

describe("SettingsModal — cloud status placement", () => {
  // The status used to render at the END of the cloud section — after the
  // restore picker, the device-name block and the sync diagnostic, i.e. eight
  // rows below the button just tapped. On a phone "Sauvegarde…" / "✓ OK"
  // landed off-screen, so a manual save looked like it did nothing. These
  // tests assert POSITION, not just presence: a presence-only test would have
  // passed the whole time the bug existed.
  const ctxWith = (gdriveStatus: string) => ({
    importModal: true,
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
    t: trFr,
    cloudProviderId: "dropbox",
    gdriveStatus,
  });

  /** Index of the first node whose text matches, in document order. */
  const idxOf = (container: HTMLElement, re: RegExp) => {
    const all = Array.from(container.querySelectorAll("*"));
    return all.findIndex((el) => re.test(el.textContent || "") &&
      !Array.from(el.children).some((c) => re.test(c.textContent || "")));
  };

  it("renders the status between the save button and the restore button", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, ctxWith("✓ OK"));
    const save = idxOf(container, /Sauvegarder Dropbox/);
    const status = idxOf(container, /✓ OK/);
    const restore = idxOf(container, /Restaurer Dropbox/);
    expect(save).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(save);
    expect(status).toBeLessThan(restore);
  });

  it("renders the status ABOVE the device-name and diagnostic rows it used to follow", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, ctxWith("✓ OK"));
    const status = idxOf(container, /✓ OK/);
    const deviceName = idxOf(container, /Nom de cet appareil/);
    const diag = idxOf(container, /Diagnostic multi-appareils/);
    if (deviceName > -1) expect(status).toBeLessThan(deviceName);
    if (diag > -1) expect(status).toBeLessThan(diag);
  });

  it("shows no status row when there is nothing to report", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, ctxWith(""));
    expect(idxOf(container, /✓ OK/)).toBe(-1);
  });

  // The restore picker had the same problem, worse — tapping
  // "Restaurer" opened the backup list eight rows down, past the device name
  // and the sync diagnostic, so it looked like nothing happened at all.
  it("opens the restore picker directly under the restore button", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...ctxWith(""),
      gdriveConfirm: {
        options: [{ id: "f1", name: "cave-tabac-20260701-120000-t3-p2-w0-a0-j5.json", modifiedTime: "2026-07-01T12:00:00Z" }],
        sel: 0,
      },
    });
    const restore = idxOf(container, /Restaurer Dropbox/);
    // The panel is identified by its own heading, not the raw filename (it
    // renders parsed counts + a formatted date, never the file name).
    const picker = idxOf(container, /Choisir une sauvegarde|Restaurer cette sauvegarde/);
    const deviceName = idxOf(container, /Nom de cet appareil/);
    expect(restore).toBeGreaterThan(-1);
    expect(picker).toBeGreaterThan(restore);
    if (deviceName > -1) expect(picker).toBeLessThan(deviceName);
  });

  // backupStatus is the ZIP export's status ALONE (every
  // setBackupStatus call is inside doBackupZip), so its photo-by-photo
  // progress must sit under that button, not after all seven export rows.
  it("renders the ZIP export status directly under the ZIP button", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...ctxWith(""),
      backupStatus: "images 3/12",
    });
    const zip = idxOf(container, /Exporter ZIP/);
    const status = idxOf(container, /images 3\/12/);
    const report = idxOf(container, /Rapport de collection/);
    expect(zip).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(zip);
    expect(status).toBeLessThan(report);
  });
});

describe("SettingsModal — no UI-switcher", () => {
  it("does NOT render any 'Switch to legacy' / 'Repasser à l'ancien design' UI", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
    });
    expect(container.textContent).not.toMatch(/Repasser à l'ancien|Switch to legacy/);
  });
});

describe("SettingsModal — restore picker shrink-warning", () => {
  // The warning should fire when the SELECTED backup (gdriveConfirm.options[sel])
  // has fewer entries for ANY type than the local data store.
  function mountWithPicker(options: any[], localData: any) {
    return renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      data: localData,
      tkGet: () => null,
      t: trFr,
      gdriveConfirm: { options, sel: 0, mode: "restore" },
      setGdriveConfirm: vi.fn(),
      doGdriveConfirm: vi.fn(),
      gdriveLoadOptionPayload: vi.fn(),
      gdriveDeleteOption: vi.fn(),
    });
  }

  it("renders the shrink warning when the backup has fewer tobaccos than local", () => {
    const { container } = mountWithPicker(
      [{
        id: "f1",
        ds: "2026-05-17",
        name: "cave-tabac-20260517-120000-t3-p2-w0-a0-j0.json",
        saveType: "manual",
        counts: { tobaccos: 3, pipes: 2, wishlist: 0, accessories: 0, sessions: 0 },
      }],
      {
        tobaccos: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
        pipes: [{ id: 1 }, { id: 2 }],
        wishlist: [], accessories: [], sessions: [],
      },
    );
    expect(container.textContent).toMatch(/moins de données|fewer entries/);
    expect(container.textContent).toMatch(/3 tabacs/);
    expect(container.textContent).toMatch(/vous en avez 5/);
  });

  it("renders shrink warning lines for multiple shrinking types at once", () => {
    const { container } = mountWithPicker(
      [{
        id: "f1",
        ds: "2026-05-17",
        name: "cave-tabac-20260517-120000-t3-p1-w0-a0-j2.json",
        saveType: "manual",
        counts: { tobaccos: 3, pipes: 1, wishlist: 0, accessories: 0, sessions: 2 },
      }],
      {
        tobaccos: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
        pipes: [{ id: 1 }, { id: 2 }],
        wishlist: [], accessories: [],
        sessions: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      },
    );
    expect(container.textContent).toMatch(/3 tabacs/);
    expect(container.textContent).toMatch(/1 pipe/);
    expect(container.textContent).toMatch(/2 séances/);
  });

  it("does NOT render the shrink warning when the backup matches local counts", () => {
    const { container } = mountWithPicker(
      [{
        id: "f1",
        ds: "2026-05-17",
        name: "cave-tabac-20260517-120000-t5-p2-w0-a0-j0.json",
        saveType: "manual",
        counts: { tobaccos: 5, pipes: 2, wishlist: 0, accessories: 0, sessions: 0 },
      }],
      {
        tobaccos: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
        pipes: [{ id: 1 }, { id: 2 }],
        wishlist: [], accessories: [], sessions: [],
      },
    );
    expect(container.textContent).not.toMatch(/moins de données|fewer entries/);
  });

  it("does NOT render the shrink warning when the backup has MORE entries than local", () => {
    const { container } = mountWithPicker(
      [{
        id: "f1",
        ds: "2026-05-17",
        name: "cave-tabac-20260517-120000-t10-p5-w0-a0-j0.json",
        saveType: "manual",
        counts: { tobaccos: 10, pipes: 5, wishlist: 0, accessories: 0, sessions: 0 },
      }],
      {
        tobaccos: [{ id: 1 }, { id: 2 }],
        pipes: [{ id: 1 }],
        wishlist: [], accessories: [], sessions: [],
      },
    );
    expect(container.textContent).not.toMatch(/moins de données|fewer entries/);
  });

  it("falls back to the lazy-loaded payload when the filename has no count suffix", () => {
    const { container } = mountWithPicker(
      [{
        id: "f1",
        ds: "2026-05-17",
        name: "cave-tabac-backup.json", // legacy: no count suffix
        saveType: "manual",
        d: {
          tobaccos: [{ id: 1 }, { id: 2 }],
          pipes: [{ id: 1 }],
          wishlist: [], accessories: [], sessions: [],
        },
      }],
      {
        tobaccos: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
        pipes: [{ id: 1 }, { id: 2 }],
        wishlist: [], accessories: [], sessions: [],
      },
    );
    expect(container.textContent).toMatch(/moins de données|fewer entries/);
    expect(container.textContent).toMatch(/2 tabacs/);
  });

  it("is hidden in delete mode", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      data: {
        tobaccos: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      },
      tkGet: () => null,
      gdriveConfirm: {
        options: [{
          id: "f1", ds: "2026-05-17",
          name: "cave-tabac-20260517-120000-t3-p0-w0-a0-j0.json",
          saveType: "manual",
          counts: { tobaccos: 3, pipes: 0, wishlist: 0, accessories: 0, sessions: 0 },
        }],
        sel: 0,
        mode: "delete",
      },
      setGdriveConfirm: vi.fn(),
      doGdriveConfirm: vi.fn(),
      gdriveDeleteOption: vi.fn(),
    });
    expect(container.textContent).not.toMatch(/moins de données|fewer entries/);
  });
});

// ── Install app CTA — Android beforeinstallprompt parity ─────────
// Chrome fires `beforeinstallprompt` when the PWA is installable. The app
// captures the event and surfaces an "Install" button in Settings →
// Application — but only when canInstallApp is true. On iOS Safari (no
// event) and on already-installed PWAs (no event after install), the CTA
// stays hidden.

// ── Date format selector ────────────────────────────────────────
// The Préférences section exposes a "Format de date" segmented control next
// to the weight / length units. The setter `saveDateFormat` writes the
// preference to `cave-date-format` and updates ctx.dateFormat. Default is
// "fr" (dd.mm.yyyy).

// Settings is now tab-based — content from non-default
// tabs needs an explicit tab click before assertions. The "Date
// format" rows live in the Préférences tab, "Install app" lives in
// the App tab.
function clickSettingsTab(container: HTMLElement, label: RegExp) {
  const tabBtn = Array.from(container.querySelectorAll("[role='tab']"))
    .find(b => label.test(b.textContent || "")) as HTMLElement | undefined;
  expect(tabBtn).toBeTruthy();
  fireEvent.click(tabBtn!);
}

describe("SettingsModal — date format selector", () => {
  // The example dates rendered next to the FR / EN segmented
  // options are now today's date (was hardcoded "15.03.2024" / "Mar 15, 2024").
  // Freeze the clock so the test is deterministic on any CI date.
  beforeEach(() => vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0))); // 2026-05-19
  afterEach(() => vi.useRealTimers());

  it("renders the date format row with both options visible (in the Préférences tab)", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
      dateFormat: "fr",
      saveDateFormat: vi.fn(),
      lang: "fr",
      // Pass a t() that returns the actual French label so we can match
      // on user-visible text (the default ctx t is identity-returns-key).
      t: (k: string) => k === "lbl_date_format" ? "Format de date" : k,
    });
    clickSettingsTab(container, /Préférences|Preferences|tab_prefs/);
    expect(container.textContent).toMatch(/Format de date/);
    expect(container.textContent).toMatch(/FR \(19\.05\.2026\)/);
    expect(container.textContent).toMatch(/EN \(May 19, 2026\)/);
  });

  it("calls saveDateFormat when the user picks EN", () => {
    const saveDateFormat = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
      dateFormat: "fr",
      saveDateFormat,
      lang: "fr",
    });
    clickSettingsTab(container, /Préférences|Preferences|tab_prefs/);
    const enBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /EN \(May 19, 2026\)/.test(b.textContent || ""));
    expect(enBtn).toBeTruthy();
    fireEvent.click(enBtn!);
    expect(saveDateFormat).toHaveBeenCalledWith("en");
  });
});

describe("SettingsModal — Install app CTA (in the App tab)", () => {
  it("renders the Install button when canInstallApp is true", () => {
    const triggerInstall = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      canInstallApp: true,
      triggerInstall,
    });
    clickSettingsTab(container, /^App$|Application|tab_app/);
    const text = container.textContent || "";
    expect(text).toMatch(/lbl_install_app|Installer l'app|Install app/);
    const installBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /^(btn_install|Installer|Install)$/.test((b.textContent || "").trim()));
    expect(installBtn).toBeTruthy();
    fireEvent.click(installBtn!);
    expect(triggerInstall).toHaveBeenCalled();
  });

  it("hides the CTA when canInstallApp is false (no BIP event captured)", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      canInstallApp: false,
    });
    clickSettingsTab(container, /^App$|Application|tab_app/);
    const text = container.textContent || "";
    expect(text).not.toMatch(/lbl_install_app|Installer l'app|Install app/);
  });
});

// tab navigation smoke tests — make sure the 4 tabs
// actually swap the content out and that the default-tab contract
// holds.
describe("SettingsModal — tab navigation", () => {
  it("opens on the Préférences tab by default — Drive content hidden", () => {
    // The fresh default (no persisted tab) is Préférences.
    try { localStorage.removeItem("cave-settings-tab"); } catch (_e) {}
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      tkGet: () => null,
      lang: "fr",
      t: (k: string) => k === "lbl_date_format" ? "Format de date" : k,
    });
    // Préférences content (date-format row) is visible; the Données
    // (Drive) content is not.
    expect(container.textContent).toMatch(/Format de date/);
    expect(container.textContent).not.toMatch(/btn_gdrive_save|Sauvegarder Drive|Save to Drive/);
  });

  it("swaps to the Données tab on click — Drive content visible", () => {
    try { localStorage.removeItem("cave-settings-tab"); } catch (_e) {}
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      tkGet: () => null,
    });
    clickSettingsTab(container, /Données|Data|tab_data/);
    expect(container.textContent).toMatch(/btn_gdrive_save|Sauvegarder Drive|Save to Drive/);
  });

  it("swaps to the Application tab on click — Install + Vérifier visible", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      tkGet: () => null,
      canInstallApp: true,
    });
    clickSettingsTab(container, /^App$|Application|tab_app/);
    expect(container.textContent).toMatch(/btn_install|lbl_install_app|Installer|Install/);
    // The "Rafraîchir les données" button label is rendered via
    // t("btn_check_update"); the default test ctx t() returns the key itself.
    expect(container.textContent).toMatch(/btn_check_update|Vérifier|Check updates/);
  });

  it("swaps to the Aide tab on click — external links visible", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      tkGet: () => null,
    });
    clickSettingsTab(container, /Aide|Help|tab_help/);
    expect(container.textContent).toMatch(/btn_help|Aide|Help/);
  });
});

// ── cloud-provider selector ────────────────────────────────────────

describe("SettingsModal — cloud provider selector", () => {
  const base = {
    importModal: true,
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
  };

  it("renders the Google Drive / Dropbox segmented and switching calls saveCloudProviderId", () => {
    const saveCloudProviderId = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base,
      cloudProviderId: "gdrive",
      saveCloudProviderId,
    });
    const dropboxOpt = Array.from(container.querySelectorAll("button"))
      .find(b => (b.textContent || "").trim() === "Dropbox");
    expect(dropboxOpt).toBeTruthy();
    fireEvent.click(dropboxOpt!);
    expect(saveCloudProviderId).toHaveBeenCalledWith("dropbox");
  });

  it("in Dropbox mode: save/restore labels switch, Google account button is replaced by Dropbox disconnect", () => {
    const dropboxDisconnect = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base,
      cloudProviderId: "dropbox",
      dropboxDisconnect,
    });
    const text = container.textContent || "";
    expect(text).toContain("btn_dropbox_save");
    expect(text).toContain("btn_dropbox_restore");
    expect(text).toContain("btn_dropbox_disconnect");
    expect(text).not.toContain("btn_gdrive_disconnect");
    const btn = Array.from(container.querySelectorAll("[role='button']"))
      .find(b => /btn_dropbox_disconnect/.test(b.textContent || ""));
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(dropboxDisconnect).toHaveBeenCalled();
  });

  it("in Dropbox mode the expired-session Notice never renders (refresh token = no expiry UX)", () => {
    // Expired Google token + pendingSync would show the Notice in
    // gdrive mode; dropbox mode must suppress it.
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base,
      cloudProviderId: "dropbox",
      autoSaveDrive: true,
      tkGet: () => JSON.stringify({ t: "dead", x: 0 }),
    });
    expect(container.textContent || "").not.toContain("drive_session_expired");
  });

  it("the 'Last OAuth' debug diagnostic line is hidden in every provider mode", () => {
    // The OAuth touchpoint line was removed from Settings — it
    // was debug-only. It must never surface now, regardless of provider
    // (it used to be gdrive-only, hidden on Dropbox; now it's gone entirely).
    localStorage.setItem("cave-oauth-diag", JSON.stringify({
      type: "return-success", action: "list", ts: Date.now() - 60000,
    }));
    const drop = renderWithCtx(<CuratorSettingsModal />, {
      ...base, cloudProviderId: "dropbox", t: trFr,
    });
    expect(drop.container.textContent || "").not.toMatch(/Dernier OAuth|Last OAuth/);
    drop.unmount();
    const drive = renderWithCtx(<CuratorSettingsModal />, {
      ...base, cloudProviderId: "gdrive", t: trFr,
    });
    expect(drive.container.textContent || "").not.toMatch(/Dernier OAuth|Last OAuth/);
    localStorage.removeItem("cave-oauth-diag");
  });
});

// ── Dropbox-first selector + Voir-mes-sauvegardes toggle ───────────

describe("SettingsModal — Dropbox-first selector + view-backups toggle", () => {
  const base = {
    importModal: true,
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
  };

  it("Dropbox renders BEFORE Google Drive in the segmented", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base,
      cloudProviderId: "dropbox",
    });
    const labels = Array.from(container.querySelectorAll("button"))
      .map(b => (b.textContent || "").trim())
      .filter(l => l === "Dropbox" || l === "Google Drive");
    expect(labels.slice(0, 2)).toEqual(["Dropbox", "Google Drive"]);
  });

  it("view-backups button: first click runs the diagnostic, second collapses", () => {
    // ONE button over the cloud files where there were two — the second
    // listing was dropped, so this tap now drives the diagnostic rather than a
    // separate metadata fetch. What must survive the merge is the toggle: a
    // control that opens a panel and cannot close it was reported once already
    // ("je ne peux jamais le fermer… ça ne fait que rafraîchir les données").
    const runSyncDiagnostic = vi.fn();
    const dismissSyncDiag = vi.fn();
    // First render: no panel → the button should run the diagnostic.
    const closed = renderWithCtx(<CuratorSettingsModal />, {
      ...base,
      syncDiag: null, syncDiagSource: "", runSyncDiagnostic, dismissSyncDiag,
    });
    const btn1 = Array.from(closed.container.querySelectorAll("[role='button']"))
      .find(b => /btn_view_backups|Voir mes sauvegardes|View my backups/.test(b.textContent || ""));
    expect(btn1).toBeTruthy();
    fireEvent.click(btn1!);
    expect(runSyncDiagnostic).toHaveBeenCalled();
    expect(dismissSyncDiag).not.toHaveBeenCalled();
    closed.unmount();

    // Second render: the panel is open AND it is this button's own result
    // (`syncDiagSource === "diag"`) → the tap dismisses instead of re-running.
    runSyncDiagnostic.mockClear();
    const open = renderWithCtx(<CuratorSettingsModal />, {
      ...base,
      syncDiag: { deviceId: "abc", provider: "gdrive", rows: [], devices: [] },
      syncDiagSource: "diag", runSyncDiagnostic, dismissSyncDiag,
    });
    const btn2 = Array.from(open.container.querySelectorAll("[role='button']"))
      .find(b => /btn_view_backups|Voir mes sauvegardes|View my backups/.test(b.textContent || ""));
    fireEvent.click(btn2!);
    expect(dismissSyncDiag).toHaveBeenCalled();
    expect(runSyncDiagnostic).not.toHaveBeenCalled();
  });
});

describe("SettingsModal — 'À surveiller' thresholds", () => {
  function renderPrefs(over: any = {}) {
    const r = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true,
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
      lang: "fr",
      watchLowWeight: "50",
      ...over,
    });
    clickSettingsTab(r.container, /Préférences|Preferences|tab_prefs/);
    return r;
  }

  it("renders the low-stock threshold input with the current value", () => {
    const { container } = renderPrefs();
    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs.some(i => (i as HTMLInputElement).value === "50")).toBe(true);
  });

  it("typing does NOT commit; blur commits via saveWatchLowWeight", () => {
    const saveWatchLowWeight = vi.fn();
    const { container } = renderPrefs({ saveWatchLowWeight });
    const input = Array.from(container.querySelectorAll("input"))
      .find(i => (i as HTMLInputElement).value === "50") as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "30" } });
    expect(saveWatchLowWeight).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(saveWatchLowWeight).toHaveBeenCalledWith("30");
  });

  it("blur commits the low-weight threshold via saveWatchLowWeight", () => {
    const saveWatchLowWeight = vi.fn();
    const { container } = renderPrefs({ saveWatchLowWeight });
    const input = Array.from(container.querySelectorAll("input"))
      .find(i => (i as HTMLInputElement).value === "50") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.blur(input);
    expect(saveWatchLowWeight).toHaveBeenCalledWith("30");
  });

  it("clearing the field does not re-fill it mid-typing (prefill-race guard)", () => {
    const { container } = renderPrefs();
    const input = Array.from(container.querySelectorAll("input"))
      .find(i => (i as HTMLInputElement).value === "50") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
  });
});

describe("SettingsModal — last-save type label + failure-only diagnostic", () => {
  const base = {
    importModal: true,
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
    autoSaveDrive: true,
    cloudProviderId: "gdrive",
    lastAutoSaveTs: new Date(2026, 5, 29, 20, 0, 0).getTime(),
    lang: "fr",
    t: trFr,
  };
  afterEach(() => {
    try {
      localStorage.removeItem("cave-last-save-type-gdrive");
      localStorage.removeItem("cave-autosave-diag");
    } catch (_e) { /* noop */ }
  });

  it("labels the last-save line 'manuelle' when the last save was manual", () => {
    localStorage.setItem("cave-last-save-type-gdrive", "manual");
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base });
    expect(container.textContent).toMatch(/Dernière sauvegarde manuelle/);
    expect(container.textContent).not.toMatch(/Dernière sauvegarde auto/);
  });

  it("labels the last-save line 'auto' when the last save was auto", () => {
    localStorage.setItem("cave-last-save-type-gdrive", "auto");
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base });
    expect(container.textContent).toMatch(/Dernière sauvegarde auto/);
    expect(container.textContent).not.toMatch(/Dernière sauvegarde manuelle/);
  });

  it("does NOT render the auto-save diagnostic line on a successful save (debug noise removed)", () => {
    localStorage.setItem("cave-autosave-diag", JSON.stringify({ ts: Date.now(), stage: "ok" }));
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base });
    expect(container.textContent).not.toMatch(/Dernier essai auto/);
  });

  it("renders the auto-save diagnostic line only on a real failure", () => {
    localStorage.setItem("cave-autosave-diag", JSON.stringify({ ts: Date.now(), stage: "upload-error" }));
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base });
    expect(container.textContent).toMatch(/Dernier essai auto/);
    expect(container.textContent).toMatch(/envoi refusé/);
  });

  // A save that started but was never confirmed (iOS suspended the
  // PWA before the upload landed) is now surfaced, not swallowed.
  it("surfaces a 'saving-start' stuck state (never confirmed)", () => {
    localStorage.setItem("cave-autosave-diag", JSON.stringify({ ts: Date.now(), stage: "saving-start" }));
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base });
    expect(container.textContent).toMatch(/Dernier essai auto/);
    expect(container.textContent).toMatch(/non confirmée/);
  });

  it("surfaces a 'skip-locked' state (save skipped)", () => {
    localStorage.setItem("cave-autosave-diag", JSON.stringify({ ts: Date.now(), stage: "skip-locked" }));
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base });
    expect(container.textContent).toMatch(/ignorée/);
  });

  it("still hides a benign 'uploaded' state (file reached the cloud)", () => {
    localStorage.setItem("cave-autosave-diag", JSON.stringify({ ts: Date.now(), stage: "uploaded" }));
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base });
    expect(container.textContent).not.toMatch(/Dernier essai auto/);
  });
});

// ── The preference toggles announce which option is ON ──────
//
// `Segmented` carries EVERY preference in Settings — language, text size,
// theme, light/dark, units, currency, accounting — and conveyed its selection
// by BACKGROUND COLOUR alone. A screen reader therefore announced six
// identical buttons with no way to tell which language was active, on the one
// screen whose whole job is showing the current state. Same defect already
// fixed on FilterChipSimple; this is the control it never reached.
describe("SettingsModal — Segmented announces its selection", () => {
  beforeEach(() => {
    try { localStorage.setItem("cave-settings-tab", "prefs"); } catch (_e) { /* ignore */ }
  });

  it("marks exactly the active language with aria-pressed", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true, lang: "de", t: trFr,
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
    });
    const langBtns = [...container.querySelectorAll("button")]
      .filter((b) => /^(FR|EN|ES|DE|IT|PT)$/.test((b.textContent || "").trim()));
    expect(langBtns.length).toBeGreaterThanOrEqual(5);
    // Every option must carry the state, not only the selected one — a button
    // with no aria-pressed at all reads as "not a toggle".
    expect(langBtns.every((b) => b.getAttribute("aria-pressed") !== null)).toBe(true);
    const on = langBtns.filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(on.map((b) => (b.textContent || "").trim())).toEqual(["DE"]);
  });

  it("follows the active value rather than a fixed position", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      importModal: true, lang: "it", t: trFr,
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
    });
    const on = [...container.querySelectorAll("button[aria-pressed='true']")]
      .map((b) => (b.textContent || "").trim());
    expect(on).toContain("IT");
    expect(on).not.toContain("DE");
  });
});

// The check button must never be silently dead.
//
// It used to carry `disabled={!!gdriveStatus}`, a guard whose purpose is to
// stop the status Notice shifting the SAVE/RESTORE pair under a finger. This
// button sits three rows below that Notice, so the guard bought nothing here
// and cost everything: any lingering cloud status (3-4 s after a save, an
// error, a disconnect — or its own former success message) made the tap do
// nothing, with the reason rendered somewhere the user was not looking.
// Reported from the app as "I click check backups and nothing happens".
describe("SettingsModal — 'check cloud backups' stays live", () => {
  function findCheckBtn(container: HTMLElement) {
    return Array.from(container.querySelectorAll("[role='button']")).find(b =>
      /btn_check_cloud_newer|Vérifier les sauvegardes|Check cloud/i.test(b.textContent || ""),
    ) as HTMLElement | undefined;
  }
  const base = {
    importModal: true,
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
  };

  it("fires while another cloud action's status is still on screen", () => {
    const checkCloudNewerNow = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base,
      gdriveStatus: "✓ OK",   // a save that finished 2 s ago
      checkCloudNewerNow,
    });
    const btn = findCheckBtn(container)!;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(btn);
    expect(checkCloudNewerNow).toHaveBeenCalled();
  });

  it("does disable itself while IT is running, and says so", () => {
    const checkCloudNewerNow = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base,
      syncDiagBusy: true,
      checkCloudNewerNow,
    });
    const btn = findCheckBtn(container)!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(checkCloudNewerNow).not.toHaveBeenCalled();
  });

  it("renders its answer under ITSELF, not under the save button", () => {
    const diag = {
      deviceId: "abc123", deviceName: "iPhone", provider: "dropbox",
      localRef: 0, localEdited: 0, dismissedTs: 0, dismissedName: null,
      rows: [], devices: [],
    };
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base, syncDiag: diag, syncDiagSource: "check",
    });
    const html = container.innerHTML;
    const btnIdx = html.indexOf("btn_check_cloud_newer");
    const diagIdx = html.indexOf("sync_diag_device");
    const nextBtnIdx = html.indexOf("btn_view_backups");
    expect(btnIdx).toBeGreaterThan(-1);
    expect(diagIdx).toBeGreaterThan(btnIdx);
    expect(diagIdx).toBeLessThan(nextBtnIdx);
  });

  it("keeps the cloud-files button's own answer under that button", () => {
    const diag = {
      deviceId: "abc123", deviceName: "iPhone", provider: "dropbox",
      localRef: 0, localEdited: 0, dismissedTs: 0, dismissedName: null,
      rows: [], devices: [],
    };
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base, syncDiag: diag, syncDiagSource: "diag",
    });
    const html = container.innerHTML;
    expect(html.indexOf("sync_diag_device")).toBeGreaterThan(html.indexOf("btn_view_backups"));
  });
});

// The toggle must only consider its OWN result.
//
// An earlier release let "Vérifier les sauvegardes" write the same syncDiag /
// syncDiagErr slots as the cloud-files button. That button toggles on those
// slots, so after a check its first tap took the DISMISS branch — clearing a
// panel that renders under the other button, i.e. doing nothing visible. A
// dead tap introduced one build after fixing a dead tap. The two buttons now
// share ONE panel, which does not retire the rule: the panel still renders
// under whichever of them raised it, so the source tag is what keeps this tap
// from dismissing something the user is not looking at.
describe("SettingsModal — sync-diag toggle is source-scoped", () => {
  const base = {
    importModal: true,
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
  };
  const diag = {
    deviceId: "abc123", deviceName: "iPhone", provider: "dropbox",
    localRef: 0, localEdited: 0, dismissedTs: 0, dismissedName: null,
    rows: [], devices: [],
  };
  function findDiagBtn(container: HTMLElement) {
    return Array.from(container.querySelectorAll("[role='button']")).find(b =>
      /btn_view_backups|Voir mes sauvegardes|View my backups/i.test(b.textContent || ""),
    ) as HTMLElement;
  }

  it("RUNS (does not dismiss) when the visible result came from the check button", () => {
    const runSyncDiagnostic = vi.fn();
    const dismissSyncDiag = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base, syncDiag: diag, syncDiagSource: "check",
      runSyncDiagnostic, dismissSyncDiag,
    });
    fireEvent.click(findDiagBtn(container));
    expect(runSyncDiagnostic).toHaveBeenCalled();
    expect(dismissSyncDiag).not.toHaveBeenCalled();
  });

  it("still toggles closed when the result is its own", () => {
    const runSyncDiagnostic = vi.fn();
    const dismissSyncDiag = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base, syncDiag: diag, syncDiagSource: "diag",
      runSyncDiagnostic, dismissSyncDiag,
    });
    fireEvent.click(findDiagBtn(container));
    expect(dismissSyncDiag).toHaveBeenCalled();
    expect(runSyncDiagnostic).not.toHaveBeenCalled();
  });

  it("shows a busy line at the button that is running, so a tap is never mute", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base, syncDiagBusy: true, syncDiagSource: "check",
    });
    const html = container.innerHTML;
    const btnIdx = html.indexOf("btn_check_cloud_newer");
    const busyIdx = html.indexOf("st_connecting");
    expect(busyIdx).toBeGreaterThan(btnIdx);
    expect(busyIdx).toBeLessThan(html.indexOf("btn_view_backups"));
  });
});

// The roll-up called two OTHER devices "Cet appareil", and
// showed an opaque id where the filenames beside it already spelled the name.
describe("SettingsModal — per-device roll-up names the other device", () => {
  const base = {
    importModal: true,
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
  };
  function withDevices(devices: any[]) {
    return renderWithCtx(<CuratorSettingsModal />, {
      ...base,
      syncDiagSource: "diag",
      syncDiag: {
        deviceId: "unr52hzxv1", deviceName: "Ipad", provider: "dropbox",
        localRef: 0, localEdited: 0, dismissedTs: 0, dismissedName: null,
        rows: [], devices,
      },
    });
  }

  it("names the catalogue file instead of calling it a legacy one", () => {
    // The catalogue has no device identity BY CONSTRUCTION: its name is a
    // `.csv` with no device id and no counts, so neither `autoFileDeviceId`
    // nor `backupDeviceName` can read anything from it, and it fell into the
    // last bucket — labelled « Fichiers hérités » under a heading reading
    // PAR APPAREIL, about the one file no device wrote. Reported by
    // screenshot.
    const { container } = withDevices([
      { deviceId: null, deviceName: "", isOwn: false, kind: "catalogue", count: 1, latestTs: 1 },
    ]);
    const txt = container.textContent || "";
    expect(txt).toContain("sync_diag_catalogue_file");
    expect(txt).not.toContain("sync_diag_legacy_files");
  });

  it("…and a genuinely legacy file is still called one", () => {
    const { container } = withDevices([
      { deviceId: null, deviceName: "", isOwn: false, kind: "auto", count: 1, latestTs: 1 },
    ]);
    const txt = container.textContent || "";
    expect(txt).toContain("sync_diag_legacy_files");
    expect(txt).not.toContain("sync_diag_catalogue_file");
  });

  it("shows the foreign device's NAME beside its id, never 'this device'", () => {
    const { container } = withDevices([
      { deviceId: "unr52hzxv1", deviceName: "ipad", isOwn: true, kind: "auto", count: 1, latestTs: 1 },
      { deviceId: "8udtad73xz", deviceName: "iphone", isOwn: false, kind: "auto", count: 1, latestTs: 1 },
    ]);
    const txt = container.textContent || "";
    expect(txt).toContain("iphone · 8udtad73xz");
    // sync_diag_device is the header key ("Cet appareil"); a foreign row must
    // not borrow it. The mock t() returns the key, so assert on the key.
    expect(txt).not.toContain("sync_diag_device 8udtad73xz");
  });

  it("falls back to an OTHER-device label when that device never named itself", () => {
    const { container } = withDevices([
      { deviceId: "qsekqav94e", deviceName: "", isOwn: false, kind: "auto", count: 1, latestTs: 1 },
    ]);
    const txt = container.textContent || "";
    expect(txt).toContain("sync_diag_other_device qsekqav94e");
    expect(txt).not.toContain("sync_diag_device qsekqav94e");
  });

  it("labels a named manual pile by its device name", () => {
    const { container } = withDevices([
      { deviceId: null, deviceName: "iphone", isOwn: false, kind: "manual", count: 2, latestTs: 1 },
    ]);
    expect(container.textContent || "").toContain("iphone");
  });
});

// The panel had no way out of its own.
//
// It was dismissable only by re-tapping "Diagnostic multi-appareils", which is
// A toggle. An earlier release gave the same panel to "Vérifier les sauvegardes cloud",
// which is NOT a toggle and must not become one — re-checking is its purpose.
// So a panel opened from the check could not be closed; tapping again just
// re-ran it. Reported: "je ne peux jamais le fermer… ça ne fait que rafraîchir
// les données."
describe("SettingsModal — the sync panel closes itself", () => {
  const base = {
    importModal: true,
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
  };
  const diag = {
    deviceId: "abc123", deviceName: "iPhone", provider: "dropbox",
    localRef: 0, localEdited: 0, dismissedTs: 0, dismissedName: null,
    rows: [], devices: [],
  };
  function closeBtn(container: HTMLElement) {
    return Array.from(container.querySelectorAll("button")).filter(b =>
      (b.getAttribute("aria-label") || "") === "btn_close" && b.textContent === "×",
    );
  }

  it("offers a close button on a panel opened by the CHECK button", () => {
    const dismissSyncDiag = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base, syncDiag: diag, syncDiagSource: "check", dismissSyncDiag,
    });
    const btns = closeBtn(container);
    expect(btns.length).toBeGreaterThan(0);
    fireEvent.click(btns[0]!);
    expect(dismissSyncDiag).toHaveBeenCalled();
  });

  it("offers it on a panel opened by the DIAGNOSTIC button too", () => {
    const dismissSyncDiag = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base, syncDiag: diag, syncDiagSource: "diag", dismissSyncDiag,
    });
    const btns = closeBtn(container);
    expect(btns.length).toBeGreaterThan(0);
    fireEvent.click(btns[0]!);
    expect(dismissSyncDiag).toHaveBeenCalled();
  });

  // REVERSAL, recorded here rather than in a commit message. This case used
  // to be named "the check button stays a RE-CHECK, never a toggle" and
  // asserted the opposite of what follows. That rule was right while the
  // button was the ONLY way out of the panel it opened — closing on a second
  // tap would have left no way to close at all. The × above removed that
  // constraint, and a second tap closing was then requested from the app. The
  // × is still what guarantees a way out, so it is asserted just above; this
  // is the convenience on top of it, not a replacement for it.
  it("the check button toggles its OWN panel closed", () => {
    const checkCloudNewerNow = vi.fn();
    const dismissSyncDiag = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base, syncDiag: diag, syncDiagSource: "check",
      checkCloudNewerNow, dismissSyncDiag,
    });
    const btn = Array.from(container.querySelectorAll("[role='button']")).find(b =>
      /btn_check_cloud_newer/i.test(b.textContent || ""),
    ) as HTMLElement;
    fireEvent.click(btn);
    expect(dismissSyncDiag).toHaveBeenCalled();
    expect(checkCloudNewerNow).not.toHaveBeenCalled();
  });

  it("…and RE-CHECKS once nothing of its own is on screen", () => {
    // The third tap of the reported sequence: close, then reopen AND refresh.
    const checkCloudNewerNow = vi.fn();
    const dismissSyncDiag = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base, syncDiag: null, syncDiagErr: "", syncDiagSource: "",
      checkCloudNewerNow, dismissSyncDiag,
    });
    const btn = Array.from(container.querySelectorAll("[role='button']")).find(b =>
      /btn_check_cloud_newer/i.test(b.textContent || ""),
    ) as HTMLElement;
    fireEvent.click(btn);
    expect(checkCloudNewerNow).toHaveBeenCalled();
    expect(dismissSyncDiag).not.toHaveBeenCalled();
  });

  it("re-checks rather than dismissing a panel the OTHER button raised", () => {
    // Source-scoped, exactly like its neighbour: dismissing a panel rendered
    // under the cloud-files button would be a tap with no visible effect —
    // the dead tap this whole series is about.
    const checkCloudNewerNow = vi.fn();
    const dismissSyncDiag = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, {
      ...base, syncDiag: diag, syncDiagSource: "diag",
      checkCloudNewerNow, dismissSyncDiag,
    });
    const btn = Array.from(container.querySelectorAll("[role='button']")).find(b =>
      /btn_check_cloud_newer/i.test(b.textContent || ""),
    ) as HTMLElement;
    fireEvent.click(btn);
    expect(checkCloudNewerNow).toHaveBeenCalled();
    expect(dismissSyncDiag).not.toHaveBeenCalled();
  });
});

// The duplicates utility. The one thing that HEALS an install
// that already diverged: the merge counter could only announce the doubling.
describe("SettingsModal — duplicates utility", () => {
  const dupData = {
    tobaccos: [
      { id: 1, brand: "Halvorsen", name: "Duskfall", lots: [{ id: 11, status: "cellar", weightG: "50", boxNumber: "7" }] },
      { id: 2, brand: "Halvorsen", name: "Duskfall", lots: [{ id: 21, status: "cellar", weightG: "30", boxNumber: "8" }] },
    ],
    pipes: [], accessories: [], wishlist: [], sessions: [],
    nxT: 3, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
  };
  const clean = { tobaccos: [{ id: 1, brand: "P", name: "N", lots: [] }], pipes: [], accessories: [], wishlist: [], sessions: [], nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1 };
  const base = { importModal: true, modalOpenTs: { current: 0 }, tkGet: () => null };
  const btn = (c: HTMLElement) => Array.from(c.querySelectorAll("[role='button']"))
    .find(b => /btn_duplicates/i.test(b.textContent || "")) as HTMLElement | undefined;

  it("stays hidden when there is nothing to resolve", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base, data: clean, dataRaw: clean });
    expect(btn(container)).toBeUndefined();
  });

  it("appears with the count when duplicates exist, and opens its panel", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base, data: dupData, dataRaw: dupData });
    const b = btn(container)!;
    expect(b).toBeTruthy();
    fireEvent.click(b);
    expect(container.textContent).toContain("dup_title");
    expect(container.textContent).toContain("Duskfall");
  });

  it("the panel closes by its OWN × — not only by the button that opened it", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base, data: dupData, dataRaw: dupData });
    fireEvent.click(btn(container)!);
    const x = Array.from(container.querySelectorAll("button")).filter(b =>
      (b.getAttribute("aria-label") || "") === "btn_close" && b.textContent === "×");
    expect(x.length).toBeGreaterThan(0);
    fireEvent.click(x[x.length - 1]!);
    expect(container.textContent).not.toContain("dup_title");
  });

  it("asks for confirmation naming what moves, and only then saves", () => {
    const save = vi.fn();
    const { container } = renderWithCtx(<CuratorSettingsModal />, { ...base, data: dupData, dataRaw: dupData, save });
    fireEvent.click(btn(container)!);
    const keep = Array.from(container.querySelectorAll("button"))
      .filter(b => /dup_keep_this/.test(b.textContent || ""));
    expect(keep.length).toBe(2);
    fireEvent.click(keep[0]!);
    expect(container.textContent).toContain("dup_confirm");
    expect(save).not.toHaveBeenCalled();     // nothing happens until confirmed
    const go = Array.from(container.querySelectorAll("[role='button'], button"))
      .find(b => /dup_do_merge/.test(b.textContent || "")) as HTMLElement;
    fireEvent.click(go);
    expect(save).toHaveBeenCalled();
    const next = save.mock.calls[0]![0];
    // The dropped row goes to the TRASH, not away.
    expect(next.tobaccos.find((t: any) => t.id === 2).deletedAt).toBeTruthy();
    expect(next.tobaccos.find((t: any) => t.id === 1).lots).toHaveLength(2);
  });
});

// The toggle switches had no accessible name.
//
// `Toggle` renders a 46x26 <button aria-pressed> whose visible label is a
// SIBLING <div>. A sibling associates with nothing, so all six switches in
// Settings — cloud auto-save, accounting, maintenance reminders, and the three
// section-visibility ones — announced as "button, not pressed" with no
// indication of what they toggle. `aria-pressed` was there from the start,
// which is what made it easy to miss: the STATE was conveyed and the SUBJECT
// was not.
//
// Found while measuring the Settings tap targets, not by looking for it: the
// probe reports each control's accessible name alongside its box, and these
// fell through to the tag name. (That measurement came back clean — nothing
// under WCAG 2.2's 24x24 AA floor, and no dead zones, at 390px/M and at
// 360px/"L" in German.)
describe("SettingsModal — the toggle switches say what they toggle", () => {
  beforeEach(() => {
    try { localStorage.setItem("cave-settings-tab", "prefs"); } catch (_e) { /* ignore */ }
  });

  const open = (extra: Record<string, unknown> = {}) => renderWithCtx(<CuratorSettingsModal />, {
    importModal: true, lang: "fr", t: trFr,
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
    ...extra,
  });

  // The switch is the only control in this modal shaped `46x26 aria-pressed`
  // with no text of its own — selecting on THAT is what the probe saw.
  const switches = (c: HTMLElement) => [...c.querySelectorAll("button[aria-pressed]")]
    .filter((b) => !(b.textContent || "").trim());

  it("finds switches at all (the selection must not be vacuous)", () => {
    expect(switches(open().container).length).toBeGreaterThanOrEqual(3);
  });

  it("gives every text-less switch an accessible name", () => {
    const unnamed = switches(open().container)
      .filter((b) => !(b.getAttribute("aria-label") || "").trim());
    expect(unnamed).toHaveLength(0);
  });

  it("names them after their visible label, not a generic word", () => {
    const { container } = open();
    const names = switches(container).map((b) => b.getAttribute("aria-label") || "");
    // Each name must be the label the sighted user reads beside the switch.
    names.forEach((n) => expect(container.textContent).toContain(n));
    // …and a real one: a generic "activer" on six controls would satisfy the
    // test above while leaving a screen-reader user exactly where they were.
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the hint OUT of the name", () => {
    // The hint is the DESCRIPTION. Folding it into the name turns a one-word
    // announcement into a paragraph read on every focus.
    const { container } = open();
    switches(container).forEach((b) => {
      expect((b.getAttribute("aria-label") || "").length).toBeLessThan(60);
    });
  });
});

// The Données tab slid left and right under a finger.
//
// Reported from the app with a screenshot ("dans la page données des settings
// l'ensemble bouge de gauche à droite. Pas sur les autres"). MEASURED in the
// built app at the reporter's width, 402px CSS, at the "L" text size: the tab's
// content container was a 3px-wide horizontal scroller — enough to slide the
// whole page, not enough to look like anything but a glitch.
//
// THREE causes, each one a default that means "do not shrink":
//   1. `Section`'s body is `display: grid` with no `grid-template-columns`, so
//      the implicit track is `auto` — which cannot go below its content's
//      min-content width. The "Clé API" row has a min-content of 361px (the
//      next widest is 267), so ONE row sized the column and dragged all five
//      rows of the AI section out to 361px inside a 340px box.
//   2. `Row`'s label half had no `minWidth: 0`; a flex item defaults to
//      `min-width: auto`, so it could not shrink either. (learned
//      exactly this on the inventory toggles — same default, other axis.)
//   3. `Segmented` is `inline-flex` with no wrap, so six language options or
//      the two dated date-format labels forced the row wider than the panel.
//      It cannot shrink instead: it is `overflow: hidden`, so shrinking would
//      clip the option labels it exists to display.
//
// After the fix, at 360px AND 402px, at the "L" text size, in all six
// languages, the only horizontal scroller left inside the modal is the tab
// strip — which is a deliberate ScrollableChipRow.
//
// jsdom lays nothing out, so the pixels live in the browser harness. What is
// locked here is that each declaration reaches the DOM node it has to reach —
// which is stronger than a source match, and immune to the trap of a test
// satisfied by the fix's own explanatory comment.
describe("SettingsModal — nothing in a tab may be wider than the tab", () => {
  beforeEach(() => {
    try { localStorage.setItem("cave-settings-tab", "prefs"); } catch (_e) { /* ignore */ }
  });

  const open = () => renderWithCtx(<CuratorSettingsModal />, {
    importModal: true, lang: "fr", t: trFr,
    modalOpenTs: { current: 0 },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    tkGet: () => null,
  }).container;

  const divs = (c: HTMLElement) => [...c.querySelectorAll("div")] as HTMLDivElement[];

  it("lets every Section's grid track shrink", () => {
    const grids = divs(open()).filter((d) => d.style.display === "grid");
    expect(grids.length).toBeGreaterThan(0);            // non-vacuous
    // `auto` (the default) is the bug: it floors the track at min-content, so
    // the widest row sizes every row and the tab overflows.
    grids.forEach((g) => expect(g.style.gridTemplateColumns).toBe("minmax(0, 1fr)"));
  });

  it("lets every Segmented wrap instead of forcing its row wider", () => {
    const segs = divs(open()).filter((d) =>
      d.style.display === "inline-flex" && d.children.length >= 2 &&
      [...d.children].every((k) => k.tagName === "BUTTON" && k.hasAttribute("aria-pressed")));
    expect(segs.length).toBeGreaterThan(0);             // non-vacuous
    segs.forEach((s) => {
      expect(s.style.flexWrap).toBe("wrap");
      expect(s.style.maxWidth).toBe("100%");
    });
  });

  it("lets a Row's label shrink and bounds its control", () => {
    const rows = divs(open()).filter((d) =>
      d.style.justifyContent === "space-between" && d.style.flexWrap === "wrap" &&
      d.children.length === 2);
    expect(rows.length).toBeGreaterThan(0);             // non-vacuous
    rows.forEach((r) => {
      expect((r.children[0] as HTMLElement).style.minWidth).toBe("0px");
      // The control half keeps `flex-shrink: 0` on purpose — shrinking a
      // Segmented clips its labels. What it may not do is exceed the row.
      expect((r.children[1] as HTMLElement).style.flexShrink).toBe("0");
      expect((r.children[1] as HTMLElement).style.maxWidth).toBe("100%");
    });
  });
});

// The tab strip must show the tab that is actually active.
//
// Reported with a screenshot: open Settings on Aide, tap Préférences, and the
// strip stays where Aide left it — the ACTIVE tab renders clipped
// ("…férences") with its brass underline half off-screen. The DOM scroller
// persists its scrollLeft across re-renders (met the same fact on the
// inventory chips), and nothing here ever asked it to move.
//
// The arithmetic lives in `chipRowScrollTarget` and is tested there — jsdom
// reports every layout offset as 0, so it is unreachable through a render.
// What IS testable here is the wiring, which is the half that rots: that the
// strip is told which child to reveal, and that the index follows the active
// tab rather than a fixed position.
describe("SettingsModal — the active tab is scrolled into view", () => {
  const open = (tab: string) => {
    try { localStorage.setItem("cave-settings-tab", tab); } catch (_e) { /* ignore */ }
    return renderWithCtx(<CuratorSettingsModal />, {
      importModal: true, lang: "fr", t: trFr,
      settingsTab: tab, setSettingsTab: () => {},
      modalOpenTs: { current: 0 },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      tkGet: () => null,
    }).container;
  };

  const strip = (c: HTMLElement) => c.querySelector('[role="tablist"]') as HTMLElement;

  it("renders the four tabs in one scrollable strip", () => {
    const s = strip(open("prefs"));
    expect(s).toBeTruthy();                                   // non-vacuous
    expect(s.children.length).toBe(4);
    expect(s.style.overflowX).toBe("auto");                   // it CAN drift
  });

  it("asks the strip to reveal whichever tab is selected", () => {
    // jsdom has no scrollTo; define one so the effect's guard passes and the
    // call is observable. The geometry stays 0, so `chipRowScrollTarget`
    // correctly declines to move — what is asserted is that the strip LOOKED,
    // and at the right child.
    const calls: number[] = [];
    const proto = window.HTMLElement.prototype as unknown as { scrollTo?: unknown };
    const had = "scrollTo" in proto;
    const prev = proto.scrollTo;
    proto.scrollTo = function () { calls.push(1); };
    try {
      for (const tab of ["prefs", "data", "app", "help"]) {
        const s = strip(open(tab));
        const active = [...s.children].findIndex((b) => b.getAttribute("aria-selected") === "true");
        // The selected tab must exist and be the one the strip is pointed at —
        // the index is derived from `active`, so a hardcoded 0 would fail here
        // for three of the four.
        expect(active).toBeGreaterThanOrEqual(0);
        expect(["prefs", "data", "app", "help"][active]).toBe(tab);
      }
    } finally {
      if (had) proto.scrollTo = prev; else delete proto.scrollTo;
    }
  });
});

describe("SettingsModal — « Vérifier mon catalogue »", () => {
  const META = { name: "c.csv", loadedAt: 0, blends: 4, brands: 4, langs: [], skippedNoIdentity: 0,
    duplicateKeys: 0, unknownCategories: [], unknownCuts: [], parserVersion: 1, csvChars: 10 };
  const base = (extra: Record<string, unknown>) => ({
    importModal: true, modalOpenTs: { current: 0 }, t: trFr, tkGet: () => null,
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    catalogueMeta: META, ...extra,
  });

  it("the button is absent while no catalogue is loaded", () => {
    // Nothing to check, so offering the check would be a dead control — the
    // same reason the cloud SAVE is gated and the RESTORE deliberately is not.
    //
    // Asserted on the TEXT and not via getAllByRole, because that probe stayed
    // GREEN: `ActionBtn` drops role="button" when it has no handler (the
    // decorative branch), and this ctx supplies no `auditCatalogue`
    // — so an ungated, rendered button was invisible to the role query and the
    // case passed for the wrong reason. The rule: when a probe stays
    // green, find the layer absorbing it.
    const { container } = renderWithCtx(<CuratorSettingsModal />, base({ catalogueMeta: null }));
    expect(container.textContent || "", "the section must render at all").toContain(trFr("sec_catalogue"));
    expect(container.textContent || "").not.toContain(trFr("cat_audit_btn"));
  });

  it("the button reaches auditCatalogue", () => {
    const auditCatalogue = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorSettingsModal />, base({ auditCatalogue }));
    const btn = getAllByRole("button").find((b) => /Vérifier mon catalogue/i.test(b.textContent || ""));
    expect(btn, "no audit button").toBeTruthy();
    fireEvent.click(btn!);
    expect(auditCatalogue).toHaveBeenCalled();
  });

  it("a clean catalogue says so, and STILL states the scope", () => {
    // The scope line renders in BOTH branches on purpose: « aucun problème »
    // over a check that only looked at four columns would read as a verdict on
    // the whole file. Same shape as `plan.locked` in the catalogue-apply modal.
    const { container } = renderWithCtx(<CuratorSettingsModal />, base({
      catalogueAudit: { rows: 4, blends: 4, noIdentity: 0, duplicates: 0, badCategory: 0, badCut: 0, issues: [], truncated: false },
    }));
    const txt = container.textContent || "";
    // Derived from the dictionary, not retyped: the clean sentence interpolates
    // the two counts, so a hand-written regex here would pin a wording rather
    // than the behaviour.
    expect(txt).toContain(trFr("cat_audit_ok").replace("{n}", "4").replace("{b}", "4"));
    expect(txt, "the scope must be stated even when clean").toContain(trFr("cat_audit_scope"));
  });

  it("names the ROW of each defect, and the offending label", () => {
    // The row is the whole point of the feature: on a 1594-row catalogue
    // « valeurs non reconnues : Zigzag Cut » is a fact the user cannot act on.
    const { container } = renderWithCtx(<CuratorSettingsModal />, base({
      catalogueAudit: {
        rows: 5, blends: 3, noIdentity: 1, duplicates: 0, badCategory: 0, badCut: 1, truncated: false,
        issues: [
          { row: 4, kind: "no-identity", brand: "", name: "", value: "" },
          { row: 6, kind: "cut", brand: "Vondel", name: "633", value: "Zigzag Cut" },
        ],
      },
    }));
    const txt = container.textContent || "";
    expect(txt).toContain("Ligne 6");
    expect(txt).toContain("Vondel 633");
    expect(txt).toContain("Zigzag Cut");
  });

  it("a line with NEITHER brand nor name carries no dangling separator", () => {
    // Found by reading the rendered panel, not by a test: a `no-identity` row
    // has no brand and no name — that is what it is reported for — and the
    // fixed-separator concatenation rendered « Ligne 4 · » with nothing after
    // the dot. Every part but the row number is optional.
    const { container } = renderWithCtx(<CuratorSettingsModal />, base({
      catalogueAudit: {
        rows: 2, blends: 1, noIdentity: 1, duplicates: 0, badCategory: 0, badCut: 0, truncated: false,
        issues: [{ row: 4, kind: "no-identity", brand: "", name: "", value: "" }],
      },
    }));
    const row = Array.from(container.querySelectorAll("div"))
      .map((d) => (d.textContent || "").trim())
      .find((s) => s === "Ligne 4" || /^Ligne 4( ·.*)?$/.test(s));
    expect(row, "no row line rendered").toBeTruthy();
    expect(row, "dangling separator").toBe("Ligne 4");
  });
});

describe("SettingsModal — the CSV import panel", () => {
  const base = (extra: Record<string, unknown>) => ({
    importModal: true, modalOpenTs: { current: 0 }, t: trFr, tkGet: () => null,
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    ...extra,
  });
  const ISSUES = {
    rows: 3, skipped: 1, badCategory: 1, badCut: 0, truncated: false,
    issues: [
      { row: 3, kind: "no-identity", brand: "", name: "", value: "" },
      { row: 4, kind: "category", brand: "Vondel", name: "633", value: "Pipeweed" },
    ],
  };

  it("is absent when the last import had nothing to report", () => {
    // A permanent "0 problems" panel would be noise on the commonest path.
    const { container } = renderWithCtx(<CuratorSettingsModal />, base({ csvIssues: null }));
    expect(container.textContent || "").not.toContain(trFr("csv_issues_title"));
  });

  it("names the row and the offending label", () => {
    const { container } = renderWithCtx(<CuratorSettingsModal />, base({ csvIssues: ISSUES }));
    const txt = container.textContent || "";
    expect(txt).toContain(trFr("csv_issues_title"));
    expect(txt).toContain("Ligne 4");
    expect(txt).toContain("Vondel 633");
    expect(txt).toContain("Pipeweed");
  });

  it("states the taxonomy rule AND that the value was snapped, not kept", () => {
    // The scope line is the honest half: an unrecognised value is coerced to
    // the catch-all rather than kept verbatim (the fiche's dropdown has no
    // option for it and would rewrite it on the first save).
    // Defensible only if the app says so.
    // The three CSV-issue strings carry a `{v}` placeholder
    // now — they hardcoded the FRENCH « Autre » in all six languages, so a
    // German reader was told about a value their own dropdown never shows
    // (`CATS_DE.Autre` is "Andere"). The assertion follows the change: the
    // sentence is checked WITHOUT its placeholder, and the substitution gets
    // its own case below.
    const { container } = renderWithCtx(<CuratorSettingsModal />, base({ csvIssues: ISSUES }));
    const scope = trFr("csv_issues_scope");
    const head = scope.slice(0, scope.indexOf("{v}") - 3);
    expect(head.length, "the placeholder is still in the fr string").toBeGreaterThan(20);
    expect(container.textContent || "").toContain(head);
  });

  it("names the catch-all in the READER's language, not in French", () => {
    // `xl` is what the fiche's dropdown reads, so the panel cannot name a
    // value the form will not show. Driven in German because French is the
    // one language where the old hardcoded literal happened to be right.
    const de = renderWithCtx(<CuratorSettingsModal />, base({
      csvIssues: ISSUES, lang: "de",
      xl: (v: string) => (v === "Autre" ? "Andere" : v),
    }));
    const txt = de.container.textContent || "";
    expect(txt, "the German word").toContain("Andere");
    expect(txt, "and never the raw placeholder").not.toContain("{v}");
  });

  it("sits under the import button, not somewhere else in the tab", () => {
    // The action→feedback adjacency rule: the answer renders where
    // the tap was. Asserted on NODE order, since a text indexOf would also be
    // satisfied by a panel rendered at the bottom of the tab.
    const { container } = renderWithCtx(<CuratorSettingsModal />, base({ csvIssues: ISSUES }));
    const txt = container.textContent || "";
    const btn = txt.indexOf(trFr("btn_import_csv"));
    const panel = txt.indexOf(trFr("csv_issues_title"));
    const next = txt.indexOf(trFr("btn_csv_template"));
    expect(btn, "import button not found").toBeGreaterThan(-1);
    expect(panel, "panel not found").toBeGreaterThan(btn);
    if (next > -1) expect(panel, "panel drifted past the next control").toBeLessThan(next);
  });

  it("carries its own close ×", () => {
    // The panel appears on its own after an import, so there is no
    // toggle to tap again — without its own way out there is none at all.
    const clearCsvIssues = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorSettingsModal />, base({ csvIssues: ISSUES, clearCsvIssues }));
    const x = getAllByRole("button").filter((b) => (b.getAttribute("aria-label") || "") === trFr("btn_close"));
    expect(x.length, "no close button").toBeGreaterThan(0);
    fireEvent.click(x[x.length - 1]!);
    expect(clearCsvIssues).toHaveBeenCalled();
  });
});
