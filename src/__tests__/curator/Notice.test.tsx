// Unit + snapshot tests for src/components/curator/Notice.tsx.
// Locks the 4-tier tone system (info / success / warn / error) so a
// future refactor of noticeToneColor / noticeDefaultIcon doesn't
// silently change which colour family each tone maps to.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  Notice,
  noticeToneColor,
  noticeDefaultIcon,
  statusToneFromMessage,
} from "../../components/curator/Notice";

describe("Notice", () => {
  it("renders children inside the notice body", () => {
    const { container } = render(<Notice>hello world</Notice>);
    expect(container.textContent).toContain("hello world");
  });

  it("renders an action slot to the right", () => {
    const { container } = render(
      <Notice action={<span data-testid="act">A</span>}>body</Notice>,
    );
    const action = container.querySelector("[data-testid=\"act\"]");
    expect(action).toBeTruthy();
  });

  it("a11y: warn/error are assertive live regions, info/success polite", () => {
    expect((render(<Notice tone="error">e</Notice>).container.firstChild as HTMLElement).getAttribute("role")).toBe("alert");
    expect((render(<Notice tone="warn">w</Notice>).container.firstChild as HTMLElement).getAttribute("role")).toBe("alert");
    expect((render(<Notice tone="success">s</Notice>).container.firstChild as HTMLElement).getAttribute("role")).toBe("status");
    expect((render(<Notice tone="info">i</Notice>).container.firstChild as HTMLElement).getAttribute("role")).toBe("status");
  });

  it("info tone (default) uses brassHi colour family", () => {
    const { container } = render(<Notice>body</Notice>);
    const el = container.firstChild as HTMLElement;
    // C.brassHi = #ecc789
    expect(el.style.color.toLowerCase()).toMatch(/#ecc789|rgb\(236,\s*199,\s*137\)/);
  });

  it("success tone uses sage", () => {
    const { container } = render(<Notice tone="success">body</Notice>);
    const el = container.firstChild as HTMLElement;
    // C.sage = #8fbf9c
    expect(el.style.color.toLowerCase()).toMatch(/#8fbf9c|rgb\(143,\s*191,\s*156\)/);
  });

  it("warn tone uses amber", () => {
    const { container } = render(<Notice tone="warn">body</Notice>);
    const el = container.firstChild as HTMLElement;
    // C.amber = #e89556
    expect(el.style.color.toLowerCase()).toMatch(/#e89556|rgb\(232,\s*149,\s*86\)/);
  });

  it("error tone uses oxbloodHi", () => {
    const { container } = render(<Notice tone="error">body</Notice>);
    const el = container.firstChild as HTMLElement;
    // C.oxbloodHi = #d27b6f
    expect(el.style.color.toLowerCase()).toMatch(/#d27b6f|rgb\(210,\s*123,\s*111\)/);
  });

  it("matches the snapshot for tone='info'", () => {
    const { container } = render(<Notice>info message</Notice>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches the snapshot for tone='success'", () => {
    const { container } = render(<Notice tone="success">success message</Notice>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches the snapshot for tone='warn'", () => {
    const { container } = render(<Notice tone="warn">warning message</Notice>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches the snapshot for tone='error'", () => {
    const { container } = render(<Notice tone="error">error message</Notice>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches the snapshot when an action slot is supplied", () => {
    const { container } = render(
      <Notice tone="warn" action={<button>Retry</button>}>
        Drive offline
      </Notice>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("noticeToneColor", () => {
  it("locks the 4-tier mapping", () => {
    // The actual hex values are defined in theme-curator.ts. The test
    // asserts that each tone resolves to a DISTINCT colour string —
    // any future remap to a duplicate would break the visual charter.
    const info = noticeToneColor("info");
    const success = noticeToneColor("success");
    const warn = noticeToneColor("warn");
    const error = noticeToneColor("error");
    expect(new Set([info, success, warn, error]).size).toBe(4);
  });
});

describe("noticeDefaultIcon", () => {
  it("maps each tone to the documented icon", () => {
    expect(noticeDefaultIcon("info")).toBe("more");
    expect(noticeDefaultIcon("success")).toBe("check");
    expect(noticeDefaultIcon("warn")).toBe("diamond");
    expect(noticeDefaultIcon("error")).toBe("close");
  });
});

describe("statusToneFromMessage", () => {
  it("returns 'info' for empty string", () => {
    expect(statusToneFromMessage("")).toBe("info");
  });

  it("recognises a success message (leading ✓)", () => {
    expect(statusToneFromMessage("✓ Sauvegardé")).toBe("success");
  });

  it("recognises a success message (word 'done')", () => {
    expect(statusToneFromMessage("backup done")).toBe("success");
  });

  it("recognises an error message", () => {
    expect(statusToneFromMessage("Erreur de sauvegarde")).toBe("error");
    expect(statusToneFromMessage("token expired")).toBe("error");
  });

  it("recognises the localized error prefixes incl. German", () => {
    // Cloud-status strings are now localized (t("err_prefix") = Erreur/Error/
    // Fehler/Errore). German "Fehler" must still classify as error.
    expect(statusToneFromMessage("Fehler: Ungültige Datei")).toBe("error");
    expect(statusToneFromMessage("Errore: file non valido")).toBe("error"); // "error" substring
    expect(statusToneFromMessage("Error: not authenticated")).toBe("error");
  });

  it("recognises a warning message", () => {
    expect(statusToneFromMessage("⚠ disk full")).toBe("warn");
    expect(statusToneFromMessage("Attention au quota")).toBe("warn");
  });

  it("falls back to 'info' for neutral text", () => {
    expect(statusToneFromMessage("4 backups available")).toBe("info");
  });
});
