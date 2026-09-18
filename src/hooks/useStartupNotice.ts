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
import { lsGet, lsSet } from "../utils/appStorage.ts";
import { APP_BUILD } from "../constants.ts";
import { IS_IOS_STANDALONE } from "../utils/platform.ts";

var useState = React.useState,
  useEffect = React.useEffect;

export interface NoticeSlot { title?: string; body?: string }
/** À QUI un avis s'adresse. Absent = tout le monde, le comportement d'avant.
 *
 *  Écrit pour un cas précis et réel : `apple-mobile-web-app-status-bar-style`
 *  est LU AU MOMENT OÙ l'app est ajoutée à l'écran d'accueil, pas au
 *  chargement. MESURÉ sur l'iPad de l'utilisateur — build 20 affiché, Safari
 *  net, app installée trouble, jamais réinstallée. Une installation antérieure
 *  au build 16 garde donc le voile d'iOS jusqu'à ce que l'icône soit retirée
 *  et remise, et AUCUN bump ne peut rien y faire (une mise à jour est un
 *  rechargement, et ce rechargement a déjà eu lieu). Il faut le DIRE à ces
 *  utilisateurs-là, et seulement à eux. */
export interface NoticeAudience {
  /** L'avis ne s'affiche que dans l'app ajoutée à l'écran d'accueil sur iOS. */
  iosStandalone?: boolean;
  /** …et seulement si l'installation EXISTAIT DÉJÀ au premier lancement de ce
   *  build. Une installation neuve reçoit le bon réglage d'emblée : lui
   *  montrer l'avis serait du bruit. */
  existingInstallOnly?: boolean;
  /** …et, quand on le sait, seulement si elle est NÉE AVANT ce build.
   *
   *  `existingInstallOnly` seul ne distingue pas « ancienne » de « lancée deux
   *  fois » — voir `INSTALL_FIRST_BUILD`. Ce champ resserre lorsque la donnée
   *  existe et ne change rien lorsqu'elle manque. */
  installedBefore?: string;
}

