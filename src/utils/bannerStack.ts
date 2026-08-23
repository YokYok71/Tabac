// ONE top banner at a time, decided in one place.
//
// Five overlays are `position: fixed; top: 0; left: 0; right: 0`: the save
// error, the quota warning, the photo error, the "newer cloud backup" offer
// and the export reminder. They occupy the SAME rectangle, so any two visible
// at once are stacked — and mutual exclusion was ad-hoc, each component
// listing the ones it happened to know about:
//
//   exportReminder yielded to saveError + saveWarn ... but not photoErr,
//                  and not cloudNewer;
//   cloudNewer     yielded to all three errors ... but not exportReminder.
//
// So `cloudNewer` and `exportReminder` could render together — and they shared
// z-index 489, which means DOM order decided the winner: the export reminder
// renders last, so it painted OVER the cloud-newer offer. On a wide screen the
// green bar covered the brass one entirely and nothing looked wrong. On a
// phone the cloud-newer bar is TALLER (a date plus a "Restaurer" button, and
// it wraps at 390 px), so its lower edge stuck out below the green one: two
// bars reading as one message, and the green one's ENTIRE surface is a tap
// target that opens Settings → Données, the backup screen.
//
// Reported as exactly that, and with exactly that width dependence: "le popup
// de mise à jour est bien apparu sur mon iPad mais sur l'iPhone le fait de
// cliquer sur le message a simplement lancé la sauvegarde".
//
// The fix is not another pairwise yield — that is what rotted. One ordered
// decision, pure and tested, and every banner asks it.
export type TopBannerId =
  | "saveError"
  | "saveWarn"
  | "photoErr"
  | "cloudNewer"
  | "exportReminder"
  | null;

export interface TopBannerState {
  saveError?: unknown;
  saveWarn?: unknown;
  photoErr?: unknown;
  cloudNewerBackup?: unknown;
  exportReminder?: unknown;
  /** Home renders its own in-flow cloud-newer block, so the fixed one stands down there. */
  isHome?: boolean;
  // A banner must never paint over an open modal.
  //
  // These five sit at z489-492; the shared Modal is z200 and the lightbox z250,
  // so a banner raised while one is open covers its header — including the 44 px
  // close X — and sits OUTSIDE the modal's focus trap. The update pill already
  // checked `importModal` for exactly this reason; the banners were
  // never given the same gate.
  //
  // The reachable case is destructive: with Settings open, "Vérifier les
  // sauvegardes cloud" can raise the cloud-newer banner, whose "Restaurer"
  // button calls stageImport(..., {autoApply:"replace"}) with NO confirmation —
  // and it lands where the user is reaching to close Settings.
  //
  // Standing down loses nothing: the state persists, so the banner appears the
  // moment the modal closes.
  //
  // THE FOUR NAMED STATES BELOW WERE NOT THE WHOLE ANSWER, and listing modals
  // by name is the same mistake as the pairwise yields above. Every OTHER
  // modal in the app was invisible to this gate — the lot form, the
  // maintenance form, the catalogue fiche and its QuickAdd, the comparison,
  // the shopping list, the encryption prompt, the unsaved-changes confirm,
  // the countdown dialog, the welcome and notice pop-ups — so a banner
  // painted straight over it.
  //
  // Reachable by the most ordinary route there is: the export reminder
  // appears on any device 30 days without a backup and MEASURES 110 px at
  // 390 px, while the modal backdrop pads 8 % (≈ 68 px) from the top — the
  // panel's first ~42 px, its title and its close X, are under the banner.
  //
  // `stackModalOpen` is App's mirror of `modalStack.hasOpenModal()`, kept in
  // React state by `subscribeModalStack` (module state does not re-render).
  // It is the SAME registry `goBack` consults, so the two can never disagree
  // about whether a modal is open. The four named ones STAY: `importModal`
  // gates a LAZY chunk, so it is set before the modal has mounted and
  // registered.
  stackModalOpen?: unknown;
  importModal?: unknown;
  searchOpen?: unknown;
  trashOpen?: unknown;
  lightbox?: unknown;
}

export function anyModalOpen(s: TopBannerState | null | undefined): boolean {
  if (!s) return false;
  return !!(s.stackModalOpen || s.importModal || s.searchOpen || s.trashOpen || s.lightbox);
}

// Most urgent first. The first three are failures the user must see; the
// fourth is data on another device they may want NOW; the fifth is a nag.
// A nag never outranks anything.
export const TOP_BANNER_ORDER: Exclude<TopBannerId, null>[] = [
  "saveError", "saveWarn", "photoErr", "cloudNewer", "exportReminder",
];

export function pickTopBanner(s: TopBannerState | null | undefined): TopBannerId {
  if (!s) return null;
  if (anyModalOpen(s)) return null;
  if (s.saveError) return "saveError";
  if (s.saveWarn) return "saveWarn";
  if (s.photoErr) return "photoErr";
  if (s.cloudNewerBackup && !s.isHome) return "cloudNewer";
  if (s.exportReminder) return "exportReminder";
  return null;
}
