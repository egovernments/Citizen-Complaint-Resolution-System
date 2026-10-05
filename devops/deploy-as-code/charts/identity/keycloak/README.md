# keycloak

Keycloak for the DIGIT identity stack: the project image built from
[`keycloak/Dockerfile`](../../../../../keycloak/Dockerfile), the public
`/auth/realms/<realm>/` and `/auth/resources/` ingress, and a
`post-install,post-upgrade` Job that reconciles the realm with
[`keycloak/configure-keycloak.sh`](../../../../../keycloak/configure-keycloak.sh)
and `realm.json`.

Installed by `../identity-helmfile.yaml` when `identity.enabled` is true.
Setup, the Secret's keys, SMTP and the Job are documented in
[docs/setup/deployment/helm-identity.md](../../../../../docs/setup/deployment/helm-identity.md).

`files/configure-keycloak.sh` and `files/realm.json` are copies (helm reads
only files inside a chart); edit `keycloak/` and copy them here.
`local-setup/tests/static/helm-identity.test.ts` fails when they differ.
