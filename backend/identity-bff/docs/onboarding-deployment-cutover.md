# PGR onboarding deployment configuration

These changes ship with the PGR provisioning implementation and removal of
the BFF worker in the same onboarding owner PR. This lane does not deploy.

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

## Validation

Run the existing static deployment suite and the onboarding wiring suite:

```sh
cd local-setup/tests
npx jest --runInBand static/deployment-contracts.test.ts static/onboarding-deployment-contracts.test.ts
```

The existing preflight check requires PyYAML in the Python interpreter on
PATH. Tests check shared token wiring, PGR-only provisioner access, removal
of BFF worker settings, internal service hosts, stored-secret preservation,
independent token generation, and secret-scanner coverage of new keys.

Rerun both suites after integrating surf-keycloak's shared deployment-file
changes. These checks do not replace the local-stack onboarding acceptance
test or the root-owned deployment gate.
