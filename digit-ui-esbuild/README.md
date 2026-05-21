# digit-ui-esbuild

DIGIT UI rebuilt with [esbuild](https://esbuild.github.io/) for fast builds. Uses git subtree to pull upstream DIGIT UI modules from two repos into a single, unified build.

## Why esbuild?

The upstream DIGIT UI uses Create React App (webpack) with a multi-package micro-frontend architecture. Each module builds independently via `npm run build` + webpack, producing separate bundles that are loaded at runtime. This architecture causes:

- **Slow builds**: Full webpack build across all modules takes 3-5 minutes
- **Slow dev iteration**: Hot reload restarts the webpack dev server, taking 30-60 seconds per change
- **Duplicate dependencies**: Each module bundles its own copy of React, Redux, etc.
- **Complex build orchestration**: Need to build/link packages in dependency order

esbuild replaces all of this with a single-pass bundler:

| Metric | Webpack (CRA) | esbuild |
|--------|---------------|---------|
| Production build | 3-5 min | **< 1 sec** |
| Dev rebuild on change | 30-60 sec | **~50 ms** |
| Bundle output | Multiple chunks per module | Single JS + CSS |
| Config complexity | Per-module webpack configs | One `esbuild.build.js` |

### Build performance

```
$ time npm run build

  build/index.js    8.1mb
  build/index.css  21.0kb

⚡ Done in 690ms
```

~100K lines of source code across 2,855 files, 10 modules and 5 library packages — bundled in under 1 second.

### Dev server rebuild

The dev server (`npm run dev`) uses esbuild's incremental build with live reload. When you edit any file in any module, the rebuild completes in ~50ms and the browser refreshes automatically. No manual rebuilds, no package linking, no waiting.

## Modules

Upstream DIGIT modules live in `packages/` (via git subtree). Product-specific customizations live in `products/`:

| Module | Package | Source |
|--------|---------|--------|
| Core | `@egovernments/digit-ui-module-core` | `packages/modules/core/` |
| **PGR (CCRS)** | `@egovernments/digit-ui-module-pgr` | **`products/pgr/`** |
| HRMS | `@egovernments/digit-ui-module-hrms` | `packages/modules/hrms/` |
| Utilities | `@egovernments/digit-ui-module-utilities` | `packages/modules/utilities/` |
| Workbench | `@egovernments/digit-ui-module-workbench` | `packages/modules/workbench/` |
| Common | `@egovernments/digit-ui-module-common` | `packages/modules/common/` |

The PGR module uses the CCRS-customized version from `products/pgr/` which adds boundary-based workflows, map-based geolocation (Leaflet), MDMS-driven inbox, and complaint photo galleries on top of the upstream PGR module.

Libraries: `digit-ui-libraries`, `digit-ui-react-components`, `digit-ui-components`, `digit-ui-svg-components`, `digit-ui-css`

## Quick start

```bash
# Install dependencies
npm install --legacy-peer-deps

# Development server (port 18080, live reload, API proxy to Kong)
npm run dev

# Production build
npm run build

# Docker image (nginx serving the built bundle)
npm run build:docker
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with live reload at `http://localhost:18080` |
| `npm run build` | Production build to `build/` |
| `npm run build:docker` | Build Docker image `digit-ui:esbuild` |
| `npm run check-aliases` | Verify all module aliases resolve to real files |

## CI

GitHub Actions runs on every push and PR to `main`:

1. **Install + Build** — `npm ci` then `npm run build` with build time tracking
2. **Build performance** — reports build time, JS/CSS sizes, and source file count in the GitHub step summary
3. **Alias check** — verifies all `@egovernments/*` aliases resolve to real files
4. **Docker build** — verifies the multi-stage Dockerfile produces a working nginx image

## Testing

End-to-end and integration tests live in the sibling repo [`ChakshuGautam/digit-integration-tests`](https://github.com/ChakshuGautam/digit-integration-tests). Those specs run against real DIGIT deployments (naipepea, bomet) so they cover the actual bundle shipped from this repo — no local mock-server fork to drift.

## Architecture

```
src/index.js            → App entry point (bootstrap, session restore)
src/App.js              → Module initialization, DigitUI wrapper
esbuild.build.js        → Production build config (aliases, plugins, loaders)
esbuild.dev.js          → Dev server config (live reload, API proxy)
public/index.html       → HTML template (CDN CSS/JS, globalConfigs)
public/globalConfigs.js → Runtime config (tenant, auth provider, locale)
docker/Dockerfile       → Multi-stage build (node → nginx)
docker/nginx.conf       → SPA routing config
packages/               → Upstream DIGIT UI modules and libraries (git subtree)
products/pgr/           → CCRS PGR module (product customization)
scripts/check-aliases.js → CI alias verification
```

### How esbuild replaces the micro-frontend architecture

Instead of building each `@egovernments/*` package independently and publishing to npm, esbuild resolves them directly to local source files via the `alias` map in `esbuild.build.js`:

```js
alias: {
  "@egovernments/digit-ui-module-pgr": "packages/modules/pgr/src/Module.js",
  "@egovernments/digit-ui-libraries": "packages/libraries/src/index.js",
  // ... all modules and libraries
}
```

This means:
- Zero package publishing — edit any module source, rebuild in < 1 second
- Single dependency tree — React, Redux, etc. are resolved once
- No `npm link` or workspaces needed
- Import paths in upstream code (`import { X } from "@egovernments/..."`) work unchanged

## Theming

Runtime theming is driven by CSS custom properties on `:root`. The flow:

1. `scripts/vendor-digit-ui-css.js` fetches three upstream `@egovernments/*-css` packages from unpkg — `digit-ui-css`, `digit-ui-components-css`, `digit-ui-health-css` — rewrites themeable hex literals to `var(--color-*, fallback)` in each, prepends a `:root` block to the first output, and writes `public/vendor/<name>.css` + `<name>.original.css`. The `.original.css` snapshots are gitignored and excluded from production builds; they exist only for local diffing.
2. `public/index.html` loads the three transformed files from the local vendor path, replacing the former CDN URLs.
3. `src/theme/applyTheme.js` flattens a nested JSON config and writes each leaf to `document.documentElement` at app startup (module load). `src/index.js` calls it with the bundled `src/theme/default.json`.
4. Phase 2 (future, not implemented): replace the bundled JSON with an MDMS fetch keyed by the authenticated user's `tenantId`. See the commented hook in `src/index.js`'s `bootstrap()`.

**Token coverage**: the 28 tokens in `src/theme/schema.json` map to ~1,400 sites across the three vendored files (~570 in `digit-ui-css`, ~510 in `digit-ui-components-css`, ~316 in `digit-ui-health-css`). Follow-up tickets add tokens for the high-frequency remaining greys and a primary-hover variant surfaced by a Phase-2 audit.

The `predev` and `prebuild` npm hooks run the vendor script automatically before `dev` and `build`. To regenerate manually:

```bash
node scripts/vendor-digit-ui-css.js
```

Schema for theme configs lives in `src/theme/schema.json`.
