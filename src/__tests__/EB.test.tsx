// EB (Error Boundary) — chunk-load error detection &
// auto-recovery. Locks the three branches added on top of the legacy
// "Erreur de rendu" fallback:
//   1. unrelated error  → original render-error UI
//   2. chunk-load error, first hit within 30 s window  → "Recovering…"
//   3. chunk-load error, second hit within 30 s window  → manual
//      "Clear cache and reload" UI (auto-recovery suppressed)

import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EB } from "../App.tsx";

// Stub the harsh side effects so the auto-recovery branch can run
// without actually reloading jsdom or wiping anything real.
beforeEach(() => {
  localStorage.clear();
  // Spy on console.error so React's "uncaught error" noise doesn't
  // pollute the test output.
  vi.spyOn(console, "error").mockImplementation(() => {});
  // jsdom has no caches API and no SW registration — the recovery
  // path silently no-ops, then calls location.reload(). Patch
  // reload so it doesn't throw "not implemented".
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
  // Par défaut, l'app est JOIGNABLE. La purge sonde désormais le réseau avant
  // de supprimer quoi que ce soit (« en ligne » ≠ « joignable » — voir le bloc
  // du bas), et sans cette réponse jsdom n'a pas de `fetch` du tout : chaque
  // cas historique se retrouverait dans la branche « refus », c'est-à-dire à
  // mesurer autre chose que ce qu'il dit mesurer.
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true, status: 200,
    text: async () => '<!doctype html><div id="root"></div>',
  }));
});

function ThrowOnRender({ error }: { error: any }): null {
  throw error;
}

describe("EB — render error fallback (legacy branch)", () => {
  it("renders the generic render-error UI for an unrelated error", () => {
    const err = new Error("Something broke in a view");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    // ENGLISH with no cave-lang (it was French once). English is the only
    // compiled-in dictionary and the app's stated fallback,
    // so the boundary must agree with App.tsx rather than keep the old "fr".
    expect(screen.getByText(/Render error/i)).toBeTruthy();
    expect(screen.getByText(/Something broke in a view/i)).toBeTruthy();
    // No chunk-flag was written.
    expect(localStorage.getItem("cave-eb-recovery-ts")).toBeNull();
  });

  it("falls back to ENGLISH — not French — when the active dictionary is absent", () => {
    // The case the boundary exists for: a chunk failed to load, so `LANG[lang]`
    // is missing. Earlier the fallback was `LANG.fr`, itself undefined since
    // The string table collapsed to {} and every label dropped to a
    // hardcoded FRENCH literal, shown to a German user.
    localStorage.setItem("cave-lang", "zz");
    render(
      <EB>
        <ThrowOnRender error={new Error("boom")} />
      </EB>
    );
    expect(screen.getByText(/Render error/i)).toBeTruthy();
    expect(screen.queryByText(/Erreur de rendu/i)).toBeNull();
  });
});

