// On-demand broadcast banner.
//
// The app fetches `public/notice.json` at startup and displays its
// content as an inline Notice on the Home view. Editing the JSON on
// the deployed site (e.g. via a direct GitHub commit) updates the
// message for every user on their next launch — NO build / version
// bump required. The hook only fires once per mount (so the user sees
// the banner at most once per app open) and tracks the displayed id
// in localStorage so a returning user doesn't see the same message
// twice.
//
// Data shape (all fields optional, `id` required to display):
//   {
//     "id": "2026-06-12-maintenance",
//     "tone": "info" | "success" | "warn" | "error",
//     "expiresAt": "2026-06-15T00:00:00Z",
//     "fr": { "title": "...", "body": "..." },
//     "en": { "title": "...", "body": "..." },
//     "es": { … }, "de": { … }, …            // optional per-lang slots
//   }
// One optional slot per LANGUAGES code. A slot may be omitted; the resolver
// falls back requested → en → fr → any present slot, so a broadcast only
// authored in fr/en still shows (in that fallback language) to every other
// reader instead of always French.
//
// Empty file `{}` => no banner. The app gracefully falls back to no
// banner on fetch / parse failure (offline, 404, malformed JSON) so a
// broken notice never breaks the cold-start UX.
//
// Cache busting: the fetch URL appends `?_v=<timestamp>` which the SW
// recognises as a bypass (sw.js fetch handler returns early on
// `?_v=`). Without this, the SW's cache-first behaviour would pin the
// first response for every subsequent launch.

import React from "react";
import type { NoticeTone } from "../components/curator/Notice.tsx";
import { LANGUAGES } from "../i18n/languages.ts";
import { lsSet } from "../utils/appStorage.ts";

var useState = React.useState,
  useEffect = React.useEffect;

export interface NoticeSlot { title?: string; body?: string }
export interface RawNotice {
  id?: string;
  tone?: NoticeTone;
  expiresAt?: string;
  // One optional slot per LANGUAGES code. `pt` was once missing here even
  // though the language shipped: the type refused a Portuguese slot
  // outright, so a broadcast could not be authored in it without a cast.
  // KEEP THIS LIST IN STEP WITH `LANGUAGES`.
  fr?: NoticeSlot;
  en?: NoticeSlot;
  es?: NoticeSlot;
  de?: NoticeSlot;
  it?: NoticeSlot;
  pt?: NoticeSlot;
}

export interface ActiveNotice {
  id: string;
  tone: NoticeTone;
  title: string;
  body: string;
}

export var NOTICE_SEEN_KEY = "cave-notice-seen";

function pickContent(
  raw: RawNotice,
  lang: string,
): { title: string; body: string } | null {
  // Resolve the requested language, then fall back en → fr → any
  // present slot (so a non-French reader no longer always gets the French text;
  // a fr/en-only broadcast still shows in that fallback language).
  //
  // The "any present slot" tail used to be a hardcoded list of the
  // three non-fallback languages that existed when it was written, so it froze
  // the moment a sixth shipped — a notice authored ONLY in Portuguese was
  // invisible to every other reader, while an fr-only one reached everyone.
  // Gate 15 could not see it: the array mixes a variable with codes,
  // and the gate only reads lists that are codes and nothing else.
  // Derived now, so the tail can never fall behind the registry again.
  // Duplicates are harmless — the loop stops at the first slot with content.
  var slots = raw as Record<string, NoticeSlot | undefined>;
  var order = [lang, "en", "fr"].concat(LANGUAGES.map(function (l) { return l.code; }));
  var pick: NoticeSlot | undefined;
  for (var i = 0; i < order.length; i++) {
    var s = slots[order[i]!];
    if (s && (s.title || s.body)) { pick = s; break; }
  }
  if (!pick) return null;
  var title = String(pick.title || "").trim();
  var body = String(pick.body || "").trim();
  if (!title && !body) return null;
  return { title: title, body: body };
}

function isExpired(raw: RawNotice): boolean {
  if (!raw.expiresAt) return false;
  var t = Date.parse(raw.expiresAt);
  if (isNaN(t)) return false;
  return t <= Date.now();
}

function readSeen(): string {
  try {
    return localStorage.getItem(NOTICE_SEEN_KEY) || "";
  } catch (_) {
    return "";
  }
}

function writeSeen(id: string): void {
  try {
    lsSet(NOTICE_SEEN_KEY, id);
  } catch (_) {
    /* swallow — quota / sandboxed contexts */
  }
}

// Exported for tests so the parse pipeline can be exercised without a
// mocked fetch + render harness.
export function parseNoticeForLang(
  raw: any,
  lang: string,
  now: number = Date.now(),
): ActiveNotice | null {
  if (!raw || typeof raw !== "object") return null;
  var id = String((raw as RawNotice).id || "").trim();
  if (!id) return null;
  if (isExpired(raw as RawNotice) && Date.parse((raw as RawNotice).expiresAt || "") <= now) {
    return null;
  }
  var content = pickContent(raw as RawNotice, lang);
  if (!content) return null;
  var t = (raw as RawNotice).tone;
  var tone: NoticeTone =
    t === "success" || t === "warn" || t === "error" ? t : "info";
  return { id: id, tone: tone, title: content.title, body: content.body };
}

export function useStartupNotice(lang: string) {
  var _n = useState<ActiveNotice | null>(null),
    notice = _n[0],
    setNotice = _n[1];

  useEffect(
    function () {
      var cancelled = false;
      var url = "./notice.json?_v=" + Date.now();
      fetch(url, { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("not ok");
          return r.json();
        })
        .then(function (raw: any) {
          if (cancelled) return;
          var parsed = parseNoticeForLang(raw, lang);
          if (!parsed) return;
          if (readSeen() === parsed.id) return;
          setNotice(parsed);
        })
        .catch(function () {
          /* silent — no banner is the correct fallback */
        });
      return function () {
        cancelled = true;
      };
    },
    [lang],
  );

  function dismiss() {
    if (!notice) return;
    writeSeen(notice.id);
    setNotice(null);
  }

  return { notice: notice, dismiss: dismiss };
}
