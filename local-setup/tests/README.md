# Tests

## Layout

- `e2e/specs/` — Playwright end-to-end tests against a running DIGIT UI + backend stack.
- `e2e/utils/` — shared helpers (e.g. `auth.ts`'s `loginViaApi`, which injects a token via `localStorage` instead of driving the login form).
- `e2e/pages/` — page objects used by some specs.
- Jest-based schema/smoke tests live alongside the Playwright config at the top level (see `package.json`).

## Running the E2E suite

Prerequisites: the local stack must already be up (`docker compose up -d` from `local-setup/`) and the `digit-ui-esbuild` dev server running on port 18080 (`npm run dev` from `digit-ui-esbuild/`), or point `BASE_URL` at wherever the UI is actually served.

```bash
cd local-setup/tests
npm install
npm run test:e2e                 # headless
npm run test:e2e:headed          # see the browser
```

Run a single spec:

```bash
npx playwright test --config=e2e/playwright.config.ts e2e/specs/pgr-inbox-pagination.spec.ts
```

### Config

`e2e/playwright.config.ts` reads:

| Env var | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:18080` | Where the UI is served |
| `DIGIT_TENANT` | `pg.citya` | Tenant to log in as (spec-specific default, check the spec) |
| `DIGIT_USERNAME` / `DIGIT_PASSWORD` | `ADMIN` / `eGov@123` | Employee login used by `loginViaApi` |

Point these at a different environment, e.g. the live deployment:

```bash
BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke npm run test:e2e -- e2e/specs/pgr-inbox-pagination.spec.ts
```

## `pgr-inbox-pagination.spec.ts` (issue #916)

Location: `e2e/specs/pgr-inbox-pagination.spec.ts`.

Covers the PGR employee inbox pagination regression: verifies the Next-page
button is enabled once total complaints exceed one page, that clicking it
actually loads different rows, and that the pagination footer shows the real
server-side total rather than the current page's row count (the specific way
this bug kept resurfacing — see the comment block at the top of the spec for
the three separate root causes fixed across #1014/#1058 and the
products/pgr duplicate-hook fix).

Needs a tenant with more than 10 complaints in an inbox-visible status
(`PENDINGFORASSIGNMENT`/`PENDINGFORREASSIGNMENT`/`PENDINGATLME`/
`PENDINGATSUPERVISOR`) to actually exercise pagination — with 10 or fewer,
the tests skip themselves with a clear reason rather than reporting a false
pass.
