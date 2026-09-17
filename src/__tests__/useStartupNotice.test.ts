import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  parseNoticeForLang,
  useStartupNotice,
  NOTICE_SEEN_KEY,
  audienceMatches,
} from "../hooks/useStartupNotice";
import { readFileSync } from "node:fs";

// ── parseNoticeForLang (pure) ─────────────────────────────────────────────────

describe("parseNoticeForLang", () => {
  it("returns null on empty / undefined / non-object input", () => {
    expect(parseNoticeForLang(null, "fr")).toBeNull();
    expect(parseNoticeForLang(undefined, "fr")).toBeNull();
    expect(parseNoticeForLang("string", "fr")).toBeNull();
    expect(parseNoticeForLang(42, "fr")).toBeNull();
    expect(parseNoticeForLang({}, "fr")).toBeNull();
  });

  it("returns null when id is missing or empty", () => {
    expect(parseNoticeForLang({ fr: { body: "hi" } }, "fr")).toBeNull();
    expect(parseNoticeForLang({ id: "", fr: { body: "hi" } }, "fr")).toBeNull();
    expect(parseNoticeForLang({ id: "   ", fr: { body: "hi" } }, "fr")).toBeNull();
  });

  it("returns null when both fr and en are missing or empty", () => {
    expect(parseNoticeForLang({ id: "x" }, "fr")).toBeNull();
    expect(parseNoticeForLang({ id: "x", fr: {}, en: {} }, "fr")).toBeNull();
    expect(parseNoticeForLang({ id: "x", fr: { title: "" }, en: { body: "  " } }, "fr")).toBeNull();
  });

  it("picks the matching language slot", () => {
    const raw = {
      id: "abc",
      fr: { title: "Bonjour", body: "Salut" },
      en: { title: "Hello", body: "Hi" },
    };
    expect(parseNoticeForLang(raw, "fr")).toEqual({
      id: "abc",
      tone: "info",
      title: "Bonjour",
      body: "Salut",
    });
    expect(parseNoticeForLang(raw, "en")).toEqual({
      id: "abc",
      tone: "info",
      title: "Hello",
      body: "Hi",
    });
  });

  it("falls back to the other language when the requested slot is empty", () => {
    const raw = { id: "abc", fr: { title: "Bonjour", body: "Salut" } };
    const parsed = parseNoticeForLang(raw, "en");
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("Bonjour");
  });

  it("resolves the es/de/it slot when present", () => {
    const raw = {
      id: "abc",
      fr: { title: "Bonjour" }, en: { title: "Hello" },
      es: { title: "Hola" }, de: { title: "Hallo" }, it: { title: "Ciao" },
    };
    expect(parseNoticeForLang(raw, "es")!.title).toBe("Hola");
    expect(parseNoticeForLang(raw, "de")!.title).toBe("Hallo");
    expect(parseNoticeForLang(raw, "it")!.title).toBe("Ciao");
  });

  it("es/de/it fall back to en then fr when their slot is absent", () => {
    // en present, fr present, no es → es resolves to en (not fr)
    const rawEn = { id: "a", fr: { title: "Bonjour" }, en: { title: "Hello" } };
    expect(parseNoticeForLang(rawEn, "de")!.title).toBe("Hello");
    // only fr present → de resolves to fr
    const rawFr = { id: "b", fr: { title: "Bonjour" } };
    expect(parseNoticeForLang(rawFr, "it")!.title).toBe("Bonjour");
  });

  it("accepts info / success / warn / error tones", () => {
    const base = { id: "x", fr: { body: "hi" } };
    expect(parseNoticeForLang({ ...base, tone: "info" }, "fr")!.tone).toBe("info");
    expect(parseNoticeForLang({ ...base, tone: "success" }, "fr")!.tone).toBe("success");
    expect(parseNoticeForLang({ ...base, tone: "warn" }, "fr")!.tone).toBe("warn");
    expect(parseNoticeForLang({ ...base, tone: "error" }, "fr")!.tone).toBe("error");
  });

  it("falls back to info on an unknown tone", () => {
    const raw = { id: "x", tone: "nuclear", fr: { body: "hi" } };
    expect(parseNoticeForLang(raw, "fr")!.tone).toBe("info");
  });

  it("returns null when expiresAt is in the past", () => {
    const raw = { id: "x", expiresAt: "2020-01-01T00:00:00Z", fr: { body: "hi" } };
    expect(parseNoticeForLang(raw, "fr")).toBeNull();
  });

  it("returns the notice when expiresAt is in the future", () => {
    const raw = { id: "x", expiresAt: "2999-01-01T00:00:00Z", fr: { body: "hi" } };
    expect(parseNoticeForLang(raw, "fr")).not.toBeNull();
  });

  it("ignores a malformed expiresAt and still shows the notice", () => {
    const raw = { id: "x", expiresAt: "not-a-date", fr: { body: "hi" } };
    expect(parseNoticeForLang(raw, "fr")).not.toBeNull();
  });

  it("trims whitespace from title and body", () => {
    const raw = { id: "x", fr: { title: "  Hi  ", body: "  hello world  " } };
    const parsed = parseNoticeForLang(raw, "fr")!;
    expect(parsed.title).toBe("Hi");
    expect(parsed.body).toBe("hello world");
  });
});

