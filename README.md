# Ma Cave à Tabac

Application web pour gérer une cave à tabac à pipe et une collection de pipes.
**[t-cellar.app](https://t-cellar.app)**

Pas de compte, pas de serveur : tout est stocké dans le navigateur. L'application
s'installe sur l'écran d'accueil (PWA) et fonctionne hors ligne.

Disponible en français, anglais, espagnol, allemand, italien et portugais.

## Ce qu'elle fait

- **Tabacs et lots** — chaque tabac contient un ou plusieurs lots (une boîte, un
  pot), avec leur poids, leur prix, leur emplacement et leurs dates. Le cycle est
  cave → pot → fini, et le poids fumé se déduit tout seul.
- **Maturité** — chaque lot en cave affiche sa bande de vieillissement (jeune,
  optimal, proche du pic, trop vieux) à partir de sa famille ou de la durée que
  vous indiquez.
- **Pipes** — fiches détaillées, carnet d'entretien, rappel d'entretien basé sur
  le nombre de séances, temps de repos.
- **Journal et dégustation** — une séance se saisit après coup ou se chronomètre
  en direct, avec la roue des arômes, la note et le lieu.
- **Statistiques** — consommation, dépenses, note par âge du tabac, profil
  gustatif, calendrier des séances.
- **Envies, accessoires, liste de courses, corbeille 30 jours.**

## Le catalogue est le vôtre

L'application **ne fournit aucun catalogue de référence**. Chacun charge son
propre fichier CSV depuis Réglages → Données, à partir du modèle téléchargeable,
et peut le vérifier, l'exporter ou le retirer. Un catalogue chargé sert à
pré-remplir une fiche, à comparer des mélanges et à parcourir ce qu'on ne possède
pas encore.

## Vos données

Elles restent sur l'appareil (`localStorage` pour la cave, IndexedDB pour les
photos). Rien n'est envoyé nulle part sans une action explicite de votre part :

- **Sauvegarde** — export JSON / CSV / ZIP, ou sauvegarde vers **Google Drive**
  ou **Dropbox** si vous connectez un compte. Le chiffrement des sauvegardes
  cloud (AES-GCM, phrase de passe) est facultatif.
- **Assistant IA** — l'auto-remplissage d'une fiche n'appelle un fournisseur
  (Anthropic, OpenAI ou Google) que si vous avez saisi votre propre clé API.
- **Lieu d'une séance** — la géolocalisation et le nom du lieu ne sont demandés
  qu'au moment où vous les capturez.

Le détail est dans la [politique de confidentialité](public/privacy.html), et la
[politique de sécurité](SECURITY.md) explique comment signaler une vulnérabilité.

## Développement

Vite 8 (Rolldown) · React 19 · TypeScript 6 en mode strict. Aucune dépendance
d'exécution en dehors de React.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/
```

Les garde-fous, tous exécutés à chaque build et avant le déploiement :

```bash
npm run typecheck  # tsc --noEmit (strict)
npm run lint       # eslint (dont les règles maison tabac-local/*)
npm test           # vitest
npm run prune      # knip — code mort
npm run doc:check  # versions, i18n, contrats de libellés, documentation
npm run size:check # budget de chargement initial (après build)
```

Deux vérifications optionnelles nécessitent un navigateur
(`npm i --no-save playwright-core`) : `npm run i18n:layout` rend l'application
dans chaque langue pour détecter les débordements de texte, et
`npm run theme:contrast` mesure les contrastes des six palettes.

`CLAUDE.md` documente l'architecture, les invariants et les décisions de
conception.

## Licence

MIT — voir [LICENSE](LICENSE), qui reprend aussi les licences des bibliothèques
et polices tierces redistribuées.
