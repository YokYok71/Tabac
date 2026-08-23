import React from "react";
import type { AppData, Tobacco, Pipe, Accessory, Session } from "./types.ts";

// AppCtxType is an explicit key list instead of
// `Record<string, any>`. Every key is OPTIONAL and typed `any` — value
// access stays loose (no churn) and tests can provide a PARTIAL ctx via
// renderWithCtx, while a TYPO in a ctx key is now a compile-time error
// (accessing a name not in this list no longer silently yields `undefined`
// — the documented "button does nothing" bug class in CLAUDE.md). The keys
// mirror the `appCtx` object built in App.tsx: when you add a key there, add
// it here too (typecheck flags the access site otherwise). Generating this
// list already surfaced two latent bugs — pendingSync and dlFile were read
// by views but never exposed on appCtx.
// AppCtx typing. Every callable (functions
// + setters) and every primitive/entity value is now typed; `data`/`dataRaw`
// are `AppData`. The keys still `?: any` below are a DELIBERATE tail, not an
// oversight: working-copy form objects (`form`/`pipeForm`/`sessForm`/…, which
// carry transient non-entity fields), refs (`scrollSaveRef`/`modalOpenTs`),
// the blank-record templates (`BT`/`BL`/…), and polymorphic dialog/state
// unions (`tasting`/`stats`/`chartData`/`updateStatus`/`*Confirm`/…). Typing
// them precisely would surface false-positive shape errors for negligible
// safety gain. Leave them `any` unless a concrete need arises.
export interface AppCtxType {
  pendingSync?: boolean;
  dlFile: (...args: any[]) => any;
  // AppCtx typing, tranche 1. These three are typed for
  // real AND made REQUIRED (not `?:`): every ctx key is always populated by
  // the single `appCtx` literal in App.tsx, so `required` is honest and it
  // removes the "possibly-undefined invocation" tax at every `t()`/`nav()`/
  // `xl()` call site. The createContext default + renderWithCtx supply stubs.
  t: (key: string) => string;
  xl: (value: any, map: readonly string[] | Record<string, string>) => string;
  view: string;
  loading?: boolean;
  save: (...args: any[]) => any;
  form?: any;
  setForm: (...args: any[]) => void;
  // AppCtx typing, tranche 2 (display prefs, required).
  // Always populated by App.tsx; typing them `string` (not a strict union)
  // removes the `any`/`undefined` without forcing the App.tsx state unions.
  lang: string;
  handlePhotoUpload: (...args: any[]) => any;
  photoErr?: string | null;
  setPhotoErr: (...args: any[]) => void;
  imgLocal?: Record<string, string>;
  setImgLocal: (...args: any[]) => void;
  imgFail?: any;
  setImgFail: (...args: any[]) => void;
  addTobacco: (override?: any) => void;
  updateTobacco: () => void;
  updateTobaccoTastingNotes: (tobId: any, notes: string) => void;
  nav: (view: string, opts?: { restoreScroll?: boolean }) => void;
  // Doc-page (help/changelog/privacy/licenses) Settings-aware back.
  openDocFromSettings: (page: string) => void;
  closeDocPage: () => void;
  // The read-only session-detail modal (JournalView), lifted here.
  sessionDetail?: any;
  setSessionDetail: (...args: any[]) => void;
  // Unsaved-changes guard for edit forms.
  setFormGuard: (g: any) => void;
  unsavedConfirm?: any;
  setUnsavedConfirm: (...args: any[]) => void;
  pipeForm?: any;
  setPipeForm: (...args: any[]) => void;
  addPipe: () => void;
  updatePipe: () => void;
  weightUnit: string;
  lengthUnit: string;
  fontScale: string;
  saveFontScale: (...args: any[]) => any;
  themeId: string;
  saveThemeId: (...args: any[]) => any;
  themeMode: string;
  saveThemeMode: (...args: any[]) => any;
  currencySymbol: string;
  saveCurrencySymbol: (...args: any[]) => any;
  maintReminderThreshold: number;
  saveMaintReminderThreshold: (...args: any[]) => any;
  maintRemindersEnabled?: boolean;
  saveMaintRemindersEnabled: (...args: any[]) => any;
  accountingEnabled?: boolean;
  saveAccountingEnabled: (...args: any[]) => any;
  dateFormat: string;
  filteredSessions?: Session[];
  sessGrouped?: boolean;
  setSessGrouped: (...args: any[]) => void;
  collapsedSessGroups?: Record<string, boolean>;
  setCollapsedSessGroups: (...args: any[]) => void;
  toggleSessGroup: (key: any) => void;
  sessDefaultWeight: string;
  setSessDefaultWeight: (...args: any[]) => void;
  watchLowWeight: string;
  saveWatchLowWeight: (...args: any[]) => any;
  setSessForm: (...args: any[]) => void;
  sessForm?: any;
  // AppCtx typing, tranche 3. `data` = liveData (raw minus
  // soft-deleted rows), `AppData | null`; views read it via `data?.…`.
  // `dataRaw` = the untouched state (never null). Kept OPTIONAL so the
  // createContext seed needs no data stub and partial test ctx still works.
  data?: AppData | null;
  dataRaw?: AppData;
  restoreFromTrash: (...args: any[]) => any;
  restoreAllFromTrash: (...args: any[]) => any;
  restoreSelectionFromTrash: (...args: any[]) => any;
  permanentlyDelete: (...args: any[]) => any;
  emptyTrash: (...args: any[]) => any;
  pickJarLot: (...args: any[]) => any;
  pipeIsActive: (...args: any[]) => any;
  addSession: () => void;
  updateSession: () => void;
  tasting?: any;
  tastingStart: (...args: any[]) => any;
  tastingResume: (...args: any[]) => any;
  tastingSetupUpdate: (...args: any[]) => any;
  tastingIgnite: (...args: any[]) => any;
  tastingPause: (...args: any[]) => any;
  tastingUnpause: (...args: any[]) => any;
  tastingUpdate: (...args: any[]) => any;
  tastingEnd: (...args: any[]) => any;
  tastingCancel: (...args: any[]) => any;
  tastingElapsedMs: (...args: any[]) => any;
  tastingOvertimePrompt: (...args: any[]) => any;
  tastingOvertimeRemainingMs: (...args: any[]) => any;
  tastingPostponeOvertime: (...args: any[]) => any;
  tastingSetLocation: (...args: any[]) => any;
  chartData?: any;
  navToInvFiltered: (...args: any[]) => any;
  navToInvByAroma: (...args: any[]) => any;
  navToInvByRating: (...args: any[]) => any;
  navToInvByTag: (...args: any[]) => any;
  navToPipesByTag: (...args: any[]) => any;
  navToAccByTag: (...args: any[]) => any;
  navToPipesFiltered: (...args: any[]) => any;
  navToPipesFilteredByMaterial: (...args: any[]) => any;
  navToJournalFiltered: (...args: any[]) => any;
  navToJournalFilteredByDate: (...args: any[]) => any;
  setRatingFilter: (...args: any[]) => void;
  setCatFilter: (...args: any[]) => void;
  setCutFilter: (...args: any[]) => void;
  setTagFilter: (...args: any[]) => void;
  setPTagFilter: (...args: any[]) => void;
  setATagFilter: (...args: any[]) => void;
  setBrandFilter: (...args: any[]) => void;
  setSearch: (...args: any[]) => void;
  setStatusFilter: (...args: any[]) => void;
  tobGrouped?: boolean;
  pipesGrouped?: boolean;
  setCollapsedTobGroups: (...args: any[]) => void;
  setCollapsedPipeGroups: (...args: any[]) => void;
  scrollToTopRef?: any;
  scrollSaveRef?: any;
  setDetail: (...args: any[]) => void;
  setPipeDet: (...args: any[]) => void;
  crossOpenDetail: (...args: any[]) => void;
  crossOpenSession: (...args: any[]) => void;
  BT?: any;
  BL?: any;
  BP?: any;
  BA?: any;
  BJ?: any;
  BW?: any;
  aiAutoFill: (...args: any[]) => any;
  aiScanLabel: (...args: any[]) => any;
  aiLoad?: boolean;
  aiErr?: string | null;
  aiSource?: string;
  setAiSource: (...args: any[]) => void;
  aiCompare?: any;
  aiCompareCheck: (...args: any[]) => any;
  applyAiCompare: (...args: any[]) => any;
  dismissAiCompare: (...args: any[]) => any;
  autofillSource: string;
  saveAutofillSource: (...args: any[]) => any;
  deleteSession: (id: any) => void;
  setEditSessId: (...args: any[]) => void;
  delWish: (id: any) => void;
  wishToInv: (w: any) => void;
  lotAgingStatus: (...args: any[]) => any;
  pBrandFilter: string;
  resetAll: (...args: any[]) => any;
  tkClear: (...args: any[]) => any;
  tkGet: (...args: any[]) => any;
  gdriveLoadOptionPayload: (...args: any[]) => any;
  detail?: Tobacco | null;
  catFilter: string;
  cutFilter: string;
  tagFilter: string;
  pTagFilter: string;
  aTagFilter: string;
  brandFilter: string;
  ratingFilter: number;
  aromaFilter: string[];
  setAromaFilter: (...args: any[]) => void;
  statusFilter: string;
  search: string;
  sortBy: string;
  setSortBy: (...args: any[]) => void;
  filtered?: Tobacco[];
  setTobGrouped: (...args: any[]) => void;
  collapsedTobGroups?: Record<string, boolean>;
  toggleTobGroup: (key: any) => void;
  expandCards?: boolean;
  setExpandCards: (...args: any[]) => void;
  expandSessCards?: boolean;
  setExpandSessCards: (...args: any[]) => void;
  setLightbox: (...args: any[]) => void;
  setEditId: (...args: any[]) => void;
  ageLabel: (...args: any[]) => any;
  showFinished?: boolean;
  setShowFinished: (...args: any[]) => void;
  addLotMode?: boolean;
  editLotIdx?: any;
  setAddLotMode: (...args: any[]) => void;
  setEditLotIdx: (...args: any[]) => void;
  setLotForm: (...args: any[]) => void;
  lotForm?: any;
  updateLotInTobacco: (tobId: any, lotId: any, lotOverride?: any) => void;
  addLotToTobacco: (tobId: any, lotOverride?: any, count?: any) => void;
  deleteTobacco: (id: any) => void;
  pipeDet?: Pipe | null;
  filteredPipes?: Pipe[];
  pShapeFilter: string;
  setPShapeFilter: (...args: any[]) => void;
  pFilterFilter: string;
  setPFilterFilter: (...args: any[]) => void;
  pRatingFilter: number;
  setPRatingFilter: (...args: any[]) => void;
  pBowlMaterialFilter?: string;
  setPBowlMaterialFilter: (...args: any[]) => void;
  pStemMaterialFilter?: string;
  setPStemMaterialFilter: (...args: any[]) => void;
  journalFilterPipe: string;
  setJournalFilterPipe: (...args: any[]) => void;
  journalFilterTobacco: string;
  setJournalFilterTobacco: (...args: any[]) => void;
  journalFilterYear: string;
  setJournalFilterYear: (...args: any[]) => void;
  journalFilterDate: string;
  setJournalFilterDate: (...args: any[]) => void;
  journalFilterCommune: string;
  setJournalFilterCommune: (...args: any[]) => void;
  journalFilterCountry: string;
  setJournalFilterCountry: (...args: any[]) => void;
  navToJournalFilteredByLocation: (...args: any[]) => any;
  showFinishedPipes?: boolean;
  setShowFinishedPipes: (...args: any[]) => void;
  collapsedPipeGroups?: Record<string, boolean>;
  setPipesGrouped: (...args: any[]) => void;
  togglePipeGroup: (key: any) => void;
  setEditPipeId: (...args: any[]) => void;
  setView: (...args: any[]) => void;
  deletePipe: (id: any) => void;
  changePipeStatus: (id: any, ns: any) => void;
  addMaintenance: (pipeId: any, entry: any) => void;
  updateMaintenance: (pipeId: any, entryId: any, entry: any) => void;
  removeMaintenance: (pipeId: any, entryId: any) => void;
  wishGrouped?: boolean;
  setWishGrouped: (...args: any[]) => void;
  searchOpen?: boolean;
  setSearchOpen: (...args: any[]) => void;
  catalogSeed?: string | null;
  setCatalogSeed: (...args: any[]) => void;
  // The wishlist item a global-search hit asked to be taken to.
  // Consumed once by InventoryListView, which reveals that card.
  wishFocusId?: any;
  setWishFocusId: (...args: any[]) => void;
  trashOpen?: boolean;
  setTrashOpen: (...args: any[]) => void;
  shoppingOpen?: boolean;
  setShoppingOpen: (...args: any[]) => void;
  settingsTab: string;
  setSettingsTab: (...args: any[]) => void;
  collapsedHelpSections?: Record<string, boolean>;
  toggleHelpSection: (...args: any[]) => any;
  setAllHelpSectionsCollapsed: (...args: any[]) => void;
  collapsedWishGroups?: Record<string, boolean>;
  setCollapsedWishGroups: (...args: any[]) => void;
  wishForm?: any;
  setWishForm: (...args: any[]) => void;
  editWishId?: any;
  setEditWishId: (...args: any[]) => void;
  editSessId?: any;
  showWishForm?: boolean;
  setShowWishForm: (...args: any[]) => void;
  addWish: (override?: any) => void;
  updateWish: () => void;
  toggleWishGroup: (key: any) => void;
  accDet?: Accessory | null;
  accsGrouped?: boolean;
  setAccsGrouped: (...args: any[]) => void;
  collapsedAccGroups?: Record<string, boolean>;
  setCollapsedAccGroups: (...args: any[]) => void;
  showRetiredAcc?: boolean;
  setShowRetiredAcc: (...args: any[]) => void;
  aBrandFilter: string;
  setABrandFilter: (...args: any[]) => void;
  aTypeFilter: string;
  setATypeFilter: (...args: any[]) => void;
  toggleAccGroup: (key: any) => void;
  accIsActive: (...args: any[]) => any;
  setAccDet: (...args: any[]) => void;
  setAccForm: (...args: any[]) => void;
  setEditAccId: (...args: any[]) => void;
  deleteAccessory: (id: any) => void;
  changeAccStatus: (id: any, ns: any) => void;
  accForm?: any;
  addAccessory: () => void;
  updateAccessory: () => void;
  stats?: any;
  visibleSections?: Record<string, boolean>;
  setVisibleSections: (...args: any[]) => void;
  setPBrandFilter: (...args: any[]) => void;
  importModal?: boolean;
  setImportModal: (...args: any[]) => void;
  importRecap?: { msg: string; view?: string; tobId?: number } | null;
  setImportRecap: (...args: any[]) => void;
  deviceName?: string;
  saveDeviceName: (...args: any[]) => void;
  modalOpenTs?: any;
  gdriveStatus?: string | null;
  setGdriveStatus: (...args: any[]) => void;
  gdriveConfirm?: any;
  setGdriveConfirm: (...args: any[]) => void;
  doGdriveConfirm: (...args: any[]) => any;
  gdriveSave: (...args: any[]) => any;
  gdriveRestore: (...args: any[]) => any;
  autoSaveDrive?: boolean;
  setAutoSaveDrive: (...args: any[]) => void;
  lastAutoSaveTs?: number | null;
  gdriveDeleteBackupById: (...args: any[]) => any;
  gdriveReconnect: (...args: any[]) => any;
  triggerIosAutosaveReauth: (...args: any[]) => any;
  cloudProviderId: string;
  saveCloudProviderId: (...args: any[]) => any;
  dropboxDisconnect: (...args: any[]) => any;
  cloudNewerBackup?: any;
  dismissCloudNewerBackup: (...args: any[]) => any;
  restoreCloudNewerBackup: (...args: any[]) => any;
  cloudRestoreBusy?: boolean;
  checkCloudNewerNow: (...args: any[]) => any;
  runSyncDiagnostic: (...args: any[]) => any;
  dismissSyncDiag: (...args: any[]) => any;
  syncDiag?: any;
  syncDiagBusy?: boolean;
  syncDiagErr?: string | null;
  syncDiagSource?: "check" | "diag";
  IS_IOS_STANDALONE?: any;
  IS_IOS?: any;
  backupStatus?: string | null;
  doExport: (...args: any[]) => any;
  doExportCSV: (...args: any[]) => any;
  doBackupZip: (...args: any[]) => any;
  doCollectionReport: (...args: any[]) => any;
  doDownloadCsvTemplate: (...args: any[]) => any;
  doImportCsvFile: (...args: any[]) => any;
  // The user's own reference catalogue (useUserCatalogue).
  // `catalogueMeta` is `undefined` while the first IndexedDB read is in
  // flight and `null` when nothing is loaded: the UI must tell those apart,
  // or a fresh open flashes "no catalogue" before showing the one there is.
  catalogueMeta?: any;
  catalogueBusy: boolean;
  catalogueOutcome?: any;
  loadCatalogueFile: (...args: any[]) => any;
  clearCatalogue: (...args: any[]) => any;
  downloadCatalogueTemplate: (...args: any[]) => any;
  exportCatalogueCsv: (...args: any[]) => any;
  refreshCatalogueMeta: (...args: any[]) => any;
  /** The catalogue's own cloud stream, separate from the
   *  cellar backups (see `makeCatalogueName`). Both resolve a boolean so a
   *  caller can chain on success; both report to `gdriveStatus` themselves. */
  catalogueCloudSave: (...args: any[]) => any;
  catalogueCloudRestore: (...args: any[]) => any;
  /** Status of the last catalogue cloud action, rendered
   *  UNDER the two buttons that produce it — never on the shared `gdriveStatus`,
   *  whose Notice lives in another Section (see the hook). */
  catalogueCloudStatus: string | null;
  /** The narrow catalogue audit — mandatory fields and the two
   *  imposed-taxonomy columns, nothing about prose. See useUserCatalogue. */
  catalogueAudit: any;
  catalogueAuditBusy: boolean;
  auditCatalogue: (...args: any[]) => any;
  clearCatalogueAudit: (...args: any[]) => any;
  /** The same shape for the CELLAR csv import — rows dropped
   *  for want of an identity, and values snapped to "Autre". Null when the
   *  last import had nothing to report. See useExportImport. */
  csvIssues: any;
  clearCsvIssues: (...args: any[]) => any;
  // Bulk catalogue apply (Settings -> Donnees). Two-step:
  // startCatalogueApply() plans, doCatalogueApply() writes.
  startCatalogueApply: () => void;
  doCatalogueApply: () => void;
  catalogueApplyPlan?: any;
  setCatalogueApplyPlan: (v: any) => void;
  doImportFile: (...args: any[]) => any;
  importConfirm?: any;
  applyImport: (...args: any[]) => any;
  cancelImport: (...args: any[]) => any;
  saveWeightUnit: (...args: any[]) => any;
  saveLengthUnit: (...args: any[]) => any;
  saveDateFormat: (...args: any[]) => any;
  undoToast?: any;
  setUndoToast: (...args: any[]) => void;
  exportReminder?: any;
  setExportReminder: (...args: any[]) => void;
  defaultListGrouped?: boolean;
  saveDefaultListGrouped: (...args: any[]) => any;
  canInstallApp?: boolean;
  triggerInstall: (...args: any[]) => any;
  saveLang: (...args: any[]) => any;
  /** Language code currently being fetched ("" when idle). */
  langPending: string;
  /** Language code that failed to load ("" when none). Offline and
   *  never downloaded — the app stays on the current language. */
  langErr: string;
  termsAccepted?: boolean;
  acceptTerms: (...args: any[]) => any;
  driveEncryptionEnabled?: boolean;
  saveDriveEncryptionEnabled: (...args: any[]) => any;
  drivePassphrase?: string | null;
  setDrivePassphrase: (...args: any[]) => void;
  encryptionPrompt?: any;
  resolveEncryptionPrompt: (...args: any[]) => any;
  requestDrivePassphrase: (...args: any[]) => any;
  aiProvider: string;
  saveAiProvider: (...args: any[]) => any;
  aiModel: string;
  /** The CONCRETE model id "auto" resolves to for the active
   *  provider — Settings names it so delegating the choice never hides which
   *  model (and which price tier) actually runs. */
  aiModelResolved: string;
  /** Last model-liveness probe result (Settings → IA). */
  modelProbe?: { state: "busy" | "ok" | "gone" | "error"; model: string } | null;
  probeModel: (...args: any[]) => any;
  saveAiModel: (...args: any[]) => any;
  apiKey: string;
  saveApiKey: (...args: any[]) => any;
  excludeApiKey?: boolean;
  setExcludeApiKey: (...args: any[]) => void;
  updateAvailable?: { version: string; build: string } | null;
  // A newer build exists, whatever the automatic paths decide.
  newerBuild?: { version: string; build: string } | null;
  // Ms of the last SUCCESSFUL version check (null = never).
  lastCheckOkMs?: number | null;
  // PipesDetailView reports its maintenance modal so the
  // auto-update can defer to unsaved input it cannot otherwise see.
  setMaintFormOpen: (open: boolean) => void;
  updateStatus?: any;
  setUpdateStatus: (...args: any[]) => void;
  doUpdate: (...args: any[]) => any;
  checkUpdate: (...args: any[]) => any;
  autoUpdateCountdown?: number | null;
  // Why a detected update is not applying (see explainPendingUpdate).
  pendingReason?: string;
  // Which surface is holding a deferred update — "tasting" or "form".
  deferReason?: string;
  cancelAutoUpdate: (...args: any[]) => any;
  // Dismiss the countdown for this occurrence, without the
  // durable decline that cancelAutoUpdate latches.
  dismissCountdown: (...args: any[]) => any;
  saveError?: string | null;
  setSaveError: (...args: any[]) => void;
  saveWarn?: string | null;
  setSaveWarn: (...args: any[]) => void;
  // Reports a dismissal of the SHARED `saveWarn` banner. The
  // quota hook owns it and only records the 7-day suppression when the banner
  // on screen was ITS own — see useStorageQuotaWarning.
  dismissQuotaWarn: () => void;
  lotDet?: any;
  setLotDet: (...args: any[]) => void;
  changeLotStatus: (tobId: any, lotId: any, ns: any) => void;
  removeLot: (tobId: any, lotId: any) => void;
  updatePillDismissed?: boolean;
  setUpdatePillDismissed: (...args: any[]) => void;
  justUpdated?: boolean;
  lightbox?: string | null;
}
// Stub defaults for the now-required keys (tranche 1). The real values always
// come from App.tsx's appCtx; these only satisfy the type for the empty
// createContext seed (a bare `{}` no longer type-checks once keys are required).
// The seed keeps real stubs for the hot keys (so a stray read outside a
// Provider still works) and is cast so newly-REQUIRED keys added by later
// typing tranches don't each have to be stubbed here — the real App.tsx
// Provider always supplies every value at runtime.
export var AppCtx = React.createContext<AppCtxType>({
  t: (k: string) => k,
  xl: (v: any) => v,
  nav: () => {},
  lang: "fr",
  weightUnit: "g",
  lengthUnit: "mm",
  dateFormat: "fr",
  currencySymbol: "€",
} as unknown as AppCtxType);
export function useAppCtx(): AppCtxType { return React.useContext(AppCtx); }
