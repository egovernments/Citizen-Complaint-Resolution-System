# VAPT fixes: file store and login sessions — configuration reference

Branch `fix/vapt-223-filestore-login` carries two VAPT fixes:

| Fix | Finding | Commit |
|---|---|---|
| **File store needs a login** (#223) | "Insecure File Storage": anyone with a `fileStoreId` could download a complaint attachment without logging in; the storage bucket was world-readable and listable | `fix(filestore): VAPT #223 file store needs login` |
| **Logins live in the tab; employees also signed out when idle** (eGov-Global/CMS-KENYA#224) | "Insecure Session Management": the employee, citizen and configurator tokens lived in `localStorage`, outlived the tab, were shared by every tab, and an idle session was never ended | `fix(session): VAPT logins live in the tab; employees signed out when idle` |

This file lists **every setting the two fixes add**, where it lives in each deployment path, its default, what values it accepts, and how to check it. Behaviour that is deliberately **not** configurable is listed too, so nobody looks for a switch that does not exist.

Deployment paths referred to below:

| Path | Config lives in |
|---|---|
| **Ansible** (`local-setup/ansible/deploy.sh <tenant>`) | `inventory/host_vars/<tenant>.yml` → templates `globalConfigs.js.j2`, `nginx-site.conf.j2`; deploys `docker-compose.egov-digit.yaml` |
| **Docker Compose** (`local-setup/docker-compose*.yml`) | compose `environment:` blocks and `.env` |
| **Helm / k8s** (`devops/deploy-as-code/charts`) | `environments/env.yaml` plus per-chart `values.yaml` |

---

## 1. All settings at a glance

| Setting | What it controls | Default | Ansible | Compose | Helm |
|---|---|---|---|---|---|
| `EMPLOYEE_IDLE_TIMEOUT_MINUTES` | Minutes without activity before an employee is signed out | **15**; `0` = off | `employee_idle_timeout_minutes` | `public/globalConfigs.js` (bundled) | `digit-ui` `globalConfigs.employeeIdleTimeoutMinutes` |
| `EMPLOYEE_IDLE_WARNING_SECONDS` | Seconds of warning dialog before that sign-out | **60**; `0` = no warning | `employee_idle_warning_seconds` | `public/globalConfigs.js` (bundled) | `digit-ui` `globalConfigs.employeeIdleWarningSeconds` |
| `ACCESS_TOKEN_VALIDITY_IN_MINUTES` (egov-user) | Lifetime of every login token, **citizens included** | **480** (8 h); was 10080 (7 days) | compose env, default 480 | `${ACCESS_TOKEN_VALIDITY_IN_MINUTES:-480}` | `access-token-validity: 480` (`env.yaml` + `egov-user/values.yaml`) |
| `PRESIGNED_URL_EXPIRY_TIME_IN_SECS` (egov-filestore) | How long a download link works | **3600** (1 h); image default is 24 h | compose env, default 3600 | `${FILESTORE_URL_EXPIRY_SECS:-3600}` | `egov-filestore` `filestore-url-validity` — **not set on this branch** (see 2.3) |
| `filestore_upload_rate_per_min` (nginx) | Uploads allowed per client IP per minute | **30**, burst 20, then HTTP 429 | host_vars variable | n/a (host nginx) | n/a (not in the ingress) |
| Storage bucket policy | Which files are readable without a login | bucket **private**; only `*/pgr-landing/*` public | `minio-init` in `docker-compose.egov-digit.yaml` | `minio-init` in `docker-compose.yml` | `local-setup/k8s/infrastructure/minio.yaml` |
| Gateway filestore auth | Whether `/filestore/v1/*` needs a token | **login required** (not a setting) | `local-setup/kong/kong.yml` | same | `env.yaml` gateway whitelists |

---

## 2. File store (#223)

### 2.1 Gateway: `/filestore/v1/*` needs a login

Paths `/filestore/v1/file`, `/files`, `/files/url`, `/files/id`, `/files/tag` were removed from the gateway's auth-optional lists. Every method, including multipart uploads, now needs a valid DIGIT token.

| | Where |
|---|---|
| Kong (Ansible, Compose) | `local-setup/kong/kong.yml` — the paths moved from the auth-optional table to the protected set, and are listed in `RBAC_EXEMPT` |
| Helm | `devops/deploy-as-code/charts/environments/env.yaml` — removed from `egov-open-endpoints-whitelist` (`/file`, `/files`, `/files/id`, `/files/url`) and from `egov-mixed-mode-endpoints-whitelist` (`/files/tag`) |

**Token forms the gateway accepts** on these paths (any one of them):

- `auth-token: <token>` request header (what digit-ui sends)
- `Authorization: Bearer <token>` header (digit-ui-v2, configurator, MCP)
- `?access_token=<token>` query parameter

**No per-role check.** Any signed-in user, citizen or employee, may call these paths. This is deliberate: `/files/id` has no access-control action, and `/files/url` and upload are mapped to only some roles, so a role check would refuse admins and screening officers. A per-file ownership check is a filestore-service change and is tracked as #223 Phase 2.

**Not configurable.** Re-adding a path to an auth-optional list is a security decision, not a setting. If you do, the Kong list and the Helm list must match or CI (`.github/scripts/check-gateway-whitelist-parity.py`) fails the PR.

### 2.2 Storage bucket: private, one public prefix

The `egov-rainmaker` bucket is private: no anonymous download, no listing. The only exception is **`GetObject` on `*/pgr-landing/*`**, where the landing-page builder stores pictures that must show before login.

| Path | Where it is applied | When |
|---|---|---|
| Ansible | `minio-init` service in `local-setup/docker-compose.egov-digit.yaml` | every deploy (re-closes a bucket that was opened by hand) |
| Compose | `minio-init` service in `local-setup/docker-compose.yml` | every `up` |
| k8s | `local-setup/k8s/infrastructure/minio.yaml` | every apply |

The policy is the JSON written to `/tmp/public-landing.json` in those files (`mc anonymous set none`, then `mc anonymous set-json`). To change the public prefix, edit the `Resource` ARN in **all three** files. Do not add a listing permission: the whole point of the fix is that nothing can be enumerated.

Download links from `/filestore/v1/files/url` are presigned, so they keep working with a private bucket until they expire (2.3).

### 2.3 Download-link lifetime

| Path | Variable | Default | Set it in |
|---|---|---|---|
| Ansible, Compose | `FILESTORE_URL_EXPIRY_SECS` → `PRESIGNED_URL_EXPIRY_TIME_IN_SECS` on `egov-filestore` | `3600` | `.env` next to the compose file, or the compose `environment:` block (present in all five `docker-compose*.yml`) |
| Helm | `filestore-url-validity` under `egov-filestore:` in `environments/env.yaml` | **unset → the image default of 24 h** | add `filestore-url-validity: "3600"` to `env.yaml` for parity with Compose |

Pages fetch a fresh link every time they open, so a short lifetime costs users nothing. A link copied out of the browser stops working after it expires. Changing the value needs a restart of `egov-filestore`.

### 2.4 nginx: upload rate limit and bucket-root 403 (Ansible path only)

Template: `local-setup/ansible/templates/nginx-site.conf.j2`.

| What | Setting | Default | Notes |
|---|---|---|---|
| Upload rate limit | `filestore_upload_rate_per_min` (host_vars) | `30` per client IP per minute, burst `20`, `nodelay` | Counts **POST** to `/filestore/` only; reads are not limited. Over the limit → **HTTP 429**. The burst (20) is fixed in the template. Done in nginx because Kong sees every request as coming from nginx |
| Bucket-root listing | `location ~ ^/file-store/?([^/]+/?)?$ { return 403; }` | always on | Keeps listing closed even if the bucket policy is loosened again |

These two protections exist only where the host nginx from the Ansible template is used. A Helm/k8s deployment behind its own ingress does **not** get them; add equivalent rules to the ingress if that matters for the installation.

### 2.5 UI

`digit-ui-esbuild/packages/libraries/src/services/atoms/UploadServices.js` sends the `auth-token` header with every `/filestore/v1/files/url` request. No setting. **Deploy the new UI before the gateway change** (2.1): with the old UI, an employee who opens a complaint with photos is signed out, because the photo request carries no token and the gateway answers 401.

### 2.6 Applying #223 to an existing server: `secure-filestore.sh`

`local-setup/scripts/secure-filestore.sh` applies all of the above to a **running** Ansible/Compose server, idempotently, with a backup under `<digit-dir>/backup-vapt223-<timestamp>/`. Run as root on the server, from a checkout of this branch.

| Command | Does |
|---|---|
| `--dry-run` | check everything, change nothing |
| *(no option)* | bucket policy + link lifetime + nginx (steps `minio,filestore,nginx`) |
| `--build-ui` | the above, then rebuild and deploy digit-ui and the configurator, then Kong |
| `--ui-ready` | apply the Kong step; you deployed the new UI yourself |
| `--only <minio,filestore,nginx,ui,kong>` | one or more steps |
| `--rollback <backup-dir>` | restore kong.yml, compose, nginx and UI files from a backup; add `--reopen-bucket` to make the bucket public again |
| `--url <base>` | base URL for the final checks (default `http://localhost`) |
| `--ui-work`, `--global-configs`, `--configurator-dir`, `--digit-dir`, `--nginx-site`, `--yes` | paths and prompts; see the header of the script |

The script refuses the Kong step unless `--build-ui` or `--ui-ready` is given, for the reason in 2.5.

---

## 3. Login sessions (#224): employee, citizen, configurator

Employees, citizens and the configurator's admin all keep their login in the browser tab (`sessionStorage`), never in `localStorage`: closing the tab ends it, a new tab asks for it again, reloading the same tab keeps it. Only **employees** are also signed out when idle (3.1, 3.2); citizens have no idle timer, so a citizen filling a complaint on a slow network is never cut off. Keycloak mode keeps its own adapter and is not changed.

### 3.1 `EMPLOYEE_IDLE_TIMEOUT_MINUTES`

An employee with no mouse, keyboard, touch, scroll or wheel activity in **any** of their open employee tabs for this many minutes is signed out (the server session is ended, then the tab goes to the login page with `?reason=idle`).

| Path | Where | How |
|---|---|---|
| Bundled default | `digit-ui-esbuild/public/globalConfigs.js` | `var employeeIdleTimeoutMinutes = 15;` |
| Ansible | `inventory/host_vars/<tenant>.yml` | `employee_idle_timeout_minutes: 15` → rendered into `globalConfigs.js` by `templates/globalConfigs.js.j2` |
| Helm | `charts/urban/digit-ui/values.yaml` | `globalConfigs.employeeIdleTimeoutMinutes: 15` → `files/globalConfigs.js.tpl` |

Accepted values (parsing in `libraries/src/services/atoms/Utils/idleTimer.js`):

| Value | Effect |
|---|---|
| missing, empty, not a number | 15 minutes |
| `0` or negative | idle sign-out **off** (and no warning) |
| any positive number | that many minutes; decimals allowed (`0.5` = 30 s, useful for a quick test) |

Scope: only a **signed-in employee on employee pages with DIGIT login**. Citizen pages, the public landing page and Keycloak mode are untouched. A change takes effect on the next page load; no rebuild is needed on Ansible/Helm (the file is rendered at deploy time), a rebuild is needed when you edit the bundled file.

### 3.2 `EMPLOYEE_IDLE_WARNING_SECONDS`

This many seconds before the idle sign-out, a dialog ("Are you still there?") shows a countdown with **Stay signed in** and **Sign out now**. While it is up, moving the mouse does not keep the session; only the buttons, the close icon or a click outside the dialog do, and "Stay signed in" also closes it in the employee's other tabs.

| Path | Where |
|---|---|
| Bundled default | `public/globalConfigs.js`: `var employeeIdleWarningSeconds = 60;` |
| Ansible | `employee_idle_warning_seconds: 60` in host_vars |
| Helm | `globalConfigs.employeeIdleWarningSeconds: 60` in `digit-ui/values.yaml` |

| Value | Effect |
|---|---|
| missing, empty, not a number | 60 seconds |
| `0` or negative | no warning; the sign-out happens silently at the timeout |
| larger than half the timeout | capped at half the timeout (with the default 15 min, the maximum is 7.5 min) |
| anything, when the timeout is `0` | ignored |

### 3.3 Login token lifetime (egov-user)

`ACCESS_TOKEN_VALIDITY_IN_MINUTES` went from `10080` (7 days) to `480` (8 hours). **This applies to every user, citizens included**: after 8 hours a citizen in the app must sign in again. Nothing in the UI depends on the exact value; the idle sign-out works on top of it.

| Path | Where | Change it |
|---|---|---|
| Ansible, Compose | `egov-user` service in all five `local-setup/docker-compose*.yml`: `ACCESS_TOKEN_VALIDITY_IN_MINUTES: "${ACCESS_TOKEN_VALIDITY_IN_MINUTES:-480}"` | set `ACCESS_TOKEN_VALIDITY_IN_MINUTES=10080` in `.env` (or the host env) and recreate `egov-user` |
| Helm | `environments/env.yaml` `egov-user: access-token-validity: 480` and `charts/core-services/egov-user/values.yaml` / `egov-user-enc-values.yaml` `access-token-validity: "480"` | change the value, `helm upgrade` egov-user |

Only a restart or redeploy of `egov-user` picks the value up. A UI-only redeploy does not change it.

### 3.4 Behaviour that is fixed by design (no setting)

| Behaviour | Why there is no switch |
|---|---|
| The employee token and user details are stored **per tab** (`sessionStorage`), never in `localStorage`; closing the tab ends the login, a new tab asks for login | this is the finding being fixed |
| Logins saved by an older build are removed on first load: employee (`Employee.token`, `Employee.user-info`, `Employee.refresh-token`), citizen (`Citizen.token`, `Citizen.user-info`, `Citizen.refresh-token`, `citizen.userRequestObject`) and the shared `token` / `user-info` | a stale credential must not outlive the update |
| A citizen's token and details are stored **per tab** too: a new tab or a new visit asks for the OTP again; reloading the tab keeps the login | the same finding on the citizen side; there is no idle timer for citizens |
| The configurator keeps the admin login (`crs-auth-state`) **per tab**; a copy an older build left in `localStorage` is moved into the tab once on load and then deleted | the admin token must not outlive the session; the one-time move keeps an operator who is mid-onboarding on deploy day signed in |
| Logging out in one tab signs out the **same employee's** other tabs; a different employee in another tab stays signed in | the sign-out message carries a one-way hash of the user id, never a credential |
| After a sign-out the login page says why (`?reason=idle`, `expired`, `signed-out-elsewhere`) and returns to the page the employee was on (`?from=`); only paths under `/<context>/employee` are accepted, never another site, a protocol-relative address or the login page itself | an open redirect would be a new finding |
| The inbox "Open in new tab" button opens a complaint already signed in; a tab the employee opens by Ctrl+click or by typing the address still asks for login | `window.open` shares the tab storage, a user-opened tab does not; the button is the only sanctioned way |
| An invalid or expired token sends the user to the login page, not the error screen; a tab is warned when another account signs in on the same browser (session-collision notice) | prerequisites from CMS-KENYA that the fix builds on |

### 3.5 Browser storage keys you will see

Useful when inspecting a browser during support. None of them hold a credential except the per-tab `Digit.User`.

| Key | Store | Holds |
|---|---|---|
| `Digit.User` | sessionStorage (this tab) | the employee's token and user details |
| `Digit.UserTokenExpiryAt` | sessionStorage | when this tab's token dies (from `expires_in`, minus 60 s skew) |
| `Digit.IdleLogoutLogin` | sessionStorage | fingerprint of the login the idle clock was last reset for |
| `Digit.SessionCollisionAck` | sessionStorage | the other account this tab has already acknowledged |
| `Digit.EmployeeLastActivity` | localStorage (shared) | timestamp of the last activity in any employee tab |
| `Digit.EmployeeSignedOut` | localStorage (shared) | the last sign-out announcement: `{type, tab, at, user: <hash>}` |
| BroadcastChannel `digit-employee-session` | in memory | same announcement, for browsers that deliver it faster than the storage event |
| `Citizen.token`, `Citizen.user-info` | sessionStorage (this tab) | a citizen's token and details, on citizen pages |
| `crs-auth-state` | sessionStorage (this tab) | the configurator's admin login, token included |

### 3.6 Localization keys to seed

The new texts ship with English fallbacks in code; a locale without the key shows the English. Seed them for every active locale (`en_IN`, `pt_MZ`, …), then clear the localization cache (`docker exec digit-redis redis-cli DEL computedMessages messages` on a Compose server). The seed files for a fresh install are `utilities/default-data-handler/src/main/resources/localisations/default/rainmaker-common.json` and `rainmaker-pgr.json` (one `{code, message, module, locale}` entry per key); a live tenant gets them through the localization upsert API.

| Key | Module | English |
|---|---|---|
| `CORE_IDLE_WARNING_HEADING` | rainmaker-common | Are you still there? |
| `CORE_IDLE_WARNING_BODY` | rainmaker-common | You have not used CMS for a while. For your security you will be signed out soon. Anything you have not saved will be lost. |
| `CORE_IDLE_WARNING_COUNTDOWN` | rainmaker-common | Signing out in |
| `CORE_IDLE_WARNING_STAY` | rainmaker-common | Stay signed in |
| `CORE_IDLE_WARNING_SIGN_OUT` | rainmaker-common | Sign out now |
| `CORE_SIGNED_OUT_IDLE` | rainmaker-common | You were signed out because you had not used CMS for a while. Sign in again to continue. |
| `CORE_SIGNED_OUT_EXPIRED` | rainmaker-common | Your session has ended. Sign in again to continue. |
| `CORE_SIGNED_OUT_OTHER_TAB` | rainmaker-common | You signed out in another tab. Sign in again to continue. |
| `CS_OPEN_IN_NEW_TAB` | rainmaker-pgr | Open in new tab |

Portuguese runs 20–35 % longer than English; the dialog and the login notice wrap rather than truncate, so long translations are safe.

---

## 4. Changing a setting, per deployment path

**Ansible**
1. Edit `local-setup/ansible/inventory/host_vars/<tenant>.yml` (the file is gitignored; `_example.yml` does not list these variables yet, add them by name):
   ```yaml
   employee_idle_timeout_minutes: 15     # 0 = off
   employee_idle_warning_seconds: 60     # 0 = no warning
   filestore_upload_rate_per_min: 30
   ```
2. For the token or link lifetime, set `ACCESS_TOKEN_VALIDITY_IN_MINUTES` / `FILESTORE_URL_EXPIRY_SECS` in the server's compose `.env`.
3. `cd local-setup/ansible && ./deploy.sh <tenant>` (renders `globalConfigs.js` and the nginx site, recreates changed services).

**Docker Compose**
1. Idle settings: edit `digit-ui-esbuild/public/globalConfigs.js`, rebuild the UI (`npm run build`), redeploy it.
2. Token / link lifetime: set the two variables in `.env`, then `docker compose up -d egov-user egov-filestore`.

**Helm**
1. Idle settings: `charts/urban/digit-ui/values.yaml` → `globalConfigs.employeeIdleTimeoutMinutes`, `globalConfigs.employeeIdleWarningSeconds`; `helm upgrade` digit-ui.
2. Token lifetime: `access-token-validity` in `environments/env.yaml`; `helm upgrade` egov-user.
3. Link lifetime: add `filestore-url-validity: "3600"` under `egov-filestore:` in `env.yaml`; `helm upgrade` egov-filestore.

---

## 5. Checking a deployment

Without a login (replace the host):

```bash
B=https://<host>
curl -s -o /dev/null -w '%{http_code}\n' "$B/filestore/v1/files/url?tenantId=x&fileStoreIds=00000000-0000-0000-0000-000000000000"   # 401
curl -s -o /dev/null -w '%{http_code}\n' "$B/filestore/v1/files/id?tenantId=x&fileStoreId=00000000-0000-0000-0000-000000000000"     # 401
curl -s -o /dev/null -w '%{http_code}\n' "$B/file-store/"                                                                             # 403 (Ansible nginx path)
curl -s "$B/digit-ui/globalConfigs.js" | grep -i idle                                                                                 # the two idle values
```

Signed in as an employee:

- Open a complaint with photos: the photos show, you stay signed in, and the photo links carry `X-Amz-Expires=3600`.
- Open a second tab by typing the address: it asks for login. The inbox "Open in new tab" button opens a complaint signed in.
- Stay idle: the warning appears one minute before the timeout; "Stay signed in" keeps you in; ignoring it signs you out and the login page says why; signing in returns you to the same page.
- Log out in one tab: the other tab signs out and says so.

Signed in as a citizen:

- DevTools → Application: `Citizen.token` is under **Session storage**, and **Local storage** holds no `token`, `Citizen.token`, `user-info` or `citizen.userRequestObject`.
- Reload: still signed in. Open the site in a new tab: "My complaints" asks for login (OTP).

Signed in to the configurator:

- `crs-auth-state` is under **Session storage**, not Local storage. A new tab opens the login page.

Automated (from `local-setup/tests`, Node 20):

```bash
BASE_URL=https://<host> DIGIT_TENANT=<tenant> DIGIT_USERNAME=<employee> DIGIT_PASSWORD=<password> \
  npx playwright test --config=e2e/playwright.config.ts e2e/specs/employee/session-224
# citizens: a registered test citizen and the fixed test OTP of a NON-production stack
BASE_URL=https://<host> CITIZEN_MOBILE=<mobile> CITIZEN_OTP=<otp> \
  npx playwright test --config=e2e/playwright.config.ts e2e/specs/citizen/session-citizen.spec.ts
```

---

## 6. Known gaps and follow-ups

| Item | Status |
|---|---|
| Helm `filestore-url-validity` not set → 24 h links on k8s | add `"3600"` to `env.yaml` (2.3) |
| Upload rate limit and bucket-root 403 exist only in the Ansible nginx template | add to the k8s ingress if needed (2.4) |
| `host_vars/_example.yml` does not list the three new Ansible variables | document them there (4) |
| Any signed-in user may call the filestore paths; no per-file ownership check | #223 Phase 2 (filestore service) |
| The 8-hour token applies to citizens | raise `ACCESS_TOKEN_VALIDITY_IN_MINUTES` if that is unwanted for an installation (3.3) |
| Citizens sign in again (OTP) in every new tab and on every new visit | more OTP SMS than before; accepted for #224 |
| `CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED=true` on a public server lets anyone who knows the fixed OTP sign in as any citizen | keep it off outside test-only stacks |
