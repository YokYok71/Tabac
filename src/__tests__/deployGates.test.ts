import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The gates must gate the DEPLOY, not merely exist.
//
// The finding this locks: typecheck / lint / prune lived in
// `checks.yml` and size:check in `lighthouse.yml`, both running IN PARALLEL
// with `deploy.yml`. Neither could stop it. A push that failed any of them
// still uploaded its Pages artifact and shipped; the red X arrived afterwards,
// on a build users already had. An earlier release fixed "these gates run nowhere"; it
// did not fix "they gate nothing", and the difference is invisible in a green
// dashboard — which is why it survived.
//
// Deliberately NOT parsed as YAML: no YAML parser is a dependency here (adding
// one only for this would be flagged by knip), and the property under test is
// positional — does the gate appear before the upload? — which the raw text
// answers directly and without a schema to keep in sync.

const ROOT = resolve(__dirname, "../..");
const deploy = readFileSync(resolve(ROOT, ".github/workflows/deploy.yml"), "utf8");
const checks = readFileSync(resolve(ROOT, ".github/workflows/checks.yml"), "utf8");
// Les deux campagnes navigateur ont DÉMÉNAGÉ de `checks.yml` vers leur propre
// fichier. Ce n'est pas un rangement : `paths:` est un filtre de WORKFLOW et
// non de job, donc les séparer est ce qui permet de ne les lancer que quand un
// fichier peut réellement changer un pixel. Voir `browserPathFilter.test.ts`,
// qui garde ce filtre — la liste de chemins est écrite à la main, c'est-à-dire
// la classe de liste figée que ce dépôt a trouvée six fois.
const browser = readFileSync(resolve(ROOT, ".github/workflows/browser.yml"), "utf8");

const UPLOAD = "upload-pages-artifact";

// Every gate that must hold the artifact back. `npm test` and `doc:check` are
// already in deploy.yml and pre-date this test; they are included so the list
// is the complete set of what gates a deploy, not just the part added last.
const GATES = [
  "npm test",
  "npm run doc:check",
  "npm run typecheck",
  "npm run lint",
  "npm run prune",
  "npm run size:check",
  // Les deux campagnes navigateur, entrées dans le chemin de déploiement pour
  // fermer la fenêtre où le build était sur le téléphone sans avoir été
  // mesuré. Elles sont des portes au même titre que les quatre au-dessus :
  // elles doivent précéder le téléversement.
  "npm run theme:contrast",
  "npm run i18n:layout",
];
// `npm run catalogue:check` was a sixth gate. It read the
// catalogue the app shipped; the app ships none, so the script now REQUIRES a
// `--csv` argument and is a reviewer tool run against a delivery, not a gate
// with an input. A gate whose input no longer exists would either fail every
// push or pass having examined nothing — the vacuous pass this file is written
// against.