describe("EB — chunk load error auto-recovery", () => {
  it("detects 'Importing a module script failed' and shows the recovering UI", async () => {
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    expect(screen.getByText(/Passage à la dernière version|Switching to the latest/i)).toBeTruthy();
    // Flag was written for anti-loop (in componentDidCatch).
    expect(localStorage.getItem("cave-eb-recovery-ts")).not.toBeNull();
    // Recovery side-effect: location.reload was dispatched.
    // MAINTENANT ASYNCHRONE, et c'est un durcissement, pas un affaiblissement :
    // la purge sonde le réseau avant de supprimer, donc le rechargement arrive
    // après un aller-retour `fetch` au lieu d'un microtask. L'assertion est la
    // même ; seule l'attente a changé.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("detects 'Failed to fetch dynamically imported module' likewise", () => {
    const err = new TypeError("Failed to fetch dynamically imported module: https://x/y.js");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    expect(screen.getByText(/Passage à la dernière version|Switching to the latest/i)).toBeTruthy();
  });

  it("suppresses auto-recovery and shows manual UI when a recent flag exists", () => {
    // Simulate a previous purge-and-reload that already happened 10s ago.
    localStorage.setItem("cave-eb-recovery-ts", String(Date.now() - 10_000));
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    // No "recovering" — instead the explicit retry button is offered.
    expect(screen.queryByText(/Passage à la dernière version|Switching to the latest/i)).toBeNull();
    expect(screen.getByText(/Mise à jour incomplète|Update incomplete/i)).toBeTruthy();
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("re-arms auto-recovery once the flag is older than 30 s", () => {
    // Old flag — well past the anti-loop window.
    localStorage.setItem("cave-eb-recovery-ts", String(Date.now() - 60_000));
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    expect(screen.getByText(/Passage à la dernière version|Switching to the latest/i)).toBeTruthy();
    // Flag was refreshed by componentDidCatch — within the last 2 s.
    const fresh = parseInt(localStorage.getItem("cave-eb-recovery-ts") || "0", 10);
    expect(Date.now() - fresh).toBeLessThan(2_000);
  });

  // A FUTURE stamp (clock corrected backward /
  // forged) must NOT permanently pin the manual screen — earlier `Date.now() -
  // last` was negative, so `>= 30000` was false → recovering stayed false
  // forever. Now an invalid/future stamp is treated as "no recent recovery".
  it("re-arms auto-recovery when the flag is in the FUTURE (clock skew)", () => {
    localStorage.setItem("cave-eb-recovery-ts", String(Date.now() + 60 * 60 * 1000));
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    expect(screen.getByText(/Passage à la dernière version|Switching to the latest/i)).toBeTruthy();
  });

  it("re-arms auto-recovery when the flag is non-numeric garbage", () => {
    localStorage.setItem("cave-eb-recovery-ts", "not-a-number");
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    expect(screen.getByText(/Passage à la dernière version|Switching to the latest/i)).toBeTruthy();
  });
});

describe("EB — manual retry button", () => {
  it("invokes purgeCachesAndReload via location.reload when clicked", async () => {
    localStorage.setItem("cave-eb-recovery-ts", String(Date.now() - 10_000));
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    const btn = screen.getByRole("button");
    await act(async () => {
      btn.click();
      // Deux microtasks ne suffisent plus : la chaîne comprend maintenant un
      // `fetch` de sonde ET la lecture de son corps. Un tour de boucle
      // d'événements couvre les deux.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(window.location.reload).toHaveBeenCalled();
  });
});

// ── offline must never destroy the installed app ─────────────────

describe("EB — a chunk miss while OFFLINE does not purge", () => {
  // AUDIT HIGH. The recovery is triggered by a failed dynamic import, and
  // offline a lazy chunk the user has never opened fails exactly that way (the
  // SW returns 503 on a cache miss it cannot fetch). So tapping an unvisited
  // tab on a plane deleted every Cache Storage entry and every SW registration,
  // then reloaded with no network to refill them — the working offline app,
  // gone, unbootable until connectivity returns. The identical guard already
  // existed at the sibling call site.
  const chunkErr = new Error("Importing a module script failed.");

  function offline(v: boolean) {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => !v });
  }
  afterEach(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true }); });

  it("does not claim to be recovering when offline", () => {
    offline(true);
    localStorage.removeItem("cave-eb-recovery-ts");
    expect(EB.getDerivedStateFromError(chunkErr).recovering).toBe(false);
  });

  it("still auto-recovers when online", () => {
    offline(false);
    localStorage.removeItem("cave-eb-recovery-ts");
    expect(EB.getDerivedStateFromError(chunkErr).recovering).toBe(true);
  });
});

// ── « en ligne » n'est pas « joignable » ──────────────────────────────────
//
// MESURÉ dans Chromium, serveur coupé, interface réseau debout :
//
//   avant le tap : {sw:1, caches:1, onLine:true, root:1}
//   après le tap : {sw:-1, caches:-1, root:-1, url:"chrome-error://chromewebdata/"}
//   texte à l'écran : « This site can't be reached — ERR_CONNECTION_REFUSED »
//
// La garde existante est `navigator.onLine === false`, et `onLine` dit
// seulement qu'une INTERFACE existe — pas que le site répond. Un portail
// captif (hôtel, aéroport, train), une radio mobile sans données, un échec DNS,
// un pare-feu d'entreprise, une fenêtre de déploiement : dans tous ces cas
// `onLine` vaut `true`, la garde laisse passer, et l'app détruit sa propre
// copie hors-ligne pour se recharger dans le vide.
//
// La page sœur `reset.html` a EXACTEMENT cette garde renforcée, et son
// commentaire énumère ces mêmes cas — c'est le manque-au-voisin, une fois de
// plus, dans l'autre sens.
//
// L'asymétrie qui tranche, elle aussi déjà écrite sur `reset.html` : une sonde
// qui échoue à tort coûte un tap et ne supprime RIEN ; une sonde qui passe à
// tort laisse l'utilisateur sans application. Elle penche donc vers le refus.

