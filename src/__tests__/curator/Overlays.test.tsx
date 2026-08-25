// Smoke tests for src/views/curator/Overlays.tsx (SaveErrorBanner,
// SaveWarnBanner, AutoUpdateBanner, JustUpdatedToast, UpdatePill).
// CuratorDelConfirmModal was removed (deletes now go
// straight to the Trash with an 8 s undo toast as the safety net).

import { describe, it, expect, vi } from "vitest";
import { fireEvent, act } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import {
  CuratorSaveWarnBanner,
  CuratorPhotoErrorBanner,
  CuratorCloudNewerBanner,
  CuratorAutoUpdateBanner,
  CuratorUpdatePill,
  CuratorUndoToast,
  CuratorExportReminderBanner,
  CuratorDiagnosticToast,
  CuratorLangDetectedToast,
  DIAGNOSTIC_TOAST_THRESHOLD,
  DIAGNOSTIC_TOAST_DISMISS_KEY,
} from "../../views/curator/Overlays";
import { DIAGNOSTIC_KEY } from "../../utils/diagnostic";
import { LANG, translate } from "../../i18n";

describe("CuratorLangDetectedToast", () => {
  it("shows once after the welcome modal is dismissed, then clears the flag", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("cave-lang-auto", "de");
      localStorage.setItem("cave-curator-welcomed", "1");
      const { container } = renderWithCtx(<CuratorLangDetectedToast />, {
        t: (k: string) => k,
      });
      // Poll (1.2s) hasn't fired yet.
      expect(container.textContent || "").not.toContain("lang_auto_detected");
      act(() => { vi.advanceTimersByTime(1300); });
      expect(container.textContent || "").toContain("lang_auto_detected");
      // One-shot: the flag is consumed so it never re-fires.
      expect(localStorage.getItem("cave-lang-auto")).toBeNull();
      // Auto-dismisses after 8 s.
      act(() => { vi.advanceTimersByTime(8100); });
      expect(container.textContent || "").not.toContain("lang_auto_detected");
    } finally {
      localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("does NOT show while the welcome modal is still up (no stacking)", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("cave-lang-auto", "es");
      // cave-curator-welcomed absent → welcome still showing.
      const { container } = renderWithCtx(<CuratorLangDetectedToast />, { t: (k: string) => k });
      act(() => { vi.advanceTimersByTime(3000); });
      expect(container.textContent || "").not.toContain("lang_auto_detected");
      // Flag preserved so it can fire once welcome is dismissed.
      expect(localStorage.getItem("cave-lang-auto")).toBe("es");
    } finally {
      localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("does nothing when there is no auto-detect flag (explicit choice / returning user)", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("cave-curator-welcomed", "1");
      const { container } = renderWithCtx(<CuratorLangDetectedToast />, { t: (k: string) => k });
      act(() => { vi.advanceTimersByTime(3000); });
      expect(container.firstChild).toBeNull();
    } finally {
      localStorage.clear();
      vi.useRealTimers();
    }
  });
});

