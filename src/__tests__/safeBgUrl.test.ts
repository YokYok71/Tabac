import { describe, it, expect } from "vitest";
import { safeBgUrl } from "../utils/imgCache";

// safeBgUrl wraps a URL so it can be safely interpolated into inline
// `background: ${safeBgUrl(x)}`. It must:
//   - return "" for anything it cannot safely render (the caller falls
//     back to a gradient/icon)
//   - allow IndexedDB data URLs and blob URLs (no remote risk)
//   - allow plain HTTPS URLs after stripping CSS metacharacters
//   - reject SSRF-prone hosts via isSafeExternalUrl

describe("safeBgUrl — input gating", () => {
  it("returns empty for null/undefined/empty", () => {
    expect(safeBgUrl(null)).toBe("");
    expect(safeBgUrl(undefined)).toBe("");
    expect(safeBgUrl("")).toBe("");
  });
});

describe("safeBgUrl — data URLs", () => {
  it("wraps a clean image data URL", () => {
    const u = "data:image/png;base64,iVBORw0KGgo=";
    expect(safeBgUrl(u)).toBe(`url("${u}")`);
  });

  it("accepts jpeg / jpg / webp / gif", () => {
    expect(safeBgUrl("data:image/jpeg;base64,XX")).toBe(`url("data:image/jpeg;base64,XX")`);
    expect(safeBgUrl("data:image/jpg;base64,XX")).toBe(`url("data:image/jpg;base64,XX")`);
    expect(safeBgUrl("data:image/webp;base64,XX")).toBe(`url("data:image/webp;base64,XX")`);
    expect(safeBgUrl("data:image/gif;base64,XX")).toBe(`url("data:image/gif;base64,XX")`);
  });

  it("rejects non-image data URLs", () => {
    expect(safeBgUrl("data:text/html;base64,XX")).toBe("");
    expect(safeBgUrl("data:application/javascript,alert(1)")).toBe("");
    expect(safeBgUrl("data:image/svg+xml;base64,XX")).toBe("");
  });

  it("strips embedded double quotes (defence-in-depth)", () => {
    const u = `data:image/png;base64,AA"BB`;
    expect(safeBgUrl(u)).toBe(`url("data:image/png;base64,AABB")`);
  });
});

describe("safeBgUrl — blob URLs", () => {
  it("wraps a blob URL", () => {
    const u = "blob:https://example.com/abc-123";
    expect(safeBgUrl(u)).toBe(`url("${u}")`);
  });

  it("strips embedded double quotes in blob URLs", () => {
    expect(safeBgUrl(`blob:abc"def`)).toBe(`url("blob:abcdef")`);
  });
});

describe("safeBgUrl — HTTPS URLs", () => {
  it("wraps a clean https URL", () => {
    expect(safeBgUrl("https://example.com/img.jpg"))
      .toBe(`url("https://example.com/img.jpg")`);
  });
});

describe("safeBgUrl — protocol rejection", () => {
  it("blocks javascript: scheme", () => {
    expect(safeBgUrl("javascript:alert(1)")).toBe("");
  });

  it("blocks file: scheme", () => {
    expect(safeBgUrl("file:///etc/passwd")).toBe("");
  });

  it("blocks ftp: scheme", () => {
    expect(safeBgUrl("ftp://example.com/img.jpg")).toBe("");
  });
});

describe("safeBgUrl — SSRF hosts", () => {
  it("blocks localhost", () => {
    expect(safeBgUrl("http://localhost/x.jpg")).toBe("");
  });

  it("blocks 127.x.x.x", () => {
    expect(safeBgUrl("http://127.0.0.1/x.jpg")).toBe("");
  });

  it("blocks 10.x.x.x", () => {
    expect(safeBgUrl("http://10.0.0.5/x.jpg")).toBe("");
  });

  it("blocks 172.16-31.x.x", () => {
    expect(safeBgUrl("http://172.16.0.1/x.jpg")).toBe("");
    expect(safeBgUrl("http://172.31.255.255/x.jpg")).toBe("");
  });

  it("allows 172.15.x and 172.32.x (just outside RFC-1918)", () => {
    expect(safeBgUrl("http://172.15.0.1/x.jpg")).toBe(`url("http://172.15.0.1/x.jpg")`);
    expect(safeBgUrl("http://172.32.0.1/x.jpg")).toBe(`url("http://172.32.0.1/x.jpg")`);
  });

  it("blocks 192.168.x.x", () => {
    expect(safeBgUrl("http://192.168.1.1/x.jpg")).toBe("");
  });

  it("blocks 169.254.x.x (link-local)", () => {
    expect(safeBgUrl("http://169.254.169.254/x.jpg")).toBe("");
  });

  it("blocks bare hostnames (no dot)", () => {
    expect(safeBgUrl("http://internalhost/x.jpg")).toBe("");
  });
});

describe("safeBgUrl — CSS metacharacter rejection (external URLs)", () => {
  it("rejects URLs containing double quotes", () => {
    expect(safeBgUrl(`https://example.com/a"b.jpg`)).toBe("");
  });

  it("rejects URLs containing single quotes", () => {
    expect(safeBgUrl(`https://example.com/a'b.jpg`)).toBe("");
  });

  it("rejects URLs containing parentheses", () => {
    expect(safeBgUrl("https://example.com/(x).jpg")).toBe("");
  });

  it("rejects URLs containing backslashes", () => {
    expect(safeBgUrl("https://example.com/a\\b.jpg")).toBe("");
  });

  it("rejects URLs containing semicolons", () => {
    expect(safeBgUrl("https://example.com/a;b.jpg")).toBe("");
  });

  it("rejects URLs containing newlines / tabs", () => {
    expect(safeBgUrl("https://example.com/a\nb.jpg")).toBe("");
    expect(safeBgUrl("https://example.com/a\rb.jpg")).toBe("");
    expect(safeBgUrl("https://example.com/a\tb.jpg")).toBe("");
  });
});

describe("safeBgUrl — encoded URL output", () => {
  it("encodes spaces via encodeURI when not pre-encoded", () => {
    // Whitespace is in the metachar reject list — but Unicode-only chars
    // in a path should round-trip through encodeURI.
    expect(safeBgUrl("https://example.com/é.jpg"))
      .toBe(`url("https://example.com/%C3%A9.jpg")`);
  });
});
