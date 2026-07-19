# PGR Supervisor Dashboard — VERIFIED Login Matrix (bomet)

All rows below were verified **live** on bomet on 2026-07-09 against the running
`egov-user` service via Kong (`http://127.0.0.1:18000`). Password for every seeded
user is `eGov@123`. Reproduce with `./verify-login-matrix.sh` (in this folder).

## The gate (source of truth)

The dashboard HOME CARD and the `/employee/dashboard` route are gated **in the
frontend** by `DASHBOARD_ROLES`, checked tenant-agnostically via
`Digit.UserService.hasAccess(...)` (role CODE only, any tenant):

```
digit-ui-esbuild/products/dashboard/roles.js
  export const DASHBOARD_ROLES =
    ["SUPERVISOR", "PGR_SUPERVISOR", "GRO", "DGRO", "PGR_LME", "PGR_ADMIN", "SUPERUSER"];
```

- `DashboardCard.js:11` — `if (!hasAccess(DASHBOARD_ROLES)) return null;` → home card hidden.
- `Module.js:15` — `if (!hasAccess(DASHBOARD_ROLES)) return <Redirect to=".../employee">` → deep link bounces.

A user who holds **any one** of those seven codes (at any tenant) sees the card and
can open the dashboard. A user holding **none** of them does not.

> **Backend is more permissive than the FE gate.** The analytics `/packs` endpoint
> (`pgr-services/v2/analytics/packs`) answered for the CSR-only user ANDREW too
> (returned a 25-tile anon/public pack, `defaultLayout: []`). Access control for the
> demo is therefore **entirely FE-side** — the CSR user never reaches a screen that
> calls the backend. Do not claim the backend enforces the gate; it does not.

## DO see the dashboard (use these for the demo)

| Username          | Password  | Role codes (live)                                          | Pack served (live)            |
|-------------------|-----------|------------------------------------------------------------|-------------------------------|
| `KE_ADMIN`        | `eGov@123`| SUPERUSER, GRO, DGRO, PGR_LME, CFC, CSR, PGR_VIEWER, EMPLOYEE | Executive — 15 tiles, layout 12 |
| `DEMO_SUPERVISOR` | `eGov@123`| SUPERVISOR, EMPLOYEE                                        | Supervisor — 11 tiles, layout 11 |
| `KE_GRO`          | `eGov@123`| GRO, SUPERVISOR, EMPLOYEE                                   | Supervisor — 11 tiles, layout 11 |

- `KE_ADMIN` grants access via **SUPERUSER** (also GRO/DGRO/PGR_LME). Best "admin
  executive view" login.
- `DEMO_SUPERVISOR` is a **clean single-role** SUPERVISOR — ideal to show the
  role-scoped supervisor pack (officer-SLA, complaints-at-risk tiles) distinct from
  the admin executive pack.
- `KE_GRO` (GRO + SUPERVISOR) resolves to the same supervisor pack — a good
  "line supervisor" stand-in.
- Also available with access if needed: `DEMO_ENV` (SUPERVISOR), `ESCDEMO_ADMIN`
  (SUPERUSER), `ADMIN12` (SUPERUSER). Avoid `ADMIN` for a live demo — it carries
  `INTERNAL_MICROSERVICE_ROLE`.

## Do NOT see the dashboard (use one of these for the access-control contrast)

| Username             | Password  | Role codes (live) | Result                                             |
|----------------------|-----------|-------------------|----------------------------------------------------|
| `ANDREW`             | `eGov@123`| CSR               | No home card; deep link → `/employee`              |
| `VINOTH`             | `eGov@123`| CSR               | No home card; deep link → `/employee`              |
| `TEST_DEMO_USER_ONE` | `eGov@123`| CSR               | No home card; deep link → `/employee`              |
| `HS_CSR`             | `eGov@123`| CSR               | No home card; deep link → `/employee`              |

Note on the HRMS role-pollution caveat: many bomet GROs also carry `PGR_LME`
(a DASHBOARD_ROLE), so a "GRO-but-no-access" employee does **not** exist. The clean
no-access population on bomet is the **CSR-only** employees above (13 active
CSR-only EMPLOYEE users found via `/user/_search roleCodes=[CSR]`). `ANDREW` is the
recommended no-access demo login.

## Login that does NOT work with the shared password

| Username     | Roles include access? | Note |
|--------------|-----------------------|------|
| `BOMET_ADMIN`| Yes (SUPERUSER, GRO, DGRO, PGR_LME) | **Login FAILS** with `eGov@123` — its password is different/unknown. Do not put it on the demo runsheet; use `KE_ADMIN` instead. |

## If you need a fresh, guaranteed no-access demo user

If the CSR users above have been touched, create a throwaway citizen (citizens never
hold DASHBOARD_ROLES) or a CSR-only employee:

```bash
# Simplest: use any /citizen login — citizens have no employee chrome and no dashboard card.
# Or create a CSR-only employee via HRMS (employee create) with only the "Complainant/CSR" role,
# tenant ke, password eGov@123, then verify:
./verify-login-matrix.sh <NEW_USERNAME>
# Expect: LOGIN=OK roles=CSR  → no dashboard access.
```

## How each row was verified

- Enumeration: `POST /user/_search` with `{tenantId:"ke", userType:"EMPLOYEE",
  roleCodes:[<role>]}` for each of the seven DASHBOARD_ROLES plus CSR/PGR_VIEWER/CFC.
- Login + role read: `POST /user/oauth/token`
  (header `Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=`,
  form `username / password=eGov@123 / tenantId=ke / userType=EMPLOYEE / scope=read /
  grant_type=password`), then the returned `UserRequest.roles[].code` set.
- Pack served: `POST pgr-services/v2/analytics/packs` with each user's token.
