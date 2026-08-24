import { fs, C, F } from "../theme-curator";
// Chart palette — uses the Curator C.* tokens. The local short names below
// (amber/bg4/tx2/txt/…) keep the SVG markup compact in the renderers.
const amber = C.amber, bg4 = C.bg3, tx2 = C.tx2, txt = C.tx;
const hi = C.ivory, bg3 = C.bg2, tx3 = C.tx3, green = C.sage, red = C.oxbloodHi;

// `filterHint` — the "tap to filter" tooltip suffix, passed IN by the
// caller. It used to be the hardcoded French `" — clic pour filtrer"` below,
// rendered as-is in all five languages on EVERY clickable chart row.
//
// The same file, 130 lines above the "total actif" string fixed earlier — and
// that ESLint scope fix did NOT catch it: `no-hardcoded-jsx-text` visits
// JSXText nodes only, and this leak is in a `title` ATTRIBUTE built by string
// concatenation. Bringing .jsx into scope closed one half of the class.
// `fmt` — the number formatter, passed IN by the caller, exactly
// like `filterHint` above and `totalLabel` below. The row used to render
// `String(item.value)`, which is wrong twice over: it prints a DOT decimal in
// a comma-decimal UI (the same Stats screen showed `56,6g` in a donut legend
// and `148.89999999999998g` in the bar chart under it, because the legend goes
// through `fmtNum` and this did not), and it prints IEEE-754 accumulation
// noise verbatim. It is OPTIONAL so the many existing callers — all of them
// tests — degrade to the previous rendering instead of printing "undefined".
export function hBars(items, _w, filterHint, fmt) {
  if (!items || !items.length) return null;
  var max = Math.max.apply(null, items.map(function (i) { return i.value; }));
  if (!max) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map(function (item, idx) {
        return (
          <div
            key={idx}
            onClick={item.onClick || undefined}
            // Title attribute = subtle hint "tap to filter"
            // for clickable rows. Native tooltip surfaces on hover.
            title={item.onClick ? (item.label + (item.note ? " " + item.note : "") + (filterHint || "")) : undefined}
            // Hover state: brighten the bar opacity from 0.88 to 1.0
            // via CSS-in-JS on a state-bound class. The cheapest non-
            // intrusive polish on a project that disallows CSS files
            // — uses the pre-existing tx2→hi label color change as
            // the main visual cue; opacity tweak compounds it.
            onMouseEnter={item.onClick ? function (e) {
              var bar = e.currentTarget.querySelector("[data-hbar]");
              if (bar) bar.style.opacity = "1";
            } : undefined}
            onMouseLeave={item.onClick ? function (e) {
              var bar = e.currentTarget.querySelector("[data-hbar]");
              if (bar) bar.style.opacity = "0.88";
            } : undefined}
            style={{ cursor: item.onClick ? "pointer" : "default" }}>
            {/* The label line is a flex row so an optional
                `note` — a SECOND metric the caller wants beside the name, e.g.
                "(1.7h)" of total smoking time next to a pipe whose right-hand
                value is its session COUNT — can never be pushed out. It used to
                be concatenated into `label`, so at 360px in German at the "L"
                text size the row needed 349px of 306 and the ellipsis ate the
                number, not the name. That is the wrong thing to lose: a name is
                still identifiable from its first half, a truncated figure is
                meaningless. Now the name absorbs the squeeze and the note is
                flexShrink:0. Callers that pass no note are unchanged. */}
            <div
              style={{
                fontSize: fs(13.5),
                color: item.onClick ? hi : tx2,
                marginBottom: 2,
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                transition: "color 150ms",
              }}>
              {/* The name WRAPS rather than ellipsizing. Moving the note out
                  alone was only a reallocation: the figure was safe but the
                  name then clipped in one more configuration (measured against
                  a real cellar — "Savinelli — Savinelli Marte Rusticated 320 KS"
                  needs 277px of a 268px box in French at the default size). A
                  bar row can afford a second line; nothing here needs to be
                  lost at all. */}
              <span style={{
                flex: 1, minWidth: 0, overflowWrap: "anywhere",
              }}>{item.label || ""}</span>
              {item.note
                ? <span style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{item.note}</span>
                : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div
                style={{ flex: 1, height: 12, background: bg4, borderRadius: 3, overflow: "hidden" }}>
                <div
                  data-hbar
                  style={{
                    width: Math.round((item.value / max) * 100) + "%",
                    height: "100%",
                    background: item.color || amber,
                    borderRadius: 3,
                    opacity: 0.88,
                    transition: "opacity 150ms",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: fs(13.5),
                  color: txt,
                  flexShrink: 0,
                  minWidth: 40,
                  textAlign: "right",
                }}>
                {(fmt ? fmt(item.value) : String(item.value)) + (item.unit || "")}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function vBars(items, w, hh) {
  if (!items || !items.length) return null;
  var max = Math.max.apply(null, items.map(function (i) { return i.value; }));
  if (!max) return null;
  var n = items.length;
  var bW = Math.max(20, Math.floor((w - (n - 1) * 6) / n));
  var ch = hh || 90;
  var pad = 14;
  return (
    <svg width={w} height={ch + 28 + pad} style={{ display: "block" }}>
      {items.map(function (item, idx) {
        var bh = Math.max(2, Math.round((item.value / max) * ch));
        var x = idx * (bW + 6);
        return (
          <g
            key={idx}
            onClick={item.onClick || undefined}
            style={item.onClick ? { cursor: "pointer" } : undefined}>
            {item.onClick ? (
              <rect
                x={x}
                y={pad}
                width={bW}
                height={ch + 28}
                fill="transparent"
                style={{ pointerEvents: "all" }}
              />
            ) : null}
            <rect
              x={x}
              y={pad + ch - bh}
              width={bW}
              height={bh}
              rx={3}
              opacity="0.88"
              // Fill via style (not the presentation attribute)
              // so a themeable `var(--c-brass, …)` colour resolves — SVG
              // presentation attributes don't evaluate var() on WebKit.
              style={{ fill: item.color || amber }}
            />
            <text
              x={x + bW / 2}
              y={pad + ch + 14}
              textAnchor="middle"
              fontFamily={F.mono}
              style={{ fontSize: fs(11), fill: tx2 }}>
              {item.label}
            </text>
            {item.value > 0 ? (
              <text
                x={x + bW / 2}
                y={pad + ch - bh - 3}
                textAnchor="middle"
                fontFamily={F.mono}
                style={{ fontSize: fs(10), fill: txt }}>
                {item.value}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// `totalLabel` comes from the CALLER. It used to be the literal
// "total actif" in both render paths — a French string shown to every language.
// It went unnoticed because this file matched no ESLint config at all (see the
// `src/**/*.{js,jsx}` block in eslint.config.js), so the no-hardcoded-jsx-text rule that
// exists precisely for this never ran on it.
// `fmt` is the same caller-supplied number formatter `hBars` takes.
// The centre caption printed `total + weightUnit` — a raw JS number
// concatenation, so a dot decimal and every noise digit. Rounding the SERIES
// this donut is fed does not cover it: `total` re-SUMS those values, and
// `0.1 + 0.2` is `0.30000000000000004` however clean the inputs are.
export function donutChart(items, size, weightUnit, totalLabel, fmt) {
  if (!items || !items.length) return null;
  var total = items.reduce(function (s, i) { return s + i.value; }, 0);
  if (!total) return null;
  // TWO render paths print this caption (single slice / multi slice) and both
  // must use it — the hardcoded "total actif" this file already had to fix
  // was likewise in both, and a fix applied to one of them is the failure
  // shape that produced it.
  var totalTxt = (fmt ? fmt(total) : String(total)) + weightUnit;
  var cx = size / 2, cy = size / 2, r = size * 0.4, ri = size * 0.23;
  if (items.length === 1)
    return (
      <svg width={size} height={size} style={{ display: "block" }}>
        <circle cx={cx} cy={cy} r={r} opacity="0.88" style={{ fill: items[0].color || amber }} />
        <circle cx={cx} cy={cy} r={ri} style={{ fill: bg3 }} />
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontWeight="bold"
          fontFamily={F.mono}
          style={{ fontSize: fs(16), fill: hi }}>
          {totalTxt}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontFamily={F.mono}
          style={{ fontSize: fs(10), fill: tx3 }}>
          {totalLabel}
        </text>
      </svg>
    );
  var angle = -Math.PI / 2;
  var paths = items.map(function (item, idx) {
    var sweep = (item.value / total) * Math.PI * 2;
    var ea = angle + sweep;
    var lf = sweep > Math.PI ? 1 : 0;
    var d =
      "M " + (cx + r * Math.cos(angle)) + " " + (cy + r * Math.sin(angle)) +
      " A " + r + " " + r + " 0 " + lf + " 1 " + (cx + r * Math.cos(ea)) + " " + (cy + r * Math.sin(ea)) +
      " L " + (cx + ri * Math.cos(ea)) + " " + (cy + ri * Math.sin(ea)) +
      " A " + ri + " " + ri + " 0 " + lf + " 0 " + (cx + ri * Math.cos(angle)) + " " + (cy + ri * Math.sin(angle)) + " Z";
    angle = ea;
    return (
      <path
        key={idx}
        d={d}
        opacity="0.9"
        onClick={item.onClick || undefined}
        style={{ fill: item.color, cursor: item.onClick ? "pointer" : undefined }}
      />
    );
  });
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      {paths}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontWeight="bold"
        fontFamily={F.mono}
        // `style`, not a `fill=` presentation attribute — `hi` is a
        // themed var() and WebKit does not evaluate var() in a presentation
        // attribute (see the same note on Ico). The sibling render
        // path above was already correct; this one had been missed.
        style={{ fontSize: fs(16), fill: hi }}>
        {totalTxt}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        fontFamily={F.mono}
        style={{ fontSize: fs(10), fill: tx3 }}>
        {totalLabel}
      </text>
    </svg>
  );
}

// GitHub-style activity heatmap: 53 weeks (cols) × 7 days (rows). `byDay` is
// a record { "YYYY-MM-DD": number } of session counts. `today` is the latest
// day rendered (defaults to today). Color scaled in 5 amber steps.
export function calendarHeatmap(byDay, today, monthLabels, onCellClick, palette) {
  // Render a full 12 months at a comfortable cell size. The host
  // wraps the SVG in overflowX:auto and pins scrollLeft to the right
  // edge, so by default the user sees the most recent 6 months — same
  // information density as before — but can swipe left to browse the
  // earlier 6 months.
  // Cells 14 -> 24 px. They are real click targets (onCellClick
  // → the journal filtered on that day), so 14x14 with a 2px gap was under the
  // 24px floor of WCAG 2.5.8 (AA) with no spacing exception available. At 24 the
  // target meets the minimum outright — no exception argument needed.
  //
  // Only the HEIGHT costs anything here: the host wraps this SVG in
  // overflowX:auto and pins scrollLeft to the right edge, so the extra width is
  // absorbed by the existing horizontal scroll. The trade that IS real, measured
  // from screenshots rather than estimated: at 360px about 12 weeks are visible
  // at rest instead of ~19, so the default view shows ~2 months rather than ~4
  // (my own estimate of "~3 vs ~4.5" was optimistic). The rest is one swipe away.
  // VERIFIED on the installed iOS PWA — that reduced at-rest span is
  // the obvious thing to question later, and it was accepted on the device, not
  // just in a headless screenshot. Card height 221 -> 291px.
  //
  // The home screen's own calendar is deliberately NOT changed: it is a separate
  // inline grid at the top of the page where the same enlargement costs +73px of
  // masthead, and it was measured, photographed and kept under 2.5.8's
  // "essential" exception (see HomeViewV2). Stats is a long scrolling page, so
  // the height is cheap there and the exception is not needed.
  var cell = 24;
  var gap = 2;
  var cols = 53;
  var rows = 7;
  var width = cols * (cell + gap) + 24; // + day-label gutter
  var height = rows * (cell + gap) + 18; // + month-label gutter
  var endDate = today ? new Date(today) : new Date();
  endDate.setHours(0, 0, 0, 0);
  // FR / ISO week — Monday is row 0, Sunday is row 6. Anchor on the most
  // recent SUNDAY (today if today is Sunday) so the bottom-right cell of
  // the grid is "today" or the upcoming Sunday.
  var endDay = endDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  var daysToSun = (7 - endDay) % 7; // Sun→0, Mon→6, Sat→1
  var anchor = new Date(endDate);
  anchor.setDate(anchor.getDate() + daysToSun);
  // Walk back cols*rows days
  var totalDays = cols * rows;
  var startDate = new Date(anchor);
  startDate.setDate(startDate.getDate() - (totalDays - 1));
  // Each cell built via this factory so iso/count are captured by VALUE
  // in the onClick closure. Without it, every cell's handler would point
  // at the var declared in the loop and end up firing with the values
  // from the final iteration (classic var-scoped closure bug).
  function makeCell(c, r, iso, count, cell, gap, colorFor, onCellClick) {
    return (
      <rect
        key={c + "-" + r}
        x={24 + c * (cell + gap)}
        y={18 + r * (cell + gap)}
        width={cell}
        height={cell}
        rx={2}
        ry={2}
        style={{ fill: colorFor(count), ...(onCellClick ? { cursor: "pointer" } : {}) }}
        onClick={
          onCellClick
            ? function () { onCellClick(iso, count); }
            : undefined
        }>
        <title>{iso + " · " + count}</title>
      </rect>
    );
  }
  // Absolute thresholds for daily session count. Caller may override colors
  // via `palette = { empty, low, mid, high }` (used by the Curator theme).
  //  0   → empty
  //  1   → low   (healthy single pipe)
  //  2-3 → mid   (more than usual but OK)
  //  4+  → high  (warning, lots of pipes in one day)
  var pal = palette || { empty: bg4, low: green, mid: amber, high: red };
  function colorFor(n) {
    if (!n) return pal.empty;
    if (n === 1) return pal.low;
    if (n <= 3) return pal.mid;
    return pal.high;
  }
  // Use LOCAL date components — `toISOString()` returns UTC which would
  // shift the lookup key by one day in any non-UTC timezone and cause the
  // heatmap to render empty (no key matches `byDay`, which is keyed on
  // local YYYY-MM-DD as written by session.date / today()).
  function localIso(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  var cells = [];
  var lastMonth = -1;
  var monthTicks = [];
  for (var c = 0; c < cols; c++) {
    for (var r = 0; r < rows; r++) {
      var idx = c * rows + r;
      var d = new Date(startDate);
      d.setDate(d.getDate() + idx);
      if (d > anchor) continue;
      var iso = localIso(d);
      var count = (byDay && byDay[iso]) || 0;
      if (r === 0) {
        var m = d.getMonth();
        if (m !== lastMonth) {
          lastMonth = m;
          monthTicks.push({ x: 24 + c * (cell + gap), m: m });
        }
      }
      cells.push(makeCell(c, r, iso, count, cell, gap, colorFor, onCellClick));
    }
  }
  // Day labels: Mon=row 0, Wed=row 2, Fri=row 4 (Monday-first layout).
  var dayLabels = [];
  [0, 2, 4].forEach(function (r) {
    dayLabels.push(
      <text
        key={"dl-" + r}
        x={0}
        y={18 + r * (cell + gap) + cell - 2}
        fontFamily={F.mono}
        style={{ fontSize: fs(9), fill: tx3 }}>
        {(monthLabels && monthLabels.days && monthLabels.days[r]) || ["M", "", "W", "", "F", "", ""][r]}
      </text>,
    );
  });
  // Month labels
  var months = (monthLabels && monthLabels.months) || [
    "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
  ];
  var monthEls = monthTicks.map(function (t, i) {
    return (
      <text
        key={"m-" + i}
        x={t.x}
        y={12}
        fontFamily={F.mono}
        style={{ fontSize: fs(9), fill: tx3 }}>
        {months[t.m]}
      </text>
    );
  });
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {monthEls}
      {dayLabels}
      {cells}
    </svg>
  );
}
