export interface Lot {
  id?: string;
  /** Stable cross-device identity (crypto.randomUUID), minted at
   *  creation, immutable, carried in backups — the lot analogue of the
   *  entity uid. Distinct from the per-device numeric `id`. Powers uid-first
   *  lot merge so two genuinely-different tins with identical acquisition data
   *  (same unnumbered box + price + dates) can't collapse on a multi-device
   *  merge. Optional on legacy lots (backfilled by migrateData). */
  uid?: string;
  status: "cellar" | "jar" | "finished";
  // `originalStatus` records how the lot first entered the inventory —
  // either as a sealed tin (cellar) or as an already-opened jar.
  // It never includes "finished" since a lot cannot start finished.
  // Used by applyLotWeightDelta to decide whether a session-restore
  // that lands at `weightInitial` should revert the lot to cellar
  // (originalStatus === "cellar") or keep it in jar
  // (originalStatus === "jar"). A jar-from-start lot will never
  // spuriously slide into cellar.
  originalStatus: "cellar" | "jar";
  weightG: string;
  weightInitial: string;
  datePurchased: string;
  dateProduction: string;
  dateOpened: string;
  dateFinished: string;
  boxNumber: string;
  /**
   * Free-text storage location ("Armoire A · étagère 2",
   * "Cave du garage"…). Optional on legacy lots (older data has
   * no key); BL seeds "" for new lots. Searchable from the inventory
   * list + global search; shown on LotRow, the lot detail modal and
   * the CSV export.
   */
  storageLocation?: string;
  price: string;
  seller: string;
  sellerUrl?: string;
  disposed: boolean;
  /**
   * Soft-delete timestamp for lots. ISO string set when
   * the user deletes the lot from the tobacco detail view; the lot
   * stays inside `tobacco.lots` but is filtered out of the live ctx
   * view and the tobacco detail UI. Sessions that referenced the lot
   * keep their `lotId` intact so restoring the lot re-establishes the
   * link cleanly. Hard-removed after TRASH_RETENTION_DAYS (30) by the
   * startup cleanup — at that point sessions are orphanised
   * (`lotId` cleared) the same way the old hard-delete `removeLot`
   * used to do.
   */
  deletedAt?: string;
}

export interface Tobacco {
  id: number;
  /** Stable cross-device merge identity (crypto.randomUUID), minted
   *  at creation, immutable, carried in backups. Optional on legacy rows. */
  uid?: string;
  name: string;
  brand: string;
  category: string;
  blend: string;
  cut: string;
  force: number;
  roomNote: number;
  taste: number;
  rating: number;
  rebuy: boolean | null;
  tastingNotes: string;
  description: string;
  imageUrl: string;
  lots: Lot[];
  agingMax: string;
  /**
   * User-defined free-text tags / collections (e.g. "voyage",
   * "cadeaux", "matin"). Optional on legacy tobaccos; `migrateData` defaults
   * it to [] and sanitises (trim, dedup case-insensitively, drop empty, cap
   * count + length) via `sanitizeTags`. Purely a personal grouping axis —
   * never an identity key.
   */
  tags?: string[];
  /**
   * The user pinned this fiche against the BULK catalogue
   * pass (`planCatalogueApply` skips it entirely). Optional on legacy rows;
   * absent and `false` mean the same thing.
   *
   * Scope is deliberate and narrow — the BULK pass reviews nothing, so a
   * blanket rewrite of a fiche the user has curated by hand is the one thing
   * they cannot see coming. The per-fiche « Synchroniser avec la base » offer
   * is UNAFFECTED: it shows the diff on screen and the user accepts it there.
   */
  catalogueLock?: boolean;
  /**
   * Soft-delete timestamp. ISO string set when the user
   * deletes the tabac; the row stays in `data.tobaccos` but is filtered
   * out of the live ctx view (visible only in the Trash section of
   * Settings). Auto-removed after 30 days by the startup cleanup.
   */
  deletedAt?: string;
  /**
   * ISO edit timestamp stamped by useTobaccoStore on add/edit.
   * Drives multi-device merge last-write-wins in useImportConfirm (mirrors
   * Session.updatedAt): when a dup blend is matched AND both carry it AND the
   * imported one is strictly newer, its descriptive fields overwrite the local
   * ones (identity brand/name + imageUrl + lots are always preserved). Absent
   * on legacy rows → add-only, never clobbers a pre-feature local edit.
   */
  updatedAt?: string;
}

