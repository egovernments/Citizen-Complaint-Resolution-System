# CCRS test infrastructure

Two subtrees, intentionally separate:

| Path | What it holds | Status |
|---|---|---|
| `tests/integration-tests/` | Canonical persona-organised Playwright suite (admin / citizen / employee / lifecycle) — vendored from [`ChakshuGautam/digit-integration-tests`](https://github.com/ChakshuGautam/digit-integration-tests) | Active — new specs go here |
| `tests/integration-tests/dashboard-react-admin/` | Vite + React + react-admin viewer for the catalog + run reports | Active (parallel to legacy `/tests/` viewer until feature-parity ships) |

## Quick start

```bash
cd tests/integration-tests
npm install
npx playwright install chromium

# Default: targets naipepea (Nairobi)
npm test

# Per-persona
npm run test:citizen
npm run test:employee
npm run test:admin
npm run test:lifecycle

# Different deployment — env-driven (see .env.example)
BASE_URL=https://bometfeedbackhub.digit.org \
DIGIT_TENANT=ke \
ROOT_TENANT=ke \
TENANT_LABEL="Bomet County" \
  npm test
```

For the catalog dashboard:

```bash
cd tests/integration-tests/dashboard-react-admin
npm install
npm run dev    # → http://localhost:5173/tests-v2/
npm run build  # → dist/ for static serving
```

## Why two subtrees

- **`integration-tests/`** is the canonical home — env-driven, tenant-agnostic, organised by persona. New work lands here.
- **`dashboard-react-admin/`** is part of integration-tests (its catalog viewer) — kept as a sibling so it can build/serve independently.

The vendoring follows the same pattern as `configurator/` and `digit-ui-esbuild/` — the canonical source-of-truth is the upstream repo (`ChakshuGautam/digit-integration-tests`), CCRS holds a vendored copy so all testing infra lives under one tree and ships with the monorepo.
