# CLAUDE.md — Tabac Project Guide

## Project Overview

**Tabac** ("Ma Cave à Tabac") is a single-page Progressive Web App (PWA) for managing a personal pipe tobacco collection and pipe inventory. It is a French-language application with no build tools — the entire app lives in a single `index.html` file.

## Repository Structure

```
/
├── index.html        # Entire application (React + JS, all inline)
├── manifest.json     # PWA manifest (name, icons, theme colors)
├── sw.js             # Service Worker for offline caching (v12)
├── icon-192.png      # PWA icon (192×192)
├── icon-512.png      # PWA icon (512×512)
└── CLAUDE.md         # This file
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 18.2.0 (loaded via CDN) |
| Runtime | Browser JavaScript (no transpilation) |
| State | React Hooks (`useState`, `useEffect`, `useCallback`, `useMemo`) |
| Persistence | `localStorage` (primary), IndexedDB (image cache) |
| Offline | Service Worker (`sw.js`, cache name `cave-tabac-v12`) |
| Auth | Google Sign-In (OAuth 2.0) |
| Cloud backup | Google Drive API v3 |
| AI | Anthropic Claude API (`claude-haiku-4-5-20251001`) with web search |
| Image proxy | corsproxy.io (CORS bypass for external images) |
| ZIP export | JSZip 3.10.1 (loaded dynamically on demand) |

**No Node.js, no npm, no build step.** Open `index.html` in a browser to run.

## Key Data Structures

All application state is serialized as JSON and stored under the localStorage key `pipe-cellar-v6`.

### Tobacco Entry (`BT` template)
```js
{
  name, brand, category, blend, cut,
  rating,       // 0–5
  rebuy,        // boolean
  tastingNotes, // free text
  description,  // free text
  imageUrl,     // base64 or URL
  lots          // array of Lot objects
}
```

### Lot / Batch (`BL` template)
```js
{
  status,         // "cellar" | "jar" | "finished"
  weightG,        // number (grams)
  datePurchased,
  dateProduction,
  dateOpened,
  boxNumber,
  price,
  seller
}
```

### Pipe (`BP` template)
```js
{
  name, brand, shape,
  datePurchased, price, seller,
  description, imageUrl,
  rating,  // 0–5
  status   // "active" | "retired"
}
```

### Wishlist Item (`BW` template)
```js
{ name, brand, notes, priority }
```

## Enumerations

```js
// Tobacco categories (French names)
CATS = ["Anglais", "Virginia", "Aromatique", "Balkan/Anglais",
        "VaPer", "Burley", "Oriental", "Autre"]

// Tobacco cuts
CUTS = ["Ready Rubbed", "Flake", "Broken Flake", "Plug",
        "Coins", "Ribbon", "Crumble Cake", "Rope", "Autre"]

// Pipe shapes
SHAPES = ["Billiard", "Bent", "Dublin", "Apple", "Bulldog",
          "Poker", "Churchwarden", "Calabash", "Freehand",
          "Lovat", "Canadian", "Zulu", "Autre"]
```

## Application Views / Router

The app uses a custom `view` state string as a client-side router. No URL changes.

| View key | Purpose |
|----------|---------|
| `home`   | Dashboard with inventory statistics |
| `inv`    | Tobacco inventory list (filter, sort, search) |
| `addT`   | Add new tobacco form |
| `editT`  | Edit existing tobacco |
| `pipes`  | Pipe collection list |
| `addP`   | Add new pipe form |
| `editP`  | Edit existing pipe |
| `wish`   | Wishlist management |

## Core Functions Reference

| Function | Purpose |
|----------|---------|
| `load()` | Deserialize state from `localStorage` |
| `save(data)` | Serialize and persist state to `localStorage` |
| `addTobacco()` | Create a new tobacco entry |
| `updateTobacco()` | Edit an existing tobacco entry |
| `deleteTobacco(id)` | Remove a tobacco entry |
| `addLotToTobacco()` | Append a lot/batch to a tobacco |
| `changeLotStatus()` | Advance lot status: `cellar → jar → finished` |
| `addPipe()` | Create a new pipe entry |
| `updatePipe()` | Edit an existing pipe |
| `deletePipe(id)` | Remove a pipe entry |
| `addWish()` / `delWish()` | Add/remove wishlist items |
| `aiAutoFill()` | AI-powered form auto-complete via Claude API |
| `gdriveSave()` / `gdriveRestore()` | Cloud backup/restore via Google Drive |
| `doExport()` / `doImport()` | JSON export/import |
| `doExportCSV()` | Export inventory as CSV |
| `doBackupZip()` | Create ZIP archive including images |
| `handlePhotoUpload()` | Upload and resize tobacco/pipe images |

## AI Integration

The AI auto-fill feature (`aiAutoFill`) calls the **Anthropic Claude API** directly from the browser:

- **Model:** `claude-haiku-4-5-20251001`
- **Tool:** `web_search` (Anthropic built-in tool for live lookups)
- **Language:** Prompts and responses are in **French**
- **Purpose:** Auto-populate tobacco/pipe details (brand, category, blend type, cut, shape) from a name query
- **API key storage:** `localStorage` key `anthropic-api-key` (user-provided, never hardcoded)
- **CORS:** Calls go directly to `https://api.anthropic.com/v1/messages` (no proxy needed; the service worker explicitly bypasses this URL)