export interface Pipe {
  id: number;
  /** Stable cross-device merge identity — see Tobacco.uid. */
  uid?: string;
  name: string;
  brand: string;
  shape: string;
  courbure: string;
  length: string;
  weight: string;
  filterType: string;
  chamberDiameter: string;
  chamberDepth: string;
  bowlMaterial: string;
  stemMaterial: string;
  /** Surface finish — one of FINISHES (Lisse / Rustiquée
   *  / Sablée / Autre). Empty string when unset. */
  finish: string;
  datePurchased: string;
  dateProduction: string;
  price: string;
  seller: string;
  sellerUrl?: string;
  description: string;
  notes: string;
  imageUrl: string;
  /** Additional pipe photos (local-photo-* keys), pipes ONLY. The
   *  cover stays in `imageUrl`; these are loaded ON-DEMAND when the fiche opens
   *  (never into the global imgLocal) so a large collection doesn't balloon
   *  memory. Included in backups (gatherLocalImages) + kept alive by the orphan
   *  GC. Optional on legacy pipes. */
  photos?: string[];
  rating: number;
  status: "active" | "finished";
  /** Pipe maintenance log ("Carnet d'entretien"). Each entry
   *  is a dated care action (cleaning / salt-&-alcohol / reaming / waxing /
   *  repair / other). Embedded in the pipe (like Tobacco.lots), so it rides
   *  along in every JSON/Drive backup. Optional on legacy pipes; migrateData
   *  defaults it to []. */
  maintenance?: MaintEntry[];
  /** User-defined free-text tags / collections (see Tobacco.tags).
   *  Sanitised by migrateData via sanitizeTags. Personal grouping, never an id. */
  tags?: string[];
  /** See Tobacco.deletedAt. */
  deletedAt?: string;
  /** See Tobacco.updatedAt — multi-device merge last-write-wins. */
  updatedAt?: string;
}

/** One entry in a pipe's maintenance log.
 *  A session picks ONE cleaning `kind` and checks any number of `tasks`.
 *  Only the "light" / "full" kinds feed the maintenance reminder counter
 *  (see pipeMaint.ts); "none" logs an intervention (repair, waxing…) without
 *  resetting the reminder. `kind` / `tasks` keys resolve via t("maint_kind_<k>")
 *  / t("maint_task_<k>"). Keyed by an app-assigned numeric id (Date.now() at
 *  creation), never by a user field. Legacy `type`-based entries are migrated
 *  by migrateData (MAINT_LEGACY_MAP). */
export interface MaintEntry {
  id: number;
  /** Stable cross-device identity (crypto.randomUUID), minted at
   *  creation — the maintenance-entry analogue of the entity/lot uid. Optional
   *  on legacy entries (backfilled by migrateData). */
  uid?: string;
  date: string;                        // YYYY-MM-DD
  /** Optional "HH:MM", like Session.time — and it exists for exactly one
   *  reason. The reminder counts sessions smoked AFTER the last cleaning, and
   *  with day precision a session on the SAME DAY as the cleaning cannot be
   *  ordered against it: the counter dropped it, so cleaning a pipe and
   *  smoking it again the same day left the reminder silent. Reported from the
   *  app at a threshold of 1, where that is the difference between the feature
   *  working and doing nothing. A time makes the same-day order exact in BOTH
   *  directions — the alternative was to count same-day sessions
   *  unconditionally, which merely moves the error to "cleaned, and instantly
   *  told to clean again". Absent on legacy entries and on anyone who clears
   *  the field: those fall back to NOON, the same convention Session.time
   *  already uses (see rotation.sessionStartMs), so both sides of the
   *  comparison read a missing time identically. */
  time?: string;
  kind: "light" | "full" | "none";     // cleaning intensity; light/full feed the reminder
  tasks: string[];                     // checked MAINT_TASKS keys; descriptive only
  notes: string;
}

export interface WishlistItem {
  id: number;
  /** Stable cross-device merge identity — see Tobacco.uid. */
  uid?: string;
  name: string;
  brand: string;
  category: string;
  blend: string;
  cut: string;
  force: number;
  roomNote: number;
  taste: number;
  description: string;
  agingMax: string;
  tastingNotes: string;
  imageUrl: string;
  notes: string;
  priority: string;
  /** See Tobacco.catalogueLock — same field, same scope. */
  catalogueLock?: boolean;
  /** See Tobacco.deletedAt. */
  deletedAt?: string;
  /** See Tobacco.updatedAt — multi-device merge last-write-wins. */
  updatedAt?: string;
}