describe("SaveWarnBanner", () => {
  it("doesn't render when saveWarn is null", () => {
    const { container } = renderWithCtx(<CuratorSaveWarnBanner />, {
      saveWarn: null,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the warning text", () => {
    const { container } = renderWithCtx(<CuratorSaveWarnBanner />, {
      saveWarn: "Storage nearly full",
    });
    expect(container.textContent).toContain("Storage nearly full");
  });

  it("close (×) clears saveWarn", () => {
    const setSaveWarn = vi.fn();
    const { container } = renderWithCtx(<CuratorSaveWarnBanner />, {
      saveWarn: "Storage nearly full",
      setSaveWarn,
    });
    const closeBtn = container.querySelector("button[aria-label='Fermer'], button[aria-label='Close'], button[aria-label='btn_close']") as HTMLButtonElement | null;
    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(setSaveWarn).toHaveBeenCalledWith(null);
    }
  });

  // dismissing the quota-warn banner also stamps a localStorage
  // flag so the App-level quota probe doesn't re-raise the same warning
  // immediately (7-day suppression window).
  //
  // REVERSAL, recorded here so it isn't "fixed" back. This
  // case used to assert the × wrote `cave-quota-warn-dismissed`
  // UNCONDITIONALLY, and that was the defect: `saveWarn` is a SHARED channel
  // (the tasting auto-end notice, the save() QuotaExceeded
  // migration long before), so closing an unrelated notice silenced the
  // "storage is 80 % full, back up before writes fail" warning for SEVEN
  // DAYS with nothing said. The banner now REPORTS the dismissal and the
  // quota hook decides — it is the only place that knows whether the banner
  // on screen is its own.
  it("close (×) reports the dismissal to the quota hook", () => {
    const setSaveWarn = vi.fn();
    const dismissQuotaWarn = vi.fn();
    const { container } = renderWithCtx(<CuratorSaveWarnBanner />, {
      saveWarn: "Storage at 85%",
      setSaveWarn,
      dismissQuotaWarn,
    });
    const closeBtn = container.querySelector(
      "button[aria-label='Fermer'], button[aria-label='Close'], button[aria-label='btn_close']",
    ) as HTMLButtonElement | null;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(dismissQuotaWarn).toHaveBeenCalled();
  });

  // The half that matters: the banner must NOT write the 7-day suppression
  // key itself. Only the hook may, and only for its own warning.
  it("close (×) does NOT write the suppression key itself", () => {
    localStorage.removeItem("cave-quota-warn-dismissed");
    const { container } = renderWithCtx(<CuratorSaveWarnBanner />, {
      saveWarn: "Dégustation clôturée automatiquement après 95 min",
      setSaveWarn: vi.fn(),
      dismissQuotaWarn: vi.fn(),
    });
    const closeBtn = container.querySelector(
      "button[aria-label='Fermer'], button[aria-label='Close'], button[aria-label='btn_close']",
    ) as HTMLButtonElement | null;
    fireEvent.click(closeBtn!);
    expect(localStorage.getItem("cave-quota-warn-dismissed")).toBeNull();
  });
});

describe("AutoUpdateBanner", () => {
  // A real dialog, not a 15 px strip pinned to top:0. On an
  // installed iOS PWA that strip landed under the status bar, immediately
  // above the app's own brass masthead, in the same brass gradient — so the
  // one moment the app announces it is about to RELOAD ITSELF was the easiest
  // thing on screen to miss. Reported from the app.
  it("shows nothing when no countdown is running", () => {
    const { container } = renderWithCtx(<CuratorAutoUpdateBanner />, {
      autoUpdateCountdown: null,
    });
    expect(container.textContent || "").not.toContain("Plus tard");
  });

  it("renders the remaining seconds", () => {
    const { container } = renderWithCtx(<CuratorAutoUpdateBanner />, {
      autoUpdateCountdown: 7,
      newerBuild: { version: "1.5", build: "109" },
    });
    expect(container.textContent).toContain("7");
  });

  it("says what is about to happen, and which build", () => {
    // The old strip said only "Mise à jour dans 7s" — it never mentioned that
    // the app restarts, nor which build was arriving.
    const { container } = renderWithCtx(<CuratorAutoUpdateBanner />, {
      autoUpdateCountdown: 7,
      newerBuild: { version: "1.5", build: "109" },
      t: (k: string) => ({ upd_available: "Nouvelle version disponible",
        upd_auto_body: "L'application va redémarrer pour installer la mise à jour.",
        upd_do_now: "Mettre à jour maintenant", upd_auto_later: "Plus tard" }[k] || k),
    });
    expect(container.textContent).toContain("Nouvelle version disponible");
    expect(container.textContent).toContain("redémarrer");
    expect(container.textContent).toContain("109");
  });

  it("'Plus tard' cancels the countdown", () => {
    // Selected by ACCESSIBLE NAME, not by position: this case used to grab
    // container.querySelector("button") and silently retargeted to the new
    // primary action the moment one was added ahead of it.
    const cancelAutoUpdate = vi.fn();
    const { getByText } = renderWithCtx(<CuratorAutoUpdateBanner />, {
      autoUpdateCountdown: 5,
      cancelAutoUpdate,
      t: (k: string) => ({ upd_do_now: "Mettre à jour maintenant", upd_auto_later: "Plus tard" }[k] || k),
    });
    fireEvent.click(getByText("Plus tard"));
    expect(cancelAutoUpdate).toHaveBeenCalled();
  });

  it("a backdrop tap dismisses this occurrence WITHOUT declining the build", () => {
    // The Modal routes backdrop / Escape / system-back to onClose. Wiring that
    // to cancelAutoUpdate made an accidental tap the same durable decision as
    // pressing Plus tard — and the panel is 380px wide, so most of the screen
    // is backdrop.
    const cancelAutoUpdate = vi.fn();
    const dismissCountdown = vi.fn();
    renderWithCtx(<CuratorAutoUpdateBanner />, {
      autoUpdateCountdown: 5, cancelAutoUpdate, dismissCountdown,
    });
    const backdrop = document.querySelector('[role="dialog"]')?.parentElement;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(dismissCountdown).toHaveBeenCalled();
    expect(cancelAutoUpdate).not.toHaveBeenCalled();
  });

  it("'Mettre à jour maintenant' applies it immediately", () => {
    // The strip had no way to say yes — you could only decline or wait out the
    // countdown, which is a strange thing to offer for an action the user
    // might well want now.
    const doUpdate = vi.fn();
    const cancelAutoUpdate = vi.fn();
    const { getByText } = renderWithCtx(<CuratorAutoUpdateBanner />, {
      autoUpdateCountdown: 5,
      doUpdate, cancelAutoUpdate,
      t: (k: string) => ({ upd_do_now: "Mettre à jour maintenant", upd_auto_later: "Plus tard" }[k] || k),
    });
    fireEvent.click(getByText("Mettre à jour maintenant"));
    expect(doUpdate).toHaveBeenCalled();
    expect(cancelAutoUpdate).not.toHaveBeenCalled();
  });
});

describe("UpdatePill", () => {
  // The pill is keyed on `newerBuild`, not `updateAvailable`.
  // `updateAvailable` is only set on the path that intends to count down, so
  // the pill disappeared in exactly the states where a manual route matters
  // most — deferred behind an open form, stood down by the anti-loop latch, or
  // waiting on the silent data_only path. These cases were written against the
  // old key and are updated rather than deleted: the intent is unchanged.
  it("doesn't render when no update is available", () => {
    const { container } = renderWithCtx(<CuratorUpdatePill />, { newerBuild: null });
    expect(container.firstChild).toBeNull();
  });

  it("doesn't render when dismissed", () => {
    const { container } = renderWithCtx(<CuratorUpdatePill />, {
      newerBuild: { version: "2.9", build: "200" },
      updatePillDismissed: true,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders when only newerBuild is set — no countdown path involved", () => {
    // The regression this locks: a deferred / suppressed / silent update left
    // updateAvailable null, and the pill vanished with it.
    const { container } = renderWithCtx(<CuratorUpdatePill />, {
      newerBuild: { version: "2.9", build: "200" },
      updateAvailable: null,
      updatePillDismissed: false,
    });
    expect(container.firstChild).not.toBeNull();
  });

  it("says what it DOES, and shows the build that changed", () => {
    // It used to render a checkmark plus the minor version — "✓ v1.x" — which
    // reads as "you are up to date", and the minor is normally the one already
    // running. Reported from the app as "that is all, not explicit".
    const { container } = renderWithCtx(<CuratorUpdatePill />, {
      newerBuild: { version: "2.9", build: "200" },
      updatePillDismissed: false,
      t: (k: string) => (k === "upd_do" ? "Mettre à jour" : k),
    });
    expect(container.textContent).toContain("Mettre à jour");
    expect(container.textContent).toContain("200");
  });

  it("is a real button, reachable by keyboard", () => {
    // AUDIT HIGH. A <span onClick> has no role, no tabIndex and no key
    // handler: a keyboard or screen-reader user could DISMISS the update
    // notification (the × is a proper button) but never ACT on it — the one
    // control rewritten to be explicit was the one nobody could reach.
    const { container } = renderWithCtx(<CuratorUpdatePill />, {
      newerBuild: { version: "2.9", build: "200" },
      updatePillDismissed: false,
      t: (k: string) => (k === "upd_do" ? "Mettre à jour" : k),
    });
    const cta = Array.from(container.querySelectorAll("button"))
      .find(b => /Mettre à jour/.test(b.textContent || ""));
    expect(cta).toBeTruthy();
    expect(cta!.tagName).toBe("BUTTON");
  });

  it("steps aside while the countdown dialog is up", () => {
    // The pill is zIndex 490, the Modal 200 — so it painted on top of its own
    // dialog's backdrop, outside the focus trap, offering the same action
    // twice, and stayed tappable through the scrim.
    const { container } = renderWithCtx(<CuratorUpdatePill />, {
      newerBuild: { version: "2.9", build: "200" },
      updatePillDismissed: false,
      autoUpdateCountdown: 7,
    });
    expect(container.firstChild).toBeNull();
  });

  it("close (×) marks the pill dismissed", () => {
    const setUpdatePillDismissed = vi.fn();
    const { container } = renderWithCtx(<CuratorUpdatePill />, {
      newerBuild: { version: "2.9", build: "200" },
      updatePillDismissed: false,
      setUpdatePillDismissed,
    });
    const buttons = container.querySelectorAll("button");
    const close = Array.from(buttons).find(b => /Fermer|Close|btn_close/i.test(b.getAttribute("aria-label") || ""));
    expect(close).toBeTruthy();
    fireEvent.click(close!);
    expect(setUpdatePillDismissed).toHaveBeenCalledWith(true);
  });

  // tapping the pill must land the user on the "app" tab
  // of Settings (where the Update banner + "Mettre à jour" CTA live).
  it("clicking the pill pre-positions Settings on the 'app' tab", () => {
    const setImportModal = vi.fn();
    const setSettingsTab = vi.fn();
    const setUpdateStatus = vi.fn();
    const newerBuild = { version: "2.9", build: "200" };
    const { container } = renderWithCtx(<CuratorUpdatePill />, {
      newerBuild,
      updatePillDismissed: false,
      modalOpenTs: { current: 0 },
      setImportModal, setSettingsTab, setUpdateStatus,
      t: (k: string) => (k === "upd_do" ? "Mettre à jour" : k),
    });
    // It is a real <button> now, so select it as one. It used
    // to be a <span onClick> — invisible to the keyboard and announced as
    // static text, so the only reachable control on the pill was its ×.
    const label = Array.from(container.querySelectorAll("button"))
      .find(b => /Mettre à jour/.test(b.textContent || "")) as HTMLElement | undefined;
    expect(label).toBeTruthy();
    fireEvent.click(label!);
    expect(setSettingsTab).toHaveBeenCalledWith("app");
    expect(setImportModal).toHaveBeenCalledWith(true);
    // …and hands the confirm flow the build it is actually offering.
    expect(setUpdateStatus).toHaveBeenCalledWith(newerBuild);
  });
});


// ── Undo-after-delete toast ─────────────────────────────────────

describe("UndoToast", () => {
  it("renders nothing when undoToast is null", () => {
    const { container } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: null,
      lang: "fr",
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the kind, label and an Annuler button when set (FR)", () => {
    const { container } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: {
        kind: "tobacco",
        label: "Brackwater — Duskfall",
        ts: Date.now(),
        restoreFn: vi.fn(),
      },
      setUndoToast: vi.fn(),
      lang: "fr",
    });
    const text = container.textContent || "";
    expect(text).toMatch(/Tabac|kind_tobacco/);
    expect(text).toMatch(/supprimé|lbl_deleted/);
    expect(text).toMatch(/Brackwater — Duskfall/);
    expect(text).toMatch(/Annuler|btn_undo/);
  });

  it("renders English labels when lang=en", () => {
    const { container } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: {
        kind: "session",
        label: "2026-05-15",
        ts: Date.now(),
        restoreFn: vi.fn(),
      },
      setUndoToast: vi.fn(),
      lang: "en",
    });
    const text = container.textContent || "";
    expect(text).toMatch(/Session|kind_session/);
    expect(text).toMatch(/deleted|lbl_deleted/);
    expect(text).toMatch(/Undo|btn_undo/);
  });

  // ───────────────────────────────────────────────────────────────────────
  // The overline said SUPPRIMÉ whatever had happened, so the bulk
  // catalogue pass announced « CATALOGUE · SUPPRIMÉ » for an update. Reported
  // from the app. The kind half was wrong too and looked right by accident:
  // `catalogue` is not a dictionary key, so the raw key reached the screen.
  // NOTE these four pass a REAL t(): the shared harness's mockT returns the
  // key, which is why the older cases above accept `/supprimé|lbl_deleted/`.
  // Under mockT the defect is invisible — "lbl_deleted" contains neither the
  // French nor the German word — so the whole point would be lost.
  const realT = (lang: string) => (k: string) => translate(lang, k);

  it("names an UPDATE as updated, not deleted", () => {
    const { container } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: { kind: "catalogue", label: "29 fiche(s)", ts: Date.now(), restoreFn: vi.fn() },
      setUndoToast: vi.fn(),
      lang: "fr", t: realT("fr"),
    });
    const text = container.textContent || "";
    expect(text).toContain("Catalogue");
    expect(text).toContain("mis à jour");
    expect(text).not.toContain("supprimé");
  });

  it("resolves the kind KEY, in every shipped language", () => {
    // French alone would pass on the raw-key fallback too, since the internal
    // kind name "catalogue" happens to be a French word — that accident is
    // what hid the second half of the defect. German proves the key resolves.
    const CASES = [["en", "Catalogue", "updated"], ["de", "Katalog", "aktualisiert"],
                   ["es", "Catálogo", "actualizado"], ["it", "Catalogo", "aggiornato"],
                   ["pt", "Catálogo", "atualizado"]] as const;
    for (const [lang, kind, verb] of CASES) {
      const { container, unmount } = renderWithCtx(<CuratorUndoToast />, {
        undoToast: { kind: "catalogue", label: "29", ts: Date.now(), restoreFn: vi.fn() },
        setUndoToast: vi.fn(),
        lang, t: realT(lang),
      });
      const text = container.textContent || "";
      expect(text, `${lang} kind`).toContain(kind);
      expect(text, `${lang} verb`).toContain(verb);
      expect(text, `${lang} must not render the raw key`).not.toContain("kind_catalogue");
      unmount();
    }
  });

  it("renders NO overline for an unknown kind rather than guessing one", () => {
    // The failure direction that matters: a future undoable action added
    // without a table row must lose information, never state something false.
    const { container } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: { kind: "quelquechose", label: "Sujet", ts: Date.now(), restoreFn: vi.fn() },
      setUndoToast: vi.fn(),
      lang: "fr", t: realT("fr"),
    });
    const text = container.textContent || "";
    expect(text).toContain("Sujet");
    expect(text).not.toContain("supprimé");
    expect(text).not.toContain("quelquechose");   // no raw kind key on screen
  });

  it("still names a DELETE as deleted — the five original kinds are unchanged", () => {
    // The generalisation must not have moved the wording it inherited.
    for (const [kind, word] of [["tobacco", "Tabac"], ["pipe", "Pipe"], ["wish", "Envie"],
                                ["accessory", "Accessoire"], ["session", "Séance"]] as const) {
      const { container, unmount } = renderWithCtx(<CuratorUndoToast />, {
        undoToast: { kind, label: "X", ts: Date.now(), restoreFn: vi.fn() },
        setUndoToast: vi.fn(),
        lang: "fr", t: realT("fr"),
      });
      const text = container.textContent || "";
      expect(text, `${kind} kind`).toContain(word);
      expect(text, `${kind} verb`).toContain("supprimé");
      unmount();
    }
  });

  it("keeps the undo affordance for every kind, known or not", () => {
    for (const kind of ["tobacco", "catalogue", "quelquechose"]) {
      const restoreFn = vi.fn();
      const { container, unmount } = renderWithCtx(<CuratorUndoToast />, {
        undoToast: { kind, label: "X", ts: Date.now(), restoreFn },
        setUndoToast: vi.fn(),
        lang: "fr",
      });
      const btn = Array.from(container.querySelectorAll("button"))
        .find(b => /Annuler|btn_undo/.test(b.textContent || ""));
      expect(btn, `${kind} must still offer Annuler`).toBeTruthy();
      fireEvent.click(btn!);
      expect(restoreFn).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("gives the catalogue pass a label short enough for the slot", () => {
    // The label sits in a 240px nowrap+ellipsis slot built for an item NAME.
    // An earlier release put a sentence there and the user saw "…mises à jour depui…".
    // The slot is right for a delete; the label was the wrong SHAPE for it.
    for (const lang of ["fr", "en", "es", "de", "it", "pt"]) {
      const raw = String(LANG[lang]!.cat_apply_undo_label);
      expect(raw, `${lang} label`).toContain("{n}");
      expect(raw.replace("{n}", "999").length, `${lang} label length`).toBeLessThan(30);
    }
  });

  it("calls restoreFn when the Annuler button is tapped", () => {
    const restoreFn = vi.fn();
    const { container } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: { kind: "tobacco", label: "X", ts: Date.now(), restoreFn },
      setUndoToast: vi.fn(),
      lang: "fr",
    });
    const undoBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /Annuler|btn_undo/.test(b.textContent || ""));
    expect(undoBtn).toBeTruthy();
    fireEvent.click(undoBtn!);
    expect(restoreFn).toHaveBeenCalledTimes(1);
  });

  it("calls setUndoToast(null) when the × dismiss is tapped", () => {
    const setUndoToast = vi.fn();
    const { container } = renderWithCtx(<CuratorUndoToast />, {
      undoToast: { kind: "tobacco", label: "X", ts: Date.now(), restoreFn: vi.fn() },
      setUndoToast,
      lang: "fr",
    });
    const dismiss = Array.from(container.querySelectorAll("button"))
      .find(b => (b.textContent || "").trim() === "×");
    expect(dismiss).toBeTruthy();
    fireEvent.click(dismiss!);
    expect(setUndoToast).toHaveBeenCalledWith(null);
  });
});