// ── useStartupNotice hook ─────────────────────────────────────────────────────

describe("useStartupNotice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(payload: any, ok = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok,
          json: () => Promise.resolve(payload),
        }),
      ),
    );
  }

  it("renders nothing for an empty notice.json", async () => {
    mockFetch({});
    const { result } = renderHook(() => useStartupNotice("fr"));
    await waitFor(() => {
      expect(result.current.notice).toBeNull();
    });
  });

  it("surfaces a fresh notice", async () => {
    mockFetch({
      id: "2026-06-12",
      tone: "warn",
      fr: { title: "Avis", body: "Bonjour" },
    });
    const { result } = renderHook(() => useStartupNotice("fr"));
    await waitFor(() => {
      expect(result.current.notice).not.toBeNull();
    });
    expect(result.current.notice!.id).toBe("2026-06-12");
    expect(result.current.notice!.tone).toBe("warn");
    expect(result.current.notice!.title).toBe("Avis");
    expect(result.current.notice!.body).toBe("Bonjour");
  });

  it("does NOT show a notice the user has already dismissed", async () => {
    localStorage.setItem(NOTICE_SEEN_KEY, "2026-06-12");
    mockFetch({
      id: "2026-06-12",
      fr: { body: "Bonjour" },
    });
    const { result } = renderHook(() => useStartupNotice("fr"));
    // Give the microtask queue a chance to drain
    await new Promise(r => setTimeout(r, 10));
    expect(result.current.notice).toBeNull();
  });

  it("DOES show a notice when the dismissed id differs from the current one", async () => {
    localStorage.setItem(NOTICE_SEEN_KEY, "old-id");
    mockFetch({
      id: "new-id",
      fr: { body: "Bonjour" },
    });
    const { result } = renderHook(() => useStartupNotice("fr"));
    await waitFor(() => {
      expect(result.current.notice).not.toBeNull();
    });
    expect(result.current.notice!.id).toBe("new-id");
  });

  it("dismiss() persists the id and hides the notice", async () => {
    mockFetch({
      id: "abc",
      fr: { body: "Bonjour" },
    });
    const { result } = renderHook(() => useStartupNotice("fr"));
    await waitFor(() => {
      expect(result.current.notice).not.toBeNull();
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.notice).toBeNull();
    expect(localStorage.getItem(NOTICE_SEEN_KEY)).toBe("abc");
  });

  it("silently swallows fetch failures (no banner, no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const { result } = renderHook(() => useStartupNotice("fr"));
    await new Promise(r => setTimeout(r, 10));
    expect(result.current.notice).toBeNull();
  });

  it("silently swallows non-OK HTTP responses", async () => {
    mockFetch({}, false);
    const { result } = renderHook(() => useStartupNotice("fr"));
    await new Promise(r => setTimeout(r, 10));
    expect(result.current.notice).toBeNull();
  });

  it("uses a cache-busting query string so the SW bypass triggers", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    renderHook(() => useStartupNotice("fr"));
    await new Promise(r => setTimeout(r, 10));
    expect(fetchSpy).toHaveBeenCalled();
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, ...unknown[]];
    const url = firstCall[0];
    expect(url).toContain("notice.json");
    expect(url).toContain("?_v=");
  });
});

