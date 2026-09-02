// Bottom navigation dock with animated brass indicator.
// All styles inline; the indicator slides via CSS transition on `left`.

import { alpha, fs, C, F } from "../../theme-curator.ts";
import { Ico, IcoName } from "./icons.tsx";
import { useReliableTap } from "./primitives.tsx";

export interface DockItem {
  id: string;
  label: string;
  icon: IcoName;
}

// Canonical dock items with their icon + id. The `label` here is a
// French fallback only — CuratorApp overrides every label by resolving a
// "dock_<id>" i18n key before passing `items` in, so all UI languages
// (fr/en/es/de/it and any future one) are covered content-only by the
// i18n dictionaries.
export const DOCK_ITEMS: DockItem[] = [
  { id: "home",    label: "Cave",    icon: "home"  },
  { id: "inv",     label: "Tabacs",  icon: "leaf"  },
  { id: "pipes",   label: "Pipes",   icon: "pipe"  },
  { id: "acc",     label: "Access.", icon: "flame" },
  { id: "journal", label: "Journal", icon: "book"  },
  { id: "stats",   label: "Stats",   icon: "chart" },
];

export interface BottomDockProps {
  active: string | null;
  onNav: (id: string) => void;
  accent?: string | undefined;
  items?: DockItem[] | undefined;
  /** Accessible name of the tab bar. Was the hardcoded French/English
   *  "Sections", so es/de/it screen-reader users heard the wrong word even
   *  though `sec_sections` exists in all five dictionaries. Passed IN, like the
   *  item labels — this component takes already-translated strings and has no
   *  access to `t` (deliberate: it is a pure presentational primitive). */
  navLabel?: string | undefined;
  /** Durée de la transition d'escamotage — "0ms" quand l'utilisateur
   *  demande moins de mouvement. Passée IN, comme les libellés : ce primitif
   *  ne lit ni contexte ni media query. */
  motionMs?: string | undefined;
  /** Escamotage au défilement. Le dock est monté en PORTAIL sur `document.body`,
   *  donc il n'hérite pas de la propriété personnalisée que la coquille pose
   *  pour la TopBar — il faut la lui passer. La décision reste unique et vit
   *  dans `utils/chromeAutoHide.ts`. */
  hidden?: boolean | undefined;
}