describe("EB — « en ligne » ne suffit pas : le site doit être JOIGNABLE", () => {
  const chunkErr = new Error("Importing a module script failed.");
  let fetchMock: any;

  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    // jsdom n'a ni caches ni SW : on les pose pour pouvoir COMPTER les purges.
    (globalThis as any).caches = {
      keys: vi.fn(async () => ["cave-tabac-v1-0-1"]),
      delete: vi.fn(async () => true),
      open: vi.fn(async () => ({ keys: async () => [], put: async () => {} })),
    };
    (navigator as any).serviceWorker = {
      getRegistrations: vi.fn(async () => [{ unregister: vi.fn(async () => true) }]),
    };
  });
  afterEach(() => {
    delete (globalThis as any).caches;
    delete (navigator as any).serviceWorker;
    fetchMock = null;
  });

  function probeAnswers(kind: "ok" | "refused" | "portal" | "5xx") {
    fetchMock = vi.fn(async () => {
      if (kind === "refused") throw new TypeError("Failed to fetch");
      if (kind === "5xx") return { ok: false, status: 503, text: async () => "" } as any;
      // Un portail captif répond 200 avec SA page : `res.ok` seul l'accepterait.
      if (kind === "portal") return { ok: true, status: 200, text: async () => "<html><body>Connectez-vous au wifi de l'hôtel</body></html>" } as any;
      return { ok: true, status: 200, text: async () => '<!doctype html><div id="root"></div>' } as any;
    });
    (globalThis as any).fetch = fetchMock;
  }

  async function tapAndSettle() {
    render(<EB><ThrowOnRender error={chunkErr} /></EB>);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  it("ne purge RIEN quand le serveur refuse la connexion, malgré onLine=true", async () => {
    probeAnswers("refused");
    localStorage.removeItem("cave-eb-recovery-ts");
    await tapAndSettle();
    expect((globalThis as any).caches.delete, "un cache a été supprimé alors que le site est injoignable")
      .not.toHaveBeenCalled();
    expect(window.location.reload, "l'app s'est rechargée dans le vide").not.toHaveBeenCalled();
  });

  it("ne purge RIEN derrière un portail captif (200, mais ce n'est pas l'app)", async () => {
    // Le cas que `res.ok` seul laisse passer, et la raison pour laquelle la
    // sonde lit le CORPS.
    probeAnswers("portal");
    localStorage.removeItem("cave-eb-recovery-ts");
    await tapAndSettle();
    expect((globalThis as any).caches.delete).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it("ne purge RIEN sur un 5xx (déploiement à moitié en ligne)", async () => {
    probeAnswers("5xx");
    localStorage.removeItem("cave-eb-recovery-ts");
    await tapAndSettle();
    expect((globalThis as any).caches.delete).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it("purge ET recharge quand l'app RÉPOND vraiment — la garde n'est pas un refus global", async () => {
    // Le contrepoids : sans ce cas, une sonde qui refuserait toujours passerait
    // les trois cas ci-dessus tout en cassant la récupération légitime, qui est
    // le chemin ordinaire après chaque déploiement.
    probeAnswers("ok");
    localStorage.removeItem("cave-eb-recovery-ts");
    await tapAndSettle();
    expect((globalThis as any).caches.delete).toHaveBeenCalled();
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("la sonde contourne le service worker (cache: no-store)", async () => {
    // `sw.js` retourne tôt pour une requête `no-store` (sa troisième garde),
    // donc c'est ce qui rend la réponse digne de foi : sans cela la sonde
    // serait satisfaite par le cache même qu'on s'apprête à détruire.
    probeAnswers("ok");
    localStorage.removeItem("cave-eb-recovery-ts");
    await tapAndSettle();
    expect(fetchMock).toHaveBeenCalled();
    const opts = fetchMock.mock.calls[0]![1];
    expect(opts && opts.cache, "la sonde n'est pas en no-store — le SW peut y répondre").toBe("no-store");
  });

  it("le bouton manuel DIT qu'il a refusé, au lieu de ne rien faire", async () => {
    // Un bouton qui refuse en silence est indiscernable d'un bouton cassé — et
    // cet écran n'est atteint QUE dans la situation où le refus est la bonne
    // réponse, donc le silence y serait la règle plutôt que l'exception.
    probeAnswers("refused");
    localStorage.setItem("cave-eb-recovery-ts", String(Date.now() - 10_000));
    render(<EB><ThrowOnRender error={chunkErr} /></EB>);
    const btn = screen.getByRole("button");
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect((globalThis as any).caches.delete).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(screen.getByText(/injoignable|unreachable/i),
      "le refus n'est annoncé nulle part").toBeTruthy();
  });

  it("ne dit RIEN tant que l'utilisateur n'a pas tapé — le message n'est pas décoratif", async () => {
    // Contrepoids : un message affiché d'emblée transformerait l'écran en
    // constat permanent, y compris pour la cause ordinaire (un déploiement),
    // où le bouton fonctionne parfaitement.
    probeAnswers("refused");
    localStorage.setItem("cave-eb-recovery-ts", String(Date.now() - 10_000));
    render(<EB><ThrowOnRender error={chunkErr} /></EB>);
    expect(screen.queryByText(/injoignable|unreachable/i)).toBeNull();
  });

  it("bascule sur l'écran manuel quand la purge est refusée", async () => {
    // Sinon l'utilisateur reste sur « Passage à la dernière version… » à
    // attendre un rechargement qui ne viendra jamais — la panne que le
    // commentaire de `getDerivedStateFromError` décrit déjà.
    probeAnswers("refused");
    localStorage.removeItem("cave-eb-recovery-ts");
    await tapAndSettle();
    expect(screen.getByRole("button"), "aucun bouton : l'écran manuel n'est pas affiché").toBeTruthy();
  });
});
