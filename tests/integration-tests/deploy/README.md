# Per-box env profiles, secrets and personas

One harness runs on every box (#2398): `develop` is tested on **naipepea**,
`master` on **Bomet**. The runner, `runner/run-cycle.sh`, the catalog and the
dashboards are the same everywhere. A box differs only in three files:

| File | Tracked | Holds |
|---|---|---|
| `deploy/<env>.env` | yes, no secrets | `BASE_URL`, `DIGIT_TENANT` (a root tenant), `IDENTITY_TEST_TENANT_SLUG`, `KC_REALM`, persona `<ROLE>_LOGIN`s, optional seed codes, `EXPECTATIONS_FILE` |
| `deploy/expectations/<env>.json` | yes | which capabilities the box must have (`required` fails when absent, `absent` skips) |
| box secrets file | **no** | persona `<ROLE>_PASSWORD`s and `IDENTITY_TEST_OTP_CODE` |

Specs gate on capabilities (`requires()` in `tests/utils/capabilities.ts`),
never on a hostname or env name. Nothing in the suite defaults to a box: an
incomplete profile stops the run in `profile-setup`, naming each missing
variable.

## The secrets file

```bash
sudo install -o digit-tests -g digit-tests -m 0600 /dev/null /etc/digit-tests/secrets.env
```

Plain `KEY=value` lines: `ADMIN_PASSWORD`, `GRO_PASSWORD`, `LME_PASSWORD`,
`WARD_CSR_PASSWORD`, `INBOX_VIEWER_PASSWORD`, `SUPERVISOR_PASSWORD` and, on a
fixed-OTP box, `IDENTITY_TEST_OTP_CODE`. `run-cycle.sh` sources it after the
env profile when `RUNNER_SECRETS_ENV` names it (add
`Environment=RUNNER_SECRETS_ENV=/etc/digit-tests/secrets.env` to the runner's
systemd unit, or export it for a nightly wrapper). Set but unreadable fails the
run with phase `failed-secrets`. Only its path is ever logged.

## Personas

Staff sign in through Keycloak with an email login and their own password, and
must be linked to a DIGIT employee at the workspace's root tenant. Six personas,
each a `<ROLE>_LOGIN` in the profile plus `<ROLE>_PASSWORD` in the secrets file:

| Role prefix | DIGIT roles | Used for |
|---|---|---|
| `ADMIN` | EMPLOYEE, SUPERUSER, ACCOUNT_ADMIN, MDMS_ADMIN, LOC_ADMIN, HRMS_ADMIN, WORKFLOW_ADMIN | Configurator specs, HRMS reads, employee invites |
| `GRO` | EMPLOYEE, GRO (+ department) | ASSIGN |
| `LME` | EMPLOYEE, PGR_LME (same department) | RESOLVE, escalate |
| `WARD_CSR` | EMPLOYEE, CSR, ward jurisdiction | boundary jurisdiction #496 |
| `INBOX_VIEWER` | EMPLOYEE, GRO, seed-locality jurisdiction | inbox specs |
| `SUPERVISOR` | EMPLOYEE, GRO, PGR_LME, SUPERVISOR | the specs' `EMPLOYEE_USER` |

`scripts/seed-personas.ts` creates and links all six, idempotently, through
public contracts only (HRMS `_create`, the Keycloak admin API, BFF
`workspace-members/_link` and the persona's `workspace-invitations/_accept`;
no mail is sent). It needs an ACCOUNT_ADMIN of the workspace as the actor (the
signup founder the first time; leave `SEED_ACTOR_PASSWORD` unset for a
magic-link founder with no password credential and it gets a one-off one, while
a login that has a password is never reset) and Keycloak admin access:

```bash
cd tests/integration-tests
set -a; source deploy/naipepea.env; [ -f /etc/digit-tests/secrets.env ] && source /etc/digit-tests/secrets.env; set +a
SEED_ACTOR_LOGIN=<founder login> SEED_ACTOR_PASSWORD=<founder password> \
IDENTITY_TEST_KEYCLOAK_ADMIN_URL=<keycloak base, e.g. http://127.0.0.1:<port>/auth> \
IDENTITY_TEST_KEYCLOAK_ADMIN_USER=<admin> IDENTITY_TEST_KEYCLOAK_ADMIN_PASSWORD=<password> \
  npx tsx scripts/seed-personas.ts --secrets-out /etc/digit-tests/secrets.env
```

Passwords already in the env are kept; missing ones are generated and written to
`--secrets-out` (mode 0600), never printed. stdout carries the `SERVICE_CODE`,
`LOCALITY_CODE` and `WARD_CSR_BOUNDARY` lines to pin in the profile, then one
verified line per persona (each signs in and selects its own employee).

## The workspace

The suite targets one root workspace whose onboarding is DONE (create it through
Configurator signup). On a tenant that predates onboarding the Configurator
sends the admin to `/onboarding/...`, and `auth.setup` fails naming that gate.

## Bomet layout

Bomet (`https://bometfeedbackhub.digit.org`) serves the same two dashboards as
naipepea. The suite runs as a black-box client against the live API.

> Read `BOMET-AGENT-BRIEFING.md` first. Never `docker compose up/down -v` or
> `--force-recreate` on the box; only additive files + a new nginx location.

```
/opt/integration-tests/
├── dist/          # vanilla dashboard + catalog.json + history.json + runs/   → /tests/
└── dist-v2/       # react-admin build; catalog.json/history.json/runs symlinked to ../dist/ → /tests-v2/
```

One-time setup:

```bash
ssh bomet 'sudo mkdir -p /opt/integration-tests/dist /opt/integration-tests/dist-v2'
ssh bomet 'sudo htpasswd -c /etc/nginx/.htpasswd-tests digit-tests'   # set a password
# add deploy/nginx-integration-tests.conf into the bomet vhost, then:
ssh bomet 'sudo nginx -t && sudo nginx -s reload'
```

Each run, from a runner that can `ssh bomet`:

```bash
make test-and-publish ENV_PROFILE=deploy/bomet.env RUNNER_SECRETS_ENV=<secrets file> HOST_SSH=bomet

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

Specs `enc-key-drift-622` (skipped), `boundary-jurisdiction-496`, and the
`complaint-attachment` detail half are **red by design** on bomet — they
are open-bug regression catchers, not failures to "fix".
