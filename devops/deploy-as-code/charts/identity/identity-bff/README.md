# identity-bff

The DIGIT Identity BFF ([`backend/identity-bff`](../../../../../backend/identity-bff/README.md))
on port 3000, with the `/identity/v1` ingress. Needs the `keycloak` release
beside it, Redis (`redis.backbone` by default) and DIGIT's egov-user, egov-otp
and MDMS.

Installed by `../identity-helmfile.yaml` when `identity.enabled` is true.
`values.yaml` lists every BFF setting under `config:`, keyed by environment
variable. Setup and the Secret's keys are documented in
[docs/setup/deployment/helm-identity.md](../../../../../docs/setup/deployment/helm-identity.md).
