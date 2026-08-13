import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { createRequire } from "node:module";

// Local rules live in ./eslint-rules/. Load via createRequire
// so we can keep the rule files in CommonJS (simplest plugin API) while
// the config itself stays ESM.
const require = createRequire(import.meta.url);
const stringLocaleCompareRule = require("./eslint-rules/string-locale-compare.cjs");
// Companion rule for the wider String-only-method family
// — set at "warn" so it surfaces during development without blocking
// CI on legitimate uses.
const stringOnlyMethodRule = require("./eslint-rules/string-only-method.cjs");
// iOS/Android parity rule — flags inline "Settings → X"
// breadcrumbs outside i18n.ts. Backstops CLAUDE.md invariant #20
// (no platform-specific UI string hardcoded in a view).
const noPlatformBreadcrumbRule = require("./eslint-rules/no-platform-breadcrumb-out-of-i18n.cjs");
// Tripwire for the OAuth read-after-clear bug pattern
// (localStorage.removeItem(K) before localStorage.getItem(K) of the
// same key within one function — the read silently returns null and
// the action dispatcher drops everything). Set at "error" — the
// pattern is never intentional in production code.
const noStorageReadAfterRemoveRule = require("./eslint-rules/no-storage-read-after-remove.cjs");
// Anti-regression guardrail for the "hardcoded UI
// language" leak class. Flags `lang === "code" ? "UI text" : "UI text"`
// ternaries whose branches read like user-facing text (whitespace or
// Latin accent) — those silently show French to es/de/it users because
// the ternary only handles two languages. UI text belongs in the i18n
// dictionaries (t("key")) / xl(value, XXX_EN). Set at "error".
const noHardcodedLangTernaryRule = require("./eslint-rules/no-hardcoded-lang-ternary.cjs");
// Companion guardrail — flags bare JSX text literals
// (`<span>Bonjour</span>`) that read like UI text, the other hardcoded-
// string shape. Runtime pseudo-loc scan confirmed the codebase is clean,
// so it ships at "error".
const noHardcodedJsxTextRule = require("./eslint-rules/no-hardcoded-jsx-text.cjs");
// Tripwire for unguarded Web-Storage WRITES (setItem / removeItem
// / clear) — they throw in Safari private mode / on quota and crash the
// surrounding flow. Use lsSet / lsRemove (src/utils/appStorage.ts). "error";
// the OAuth/token/CSRF files keep their dedicated guarded paths and are
// allowlisted OFF in a per-file override below.
const noRawStorageWriteRule = require("./eslint-rules/no-raw-storage-write.cjs");
// Companion to string-only-method for the Number family —
// .toFixed / .toPrecision / .toExponential throw when the receiver isn't a
// number (many numeric values are stored as strings). "error".
const numberOnlyMethodRule = require("./eslint-rules/number-only-method.cjs");
// Preventive tripwire for the iOS zoom-on-focus regression class —
// flags `fontSize: fs(...)` on a JSX <input>/<textarea> inline style. Fields
// must size via fsInput() so the value can't drop below the 16px floor. "error"
// (the codebase was reconciled to fsInput in an audit).
const noFsInInputRule = require("./eslint-rules/no-fs-in-input.cjs");
const noScrollingFocusRule = require("./eslint-rules/no-scrolling-focus.cjs");
const noHexAlphaConcatRule = require("./eslint-rules/no-hex-alpha-concat.cjs");
// Forbid a dynamic index into a module-level plain-object lookup
// map — a forged prototype-member key resolves to Object.prototype and defeats
// the `|| fallback` guard. Consolidates the prototype-safety finding class that
// successive audit rounds kept surfacing one site at a time. "error"; the known sites
// were converted to Object.create(null) as they were found.
const noDynamicIndexPlainMapRule = require("./eslint-rules/no-dynamic-index-plain-map.cjs");
// The lot-SCOPE discipline in the two inventory views. Every
// `.lots` read there must carry a `// scope-ok: <reason>` acknowledgement —
// successive releases fixed the "figure describes lots the user filtered OUT" leak
// seven times and the sweep still found five more sites. Deliberately dumb (it
// forces a conscious re-read rather than guessing correctness). "error", and
// registered ONLY on those two files via a per-file block below.
const noUnscopedLotReadRule = require("./eslint-rules/no-unscoped-lot-read.cjs");
// The enum DISPLAY invariant (CLAUDE.md § "Enum DISPLAY
// invariant"). Enum values are stored canonical (French), so a bare
// `{item.category}` in JSX renders French to es/de/it users — invisible to
// anyone testing in fr or en, which is how six such leaks shipped at once.
// "error": every current site is correct, so any hit is a new leak.
const noRawEnumRenderRule = require("./eslint-rules/no-raw-enum-render.cjs");

