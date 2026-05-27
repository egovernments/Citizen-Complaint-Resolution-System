# Runbook — Keycloak SSO cutover (Nairobi)

| Field | Value |
|---|---|
| When to use | Activating Keycloak SSO on `naipepea.digit.org`, or rolling back to OTP |
| Severity | P1 (login surface change — affects every user) |
| Affects | Nairobi only. Bomet (`bometfeedbackhub.digit.org`) stays on OTP. |
| Time to execute | 15–20 min (incl. verification) |
| Reverses | Yes — flip two flags + re-deploy, < 1 min for nginx to reload |

## What this does

Cuts citizen + employee login over from mobile OTP to Keycloak SSO. After this
runbook runs:

- Visiting any login URL on `naipepea.digit.org` redirects to a Keycloak realm
  page. The auth-adapter from PR 1 owns the redirect logic.
- The `keycloak` and `token-exchange-svc` containers (added by PR 2) come up
  alongside the rest of the DIGIT stack.
- Citizens authenticate via Keycloak. On first login, `token-exchange-svc`
  lazy-provisions a row in `eg_user` (using `_createnovalidate`) and mints a
  DIGIT JWT.
- Employees authenticate via Keycloak using their existing DIGIT username,
  matched into the realm by `preferred_username`.
- Mobile OTP login is **no longer wired** while `enable_keycloak: true`.

Bomet is untouched — its `host_vars` keeps `enable_keycloak: false`.

## Pre-flight

1. **Sister PRs merged.** This runbook assumes both upstream PRs are already
   on `nairobi`:
   - `keycloak-auth-adapter` (UI scaffold in `digit-ui-esbuild`; inert unless
     `globalConfigs.AUTH_PROVIDER === 'keycloak'`)
   - `keycloak-ansible-deploy` (compose containers + ansible bootstrap +
     nginx templates + new env vars; inert unless `enable_keycloak: true`)

   Confirm by checking `git log nairobi --oneline | grep -i keycloak` shows
   both adapter and ansible commits.

2. **Secrets filled in.** Open `inventory/host_vars/nairobi.yml` and replace
   the `PUT-RANDOM-STRONG-STRING-HERE` placeholders under `bootstrap_secrets`
   with real values:

   ```yaml
   bootstrap_secrets:
     keycloak_admin_password: "<32+ chars, generate with `openssl rand -base64 32`>"
     keycloak_db_password:    "<32+ chars, generate with `openssl rand -base64 32`>"
     keycloak_google_client_secret: ""    # leave blank to skip Google IdP
     token_exchange_system_password: "eGov@123"
   ```

   These get seeded into OpenBao with `cas=0`, so they're only honoured on the
   first deploy after the flip. Get them right now — rotation post-cutover is
   via `bao kv put kv/digit/nairobi <field>=<new>`, not by re-editing this file.

3. **Google IdP wiring (optional).** Skip if `keycloak_google_client_secret`
   is blank. Otherwise:
   - In `nairobi.yml`, uncomment `keycloak_google_client_id` and paste the
     OAuth client ID from Google Cloud Console → APIs & Credentials.
   - In the same Google project, add
     `https://naipepea.digit.org/auth/realms/ke/broker/google/endpoint` to the
     OAuth client's **Authorized redirect URIs** before deploying. Google
     rejects the broker callback otherwise (`redirect_uri_mismatch`).

4. **Snapshot.** Take a Postgres dump in case anything goes sideways:
   ```bash
   ssh egov-nairobi 'docker exec postgres pg_dumpall -U postgres' \
     > /tmp/nairobi-pre-keycloak-$(date +%F).sql
   ```

5. **Heads-up window.** Announce the cutover. While the deploy runs, login
   is briefly unavailable (~30s during nginx reload).

## Deploy

```bash
cd /root/code/Citizen-Complaint-Resolution-System/local-setup/ansible
./deploy.sh nairobi
```

What this does:

- Renders the nginx site config with the new `/auth/` and `/token-exchange/`
  location blocks (because `nginx_features.keycloak: true`).
- Brings up the `keycloak` and `token-exchange-svc` containers via the
  Docker Compose overlay that PR 2 ships.
- Writes `AUTH_PROVIDER=keycloak` + `KEYCLOAK_REALM=ke` into
  `/opt/digit/nginx/globalConfigs.js` so the SPA from PR 1 routes to the
  Keycloak login on next page load.
- Seeds Keycloak's `ke` realm with the `digit-ui` client + (optionally) the
  Google IdP.

The deploy is idempotent; if it half-completes, fix the cause and re-run.

> **HMR note.** Nairobi runs `digit_ui_mode: hmr` — the live SPA is served
> by `esbuild.dev.js` in tmux session `esbuild`. The deploy playbook
> regenerates `globalConfigs.js` on disk; esbuild picks up the new values on
> the next browser refresh (no rebuild needed — it's a script tag the
> browser fetches).

## Verify

Run these from your workstation (or `ssh egov-nairobi`):

```bash
# Keycloak realm is reachable
curl -fsSI https://naipepea.digit.org/auth/realms/ke | head -1
# → HTTP/2 200

# token-exchange-svc is up
curl -fsSI https://naipepea.digit.org/token-exchange/healthz | head -1
# → HTTP/2 200

# OIDC discovery doc resolves and uses the right issuer
curl -fsS https://naipepea.digit.org/auth/realms/ke/.well-known/openid-configuration \
  | jq '{issuer, authorization_endpoint, token_endpoint}'
# → issuer should be "https://naipepea.digit.org/auth/realms/ke"
```

Browser walk-through:

