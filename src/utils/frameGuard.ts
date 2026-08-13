// Clickjacking defence, because the CSP directive that was
// supposed to provide it is INERT.
//
// `index.html` carries `frame-ancestors 'none'` in a `<meta http-equiv>` CSP,
// and CLAUDE.md claimed it "prevents clickjacking via iframes". It does not:
// CSP Level 3 §3.3 requires a user agent to REMOVE `frame-ancestors` (along
// with `report-uri` and `sandbox`) from a policy delivered by a meta element,
// so every browser silently drops it. The directive has never done anything.
//
// The header would work, and the app cannot send one: GitHub Pages serves
// static files with no header customisation, and there is no `_headers` /
// `netlify.toml` / reverse proxy in front of `t-cellar.app`.
//
// WHAT THE RISK ACTUALLY IS, since "clickjacking" is often waved around: an
// attacker cannot READ a cross-origin frame, so nothing leaks. What they can
// do is UI redress — put an invisible frame of the app over their own bait
// button. The frame runs on this origin, so it shows the visitor's REAL
// cellar. Most destructive actions here are safe from that by construction:
// the reset and « Vider la corbeille » sit behind `window.confirm`, which is
// browser chrome and cannot be overlaid, and an ordinary delete is a
// soft-delete with a 30-day trash. But at least one one-click destructive
// path exists — the cloud-newer banner's « Restaurer », which calls
// `stageImport(…, {autoApply:"replace"})` with no confirmation (recorded
// deliberately elsewhere). That is enough to be worth closing.
//
// THE DEFENCE IS "DO NOT RENDER", NOT "BUST OUT". Busting out
// (`top.location = self.location`) is tried first, but modern browsers block
// a cross-origin frame from navigating the top window without user
// activation — so in the drive-by case it fails, silently. An app that
// refuses to render, on the other hand, cannot be clicked through at all.
// Nothing in this project frames the app (the only iframe is OUTBOUND, to
// OpenStreetMap), so refusing costs no legitimate use.
//
// It lives in `main.jsx`, pre-mount, and NOT as an inline script in
// index.html: that document's CSP is `script-src 'self'` with no
// 'unsafe-inline' — a documented invariant — so an inline guard would be
// blocked by our own policy. Same reasoning as the pre-mount boot strings.

/**
 * True when this document is not the top-level browsing context.
 *
 * Reading `window.top` cross-origin is permitted and does not throw, so the
 * catch is belt-and-braces — and it fails CLOSED (an environment that refuses
 * to answer is treated as framed), because the cost of a false positive is a
 * message with a link out, and the cost of a false negative is the defect.
 */
export function isFramed(): boolean {
  if (typeof window === "undefined") return false;   // SSR / node — no frames
  try {
    return window.self !== window.top;
  } catch (_e) {
    return true;
  }
}

/** The six pre-mount strings, one per registry language. */
export type FrameNotice = { title: string; open: string };

/**
 * Replace the page with a plain notice and a link that opens the app for
 * real. Pre-mount and inline-styled on purpose: no React, no dictionary, no
 * theme — this must work when the app has deliberately refused to boot.
 *
 * The link carries `target="_top"`, which a USER CLICK is allowed to use even
 * when the automatic bust-out was blocked (a click grants activation). So the
 * way out always exists; it just requires the visitor's intent.
 */
export function renderFramedNotice(doc: Document, notice: FrameNotice, href: string): void {
  var root = doc.getElementById("root") || doc.body;
  if (!root) return;
  root.textContent = "";
  var box = doc.createElement("div");
  box.setAttribute("style",
    "min-height:100vh;display:flex;flex-direction:column;align-items:center;"
    + "justify-content:center;gap:16px;padding:24px;text-align:center;"
    + "background:#0e1311;color:#dcd4ba;font-family:sans-serif;font-size:15px;line-height:1.5");
  var p = doc.createElement("p");
  p.textContent = notice.title;
  p.setAttribute("style", "margin:0;max-width:34em");
  var a = doc.createElement("a");
  a.textContent = notice.open;
  a.setAttribute("href", href);
  a.setAttribute("target", "_top");
  a.setAttribute("rel", "noopener");
  a.setAttribute("style", "color:#ecc789;font-size:14px");
  box.appendChild(p);
  box.appendChild(a);
  root.appendChild(box);
}

/**
 * Best-effort escape from the frame. Returns true when the navigation was
 * ISSUED — never a promise that it worked, since the browser may block it
 * without throwing. The caller must render the notice either way.
 */
export function tryBustOut(win: Window): boolean {
  try {
    if (win.top && win.top !== win.self) {
      win.top.location = win.self.location.href as any;
      return true;
    }
  } catch (_e) { /* blocked — the notice is the real defence */ }
  return false;
}
