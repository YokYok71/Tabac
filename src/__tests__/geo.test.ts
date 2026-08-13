import { describe, it, expect, vi, afterEach } from "vitest";
import { LANGUAGES } from "../i18n/languages.ts";
import {
  isValidCoords, formatCoords, osmEmbedUrl, osmLinkUrl,
  formatPlaceName, parsePlace, joinPlaceParts, hasPlaceParts,
  nominatimReverseUrl, reverseGeocode,
  iso2ToFlag, countryNameToFlag, countryNameToIso2, iso2ToCountryName,
} from "../utils/geo";

describe("isValidCoords", () => {
  it("accepts valid WGS84 pairs", () => {
    expect(isValidCoords(48.8566, 2.3522)).toBe(true);
    expect(isValidCoords(0, 0)).toBe(true);
    expect(isValidCoords(-90, -180)).toBe(true);
    expect(isValidCoords(90, 180)).toBe(true);
  });

  it("rejects out-of-range values", () => {
    expect(isValidCoords(91, 0)).toBe(false);
    expect(isValidCoords(-91, 0)).toBe(false);
    expect(isValidCoords(0, 181)).toBe(false);
    expect(isValidCoords(0, -181)).toBe(false);
  });

  it("rejects non-finite and non-number inputs", () => {
    expect(isValidCoords(NaN, 0)).toBe(false);
    expect(isValidCoords(0, Infinity)).toBe(false);
    expect(isValidCoords("48", "2")).toBe(false);
    expect(isValidCoords(undefined, undefined)).toBe(false);
    expect(isValidCoords(null, null)).toBe(false);
    expect(isValidCoords(48.8566, undefined)).toBe(false);
  });
});

describe("formatCoords", () => {
  it("formats to 5 decimals", () => {
    expect(formatCoords(48.85661234, 2.35221987)).toBe("48.85661, 2.35222");
  });
  it("handles negatives and zero", () => {
    expect(formatCoords(-33.8688, 151.2093)).toBe("-33.86880, 151.20930");
    expect(formatCoords(0, 0)).toBe("0.00000, 0.00000");
  });
});

describe("osmEmbedUrl", () => {
  it("builds an embed URL with a bbox and a marker", () => {
    const url = osmEmbedUrl(48.8566, 2.3522);
    expect(url).toContain("https://www.openstreetmap.org/export/embed.html");
    expect(url).toContain("bbox=");
    expect(url).toContain("layer=mapnik");
    expect(url).toContain("marker=");
    // The marker encodes the exact point.
    expect(decodeURIComponent(url)).toContain("marker=48.8566,2.3522");
  });

  it("centres the bbox on the point (±0.004)", () => {
    const url = decodeURIComponent(osmEmbedUrl(10, 20));
    expect(url).toContain("bbox=19.996,9.996,20.004,10.004");
  });

  it("returns empty string for invalid coords", () => {
    expect(osmEmbedUrl(NaN, 2)).toBe("");
    expect(osmEmbedUrl(200, 2)).toBe("");
  });
});

describe("osmLinkUrl", () => {
  it("builds a marker link centred on the point", () => {
    const url = osmLinkUrl(48.8566, 2.3522);
    expect(url).toContain("https://www.openstreetmap.org/?mlat=48.8566");
    expect(url).toContain("mlon=2.3522");
    expect(url).toContain("#map=16/48.8566/2.3522");
  });

  it("returns empty string for invalid coords", () => {
    expect(osmLinkUrl(0, 999)).toBe("");
  });
});


// ── Reverse geocoding ─────────────────────────────────────────────

