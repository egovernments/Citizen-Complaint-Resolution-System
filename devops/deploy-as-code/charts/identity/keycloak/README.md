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

The Job runs the script and `realm.json` baked into the Keycloak image at
`/opt/identity/` (`keycloak/Dockerfile`), so the chart carries no copies: a
change to either ships with the next image build, and the Job always matches
the image it runs in.
