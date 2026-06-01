# Test catalog dashboard — react-admin rebuild

This is the WIP react-admin rebuild of the test catalog dashboard, tracked by
[issue #23](https://github.com/ChakshuGautam/digit-integration-tests/issues/23).

The current vanilla-JS dashboard at [`/dashboard`](../dashboard/) is fully
functional and serves at https://naipepea.digit.org/tests/. This rebuild
preserves the same `catalog.json` schema and pipeline (no changes to the
runner, `scripts/build-catalog.ts`, or `scripts/publish.sh`) so swapping the
front-end is a drop-in.

## Status

- [x] Vite + React 19 + react-admin scaffolding
- [x] In-memory `dataProvider` over `/tests/catalog.json` (read-only)
- [x] `tests` resource — list with facet filters (persona/area/layer/kind),
      show with description, video, source, tags
- [x] `runs` resource — list with summary, show links to standalone
      Playwright report
- [ ] Per-test sparkline of last 5 runs in the list
- [ ] "Copy as Claude prompt" action on the show page
- [ ] Trace-zip viewer link on the show page
- [ ] Theme tokens matched to the configurator's palette
- [ ] Build + deploy step plumbed into `scripts/publish.sh` (replaces the
      vanilla `dashboard/` rsync block)

See issue #23 for the full migration plan and acceptance criteria.

## Local development

```bash
cd dashboard-react-admin
npm install
TESTS_BASIC_AUTH=digit-tests:<password> npm run dev
# Open http://localhost:5173/tests/
```

The dev server proxies `/tests/*` to https://naipepea.digit.org so the
dataProvider sees real catalog data without CORS or auth fuss. Provide
basic-auth creds via the `TESTS_BASIC_AUTH` env var (format: `user:pass`).

## Deployment (when ready to swap)

`npm run build` produces `dist/`. The publish pipeline will rsync that
to `/var/www/tests/` on the host, replacing the current vanilla
`dashboard/`. Until that swap, this app is built independently and the
production dashboard remains the vanilla one.