export default tseslint.config(
  // `eslint-rules/` was once in this list, so the twelve custom rules
  // — the guards the rest of the codebase leans on — were the one directory
  // ESLint never read. That is the same blind spot as the ".jsx matched
  // no config": a tool reports clean on files it never opened. It matters here
  // specifically because the failure mode of a rule file is silence: a helper
  // defined but never wired into create(), or an unused visitor, makes the rule
  // stop checking a case while still reporting "0 problems". no-unused-vars
  // catches exactly that shape. A config block for them follows below.
  { ignores: ["dist/", "public/"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // The two .jsx sources (Charts.jsx, main.jsx) once matched NO config
  // block, so ESLint skipped them entirely — "File ignored because no matching
  // configuration was supplied". Not one rule had ever run on the chart helpers,
  // which is how two hardcoded French strings ("total actif", rendered in every
  // language) sat in the donut centre unnoticed. Found while chasing the SVG
  // fill/var() issue in the same file.
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { window: "readonly", document: "readonly", localStorage: "readonly", navigator: "readonly", console: "readonly" },
    },
  },

  {
    plugins: {
      "react-hooks": reactHooks,
      "tabac-local": {
        rules: {
          "string-locale-compare": stringLocaleCompareRule,
          "string-only-method": stringOnlyMethodRule,
          "no-platform-breadcrumb-out-of-i18n": noPlatformBreadcrumbRule,
          "no-storage-read-after-remove": noStorageReadAfterRemoveRule,
          "no-hardcoded-lang-ternary": noHardcodedLangTernaryRule,
          "no-hardcoded-jsx-text": noHardcodedJsxTextRule,
          "no-raw-storage-write": noRawStorageWriteRule,
          "number-only-method": numberOnlyMethodRule,
          "no-fs-in-input": noFsInInputRule,
          "no-scrolling-focus": noScrollingFocusRule,
          "no-dynamic-index-plain-map": noDynamicIndexPlainMapRule,
          "no-unscoped-lot-read": noUnscopedLotReadRule,
          "no-raw-enum-render": noRawEnumRenderRule,
          "no-hex-alpha-concat": noHexAlphaConcatRule,
        },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Enforce String() coercion before .localeCompare —
      // see eslint-rules/string-locale-compare.cjs for the rationale and
      // the runtime crash this catches. "error".
      "tabac-local/string-locale-compare": "error",
      // Companion rule for the broader String-only-method
      // family. A sweep wrapped every existing site in String(...), so it
      // is now promoted to "error" (matching its string-locale-compare
      // sibling) — the codebase is clean, so any NEW unsafe String-method
      // receiver blocks CI instead of adding silent warning noise. The
      // escape hatch for a genuinely-safe-but-unprovable site is
      // `String(x)` at the call, or a scoped eslint-disable (see the
      // window.location.replace case in useGdriveAuth.ts).
      "tabac-local/string-only-method": "error",
      // Backstops the iOS/Android parity invariant. "warn"
      // because the legitimate sites are in i18n.ts and utils.ts
      // (allow-listed inside the rule itself) — anything else is the
      // start of drift. See CLAUDE.md #20.
      "tabac-local/no-platform-breadcrumb-out-of-i18n": "warn",
      // Tripwire for the OAuth read-after-clear bug
      // pattern. "error" — the pattern shipped for 8 releases and
      // dropped every Drive token until the fix landed. Tests are
      // exempted in the per-folder override below (setup code
      // legitimately removeItem-then-getItem to assert cleanup).
      "tabac-local/no-storage-read-after-remove": "error",
      // Forbid the `lang === "…" ? "text" : "text"` UI-string
      // leak. "error" — the codebase is clean after the i18n sweep,
      // so any hit is a new leak. Allow-list (i18n dicts, AI-prompt hook,
      // tests, rule files) lives inside the rule itself.
      "tabac-local/no-hardcoded-lang-ternary": "error",
      // Forbid bare JSX text literals that read like UI
      // text. "error" — pseudo-loc scan confirmed zero leaks, so any hit
      // is a new one. Allow-list (i18n dicts, tests, rule files) lives
      // inside the rule.
      "tabac-local/no-hardcoded-jsx-text": "error",
      // Forbid raw localStorage/sessionStorage writes (they throw
      // in Safari private mode / on quota). "error" — every ordinary site was
      // routed through lsSet/lsRemove; the OAuth/token/CSRF guarded paths are
      // allowlisted OFF in the per-file override below, and the few stray
      // OAuth-key writes elsewhere carry an inline eslint-disable.
      "tabac-local/no-raw-storage-write": "error",
      // Forbid .toFixed/.toPrecision/.toExponential on a
      // non-provably-number receiver (throws on a string/undefined value).
      // "error" from the start — mirrors string-only-method; the recognizer
      // exempts arithmetic / Number() / Math / parseFloat / literals so the
      // many (a/b).toFixed() sites aren't touched.
      "tabac-local/number-only-method": "error",
      // Forbid fs() on an <input>/<textarea> font size — must be
      // fsInput() (iOS zoom-on-focus floor). "error"; the codebase is clean.
      "tabac-local/no-fs-in-input": "error",
      // focus() must never move the viewport. See the rule file — the
      // defect is invisible in jsdom AND in Chromium, so only a static rule
      // holds it.
      "tabac-local/no-scrolling-focus": "error",
      // Forbid a dynamic index into a module-level plain-object
      // lookup map (prototype-pollution fall-through). "error" — the known
      // sites were hardened to Object.create(null) as they were found.
      "tabac-local/no-dynamic-index-plain-map": "error",

      // Codebase uses var throughout (migrated from JS) — TypeScript strict handles type safety
      "no-var": "off",

      // Allow explicit any — used intentionally in AppCtx (Record<string, any>)
      "@typescript-eslint/no-explicit-any": "off",

      // Allow unused vars prefixed with _
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],

      // Allow require() in config files
      "@typescript-eslint/no-require-imports": "off",

      // Empty catch blocks are common in this codebase for fire-and-forget patterns
      "no-empty": ["error", { allowEmptyCatch: true }],

      // React Compiler rules (react-hooks v5) — not applicable without the compiler
      // ref.current mutation in handlers is valid React, Date.now() in render is intentional
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
    },
  },

  // The build/check scripts — the same blind-spot class as the
  // .jsx gap above, one level worse. `npm run lint` only targeted `src/`, AND no
  // block declared the Node environment, so every `require` / `process` /
  // `console` read as an undefined global: 310 problems, ~300 of them that
  // noise, in a directory no tool was reading. Declaring the environment is what
  // makes the directory lintable at all. MUST stay after the main rules block —
  // flat config lets the LAST matching block win, and an earlier placement left
  // every override below silently ineffective (caught by re-running the probe).
  {
    // The custom rules themselves. They are CommonJS, so they
    // need the Node globals declared — without this block they were simply
    // ignored (see the ignores note at the top). Every tabac-local rule is
    // left ON for them: none of the exemptions the scripts/ block needs apply
    // here (a rule file touches no storage, renders no UI, indexes no
    // user-supplied key), and the base recommended set — no-unused-vars above
    // all — is the point of linting them at all.
    files: ["eslint-rules/**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly", module: "writable", exports: "writable",
        console: "readonly", __dirname: "readonly", __filename: "readonly",
      },
    },
  },

  {
    files: ["scripts/**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly", module: "writable", exports: "writable",
        process: "readonly", console: "readonly", Buffer: "readonly",
        __dirname: "readonly", __filename: "readonly",
        fetch: "readonly", setTimeout: "readonly",
        // The opt-in browser checks (i18n-layout / theme-contrast) pass
        // callbacks to Playwright's page.evaluate() — their BODIES execute in
        // the page, so document/localStorage/window/getComputedStyle are real
        // there even though the file itself is Node.
        document: "readonly", localStorage: "readonly", window: "readonly",
        getComputedStyle: "readonly",
      },
    },
    rules: {
      // The two coercion tripwires guard against a SILENT crash in a user's
      // browser (see their rule headers). A build script that throws fails the
      // command in front of whoever ran it — loud and immediate — and these
      // scripts parse the repo's OWN files, so there is no untrusted receiver.
      // Keeping them on would mean ~25 String(...) wraps that buy nothing.
      "tabac-local/string-only-method": "off",
      "tabac-local/number-only-method": "off",
      // A `.focus()` here SIMULATES what the browser does when a
      // user taps or tabs — the browser scrolls, so opting out would model
      // something that never happens. The rule protects production code, where
      // every focus move is ours and none is a navigation the user asked for.
      "tabac-local/no-scrolling-focus": "off",
      // Same reasoning: the prototype-safety rule is about a RUNTIME-forgeable
      // key. Here the keys come from repo-controlled data files.
      "tabac-local/no-dynamic-index-plain-map": "off",
      // The flagged setItem calls are inside a page.evaluate() seed callback:
      // they run in the PAGE, priming the app's localStorage before a render
      // pass. lsSet() is app source and does not exist in that context.
      "tabac-local/no-raw-storage-write": "off",
    },
  },

  {
    files: [
      "src/CuratorApp.tsx",
      "src/theme-curator.ts",
      "src/components/curator/**/*.{ts,tsx}",
      "src/views/curator/**/*.{ts,tsx}",
      "src/__tests__/curator/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/set-state-in-effect": "off",
      "no-empty": "off",
      "prefer-const": "off",
    },
  },

  // The two modules that DEFINE the varized tokens were the only
  // ones the alpha-concat rule could not see — theme-curator.ts sits in the
  // design-system block's `ignores` (it legitimately writes raw hex, so the
  // no-hex rule must stay off there) and constants.ts is outside the glob
  // entirely. constants.ts holds CAT_COLORS, which is var()-based, and its
  // own comment warns "use alpha(catColor(x), \"22\"), never catColor(x) + \"22\"" —
  // so the file documenting the hazard was the one unguarded against it. This
  // block turns on ONLY the alpha rule for them; the hex/fontSize selectors stay
  // off, which is why it cannot just be folded into the glob above.
  {
    files: ["src/theme-curator.ts", "src/constants.ts"],
    rules: { "tabac-local/no-hex-alpha-concat": "error" },
  },

  // Curator design-system tripwires (no-restricted-syntax), scoped to the
  // Curator SOURCE (not tests, not theme-curator.ts which DEFINES the tokens):
  //  - Every font size must flow through fs()/fsInput() so the
  //    S/M/L "Taille du texte" setting rescales it — a bare `fontSize: 56`
  //    silently opts out. Caught the three big display numerals + the
  //    cold-start loading shell that had drifted (audit).
  //  - No hardcoded hex colours — they must come from the C.*
  //    tokens (theme-curator.ts) so the palette stays retunable in one place.
  //    Covers both standalone string literals (`background: "#2a1816"`) and
  //    hex inside template literals (gradients / injected CSS). The six
  //    decorative one-off tints were consolidated into C.* first.
  {
    // The glob used to be `src/components/curator/**` + `{ts,tsx}`
    // only — so `src/components/Charts.jsx` missed on BOTH axes (wrong folder,
    // wrong extension) and the design-system tripwires had NEVER run on the one
    // module that is nothing but colour and font decisions (SVG fill, fontSize),
    // while StatsView — which delegates its entire visual output to it — was
    // fully covered. `main.jsx` and `App.tsx` were uncovered too, and App.tsx
    // carried a live violation: the light-mode page ground `#e7ddc6` duplicated
    // by hand into the theme-color meta write, with no tool watching it drift.
    // This is the ".jsx matches no config" blind spot one layer deeper: they matched
    // a config, just not the DESIGN-SYSTEM one.
    files: [
      "src/App.tsx",
      "src/main.jsx",
      "src/CuratorApp.tsx",
      "src/components/**/*.{ts,tsx,js,jsx}",
      "src/views/curator/**/*.{ts,tsx}",
    ],
    // theme-curator.ts DEFINES the tokens; EB.tsx is deliberately
    // theme-independent (the theme could be what crashed).
    ignores: ["src/theme-curator.ts", "src/components/EB.tsx"],
    rules: {
      // Enum values must render through xl(v, XXX_EN) — see
      // eslint-rules/no-raw-enum-render.cjs. Scoped to the Curator SOURCE
      // (the enum fields only mean "canonical French" in these views).
      "tabac-local/no-raw-enum-render": "error",
      // Forbid `token + "22"` / `${token}22` / `${token}${...}`
      // alpha concatenation — the palette tokens are var(), so those
      // yield invalid CSS the browser drops SILENTLY. Four live sites were
      // still shipping after a migration sweep, two doc entries and an audit
      // pass that explicitly cleared the category (each grepped one spelling).
      // See eslint-rules/no-hex-alpha-concat.cjs.
      "tabac-local/no-hex-alpha-concat": "error",
      "no-restricted-syntax": ["error",
        {
          selector: "Property[key.name='fontSize'] > Literal",
          message: "Curator font sizes must flow through fs()/fsInput() so the 'Taille du texte' setting works — wrap the value, e.g. fontSize: fs(16).",
        },
        {
          selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message: "No hardcoded hex colours in the Curator UI — use a C.* token from theme-curator.ts (add one there if none fits).",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{6}/]",
          message: "No hardcoded hex colours in the Curator UI (even inside template literals) — interpolate a C.* token, e.g. ${C.washMoss}.",
        },
        // The hex rule's blind spot. `rgba()` slipped straight past
        // it, which is exactly how BottomDock's frosted pill shipped as a raw
        // `rgba(18,24,21,0.24)` — a DARK glass that stayed dark in light mode,
        // leaving the gold dock labels at 2.27:1. Only `npm run theme:contrast`
        // caught it, and only because it renders; nothing static could see it.
        //
        // Deliberately TINTED-only. A pure-neutral rgba is a scrim or a drop
        // shadow (`rgba(0,0,0,.5)`, `rgba(255,255,255,.16)`) and reads the same
        // in both modes, so banning those would force ~24 pointless conversions
        // — and an over-strict rule gets correct code rewritten to please it.
        // A non-neutral rgba is always a palette decision, and it can only be
        // right in the one mode it was eyeballed in. Flagged exactly 2 sites on
        // its first run, both real: C.oxblood written out by hand next to a
        // border that already used alpha(C.oxblood, …), and a green-tinted
        // near-black modal scrim.
        {
          selector: String.raw`Literal[value=/rgba?\(\s*(?!0\s*,\s*0\s*,\s*0\s*[,)])(?!255\s*,\s*255\s*,\s*255\s*[,)])[0-9]/]`,
          message: "No hardcoded TINTED rgb()/rgba() in the Curator UI — it can't follow the light/dark mode (this is the BottomDock pill bug). Use alpha(C.token, \"AA\") for a translucent tint; a pure-neutral rgba(0,0,0,a) / rgba(255,255,255,a) scrim or shadow is fine.",
        },
        {
          selector: String.raw`TemplateElement[value.raw=/rgba?\(\s*(?!0\s*,\s*0\s*,\s*0\s*[,)])(?!255\s*,\s*255\s*,\s*255\s*[,)])[0-9]/]`,
          message: "No hardcoded TINTED rgb()/rgba() in the Curator UI, even inside a template literal — use alpha(C.token, \"AA\").",
        },
        // No current site; banned outright because hsl() has no neutral idiom
        // in this codebase — every use would be a palette value bypassing C.*.
        {
          selector: String.raw`Literal[value=/hsla?\(/]`,
          message: "No hardcoded hsl()/hsla() colours in the Curator UI — use a C.* token (add one to theme-curator.ts if none fits).",
        },
        {
          selector: String.raw`TemplateElement[value.raw=/hsla?\(/]`,
          message: "No hardcoded hsl()/hsla() colours in the Curator UI, even inside a template literal — use a C.* token.",
        },
      ],
    },
  },

  // The `string-only-method` runtime-safety tripwire targets
  // production code paths that handle untrusted data. Test files operate
  // on controlled fixtures (literals, known mocks), so the rule is pure
  // noise there — disable it for the whole test tree. (The error-level
  // `string-locale-compare` rule stays on everywhere, including tests.)
  {
    files: ["src/__tests__/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "tabac-local/string-only-method": "off",
      // Tests legitimately use removeItem-then-getItem to
      // assert cleanup, or to verify the rule's own behaviour in
      // processOAuthReturn tests.
      "tabac-local/no-storage-read-after-remove": "off",
      // Tests write storage directly to seed fixtures.
      "tabac-local/no-raw-storage-write": "off",
      // Tests operate on controlled numeric fixtures.
      "tabac-local/number-only-method": "off",
      // A `.focus()` here SIMULATES what the browser does when a
      // user taps or tabs — the browser scrolls, so opting out would model
      // something that never happens. The rule protects production code, where
      // every focus move is ours and none is a navigation the user asked for.
      "tabac-local/no-scrolling-focus": "off",
    },
  },

  // The OAuth / token / CSRF domain keeps its DEDICATED guarded
  // storage helpers (tkSet / hint* / dbx*) and the read-before-clear literal
  // removeItem calls the `no-storage-read-after-remove` rule depends on — so
  // `no-raw-storage-write` is disabled for these files. `appStorage.ts` IS the
  // wrapper (its own raw writes are the guarded implementation). Do NOT route
  // token/CSRF storage through lsSet — see the header comment in appStorage.ts.
  {
    files: [
      "src/utils/appStorage.ts",
      "src/hooks/useGdriveAuth.ts",
      "src/hooks/useDropboxAuth.ts",
      "src/utils/dropboxAuthCore.ts",
      "src/utils/oauthReturn.ts",
    ],
    rules: {
      "tabac-local/no-raw-storage-write": "off",
    },
  },

  // The lot-SCOPE guard, ON only where the scope actually
  // exists — the two views that render tobacco figures under an active filter.
  // Elsewhere a `.lots` read is either inside a scope helper itself
  // (cellarInsights.ts / lotUtils.ts) or unrelated to filtering, so the rule
  // would be pure noise. See eslint-rules/no-unscoped-lot-read.cjs for why
  // this is an acknowledgement rule rather than a correctness rule.
  {
    files: [
      "src/views/curator/InventoryListView.tsx",
      "src/views/curator/InventoryDetailView.tsx",
    ],
    rules: {
      "tabac-local/no-unscoped-lot-read": "error",
    },
  },
);