1. Open an incognito window. Hit `https://naipepea.digit.org/digit-ui/citizen/login`.
2. **Expected**: redirect to `https://naipepea.digit.org/auth/realms/ke/protocol/openid-connect/auth?...`
   (the UnifiedLogin component from PR 1). You should see the Keycloak realm
   login page.
3. **If Google IdP is wired**: click the **Sign in with Google** button →
   complete the consent flow → land back on `/digit-ui/citizen`. Confirm
   `localStorage` has `citizen-token` populated.
4. **Smoke test**: file one PGR complaint end-to-end. Check that it lands in
   `eg_pgr_service` with `accountid` pointing at a fresh `eg_user` row owned
   by the SSO citizen.
5. Repeat for employee: `https://naipepea.digit.org/digit-ui/employee/user/login`
   → should also redirect to Keycloak. Existing employees match by
   `preferred_username` (DIGIT username).

If any of those fails, jump to **Rollback** while you debug. The OTP path
comes back within ~30s and gives you breathing room.

## Rollback

```bash
# In inventory/host_vars/nairobi.yml:
enable_keycloak: false
auth_provider: ""

# Then re-deploy:
cd local-setup/ansible && ./deploy.sh nairobi
```

What happens:

- The `keycloak` and `token-exchange-svc` containers stop (PR 2's compose
  overlay only renders them when `enable_keycloak: true`).
- nginx re-renders without the `/auth/` and `/token-exchange/` blocks; the
  reload takes ~10s.
- `globalConfigs.js` is rewritten with `AUTH_PROVIDER=""`. The SPA's
  auth-adapter shim (PR 1) detects no provider configured and falls back to
  the existing OTP flow.
- Citizens that signed up via SSO during the window keep their `eg_user`
  rows. They can re-bind their mobile number through the existing OTP
  signup flow if they ever need OTP login.

Total downtime on rollback: ~30s (nginx reload + browser refresh).

## Operator hints

- **First Google SSO citizen** triggers lazy provisioning inside
  `token-exchange-svc`. Confirm it worked:
  ```bash
  ssh egov-nairobi 'docker logs token-exchange-svc 2>&1 | grep _createnovalidate'
  ```
  You should see a `POST /user/_createnovalidate` for each new SSO citizen.

- **User matching strategy**. If an existing DIGIT user has the same email
  as the incoming Google identity, `token-exchange-svc` matches them and
  re-uses the existing `eg_user` row (no duplicate). Otherwise it inserts a
  fresh row.

- **Mobile placeholder for SSO users**. SSO citizens may not have a phone
  number in their Keycloak profile. The exchange service synthesises one:
  `90000XXXXX` where `XXXXX = sha256(kc_sub).slice(0,5)`. This satisfies
  the `eg_user.mobilenumber NOT NULL` constraint without colliding with
  real Kenyan numbers (90000xxxxx is outside the allocated `+254 7…` and
  `+254 1…` ranges).

- **Watching the exchange in real time**:
  ```bash
  ssh egov-nairobi 'docker logs -f token-exchange-svc'
  ```
  Each successful login emits two lines: `exchange OK kc_sub=… digit_uuid=…`
  and `JWT issued`. Failures emit the Keycloak token introspection error.

- **Keycloak admin console**. Tunnel and open:
  ```bash
  ssh -L 18180:127.0.0.1:18180 egov-nairobi
  # → http://localhost:18180/admin
  # username: admin, password: <bootstrap_secrets.keycloak_admin_password>
  ```
  Rotate the admin password via
  `bao kv put kv/digit/nairobi keycloak_admin_password='<new>'` then re-deploy.

## Known limitations

- **No mobile-OTP fallback while SSO is on.** Citizens who don't have a
  Google account (or whichever IdP is wired) and don't want to use the
  Keycloak username/password form **cannot log in**. If this becomes a
  blocker, the path is to wire a second IdP into the realm (e.g. email
  magic-link via the OTP infra) rather than re-enabling OTP — running both
  in parallel creates two user identities for the same human.

- **Bomet is not affected.** It still uses OTP. The two deployments share
  no Keycloak realm; they're fully independent stacks.

- **Admins (`eg_user` rows with no email) cannot be SSO'd.** Internal admin
  users created before email was mandatory have NULL emails. They need
  either an email added (`UPDATE eg_user SET emailid = … WHERE …`) or a
  Keycloak realm-role mapping that grants the ADMIN role on first login.
  The ADMIN/GRO seed users from `user-seed.sh` already have an email and
  work fine.

- **The Bomet Twilio trial restriction documented in
  `/tmp/bomet-handoff.md` does not apply here.** Twilio on Nairobi is used
  only for SMS notifications (PGR status updates via Novu), not for OTP
  login. The cutover doesn't change anything about the notification path.

## Related

- Canonical design: `/root/DIGIT-keycloak-overlay/docs/plans/2026-03-05-keycloak-acl-design.md`
  (TL;DR + User Flows + Enforcing Keycloak-Only Auth sections are the
  must-reads).
- Auth-adapter UI PR: `theflywheel/digit-ui-esbuild#<TBD>` (PR 1).
- Ansible / compose PR: `ChakshuGautam/Citizen-Complaint-Resolution-System#<TBD>` (PR 2).
- This cutover PR: PR 3.
- OpenBao runbook (for rotating Keycloak secrets post-cutover):
  `local-setup/ansible/runbooks/01-openbao.md`.
- E2E test: `local-setup/tests/e2e/specs/keycloak-login.spec.ts`. Run with
  `AUTH_PROVIDER=keycloak BASE_URL=https://naipepea.digit.org npx playwright test specs/keycloak-login.spec.ts`.
