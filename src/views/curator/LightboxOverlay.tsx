// Curator LightboxOverlay — full-screen photo viewer. Reuses ctx.lightbox + ctx.setLightbox.

import { useEffect, useRef, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { C } from "../../theme-curator.ts";
import { IconBtn } from "../../components/curator/primitives.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { isSafeExternalUrl, imgCache } from "../../utils/imgCache.ts";

export function CuratorLightboxOverlay() {
  const ctx = useAppCtx();
  const { lightbox, setLightbox, imgLocal, t } = ctx;
  const [mounted, setMounted] = useState(false);
  // Ghost-tap defense. Closing the lightbox by tap used
  // to leak through to the trash icon in the detail view's TopBar
  // (same top-right screen position, same ≈14 px offset). On iOS
  // the synthetic click that follows touchend (~150 ms later)
  // lands on whatever element is at the original coordinates — if
  // the lightbox unmounted synchronously, that's the trash icon
  // and the entity gets deleted. Android Chrome has the same
  // bleed-through with the legacy 300 ms tap-delay path and any
  // pointer/click emulation chain.
  //
  // Fix: defer the actual unmount by ~260 ms so the backdrop stays
  // mounted and absorbs the bleed-through click. `closingRef` is a
  // ref (not state) so a second tap within the close window
  // returns early in the SAME render — a state-based guard would
  // still be reading the pre-update value through closure.
  const closingRef = useRef(false);

  useEffect(() => {
    if (lightbox) {
      closingRef.current = false;
      const r = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(r);
    }
    setMounted(false);
  }, [lightbox]);

  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    setMounted(false);
    // Match the 220 ms opacity transition + a small safety margin
    // so any iOS/Android-emulated click on touchend (≈150 ms after
    // touchstart) lands on the still-mounted backdrop, not the
    // element below.
    setTimeout(() => { setLightbox && setLightbox(null); }, 260);
  }

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox]);

  // Additional pipe photos are NOT in the global imgLocal (loaded
  // on demand only), so resolve a `local-photo-*` key from IndexedDB here when
  // it's missing from imgLocal — otherwise the extra photos show a placeholder.
  // NOTE (hook-order trap): this useState + useEffect MUST stay ABOVE the
  // `if (!lightbox) return null;` early return below. The overlay is always
  // mounted, so a null → set transition would otherwise grow the hook count
  // and crash with "Rendered more hooks than during the previous render" the
  // moment the user opens the lightbox. The effect body no-ops when lightbox
  // isn't a local-photo key, so running it while closed is harmless.
  const [ondemand, setOndemand] = useState<string | null>(null);
  useEffect(() => {
    setOndemand(null);
    if (typeof lightbox !== "string" || lightbox.indexOf("local-photo-") !== 0) return;
    if (imgLocal && imgLocal[lightbox]) return;
    let alive = true;
    imgCache.get(lightbox).then((v) => { if (alive && v) setOndemand(String(v)); }).catch(() => {});
    return () => { alive = false; };
  }, [lightbox, imgLocal]);

  if (!lightbox) return null;

  // Src can be a local data-URL (resolved via imgLocal) or
  // an external URL stored in `imageUrl`. Local data-URLs are always
  // safe (we put them there). External URLs are validated via the
  // same SSRF guard used everywhere else — a forged import can't
  // smuggle a tracking pixel or RFC-1918 probe through the lightbox.
  const cached = (imgLocal && imgLocal[lightbox]) || ondemand;
  const src = cached
    ? cached
    : (typeof lightbox === "string" && isSafeExternalUrl(lightbox) ? lightbox : null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t ? t("aria_image_viewer") : "Visionneuse d'image"}
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 250,
        background: "rgba(0,0,0,0.95)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
        opacity: mounted ? 1 : 0,
        transition: "opacity 220ms cubic-bezier(.2,.7,.3,1)",
      }}>
      <div style={{ position: "absolute", top: `max(env(safe-area-inset-top, 0), 14px)`, right: 14, zIndex: 260 }}>
        <IconBtn icon="close" onClick={close}
          color={C.ctaInk} bg="rgba(0,0,0,0.6)" border={false}
          ariaLabel={t ? t("btn_close") : "Fermer"} />
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: "100%", maxHeight: "100%",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
        transform: mounted ? "scale(1)" : "scale(0.96)",
        transition: "transform 320ms cubic-bezier(.34,1.56,.64,1)",
      }}>
        {src ? (
          <img src={src} alt="" style={{
            maxWidth: "100%", maxHeight: "80vh", borderRadius: 8,
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            border: `1px solid ${C.rule}`,
            WebkitTouchCallout: "default",
          }} />
        ) : (
          <div style={{
            width: "min(80vmin, 480px)", aspectRatio: "1 / 1",
            background: `linear-gradient(135deg, ${C.card}, ${C.bg2})`,
            border: `1px solid ${C.rule}`, borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: C.brass,
          }}>
            <Ico name="leaf" size={80} sw={1} />
          </div>
        )}
      </div>
    </div>
  );
}