export interface Accessory {
  id: number;
  /** Stable cross-device merge identity — see Tobacco.uid. */
  uid?: string;
  name: string;
  brand: string;
  type: string;
  fuel: string;
  datePurchased: string;
  price: string;
  seller: string;
  sellerUrl?: string;
  imageUrl: string;
  rating: number;
  notes: string;
  status: "active" | "retired";
  /** User-defined free-text tags / collections (see Tobacco.tags).
   *  Sanitised by migrateData via sanitizeTags. Personal grouping, never an id. */
  tags?: string[];
  /** See Tobacco.deletedAt. */
  deletedAt?: string;
  /** See Tobacco.updatedAt — multi-device merge last-write-wins. */
  updatedAt?: string;
}

export interface Session {
  id: number;
  /** Stable cross-device merge identity — see Tobacco.uid. Minted at
   *  creation only (NOT backfilled): legacy sessions stay uid-less and dedup by
   *  the (date|time|tob|pipe|duration) key; two sessions that both carry a
   *  distinct uid are never collapsed by a key collision. */
  uid?: string;
  tobaccoId: number | string;
  pipeId: number | string;
  date: string;
  /**
   * Optional start time "HH:MM" (24 h). Date-only sessions
   * (every session before this field existed, and retroactive entries
   * where the hour is unknown) leave it empty. Used purely to order
   * same-day sessions in the journal — the day is still keyed off
   * `date`. Auto-filled to the tasting start time on a live tasting,
   * and to the current time on a fresh manual "+".
   */
  time?: string;
  duration: string;
  rating: number;
  notes: string;
  weightG: string;
  lotId: string;
  /**
   * Frozen reference to the tobacco at session save time.
   * Lets the journal show the tabac name even after the tobacco is
   * hard-deleted (post-30-day trash cleanup) or simply renamed.
   * Resolution order in the views is: live entity → snapshot → "—".
   *
   * `imageUrl` added so the journal can render the photo
   * of the tabac even after permanent deletion. Captured at session
   * save time AND refreshed on every entity at the moment of its
   * permanent deletion (so the snapshot keeps the most recent state
   * the user actually saw before they purged the entity).
   */
  tobaccoSnapshot?: { brand: string; name: string; imageUrl?: string };
  /** See tobaccoSnapshot. */
  pipeSnapshot?: { brand: string; name: string; imageUrl?: string };
  /**
   * Optional session location, captured from the
   * browser Geolocation API on an explicit user tap (never silent).
   * WGS84 decimal degrees. Both present or both absent — `isValidCoords`
   * gates every read. Surfaced as an embedded OpenStreetMap map in the
   * session detail modal; flows into JSON / CSV exports and cloud
   * backups like every other session field.
   */
  lat?: number;
  lng?: number;
  /**
   * Optional place for the session location, derived from
   * `lat`/`lng` via OpenStreetMap Nominatim reverse geocoding (no AI, no
   * API key). Stored as THREE distinct, editable parts so they can be
   * aggregated later (stats by commune / country); merged for display.
   * Best-effort — the coordinates stay the source of truth, any part may
   * be absent (offline at capture, geocoding failed, a legacy session, or
   * a city-centre point with no named spot).
   *   locationName    — the spot: a named POI or the street ("Café de Flore")
   *   locationCity    — the commune ("Paris")
   *   locationCountry — the country ("France")
   */
  locationName?: string;
  locationCity?: string;
  locationCountry?: string;
  /**
   * Optional list of tapped aroma descriptor keys (see
   * src/utils/aromas.ts AROMA_WHEEL — stable canonical keys like
   * "vanilla" / "leather", never localized text). The "aroma wheel":
   * a structured complement to the free-text `notes`, aggregated into
   * the user's taste profile in StatsView. Absent on legacy sessions.
   */
  aromas?: string[];
  /**
   * ISO timestamp stamped on every add/edit (useSessionStore).
   * Drives multi-device merge last-write-wins on the non-key optional fields
   * (notes/rating/geo/aromas) in useImportConfirm — when BOTH copies carry it
   * and the imported one is strictly newer, its edits overwrite. Absent on
   * legacy sessions (falls back to fill-if-empty, never clobbers). Never a key.
   */
  updatedAt?: string;
  /** See Tobacco.deletedAt. */
  deletedAt?: string;
}

export interface AppData {
  tobaccos: Tobacco[];
  wishlist: WishlistItem[];
  pipes: Pipe[];
  accessories: Accessory[];
  sessions: Session[];
  nxT: number;
  nxW: number;
  nxP: number;
  nxA: number;
  nxJ: number;
}