describe("formatPlaceName", () => {
  it("prefers a named POI and appends commune + country", () => {
    expect(formatPlaceName({ name: "Café de Flore", address: { road: "Bd Saint-Germain", city: "Paris", country: "France" } }))
      .toBe("Café de Flore, Paris, France");
  });

  it("includes commune and country even without a POI/road (city centre)", () => {
    expect(formatPlaceName({ address: { city: "Lyon", country: "France" } }))
      .toBe("Lyon, France");
  });

  it("falls back to road + commune + country when no POI name", () => {
    expect(formatPlaceName({ address: { road: "Baker Street", city: "London", country: "United Kingdom" } }))
      .toBe("Baker Street, London, United Kingdom");
  });

  it("omits missing parts (no country present)", () => {
    expect(formatPlaceName({ address: { road: "Baker Street", city: "London" } }))
      .toBe("Baker Street, London");
  });

  it("uses an address POI type (amenity/shop) when name is absent", () => {
    expect(formatPlaceName({ address: { amenity: "Le Procope", city: "Paris" } }))
      .toBe("Le Procope, Paris");
  });

  it("does not duplicate when POI equals city", () => {
    expect(formatPlaceName({ name: "Paris", address: { city: "Paris" } })).toBe("Paris");
  });

  it("salvages spot/city/country from display_name when address is empty", () => {
    expect(formatPlaceName({ display_name: "12, Rue X, Quartier Y, Ville Z, 75000, France" }))
      .toBe("12, Rue X, France");
  });

  it("returns '' for empty / non-object input", () => {
    expect(formatPlaceName(null)).toBe("");
    expect(formatPlaceName({})).toBe("");
    expect(formatPlaceName("nope")).toBe("");
  });
});

describe("parsePlace (structured parts)", () => {
  it("splits a POI payload into name / city / country", () => {
    expect(parsePlace({ name: "Café de Flore", address: { city: "Paris", country: "France" } }))
      .toEqual({ name: "Café de Flore", city: "Paris", country: "France" });
  });
  it("uses the road as the spot when there is no POI", () => {
    expect(parsePlace({ address: { road: "Baker Street", town: "London", country: "UK" } }))
      .toEqual({ name: "Baker Street", city: "London", country: "UK" });
  });
  it("returns empty parts for a non-object", () => {
    expect(parsePlace(null)).toEqual({ name: "", city: "", country: "" });
  });
});

describe("joinPlaceParts", () => {
  it("joins non-empty parts and dedups", () => {
    expect(joinPlaceParts("Café de Flore", "Paris", "France")).toBe("Café de Flore, Paris, France");
    expect(joinPlaceParts("", "Lyon", "France")).toBe("Lyon, France");
    expect(joinPlaceParts("Paris", "Paris", "")).toBe("Paris");
    expect(joinPlaceParts("", "", "")).toBe("");
  });
});

describe("hasPlaceParts", () => {
  it("is true when any part is non-empty", () => {
    expect(hasPlaceParts({ name: "", city: "Paris", country: "" })).toBe(true);
    expect(hasPlaceParts({ name: "X", city: "", country: "" })).toBe(true);
  });
  it("is false for all-empty / null", () => {
    expect(hasPlaceParts({ name: "", city: "", country: "" })).toBe(false);
    expect(hasPlaceParts(null)).toBe(false);
  });
});

describe("nominatimReverseUrl", () => {
  it("builds a jsonv2 reverse URL with the point + language", () => {
    const u = nominatimReverseUrl(48.8566, 2.3522, "fr");
    expect(u).toContain("https://nominatim.openstreetmap.org/reverse");
    expect(u).toContain("format=jsonv2");
    expect(u).toContain("lat=48.8566");
    expect(u).toContain("lon=2.3522");
    expect(u).toContain("accept-language=fr");
  });
  it("forwards every REGISTERED language, and falls back to English", () => {
    // Derived from LANGUAGES, not a hardcoded list: the point of
    // moving this data into LANG_ASSETS is that a sixth language needs no edit
    // here, and a test that enumerated the five would have needed one.
    for (const l of LANGUAGES) {
      expect(nominatimReverseUrl(0, 0, l.code), `${l.code} not forwarded`)
        .toContain(`accept-language=${l.code}`);
    }
    // The fallback is ENGLISH, not French (changed). Two reasons:
    // It matches the app-wide rule set — an unknown or unloadable
    // language resolves through English everywhere else — and English place
    // names are more widely readable than French ones to someone whose language
    // the app does not have. The old French default was an earlier leftover.
    expect(nominatimReverseUrl(0, 0)).toContain("accept-language=en");
    expect(nominatimReverseUrl(0, 0, "zz")).toContain("accept-language=en");
  });
});

