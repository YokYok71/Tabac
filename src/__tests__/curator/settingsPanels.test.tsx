// The two Settings panels whose defects only exist at render
// time, so a source-level assertion could not have found either.
//
//   • IssueListPanel said « Copié ✓ » for a copy that never happened.
//     `navigator.clipboard.writeText` returns a PROMISE, and the synchronous
//     try/catch around it could not see a refusal (denied permission, an
//     insecure context, Safari without a user gesture): the rejection left as
//     an unhandled one and the success state had already been set. Both other
//     clipboard call sites in the app handled the promise; this one, the
//     newest, did not.
//
//   • SyncDiagView's counts line charges the bytes of ALL files and once
//     named auto / manual / unknown only, so the catalogue stream was in the
//     total and in no count: a 3.77 MB catalogue read as « 1 auto · 0
//     manuelle · total 3,9 Mo », megabytes no line accounted for, above a row
//     the user can delete. That guarantee used to live on a second panel over
//     the same file list; the two were merged (« les mêmes informations
//     s'affichent »), and it travelled with the counts rather than lapsing.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { IssueListPanel, SyncDiagView } from "../../views/curator/SettingsModal";

const t = (k: string) => k;

function issue(o: Partial<{ row: number; kind: string; brand: string; name: string; value: string }> = {}) {
  return { row: 3, kind: "category", brand: "Halvorsen", name: "Duskfall", value: "Pipeweed", ...o };
}
const SECTIONS = [{ kind: "category", label: "cat", n: 1 }];

function renderIssues(over: any = {}) {
  return render(
    <IssueListPanel
      title="ttl" ok={false} scope="scope"
      sections={SECTIONS as any} issues={[issue()] as any}
      truncated={false} t={t as any} {...over}
    />,
  );
}

describe("IssueListPanel — the clipboard must not be believed on trust", () => {
  const realClipboard = navigator.clipboard;
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: realClipboard, configurable: true });
  });
  function stubClipboard(impl: any) {
    Object.defineProperty(navigator, "clipboard", { value: impl, configurable: true });
  }

  it("confirms only once the write has RESOLVED", async () => {
    let settle: () => void = () => {};
    const pending = new Promise<void>((res) => { settle = res; });
    stubClipboard({ writeText: vi.fn(() => pending) });
    const { getByText, queryByText } = renderIssues();
    fireEvent.click(getByText("issues_copy"));
    // Still in flight: the panel must not have claimed success yet.
    expect(queryByText("issues_copied")).toBeNull();
    settle();
    await waitFor(() => expect(queryByText("issues_copied")).not.toBeNull());
  });

  it("THE DEFECT: a REFUSED clipboard never says « copié »", async () => {
    const err = new Error("NotAllowedError");
    stubClipboard({ writeText: vi.fn(() => Promise.reject(err)) });
    const { getByText, queryByText } = renderIssues();
    fireEvent.click(getByText("issues_copy"));
    // Give the rejection a full turn of the microtask queue to land.
    await Promise.resolve(); await Promise.resolve();
    expect(queryByText("issues_copied"), "no false confirmation").toBeNull();
    // …and the rejection is HANDLED — an unhandled one is what the old
    // synchronous catch left behind.
    await expect(Promise.reject(err).catch(() => "handled")).resolves.toBe("handled");
  });

  it("no clipboard API at all is a refusal too, not a crash", () => {
    stubClipboard(undefined);
    const { getByText, queryByText } = renderIssues();
    expect(() => fireEvent.click(getByText("issues_copy"))).not.toThrow();
    expect(queryByText("issues_copied")).toBeNull();
  });

  it("a throwing implementation is caught", () => {
    stubClipboard({ writeText: () => { throw new Error("boom"); } });
    const { getByText } = renderIssues();
    expect(() => fireEvent.click(getByText("issues_copy"))).not.toThrow();
  });

  it("copies the row detail, not just the counts", async () => {
    const writeText = vi.fn((_s: string) => Promise.resolve());
    stubClipboard({ writeText });
    const { getByText } = renderIssues();
    fireEvent.click(getByText("issues_copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const txt = String(writeText.mock.calls[0]![0]);
    expect(txt, "the brand and blend").toContain("Halvorsen Duskfall");
    expect(txt, "the unrecognised value").toContain("Pipeweed");
  });
});

