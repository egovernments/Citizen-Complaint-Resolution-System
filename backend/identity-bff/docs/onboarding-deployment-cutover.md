# PGR onboarding deployment configuration

These changes stage the PGR provisioning cutover in the onboarding owner PR.
Root decision `apr_fd351ab1` transfers live fresh-founder authorization to
the 8c dev box. Source is ready for that integration; BFF worker removal stays
held until root reports the pass and the owner releases it. This lane does not
deploy. Status: **pending 8c gate**.

## Credential ownership

Ansible generates and persists `identity_onboarding_token` independently of
the operator and session-introspection tokens. Compose passes the same value
as `IDENTITY_ONBOARDING_TOKEN` to the BFF and
`PGR_ONBOARDING_IDENTITY_BFF_TOKEN` to PGR. There is no fallback to the
operator or introspection credentials.

Only PGR receives `DIGIT_PROVISIONER_USERNAME`, `DIGIT_PROVISIONER_PASSWORD`
and `DIGIT_PROVISIONER_TENANT_ID`. The outer Compose variables and new
Ansible inventory fields use the `PGR_DIGIT_PROVISIONER_` and
`pgr_digit_provisioner_` prefixes. Existing inventory and OpenBao values under
`identity_digit_provisioner_*` remain fallback inputs for PGR, so a configured
credential need not be copied into a new secret before switching services.
The BFF receives none of these values.

PGR's optional OAuth client configuration comes from
`PGR_DIGIT_OAUTH_CLIENT_ID` and `PGR_DIGIT_OAUTH_CLIENT_SECRET`, mapped to
`DIGIT_OAUTH_CLIENT_ID` and `DIGIT_OAUTH_CLIENT_SECRET` in the container.
The secret comes from OpenBao's `pgr_digit_oauth_client_secret`. The client id
defaults to `egov-user-client`; the secret has no built-in default credential.

The legacy `PGR_ONBOARDING_WORKER_TOKEN` is retained for PGR's old external
worker controller until that controller is retired. It is no longer passed
to the BFF and is not reused as the new onboarding token.

## Internal APIs and activation

PGR already has internal hosts for MDMS, HRMS, egov-user, localisation,
boundary and encryption. Baseline creation uses these hosts rather than
Kong, so a new tenant can receive its initial role-action grants. Business
acceptance tests still use the founder's normal token through Kong.

`pgr_onboarding_runner_enabled` renders `PGR_ONBOARDING_RUNNER_ENABLED`.
It defaults to false. The deployment owner must enable it when deploying
the PGR runner and BFF worker removal together, with the provisioner and
onboarding credentials configured. Leaving it false means no provisioning
worker runs; this is not a successful signup cutover.

## MCP baseline packaging

The PGR resource `backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json`
is the canonical versioned seed. MCP's dependency-free
`digit-mcp/scripts/stage-platform-baseline.mjs` generates its untracked
`data/platform-baseline-v1.json` and build/runtime copies. The MCP Docker
context remains `digit-mcp/`; the image uses the staged bytes and never
reads a repository at runtime.

Both `spa-build.yml` and `build-images.yml` stage the resource automatically
before building MCP. Ansible copies it from the controller for vendored and
cloned builds, then `mcp-build.sh` refreshes `data/` after checkout and before
Docker runs. The opt-in `mcp-publish` path also stages it before building.
A missing canonical resource fails preparation instead of reusing stale data.
Manual `mcp-build.sh` callers pass the canonical resource as argument six
(argument five is the platform or an empty string). Direct `docker build`
callers first run the staging script from the monorepo.

Only the writable `digit-mcp` service receives the internal `EGOV_MDMS_HOST`.
Direct bootstrap is off by default: neither Compose service sets
`MCP_PLATFORM_BOOTSTRAP_DIRECT`. Without an explicit `true` override bootstrap
uses Kong and must not access the internal host. Direct bootstrap must verify
the caller's DIGIT token with `/user/_details` and require a live `SUPERUSER`
or `MDMS_ADMIN` role at the state root before MDMS writes; cached identity or
tool arguments are insufficient. The readonly MCP service does not receive
the internal host. Leaf regression tests must cover unauthenticated,
non-admin and forged claims, plus absence of direct requests with the flag off.

## Validation

Run the deployment and seed packaging suites:

```sh
cd local-setup/tests
npx jest --runInBand static/deployment-contracts.test.ts static/onboarding-deployment-contracts.test.ts static/mcp-baseline-packaging.test.ts
```

The existing preflight check requires PyYAML in the Python interpreter on
PATH. Tests check shared token wiring, PGR-only provisioner access, removal
of BFF worker settings, internal service hosts, stored-secret preservation,
independent token generation, and secret-scanner coverage of new keys.
Packaging checks execute the build wrapper with local Git/Docker stubs to
verify fresh-clone and vendored paths, stale-seed replacement and missing-seed
failure. They do not build or publish an image.

Rerun the suites after integrating surf-keycloak's shared deployment-file
changes. These checks do not replace the root-owned 8c live onboarding acceptance
and deployment gate.
