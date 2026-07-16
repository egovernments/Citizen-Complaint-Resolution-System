# Task: Prove whether flipping Kong gateway from AUDIT to ENFORCE is safe

## Goal
Kong (compose) runs RBAC in AUDIT mode — it checks auth/RBAC and LOGS what it *would* reject
but lets everything through. The reviewer wants ENFORCE by default (like k3s, which always
enforces). Produce a GO/NO-GO report: would flipping `ENFORCE_UNAUTH` and `ENFORCE_RBAC` to
true reject any *legitimate* request? Give the exact list of anything to fix first.
Do NOT rely on the test suite (not exhaustive) or on k3s alone (compose runs newer service
versions, so k3s can't vouch for added/changed routes).

## Core method: enumerate routes from service SOURCE CODE (latest develop), check completeness
Under enforce, any route NOT classified in kong.yml is treated as PROTECTED (auth + RBAC). So
the whole risk is: routes that exist but aren't classified (anonymous ones → 401'd) and
protected routes with no accesscontrol action (drift #2). Enumerate every HTTP endpoint from
source, then assert each is classified.

Source = latest `develop` of each service repo (don't bother matching image tags):
- In THIS repo, `backend/`: pgr-services, digit-config-service, novu-bridge, user-preferences,
  xstate-chatbot.
- External `egovernments/*` repos for the core services imaged in
  `local-setup/docker-compose.egov-digit.yaml` (egov-user, mdms-v2, egov-accesscontrol, egov-idgen,
  boundary-service, egov-filestore, egov-hrms, egov-enc-service, egov-localization,
  egov-workflow-v2, egov-url-shortening, egov-indexer, egov-persister, egov-otp, user-otp,
  audit-service, inbox, egov-bndry-mgmnt). Use each repo's develop branch.

A gateway route = service **context path** (from `application.properties` `server.servlet.context-path`,
or the chart ingress `context:` in `devops/deploy-as-code/charts/.../<svc>/values.yaml`) +
controller **mapping** (class + method `@RequestMapping`/`@GetMapping`/`@PostMapping`/etc.).
kong.yml keys on the request path, exact match.

## Key files (this repo)
- `local-setup/kong/kong.yml` — `ENFORCE_UNAUTH=false` (~81), `ENFORCE_RBAC=false` (~84);
  `AUTH_OPTIONAL` = open ∪ mixed (~85); `is_protected = not AUTH_OPTIONAL[uri]` (~112, exact match).
  RBAC (~215+): POST `egov-accesscontrol:8090/access/v1/actions/_authorize` with
  `{RequestInfo:{apiId,authToken}, AuthorizationRequest:{roles,uri,tenantIds}}`; 200=allow, else deny.
  Audit logs: `RBAC-audit(#5): ... would 401`, `RBAC-audit(#5 p2): would 403`.
- `devops/deploy-as-code/charts/environments/env.yaml` — k3s split:
  `egov-open-endpoints-whitelist` (~206) and `egov-mixed-mode-endpoints-whitelist` (~207).
- `.github/scripts/check-gateway-whitelist-parity.py` — rules-parity CI check.
- `tests/integration-tests/deploy/parity/gateway-behavior-parity.py` — probe (Kong vs k3s decisions).
- `§2.7` in `tests/integration-tests/PARITY-FIXES.md` on branch `fix/dual-deploy-parity` — the two
  drifts; a blind flip regressed parity 7→18.

## Two known drifts to confirm/quantify
1. Mixed-mode: k3s treats mixed endpoints (`/user/_search`, `/egov-idgen/id/_generate`,
   `/workflow/history/v1/_search`, `/filestore/v1/files/tag`, `/access/v1/actions/mdms/_get`,
   `/egov-location/location/v11/boundarys/_search`) as auth-REQUIRED/RBAC-SKIPPED; Kong puts them in
   AUTH_OPTIONAL (auth-optional) → passes no-token requests k3s 401s.
2. No-action RBAC: for a protected URI with no accesscontrol action, k3s allows, Kong denies under
   enforce. accesscontrol actions are seeded data — read the actions master or query the live service.

## Live env (only for the optional differential/shadow cross-checks)
- Kong `http://localhost:8090`; k3s `https://172.19.0.4.nip.io` (-k). network `digit_egov-network`;
  postgres container `docker-postgres` (db/user `egov`, pw `egov123`). No curl in kong/pods — use
  `docker run --rm --network digit_egov-network curlimages/curl`.
- Token: `POST {BASE}/user/oauth/token`, header `Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=`,
  form `username=ADMIN password=eGov@123 tenantId=mz grant_type=password scope=read userType=EMPLOYEE`.
  WARNING: ADMIN@mz resolves to EMPTY roles — use a real configurator/citizen token for RBAC checks.

## Steps
1. Enumerate all routes from source (both repo sets, develop).
2. Static completeness: cross-check each route vs kong.yml open/mixed/protected → list every route
   that exists but is UNCLASSIFIED.
3. RBAC/drift #2: for each protected route, is an accesscontrol action defined? List those without one.
4. (Optional) Differential vs k3s over the overlap via the probe; label compose-only routes.
5. (Optional) Run the suite through Kong in AUDIT, grep `RBAC-audit ... would ...` from
   `docker logs kong-gateway`, cross-ref would-blocks against successes; report never-hit routes.

## Deliverable
Counts + lists of: (a) unclassified routes, (b) protected routes with no action (drift #2),
(c) mixed-mode routes mis-bucketed (drift #1), plus optional (d) Kong-vs-k3s mismatches and
(e) audit-log would-blocks. End with GO/NO-GO and, if NO-GO, the minimal fix list. Do NOT flip
the enforce flags or change service code — read-only analysis + proposed fixes only.