export function BottomDock({ active, onNav, accent = C.brass, items = DOCK_ITEMS, navLabel = "Sections", hidden = false, motionMs = "220ms" }: BottomDockProps) {
  const activeIdx = items.findIndex(it => it.id === active);
  return (
    <div style={{
      position: "fixed",
      left: 0, right: 0, bottom: 0,
      // Sit the floating pill LOWER — "au ras"
      // (option C). It dips further into the home-indicator safe area (~20px of
      // a ~34px notch inset, leaving ~14px clearance so it stays just ABOVE the
      // indicator bar) and floors at 6px for non-safe-area devices (env=0).
      // MUST be validated on the installed iOS PWA — this is exactly the
      // safe-area behaviour that headless/Safari-browser can't reproduce.
      paddingBottom: `max(calc(env(safe-area-inset-bottom, 0px) - 20px), 6px)`,
      paddingTop: 4,
      // The outer strip is fully transparent and lets pointer events
      // pass THROUGH (only the pill captures taps) so the page content scrolls
      // edge-to-edge behind the translucent pill — the iOS "content under the
      // tab bar" look. The former opaque `C.bg` gradient masked content and is
      // gone. The content wrapper's paddingBottom still keeps the last item
      // clear of the pill at rest.
      background: "transparent",
      pointerEvents: "none", zIndex: 30,
      display: "flex", justifyContent: "center",
      // COMPOSITING PROMOTION — the dock "swims" mid-screen during a scroll.
      //
      // Reported from the installed iOS PWA with a scrolling screenshot that
      // showed the pill halfway up the page. TRIAGED WITH THE USER rather than
      // guessed, and the triage is what identifies it: AT REST at the very
      // bottom of a page the pill sits correctly OVER the last content, so
      // `position: fixed` IS resolving against the viewport and this is NOT
      // the historical "dock dropped into flow" bug — the four guardrails for
      // that (portal / overflow-x:clip / width:100% / no viewport-meta swap)
      // are all intact and their tests are green. It happens on EVERY
      // scrolling page, and only WHILE scrolling.
      //
      // That is the WebKit behaviour where a fixed element painted on the main
      // thread lags behind compositor-driven scrolling and visually drifts,
      // settling when the gesture ends. Promoting it to its own layer takes it
      // off that path.
      //
      // SAFE with respect to this file's own warnings: the rule they state is
      // that an ANCESTOR gaining a containing-block property drops a fixed
      // child into flow. This sits on the fixed element ITSELF, which cannot
      // change its own containing block; it becomes one only for descendants,
      // and the sole positioned descendants (the pill, its indicator) are
      // already contained by the pill.
      //
      // The risk this shipped with — that the pill's `backdrop-filter` would
      // lose its backdrop under a transformed ancestor — is CLEARED: checked on
      // the installed PWA, the glass is still blurred. WebKit does not treat
      // this transform as a backdrop root, so promoting the outer strip is
      // compatible with a backdrop-filter on the pill inside it.
      // LE `translateZ(0)` EST COMPOSÉ, PAS REMPLACÉ : il est là délibérément
      // pour que le flou d'arrière-plan garde sa racine (voir la note
      // au-dessus), donc l'écrire seul en le perdant casserait un invariant
      // gagné à la main. On descend de 140 % plutôt que 100 % pour emporter
      // aussi l'ombre portée et la marge de sécurité du bas d'écran.
      transform: hidden ? "translateZ(0) translateY(140%)" : "translateZ(0)",
      transition: `transform ${motionMs} cubic-bezier(0.22, 1, 0.36, 1)`,
      willChange: "transform",
    }}>
      <div style={{
        margin: "0 12px",
        width: "100%", maxWidth: 736, // 760 column - 12*2 margin
        // The glass is nudged a touch MORE transparent (0.32 → 0.24)
        // so even more scrolling content shows through the frosted pill — the
        // subtle iOS/RTS translucent tab bar. The heavy blur still keeps the
        // dock labels legible over busy content underneath.
        background: C.dockPill,
        backdropFilter: "blur(24px) saturate(1.3)",
        WebkitBackdropFilter: "blur(24px) saturate(1.3)",
        border: `1px solid ${C.rule2}`,
        borderRadius: 20,
        // Thinner pill (option C — "au ras + compact").
        padding: "5px 4px",
        position: "relative",
        pointerEvents: "auto",
        // Tokenised — was hardcoded here and therefore identical in
        // light mode. See C.dockShadow; the dark value is byte-identical.
        boxShadow: C.dockShadow,
      }}>
        {/* Animated brass indicator */}
        {activeIdx >= 0 && (
          <div style={{
            position: "absolute", top: 4, height: 2,
            // The bar is centred on the active tab at 60% of the
            // cell width. Full-cell width flush to the pill edge overhung the
            // pill's rounded corners (radius 20) on the first/last tab — the
            // bar floated outside the glass on the installed PWA. The 4px
            // horizontal pill padding is subtracted so the bar tracks the
            // actual tab cells.
            width: `calc((100% - 8px) * ${0.6 / items.length})`,
            left: `calc(4px + (100% - 8px) * ${(activeIdx + 0.5) / items.length})`,
            transform: "translate(-50%, -50%)",
            background: accent, borderRadius: 1,
            boxShadow: `0 0 10px ${alpha(accent, "aa")}`,
            transition: "left 360ms cubic-bezier(.4,1.4,.5,1), background 300ms, box-shadow 300ms",
            pointerEvents: "none",
          }}>
            <div style={{
              position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)",
              width: 24, height: 4,
              background: `radial-gradient(ellipse, ${alpha(accent, "cc")}, transparent 70%)`,
              filter: "blur(3px)",
            }} />
          </div>
        )}
        {/* a11y: a navigation landmark so screen-reader users
            can jump to the tab bar, with aria-current marking the active tab. */}
        <nav aria-label={navLabel} style={{ display: "flex", justifyContent: "space-around" }}>
          {items.map(it => (
            <DockBtn key={it.id}
              item={it}
              active={it.id === active}
              accent={accent}
              onNav={onNav} />
          ))}
        </nav>
      </div>
    </div>
  );
}

// Individual dock button — moved out of the BottomDock component
// so each tab can carry its own `pressed` state for instant visual feedback.
// Without this, tapping a dock item triggered navigation but the user saw
// no immediate response until the new view finished mounting (HomeView
// in particular animates a lot on entry), which felt like the tap had
// been ignored. The press scale + background tint fire on `pointerDown`,
// so feedback is immediate regardless of how long the navigation takes.
function DockBtn({
  item: it, active: on, accent, onNav,
}: {
  item: DockItem; active: boolean; accent: string;
  onNav: (id: string) => void;
}) {
  // Routed through the shared `useReliableTap` hook so all
  // pressable elements (PressCard, IconBtn, ToggleBtn, FilterChip, dock)
  // use the exact same tap-handling pattern.
  const { pressed, handlers } = useReliableTap(() => onNav(it.id));
  return (
    <button
      type="button"
      {...handlers}
      aria-current={on ? "page" : undefined}
      style={{
        flex: 1,
        // Compact dock (option C — "au ras + compact"). The cell
        // is shorter (42px) with tighter padding/gap; still ≥ 40px tall so
        // it stays a comfortable touch target.
        padding: "6px 4px 5px",
        minHeight: 42,
        background: pressed ? `${alpha(accent, "1f")}` : "transparent",
        borderRadius: 10,
        border: "none", cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        color: on ? C.brassHi : C.tx2,
        transition: "color 240ms, background 120ms",
        minWidth: 0,
      }}>
      <div style={{
        transform: pressed ? "scale(0.92)" : on ? "translateY(-1px) scale(1.05)" : "scale(1)",
        transition: "transform 200ms cubic-bezier(.34,1.56,.64,1)",
        filter: on ? `drop-shadow(0 0 6px ${alpha(accent, "55")})` : "none",
      }}>
        <Ico name={it.icon} size={17} sw={on ? 1.8 : 1.5} />
      </div>
      <div style={{
        fontFamily: F.mono, fontSize: fs(9), letterSpacing: 0.5,
        textTransform: "uppercase", fontWeight: on ? 700 : 500,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        maxWidth: "100%",
      }}>{it.label}</div>
    </button>
  );
}
