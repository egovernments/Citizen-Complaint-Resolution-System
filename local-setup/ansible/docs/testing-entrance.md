# Enabling the `/digit-ui-test` testing entrance

A **parallel, password-gated copy of the UI** served at `/<host>/digit-ui-test/`
alongside the production `/digit-ui/`. It runs the **same built bundle** with an
**alternate boot config** (`globalConfigs.testing.js`), so testers can exercise the
full system against a dedicated **testing tenant** without ever touching the
production entrance or production reports.

- **Default: OFF everywhere.** The nginx location, the testing `globalConfigs`, and
  the htpasswd gate are rendered **only** when a host opts in. Boxes that don't opt
  in get byte-identical renders — enabling it cannot affect an existing deployment.
- **No separate build / container.** It aliases the existing
  `/opt/digit-ui-esbuild/build/`, so there's nothing extra to build or run.
- **It does NOT create or seed the testing tenant.** You onboard that tenant
  through the normal flow and flag it in the configurator (see Prerequisite).

---

## How it works (what the playbook renders when enabled)

| Piece | Detail |
|---|---|
| **nginx location** | `location /<testing_ui_path>/` → `alias /opt/digit-ui-esbuild/build/`, `try_files … /<path>/index.html`, `Cache-Control: no-cache`. A `= /<path>` → `302 /<path>/` redirect is added too. |
| **Password gate** | `auth_basic "Testing"` + `auth_basic_user_file {{ digit_dir }}/nginx/.htpasswd-testing`. Applies to the entrance **and** its `globalConfigs.js`. |
| **Boot config** | `globalConfigs.testing.js` (rendered from `templates/globalConfigs.js.j2`) with `CONTEXT_PATH = <testing_ui_path>`, **`TESTING_MODE = true`**, `LOGIN_TENANT_ALLOWLIST = [<testing_tenant>]`, city tenant = `<testing_tenant>`. Injected via `sub_filter` into `<head>`. |
| **Banner** | A fixed red bottom bar injected via `sub_filter` (default: *"TESTING ENVIRONMENT — data created here is not real"*), overridable with `testing_ui_banner`. |

`TESTING_MODE = true` + the tenant's `isTestingTenant` flag are what scope the
experience: on this entrance the citizen dispatcher / complaints list / employee
login show **only** the testing tenant, and on the production entrance the same
tenant is **hidden**. (See `products/pgr/src/utils/testingTenant.js`.)

---

## Prerequisite — a flagged testing tenant

1. Onboard a **sub-tenant** for testing through the normal configurator flow
   (e.g. `mz.igetesting`). Its **Name must contain "Testing"**.
2. In the configurator, open **Manage → Tenants → <that tenant> → Edit** and tick
   **"Make this a testing tenant"** (confirm the dialog). This writes
   `isTestingTenant: true` onto the tenant record — the UIs read it.

> The entrance and the flag are orthogonal: the flag says *which* tenants are
> testing; `TESTING_MODE` says *which entrance* this is. Both are required.

---

## Enable it — `host_vars/<host>.yml`

Add these keys to the box's `host_vars` file (they default off in
`group_vars/digit.yml`):

```yaml
# ── Testing entrance (/digit-ui-test) ──
testing_ui_enabled: true
testing_tenant: mz.igetesting              # the flagged testing sub-tenant
testing_ui_htpasswd: "tester:$apr1$xxxxxxxx$xxxxxxxxxxxxxxxxxxxxxx"   # pre-hashed; keep in vault

# Optional:
# testing_ui_path: digit-ui-test           # URL prefix (default: digit-ui-test)
# testing_ui_banner: "AMBIENTE DE TESTE — os dados aqui não são reais"
```

| Key | Required | Meaning |
|---|---|---|
| `testing_ui_enabled` | yes | Master switch. Renders the entrance only when `true`. |
| `testing_tenant` | yes | The flagged testing sub-tenant. Becomes the login allowlist + city tenant on the entrance. |
| `testing_ui_htpasswd` | yes | **Pre-hashed** htpasswd line(s) for the basic-auth gate. Store in vault. |
| `testing_ui_path` | no | URL prefix. Default `digit-ui-test`. |
| `testing_ui_banner` | no | Banner text. Default *"TESTING ENVIRONMENT — data created here is not real"*. |

### Generate the htpasswd value

The value is an Apache-style `user:hash` line — portable, one-way (not encryption),
and safe to keep in vault. Generate it locally and paste the result:

```bash
printf "tester:%s\n" "$(openssl passwd -apr1 'YOUR_PASSWORD')"
# → tester:$apr1$....  (paste this whole line as testing_ui_htpasswd)
```

`tester` is the username testers type at the browser prompt; `YOUR_PASSWORD` is the
password. Multiple lines = multiple gate users.

---

## Deploy

Run the normal ansible deploy for the host — the testing tasks fire only because
`testing_ui_enabled` is now `true`:

```bash
cd local-setup/ansible
ansible-playbook -i inventory/hosts.yml playbook-deploy.yml --limit <host>
```

This renders `{{ digit_dir }}/nginx/globalConfigs.testing.js`, writes
`{{ digit_dir }}/nginx/.htpasswd-testing`, adds the nginx location, and reloads nginx.

---

## Verify

```bash
# 1) Gate is up (no creds → 401)
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/digit-ui-test/          # 401

# 2) With creds → 200
curl -s -o /dev/null -w '%{http_code}\n' -u tester:YOUR_PASSWORD https://<host>/digit-ui-test/   # 200

# 3) Testing boot config is served and TESTING_MODE is on
curl -s -u tester:YOUR_PASSWORD https://<host>/digit-ui-test/globalConfigs.js | grep -o 'TESTING_MODE[^;]*'
```

In the browser at `https://<host>/digit-ui-test/`:
- basic-auth prompt → `tester` / your password
- red **TESTING** banner along the bottom
- login institution / citizen dispatcher show **only** the testing tenant
- complaints filed here stay off the production entrance and reports

---

## Turn it off

Set `testing_ui_enabled: false` (or remove the block) in the host's `host_vars` and
re-run the playbook. The location, testing `globalConfigs`, and gate stop rendering;
the production entrance is unchanged throughout.

---

## Notes

- **Secrets:** keep `testing_ui_htpasswd` in vault (referenced via `secrets_path`),
  not in plain `host_vars`. It gates the entire entrance.
- **Same bundle:** a redeploy of the UI updates both entrances at once — there is no
  second build to keep in sync.
- **The gate is not encryption.** `auth_basic` is a keep-the-public-out doorway;
  treat the testing tenant's data as non-production regardless.