describe("reverseGeocode", () => {
  const EMPTY = { name: "", city: "", country: "" };
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("resolves empty parts for invalid coords without hitting the network", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await reverseGeocode(999, 0)).toEqual(EMPTY);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns structured parts on a successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: "Blue Note", address: { city: "New York", country: "USA" } }),
    }));
    expect(await reverseGeocode(40.73, -74.0, "en")).toEqual({ name: "Blue Note", city: "New York", country: "USA" });
  });

  it("resolves empty parts on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await reverseGeocode(48.85, 2.35)).toEqual(EMPTY);
  });

  it("resolves empty parts (never rejects) on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(reverseGeocode(48.85, 2.35)).resolves.toEqual(EMPTY);
  });

  // The fetch always carries an AbortSignal (self-timeout),
  // and an already-aborted caller signal aborts it before the request lands.
  it("passes an AbortSignal to fetch and honours an aborted caller signal", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", f);
    const ctrl = new AbortController();
    ctrl.abort();
    await reverseGeocode(48.85, 2.35, "fr", ctrl.signal);
    expect(f).toHaveBeenCalledTimes(1);
    const opts = f.mock.calls[0]![1] as any;
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    // caller already aborted → the internal (self-timeout) controller aborts too
    expect(opts.signal.aborted).toBe(true);
  });
});

// ── Country flags ─────────────────────────────────────────────────

describe("iso2ToFlag", () => {
  it("maps an ISO-2 code to the flag emoji", () => {
    expect(iso2ToFlag("FR")).toBe("🇫🇷");
    expect(iso2ToFlag("ch")).toBe("🇨🇭"); // case-insensitive
    expect(iso2ToFlag("US")).toBe("🇺🇸");
  });
  it("returns '' for invalid codes", () => {
    expect(iso2ToFlag("")).toBe("");
    expect(iso2ToFlag("FRA")).toBe("");
    expect(iso2ToFlag("1!")).toBe("");
    expect(iso2ToFlag(null)).toBe("");
  });
});

describe("countryNameToFlag", () => {
  it("maps French country names to flags", () => {
    expect(countryNameToFlag("France")).toBe("🇫🇷");
    expect(countryNameToFlag("Suisse")).toBe("🇨🇭");
    expect(countryNameToFlag("États-Unis")).toBe("🇺🇸");
    expect(countryNameToFlag("Royaume-Uni")).toBe("🇬🇧");
  });
  it("maps English country names to flags", () => {
    expect(countryNameToFlag("Switzerland")).toBe("🇨🇭");
    expect(countryNameToFlag("Germany")).toBe("🇩🇪");
    expect(countryNameToFlag("United States")).toBe("🇺🇸");
  });
  it("maps es/de/it country names to flags", () => {
    // Germany across the four other languages
    expect(countryNameToFlag("Alemania")).toBe("🇩🇪");     // es
    expect(countryNameToFlag("Deutschland")).toBe("🇩🇪");  // de
    expect(countryNameToFlag("Germania")).toBe("🇩🇪");     // it
    // A few more per language
    expect(countryNameToFlag("España")).toBe("🇪🇸");       // es Spain
    expect(countryNameToFlag("Schweiz")).toBe("🇨🇭");      // de Switzerland
    expect(countryNameToFlag("Svizzera")).toBe("🇨🇭");     // it Switzerland
    expect(countryNameToFlag("Stati Uniti")).toBe("🇺🇸");  // it United States
  });
  it("is accent- and case-insensitive (NFD normalize)", () => {
    expect(countryNameToFlag("suede")).toBe("🇸🇪");   // Suède
    expect(countryNameToFlag("SUISSE")).toBe("🇨🇭");
  });
  it("honours common aliases", () => {
    expect(countryNameToFlag("USA")).toBe("🇺🇸");
    expect(countryNameToFlag("UK")).toBe("🇬🇧");
  });
  it("returns '' for unknown / empty names", () => {
    expect(countryNameToFlag("Atlantis")).toBe("");
    expect(countryNameToFlag("")).toBe("");
    expect(countryNameToFlag(null)).toBe("");
  });
});

