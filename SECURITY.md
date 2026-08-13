# Politique de sécurité / Security Policy

---

## Français

### Versions supportées

Ma Cave à Tabac est une PWA en livraison continue : seule la version la plus récente déployée sur https://t-cellar.app est supportée. Les correctifs de sécurité sont publiés sur la branche `main` et déployés automatiquement via GitHub Pages.

Le numéro de version courant est visible dans ⚙️ Réglages → À propos et dans [`public/version.json`](public/version.json).

### Signaler une vulnérabilité

**Ne crée pas de _public issue_ pour une faille de sécurité.** Utilise le canal privé GitHub :

➡️ **[Ouvrir un Security Advisory privé](https://github.com/yokyok71/Tabac/security/advisories/new)**

Ce canal est chiffré côté GitHub, lisible uniquement par les mainteneurs du projet, et permet de coordonner un correctif et une divulgation responsable avant tout signalement public.

Ce qu'il est utile d'inclure dans le rapport :

- Description claire de la vulnérabilité et de son impact concret.
- Étapes de reproduction (URL, séquence d'actions, payload).
- Version de l'app concernée (numéro de build affiché dans ⚙️ Réglages).
- Plateforme et navigateur (iOS Safari, Android Chrome, desktop…).
- Preuve de concept si possible, en restant proportionné — pas besoin d'exfiltrer des données réelles.

### Délai de réponse

C'est un projet personnel maintenu en temps libre, donc pas de SLA contractuel. Engagement de bonne foi :

- **Accusé de réception** sous 7 jours.
- **Évaluation initiale** (sévérité + reproductibilité) sous 14 jours.
- **Correctif déployé** selon la sévérité : critique sous quelques jours, modéré sous quelques semaines, faible regroupé dans la prochaine release.

### Périmètre

**Dans le périmètre :**

- Le code source de cette PWA (`src/`, `public/`, `index.html`, `vite.config.js`, le service worker `public/sw.js`).
- Le pipeline CI (`.github/workflows/`).
- La politique CSP, les contrôles XSS, les protections SSRF (`isSafeExternalUrl`), la validation des imports (`isPlausibleBackup` + filtrage `_imageData`), les garde-fous OAuth CSRF (Google **et** Dropbox).

**Hors périmètre :**

- Failles dans les services tiers utilisés (Google OAuth, Google Drive API, Dropbox API, Anthropic / OpenAI / Gemini, OpenStreetMap / Nominatim, cdnjs.cloudflare.com, GitHub Pages). Signale-les directement chez les fournisseurs concernés.
- Risques acceptés et documentés (voir section ci-dessous).
- Vulnérabilités nécessitant un accès physique à l'appareil de la victime, ou un compte Google / un appareil compromis indépendamment.
- Le pinning SRI sur les scripts Google dynamiques (`gsi/client`) — c'est intentionnellement absent : Google met à jour ce script fréquemment et toute SRI casserait l'authentification au prochain patch de leur côté.

### Risques connus et acceptés

Quelques arbitrages d'architecture sont documentés en clair dans le code et signalés par CodeQL. Ils sont considérés acceptés faute d'alternative compatible avec l'architecture « PWA statique, sans backend » :

- **Stockage en clair du token OAuth Google** (`src/hooks/useGdriveAuth.ts` `tkSet`) — `localStorage` sur iOS standalone, `sessionStorage` ailleurs. L'app n'a pas de backend pour stocker un refresh token côté serveur ; le token doit vivre sur l'appareil pour appeler `googleapis.com` directement. La CSP (`script-src` sans `unsafe-inline`, domaines explicitement listés) est la défense XSS principale.
- **Stockage en clair des tokens Dropbox** (`src/hooks/useDropboxAuth.ts`) — `dropbox-tk` (jeton d'accès courte durée, ~4 h) et surtout `dropbox-rt`, un **refresh token longue durée** en `localStorage`, qui permet le renouvellement silencieux du jeton sur toutes les plateformes (y compris iOS standalone). Même justification que pour Google : pas de backend, l'app appelle `api.dropboxapi.com` / `content.dropboxapi.com` directement. Le champ d'accès est confiné au dossier d'app dédié (`Applications/Ma Cave à Tabac`, scope `files.content`). Le refresh token est effacé à la déconnexion explicite ou si Dropbox renvoie `invalid_grant` (app révoquée par l'utilisateur). Même défense XSS que ci-dessus (CSP stricte).
- **Stockage en clair de la clé API du provider IA** (`src/hooks/useAiAutoFill.ts` `saveApiKey`) — même justification : l'app appelle directement `api.anthropic.com` / `api.openai.com` / `generativelanguage.googleapis.com`, sans relais serveur. Par défaut, la clé est **exclue des exports et des sauvegardes Drive** (`cave-exclude-apikey` est opt-out).
- **Flow OAuth implicit grant (`response_type=token`) sur iOS standalone** — le seul flow compatible avec un client OAuth « Web Application » Google sans `client_secret` côté serveur, dans un webview PWA qui ne tolère pas les popups. La protection CSRF passe par un `state` aléatoire (`pkceGenerateVerifier()` réutilisé pour générer un nonce) validé strictement (`!st || !expectedSt || st !== expectedSt`).

### Politique de divulgation

Divulgation coordonnée. Pour les vulnérabilités validées :

1. Correctif développé en privé sur une branche dédiée.
2. Release déployée sur GitHub Pages.
3. Note publique dans `public/changelog.html` (description suffisante pour comprendre l'impact, sans détails permettant la réexploitation immédiate sur les utilisateurs lents à mettre à jour).
4. Publication de l'advisory GitHub avec crédit du découvreur, sauf demande contraire.

Délai indicatif avant divulgation publique : **90 jours** après le signalement, ou plus tôt si un correctif est déployé et que la majorité des utilisateurs est à jour.

### Pas de programme de bug bounty

Projet personnel non commercial : aucune rétribution financière. Le crédit dans l'advisory et le changelog reste possible avec ton accord.

---

## English

### Supported versions

Ma Cave à Tabac is a continuously-delivered PWA: only the latest version deployed at https://t-cellar.app is supported. Security fixes ship from the `main` branch and are deployed automatically via GitHub Pages.

The current version number is visible in ⚙️ Settings → About and in [`public/version.json`](public/version.json).

### Reporting a vulnerability

**Do not open a public issue for a security vulnerability.** Use the private GitHub channel:

➡️ **[Open a private Security Advisory](https://github.com/yokyok71/Tabac/security/advisories/new)**

This channel is encrypted server-side by GitHub, readable only by project maintainers, and lets us coordinate a fix and responsible disclosure before any public report.

A helpful report includes:

- A clear description of the vulnerability and its concrete impact.
- Reproduction steps (URL, action sequence, payload).
- The affected app version (build number shown in ⚙️ Settings).
- Platform and browser (iOS Safari, Android Chrome, desktop…).
- A proof of concept if possible — kept proportionate, no need to exfiltrate real data.

### Response time

This is a personal project maintained in spare time, so no contractual SLA. Best-effort commitment:

- **Acknowledgement** within 7 days.
- **Initial assessment** (severity + reproducibility) within 14 days.
- **Fix deployed** depending on severity: critical within a few days, moderate within a few weeks, low bundled into the next release.

### Scope

**In scope:**

- This PWA's source code (`src/`, `public/`, `index.html`, `vite.config.js`, the service worker `public/sw.js`).
- The CI pipeline (`.github/workflows/`).
- The CSP policy, XSS controls, SSRF protections (`isSafeExternalUrl`), import validation (`isPlausibleBackup` + `_imageData` filtering), the OAuth CSRF guards (Google **and** Dropbox).

**Out of scope:**

- Vulnerabilities in third-party services we depend on (Google OAuth, Google Drive API, Dropbox API, Anthropic / OpenAI / Gemini, OpenStreetMap / Nominatim, cdnjs.cloudflare.com, GitHub Pages). Please report those directly to the vendor.
- Documented accepted risks (see section below).
- Vulnerabilities requiring physical access to the victim's device, or an independently compromised Google account / device.
- The absence of SRI on Google's dynamic scripts (`gsi/client`) — intentionally so: Google updates that file frequently and any SRI hash would break authentication at their next patch.

### Known accepted risks

A few architectural trade-offs are documented inline in the code and flagged by CodeQL. They are considered accepted for lack of an alternative compatible with the "static PWA, no backend" architecture:

- **Clear-text storage of the Google OAuth token** (`src/hooks/useGdriveAuth.ts` `tkSet`) — `localStorage` on iOS standalone, `sessionStorage` elsewhere. The app has no backend to hold a refresh token server-side; the token must live on the device to call `googleapis.com` directly. The CSP (`script-src` without `unsafe-inline`, with an explicit allow-list) is the primary XSS defense.
- **Clear-text storage of the Dropbox tokens** (`src/hooks/useDropboxAuth.ts`) — `dropbox-tk` (short-lived access token, ~4 h) and notably `dropbox-rt`, a **long-lived refresh token** in `localStorage`, which enables silent token renewal on every platform (including iOS standalone). Same reasoning as Google: no backend, the app calls `api.dropboxapi.com` / `content.dropboxapi.com` directly. Access is confined to the dedicated app folder (`Apps/Ma Cave à Tabac`, `files.content` scope). The refresh token is cleared on explicit disconnect or when Dropbox returns `invalid_grant` (app revoked by the user). Same XSS defense as above (strict CSP).
- **Clear-text storage of the AI provider API key** (`src/hooks/useAiAutoFill.ts` `saveApiKey`) — same reasoning: the app calls `api.anthropic.com` / `api.openai.com` / `generativelanguage.googleapis.com` directly with no server relay. By default the key is **excluded from exports and Drive backups** (`cave-exclude-apikey` is opt-out).
- **OAuth implicit grant (`response_type=token`) on iOS standalone** — the only flow compatible with a Google "Web Application" OAuth client without a server-side `client_secret`, inside a PWA webview that does not tolerate popups. CSRF protection relies on a random `state` (generated via `pkceGenerateVerifier()` reused as a nonce) validated strictly (`!st || !expectedSt || st !== expectedSt`).

### Disclosure policy

Coordinated disclosure. For confirmed vulnerabilities:

1. Fix developed privately on a dedicated branch.
2. Release deployed to GitHub Pages.
3. Public note added to `public/changelog.html` (enough description to convey impact, no exploit details that would burn users slow to update).
4. GitHub advisory published with credit to the reporter, unless they request otherwise.

Indicative time-to-public-disclosure: **90 days** after the initial report, or earlier if a fix is deployed and most users are up to date.

### No bug bounty program

This is a non-commercial personal project: no financial reward. Credit in the advisory and the changelog is offered with your consent.