/**
 * LE PUBLIC D'UN AVIS — écrit pour un cas réel, pas pour la généralité.
 *
 * `apple-mobile-web-app-status-bar-style` est lue AU MOMENT où l'app est
 * ajoutée à l'écran d'accueil, pas au chargement. MESURÉ sur l'iPad de
 * l'utilisateur : build 20 affiché, Safari NET, app installée TROUBLE, jamais
 * réinstallée. Une installation antérieure au build 16 garde donc le voile, et
 * AUCUN bump ne peut rien y faire — une mise à jour est un rechargement, et ce
 * rechargement a déjà eu lieu. Il faut le dire à ces utilisateurs-là, et
 * SEULEMENT à eux : une installation neuve reçoit le bon réglage d'emblée.
 */
describe("audienceMatches", () => {
  const ios = { iosStandalone: true, installPreexisted: true };
  const neuf = { iosStandalone: true, installPreexisted: false };
  const navigateur = { iosStandalone: false, installPreexisted: true };

  it("sans public, l'avis s'adresse à tout le monde (comportement d'avant)", () => {
    for (const env of [ios, neuf, navigateur]) {
      expect(audienceMatches(undefined, env)).toBe(true);
      expect(audienceMatches({}, env)).toBe(true);
    }
  });

  it("iosStandalone écarte le navigateur, pas l'app installée", () => {
    expect(audienceMatches({ iosStandalone: true }, ios)).toBe(true);
    expect(audienceMatches({ iosStandalone: true }, navigateur)).toBe(false);
  });

  it("existingInstallOnly écarte une installation NEUVE — elle n'a pas le défaut", () => {
    expect(audienceMatches({ existingInstallOnly: true }, ios)).toBe(true);
    expect(audienceMatches({ existingInstallOnly: true }, neuf)).toBe(false);
  });

  it("les deux ensemble : le seul public visé est l'installation iOS préexistante", () => {
    const a = { iosStandalone: true, existingInstallOnly: true };
    expect(audienceMatches(a, ios)).toBe(true);
    expect(audienceMatches(a, neuf)).toBe(false);
    expect(audienceMatches(a, navigateur)).toBe(false);
    expect(audienceMatches(a, { iosStandalone: false, installPreexisted: false })).toBe(false);
  });

  it("`false` explicite ne restreint rien — seul `true` filtre", () => {
    // Un champ à false dit « je ne me prononce pas », pas « l'inverse ».
    expect(audienceMatches({ iosStandalone: false }, navigateur)).toBe(true);
  });

  it("l'avis RÉEL de public/notice.json vise bien ce public (non-vacuité)", () => {
    // Sans ceci, la garde ci-dessus vérifierait une fonction que le fichier
    // livré n'utilise pas.
    const n = JSON.parse(readFileSync("public/notice.json", "utf8"));
    expect(n.audience, "l'avis livré doit cibler").toBeTruthy();
    expect(audienceMatches(n.audience, ios)).toBe(true);
    expect(audienceMatches(n.audience, neuf)).toBe(false);
    expect(audienceMatches(n.audience, navigateur)).toBe(false);
    // et il parle les six langues
    for (const code of ["fr", "en", "es", "de", "it", "pt"]) {
      expect(n[code] && n[code].title && n[code].body, `slot ${code}`).toBeTruthy();
    }
    // LA CONSIGNE DE SAUVEGARDE EST LA PREMIÈRE ÉTAPE, et la garde porte sur
    // CETTE ligne-là. Première version : un `toMatch(/[Ss]auvegard/)` sur tout
    // le corps — SONDÉ, il restait VERT après avoir remplacé « Sauvegardez
    // d'abord » par « Allez-y », parce que le texte mentionne la sauvegarde une
    // SECONDE fois plus bas. Une garde satisfaite par la prose qui l'entoure ne
    // garde rien. Ce qui compte n'est pas que le mot figure, c'est que le
    // PREMIER geste demandé soit de sauvegarder : il n'est pas garanti que
    // retirer l'icône préserve les données.
    const etape1 = (body: string) =>
      String(body).split("\n").find((l) => l.trim().startsWith("1.")) || "";
    expect(etape1(n.fr.body), "étape 1 fr").toMatch(/[Ss]auvegard/);
    expect(etape1(n.en.body), "étape 1 en").toMatch(/[Bb]ack up/);
    expect(etape1(n.es.body), "étape 1 es").toMatch(/copia de seguridad/i);
    expect(etape1(n.de.body), "étape 1 de").toMatch(/[Ss]ichern/);
    expect(etape1(n.it.body), "étape 1 it").toMatch(/backup/i);
    expect(etape1(n.pt.body), "étape 1 pt").toMatch(/c[óo]pia de seguran/i);
  });

  // UN CHEMIN CITÉ DOIT EXISTER DANS LA LANGUE OÙ IL EST CITÉ.
  //
  // La première version de cet avis disait « Réglages → Données ». MESURÉ
  // ensuite : aucune section ne s'appelle ainsi — c'est « ☁️ Sauvegarde
  // cloud » et « Export & Import ». Un utilisateur qui suit une consigne
  // d'urgence cherchait donc un écran inexistant, et rien dans le dépôt ne
  // pouvait le signaler : le texte vit dans un JSON, les libellés dans les
  // dictionnaires, et les deux ne se parlaient pas.
  //
  // Cette garde les fait se parler. Elle ne juge pas la prose — elle vérifie
  // que les libellés CITÉS sont ceux que l'app affiche DANS CETTE LANGUE,
  // donc elle rougit aussi bien si l'avis invente un chemin que si un
  // renommage de section laisse l'avis derrière lui.
  it("les chemins cités dans l'avis existent dans le dictionnaire de leur langue", () => {
    const n = JSON.parse(readFileSync("public/notice.json", "utf8"));
    const CITES = [
      // L'ONGLET, ET IL EST EN PREMIER PARCE QUE C'EST LUI QUI A MANQUÉ.
      // Les Réglages ont quatre onglets (tab_data / tab_prefs / tab_app /
      // tab_help) et l'engrenage de l'accueil ouvre sur « prefs » — VÉRIFIÉ
      // ligne 604 de HomeViewV2. Or les trois sections citées ci-dessous
      // vivent toutes sous `activeTab === "data"` (lignes 189, 711, 811 de
      // SettingsModal). Un avis qui dit « touchez l'engrenage puis la section
      // ☁️ Sauvegarde cloud » envoie donc l'utilisateur sur un onglet où elle
      // n'est pas. Nommer des sections vraies ne suffit pas : c'est le CHEMIN
      // qui doit être complet.
      "tab_data",
      "sec_cloud", "sec_export_import", "btn_export_json",
      // LE CATALOGUE EST UN AUTRE STOCKAGE, donc une autre sauvegarde.
      // Il vit dans sa PROPRE base IndexedDB (`cave-catalogue`, voir
      // utils/catalogueStore.ts) et son propre flux cloud : un export JSON de
      // la cave ne le contient pas. Un avis qui dit « sauvegardez » sans le
      // nommer laisserait l'utilisateur supprimer l'app en croyant tout tenir.
      "sec_catalogue", "cat_cloud_save", "cat_cloud_restore", "btn_cat_export",
    ];
    let verifies = 0;
    for (const code of ["fr", "en", "es", "de", "it", "pt"]) {
      const dico = readFileSync(`src/i18n/${code}.ts`, "utf8");
      const body = String(n[code].body);
      for (const cle of CITES) {
        const m = dico.match(new RegExp(`\\b${cle}: *"([^"]*)"`));
        expect(m, `${cle} introuvable dans src/i18n/${code}.ts`).toBeTruthy();
        const libelle = m![1]!;
        expect(body, `${code} doit citer ${cle} = « ${libelle} »`).toContain(libelle);
        verifies++;
      }
    }
    // Non-vacuité : une boucle qui ne tourne pas est verte pour rien.
    expect(verifies).toBe(48);
  });

  // L'AVIS AFFIRME UN ITINÉRAIRE ; CELUI-CI LE TIENT AU CODE.
  //
  // Il dit « touchez l'icône ☁️ en haut de l'accueil : elle ouvre directement
  // l'onglet Données ». C'est vrai aujourd'hui — l'IconBtn "cloud" de
  // HomeViewV2 appelle setSettingsTab("data") — et rien d'autre ne le garantit
  // demain. La garde des libellés ci-dessus ne peut pas le voir : elle vérifie
  // que « Données » est CITÉ, pas que le bouton y mène.
  //
  // C'EST EXACTEMENT LE DÉFAUT QUI VIENT D'ÊTRE COMMIS. L'avis avait été
  // réécrit autour de l'ENGRENAGE, dont les sections nommées ne dépendent pas :
  // il ouvre sur « prefs », où aucune d'elles ne figure. Des noms exacts au
  // bout d'un itinéraire faux restent un itinéraire faux ; une porte qui ne
  // regarde que les noms laisse passer précisément ça.
  it("l'icône nuage de l'accueil mène bien à l'onglet que l'avis nomme", () => {
    const home = readFileSync("src/views/curator/HomeViewV2.tsx", "utf8");
    const i = home.indexOf('icon="cloud"');
    expect(i, "l'IconBtn nuage doit exister sur l'accueil").toBeGreaterThan(-1);
    // Tranché vers l'AVANT sur ce qui SUIT l'ancre — un regex à travers la
    // balise s'arrête au premier `>` d'une lambda (la leçon de CatalogView).
    const bouton = home.slice(i, i + 400);
    expect(bouton, "le nuage doit ouvrir l'onglet des sauvegardes")
      .toContain('setSettingsTab("data")');
    // Non-vacuité : une tranche tronquée pourrait contenir l'appel par hasard
    // sans être le bouton ; on exige qu'elle porte aussi son libellé.
    expect(bouton, "la tranche doit bien être CE bouton").toContain("sec_cloud");
  });

  // « ON NE PEUT PAS SCROLLER », rapporté depuis un iPhone, capture à l'appui.
  //
  // MESURÉ dans Chromium à 390×664 (UA iPhone, navigator.standalone), avec
  // l'avis réel : le panneau faisait 1328 px pour une fenêtre de 664, son haut
  // était à −328 et son bas à 1000 — coupé DES DEUX CÔTÉS — le fond n'offrait
  // que 360 px de défilement pour 664 px de débordement, et le bouton « C'est
  // noté » n'était pas visible. Le mécanisme : le fond de `Modal` porte
  // `overflowY:auto` ET `alignItems:center`, or un conteneur qui défile ne peut
  // pas atteindre ce qui déborde AVANT son origine. Le centrage perd le haut.
  //
  // Après `capHeight` + région interne : panneau 609 px, rien de coupé, 751 px
  // de défilement DANS la modale, bouton visible, début du texte atteignable.
  //
  // La garde est STRUCTURELLE parce que jsdom ne fait pas de mise en page —
  // elle ne peut pas re-mesurer, elle peut empêcher la forme de repartir. Même
  // forme que « scrolls INSIDE the modal » dans CatalogView.test.tsx.
  it("la modale d'avis borne sa hauteur et défile en interne", () => {
    const src = readFileSync("src/views/curator/StartupNoticeModal.tsx", "utf8");
    // Tranché plutôt que regexé à travers la balise : elle contient des
    // accolades JSX, et un `[^>]*` s'arrête au premier `>` venu.
    const openTag = src.slice(src.indexOf("<Modal"), src.indexOf("ariaLabel={heading}"));
    expect(openTag, "le panneau doit borner sa hauteur").toContain("capHeight");
    expect(src, "la région interne possède le défilement")
      .toMatch(/flex:\s*1,\s*minHeight:\s*0,\s*overflowY:\s*"auto"/);
    expect(src, "le défilement ne doit pas se propager à la page derrière")
      .toContain('overscrollBehavior: "contain"');
    // Un `vh` ne connaît pas le rembourrage du fond — c'est la supposition que
    // `capHeight` remplace.
    expect(src, "une supposition en vh ne peut pas connaître le fond")
      .not.toMatch(/maxHeight:\s*"\d+vh"/);
  });
});