// ── Export-reminder banner ─────────────────────────────────────

describe("ExportReminderBanner", () => {
  it("renders nothing when exportReminder is false", () => {
    const { container } = renderWithCtx(<CuratorExportReminderBanner />, {
      exportReminder: false,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the reminder text in FR by default", () => {
    const { container } = renderWithCtx(<CuratorExportReminderBanner />, {
      exportReminder: true,
      lang: "fr",
    });
    expect(container.textContent).toMatch(/sauvegarder votre cave|export_reminder_banner/i);
  });

  it("renders the reminder text in EN when lang=en", () => {
    const { container } = renderWithCtx(<CuratorExportReminderBanner />, {
      exportReminder: true,
      lang: "en",
    });
    expect(container.textContent).toMatch(/back up your cellar|export_reminder_banner/i);
  });

  it("yields silently to saveError (no double banner)", () => {
    const { container } = renderWithCtx(<CuratorExportReminderBanner />, {
      exportReminder: true,
      saveError: "Disk full",
      lang: "fr",
    });
    expect(container.firstChild).toBeNull();
  });

  it("yields silently to saveWarn (quota warning takes precedence)", () => {
    const { container } = renderWithCtx(<CuratorExportReminderBanner />, {
      exportReminder: true,
      saveWarn: "Storage at 85%",
      lang: "fr",
    });
    expect(container.firstChild).toBeNull();
  });

  it("tapping the banner opens Settings", () => {
    const setImportModal = vi.fn();
    const { container } = renderWithCtx(<CuratorExportReminderBanner />, {
      exportReminder: true,
      setImportModal,
      modalOpenTs: { current: 0 },
      lang: "fr",
    });
    // The action is a real <button> now, not the container. Select
    // it by the stable contract — the dismiss × carries an aria-label, the
    // action button does not — never by position (the lesson: a
    // positional selector silently retargets when the DOM changes).
    fireEvent.click(container.querySelector("button:not([aria-label])") as HTMLElement);
    expect(setImportModal).toHaveBeenCalledWith(true);
  });

  // tapping the banner must also pre-position Settings on
  // the "data" tab (Drive backup + Export & Import live there).
  it("tapping the banner pre-positions Settings on the 'data' tab", () => {
    const setImportModal = vi.fn();
    const setSettingsTab = vi.fn();
    const { container } = renderWithCtx(<CuratorExportReminderBanner />, {
      exportReminder: true,
      setImportModal, setSettingsTab,
      modalOpenTs: { current: 0 },
      lang: "fr",
    });
    fireEvent.click(container.querySelector("button:not([aria-label])") as HTMLElement);
    expect(setSettingsTab).toHaveBeenCalledWith("data");
    expect(setImportModal).toHaveBeenCalledWith(true);
  });

  it("close (×) snoozes for 7 days and clears the banner", () => {
    localStorage.removeItem("cave-export-reminder-dismissed");
    const setExportReminder = vi.fn();
    const setImportModal = vi.fn();
    const { container } = renderWithCtx(<CuratorExportReminderBanner />, {
      exportReminder: true,
      setExportReminder,
      setImportModal,
      lang: "fr",
    });
    const closeBtn = container.querySelector(
      "button[aria-label='Fermer'], button[aria-label='Close'], button[aria-label='btn_close']",
    ) as HTMLButtonElement | null;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(setExportReminder).toHaveBeenCalledWith(false);
    // Settings should NOT open from a × tap (stopPropagation).
    expect(setImportModal).not.toHaveBeenCalled();
    const stamped = parseInt(localStorage.getItem("cave-export-reminder-dismissed") || "0");
    expect(stamped).toBeGreaterThan(0);
  });
});


// ── Diagnostic toast threshold ─────────────────────────────────
// The threshold was 5 accumulated violations at first; it was
// dropped to 1 so a single integrity issue surfaces immediately.
// Per-session sessionStorage dismissal keeps it from spamming.

describe("DiagnosticToast (threshold lowered to 1)", () => {
  beforeEach(() => {
    localStorage.removeItem(DIAGNOSTIC_KEY);
    sessionStorage.removeItem(DIAGNOSTIC_TOAST_DISMISS_KEY);
  });

  it("threshold constant is 1 (not 5)", () => {
    expect(DIAGNOSTIC_TOAST_THRESHOLD).toBe(1);
  });

  it("renders when the persisted counter shows 1 violation", () => {
    localStorage.setItem(
      DIAGNOSTIC_KEY,
      JSON.stringify({ count: 1, firstSeen: "x", lastSeen: "x", recent: [] }),
    );
    const { container } = renderWithCtx(<CuratorDiagnosticToast />, {
      lang: "fr",
    });
    expect(container.firstChild).toBeTruthy();
    expect(container.textContent).toMatch(/1 anomal|diag_toast_count/i);
  });

  it("renders nothing when the counter is 0", () => {
    localStorage.setItem(
      DIAGNOSTIC_KEY,
      JSON.stringify({ count: 0, firstSeen: "", lastSeen: "", recent: [] }),
    );
    const { container } = renderWithCtx(<CuratorDiagnosticToast />, {
      lang: "fr",
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while a tasting is running (deferred to avoid stacking)", () => {
    localStorage.setItem(
      DIAGNOSTIC_KEY,
      JSON.stringify({ count: 3, firstSeen: "x", lastSeen: "x", recent: [] }),
    );
    const { container } = renderWithCtx(<CuratorDiagnosticToast />, {
      lang: "fr",
      tasting: { stage: "running" },
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing once the session has dismissed the toast", () => {
    localStorage.setItem(
      DIAGNOSTIC_KEY,
      JSON.stringify({ count: 2, firstSeen: "x", lastSeen: "x", recent: [] }),
    );
    sessionStorage.setItem(DIAGNOSTIC_TOAST_DISMISS_KEY, "1");
    const { container } = renderWithCtx(<CuratorDiagnosticToast />, {
      lang: "fr",
    });
    expect(container.firstChild).toBeNull();
  });
});

// The two banners that shared z-index 489 and the same
// top:0 rectangle. Reported: "sur l'iPhone le fait de cliquer sur le message
// a simplement lancé la sauvegarde" — the export reminder painted over the
// cloud-newer offer and its whole surface opens the backup screen.
describe("Overlays — only ONE top:0 banner renders", () => {
  const cloudNewer = { id: "f1", name: "cave-tabac-x.json", ts: Date.now(), counts: null };

  it("the export reminder stands down while a newer cloud backup is offered", () => {
    const { container } = renderWithCtx(<CuratorExportReminderBanner />, {
      view: "inv", exportReminder: true, cloudNewerBackup: cloudNewer,
      t: (k: string) => k,
    });
    expect(container.textContent || "").toBe("");
  });

  it("…and the cloud-newer offer does render in that same state", () => {
    const { container } = renderWithCtx(<CuratorCloudNewerBanner />, {
      view: "inv", exportReminder: true, cloudNewerBackup: cloudNewer,
      t: (k: string) => k,
    });
    expect(container.textContent || "").not.toBe("");
  });

  it("shows the export reminder when nothing outranks it", () => {
    const { container } = renderWithCtx(<CuratorExportReminderBanner />, {
      view: "inv", exportReminder: true, t: (k: string) => k,
    });
    expect(container.textContent || "").not.toBe("");
  });

  it("the photo error stands down under the quota warning", () => {
    const { container } = renderWithCtx(<CuratorPhotoErrorBanner />, {
      view: "inv", saveWarn: "quota-msg", photoErr: "photo-msg",
      t: (k: string) => k,
    });
    expect(container.textContent || "").toBe("");
  });

  it("a save error outranks the quota warning", () => {
    const { container } = renderWithCtx(<CuratorSaveWarnBanner />, {
      view: "inv", saveError: "save-msg", saveWarn: "quota-msg",
      t: (k: string) => k,
    });
    expect(container.textContent || "").toBe("");
  });

  it("the cloud-newer offer stands down on Home (Home renders its own)", () => {
    const { container } = renderWithCtx(<CuratorCloudNewerBanner />, {
      view: "home", cloudNewerBackup: cloudNewer, t: (k: string) => k,
    });
    expect(container.textContent || "").toBe("");
  });
});

// ─────────────────────────────────────────────────────────────
// The way OUT of the cloud-newer offer was the smaller
// target of the two, and it sat flush against the destructive one.
//
// « Restaurer » calls `stageImport(…)` on the whole cellar; the × beside it
// dismisses. In the Overlays copy the × was `minWidth/minHeight: 28` — under
// the house 44 — in a `gap: 8` row next to that button, so the harmless
// action was the harder one to hit and a miss landed on the destructive one.
//
// The fix deliberately does NOT raise « Restaurer » to 44: the house rule
// exists so a control can be REACHED, not so a destructive control is easier
// to hit by accident. The rule the two copies now share, and what these cases
// pin: the DISMISS is never smaller than « Restaurer », and they are never
// adjacent.
// ─────────────────────────────────────────────────────────────
describe("cloud-newer banner: the dismiss is the bigger target", () => {
  const cloudNewer2 = { id: "f1", name: "cave-tabac-x.json", ts: Date.now(), counts: null };

  it("the × is at least 44 and the two buttons are separated", () => {
    const { container } = renderWithCtx(<CuratorCloudNewerBanner />, {
      view: "inv", cloudNewerBackup: cloudNewer2, t: (k: string) => k,
    });
    const btns = Array.from(container.querySelectorAll("button"));
    expect(btns.length, "Restaurer + the dismiss ×").toBe(2);
    const [restore, dismiss] = btns as HTMLElement[];
    expect(dismiss!.textContent).toBe("×");
    expect(parseFloat(dismiss!.style.minWidth), "the way out must be reachable").toBeGreaterThanOrEqual(44);
    expect(parseFloat(dismiss!.style.minHeight)).toBeGreaterThanOrEqual(44);
    // …and never SMALLER than the destructive action beside it.
    const rw = parseFloat(restore!.style.minHeight || "0") || 28;
    expect(parseFloat(dismiss!.style.minHeight)).toBeGreaterThanOrEqual(rw);
    // A spacer sits between them — `gap: 8` alone put a cellar-replacing
    // button 8px from the control you reach for to make it go away.
    expect(restore!.nextElementSibling, "no gutter between them").not.toBe(dismiss);
    expect((restore!.nextElementSibling as HTMLElement).getAttribute("aria-hidden")).toBe("true");
  });

  // LA GÉOMÉTRIE ÉTAIT VERROUILLÉE, LA CIBLE NE L'ÉTAIT PAS.
  //
  // Tout le raisonnement au-dessus — le × au moins aussi gros que « Restaurer »,
  // une gouttière entre les deux — protège contre un doigt qui rate. Il ne dit
  // rien de ce que chaque bouton APPELLE. Recâbler le × sur
  // `restoreCloudNewerBackup` ne rougissait nulle part : le geste destiné à
  // faire disparaître la bannière remplacerait alors la cave entière par la
  // sauvegarde distante, en un tap, sans confirmation.
  //
  // Les deux sens comptent. Un « Restaurer » recâblé sur le rejet serait un
  // bouton mort plutôt qu'un désastre, mais c'est le même défaut vu de l'autre
  // côté, et un seul des deux cas laisserait la moitié du couple libre.
  it("le × REJETTE, et Restaurer RESTAURE", () => {
    const dismissCloudNewerBackup = vi.fn();
    const restoreCloudNewerBackup = vi.fn();
    const { container } = renderWithCtx(<CuratorCloudNewerBanner />, {
      view: "inv", cloudNewerBackup: cloudNewer2, t: (k: string) => k,
      dismissCloudNewerBackup, restoreCloudNewerBackup,
    });
    const [restore, dismiss] = Array.from(container.querySelectorAll("button")) as HTMLElement[];

    fireEvent.click(dismiss!);
    expect(dismissCloudNewerBackup).toHaveBeenCalledTimes(1);
    expect(restoreCloudNewerBackup, "le × a remplacé la cave").not.toHaveBeenCalled();

    dismissCloudNewerBackup.mockClear();
    fireEvent.click(restore!);
    expect(restoreCloudNewerBackup).toHaveBeenCalledTimes(1);
    expect(dismissCloudNewerBackup).not.toHaveBeenCalled();
  });
});
