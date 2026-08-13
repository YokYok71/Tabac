import React from "react";
// Stroke-only SVG icon set for the Curator UI.
// All paths are kept inside `<g>`/`<path>` so they can be slotted into a
// shared <svg> wrapper that controls size + colour.

import { C } from "../../theme-curator.ts";

export type IcoName =
  | "home" | "leaf" | "pipe" | "book" | "chart" | "search" | "back"
  | "plus" | "settings" | "flame" | "play" | "pause" | "edit" | "trash"
  | "box" | "chevron" | "heart" | "clock" | "filter"
  | "sliders" | "more" | "diamond" | "close" | "check"
  | "cloud" | "camera" | "contrast" | "stop" | "cart" | "copy" | "restore";

const PATHS: Record<IcoName, React.ReactNode> = {
  home:    <path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />,
  leaf:    <path d="M20 4c0 8-6 14-14 14 0-8 6-14 14-14zM6 18l8-8" />,
  // Redrawn — the previous SVG was a mug with a handle on
  // the right (the right-side arc was the handle, the three vertical
  // bars on top looked like a coffee-bean indicator). Now a side-view
  // pipe silhouette: rounded chamber on the left (open at the top to
  // suggest the tobacco rim), stem extending right with a slight bend
  // down to the mouthpiece. Stroke-only line-art to match the rest of
  // the icon set (home / leaf / book / box / heart …).
  pipe:    <g>
    <path d="M5 6h4a2 2 0 0 1 2 2v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a2 2 0 0 1 2-2z"/>
    <path d="M11 13h7a3 3 0 0 1 3 3"/>
  </g>,
  book:    <g>
    <path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/>
    <path d="M4 17a3 3 0 0 1 3-3h12"/>
    <path d="M8 9h7M8 13h5"/>
  </g>,
  chart:   <path d="M4 20V8M10 20V4M16 20v-9M22 20H2" />,
  search:  <g><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/></g>,
  back:    <path d="M15 6l-6 6 6 6" />,
  plus:    <path d="M12 5v14M5 12h14" />,
  // "Dupliquer" — two overlapping rounded rectangles (Lucide "copy").
  copy:    <g>
    <rect x="9" y="9" width="12" height="12" rx="2"/>
    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>
  </g>,
  close:   <path d="M6 6l12 12M18 6L6 18" />,
  check:   <path d="M5 12l5 5 9-10" />,
  // "Liste de courses". Was a bag body + handle arc,
  // whose lidded-container silhouette read too much like the trash icon
  // (same amber tint made it worse). Now a proper wheeled shopping cart
  // (Lucide "shopping-cart" family) — basket + handle + two wheels — which
  // is unmistakably a cart, paired with a sage tint to separate it from the
  // amber trash indicator that often sits beside it in the same TopBar.
  cart:    <g>
    <circle cx="9" cy="20" r="1.3"/>
    <circle cx="18" cy="20" r="1.3"/>
    <path d="M2 3h2.2l2.3 11.3a1.8 1.8 0 0 0 1.8 1.45h8.9a1.8 1.8 0 0 0 1.77-1.42L20.5 7H5.2"/>
  </g>,
  // Was a "sun rays" shape (central circle + 8 short straight
  // lines radiating outward) which read more like a sun than a gear.
  // Now a proper gear: 8 rounded teeth around a circular body + central
  // hole, in the same Lucide-style line-art family as the other icons.
  settings:<g>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  </g>,
  flame:   <path d="M12 3s-4 4-4 8a4 4 0 0 0 8 0c0-2-1.5-3-1.5-5 0 1.5-2.5 2-2.5-3zM8 16a4 4 0 0 0 8 0" />,
  play:    <path d="M6 4v16l13-8z" fill="currentColor" />,
  pause:   <g>
    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>
    <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>
  </g>,
  edit:    <g>
    <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>
    <path d="m18.5 2.5 3 3-10 10H8.5v-3z"/>
  </g>,
  trash:   <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  // "Restaurer" — a counter-clockwise arrow (Lucide
  // "rotate-ccw"). The trash row's restore button had to stop being a TEXT
  // button: it carried flexShrink:0, so "Wiederherstellen" (169 px) starved the
  // label column beside it down to 21 px at the L text size — you could not read
  // what you were about to permanently delete. An icon is width-identical in
  // every language. It sits next to the existing icon-only ×, so the pair reads
  // as restore / delete-forever.
  restore: <g>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.9-6.4"/>
    <path d="M3.5 4.5v4.2h4.2"/>
  </g>,
  box:     <g>
    <path d="M3 7l9-4 9 4v10l-9 4-9-4z"/>
    <path d="M3 7l9 4 9-4M12 11v10"/>
  </g>,
  chevron: <path d="m9 6 6 6-6 6" />,
  // The folded-filters disclosure, on all three list views. A
  // funnel rather than a hash: on the tobacco list the fold also
  // holds the type / cut / rating dropdowns, so "#" would have promised tags
  // only — and one icon across the three lists is the whole point.
  filter:  <path d="M3 5h18l-7 8v6l-4-2v-4z" />,
  heart:   <path d="M12 21s-7-4.5-9.5-9C.5 7 4 3 7.5 3 10 3 12 5 12 5s2-2 4.5-2C20 3 23.5 7 21.5 12 19 16.5 12 21 12 21z" />,
  clock:   <g><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></g>,
  cloud:   <path d="M7 18a4 4 0 0 1-1-7.9A6 6 0 0 1 18 9a4 4 0 0 1 0 9z" />,
  // Camera — label-scan button in AICard.
  camera:  <g>
    <path d="M3 8a2 2 0 0 1 2-2h2.2l1.4-2.1A2 2 0 0 1 10.3 3h3.4a2 2 0 0 1 1.7.9L16.8 6H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <circle cx="12" cy="13" r="3.5"/>
  </g>,
  sliders: <g>
    <path d="M4 6h12M20 6h0M4 12h6M14 12h6M4 18h12M20 18h0"/>
    <circle cx="18" cy="6" r="2"/>
    <circle cx="12" cy="12" r="2"/>
    <circle cx="18" cy="18" r="2"/>
  </g>,
  more:    <g>
    <circle cx="5" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="19" cy="12" r="1.5" fill="currentColor"/>
  </g>,
  diamond: <path d="M12 2 22 12 12 22 2 12z" fill="currentColor" />,
  // Light/dark theme-mode glyph — circle outline with the
  // left half filled (the classic "contrast" mark).
  contrast:<g>
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/>
  </g>,
  // "stop" — filled rounded square. Ends a live tasting, sits
  // next to the pause button in TastingView.
  stop:    <rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" stroke="none"/>,
};

