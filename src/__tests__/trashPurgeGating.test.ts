/**
 * The 30-day trash purge — the third sibling, and the one with no lock.
 *
 * A critical closure bug was fixed in THREE startup effects at once: the
 * orphan-photo GC, the lot-integrity probe, and this one. Each was
 * `useEffect(fn, [])` reading `data` from the mount-time closure, which is
 * the empty `INIT` shell (load() is async). Two of the three got a
 * regression lock — `imgGcGating.test.tsx` and `lotIntegrityProbeGating.test.tsx`
 * — because they had been extracted into hooks and could be mounted. This one
 * stayed inline in App.tsx and got none.
 *
 * Audited, measured rather than assumed. Four separate re-injections
 * against the full suite, all SURVIVED with 3760/3760 green:
 *   • removing `if (loading) return;`           → purge runs against INIT
 *   • reverting the dep array to `[]`           → bound to the mount snapshot
 *   • reading `data` instead of the ref         → the bug verbatim
 *   • flipping the cutoff sign to `Date.now() +`→ hard-deletes EVERY trashed
 *     row on the next launch, 30 days early, with no user action
 *
 * The last one is why this file exists rather than a TODO. The purge is the
 * only code path in the app that permanently removes user data without the
 * user asking; a sign flip there is unrecoverable and silent, and nothing in
 * 3760 tests noticed.
 *
 * App.tsx's own comment already claims "the regression test
 * (trashPurgeGating.test) locks the loading-gated form". Until this file it
 * did not exist — a cited guard that was never written, which reads as
 * verified to anyone who checks by reading.
 *
 * WHY SOURCE-LEVEL, and what that does NOT buy. The effect lives inside the
 * App component behind ~50 hooks, so mounting it to observe one setTimeout
 * would test the harness more than the wiring; the repo's established answer
 * is a source assertion (invariantWiring, navScrollGuard, iosPwaDockGuard,
 * docCheckWiring all do this). The honest limitation: this locks the SHAPE of
 * the four invariants, not their behaviour — a semantically-equivalent rewrite
 * would fail here even though it is correct, and a novel way to break the
 * purge would pass. The strong version is the extraction its two siblings got
 * (`useOrphanPhotoGC`, `useLotIntegrityProbe`), which would let the real code
 * be mounted; that is a production change and a CLAUDE.md structure entry, so
 * it is recorded here as the next step rather than taken.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as U from "../utils";

const APP_SRC = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");

// Blank comments while preserving length, so an assertion can never be
// satisfied by prose ABOUT the code — the exact case docCheckWiring relies on,
// and the one that matters most here, since App.tsx describes this effect at
// length directly above it.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

// The effect, from its refs down to and including its dependency array.
function extractPurgeEffect(src: string): string | null {
  const start = src.indexOf("var trashPurgeRanRef");
  if (start < 0) return null;
  const tail = src.slice(start);
  const endM = tail.match(/\n {2}\}, \[[^\]]*\]\);/);
  if (!endM) return null;
  return tail.slice(0, (endM.index as number) + endM[0].length);
}

const EFFECT = extractPurgeEffect(APP_SRC);
const BODY = EFFECT === null ? "" : stripComments(EFFECT);

describe("startup trash purge — the gating invariants", () => {
  it("App.tsx still contains the purge effect this guard inspects", () => {
    // Guards the guard: a rename or an extraction into a hook must fail HERE,
    // loudly, rather than turn every assertion below into a vacuous pass.
    expect(EFFECT).not.toBeNull();
    expect(BODY).toMatch(/sweepExpiredTrash\s*\(/);
  });

  it("is gated on loading === false, so it never runs against the INIT shell", () => {
    // Without this the purge fires during load(), sees an empty cellar, and
    // `changed` is always false — the 30-day retention silently never runs
    // (the symptom: soft-deleted rows lived forever in every backup).
    expect(BODY).toMatch(/if\s*\(\s*loading\s*\)\s*return\s*;/);
  });

  it("depends on [loading] — never [] , which binds it to the mount snapshot", () => {
    const dep = BODY.match(/\n {2}\}, \[([^\]]*)\]\);/);
    expect(dep).not.toBeNull();
    expect(dep![1]!.trim()).toBe("loading");
  });

  it("reads the LATEST data through the ref, not the effect's closure", () => {
    expect(BODY).toMatch(/sweepExpiredTrash\s*\(\s*trashPurgeDataRef\.current/);
    // And the ref is actually kept current on every render.
    expect(stripComments(APP_SRC)).toMatch(
      /useEffect\s*\(\s*function\s*\(\)\s*\{\s*trashPurgeDataRef\.current\s*=\s*data;\s*\}\s*\)\s*;/,
    );
  });

  it("computes the cutoff in the PAST — a sign flip would purge everything", () => {
    // `<horloge> + retention` makes every trashed row "older than the cutoff",
    // so the next launch hard-deletes the entire trash 30 days early. This is
    // the only unprompted permanent deletion in the app.
    //
    // REPOINTÉ, et le renversement est consigné ici plutôt que dans un commit.
    // Ce cas épinglait `Date.now() - TRASH_RETENTION_DAYS`, et il a ROUGI le
    // jour où l'horloge du balayage est devenue bornée — c'est-à-dire que la
    // vérification du câblage a fonctionné. Ce qu'il protège est le SIGNE, pas
    // la provenance de l'horloge : la coupure doit être DANS LE PASSÉ. Cette
    // propriété est intacte ; seule la source a changé, et elle a désormais ses
    // propres cas plus bas. Ne pas le ramener sur `Date.now()` : ce serait
    // ré-exiger l'horloge nue que le correctif retire.
    const line = BODY.split("\n").find((l) => /cutoffMs\s*=/.test(l));
    expect(line).toBeTruthy();
    expect(line!).toMatch(/-\s*TRASH_RETENTION_DAYS/);
    expect(line!).not.toMatch(/\+\s*TRASH_RETENTION_DAYS/);
  });

  it("saves only when the sweep actually changed something", () => {
    // An unconditional save() would rewrite localStorage on every launch and,
    // worse, persist a payload the sweep never touched.
    expect(BODY).toMatch(/if\s*\(\s*res\.changed\s*\)\s*save\s*\(\s*res\.next\s*\)/);
  });

  it("runs once — the ran-ref guard survives a later loading toggle", () => {
    expect(BODY).toMatch(/if\s*\(\s*trashPurgeRanRef\.current\s*\)\s*return\s*;/);
    expect(BODY).toMatch(/trashPurgeRanRef\.current\s*=\s*true\s*;/);
  });

  it("clears its timer on unmount", () => {
    expect(BODY).toMatch(/clearTimeout\s*\(/);
  });
});

describe("the two sibling startup effects keep their own gates", () => {
  // Stated here as well as in their own files because the three were ONE bug
  // and are only ever re-broken as a set: whoever "simplifies" one dep array
  // reaches for the others in the same pass.
  const GC_SRC = stripComments(
    fs.readFileSync(path.resolve(__dirname, "../hooks/useOrphanPhotoGC.ts"), "utf8"),
  );
  const PROBE_SRC = stripComments(
    fs.readFileSync(path.resolve(__dirname, "../hooks/useLotIntegrityProbe.ts"), "utf8"),
  );

  it("useOrphanPhotoGC is loading-gated and keyed on [loading]", () => {
    expect(GC_SRC).toMatch(/if\s*\(\s*loading\s*\)\s*return\s*;/);
    expect(GC_SRC).toMatch(/\}, \[loading\]\);/);
  });

  it("useLotIntegrityProbe is loading-gated and keyed on [loading]", () => {
    expect(PROBE_SRC).toMatch(/if\s*\(\s*loading\s*\)\s*return\s*;/);
    expect(PROBE_SRC).toMatch(/\}, \[loading\]\);/);
  });
});

/**
 * L'HORLOGE DU BALAYAGE EST BORNÉE, ET C'EST UN CHOIX PLUTÔT QU'UNE DÉTECTION.
 *
 * Le défaut est resté écrit dans CLAUDE.md — « DISCLOSED AND NOT FIXED » — parce
 * que le garde évident est faux : refuser de balayer quand la coupure dépasse
 * tous les tampons casserait l'utilisateur qui n'a simplement pas ouvert l'app
 * depuis deux mois. AUCUNE donnée locale ne sépare ce cas d'une horloge en
 * avance : les deux mettent `Date.now()` loin devant chaque tampon.
 *
 * Donc on ne distingue pas, on BORNE — voir le bloc au-dessus de
 * `TRASH_RETENTION_DAYS` (constants.ts). Ce qui est verrouillé ici est la
 * PROPRIÉTÉ qui compte : une ligne supprimée depuis le lancement précédent ne
 * peut pas être purgée par un saut d'horloge.
 */
