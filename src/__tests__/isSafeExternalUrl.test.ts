import { describe, it, expect } from "vitest";
import { isSafeExternalUrl } from "../utils/imgCache";

// ── Protocol checks ───────────────────────────────────────────────────────────

describe("isSafeExternalUrl — protocol", () => {
  it("allows https", () => {
    expect(isSafeExternalUrl("https://example.com/img.jpg")).toBe(true);
  });

  it("allows http", () => {
    expect(isSafeExternalUrl("http://example.com/img.jpg")).toBe(true);
  });

  it("blocks file:", () => {
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
  });

  it("blocks ftp:", () => {
    expect(isSafeExternalUrl("ftp://example.com/img.jpg")).toBe(false);
  });

  it("blocks data: URIs", () => {
    expect(isSafeExternalUrl("data:image/png;base64,abc")).toBe(false);
  });

  it("blocks javascript:", () => {
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
  });

  it("returns false for garbage input", () => {
    expect(isSafeExternalUrl("not-a-url")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
  });
});

// ── Localhost / loopback ──────────────────────────────────────────────────────

describe("isSafeExternalUrl — localhost / loopback", () => {
  it("blocks localhost by name", () => {
    expect(isSafeExternalUrl("http://localhost/img.jpg")).toBe(false);
  });

  it("blocks IPv6 loopback ::1", () => {
    expect(isSafeExternalUrl("http://[::1]/img.jpg")).toBe(false);
  });

  it("blocks IPv4 loopback 127.0.0.1", () => {
    expect(isSafeExternalUrl("http://127.0.0.1/img.jpg")).toBe(false);
  });

  it("blocks IPv4 loopback 127.x.x.x range", () => {
    expect(isSafeExternalUrl("http://127.0.0.2/img.jpg")).toBe(false);
    expect(isSafeExternalUrl("http://127.255.255.255/img.jpg")).toBe(false);
  });
});

// ── RFC-1918 private IPv4 ranges ──────────────────────────────────────────────

describe("isSafeExternalUrl — RFC-1918 private IPv4", () => {
  it("blocks 10.0.0.0/8", () => {
    expect(isSafeExternalUrl("http://10.0.0.1/img.jpg")).toBe(false);
    expect(isSafeExternalUrl("http://10.255.255.255/img.jpg")).toBe(false);
  });

  it("blocks 172.16.0.0/12", () => {
    expect(isSafeExternalUrl("http://172.16.0.1/img.jpg")).toBe(false);
    expect(isSafeExternalUrl("http://172.31.255.255/img.jpg")).toBe(false);
  });

  it("allows 172.15.x.x (just outside the range)", () => {
    expect(isSafeExternalUrl("http://172.15.0.1/img.jpg")).toBe(true);
  });

  it("allows 172.32.x.x (just outside the range)", () => {
    expect(isSafeExternalUrl("http://172.32.0.1/img.jpg")).toBe(true);
  });

  it("blocks 192.168.0.0/16", () => {
    expect(isSafeExternalUrl("http://192.168.0.1/img.jpg")).toBe(false);
    expect(isSafeExternalUrl("http://192.168.255.255/img.jpg")).toBe(false);
  });

  it("blocks link-local 169.254.0.0/16", () => {
    expect(isSafeExternalUrl("http://169.254.0.1/img.jpg")).toBe(false);
    expect(isSafeExternalUrl("http://169.254.169.254/img.jpg")).toBe(false);
  });
});

// ── IPv4-mapped IPv6 (SSRF gap fix) ──────────────────────────────────────────

describe("isSafeExternalUrl — IPv4-mapped IPv6", () => {
  it("blocks ::ffff:127.0.0.1 (loopback via mapped IPv6)", () => {
    expect(isSafeExternalUrl("http://[::ffff:127.0.0.1]/img.jpg")).toBe(false);
  });

  it("blocks ::ffff:192.168.1.1 (RFC-1918 via mapped IPv6)", () => {
    expect(isSafeExternalUrl("http://[::ffff:192.168.1.1]/img.jpg")).toBe(false);
  });

  it("blocks ::ffff:10.0.0.1 (RFC-1918 via mapped IPv6)", () => {
    expect(isSafeExternalUrl("http://[::ffff:10.0.0.1]/img.jpg")).toBe(false);
  });

  it("blocks ::ffff:172.16.0.1 (RFC-1918 via mapped IPv6)", () => {
    expect(isSafeExternalUrl("http://[::ffff:172.16.0.1]/img.jpg")).toBe(false);
  });

  it("blocks ::ffff:169.254.1.1 (link-local via mapped IPv6)", () => {
    expect(isSafeExternalUrl("http://[::ffff:169.254.1.1]/img.jpg")).toBe(false);
  });

});

// ── Bare hostnames ────────────────────────────────────────────────────────────

describe("isSafeExternalUrl — bare hostnames", () => {
  it("blocks hostnames without a dot", () => {
    expect(isSafeExternalUrl("http://intranet/img.jpg")).toBe(false);
  });

  it("allows hostnames with a dot", () => {
    expect(isSafeExternalUrl("https://cdn.example.com/img.jpg")).toBe(true);
  });
});

// ── Valid public URLs ─────────────────────────────────────────────────────────

describe("isSafeExternalUrl — valid public URLs", () => {
  it("allows typical external image URLs", () => {
    expect(isSafeExternalUrl("https://upload.wikimedia.org/img.jpg")).toBe(true);
    expect(isSafeExternalUrl("https://i.imgur.com/abc.jpg")).toBe(true);
  });

  it("allows URLs with query strings and paths", () => {
    expect(isSafeExternalUrl("https://example.com/path/img.jpg?size=800")).toBe(true);
  });
});

// ── hex / octal IP-literal obfuscation + 0.0.0.0 ────────────────────

describe("isSafeExternalUrl — encoded loopback/private literals", () => {
  it("blocks hex-encoded loopback (0x7f.0.0.1)", () => {
    expect(isSafeExternalUrl("http://0x7f.0.0.1/img.jpg")).toBe(false);
  });
  it("blocks octal-encoded loopback (0177.0.0.1)", () => {
    expect(isSafeExternalUrl("http://0177.0.0.1/img.jpg")).toBe(false);
  });
  it("blocks 0.0.0.0", () => {
    expect(isSafeExternalUrl("http://0.0.0.0/img.jpg")).toBe(false);
  });
  it("still allows a normal public dotted-decimal IP", () => {
    expect(isSafeExternalUrl("https://93.184.216.34/img.jpg")).toBe(true);
    // Octal that the URL parser normalises to a PUBLIC IP stays allowed
    // (010.0.0.1 → 8.0.0.1, a real public address — not a bypass).
    expect(isSafeExternalUrl("http://010.0.0.1/img.jpg")).toBe(true);
  });
});