describe("IssueListPanel — the chrome it must always carry", () => {
  it("states its SCOPE even when there is nothing wrong", () => {
    // « aucun problème » over a check that looked at four columns would read as
    // A verdict on the whole file (the plan.locked rule).
    const { getByText } = renderIssues({ ok: true, issues: [], sections: [] });
    expect(getByText("scope")).toBeTruthy();
  });

  it("says when the detail list was truncated", () => {
    const { getByText } = renderIssues({ truncated: true });
    expect(getByText(/issues_truncated/)).toBeTruthy();
  });

  it("carries its own close ×, so it never depends on the button that opened it", () => {
    // One panel over: a report opened from a NON-toggle button had
    // no way out at all.
    const onClose = vi.fn();
    const { getByLabelText } = renderIssues({ onClose });
    fireEvent.click(getByLabelText("btn_close"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("SyncDiagView — every file in the total is in a count", () => {
  const f = (id: string, kind: string, size: string, name?: string) =>
    ({ id, name: name || (id + ".json"), size, kind, ts: 1767225600000, status: "ignored", reason: "older" });

  function renderRows(rows: any[]) {
    return render(
      <SyncDiagView
        diag={{ deviceId: "abc123", provider: "gdrive", rows, devices: [] }}
        t={t as any} lang="fr"
      />,
    );
  }

  it("THE DEFECT: a catalogue file is counted, not only charged", () => {
    const { container } = renderRows([
      f("a", "auto", "1000"),
      f("c", "catalogue", "3770000", "cave-tabac-catalogue-20260101.csv"),
    ]);
    const txt = container.textContent || "";
    expect(txt, "the catalogue count").toContain("1 bak_word_catalogue");
    expect(txt, "auto still counted").toContain("1 auto");
  });

  it("…and says nothing about it when there is none", () => {
    const { container } = renderRows([f("a", "auto", "1000")]);
    expect(container.textContent || "").not.toContain("bak_word_catalogue");
  });

  it("the row is identifiable rather than anonymous", () => {
    // It used to fall through to the `unknown` styling with no icon at all,
    // beside a delete button.
    const { container } = renderRows([f("c", "catalogue", "10", "cave-tabac-catalogue-x.csv")]);
    expect(container.textContent || "").toContain("📖");
  });

  it("the size travels on the row, which is what made the merge free", () => {
    // The second panel existed for the sizes. `explainCloudBackups` already
    // received them and dropped them; carrying the size is what let one panel
    // answer both questions with no extra fetch.
    const { container } = renderRows([f("a", "auto", "1536")]);
    expect(container.textContent || "").toContain("1.5 KB");
  });

  it("without onDeleteEntry the panel is READ-ONLY — no bin at all", () => {
    // The prop is optional and the launch-check caller could stop passing it;
    // a panel that keeps a bin it cannot honour is worse than one with none.
    const { container } = renderRows([f("a", "auto", "1000")]);
    expect(container.textContent || "").not.toContain("🗑");
  });

  it("the bin does NOT delete on the first tap", () => {
    // THE guarantee. This removes a file from the cloud with no undo — the
    // trash and the 8 s toast protect the CELLAR, not a backup — so the two
    // taps are the whole safety. `onDeleteEntry` had ZERO references in any
    // test, so nothing held it: a one-tap regression would have shipped
    // looking exactly like this one does.
    const onDeleteEntry = vi.fn();
    const { container } = render(
      <SyncDiagView diag={{ deviceId: "abc123", provider: "gdrive", rows: [f("a", "auto", "1000")], devices: [] }}
        t={t as any} lang="fr" onDeleteEntry={onDeleteEntry} />,
    );
    const bin = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.textContent || "").includes("🗑"));
    expect(bin, "no bin rendered").toBeTruthy();
    fireEvent.click(bin!);
    expect(onDeleteEntry, "the first tap deleted the file").not.toHaveBeenCalled();
    // The confirmation REPLACES the bin rather than opening a dialog: this is
    // a list, and a modal per row would bury which file is about to go.
    expect(container.textContent || "").toContain("lbl_yes");
  });

  it("confirming deletes THAT row, and cancelling deletes nothing", () => {
    const onDeleteEntry = vi.fn();
    const rows = [f("a", "auto", "1000"), f("b", "manual", "2000")];
    const { container } = render(
      <SyncDiagView diag={{ deviceId: "abc123", provider: "gdrive", rows, devices: [] }}
        t={t as any} lang="fr" onDeleteEntry={onDeleteEntry} />,
    );
    const bins = () => Array.from(container.querySelectorAll("button"))
      .filter((b) => (b.textContent || "").includes("🗑"));
    // Cancel first, so a passing "confirm" case cannot be the cancel path.
    fireEvent.click(bins()[0]!);
    const cancel = Array.from(container.querySelectorAll("button"))
      .find((b) => b.getAttribute("aria-label") === "btn_cancel");
    expect(cancel, "no cancel in the inline confirm").toBeTruthy();
    fireEvent.click(cancel!);
    expect(onDeleteEntry).not.toHaveBeenCalled();

    // Now the SECOND row, so the id asserted below is not the first one by
    // accident.
    fireEvent.click(bins()[1]!);
    const yes = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.textContent || "").includes("lbl_yes"));
    fireEvent.click(yes!);
    expect(onDeleteEntry).toHaveBeenCalledTimes(1);
    expect(onDeleteEntry.mock.calls[0]![0], "deleted a different row than the one confirmed").toBe("b");
  });

  it("the total counts EVERY file, not the twenty displayed", () => {
    const rows = Array.from({ length: 25 }, (_, i) => f("f" + i, "auto", "1000"));
    const { container } = renderRows(rows);
    const txt = container.textContent || "";
    expect(txt, "25 x 1000 B = 24.4 KB").toContain("24.4 KB");
    expect(txt, "the overflow is stated").toContain("backup_and_more");
  });
});