describe("countryNameToIso2", () => {
  it("resolves the same ISO code across all supported languages", () => {
    // Germany in en/fr/es/de/it → all "DE"
    ["Germany", "Allemagne", "Alemania", "Deutschland", "Germania"].forEach(function (nm) {
      expect(countryNameToIso2(nm)).toBe("DE");
    });
    // France likewise
    ["France", "Francia", "Frankreich"].forEach(function (nm) {
      expect(countryNameToIso2(nm)).toBe("FR");
    });
  });
  it("is accent- and case-insensitive + honours aliases", () => {
    expect(countryNameToIso2("SUISSE")).toBe("CH");
    expect(countryNameToIso2("suede")).toBe("SE");
    expect(countryNameToIso2("USA")).toBe("US");
    expect(countryNameToIso2("Türkiye")).toBe("TR");
  });
  it("returns '' for unknown / empty", () => {
    expect(countryNameToIso2("Atlantis")).toBe("");
    expect(countryNameToIso2("")).toBe("");
    expect(countryNameToIso2(null)).toBe("");
  });
});

describe("iso2ToCountryName", () => {
  it("renders the country name in the requested UI language", () => {
    expect(iso2ToCountryName("FR", "de")).toBe("Frankreich");
    expect(iso2ToCountryName("FR", "fr")).toBe("France");
    expect(iso2ToCountryName("FR", "es")).toBe("Francia");
    expect(iso2ToCountryName("FR", "it")).toBe("Francia");
    expect(iso2ToCountryName("FR", "pt")).toBe("França");
    expect(iso2ToCountryName("FR", "en")).toBe("France");
    expect(iso2ToCountryName("de", "de")).toBe("Deutschland"); // lowercase code ok
    expect(iso2ToCountryName("CH", "it")).toBe("Svizzera");
  });
  it("falls back to English for an unknown/absent lang", () => {
    expect(iso2ToCountryName("US", "pseudo")).toBe("United States");
    expect(iso2ToCountryName("US")).toBe("United States");
  });
  it("returns '' for an unknown ISO code", () => {
    expect(iso2ToCountryName("ZZ", "de")).toBe("");
    expect(iso2ToCountryName("", "de")).toBe("");
    expect(iso2ToCountryName(null, "de")).toBe("");
  });
  it("every shipped UI language has a country column — the silent-fallback gate", () => {
    // The country table is the SEVENTH per-language site of the class that
    // produced LANG_ASSETS, and it fails the same way: a language
    // with no column silently reads English, and a place name captured in that
    // language resolves to no ISO code — so the Stats "Pays" chart splits the
    // same country into a second row instead of summing it. A column is not
    // scalar data, so it cannot live in LANG_ASSETS; this is its gate instead.
    for (const { code } of LANGUAGES) {
      expect(iso2ToCountryName("DE", code), `no country column for "${code}"`)
        .not.toBe(code === "en" ? "" : "Germany");
      // and the reverse direction, which is what the aggregation keys on
      expect(countryNameToIso2(iso2ToCountryName("DE", code)), `"${code}" name does not resolve back`)
        .toBe("DE");
    }
  });

  it("round-trips with countryNameToIso2 across languages", () => {
    // A French-captured "France" → ISO → localised German name.
    const iso = countryNameToIso2("France");
    expect(iso2ToCountryName(iso, "de")).toBe("Frankreich");
  });
});
