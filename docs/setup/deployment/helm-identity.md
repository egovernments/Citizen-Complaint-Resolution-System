# Identity on Helm: Keycloak and the Identity BFF

This is the Kubernetes counterpart of [identity-bff.md](identity-bff.md), which
covers the Ansible/Compose deployment. The charts live in
[`devops/deploy-as-code/charts/identity/`](../../../devops/deploy-as-code/charts/identity/):

| Release | Chart | What it runs |
|---|---|---|
| `keycloak` | `identity/keycloak` | The project Keycloak image (`keycloak/Dockerfile`), the public `/auth/realms/<realm>/` and `/auth/resources/` ingress, and the realm-configure Job |
| `identity-bff` | `identity/identity-bff` | `backend/identity-bff` on port 3000 and the `/identity/v1` ingress |

**Required for sign-in.** Once legacy identity is removed (#2271), every
digit-ui sign-in, employee and citizen, goes through `/identity/v1` and
Keycloak. A Helm deployment without these two releases has no working sign-in.
They are off by default (`identity.enabled: false`) only so that an upgrade of an
existing cluster does not install them before the database, Secret and SMTP
settings below exist.

## Why an in-repo Keycloak chart

- The deployment needs **this repository's image**: Keycloak 26.7.3 built with
  the magic-link provider and the Keycloakify login themes (`kc.sh build`,
  started `--optimized`). Compose and Ansible run the same image.
- The realm is **declared in the repository** (`keycloak/realm.json`) and
  reconciled by `keycloak/configure-keycloak.sh`. The Job runs that script, not
  a chart's own realm-import format, so Helm and Ansible reach the same realm
  state.
- Every chart here is vendored and in-tree, built on the `common` library chart.
  The usual upstream chart is Bitnami's, and Bitnami stopped publishing its free
  images in 2025 (see the `bitnamilegacy` workaround in
  `backboneservices-helmfile.yaml`). An external chart would add a repository
  dependency and still need the custom image and the configure step on top.

## Before enabling

1. **Database.** Keycloak uses the platform Postgres (`egov-config`'s `db-host`)
   with a database and role of its own. Create them once:

   ```sql
   CREATE ROLE keycloak LOGIN PASSWORD '<keycloak-db-password>';
   CREATE DATABASE keycloak OWNER keycloak;
   ```

   Another server: set `identity.keycloak.db.host` (and `port`, `database`,
   `username`) in `env.yaml`.

2. **DIGIT account for the BFF.** A dedicated employee holding only
   `ACCOUNT_ADMIN` on the state tenant, as in
   [identity-bff.md](identity-bff.md). Set its user name in
   `identity.identity-bff.config.DIGIT_ADMIN_USERNAME` (default `ADMIN`) and
   its password in the Secret. The tenant defaults to `egov-config`'s
   `state-level-tenant-id`.

3. **The Secret.** One Secret, `identity-secrets` in namespace `egov` by
   default (`secrets.identity.existingSecret` in `env-secrets.yaml`). Both
   charts read it, so a client secret Keycloak is configured with is always the
   one the BFF presents.

   | Key | Required | Used by |
   |---|---|---|
   | `keycloak-db-password` | yes | Keycloak |
   | `keycloak-admin-password` | yes | Keycloak's bootstrap master admin (first start only) and the configure Job |
   | `keycloak-bff-client-secret` | yes | `digit-identity-bff` client: Job and BFF |
   | `keycloak-admin-client-secret` | yes | `digit-identity-admin` service account: Job and BFF |
   | `keycloak-employee-client-secret` | yes | `digit-ui-employee` client: Job and BFF |
   | `keycloak-citizen-client-secret` | yes | `digit-ui-citizen` client: Job and BFF |
   | `digit-admin-password` | yes | BFF (the `ACCOUNT_ADMIN` employee) |
   | `keycloak-magic-link-client-secret` | with magic link | Job and BFF |
   | `keycloak-smtp-password` | with SMTP auth | Job |
   | `keycloak-google-client-secret`, `keycloak-github-client-secret` | with that provider | Job |
   | `identity-citizen-otp-secret` | for citizen phone OTP | BFF |
   | `identity-session-introspection-token` | when PGR introspects sessions | BFF (PGR sends the same value) |
   | `identity-onboarding-token` | with self-service onboarding | BFF (pgr-services' `onboarding-token`) |
   | `pgr-onboarding-worker-token` | with the onboarding worker | BFF and PGR |
   | `identity-control-plane-token` | for the operator routes | BFF |
   | `identity-credential-keys`, `identity-credential-key-current` | with `IDENTITY_STAFF_CREDENTIAL_MODE=derived` | BFF |
   | `digit-provisioner-password` | with the onboarding worker | BFF |
   | `identity-surfaces-json` | extra sign-in surfaces | BFF (`IDENTITY_SURFACES_JSON`; it carries client secrets) |

   ```bash
   kubectl -n egov create secret generic identity-secrets \
     --from-literal=keycloak-db-password='<as created above>' \
     --from-literal=keycloak-admin-password="$(openssl rand -base64 24)" \
     --from-literal=keycloak-bff-client-secret="$(openssl rand -hex 32)" \
     --from-literal=keycloak-admin-client-secret="$(openssl rand -hex 32)" \
     --from-literal=keycloak-employee-client-secret="$(openssl rand -hex 32)" \
     --from-literal=keycloak-citizen-client-secret="$(openssl rand -hex 32)" \
     --from-literal=digit-admin-password='<ACCOUNT_ADMIN password>' \
     --from-literal=keycloak-smtp-password='<SMTP password>'
   ```

   A missing required key stops the pod (`CreateContainerConfigError`) rather
   than starting a BFF that fails every sign-in. For a throwaway cluster only,
   blank `existingSecret` and put the same keys under `secrets.identity.values`;
   each chart then renders its own Secret and refuses `<...>` and `change-me`
   placeholders. That file is committed unencrypted.

4. **SMTP.** Required, as under Ansible: password setup and reset, invitations
   and email verification all send mail. Set
   `identity.keycloak.configure.smtp.host` and `.from` (and `port`,
   `starttls`, `ssl`); the render fails while they are empty. `auth` defaults
   to `false`, as in `configure-keycloak.sh`, for a relay that takes no login.
   For an authenticated relay set `auth: true` and `user`, and put the password
   in the Secret's `keycloak-smtp-password`: the render fails while `user` is
   empty, or while the password is missing from `secret.values` (or from
   `existingSecret`, when the render can read the cluster), and the Job does
   not start without that key.

## Enable

In `charts/environments/env.yaml`:

```yaml
identity:
  enabled: true
  realm: "digit"
  keycloak:
    image:
      tag: "<immutable tag>"
    configure:
      smtp:
        host: "smtp.example.org"
        from: "no-reply@example.org"
        auth: true
        user: "smtp-user"
  identity-bff:
    image:
      tag: "<same build as Keycloak>"
    config:
      DIGIT_ADMIN_USERNAME: "IDENTITY_ACCOUNT_ADMIN"
      IDENTITY_OTP_SENDER: "http"
      IDENTITY_OTP_SENDER_URL: "http://<notification endpoint>"
```

then `helmfile -f digit-helmfile.yaml -e env apply`. Both images default to the
rolling `nightly-develop`, as Compose does; pin both to one immutable build in
production.

`identity.publicUrl` defaults to `https://<global.domain>` (`http://` when
`global.setup` is `quickstart`). It drives Keycloak's `KC_HOSTNAME`
(`<publicUrl>/auth`), the BFF's issuer and redirect URI
(`<publicUrl>/identity/v1/callback`), and the redirect URIs and web origins the
Job writes onto Keycloak's clients. `postLoginRedirect` and `allowedOrigins`
are shared the same way. The BFF chart refuses those settings under its own
`config:` so they cannot drift. The BFF's in-cluster Keycloak address (issuer
backchannel, JWKS, Admin API) is shared too: the helmfile builds
`identity.keycloak` (Service name, namespace, `httpPort`) from the keycloak
release's own overrides, both charts join it with the `common` chart's
`common.identity.keycloakUrl`, and the keycloak chart fails the render if it
does not describe its Service. Override the port as
`identity.keycloak.httpPort` and both follow.

Every other BFF setting is under `identity.identity-bff.config`, keyed by its
environment variable; the chart's `values.yaml` lists them all with the
defaults the Ansible path uses. Notable ones:

- `IDENTITY_TRUST_PROXY_HOPS` defaults to `1` (ingress-nginx straight to the
  BFF; Compose uses 2 for host nginx then Kong). Add one for each L7 load
  balancer in front of ingress-nginx that appends to `X-Forwarded-For`.
- DIGIT calls go through the gateway (`http://gateway.egov:8080/...`). OTP
  creation and token revocation go straight to `egov-otp` and `egov-user`.
- Redis is the platform Redis, `redis.backbone:6379`. The BFF takes a host and
  port only, no credential.

## The realm-configure Job

`keycloak-realm-configure` is a Helm `post-install,post-upgrade` hook. It runs
`configure-keycloak.sh` with `realm.json`, the same reconcile the Ansible task
"identity-bootstrap — reconcile Organizations realm and BFF clients" runs on
every deploy, and it is idempotent.

- It runs in the Keycloak image (bash, `kcadm.sh` and jq), which carries the
  script and `realm.json` at `/opt/identity/` (`keycloak/Dockerfile`), so the
  reconcile always matches the image it runs in and the chart holds no copies.
  With `KEYCLOAK_KCADM_SERVER` set the script runs kcadm in the pod, against
  the Service, instead of through `docker exec` into a keycloak container.
  The Keycloak tag must therefore be a build that carries `/opt/identity/`.
- Helm starts it only after the Keycloak Deployment is Ready (the release is
  installed with `wait: true`), so it does not wait for Keycloak's first start.
  It retries its first kcadm login up to `configure.loginAttempts` times, 5 s
  apart, as the bootstrap admin from the Secret. With that admin given, the
  script creates no temporary admin.
- The hook runs on a Helm install or upgrade, not on every `helmfile apply`:
  apply upgrades the release only when its diff is non-empty. A new Keycloak
  image tag (which is how a changed script or `realm.json` arrives) is such a
  diff, and so is a rotated `existingSecret` (next section).
  `helmfile sync` upgrades, and so reruns the Job, every time.
- The `keycloak` release is installed with `wait: true` and `identity-bff`
  `needs` it, so the realm exists before the BFF starts.
- The Job's `configure.activeDeadlineSeconds` (600 s, every retry included)
  stays below the release `timeout` (900 s), so a failing reconcile fails on
  the Job's own deadline rather than Helm giving up while it still retries.
  Raise both together.
- A successful run is deleted; a failed one stays for `kubectl -n egov logs
  job/keycloak-realm-configure` until the next upgrade replaces it.

Other script inputs (sign-in methods, events retention, social providers,
magic link) are under `identity.keycloak.configure`; anything else the script
reads goes in `configure.extraEnv`.

### Rotating a secret

Keycloak learns a client secret only when the Job writes it, and the BFF only
when its pod starts. With `existingSecret`, changing a key in
`identity-secrets` changes nothing in the charts by itself, so:

- The Job carries a `checksum/existing-secret` annotation, a checksum of the
  Secret's data read with `lookup` when the release is rendered. A rotation
  therefore changes the hook manifest, a release diff, when the diff can read
  the cluster (helm-diff's `--dry-run=server`, helm-diff 3.9 and later).
- A diff that cannot read the cluster (helm-diff's default, `helm template`)
  gets nothing from `lookup`: the annotation renders as `unavailable`, which
  differs from the checksum the last upgrade stored. `helmfile diff` then
  always lists that annotation, and `helmfile apply` always upgrades the
  `keycloak` release and reruns the idempotent Job.

Either way the next `apply` reaches Keycloak, but a rotation should not depend
on how the diff happens to run. After changing the key in `identity-secrets`,
rerun the Job explicitly, then restart the BFF so it reads the new value:

```bash
cd devops/deploy-as-code
helmfile -f charts/identity/identity-helmfile.yaml -e env -l name=keycloak sync
kubectl -n egov rollout restart deploy/identity-bff
```

`sync` upgrades the release even with an empty diff, so the hook runs. Between
the Job and the restart the BFF still presents the old client secret, so its
sign-ins fail for that short window. `keycloak-admin-password` is not rotated
this way: it creates the bootstrap admin on Keycloak's first start only.

## Ingress

| Path (regex, as digit-ui's tenant routes) | Backend | Notes |
|---|---|---|
| `/identity/v1(/\|$)` | `identity-bff:3000` | Not rewritten. `/internal/identity/v1/*` is not routed. |
| `/auth/(realms/<realm>/.*)` | `keycloak:8180` as `/$1` | Only the identity realm. |
| `/auth/(resources/.*)` | `keycloak:8180` as `/$1` | Login theme assets. |

`/auth/admin` and `/auth/realms/master` are never routed. Compose denies them
with a 404 at Kong; here they simply have no route. Operators reach the admin
console with `kubectl -n egov port-forward svc/keycloak 8180`. The Keycloak
ingress raises the proxy buffer to 64k: Keycloak's login responses carry
several large `Set-Cookie` headers, and the default buffer answers them with a
502.

## Validate

```bash
curl -fsS https://<domain>/auth/realms/digit/.well-known/openid-configuration
curl -fsS 'https://<domain>/identity/v1/auth-methods?intent=signin'
kubectl -n egov exec deploy/identity-bff -- wget -qO- http://127.0.0.1:3000/readyz

# Both must be 404 (no route):
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/auth/admin/
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/auth/realms/master/protocol/openid-connect/token
```

`/readyz` reports each dependency: Redis, Keycloak JWKS and Admin API, DIGIT
(egov-user and MDMS), each configured sign-in surface and the revocation
poller. The pod is not Ready, and receives no traffic, until all of them pass.