describe("trustedSweepNow — borner sans prétendre détecter", () => {
  const DAY = 24 * 3600 * 1000;
  const CAP = 30 * DAY;

  it("l'usage normal n'est pas bridé : la marque suit l'horloge", () => {
    // Le cas de LOIN le plus fréquent, épinglé en premier : quiconque ouvre
    // l'app plus souvent qu'une fois par mois doit voir un comportement
    // identique à l'octet près.
    const hier = 1_000_000_000_000;
    expect(U.trustedSweepNow(hier + DAY, hier, CAP)).toBe(hier + DAY);
    expect(U.trustedSweepNow(hier + 29 * DAY, hier, CAP)).toBe(hier + 29 * DAY);
  });

  it("LE DÉFAUT : une horloge en avance d'un an ne peut pas dépasser la marque", () => {
    const dernier = 1_000_000_000_000;
    const folle = dernier + 365 * DAY;
    const trusted = U.trustedSweepNow(folle, dernier, CAP);
    expect(trusted).toBe(dernier + CAP);
    // Ce que ça donne concrètement : la coupure ne dépasse pas le lancement
    // précédent, donc rien de supprimé DEPUIS ce lancement n'est purgeable.
    const coupure = trusted - 30 * DAY;
    expect(coupure).toBe(dernier);
    const suppriméeApres = dernier + DAY;
    expect(suppriméeApres > coupure).toBe(true);
  });

  it("une absence réelle converge, elle n'est pas bloquée", () => {
    // La moitié que le garde naïf cassait. Deux mois d'absence : le premier
    // lancement avance de la borne, le second rattrape.
    const dernier = 1_000_000_000_000;
    const now = dernier + 60 * DAY;
    const premier = U.trustedSweepNow(now, dernier, CAP);
    expect(premier).toBe(dernier + CAP);
    expect(U.trustedSweepNow(now, premier, CAP)).toBe(now);
  });

  it("une horloge qui RECULE est absorbée — la marque suit vers le bas", () => {
    // La correction NTP après un démarrage aberrant. Sans le `min`, une seule
    // mauvaise lecture resterait gravée et brimerait le balayage pour toujours.
    const aberrante = 1_000_000_000_000 + 365 * DAY;
    const vraie = 1_000_000_000_000;
    expect(U.trustedSweepNow(vraie, aberrante, CAP)).toBe(vraie);
  });

  it("première exécution : pas de marque, pas de base pour borner", () => {
    const now = 1_000_000_000_000;
    for (const vide of [null, undefined, 0, NaN, -1]) {
      expect(U.trustedSweepNow(now, vide as any, CAP), String(vide)).toBe(now);
    }
  });

  it("un `now` illisible ne purge rien plutôt que de purger tout", () => {
    // La coupure serait `NaN - 30j`, et toute comparaison contre NaN est
    // fausse — donc « rien ne se purge ». Épinglé pour que ça reste le repli.
    expect(U.trustedSweepNow(NaN as any, 1_000, CAP)).toBe(0);
  });
});

