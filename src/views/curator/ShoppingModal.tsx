// Curator "Liste de courses" modal — the actionable shopping list.
// Aggregates two sources via computeShoppingList: OWNED tobaccos to rebuy —
// running low, used up and marked « À reprendre », or put on the list by hand
// from the fiche — + the wishlist. Each row carries a "got it" checkbox
// persisted in localStorage (cave-shopping-checked) so the list survives an
// app reload while you shop. A "Copier" button puts the un-checked rows on the
// clipboard as plain text. Mounted in CuratorApp next to the other modals;
// open/close via ctx.shoppingOpen / ctx.setShoppingOpen.

import { useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F, CARD_BG } from "../../theme-curator.ts";
import { Lbl } from "../../components/curator/primitives.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { Modal, ModalHeader } from "../../components/curator/Modal.tsx";
import { Notice } from "../../components/curator/Notice.tsx";
import { safeBgUrl } from "../../utils/imgCache.ts";
import { lsGet, lsSet } from "../../utils/appStorage.ts";
import { safeJsonParse } from "../../utils/safeJson.ts";
import { computeShoppingList, type ShoppingItem, lowStockThreshold } from "../../utils/shopping.ts";

const CHECKED_KEY = "cave-shopping-checked";

function readChecked(): Set<string> {
  const arr = safeJsonParse<string[]>(lsGet(CHECKED_KEY), []);
  return new Set(Array.isArray(arr) ? arr.map(String) : []);
}

