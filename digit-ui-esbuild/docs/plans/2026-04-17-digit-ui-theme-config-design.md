# DIGIT UI Runtime Theme Config — Design

**Ticket**: TASK-021 / [theflywheel/digit-ui-esbuild#1](https://github.com/theflywheel/digit-ui-esbuild/issues/1)
**POC branch**: `poc/theme-config`
**Status**: Design validated via POC on 2026-04-17; scaling plan pending.

## Problem

Theming today is build-time and single-palette. `packages/css/tailwind.config.js` hardcodes one palette (primary `#c84c0e`, secondary `#22394D`, plus a `digitv2` token block). SCSS partials reference tokens via `theme(colors.*)`; raw hex literals are also scattered in partials. Changing the rendered colors requires rebuilding and republishing the `@egovernments/digit-ui-css` package.

## Goal

Move themeable colors to CSS custom properties on `:root` so they can be overridden at runtime from a JSON config. Phase 1 ships a bundled default JSON. Phase 2 replaces the source with an MDMS fetch keyed by the authenticated user's `tenantId`, resolved once per session and frozen after login.

## Scope

| In scope | Out of scope |
|---|---|
| All color tokens currently defined in the Tailwind palette (primary, secondary, text, link, border, error, success, grey, `digitv2.lightTheme`, `digitv2.alert`, `digitv2.chart`) | Typography, spacing, radii, shadows, font-family |
| Runtime override via JSON config | Dark mode, multi-theme simultaneous render, mid-session re-theming |
| Phase-2 **hook site** (stub) in bootstrap | Phase-2 MDMS schema / fetch / error handling (separate ticket before Phase 2 ships) |
| Production build parity (`esbuild.build.js`) | Publishing a new `@egovernments/digit-ui-css` version |
| Migrating raw hex literals in SCSS partials to tokens | — deferred to [#2 / TASK-022](https://github.com/theflywheel/digit-ui-esbuild/issues/2) |

## Architecture

Three layers, each independently verifiable.

### 1. Vendor-and-transform CSS pipeline

The upstream `@egovernments/digit-ui-css` is loaded from CDN (unpkg). `packages/css/` builds via a gulp pipeline that won't install on Node 18 (node-sass 4.14 is incompatible). Rather than migrate the build, we vendor the upstream CSS and rewrite themeable hex literals in place:

```
scripts/vendor-digit-ui-css.js
  ↓ fetches https://unpkg.com/@egovernments/digit-ui-css@<VERSION>/dist/index.css
  ↓ replaces #c84c0e etc. with var(--color-*, fallback)
  ↓ prepends :root { --color-*: … } with upstream defaults
  → public/vendor/digit-ui-css.css
```

The transform is idempotent, uses a negative lookahead to avoid matching longer hex colors (`#c84c0ea0` is left alone), and emits a count per token for easy verification.

### 2. `:root` defaults + Tailwind indirection

`:root` defaults are prepended by the transform script — no JS required for correct first paint. The fallback in each `var(--color-*, <hex>)` provides a second layer of safety if the `:root` block is ever lost.

A future ticket (not this one) can migrate `packages/css/tailwind.config.js` to emit `var(--color-*)` directly once the gulp→esbuild migration is viable (currently blocked by node-sass 4.14 + Node 18).

### 3. Runtime loader

`src/theme/applyTheme.js` walks a nested JSON config, flattens paths into flat kebab-case variable names (`colors.primary.main` → `--color-primary-main`), and calls `document.documentElement.style.setProperty()` per leaf.

Config shape (nested JSON, flat CSS vars):
```json
{
  "version": "1",
  "name": "default",
  "colors": {
    "primary": { "light": "#F18F5E", "main": "#c84c0e", "dark": "#C8602B" },
    "digitv2": { "primary-bg": "#FEEFE7" }
  }
}
```
Nested is authored; flat is generated. One deterministic path-join function means the transform script, the `:root` block, and the runtime loader all agree on names without a lookup table.

## Bootstrap flow

### Phase 1 (this ticket)

```
src/index.js
  → applyTheme(defaultTheme)   // bundled JSON, tenant-independent
  → initLibraries()
  → bootstrap()                 // resolves Employee.tenantId / Citizen.tenantId from session
  → ReactDOM.render()
```

`applyTheme` runs before React mounts, writes all tokens to `:root` style. First paint uses the prepended `:root` defaults (no JS dependency); the setProperty call from `applyTheme(defaultTheme)` is a no-op for value parity but exercises the code path that Phase 2 reuses.

### Phase 2 (future, separate ticket)

```
bootstrap()
  → resolve tenantId
  → const cfg = await fetchThemeFromMDMS(tenantId)  // new
  → if (cfg) applyTheme(cfg); else keep defaults
  → ReactDOM.render()
```

The hook site ships as a commented placeholder in this ticket so Phase 2 lands as a single-file diff.

## Error handling & fallback

| Failure | Behavior |
|---|---|
| Invalid config (shape, types) | `applyTheme` validates against `schema.json` (ajv); on failure logs and returns early — `:root` defaults untouched |
| Missing leaf (schema-evolved forward) | Loader uses schema's `default`; logs once per missing token |
| Phase-2 MDMS fetch fails / times out | Swallow, log, keep `:root` defaults |
| CSS var override fails silently (unsupported browser) | `var(--color-*, <hex>)` fallback renders the shipped palette |

## Testing

| Layer | Test |
|---|---|
| Transform | Script re-run produces identical output; replacement count matches expected per token |
| Loader (unit) | Valid / invalid / partial config — three cases via jest or equivalent (check what's wired) |
| Integration | Playwright: load app, read `--color-primary-main`, override to a distinct color via `setProperty`, assert rendered screenshot differs |
| Regression | Existing smoke test still passes |

## POC evidence (2026-04-17)

- `scripts/vendor-digit-ui-css.js` produces `public/vendor/digit-ui-css.css` with 168 `var(--color-*)` replacements (162 primary.main, 2 each for light/dark/digitv2.primary-bg) and a 4-var `:root` block at the top.
- `public/index.html` swapped from `unpkg.com/@egovernments/digit-ui-css@1.8.37/…` to `/digit-ui/vendor/digit-ui-css.css`.
- `esbuild.dev.js` serves `public/vendor/*` at `/digit-ui/vendor/*`.
- `src/theme/applyTheme.js` writes flattened tokens to `documentElement.style`.
- `src/index.js` calls `applyTheme(defaultTheme)` before `initLibraries()`.
- `tests/theme-poc.spec.js` (Playwright): launches the app, reads `--color-primary-main` (`#c84c0e`), overrides to `#7c3aed`, asserts both the CSSOM value change and a non-identical before/after screenshot. **Passes.** Visual diff: "Forgot Password?" link flips orange → purple.

## Scaling plan (not implemented yet)

Delivered as the writing-plans output, not here. In summary:

1. Expand `TOKENS` in `scripts/vendor-digit-ui-css.js` to cover every color in the original Tailwind palette. Verify replacement counts per token are non-zero; investigate any zero-replacement token (may indicate a color that's never used, or a new hex variant to map).
2. Expand `:root` block and `src/theme/default.json` accordingly; author `src/theme/schema.json`.
3. Add ajv-based validation to `applyTheme`.
4. Add Phase-2 hook-site stub in `src/index.js`'s `bootstrap()`.
5. Extend `esbuild.build.js` (production build) with the same vendor-CSS serving path.
6. Separate out the pre-existing side-fixes (MdmsService export, APPLY_FILTER import) into their own commit.
7. Unit + Playwright tests per the Testing matrix above.

## Open questions (defer to scaling ticket)

- Do we track `public/vendor/digit-ui-css.original.css` in git (~500KB) or regenerate on prebuild? Proposal: gitignore the original, commit only the transformed `digit-ui-css.css` + the script.
- Whether to expose a QA-only override (query string or localStorage) for theme preview. Nice-to-have; propose deferring until Phase 2.
- MDMS schema design (module, master, tenant scope) — separate ticket before Phase 2 ships.
