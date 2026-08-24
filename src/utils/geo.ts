import { langAssets } from "../i18n/languages.ts";
// geo.ts — pure helpers for the session-location feature.
//
// A session can optionally carry a `lat` / `lng` pair captured from
// the browser Geolocation API (explicit user action — never silent).
// These helpers build the OpenStreetMap embed iframe URL + the
// external "open in maps" link, and validate / format coordinates.
// Pure (no DOM, no network) so they're unit-testable; the actual
// geolocation capture lives in SessionFormView (browser-only).

/** True when both values are finite numbers inside the valid WGS84 range. */
export function isValidCoords(lat: any, lng: any): boolean {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

/** Human-readable "48.8566, 2.3522" — 5 decimals (~1 m precision). */
export function formatCoords(lat: number, lng: number): string {
  return Number(lat).toFixed(5) + ", " + Number(lng).toFixed(5);
}

/**
 * OpenStreetMap embed iframe `src`. A small bbox delta around the
 * point gives a street-level zoom; `marker` drops a pin at the exact
 * coordinate. Returns "" for invalid input so the caller can skip the
 * iframe entirely.
 */
export function osmEmbedUrl(lat: number, lng: number): string {
  if (!isValidCoords(lat, lng)) return "";
  var d = 0.004; // ~±450 m → roughly a neighbourhood view
  var minLng = lng - d, minLat = lat - d, maxLng = lng + d, maxLat = lat + d;
  var bbox = minLng + "," + minLat + "," + maxLng + "," + maxLat;
  return "https://www.openstreetmap.org/export/embed.html?bbox=" +
    encodeURIComponent(bbox) + "&layer=mapnik&marker=" +
    encodeURIComponent(lat + "," + lng);
}

/**
 * External "open the full map" link — opens openstreetmap.org centred
 * on the point with a marker. Returns "" for invalid input.
 */
export function osmLinkUrl(lat: number, lng: number): string {
  if (!isValidCoords(lat, lng)) return "";
  return "https://www.openstreetmap.org/?mlat=" + encodeURIComponent(String(lat)) +
    "&mlon=" + encodeURIComponent(String(lng)) +
    "#map=16/" + lat + "/" + lng;
}

// ─── Reverse geocoding ───────────────────────────────────────────────────────
// Coordinates → human-readable place name, via OpenStreetMap Nominatim.
// No AI, no API key. Nominatim's usage policy asks for ≤1 req/s and an
// identifying Referer (the browser sends the app origin automatically —
// fetch can't set User-Agent). For a per-session reverse-geocode this is
// well within budget; the retroactive batch throttles itself (caller side).

/**
 * A session location is stored as THREE distinct parts — the spot
 * (a named POI or the street), the commune (town/city), and the country.
 * Empty strings for any part that Nominatim didn't provide.
 */
export interface PlaceParts { name: string; city: string; country: string; }

/** True when at least one of the three place parts is non-empty. */
export function hasPlaceParts(p: PlaceParts | null | undefined): boolean {
  return !!p && !!String((p.name || "") + (p.city || "") + (p.country || "")).trim();
}

/**
 * Extract the three place parts from a Nominatim `jsonv2` reverse-geocode
 * payload. Pure + null-safe so it's unit-testable without a network call.
 * `name` = a named POI first, else the street; `city` = the commune
 * (town/city, not the suburb); `country` = the country. Falls back to the
 * `display_name` segments when the structured address is missing.
 */
export function parsePlace(j: any): PlaceParts {
  var empty: PlaceParts = { name: "", city: "", country: "" };
  if (!j || typeof j !== "object") return empty;
  var a = (j.address && typeof j.address === "object") ? j.address : {};
  var poi = j.name || a.amenity || a.shop || a.tourism || a.leisure
    || a.building || a.club || a.craft || a.office;
  var road = a.road || a.pedestrian || a.footway;
  var name = String(poi || road || "");
  var city = String(a.city || a.town || a.village || a.municipality || a.hamlet || "");
  var country = String(a.country || "");
  // Salvage from display_name only when the structured address gave nothing.
  if (!name && !city && typeof j.display_name === "string" && j.display_name) {
    var segs = String(j.display_name).split(",").map(function (s: string) { return String(s).trim(); }).filter(Boolean);
    name = segs[0] || "";
    city = segs[1] || "";
    if (!country) country = segs.length > 1 ? (segs[segs.length - 1] || "") : "";
  }
  return { name: name, city: city, country: country };
}

/** Join the place parts into one display string, skipping empties + dups. */
export function joinPlaceParts(name?: string, city?: string, country?: string): string {
  var pick: string[] = [];
  [name, city, country].forEach(function (v) {
    var s = String(v || "").trim();
    if (s && pick.indexOf(s) === -1) pick.push(s);
  });
  return pick.join(", ");
}

// `formatPlaceName(j)` — a convenience wrapper composing `parsePlace` and
// `joinPlaceParts` — was REMOVED: nothing called it. `reverseGeocode` returns
// the PARTS (the session stores name / city / country separately, and the
// Stats "Pays" chart groups on the country alone), so the joined label is
// built where it is displayed, not here. Both halves stay and are tested.

/** Nominatim reverse-geocode endpoint URL for the given point + UI language. */
export function nominatimReverseUrl(lat: number, lng: number, lang?: string): string {
  // Review fix: forward es/de/it too (Nominatim supports them). Was fr/en-only,
  // so es/de/it users got French place & country names ("Allemagne" not "Alemania").
  // From the shared per-language table. The five-way comparison it
  // replaces defaulted to FRENCH, so a sixth language would silently have got
  // French place and country names.
  var l = langAssets(lang).nominatim;
  return "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1" +
    "&lat=" + encodeURIComponent(String(lat)) +
    "&lon=" + encodeURIComponent(String(lng)) +
    "&accept-language=" + l;
}

/**
 * Reverse-geocode a point to its three place parts. Resolves to all-empty
 * parts on invalid input, network error, non-OK response, or an unparseable
 * payload — the caller treats empty parts as "nothing available" and never
 * overwrites existing values with an empty result. Honours an optional
 * AbortSignal.
 */
// LABEL-CONTRACT:start osm-reverse-geocoding — see scripts/label-contracts.json
export function reverseGeocode(lat: number, lng: number, lang?: string, signal?: AbortSignal): Promise<PlaceParts> {
  var empty: PlaceParts = { name: "", city: "", country: "" };
  if (!isValidCoords(lat, lng)) return Promise.resolve(empty);
  if (typeof fetch !== "function") return Promise.resolve(empty);
  var opts: any = { headers: { "Accept": "application/json" } };
  // Fold a self-timeout (LOW — a hung Nominatim request
  // would otherwise leave the "geocoding…" spinner spinning forever) with
  // the caller's optional AbortSignal (MED — cancel a late result when the
  // user navigates to a different session before it resolves). Both feed one
  // internal controller so `opts.signal` carries either trigger.
  var timer: ReturnType<typeof setTimeout> | null = null;
  if (typeof AbortController === "function") {
    var ctrl = new AbortController();
    opts.signal = ctrl.signal;
    timer = setTimeout(function () { try { ctrl.abort(); } catch { /* noop */ } }, 12000);
    if (signal) {
      if (signal.aborted) { try { ctrl.abort(); } catch { /* noop */ } }
      else signal.addEventListener("abort", function () { try { ctrl.abort(); } catch { /* noop */ } }, { once: true });
    }
  } else if (signal) {
    opts.signal = signal;
  }
  return fetch(nominatimReverseUrl(lat, lng, lang), opts)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return parsePlace(j); })
    .catch(function () { return empty; })
    .then(function (p) { if (timer !== null) { clearTimeout(timer); timer = null; } return p; });
}
// LABEL-CONTRACT:end osm-reverse-geocoding

