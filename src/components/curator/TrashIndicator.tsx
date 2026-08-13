// CuratorTrashIndicator — amber trash IconBtn that surfaces whenever
// `dataRaw` carries any soft-deleted entity or lot. Tap opens the
// dedicated CuratorTrashModal via `ctx.setTrashOpen`.
//
// Originally lived inline in HomeView; promoted to a shared
// component so it can ride along every list-view TopBar
// (Inventory, Pipes, Journal, Accessories) — the user shouldn't have
// to bounce back to Home just to see / open the Trash.
//
// Returns null when the trash is empty so the icon never decorates a
// clean app. The hasTrash check is intentionally cheap: a `.some()`
// over each kind, short-circuiting on the first hit.

import { useAppCtx } from "../../AppContext.tsx";
import { fs, C, F } from "../../theme-curator.ts";
import { IconBtn } from "./primitives.tsx";

export function CuratorTrashIndicator() {
  const ctx = useAppCtx();
  const { dataRaw, setTrashOpen, t } = ctx;
  const d: any = dataRaw || {};
  // Count instead of just "any" so the indicator can
  // expose a small badge. Users with 30+ trashed items had no signal
  // of volume; the count tells them whether to bother opening it.
  let count = 0;
  ["tobaccos", "pipes", "wishlist", "accessories", "sessions"].forEach((k) => {
    (d[k] || []).forEach((it: any) => { if (it && it.deletedAt) count++; });
  });
  (d.tobaccos || []).forEach((tb: any) => {
    if (tb && !tb.deletedAt && Array.isArray(tb.lots)) {
      tb.lots.forEach((l: any) => { if (l && l.deletedAt) count++; });
    }
  });
  if (count === 0) return null;
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <IconBtn
        icon="trash"
        color={C.amber}
        onClick={() => setTrashOpen && setTrashOpen(true)}
        ariaLabel={(t ? t("aria_open_trash") : "Ouvrir la corbeille") + ` (${count})`}
      />
      <span style={{
        position: "absolute", top: 2, right: 2,
        minWidth: 16, height: 16, padding: "0 4px",
        borderRadius: 8,
        background: C.amber, color: C.bg,
        fontFamily: F.mono, fontSize: fs(11), fontWeight: 800,
        display: "flex", alignItems: "center", justifyContent: "center",
        lineHeight: 1, pointerEvents: "none",
      }}>{count > 99 ? "99+" : count}</span>
    </div>
  );
}