## Google Integration

- **Client ID:** `890611313186-qadhr6pqp2vk5toh0rkrpgi3qcd1e4ji.apps.googleusercontent.com`
- **Scopes:** `https://www.googleapis.com/auth/drive.file`
- **Backup file name on Drive:** `cave-tabac-backup.json`
- The service worker **bypasses caching** for all `googleapis.com` and `accounts.google.com` requests.

## Image Handling

- Images are stored as **base64 strings** in `localStorage` (tobacco/pipe entries).
- External URLs are fetched through `https://corsproxy.io/` to bypass CORS restrictions.
- A separate **IndexedDB** database (`cave-imgs`, object store `i`) caches images to avoid repeated fetches.

## Color Theme (Design System)

All colors are defined as JS constants and applied via inline styles:

```js
bg    = "#13110e"   // Page background (dark brown)
bg2   = "#1b1713"
bg3   = "#252019"
bg4   = "#312a21"
bdr   = "#3d3428"   // Border
txt   = "#c8b99a"   // Primary text
tx2   = "#8f7f68"   // Secondary text
tx3   = "#655846"   // Tertiary text
hi    = "#e8dcc6"   // Highlighted text
amber = "#cb8528"   // Accent color 1
gold  = "#d4a03a"   // Accent color 2
green = "#6fb876"   // Positive/success
red   = "#c25848"   // Negative/error/delete
```

## Service Worker Notes

- Cache name: `cave-tabac-v12` — bump this version string when updating cached assets.
- Cached assets: `index.html`, `manifest.json`, `icon-192.png`, `icon-512.png`, React CDN bundles.
- **Never cached** (always fetched from network): `api.anthropic.com`, `corsproxy.io`, `googleapis.com`, `accounts.google.com`.

## Development Workflow

### Running the app
No build step. Just serve the files:
```bash
# Any static server works, e.g.:
python3 -m http.server 8080
# Then open http://localhost:8080
```

Or simply open `index.html` directly in a browser (some features require HTTPS/localhost for PWA).

### Making changes
All application code is in `index.html`. Edit it directly.

### Service Worker versioning
After any change to cached assets (HTML, icons, manifest), increment the cache version:
```js
// sw.js, line 1
const CACHE = 'cave-tabac-v13'; // was v12
```

### Git conventions
- Branch: feature branches follow the pattern `claude/<description>-<id>`
- Commits: brief English messages describing what changed
- Main branch: `master`

## Key Conventions for AI Assistants

1. **Single-file architecture** — All React components, state, and logic live in `index.html`. Do not split into separate files unless explicitly requested.
2. **No build tools** — Do not introduce npm, webpack, vite, or any build step. Dependencies must be CDN-loaded.
3. **Inline styles** — The project uses CSS-in-JS (inline `style` props). Do not add CSS files or CSS-in-JS libraries.
4. **French language** — UI strings, labels, and AI prompts are in French. Keep new UI text in French.
5. **localStorage schema** — The key `pipe-cellar-v6` must remain stable. If a schema change is needed, migrate data in `load()` and bump the version suffix.
6. **Service worker cache** — Bump `cave-tabac-v12` → next version whenever `index.html`, `manifest.json`, or icons change.
7. **No test suite** — There are no automated tests. Validate changes manually in the browser.
8. **API keys** — Never hardcode API keys. The Anthropic key is entered by the user and stored in `localStorage`.
9. **Image storage** — Store images as base64 in the main state object; use IndexedDB only as a read-through cache.
10. **Lot lifecycle** — Lots always flow `cellar → jar → finished` (one direction only).