export function CuratorShoppingModal() {
  const ctx = useAppCtx();
  const {
    shoppingOpen, setShoppingOpen,
    data, t, weightUnit = "g", watchLowWeight,
    imgLocal, crossOpenDetail, setStatusFilter, nav,
    setTobaccoToBuy, setTobaccoDiscontinued, setTobaccoRebuy, delWish,
  } = ctx;
  const tr = (k: string, frFallback: string) => (t ? t(k) : frFallback);
  const close = () => setShoppingOpen && setShoppingOpen(false);

  const [checked, setChecked] = useState<Set<string>>(readChecked);
  const [copied, setCopied] = useState(false);
  // The row whose « Pourquoi le retirer ? » panel is open (its `key`), if any.
  const [asking, setAsking] = useState<string | null>(null);

  const list = shoppingOpen
    ? computeShoppingList(data?.tobaccos || [], data?.wishlist || [], {
        lowWeightThreshold: lowStockThreshold(watchLowWeight, weightUnit),
      })
    : { restock: [], wishes: [] };
  const total = list.restock.length + list.wishes.length;

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      lsSet(CHECKED_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  }
  function resetChecks() {
    setChecked(new Set());
    lsSet(CHECKED_KEY, "[]");
  }

  function openItem(it: ShoppingItem) {
    close();
    if (it.kind === "restock") {
      const tob = (data?.tobaccos || []).find((x: any) => String(x?.id) === it.id);
      if (tob && crossOpenDetail) crossOpenDetail({ view: "inv", kind: "tobacco", obj: tob });
    } else {
      // Wish → land on the wishlist so the user can act on it there.
      // Audit: nav("inv") FIRST — it resets statusFilter to
      // "active" — THEN set "wish", or the reset (batched in the same handler)
      // wipes the filter and the user lands on the Active inventory. Matches
      // SearchModal's correct order.
      if (nav) nav("inv");
      if (setStatusFilter) setStatusFilter("wish");
    }
  }

  // « Retirer » — what it does depends on WHY the row is there, because the
  // list is computed, not stored:
  //  - added by hand → just undo that (`toBuy` off);
  //  - a wish        → delete the wish (soft, 30-day trash, with the undo
  //                    toast every delete carries);
  //  - put there by the app (stock bas / épuisé) → ASK WHY, and record the
  //    answer on the fiche. There is no « hide » flag: a row the app computed
  //    would come straight back, so the only honest removal is a reason —
  //    « plus disponible » or « je ne veux pas le racheter » — which is also
  //    information the user keeps. Their choice, from the two the menu offers.
  function removeItem(it: ShoppingItem) {
    if (it.kind === "wish") {
      // `it.id` is stringified; delWish matches the stored id STRICTLY.
      const w = (data?.wishlist || []).find((x: any) => String(x?.id) === it.id);
      if (w && delWish) delWish(w.id);
      return;
    }
    if (it.reason === "manual") {
      if (setTobaccoToBuy) setTobaccoToBuy(it.id, false);
      return;
    }
    setAsking(it.key);
  }
  function removeBecause(it: ShoppingItem, why: "discontinued" | "norebuy") {
    setAsking(null);
    if (why === "discontinued") { if (setTobaccoDiscontinued) setTobaccoDiscontinued(it.id, true); }
    else if (setTobaccoRebuy) setTobaccoRebuy(it.id, false);
  }

  function copyList() {
    const lines: string[] = [];
    const push = (header: string, items: ShoppingItem[]) => {
      const live = items.filter((i) => !checked.has(i.key));
      if (!live.length) return;
      lines.push(header);
      live.forEach((i) => lines.push("- " + [i.brand, i.name].filter(Boolean).join(" — ")));
      lines.push("");
    };
    push(tr("shopping_restock", "À racheter"), list.restock);
    push(tr("shopping_wishes", "Mes envies"), list.wishes);
    const text = String(lines.join("\n")).trim();
    if (!text) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => { setCopied(true); setTimeout(() => setCopied(false), 1800); },
          () => {},
        );
      }
    } catch (_e) { /* clipboard unavailable — no-op */ }
  }

  const row = (it: ShoppingItem) => {
    const on = checked.has(it.key);
    const photo = it.imageUrl ? ((imgLocal && imgLocal[it.imageUrl]) || it.imageUrl) : null;
    const accent = it.kind === "restock" ? C.amber : C.oxbloodHi;
    const label = [it.brand, it.name].filter(Boolean).join(" ");
    return (
      <div key={it.key}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 10px", background: CARD_BG, borderRadius: 8,
        // Was `opacity: on ? 0.5 : 1` on the WHOLE row. Two
        // problems. (a) It halves the contrast of text you still need to read —
        // to un-tick a row, or to check what you already picked up. (b) The
        // theme:contrast checker deliberately EXEMPTS opacity-dimmed elements
        // as "inactive components" (WCAG 1.4.3), so this row was invisible to
        // the one tool that would have measured it. A ticked shopping item is
        // completed, not inactive. The line-through on the name (already there)
        // and the sage tick carry the meaning; de-emphasis now goes through a
        // documented colour pair instead of a blanket alpha.
        border: `1px solid ${C.rule}`,
      }}>
        <button type="button" onClick={() => toggle(it.key)}
          // Every row used to carry the SAME static label, so a screen-reader
          // user heard "Coché, button" once per item with nothing to tell them
          // apart. The item identity is what makes the control usable.
          aria-label={[tr("shopping_check", "Marquer comme acheté"), [it.brand, it.name].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
          aria-pressed={on}
          style={{
            // WCAG 2.5.5 / docs/ui.md a11y invariant: 44px minimum. The visual
            // box stays 30px inside a transparent 44px target — a shopping list
            // is used one-handed while walking, the worst case for a small hit
            // area, and the row is already ~50px tall so nothing shifts.
            width: 44, height: 44, flexShrink: 0, padding: 0, cursor: "pointer",
            background: "transparent", border: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
          <span style={{
            width: 30, height: 30, borderRadius: 7,
            border: `1px solid ${on ? C.sage : C.rule2}`,
            background: on ? alpha(C.sage, "22") : "transparent",
            color: on ? C.sage : C.tx3,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {on ? <Ico name="check" size={16} sw={2.2} /> : null}
          </span>
        </button>
        <button type="button" onClick={() => openItem(it)}
          style={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10,
            background: "transparent", border: "none", padding: 0, cursor: "pointer",
            color: "inherit", font: "inherit", textAlign: "left",
          }}>
          {photo ? (
            <div style={{
              width: 34, height: 34, borderRadius: 7, flexShrink: 0, border: `1px solid ${C.rule2}`,
              background: `${safeBgUrl(photo)} center/cover no-repeat, ${C.bg2}`,
            }} />
          ) : (
            <div style={{
              width: 34, height: 34, borderRadius: 7, flexShrink: 0,
              background: alpha(accent, "18"), border: `1px solid ${alpha(accent, "44")}`, color: accent,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Ico name={it.kind === "restock" ? "leaf" : "heart"} size={15} sw={1.4} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: F.display, fontStyle: "italic", fontSize: fs(16), lineHeight: 1.15,
              // Ticked rows de-emphasise via a KNOWN contrast pair (tx2 is
              // documented at 8.37:1 on bg) rather than the old row-wide
              // opacity, so the text stays comfortably readable.
              color: on ? C.tx2 : C.ivory,
              // Wraps, like the brand line below: the 44 px « Retirer » target
              // took its width from this column, and at 360 px « Crown of the
              // North » needed 133 px of the 99 left — clipped in all six
              // languages. A shopping list is read in a shop; a cut-off name
              // is the one thing it must not show.
              overflowWrap: "anywhere",
              textDecoration: on ? "line-through" : "none",
            }}>{it.name || "—"}</div>
            {/* WRAPS rather than ellipsising. It was one nowrap line, which
                held while it only ever read « brand · 12g »; « épuisé » made it
                carry a translated word, and at 360 px with the large text size
                « Marlow & Finch · aufgebraucht » needed 196 px of a 153 px box —
                the deploy's i18n:layout caught it in five languages out of six
                (French's « épuisé » fitted). The state is the useful half of
                that line; cutting it off with « … » hid exactly that. */}
            <div style={{ fontSize: fs(12.5), color: C.tx2, overflowWrap: "anywhere" }}>
              {it.brand || "—"}
              {it.kind === "restock" && it.value > 0 ? " · " + it.value + weightUnit
                : it.kind === "restock" && it.soldOut ? " · " + tr("shopping_sold_out", "épuisé") : ""}
            </div>
          </div>
        </button>
        {/* The « › » chevron that sat here was dropped with the × : two glyphs
            at the row's end read as two actions on the same thing, and it cost
            the name 25 px. The row is still one button that opens the fiche. */}
        <button type="button" onClick={() => removeItem(it)}
          aria-label={tr("shopping_remove_item", "Retirer de la liste") + (label ? " · " + label : "")}
          aria-expanded={it.kind === "restock" && it.reason !== "manual" ? asking === it.key : undefined}
          style={{
            // 44 px target, same reasoning as the tick box on the left.
            width: 44, height: 44, flexShrink: 0, padding: 0, cursor: "pointer",
            background: "transparent", border: "none", color: C.tx3,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
          <Ico name="close" size={15} sw={2} />
        </button>
      </div>
      {asking === it.key && (
        <div role="group" aria-label={tr("shopping_why", "Pourquoi le retirer de la liste ?")} style={{
          margin: "4px 0 2px", padding: "10px 12px", borderRadius: 8,
          border: `1px solid ${C.rule2}`, background: CARD_BG,
        }}>
          <div style={{ fontSize: fs(14), color: C.ivory, marginBottom: 8 }}>
            {tr("shopping_why", "Pourquoi le retirer de la liste ?")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {([
              ["discontinued", tr("shopping_why_discontinued", "Plus disponible à l'achat")],
              ["norebuy", tr("shopping_why_norebuy", "Je ne veux pas le racheter")],
            ] as const).map(([why, text]) => (
              <button key={why} type="button" onClick={() => removeBecause(it, why)}
                style={{
                  minHeight: 44, padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${C.rule2}`, background: "transparent", color: C.tx,
                  fontFamily: F.body, fontSize: fs(14), fontWeight: 600, textAlign: "left",
                }}>{text}</button>
            ))}
            <button type="button" onClick={() => setAsking(null)}
              style={{
                minHeight: 44, padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                border: "none", background: "transparent", color: C.tx2,
                fontFamily: F.body, fontSize: fs(14), textAlign: "left",
              }}>{tr("btn_cancel", "Annuler")}</button>
          </div>
          <div style={{ marginTop: 8, fontSize: fs(12.5), color: C.tx3, lineHeight: 1.4 }}>
            {tr("shopping_why_hint", "Ce choix est enregistré sur la fiche du tabac, où vous pourrez le changer.")}
          </div>
        </div>
      )}
      </div>
    );
  };

  const section = (header: string, sub: string, accent: string, items: ShoppingItem[]) => {
    if (!items.length) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 3, height: 15, background: accent, borderRadius: 2 }} />
          <span style={{ fontFamily: F.display, fontStyle: "italic", fontSize: fs(19), color: C.ivory }}>{header}</span>
          <Lbl color={C.tx3} size={9.5}>{sub}</Lbl>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{items.map(row)}</div>
      </div>
    );
  };

  return (
    <Modal open={!!shoppingOpen} onClose={close} maxWidth={540}
      ariaLabel={tr("shopping_title", "Liste de courses")}>
      <ModalHeader
        overline={tr("shopping_overline", "à acheter")}
        title={tr("shopping_title", "Liste de courses")}
        onClose={close}
        accent={C.amber}
      />
      <div style={{ padding: "4px 18px 18px" }}>
        {total === 0 ? (
          <Notice tone="info">{tr("shopping_empty", "Rien à acheter pour l'instant — votre cave est bien remplie et votre liste d'envies est vide.")}</Notice>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <button type="button" onClick={copyList}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px",
                  borderRadius: 8, cursor: "pointer", fontFamily: F.body, fontSize: fs(14), fontWeight: 600,
                  border: `1px solid ${C.rule2}`, background: CARD_BG, color: copied ? C.sage : C.tx,
                }}>
                <Ico name={copied ? "check" : "book"} size={15} sw={1.8} />
                {copied ? tr("shopping_copied", "Liste copiée ✓") : tr("shopping_copy", "Copier la liste")}
              </button>
              {checked.size > 0 && (
                <button type="button" onClick={resetChecks}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px",
                    borderRadius: 8, cursor: "pointer", fontFamily: F.body, fontSize: fs(14), fontWeight: 600,
                    border: `1px solid ${C.rule2}`, background: "transparent", color: C.tx2,
                  }}>
                  <Ico name="close" size={14} sw={2} />
                  {tr("shopping_reset", "Décocher tout")}
                </button>
              )}
            </div>
            {section(tr("shopping_restock", "À racheter"), tr("shopping_restock_sub", "de votre cave"), C.amber, list.restock)}
            {section(tr("shopping_wishes", "Mes envies"), tr("shopping_wishes_sub", "à découvrir"), C.oxbloodHi, list.wishes)}
          </>
        )}
      </div>
    </Modal>
  );
}
