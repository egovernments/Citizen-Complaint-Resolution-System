# Per-box env profiles, secrets and personas

This suite targets develop-shaped deployments only (#2398): one root workspace
created through Configurator signup, staff signing in through the Identity BFF
and Keycloak. `develop` is tested on **naipepea**. Older deployments (Bomet on
`master`, the `pg` playground, city tenants) run the suite from the branch they
deploy; nothing here keeps them working. The runner, `runner/run-cycle.sh`, the
catalog and the dashboards are the same on every box, which differs only in
three files:

| File | Tracked | Holds |
|---|---|---|
| `deploy/<env>.env` | yes, no secrets | `BASE_URL`, `DIGIT_TENANT` (a root tenant), `IDENTITY_TEST_TENANT_SLUG`, `KC_REALM`, persona `<ROLE>_LOGIN`s, optional seed codes, `EXPECTATIONS_FILE` |
| `deploy/expectations/<env>.json` | yes | which capabilities the box must have (`required` fails when absent, `absent` skips) |
| box secrets file | **no** | persona `<ROLE>_PASSWORD`s, `LOGIN_PROBE_PASSWORD` and `IDENTITY_TEST_OTP_CODE` |

Specs gate on capabilities (`requires()` in `tests/utils/capabilities.ts`),
never on a hostname or env name. Nothing in the suite defaults to a box: an
incomplete profile stops the run in `profile-setup`, naming each missing
variable.

## The secrets file

```bash
sudo install -o digit-tests -g digit-tests -m 0600 /dev/null /etc/digit-tests/secrets.env
```

`KEY=value` lines (`seed-personas.ts` writes them single-quoted):
`ADMIN_PASSWORD`, `GRO_PASSWORD`, `LME_PASSWORD`, `WARD_CSR_PASSWORD`,
`INBOX_VIEWER_PASSWORD`, `SUPERVISOR_PASSWORD`, `LOGIN_PROBE_PASSWORD` and the
box's fixed citizen OTP, `IDENTITY_TEST_OTP_CODE` (citizen-setup stops the run
naming it when it is missing). `run-cycle.sh` sources it after the env profile
when `RUNNER_SECRETS_ENV` names it. The runner's systemd unit
(`local-setup/ansible/templates/integration-tests-runner.service.j2`) sets
`RUNNER_SECRETS_ENV=/etc/digit-tests/secrets.env`, or
`integration_tests_runner_secrets_env`; export it yourself for a nightly
wrapper. Set but unreadable fails the run with phase `failed-secrets`. Only its
path is ever logged.

## Personas

Staff sign in through Keycloak with an email login and their own password, and
must be linked to a DIGIT employee at the workspace's root tenant. Six personas,
each a `<ROLE>_LOGIN` in the profile plus `<ROLE>_PASSWORD` in the secrets file:

| Role prefix | DIGIT roles | Used for |
|---|---|---|
| `ADMIN` | EMPLOYEE, SUPERUSER, ACCOUNT_ADMIN, MDMS_ADMIN, LOC_ADMIN, HRMS_ADMIN, WORKFLOW_ADMIN, CSR, GRO, PGR_LME, SUPERVISOR | Configurator specs, HRMS reads, employee invites, complaints filed and assigned from admin surfaces |
| `GRO` | EMPLOYEE, GRO (+ department) | ASSIGN |
| `LME` | EMPLOYEE, PGR_LME (same department) | RESOLVE, escalate |
| `WARD_CSR` | EMPLOYEE, CSR, ward jurisdiction | boundary jurisdiction #496 |
| `INBOX_VIEWER` | EMPLOYEE, GRO, PGR_LME, seed-locality jurisdiction | inbox specs (they assign their seed complaint to it) |
| `SUPERVISOR` | EMPLOYEE, GRO, PGR_LME, SUPERVISOR | the specs' `EMPLOYEE_USER` |

`LOGIN_PROBE_LOGIN` (with `LOGIN_PROBE_PASSWORD`) is a seventh login, in
Keycloak only, with no DIGIT user or roles: `employee/login.spec.ts` posts wrong
passwords to it, so brute-force lockout never lands on a persona. That spec
fails when it is unset.

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

Passwords already in the env are kept; missing ones are generated, and each is
written to `--secrets-out` (mode 0600) once its Keycloak login holds it, never
printed, so a run that stops part-way can simply be run again. stdout carries the `SERVICE_CODE`,
`LOCALITY_CODE` and `WARD_CSR_BOUNDARY` lines to pin in the profile, then one
verified line per persona (each signs in and selects its own employee).

## The workspace

The suite targets one root workspace whose onboarding is DONE (create it through
Configurator signup). On a tenant that predates onboarding the Configurator
sends the admin to `/onboarding/...`, and `auth.setup` fails naming that gate.
