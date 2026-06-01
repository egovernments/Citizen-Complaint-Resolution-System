# Deploying the suite + dashboards to bomet

Bomet (`https://bometfeedbackhub.digit.org`) serves the same two dashboards as
naipepea, over a bomet-generated `catalog.json`. The suite runs as a black-box
client against the live API — no in-place changes to bomet's containers.

> Read `BOMET-AGENT-BRIEFING.md` first. Never `docker compose up/down -v` or
> `--force-recreate` on the box; only additive files + a new nginx location.

## Layout on the box

```
/opt/integration-tests/
├── dist/          # vanilla dashboard + catalog.json + history.json + runs/   → /integration-tests/
└── dist-v2/       # react-admin build; catalog.json/history.json/runs symlinked to ../dist/ → /integration-tests-v2/
```

## One-time box setup

```bash
ssh bomet 'sudo mkdir -p /opt/integration-tests/dist /opt/integration-tests/dist-v2'
ssh bomet 'sudo htpasswd -c /etc/nginx/.htpasswd-tests digit-tests'   # set a password
# add deploy/nginx-integration-tests.conf into the bomet vhost, then:
ssh bomet 'sudo nginx -t && sudo nginx -s reload'
```

## Each run (from a runner that can `ssh bomet`)

```bash
set -a; source deploy/bomet.env; set +a
make test-and-publish          # runs Playwright vs bomet, builds catalog, rsyncs dist/

# build + push the react-admin dashboard (v2)
( cd dashboard-react-admin && npm ci && npm run build )   # DASHBOARD_BASE from bomet.env
rsync -avh --delete dashboard-react-admin/dist/ bomet:/opt/integration-tests/dist-v2/
ssh bomet '
  cd /opt/integration-tests/dist-v2
  ln -sfn ../dist/catalog.json catalog.json
  ln -sfn ../dist/history.json history.json
  ln -sfn ../dist/runs runs
'
```

## What's bomet-specific (everything else is the naipepea default)

| Knob | naipepea | bomet | Set in |
|---|---|---|---|
| `BASE_URL` | naipepea.digit.org | bometfeedbackhub.digit.org | `bomet.env` |
| `DIGIT_TENANT` | ke.nairobi | **ke** | `bomet.env` |
| `LOCALITY_CODE` | NAIROBI_CITY_VIWANDANI | BOMET_BOMET_CENTRAL_CHESOEN | `bomet.env` |
| `SERVICE_CODE` | IllegalConstruction | RudeBehavior (exists on bomet) | `bomet.env` |
| `HOST_DIR` | /var/www/tests | /opt/integration-tests/dist | `bomet.env` |
| `DASHBOARD_BASE` | /tests-v2/ | /integration-tests-v2/ | `bomet.env` |
| nginx path | /tests/, /tests-v2/ | /integration-tests/, /integration-tests-v2/ | `nginx-integration-tests.conf` |
| persona users | BOMET_LME etc. | **same** | already default in `tests/utils/env.ts` |

Specs `enc-key-drift-622` (skipped), `boundary-jurisdiction-496`, and the
`complaint-attachment-555` detail half are **red by design** on bomet — they
are open-bug regression catchers, not failures to "fix".