describe("…et le câblage, qui est la moitié qui pourrit", () => {
  it("App.tsx passe par trustedSweepNow, pas par Date.now() nu", () => {
    // La fonction pure peut être parfaite pendant que l'effet appelle encore
    // `Date.now()` directement — c'est la forme `chooseAutoSaveTarget`, testée
    // et non câblée, que ce dépôt a déjà payée.
    // BODY est l'effet COMMENTAIRES BLANCHIS — indispensable ici, puisque les
    // commentaires que je viens d'écrire citent `Date.now()` en toutes lettres.
    expect(BODY).toContain("trustedSweepNow(");
    expect(BODY).toMatch(/cutoffMs\s*=\s*trustedNow\s*-/);
    // Et surtout : plus de `Date.now()` servant directement de coupure.
    expect(BODY).not.toMatch(/cutoffMs\s*=\s*Date\.now\(\)\s*-/);
  });

  it("la marque est relue ET réécrite, sinon la borne ne borne rien", () => {
    expect(BODY).toContain("lsGet(SWEEP_CLOCK_KEY)");
    expect(BODY).toContain("lsSet(SWEEP_CLOCK_KEY");
  });

  it("la BORNE est TRASH_RETENTION_DAYS, la même constante que la coupure", () => {
    // La seule chose qu'aucun cas ci-dessus ne peut voir : ils passent tous
    // `CAP` en littéral, parce que la borne est un PARAMÈTRE. Un appelant qui
    // écrirait `60 * 24 * 3600 * 1000` les laisserait tous verts en cassant
    // silencieusement la garantie — la coupure dépasserait la marque
    // précédente, et une ligne supprimée depuis le lancement d'avant
    // redeviendrait purgeable par un saut d'horloge.
    //
    // C'est aussi ce qui remplace l'alias `SWEEP_CLOCK_MAX_ADVANCE_DAYS` :
    // knip le signalait comme un export en double, mais la raison de le retirer
    // est qu'un nom séparé se règle sans voir ce qu'il casse. L'égalité est
    // structurelle maintenant, et épinglée ici.
    const appel = BODY.match(/trustedSweepNow\(([\s\S]*?)\);/);
    expect(appel, "l'appel à trustedSweepNow est introuvable").toBeTruthy();
    expect(appel![1]).toMatch(/TRASH_RETENTION_DAYS\s*\*\s*24\s*\*\s*3600\s*\*\s*1000/);
    // Et la coupure lit la MÊME constante, sinon les deux peuvent diverger.
    expect(BODY).toMatch(
      /cutoffMs\s*=\s*trustedNow\s*-\s*TRASH_RETENTION_DAYS\s*\*\s*24\s*\*\s*3600\s*\*\s*1000/,
    );
  });

  it("la PREMIÈRE exécution amorce la marque et ne balaye pas", () => {
    // Le dernier trou de la borne, et le seul lancement qu'elle ne protégeait
    // pas : sans marque il n'y a rien à borner. Ce n'est pas un cas de
    // laboratoire — c'est le premier lancement APRÈS la mise à jour, cave
    // pleine et marque absente.
    //
    // L'ORDRE EST TOUTE LA RÈGLE : la marque doit être ÉCRITE avant le retour,
    // sinon le lancement suivant se retrouve à son tour sans marque et le trou
    // ne se referme jamais — il se déplace d'un lancement à chaque fois.
    const iMarque = BODY.indexOf("lsSet(SWEEP_CLOCK_KEY");
    const iRetour = BODY.search(/if\s*\(!\s*aUneMarque\s*\)\s*return\s*;/);
    const iBalayage = BODY.indexOf("sweepExpiredTrash(");
    expect(iMarque, "la marque doit être écrite").toBeGreaterThan(-1);
    expect(iRetour, "la première exécution doit sortir avant le balayage").toBeGreaterThan(-1);
    expect(iBalayage, "le balayage doit être là").toBeGreaterThan(-1);
    expect(iMarque).toBeLessThan(iRetour);
    expect(iRetour).toBeLessThan(iBalayage);
    // Et la marque doit être DÉRIVÉE de la valeur relue. Sans cette ligne,
    // écrire `var aUneMarque = false;` laisserait tout ce qui précède vert
    // pendant que le balayage ne tournerait PLUS JAMAIS — la panne silencieuse
    // que toute cette zone existe pour éviter, obtenue en la « simplifiant ».
    expect(BODY).toMatch(/aUneMarque\s*=\s*isFinite\(\s*lastTrusted\s*\)\s*&&\s*lastTrusted\s*>\s*0/);
  });
});
