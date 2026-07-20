# Test catalog dashboard — design

Status: approved. To be implemented next.

## Why

Today the suite produces a Playwright HTML report scoped to one run, with videos
and traces only for failed tests (`retain-on-failure`). Two consequences:

1. There is no way to ask "is this Playwright test actually testing the right
   thing?" for a passing test, because no video is recorded.
2. There is no cross-run view: regression patterns ("this test has been red for
   three nights running") are invisible without manually diffing past reports.

The user wants a deployed page that lists every test case with metadata, lets
them filter by tags, and links to a video and trace for each test in the
latest run — so a human (or Claude) can validate that the assertions match
intent and prompt fixes when they don't.

## Topology

```
┌──────────────────────┐    rsync over     ┌──────────────────────────────┐
│ Runner: 10.0.0.6     │   VPC SSH         │ Host: Nairobi 10.0.0.5       │
│ (mh-iterations)      │ ─────────────────▶│ (egov-nairobi)               │
│ Docker + Node 20     │                   │ Existing nginx + wildcard    │
│ Cron + on-demand     │                   │ cert. New /tests/ location   │
│ Tests run against    │                   │ behind HTTP basic-auth.      │
│ naipepea.digit.org   │                   │ /var/www/tests/ holds        │
│ (or BASE_URL=…)      │                   │ catalog + last 5 run dirs.   │
└──────────────────────┘                   └──────────────────────────────┘
```

- Runner: `10.0.0.6` already has Docker + nginx + ~69 GB free.
- Host: Nairobi (more headroom than Bomet, Bomet is demo-active).
- URL: `https://naipepea.digit.org/tests/` — no new DNS or cert.
- Auth: HTTP basic-auth on `/tests/` (single rotated password). Screenshots
  capture real Nairobi data; not safe to leave fully public.
- Trigger: cron 02:00 UTC + manual `make test-and-publish` from the runner.
  Branch overridable via `BRANCH=feature/foo make test-and-publish`.

## Components to build

| # | Component | Location | Purpose |
|---|---|---|---|
| 1 | `playwright.config.ts` flip | repo root | `video: 'on'`, `trace: 'on'`, `screenshot: 'on'`; add `['json', { outputFile: 'report.json' }]` reporter |
| 2 | Tags on every test | `tests/**/*.spec.ts` | Add `{ tag: ['@persona:…','@area:…','@layer:…','@kind:…'] }` (and `@ccrs:N` where applicable) to every `test()` call |
| 3 | `scripts/build-catalog.ts` | repo `scripts/` | Ingest `report.json`, walk specs via TS AST to extract title/file/line/tags/source, merge with `history.json` from host, emit `catalog.json` |
| 4 | `dashboard/` SPA | repo, deployed static | Single `index.html` + one `app.js` (vanilla JS, no framework). Reads `catalog.json`, renders facet sidebar + table + per-test detail page with embedded video/trace/source |
| 5 | `scripts/publish.sh` | repo `scripts/` | rsync `playwright-report/`, `dashboard/`, `catalog.json` to `egov-nairobi:/var/www/tests/`. Prune runs older than 5. |
| 6 | nginx vhost patch | `/etc/nginx/sites-available/naipepea` on host | Add `location /tests/ { auth_basic on; root /var/www; autoindex on; }` and an `auth_basic_user_file` |
| 7 | `Makefile` target | repo root | `make test-and-publish` chains run → build-catalog → publish |
| 8 | Cron entry | `/etc/cron.d/digit-tests` on runner | `0 2 * * * cd /opt/digit-integration-tests && make test-and-publish >> /var/log/digit-tests.log 2>&1` |

No framework for the dashboard. Catalog has at most a few hundred rows; vanilla
JS keeps it boring and fast. Trend charts can come later.

## Tag taxonomy

Five required facets, two optional:

| Facet | Values | Required |
|---|---|---|
| Persona | `@persona:citizen` `@persona:employee` `@persona:admin` `@persona:cross` | yes |
| Area | `@area:onboarding` `@area:pgr` `@area:configurator-manage` `@area:theme` `@area:auth` `@area:localization` `@area:hrms` `@area:mdms-schema` `@area:dashboard` | yes (one or more) |
| Layer | `@layer:ui` `@layer:api` | yes |
| Kind | `@kind:smoke` `@kind:regression` `@kind:happy-path` `@kind:edge-case` `@kind:lifecycle` | yes |
| Ticket | `@ccrs:NNN` `@pr:NN` | when applicable |
| Health | `@health:flaky` `@health:known-fail` `@health:slow` | as observed |

Example after tagging:

```ts
test('no Username input field exists (#460)', {
  tag: ['@persona:admin', '@area:configurator-manage', '@area:hrms',
        '@layer:ui', '@kind:regression', '@ccrs:460'],
}, async ({ page }) => { … });
```

The dashboard groups tags by prefix (`persona:`, `area:`, etc.) into separate
filter sections. Multi-select within a section ORs; across sections ANDs.

## Data shapes

### `catalog.json` (regenerated each run, served as static asset)

```jsonc
{
  "generatedAt": "2026-05-07T14:00:00Z",
  "lastRunId": "2026-05-07_0200_a1b2c3d",
  "tagFacets": {
    "persona": ["citizen","employee","admin","cross"],
    "area":    ["onboarding","pgr","configurator-manage", "..."],
    "layer":   ["ui","api"],
    "kind":    ["smoke","regression","happy-path","edge-case","lifecycle"],
    "ccrs":    ["458","460","471", "..."],
    "health":  ["flaky","known-fail","slow"]
  },
  "tests": [
    {
      "id": "tests/specs/configurator/employee-create.spec.ts:17:no Username input field exists (#460)",
      "title": "no Username input field exists (#460)",
      "describe": "Employee Create (#458, #460, #471)",
      "file": "tests/specs/configurator/employee-create.spec.ts",
      "line": 17,
      "tags": ["@persona:admin","@area:configurator-manage","@area:hrms","@layer:ui","@kind:regression","@ccrs:460"],
      "source": "<verbatim test() block>",
      "lastStatus": "passed",
      "lastDurationMs": 4321,
      "history": [
        {"runId":"2026-05-07_0200_a1b2c3d","status":"passed","durationMs":4321},
        {"runId":"2026-05-06_0200_9f8e7d6","status":"failed","durationMs":12000}
      ],
      "latestRun": {
        "runId": "2026-05-07_0200_a1b2c3d",
        "videoUrl":      "/tests/runs/2026-05-07_0200_a1b2c3d/playwright-report/data/video-abc123.webm",
        "traceUrl":      "/tests/runs/2026-05-07_0200_a1b2c3d/trace/index.html?trace=...",
        "screenshotUrls":["/tests/runs/2026-05-07_0200_a1b2c3d/playwright-report/data/screenshot-def456.png"],
        "errorMessage":  null,
        "errorStack":    null
      }
    }
  ],
  "runs": [
    {"id":"2026-05-07_0200_a1b2c3d","startedAt":"2026-05-07T02:00:11Z","durationMs":1650000,"passed":91,"failed":39,"skipped":5,"didNotRun":56,"sha":"a1b2c3d","branch":"main","baseUrl":"https://naipepea.digit.org"}
  ]
}
```

`history` and on-disk `runs/` both bounded to **5** entries.

### On-disk layout on `egov-nairobi:/var/www/tests/`

```
/var/www/tests/
├── index.html              ← dashboard SPA entrypoint
├── app.js
├── styles.css
├── catalog.json            ← regenerated each run
├── history.json            ← rolling 5 runs, used by build-catalog merge
└── runs/
    ├── 2026-05-07_0200_a1b2c3d/
    │   ├── playwright-report/   ← stock Playwright HTML (full report)
    │   │   ├── index.html
    │   │   └── data/...
    │   └── report.json          ← raw JSON
    └── ...up to 5 dirs...
```

## Dashboard UX

**Index (`/tests/`)**:
1. Header: latest run summary (`91 passed · 39 failed · 5 skipped — sha a1b2c3d, 2h ago`).
2. Sidebar: facet filters (Persona / Area / Layer / Kind / Ticket / Health). Multi-select inside each, AND across.
3. Table: one row per test. Columns: title, persona, area, last 5 runs (sparkline of green/red dots), latest duration. Click → detail page.

**Test detail (`/tests/#test/<urlencoded-id>`)**:
1. Title + tag chips (clickable to add to filter).
2. Last 5 runs as a dot row, hover for run-id + duration.
3. Embedded `<video>` of latest run.
4. "Open trace" button → stock Playwright trace viewer (loaded from the run's `playwright-report/`).
5. Screenshot thumbnails (click to expand).
6. Error message + stack if last run failed.
7. Full test source, syntax-highlighted, with a "Copy as Claude prompt" button. The prompt is:

   ```
   This Playwright test is at <file>:<line>:
   <verbatim source>
   The latest video is at <videoUrl>.
   The test passed/failed in the latest run with: <error or "no error">.
   ```

   That closes the validate-then-fix loop the user described.

## Operational flow

**Bootstrap (one-time):**
1. Runner: `git clone digit-integration-tests` → `/opt/digit-integration-tests`. Install Node 20, Playwright. Generate SSH key, install pubkey on `egov-nairobi`. Drop cron entry.
2. Host: `mkdir /var/www/tests`, generate `/etc/nginx/.htpasswd-tests`, add `location /tests/` block, `nginx -s reload`.
3. Push initial dashboard assets once.

**Each run on `10.0.0.6`:**
1. `git fetch && git reset --hard origin/${BRANCH:-main}` — record SHA.
2. `npm ci` if `package-lock.json` changed.
3. Pull latest `history.json` from host.
4. `RUN_ID=$(date -u +%Y-%m-%d_%H%M)_$(git rev-parse --short HEAD)`.
5. `BASE_URL=https://naipepea.digit.org DIGIT_TENANT=ke.nairobi timeout 60m npx playwright test --reporter=list,html,json`.
6. `node scripts/build-catalog.ts "$RUN_ID"` — emit `catalog.json` + new `history.json`.
7. `scripts/publish.sh "$RUN_ID"` — rsync to host, prune old runs.

## Error handling

| Failure mode | Behavior |
|---|---|
| Playwright never finishes | `timeout 60m` kills it; logged to `/var/log/digit-tests.log`; previous run stays live on dashboard. |
| Some tests fail (normal) | Not an error. Publish anyway. Dashboard reflects red. |
| `report.json` missing/empty | `build-catalog.ts` exits non-zero; `publish.sh` skipped; previous run stays. |
| rsync fails | retry once after 30s; if still failing, leave artifacts on runner, log, next run picks up. |
| Concurrent runs (manual + cron collide) | `flock /tmp/digit-tests.lock`; second invocation exits "already running". |
| Disk fill on host | `publish.sh` prunes oldest run dir before rsync; if free space still <5 GB, abort and log. |
| Tag parse fail in a spec | catalog records test with `tags: []` and a `parseError` field; dashboard shows ⚠ next to the row. |

## Tests for the test infra

- `build-catalog.ts` unit tests with a hand-rolled `report.json` fixture covering: brand-new test, repeat (history merge), parseError, no tags, removed test (gone from current run).
- `publish.sh` smoke (manual, against a fake host).
- A self-test in the suite — `tests/specs/dashboard.spec.ts` loads `index.html` against a fixture `catalog.json` and asserts filter behavior. Tagged `@persona:cross @area:dashboard @layer:ui @kind:smoke`.

## Out of scope for v1

- Slack/email notifications on new failures. Adding a single webhook line to `publish.sh` is one-evening work; deferring until the dashboard is in use.
- Trend charts beyond the 5-dot sparkline.
- Multiple BASE_URLs per run (Nairobi + Bomet matrix). For v1 a run is single-tenant; if a Bomet pass is needed it's a separate cron entry.
- Comparing tests across branches.
- Auth beyond HTTP basic — no SSO, no per-user views.