describe("deploy.yml — the gates gate the deploy", () => {
  it("uploads the Pages artifact exactly once (the anchor these assertions need)", () => {
    // Non-vacuity: if the upload step were renamed or removed, every
    // "appears before the upload" assertion below would pass trivially.
    const n = deploy.split(UPLOAD).length - 1;
    expect(n).toBe(1);
  });

  GATES.forEach((cmd) => {
    it(`runs \`${cmd}\` BEFORE the artifact upload`, () => {
      const at = deploy.indexOf(cmd);
      expect(at, `${cmd} is not in deploy.yml at all`).toBeGreaterThan(-1);
      expect(at).toBeLessThan(deploy.indexOf(UPLOAD));
    });
  });

  it("keeps checks.yml running on pull_request — it is the ONLY gate there", () => {
    // deploy.yml runs on push only. Dropping the pull_request trigger from
    // checks.yml while "the gates are in deploy.yml now" would leave PRs
    // completely unguarded — a plausible cleanup, so it is pinned.
    expect(checks).toMatch(/^\s*pull_request:\s*$/m);
  });

  it("does not let a failing gate be skipped by an earlier failure", () => {
    // Each gate carries `!cancelled()` so one push reports every class at
    // once. Without it, the first failure short-circuits the rest and a
    // commit needs one re-run per problem.
    const tail = deploy.slice(deploy.indexOf("npm run typecheck") - 400, deploy.indexOf(UPLOAD));
    const gateSteps = tail.split(/\n {6}- name: /).slice(1);
    // Four (catalogue:check was the fifth). Derived from
    // GATES minus the two that pre-date the block, so the number cannot drift
    // from the list above.
    expect(gateSteps.length).toBeGreaterThanOrEqual(GATES.length - 2);
    gateSteps.forEach((s) => expect(s).toContain("!cancelled()"));
  });

  // The one exception to "every gate runs regardless", and it earns it.
  //
  // `npm test` and `npm run build` share ONE step, so a failing test means
  // dist/ was never produced. size:check then printed `dist/ not found` — the
  // LAST error in the job log, and therefore the first thing a reader sees. A
  // flaky test in the suite was diagnosed as a build problem because of it.
  //
  // This does NOT weaken the `!cancelled()` intent: the gate is skipped only
  // when its input cannot exist, and every other class is still reported on the
  // same push.
  describe("the bundle-size gate does not report a phantom failure", () => {
    const stepIdx = deploy.indexOf("- name: Bundle size budget");
    const step = deploy.slice(stepIdx, deploy.indexOf("run:", stepIdx));

    it("is anchored (non-vacuity)", () => {
      expect(stepIdx).toBeGreaterThan(-1);
    });

    it("runs only when the build step SUCCEEDED", () => {
      expect(step).toContain("steps.build.outcome == 'success'");
    });

    it("still carries !cancelled(), so it is skipped for that reason alone", () => {
      expect(step).toContain("!cancelled()");
    });

    it("keeps the id on the build step that the condition keys on", () => {
      // Without the id the condition silently evaluates to an empty string and
      // the gate never runs at all — worse than the defect it fixes.
      expect(deploy).toMatch(/- name: Build \(Vite\)[^\n]*\n\s+id: build\n/);
    });
  });

  // ── LES CAMPAGNES, CÔTÉ DÉPLOIEMENT ───────────────────────────────────────
  //
  // La boucle GATES ci-dessus vérifie qu'elles précèdent le téléversement. Ce
  // bloc-ci vérifie qu'elles mesurent quelque chose de RÉEL une fois arrivées
  // là — c'est le câblage qui pourrit, et une campagne rétrécie ou lancée sans
  // navigateur rapporte vert en n'ayant rien vu.
  describe("les campagnes navigateur dans deploy.yml", () => {
    const from = deploy.indexOf("- name: Install playwright-core");
    const zone = from < 0 ? "" : deploy.slice(from, deploy.indexOf(UPLOAD));

    it("la zone est repérable (non-vacuité)", () => {
      expect(from, "l'étape d'installation du navigateur a disparu").toBeGreaterThan(-1);
    });

    it("aucun axe n'est rétréci", () => {
      // Rétrécir est légitime en itération et doit ne jamais devenir le
      // défaut CI : un passage sur `--langs de` rapporte vert en ayant mesuré
      // une langue sur six, et se lit comme une couverture complète.
      expect(zone, "un axe est rétréci — la CI rapporterait sur une tranche")
        .not.toMatch(/--langs|--scales|--widths|THEME_CONTRAST_THEMES|THEME_CONTRAST_MODES|THEME_CONTRAST_LANG/);
    });

    it("installe Chromium — les campagnes sautent le shell headless", () => {
      expect(zone).toContain("npm i --no-save playwright-core");
      expect(zone).toMatch(/playwright-core install[^\n]*chromium/);
    });

    it("réutilise le dist/ de l'étape Build, qui la précède", () => {
      // Les deux vérificateurs REFUSENT un dist/ plus vieux que src/. Un job
      // séparé devrait reconstruire ; ici l'ordre suffit, et c'est aussi
      // pourquoi elles sont en SÉRIE et non en parallèle.
      expect(deploy.indexOf("npm run build")).toBeLessThan(deploy.indexOf("npm run theme:contrast"));
    });

    it("chaque campagne rapporte même si l'autre a échoué", () => {
      const after = zone.slice(zone.indexOf("- name: Contrast"));
      expect((after.match(/!cancelled\(\)/g) || []).length,
        "une campagne en échec masque l'autre").toBeGreaterThanOrEqual(2);
    });

    it("se tait quand le build a échoué, comme size:check", () => {
      // Même raison exactement : sans dist/, la campagne imprimerait une
      // erreur de fraîcheur en DERNIER dans le journal, donc la première chose
      // que lit un humain — et un test rouge se diagnostiquerait en problème
      // de navigateur.
      const steps = zone.split(/\n {6}- name: /).slice(1);
      expect(steps.length).toBeGreaterThanOrEqual(2);
      steps.forEach((s) => expect(s).toContain("steps.build.outcome == 'success'"));
    });
  });

  // ── Les deux vérifications NAVIGATEUR sont enfin lancées quelque part ──────
  //
  // Elles voient ce qu'aucune autre porte ne voit — une étiquette rognée, un
  // conteneur qui glisse latéralement, une paire de couleurs illisible — et
  // elles étaient opt-in parce qu'elles coûtaient ~55 min et ~45 min. Elles
  // tournaient donc quelques fois par an, à la main : l'état que ce dépôt
  // nomme « une porte que personne ne lance est de la documentation ».
  //
  // Ce qui a changé est mesuré : le fan-out (un processus par langue, un par
  // palette, sur un serveur d'aperçu partagé) les ramène à ~10 min et ~3 min
  // sur une machine 4 vCPU — la forme d'`ubuntu-latest`. Ce bloc épingle le
  // câblage, parce que c'est LUI qui pourrit : la campagne peut rester
  // parfaite pendant qu'un déclencheur disparaît, et un tableau de bord vert
  // ne dit rien de ce qui n'a pas tourné.
  // RENVERSEMENT CONSIGNÉ : ce bloc exigeait le job `browser` DANS
  // `checks.yml`, et il est maintenant dans `browser.yml`. Ce qu'il garde n'a
  // pas changé d'un iota — la campagne complète, le build avant elle, le
  // navigateur installé, chaque campagne rapportant même si l'autre a échoué,
  // les deux déclencheurs, et la place hors de `deploy.yml` — seule la LECTURE
  // a suivi le fichier. L'assertion « le job est parti de checks.yml » est
  // inversée plutôt que supprimée, pour qu'un retour en arrière se signale.
  describe("the two browser checks run in CI", () => {
    const jobIdx = browser.indexOf("\n  browser:");
    const job = jobIdx < 0 ? "" : browser.slice(jobIdx);

    it("the job exists (non-vacuity — every assertion below reads it)", () => {
      expect(jobIdx, "the `browser` job is gone from browser.yml").toBeGreaterThan(-1);
    });

    it("et il n'est PLUS dans checks.yml, qui redevient la voie rapide", () => {
      // Le laisser aux deux endroits doublerait chaque exécution et ferait de
      // la voie rapide un job de quinze minutes.
      expect(checks).not.toContain("\n  browser:");
      // COMMENTAIRES BLANCHIS D'ABORD. Ma première version cherchait
      // `npm run build` dans le fichier brut et rougissait sur l'en-tête
      // HISTORIQUE, qui cite cette commande pour expliquer ce que deploy.yml
      // faisait autrefois — une garde qui lit de la prose comme de la donnée
      // produit une absurdité confiante, et le correctif s'applique alors au
      // code juste. C'est la cinquième fois que ce dépôt le note.
      const code = checks.replace(/^\s*#[^\n]*$/gm, "");
      expect(code, "la voie rapide s'est remise à construire").not.toContain("npm run build");
    });

    it("runs BOTH campaigns, in full", () => {
      // Narrowing an axis is legitimate while iterating and is exactly what
      // must not become the CI default: a run over `--langs de` reports green
      // having measured one language of six, and reads as full coverage.
      expect(job).toContain("npm run theme:contrast");
      expect(job).toContain("npm run i18n:layout");
      expect(job, "an axis is narrowed — CI would report on a slice")
        .not.toMatch(/--langs|--scales|--widths|THEME_CONTRAST_THEMES|THEME_CONTRAST_MODES/);
    });

    it("builds first — both checks REFUSE a stale dist/", () => {
      const build = job.indexOf("npm run build");
      expect(build, "no build step").toBeGreaterThan(-1);
      expect(build).toBeLessThan(job.indexOf("npm run theme:contrast"));
    });

    it("installs the browser, which is deliberately not a dependency", () => {
      expect(job).toContain("npm i --no-save playwright-core");
      expect(job, "the checks skip the headless shell, so chromium is required")
        .toMatch(/playwright-core install[^\n]*chromium/);
    });

    it("each campaign reports even when the other failed", () => {
      const after = job.slice(job.indexOf("Contrast"));
      expect((after.match(/!cancelled\(\)/g) || []).length,
        "one failing campaign hides the other").toBeGreaterThanOrEqual(2);
    });

    it("ne se déclenche PLUS sur push : ce fichier est la voie des pull requests", () => {
      // RENVERSEMENT CONSIGNÉ. Ce cas exigeait `push:` — « la convention ici
      // est de pousser directement sur main, donc une porte limitée aux pull
      // requests ne se déclencherait presque jamais ». Vrai, et résolu par
      // l'autre bout : sur main les campagnes sont dans `deploy.yml`. Les
      // garder ici aussi ferait 864 rendus deux fois par commit.
      const code = browser.replace(/^\s*#[^\n]*$/gm, "");
      expect(code, "push est revenu : double exécution sur main")
        .not.toMatch(/^\s*push:\s*$/m);
      expect(browser).toMatch(/^\s*pull_request:\s*$/m);
    });

    it("ENTRE dans le chemin de déploiement — la fenêtre non mesurée est fermée", () => {
      // RENVERSEMENT CONSIGNÉ, et il était PRÉVU : ce cas exigeait l'absence
      // des campagnes dans `deploy.yml`, sous un commentaire disant « si une
      // régression de mise en page atteint un jour les utilisateurs sur main,
      // la déplacer et payer les 15 min ». Ce n'est pas une régression qui a
      // tranché mais l'utilisateur : hors du chemin de déploiement, les
      // campagnes laissaient une fenêtre d'environ neuf minutes où le build
      // était sur le téléphone sans avoir été mesuré. Le coût est payé.
      expect(deploy).toContain("npm run theme:contrast");
      expect(deploy).toContain("npm run i18n:layout");
    });

    it("la voie rapide existe toujours et reste rapide", () => {
      // Le point de la séparation : les portes qui répondent en secondes ne
      // doivent jamais attendre derrière une campagne de treize minutes.
      expect(checks).toContain("\n  checks:");
      expect(checks).toContain("npm run typecheck");
      expect(checks).toContain("npm run lint");
    });
  });
});