export interface IcoProps {
  name: IcoName;
  size?: number | undefined;
  sw?: number | undefined;
  /** Narrowed from `string`. This lands on the `<svg>` as a
   *  PRESENTATION ATTRIBUTE, and WebKit does not evaluate `var()` there — the
   *  same trap that made `color` route through `style` instead (see
   *  the comment on the element below). A themed token passed here would fill
   *  correctly in Chromium and silently not at all in Safari, i.e. invisible to
   *  every headless check this repo has. Only these two values are ever used,
   *  so the type now makes the mistake unrepresentable rather than documented.
   *  If a themed fill is ever genuinely needed, route it through `style`. */
  fill?: "none" | "currentColor" | undefined;
  style?: React.CSSProperties | undefined;
  color?: string | undefined;
}

export function Ico({ name, size = 20, sw = 1.6, fill = "none", color, style }: IcoProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round"
      // Route the `color` prop through the CSS `color` property
      // (via style) so a themeable var() colour resolves — `stroke="currentColor"`
      // then picks it up. SVG's `stroke` presentation attribute doesn't
      // evaluate var() on WebKit; the CSS `color` property does.
      style={{ ...(color ? { color } : {}), ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}

// Small decorative diamond used in titles / dividers.
export function Orn({ color = C.brass, size = 8 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10">
      <path d="M5 0 10 5 5 10 0 5z" opacity={0.85} style={{ fill: color }} />
    </svg>
  );
}

function Rule({ color = C.rule, length = 24 }: { color?: string; length?: number }) {
  return <span style={{ display: "inline-block", width: length, height: 1, background: color }} />;
}

export function OrnRule({ color = C.rule, ornColor = C.brass }: { color?: string; ornColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "6px 0" }}>
      <Rule color={color} length={40} />
      <Orn color={ornColor} />
      <Rule color={color} length={40} />
    </div>
  );
}
