// Curator SearchModal — global search across tobaccos / pipes / wishlist / accessories / sessions.
// Uses ctx.searchOpen / ctx.setSearchOpen, ctx.data, ctx.nav, ctx.setDetail, ctx.setPipeDet, ctx.setStatusFilter.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { safeBgUrl } from "../../utils/imgCache.ts";
import { fmtDate, findById, sessionEntityLabel } from "../../utils.ts";
import { alpha, fs, fsInput, C, F } from "../../theme-curator.ts";
import { CATS_EN, CUTS_EN, SHAPES_EN, BOWL_MATS_EN, ACC_TYPES_EN } from "../../constants.ts";
import { loadTobaccoDb, tobaccoDbSearchMatch, TobaccoDb } from "../../utils/tobaccoDb.ts";
import { useFocusRing } from "../../components/curator/FormFields.tsx";
import {
  Lbl, PressCard, useEnter,
} from "../../components/curator/primitives.tsx";
import { Ico, IcoName } from "../../components/curator/icons.tsx";
import { Modal } from "../../components/curator/Modal.tsx";

type Hit =
  | { kind: "tobacco"; id: any; title: string; subtitle: string; imageUrl?: string }
  | { kind: "pipe";    id: any; title: string; subtitle: string; imageUrl?: string }
  | { kind: "wish";    id: any; title: string; subtitle: string; imageUrl?: string }
  | { kind: "acc";     id: any; title: string; subtitle: string; imageUrl?: string }
  | { kind: "session"; id: any; title: string; subtitle: string; tobaccoId: any; imageUrl?: string }
  | { kind: "catalog"; id: string; title: string; subtitle: string };

function _has(needle: string, haystacks: any[]): boolean {
  for (const h of haystacks) {
    if (h && String(h).toLowerCase().indexOf(needle) !== -1) return true;
  }
  return false;
}

export function searchAll(query: string, data: any, dateFormat?: string, xl?: (v: any, map: any) => string): Hit[] {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: Hit[] = [];
  // Translate a canonical enum value to the active language when xl is
  // provided; fall back to the raw value otherwise (e.g. in unit tests).
  const X = (v: any, map: any) => (xl ? xl(v, map) : v);
  (data?.tobaccos || []).forEach((t: any) => {
    // Audit: also match the per-lot storage location + box number,
    // so the global search finds a tobacco by "Armoire A" / "B-2017" like the
    // inventory-list filter already does (the two surfaces were asymmetric).
    const lotFields = (Array.isArray(t.lots) ? t.lots : [])
      .flatMap((l: any) => (l ? [l.storageLocation, l.boxNumber] : []));
    if (_has(q, [t.name, t.brand, t.blend, t.tastingNotes, t.description, t.category, t.cut, ...(Array.isArray(t.tags) ? t.tags : []), ...lotFields])) {
      hits.push({
        kind: "tobacco", id: t.id,
        title: [t.brand, t.name].filter(Boolean).join(" — ") || "—",
        subtitle: [X(t.category, CATS_EN), X(t.cut, CUTS_EN)].filter(Boolean).join(" · "),
        imageUrl: t.imageUrl,
      });
    }
  });
  (data?.pipes || []).forEach((p: any) => {
    if (_has(q, [p.name, p.brand, p.notes, p.description, p.shape, p.bowlMaterial, p.stemMaterial, ...(Array.isArray(p.tags) ? p.tags : [])])) {
      hits.push({
        kind: "pipe", id: p.id,
        title: [p.brand, p.name].filter(Boolean).join(" — ") || "—",
        subtitle: [X(p.shape, SHAPES_EN), X(p.bowlMaterial, BOWL_MATS_EN)].filter(Boolean).join(" · "),
        imageUrl: p.imageUrl,
      });
    }
  });
  (data?.wishlist || []).forEach((w: any) => {
    if (_has(q, [w.name, w.brand, w.blend, w.notes, w.tastingNotes, w.description, w.category, w.cut])) {
      hits.push({
        kind: "wish", id: w.id,
        title: [w.brand, w.name].filter(Boolean).join(" — ") || "—",
        subtitle: [X(w.category, CATS_EN), X(w.cut, CUTS_EN)].filter(Boolean).join(" · "),
        imageUrl: w.imageUrl,
      });
    }
  });
  (data?.accessories || []).forEach((a: any) => {
    if (_has(q, [a.name, a.brand, a.notes, a.type, ...(Array.isArray(a.tags) ? a.tags : [])])) {
      hits.push({
        kind: "acc", id: a.id,
        title: [a.brand, a.name].filter(Boolean).join(" — ") || "—",
        subtitle: a.type ? X(a.type, ACC_TYPES_EN) : "",
        imageUrl: a.imageUrl,
      });
    }
  });
  (data?.sessions || []).forEach((s: any) => {
    if (!s.notes) return;
    if (String(s.notes).toLowerCase().indexOf(q) === -1) return;
    // Fall back to the session's tobaccoSnapshot when the
    // tobacco itself is gone (trashed or hard-deleted).
    const tob = findById<any>(data?.tobaccos as any[], s.tobaccoId);
    const tobName = sessionEntityLabel(tob, s.tobaccoSnapshot, "—");
    hits.push({
      kind: "session", id: s.id,
      title: `${s.date ? fmtDate(s.date, dateFormat) : ""} · ${tobName}`,
      subtitle: String(s.notes).slice(0, 80) + (s.notes.length > 80 ? "…" : ""),
      tobaccoId: s.tobaccoId,
      imageUrl: tob?.imageUrl,
    });
  });
  return hits;
}