export interface RawNotice {
  id?: string;
  tone?: NoticeTone;
  expiresAt?: string;
  audience?: NoticeAudience;
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

/** « Cette installation existait-elle avant ce lancement ? »
 *
 *  ÉVALUÉ À L'IMPORT, et c'est la seule chose qui rende la lecture fiable :
 *  `useAppUpdate` lit `cave-last-build` puis le RÉÉCRIT immédiatement avec
 *  `APP_BUILD`, dans un effet. Les effets React tournent après l'évaluation
 *  des modules, donc une constante de module voit la valeur d'AVANT
 *  l'écrasement, là où un `lsGet` fait depuis un effet verrait déjà la
 *  nouvelle. Ne pas transformer ceci en fonction appelée plus tard.
 *
 *  Absent = première exécution de cette installation (ou données effacées).
 *  Présent = l'installation avait déjà tourné au moins une fois. */
export var INSTALL_PREEXISTED: boolean = (function () {
  try { return lsGet("cave-last-build") != null; } catch { return false; }
})();

/** Le build auquel cette installation a été vue pour la PREMIÈRE fois.
 *
 *  `INSTALL_PREEXISTED` NE SUFFIT PAS, ET UN AUDIT L'A ÉTABLI. Il dit « cette
 *  installation a déjà tourné au moins une fois », pas « elle est antérieure au
 *  correctif » — `useAppUpdate` écrit `cave-last-build` INCONDITIONNELLEMENT au
 *  premier montage. Donc une icône posée aujourd'hui, saine puisqu'elle a lu la
 *  balise corrigée, échappait à l'avis au lancement 1 et le recevait au
 *  lancement 2 : on lui demandait de sauvegarder et de réinstaller pour rien,
 *  jusqu'à l'expiration de l'avis.
 *
 *  Cette clé-ci est écrite UNE SEULE FOIS, à la première exécution, et ne bouge
 *  plus. Elle répond donc à la vraie question.
 *
 *  CE QU'ELLE NE RATTRAPE PAS, dit d'emblée : les installations créées AVANT
 *  son introduction n'ont rien d'enregistré, et aucune donnée du passé ne peut
 *  le leur redonner. Elles retombent sur `INSTALL_PREEXISTED`, c'est-à-dire sur
 *  le comportement d'avant — le filtre ne se resserre que vers l'avant. C'est
 *  la seule forme honnête : mieux vaut un avis de trop sur une fenêtre fermée
 *  qu'un avis manquant à quelqu'un qui en a besoin. */
export var INSTALL_FIRST_BUILD_KEY = "cave-first-build";
export var INSTALL_FIRST_BUILD: string | null = (function () {
  try { return lsGet(INSTALL_FIRST_BUILD_KEY); } catch { return null; }
})();

/** Pose la marque si elle manque ET si l'installation est neuve.
 *
 *  LA CONDITION `!INSTALL_PREEXISTED` EST TOUT L'INTÉRÊT : sans elle, une
 *  installation ancienne se verrait tamponner le build d'AUJOURD'HUI au premier
 *  lancement qui suit la mise à jour, et passerait pour neuve — l'avis
 *  disparaîtrait précisément pour ceux à qui il s'adresse. Une installation qui
 *  a déjà tourné garde donc la clé absente, et son cas reste indécidable, ce
 *  qui est la vérité. */
export function markFirstBuild(build: string): void {
  if (INSTALL_PREEXISTED) return;
  if (INSTALL_FIRST_BUILD != null) return;
  try { lsSet(INSTALL_FIRST_BUILD_KEY, build); INSTALL_FIRST_BUILD = build; } catch { /* rien */ }
}

/** Pure, donc éprouvable sans navigateur : l'avis s'adresse-t-il à cet
 *  environnement ? Un champ absent ne restreint rien. */
export function audienceMatches(
  audience: NoticeAudience | undefined,
  env: { iosStandalone: boolean; installPreexisted: boolean; firstBuild?: string | null },
): boolean {
  if (!audience) return true;
  if (audience.iosStandalone === true && !env.iosStandalone) return false;
  if (audience.existingInstallOnly === true) {
    if (!env.installPreexisted) return false;
    // Une installation qui SAIT être née à ce build ou après n'a pas le défaut
    // que l'avis décrit. `installedBefore` reste facultatif : un avis qui ne le
    // porte pas se comporte comme avant.
    var seuil = audience.installedBefore;
    var ne = env.firstBuild;
    if (seuil != null && ne != null) {
      var n = parseInt(String(ne), 10), s = parseInt(String(seuil), 10);
      // Une valeur illisible ne doit RIEN exclure : dans le doute on montre.
      if (isFinite(n) && isFinite(s) && n >= s) return false;
    }
  }
  return true;
}

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
    return lsGet(NOTICE_SEEN_KEY) || "";
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
      // POSÉE AVANT LE FETCH, et non dans sa réponse : la marque doit exister
      // même quand il n'y a aucun avis à montrer, sans quoi une installation
      // née pendant une période calme resterait indécidable pour le PROCHAIN
      // avis. C'est un no-op sur toute installation qui a déjà tourné.
      markFirstBuild(APP_BUILD);
      var url = "./notice.json?_v=" + Date.now();
      fetch(url, { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("not ok");
          return r.json();
        })
        .then(function (raw: any) {
          if (cancelled) return;
          // Le PUBLIC avant la langue et avant le rejet : un avis qui ne
          // s'adresse pas à cet appareil ne doit ni s'afficher ni consommer
          // son identifiant de rejet.
          if (!audienceMatches(raw && raw.audience, {
            iosStandalone: IS_IOS_STANDALONE,
            installPreexisted: INSTALL_PREEXISTED,
            firstBuild: INSTALL_FIRST_BUILD,
          })) return;
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