/**
 * The shared "capture the current location" flow, extracted
 * verbatim from SessionFormView.captureLocation + TastingView.captureTasting-
 * Location — two near-identical blocks that must stay in lock-step (iOS /
 * Android geolocation UX + localized error strings). This is a faithful
 * refactor: the exact same `navigator.geolocation.getCurrentPosition` call,
 * the same `{enableHighAccuracy, timeout, maximumAge}` options, the same
 * validity/permission error branches and the same best-effort reverse-geocode
 * — so on-device behaviour is byte-identical. The per-caller differences
 * (where to persist coords, the optional "geocoding…" busy flag, how to store
 * the resolved place) are injected as callbacks.
 *
 * `onCoords` returns false to signal "couldn't persist" (e.g. the tasting
 * setter isn't wired) → the flow falls to the invalid-position error branch,
 * mirroring TastingView's original `isValidCoords(...) && tastingSetLocation`.
 */
export function captureGeoLocation(opts: {
  t?: (k: string) => string;
  lang?: string;
  onStatus: (s: "idle" | "loading" | "error") => void;
  onError: (msg: string) => void;
  onCoords: (lat: number, lng: number) => boolean;
  onPlace?: (lat: number, lng: number, place: PlaceParts) => void;
  onGeocodeStart?: () => void;
  onGeocodeEnd?: () => void;
  // Optional AbortSignal so the caller can cancel the
  // best-effort reverse-geocode when it leaves the session/view before the
  // async result lands (prevents a late place name stamping the wrong form).
  signal?: AbortSignal;
}): void {
  var t = opts.t;
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    opts.onStatus("error");
    opts.onError(t ? t("geo_unavailable") : "Géolocalisation indisponible sur cet appareil.");
    return;
  }
  opts.onStatus("loading");
  opts.onError("");
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      var latitude = pos.coords.latitude;
      var longitude = pos.coords.longitude;
      if (isValidCoords(latitude, longitude) && opts.onCoords(latitude, longitude)) {
        opts.onStatus("idle");
        if (opts.onGeocodeStart) opts.onGeocodeStart();
        reverseGeocode(latitude, longitude, opts.lang, opts.signal).then(function (p) {
          if (opts.signal && opts.signal.aborted) return;
          if (opts.onGeocodeEnd) opts.onGeocodeEnd();
          if (hasPlaceParts(p) && opts.onPlace) opts.onPlace(latitude, longitude, p);
        });
      } else {
        opts.onStatus("error");
        opts.onError(t ? t("geo_error") : "Position indisponible — réessaie.");
      }
    },
    function (err) {
      opts.onStatus("error");
      opts.onError(
        err && err.code === 1
          ? (t ? t("geo_denied") : "Accès à la position refusé. Autorise-le dans les réglages pour l'utiliser.")
          : (t ? t("geo_error") : "Position indisponible — réessaie."),
      );
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

// ── Country flags ────────────────────────────────────────────────────────────
// Reverse geocoding gives the country NAME (localised fr/en). Flag emojis come
// from the ISO-3166-1 alpha-2 code (two regional-indicator symbols). We map the
// common country names (FR + EN) to their code so the Stats "Pays" chart can
// show a flag without storing an extra field — works on existing data. Unknown
// names just get no flag (graceful). Pure; tested in geo.test.ts.

function flagNormalize(s: any): string {
  return String(s || "").toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// [iso2, English, French, Spanish, German, Italian] — the
// es/de/it columns were added so a country name captured while the app was
// in Spanish/German/Italian ("Alemania" / "Deutschland" / "Germania")
// still resolves to its ISO code — both for the Stats flag AND for the
// cross-language country aggregation (see countryNameToIso2).
var _COUNTRY_ROWS: [string, string, string, string, string, string, string][] = [
  ["FR", "France", "France", "Francia", "Frankreich", "Francia", "França"],
  ["CH", "Switzerland", "Suisse", "Suiza", "Schweiz", "Svizzera", "Suíça"],
  ["BE", "Belgium", "Belgique", "Bélgica", "Belgien", "Belgio", "Bélgica"],
  ["LU", "Luxembourg", "Luxembourg", "Luxemburgo", "Luxemburg", "Lussemburgo", "Luxemburgo"],
  ["DE", "Germany", "Allemagne", "Alemania", "Deutschland", "Germania", "Alemanha"],
  ["IT", "Italy", "Italie", "Italia", "Italien", "Italia", "Itália"],
  ["ES", "Spain", "Espagne", "España", "Spanien", "Spagna", "Espanha"],
  ["PT", "Portugal", "Portugal", "Portugal", "Portugal", "Portogallo", "Portugal"],
  ["GB", "United Kingdom", "Royaume-Uni", "Reino Unido", "Vereinigtes Königreich", "Regno Unito", "Reino Unido"],
  ["IE", "Ireland", "Irlande", "Irlanda", "Irland", "Irlanda", "Irlanda"],
  ["NL", "Netherlands", "Pays-Bas", "Países Bajos", "Niederlande", "Paesi Bassi", "Países Baixos"],
  ["AT", "Austria", "Autriche", "Austria", "Österreich", "Austria", "Áustria"],
  ["DK", "Denmark", "Danemark", "Dinamarca", "Dänemark", "Danimarca", "Dinamarca"],
  ["SE", "Sweden", "Suède", "Suecia", "Schweden", "Svezia", "Suécia"],
  ["NO", "Norway", "Norvège", "Noruega", "Norwegen", "Norvegia", "Noruega"],
  ["FI", "Finland", "Finlande", "Finlandia", "Finnland", "Finlandia", "Finlândia"],
  ["IS", "Iceland", "Islande", "Islandia", "Island", "Islanda", "Islândia"],
  ["PL", "Poland", "Pologne", "Polonia", "Polen", "Polonia", "Polónia"],
  ["CZ", "Czechia", "Tchéquie", "Chequia", "Tschechien", "Cechia", "Chéquia"],
  ["SK", "Slovakia", "Slovaquie", "Eslovaquia", "Slowakei", "Slovacchia", "Eslováquia"],
  ["HU", "Hungary", "Hongrie", "Hungría", "Ungarn", "Ungheria", "Hungria"],
  ["RO", "Romania", "Roumanie", "Rumanía", "Rumänien", "Romania", "Roménia"],
  ["BG", "Bulgaria", "Bulgarie", "Bulgaria", "Bulgarien", "Bulgaria", "Bulgária"],
  ["GR", "Greece", "Grèce", "Grecia", "Griechenland", "Grecia", "Grécia"],
  ["HR", "Croatia", "Croatie", "Croacia", "Kroatien", "Croazia", "Croácia"],
  ["SI", "Slovenia", "Slovénie", "Eslovenia", "Slowenien", "Slovenia", "Eslovénia"],
  ["RS", "Serbia", "Serbie", "Serbia", "Serbien", "Serbia", "Sérvia"],
  ["BA", "Bosnia and Herzegovina", "Bosnie-Herzégovine", "Bosnia y Herzegovina", "Bosnien und Herzegowina", "Bosnia ed Erzegovina", "Bósnia e Herzegovina"],
  ["ME", "Montenegro", "Monténégro", "Montenegro", "Montenegro", "Montenegro", "Montenegro"],
  ["MK", "North Macedonia", "Macédoine du Nord", "Macedonia del Norte", "Nordmazedonien", "Macedonia del Nord", "Macedónia do Norte"],
  ["AL", "Albania", "Albanie", "Albania", "Albanien", "Albania", "Albânia"],
  ["EE", "Estonia", "Estonie", "Estonia", "Estland", "Estonia", "Estónia"],
  ["LV", "Latvia", "Lettonie", "Letonia", "Lettland", "Lettonia", "Letónia"],
  ["LT", "Lithuania", "Lituanie", "Lituania", "Litauen", "Lituania", "Lituânia"],
  ["UA", "Ukraine", "Ukraine", "Ucrania", "Ukraine", "Ucraina", "Ucrânia"],
  ["BY", "Belarus", "Biélorussie", "Bielorrusia", "Belarus", "Bielorussia", "Bielorrússia"],
  ["RU", "Russia", "Russie", "Rusia", "Russland", "Russia", "Rússia"],
  ["TR", "Turkey", "Turquie", "Turquía", "Türkei", "Turchia", "Turquia"],
  ["CY", "Cyprus", "Chypre", "Chipre", "Zypern", "Cipro", "Chipre"],
  ["MT", "Malta", "Malte", "Malta", "Malta", "Malta", "Malta"],
  ["MC", "Monaco", "Monaco", "Mónaco", "Monaco", "Monaco", "Mónaco"],
  ["AD", "Andorra", "Andorre", "Andorra", "Andorra", "Andorra", "Andorra"],
  ["SM", "San Marino", "Saint-Marin", "San Marino", "San Marino", "San Marino", "São Marinho"],
  ["VA", "Vatican City", "Vatican", "Ciudad del Vaticano", "Vatikanstadt", "Città del Vaticano", "Cidade do Vaticano"],
  ["LI", "Liechtenstein", "Liechtenstein", "Liechtenstein", "Liechtenstein", "Liechtenstein", "Listenstaine"],
  ["US", "United States", "États-Unis", "Estados Unidos", "Vereinigte Staaten", "Stati Uniti", "Estados Unidos"],
  ["CA", "Canada", "Canada", "Canadá", "Kanada", "Canada", "Canadá"],
  ["MX", "Mexico", "Mexique", "México", "Mexiko", "Messico", "México"],
  ["BR", "Brazil", "Brésil", "Brasil", "Brasilien", "Brasile", "Brasil"],
  ["AR", "Argentina", "Argentine", "Argentina", "Argentinien", "Argentina", "Argentina"],
  ["CL", "Chile", "Chili", "Chile", "Chile", "Cile", "Chile"],
  ["CO", "Colombia", "Colombie", "Colombia", "Kolumbien", "Colombia", "Colômbia"],
  ["PE", "Peru", "Pérou", "Perú", "Peru", "Perù", "Peru"],
  ["CN", "China", "Chine", "China", "China", "Cina", "China"],
  ["JP", "Japan", "Japon", "Japón", "Japan", "Giappone", "Japão"],
  ["KR", "South Korea", "Corée du Sud", "Corea del Sur", "Südkorea", "Corea del Sud", "Coreia do Sul"],
  ["IN", "India", "Inde", "India", "Indien", "India", "Índia"],
  ["TH", "Thailand", "Thaïlande", "Tailandia", "Thailand", "Thailandia", "Tailândia"],
  ["VN", "Vietnam", "Viêt Nam", "Vietnam", "Vietnam", "Vietnam", "Vietname"],
  ["ID", "Indonesia", "Indonésie", "Indonesia", "Indonesien", "Indonesia", "Indonésia"],
  ["PH", "Philippines", "Philippines", "Filipinas", "Philippinen", "Filippine", "Filipinas"],
  ["MY", "Malaysia", "Malaisie", "Malasia", "Malaysia", "Malesia", "Malásia"],
  ["SG", "Singapore", "Singapour", "Singapur", "Singapur", "Singapore", "Singapura"],
  ["HK", "Hong Kong", "Hong Kong", "Hong Kong", "Hongkong", "Hong Kong", "Hong Kong"],
  ["TW", "Taiwan", "Taïwan", "Taiwán", "Taiwan", "Taiwan", "Taiwan"],
  ["AU", "Australia", "Australie", "Australia", "Australien", "Australia", "Austrália"],
  ["NZ", "New Zealand", "Nouvelle-Zélande", "Nueva Zelanda", "Neuseeland", "Nuova Zelanda", "Nova Zelândia"],
  ["ZA", "South Africa", "Afrique du Sud", "Sudáfrica", "Südafrika", "Sudafrica", "África do Sul"],
  ["MA", "Morocco", "Maroc", "Marruecos", "Marokko", "Marocco", "Marrocos"],
  ["DZ", "Algeria", "Algérie", "Argelia", "Algerien", "Algeria", "Argélia"],
  ["TN", "Tunisia", "Tunisie", "Túnez", "Tunesien", "Tunisia", "Tunísia"],
  ["EG", "Egypt", "Égypte", "Egipto", "Ägypten", "Egitto", "Egito"],
  ["NG", "Nigeria", "Nigéria", "Nigeria", "Nigeria", "Nigeria", "Nigéria"],
  ["KE", "Kenya", "Kenya", "Kenia", "Kenia", "Kenya", "Quénia"],
  ["IL", "Israel", "Israël", "Israel", "Israel", "Israele", "Israel"],
  ["AE", "United Arab Emirates", "Émirats arabes unis", "Emiratos Árabes Unidos", "Vereinigte Arabische Emirate", "Emirati Arabi Uniti", "Emirados Árabes Unidos"],
  ["SA", "Saudi Arabia", "Arabie saoudite", "Arabia Saudita", "Saudi-Arabien", "Arabia Saudita", "Arábia Saudita"],
  ["QA", "Qatar", "Qatar", "Catar", "Katar", "Qatar", "Catar"],
  ["LB", "Lebanon", "Liban", "Líbano", "Libanon", "Libano", "Líbano"],
];

var _COUNTRY_CODE_BY_NAME: Record<string, string> = (function () {
  var m: Record<string, string> = {};
  _COUNTRY_ROWS.forEach(function (r) {
    // Index every localised name (en/fr/es/de/it) → ISO code.
    for (var i = 1; i < r.length; i++) {
      var nm = r[i];
      if (nm) m[flagNormalize(nm)] = r[0];
    }
  });
  // A few common aliases / alternate spellings Nominatim may return.
  m[flagNormalize("USA")] = "US";
  m[flagNormalize("UK")] = "GB";
  m[flagNormalize("Czech Republic")] = "CZ";
  m[flagNormalize("République tchèque")] = "CZ";
  m[flagNormalize("Türkiye")] = "TR";
  return m;
})();

/** ISO-3166-1 alpha-2 code → flag emoji (two regional indicators). "" if invalid. */
export function iso2ToFlag(code: any): string {
  var cc = String(code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65);
}

/** Country name in any UI language → flag emoji, or "" when the name isn't mapped. */
export function countryNameToFlag(name: any): string {
  var code = _COUNTRY_CODE_BY_NAME[flagNormalize(name)];
  return code ? iso2ToFlag(code) : "";
}

/**
 * Country name in any supported UI language → its
 * ISO-3166-1 alpha-2 code, or "" when unknown. This is the
 * canonical key used to aggregate the same country across languages in the
 * Stats "Pays" chart — "France" / "Frankreich" / "Francia" all resolve to
 * "FR" and are summed as one, instead of splitting into separate rows.
 */
export function countryNameToIso2(name: any): string {
  return _COUNTRY_CODE_BY_NAME[flagNormalize(name)] || "";
}

// ISO code → localised country name, so the Stats "Pays"
// chart can render every country in the ACTIVE UI language (not the
// language each session happened to be captured in). Column order matches
// _COUNTRY_ROWS: [iso, en, fr, es, de, it, pt].
var _COUNTRY_ROW_BY_ISO: Record<string, string[]> = (function () {
  var m: Record<string, string[]> = {};
  _COUNTRY_ROWS.forEach(function (r) { m[r[0]] = r; });
  return m;
})();
// Null-prototype: indexed by the active UI language, which is read from
// storage. On a plain object a forged code resolves to `Object.prototype` —
// truthy, so the `|| 1` fallback never fires — and `row[col]` then returns
// undefined, so it degraded to English by accident rather than by design.
var _LANG_COL: Record<string, number> = Object.assign(Object.create(null), { en: 1, fr: 2, es: 3, de: 4, it: 5, pt: 6 }) as Record<string, number>;

/**
 * ISO-3166-1 alpha-2 code → country name in the given UI language, falling
 * back to English then "" for an unknown code.
 */
export function iso2ToCountryName(code: any, lang?: string): string {
  var cc = String(code || "").toUpperCase();
  var row = _COUNTRY_ROW_BY_ISO[cc];
  if (!row) return "";
  var col = _LANG_COL[String(lang || "")] || 1; // default to English
  return row[col] || row[1] || "";
}