// Search the catalogue the user loaded, so a query can find a blend that is
// not in their inventory yet. Pure — the loaded catalogue is passed in
// (SearchModal reads it lazily on open, never at cold start). Capped so a
// broad query doesn't flood the list; category/cut translated via xl like the
// rest.
export function searchCatalog(
  query: string, db: TobaccoDb | null | undefined,
  xl?: (v: any, map: any) => string, cap: number = 20,
): Hit[] {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2 || !db || !db.blends) return [];
  const X = (v: any, map: any) => (xl ? xl(v, map) : v);
  const out: Hit[] = [];
  for (const k of Object.keys(db.blends)) {
    const e = db.blends[k];
    if (!e || !tobaccoDbSearchMatch(k, e, q)) continue;
    const brandKey = String(k).split("|")[0] || "";
    const brandDisplay = (db.brands[brandKey] && db.brands[brandKey]!.displayName) || brandKey;
    out.push({
      kind: "catalog", id: k,
      title: [brandDisplay, e.name].filter(Boolean).join(" — ") || "—",
      subtitle: [X(e.category, CATS_EN), X(e.cut, CUTS_EN)].filter(Boolean).join(" · "),
    });
    if (out.length >= cap) break;
  }
  return out;
}

export function CuratorSearchModal() {
  const ctx = useAppCtx();
  const {
    searchOpen, setSearchOpen, data, dateFormat, t, xl, nav,
    setDetail, setPipeDet, setStatusFilter, setAccDet, setCatalogSeed, setWishFocusId,
  } = ctx;
  const [q, setQ] = useState("");
  const [catDb, setCatDb] = useState<TobaccoDb | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ring = useFocusRing();

  useEffect(() => {
    if (!searchOpen) { setQ(""); return; }
    // preventScroll. This runs while the page BEHIND the overlay is
    // wherever the user left it; focusing a field must not move it.
    const r = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    // Lazily load the reference catalog when the user opens search
    // (never on cold start — this is a user-triggered surface, like CatalogView).
    let mounted = true;
    if (!catDb) loadTobaccoDb().then((d) => { if (mounted && d) setCatDb(d); });
    return () => { mounted = false; cancelAnimationFrame(r); };
  }, [searchOpen, catDb]);

  const hits = useMemo(() => searchAll(q, data, dateFormat, xl), [q, data, dateFormat, xl]);
  const catHits = useMemo(() => searchCatalog(q, catDb, xl), [q, catDb, xl]);
  const totalCount = hits.length + catHits.length;
  const onNavigate = (h: Hit) => {
    if (h.kind === "tobacco") {
      const tob = (data?.tobaccos || []).find((t: any) => String(t.id) === String(h.id));
      if (tob) { nav && nav("inv"); setDetail && setDetail(tob); }
    } else if (h.kind === "pipe") {
      const p = (data?.pipes || []).find((x: any) => String(x.id) === String(h.id));
      if (p) { nav && nav("pipes"); setPipeDet && setPipeDet(p); }
    } else if (h.kind === "wish") {
      // Take the user to the CARD they tapped.
      //
      // This used to land on the wishlist and drop `h.id` on the floor — so a
      // search hit opened a 16-item list scrolled to the top, on a different
      // item, with nothing saying where the match went. Every other kind here
      // resolves to its specific row; this was the one that did not.
      //
      // The destination is the card, NOT the edit form: a wish has no fiche
      // (the card carries the whole record) and WishCard dropped
      // tap-to-edit precisely because a read expectation must not
      // land in a form. InventoryListView consumes wishFocusId once.
      nav && nav("inv");
      setStatusFilter && setStatusFilter("wish");
      setWishFocusId && setWishFocusId(h.id);
    } else if (h.kind === "acc") {
      const a = (data?.accessories || []).find((x: any) => String(x.id) === String(h.id));
      nav && nav("acc");
      if (a && setAccDet) setAccDet(a);
    } else if (h.kind === "session") {
      // Open the tobacco fiche the session refers to.
      const sess = (data?.sessions || []).find((x: any) => String(x.id) === String(h.id));
      const tob = sess && (data?.tobaccos || []).find((t: any) => String(t.id) === String(sess.tobaccoId));
      if (tob) {
        nav && nav("inv");
        setDetail && setDetail(tob);
      } else {
        nav && nav("journal");
      }
    } else if (h.kind === "catalog") {
      // Open the Catalogue prefilled with the query so the user lands on the
      // matching blend(s) and can add it to their inventory.
      setCatalogSeed && setCatalogSeed(q);
      nav && nav("catalog");
    }
    setSearchOpen && setSearchOpen(false);
  };

  const groups: { kind: Hit["kind"]; label: string; icon: IcoName; color: string; items: Hit[] }[] = [
    { kind: "tobacco", label: t ? t("search_grp_tobacco") : "Tabacs",      icon: "leaf",  color: C.brass,
      items: hits.filter(h => h.kind === "tobacco") },
    { kind: "pipe",    label: t ? t("search_grp_pipe")    : "Pipes",       icon: "pipe",  color: C.oxbloodHi,
      items: hits.filter(h => h.kind === "pipe") },
    { kind: "wish",    label: t ? t("search_grp_wish")    : "Wishlist",    icon: "heart", color: C.oxbloodHi,
      items: hits.filter(h => h.kind === "wish") },
    { kind: "acc",     label: t ? t("search_grp_acc")     : "Accessoires", icon: "flame", color: C.ember,
      items: hits.filter(h => h.kind === "acc") },
    { kind: "session", label: t ? t("search_grp_session") : "Séances",     icon: "book",  color: C.sage,
      items: hits.filter(h => h.kind === "session") },
    { kind: "catalog", label: t ? t("search_grp_catalog") : "Catalogue",   icon: "book",  color: C.brassHi,
      items: catHits },
  ];

  return (
    <Modal open={!!searchOpen} onClose={() => setSearchOpen && setSearchOpen(false)} maxWidth={540}
      ariaLabel={t ? t("search_modal_title") : "Recherche globale"}>
      <div style={{ padding: "16px 16px 12px" }}>
        <Lbl color={C.brassHi} size={10}>{t ? t("search_modal_title") : "Recherche globale"}</Lbl>
        <div style={{
          marginTop: 10, display: "flex", gap: 8, alignItems: "center",
          padding: "12px 14px", background: C.bg2,
          border: `1px solid ${C.rule2}`, borderRadius: 10,
        }}>
          <Ico name="search" size={17} sw={1.7} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t ? t("search_modal_input_ph") : "Tabac, pipe, marque, notes…"}
            aria-label={t ? t("search_modal_input_aria") : "Recherche"}
            onFocus={ring.onFocus}
            onBlur={ring.onBlur}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: C.ivory, fontFamily: F.body, fontSize: fsInput(17),
              padding: 0, minWidth: 0,
              borderRadius: 4,
              ...(ring.focused ? { boxShadow: `0 0 0 2px ${alpha(C.brassHi, "88")}` } : {}),
            }}
          />
          <button type="button"
            onClick={() => setSearchOpen && setSearchOpen(false)}
            aria-label={t ? t("btn_close") : "Fermer"}
            style={{
              background: "transparent", border: "none", color: C.tx2,
              fontFamily: F.mono, fontSize: fs(14.5), letterSpacing: 1,
              textTransform: "uppercase", cursor: "pointer", padding: "2px 4px",
            }}>esc</button>
        </div>
        <div style={{
          marginTop: 10, fontSize: fs(14.5), color: C.tx3,
          fontFamily: F.mono, letterSpacing: 0.5,
        }}>
          {String(q).trim().length < 2
            ? (t ? t("search_modal_hint_min") : "Tapez au moins 2 caractères")
            : totalCount === 0
              ? (t ? t("search_modal_hint_none") : "Aucun résultat")
              : `${totalCount} ${totalCount > 1 ? (t ? t("search_modal_hint_many") : "résultats") : (t ? t("search_modal_hint_one") : "résultat")}`}
        </div>
      </div>
      <div style={{ maxHeight: "min(60vh, 460px)", overflowY: "auto", overscrollBehavior: "contain", padding: "0 12px 16px" }}>
        {groups.map(g => g.items.length > 0 && (
          <div key={g.kind} style={{ marginTop: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 6px 8px" }}>
              <span style={{ color: g.color, display: "inline-flex" }}>
                <Ico name={g.icon} size={14} sw={1.8} />
              </span>
              <Lbl color={g.color}>{g.label}</Lbl>
              <Lbl color={C.tx3}>{String(g.items.length).padStart(2, "0")}</Lbl>
            </div>
            {g.items.map((hit, i) => (
              <SearchResult key={g.kind + "-" + i} hit={hit} color={g.color}
                onClick={() => onNavigate(hit)} delay={50 + i * 30} />
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function SearchResult({
  hit, color, onClick, delay,
}: { hit: Hit; color: string; onClick: () => void; delay: number }) {
  const e = useEnter(delay, { duration: 320, fromY: 8 });
  const { imgLocal } = useAppCtx();
  const hitImg = "imageUrl" in hit ? hit.imageUrl : undefined;
  const photo = hitImg ? ((imgLocal && imgLocal[hitImg]) || hitImg) : null;
  return (
    <PressCard onClick={onClick} style={{
      display: "flex", gap: 10, padding: "10px 12px", marginBottom: 6,
      background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
      alignItems: "center", ...e,
    }}>
      {photo ? (
        <div style={{
          width: 34, height: 34, borderRadius: 5, flexShrink: 0,
          background: `${safeBgUrl(photo)} center/cover no-repeat, ${C.bg3}`,
          border: `1px solid ${C.rule}`,
        }} />
      ) : (
        <span style={{
          width: 34, height: 34, borderRadius: 5, flexShrink: 0,
          background: alpha(color, "1c"), border: `1px solid ${alpha(color, "55")}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color, boxShadow: `0 0 8px ${alpha(color, "33")}`,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: F.display, fontSize: fs(17), color: C.ivory,
          letterSpacing: -0.2, lineHeight: 1.2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          <span style={{ fontStyle: "italic" }}>{hit.title}</span>
        </div>
        {hit.subtitle && (
          // The subtitle WRAPS; the title above it does not.
          //
          // Both halves are ENUM values (category · cut, shape · material,
          // accessory type), so the set is closed and the maximum is
          // computable: 34 characters, `Englisch-Aromatisch · Broken Flake`.
          // The string that was clipping — `Virginia/Burley · Crumble Cake`,
          // 30 chars, 235 px in a 216 px box at 360 px in German at the "L"
          // text size — is 13% short of that, so wrapping costs one extra line
          // and can never run away. The ellipsis was hiding the CUT outright,
          // on a result row whose whole job is saying which blend this is.
          //
          // The TITLE keeps nowrap + ellipsis, and must: a blend name is
          // user-supplied and unbounded. Same reasoning as the
          // maintenance-modal title, and the inverse of it for this line.
          <div style={{
            marginTop: 2, fontSize: fs(15), color: C.tx2,
            overflowWrap: "anywhere",
          }}>{hit.subtitle}</div>
        )}
      </div>
      <Ico name="chevron" size={14} sw={1.7} />
    </PressCard>
  );
}
