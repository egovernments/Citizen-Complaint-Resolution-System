# 5. Self-hosted Matomo, end to end

> **One-command path.** Everything in Phase A and Phase C below is automated by
> the unified runner, ON the serving box:
>
> ```bash
> node docs/migration/ccrs-migrate.cjs --host <public base URL> --tenant <stateRoot> \
>   --user <admin> --pass '<pw>' \
>   --only matomo --matomo --matomo-admin-pass '<strong password>'
> ```
>
> That brings the compose stack up (`local-setup/docker-compose.matomo.yml`),
> runs the **unattended install** (it drives the web wizard — Matomo 5 ships no
> CLI installer), sets the proxy header so visitor IPs are real, inserts the two
> same-origin nginx tracking locations, and creates the MDMS destination row
> **born disabled**. Add `--matomo-enable` to flip the row on — the flip is
> refused unless the public tracker probe passes, so one command can never leave
> an enabled row pointing at a 404. Re-running is safe; every step detects work
> already done. On ansible-managed boxes also set `nginx_features.matomo: true`
> in host_vars so the next `./deploy.sh` keeps the locations.
>
> The manual walkthrough below remains the reference for what the phase does,
> for non-docker installs, and for debugging when a step fails.

Every step below was executed on a real box, in this order, and the traps noted
are ones we actually hit — not hypotheticals. Follow it top to bottom and you
should not get stuck.

Three phases: **install** Matomo, **deploy** the portal shim, **configure** the
destination. Nothing is sent to Matomo until the very last step.

---

## Phase A — Install Matomo

### A1. Understand what you are installing

Matomo On-Premise is free and self-hosted. There is **no account to create
anywhere** — you install the software, and its first-run installer creates the
admin user on your own instance. (Matomo *Cloud* is the paid, hosted product with
a signup; that is a different thing.)

Matomo needs **PHP + MySQL/MariaDB**. The DIGIT stack is Postgres only and Matomo
cannot use it, so the compose file below brings its own MariaDB. It touches
nothing the platform depends on.

### A2. Start the containers

The compose file is opt-in and is never part of the default stack:

```bash
cd /opt/digit
docker compose -f docker-compose.matomo.yml up -d
```

Wait for it to answer:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -L http://127.0.0.1:8080/    # expect 200
```

> **Why port 8080 and not a path?** Matomo emits absolute asset URLs, so serving
> the whole app under `/matomo/` breaks its dashboard (CSS and JS 404). The admin
> UI therefore lives on its own port, and only the two *tracking* endpoints are
> proxied same-origin in Phase B. Both are bound to `127.0.0.1` — nothing here is
> reachable off-box.

### A3. Expose the two tracking endpoints

Add these to the host nginx site (`/etc/nginx/sites-enabled/localhost`), next to
the other `location` blocks:

```nginx
  location = /matomo/matomo.js {
    proxy_pass http://127.0.0.1:8080/matomo.js;
    proxy_set_header Host 127.0.0.1:8080;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
  }

  location = /matomo/matomo.php {
    proxy_pass http://127.0.0.1:8080/matomo.php;
    proxy_set_header Host 127.0.0.1:8080;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
  }
```

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost/matomo/matomo.js
# expect: 200 text/javascript
```

> **TRAP 1 — `Host` must be Matomo's own origin, not the portal's.**
> Matomo refuses any request whose `Host` header it does not recognise. The
> obvious `proxy_set_header Host $host;` sends `localhost`, which Matomo has never
> heard of, and tracking fails after install. Sending `127.0.0.1:8080` — the host
> its installer records — avoids the problem entirely. Nothing is lost: the tracked
> page URL travels in the payload's `url=` parameter, not the `Host` header.
>
> Do **not** try to fix this with `MATOMO_GENERAL_TRUSTED_HOSTS` in the compose
> file. We tried; the `matomo:5-apache` image only reads its `MATOMO_DATABASE_*`
> variables, so that setting is silently inert.

> **Note:** `/etc/nginx/sites-enabled/localhost` is ansible-generated, so the next
> `./deploy.sh` overwrites these blocks. For a durable install, add them to
> `local-setup/ansible/templates/nginx-site.conf.j2` behind an `nginx_features`
> flag.

### A4. Run the installer

Open **http://127.0.0.1:8080/** and work through the eight steps.

**Database Setup** — the fields arrive pre-filled from the container. Leave them:

| Field | Value |
|---|---|
| Database Server | `matomo-db` |
| Login | `matomo` |
| Password | `matomo_local_only` |
| Database Name | `matomo` |
| Table Prefix | `matomo_` |

The password looks weak because MariaDB has **no published port** — it is only
reachable inside the docker network. On a real environment this belongs in a
secret, not a compose file.

**Superuser** — this is your Matomo admin login. You choose it.

**Set up a Website** — name it `Digit Portal`, URL `http://localhost`.

> **TRAP 2 — the URL field already contains `https://`.** Typing over it produces
> `http://localhosthttps://`. Clear the field completely first.

**Timezone** — pick the zone you will read reports in. Report days are cut on this
boundary and it cannot be changed later without breaking report continuity.

**JavaScript Tracking Code** — **skip this screen entirely. Do not copy the
snippet.**

> **TRAP 3 — pasting that snippet is the classic mistake.** The portal already has
> the analytics shim, which does the same job *plus* PII scrubbing, tenant
> dimensions, derived page titles and the kill switches. Pasting the raw snippet
> creates a second, independent tracker: doubled pageviews, doubled visit counts,
> and the pasted one bypasses every guard. Note the **Site ID** (normally `1`) and
> move on.

Finish. You now have a working Matomo with zero data in it.

---

## Phase B — Deploy the portal shim

The shim is `digit-ui-esbuild/public/analytics.js`. It is copied verbatim into
`build/` by the build — no build-script change is needed.

```bash
cd digit-ui-esbuild
node esbuild.build.js                         # Node 20
```

Deploy it the way that environment receives frontend assets. On a container-mode
box, during development:

```bash
docker cp build/analytics.js digit-ui:/var/web/digit-ui/analytics.js
docker cp build/index.html  digit-ui:/var/web/digit-ui/index.html
```

Confirm it is served as **JavaScript**, not HTML:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost/digit-ui/analytics.js
# expect: 200 application/javascript
```

> **Why the content type matters:** every nginx layer here ends in
> `try_files $uri $uri/ /digit-ui/index.html`, so a *missing* `analytics.js`
> returns `200 text/html` — the SPA shell — not a 404. The bootstrapper in
> `index.html` checks the content type for exactly this reason, so an environment
> running an older bundle stays silently inert instead of trying to execute HTML.

> **Remember to redeploy after every change.** We lost time to this: the shim was
> updated in the repo but the container still served the old copy, and the symptom
> was a confusing `script_url_not_https` in the console. If behaviour does not
> match the code, check what is actually being served first.

Aggregated Matomo reports need an archiving run; without it *Visitors → Overview*
and the dashboard graphs look empty even though data is arriving:

```bash
docker exec matomo php /var/www/html/console core:archive --url=http://127.0.0.1:8080/
```

Worth a cron only if you keep this Matomo permanently.

---

## Phase C — Configure the destination

### C1. Make sure the MDMS schema exists

```bash
TENANT=mz ./local-setup/scripts/seed-analytics-schema.sh
```

Idempotent, creates **no records**, and refuses a dotted tenant on purpose
(a schema registered under a city tenant is permanently invisible and cannot be
repaired — there is no schema update or delete API).

### C2. Create the destination in the Configurator

Sign in at **http://localhost/configurator/** — *Management* mode, and note there
are **three** fields, not two:

| Field | Value |
|---|---|
| Mode | **Management** |
| Username | your employee login, e.g. `ADMIN` |
| Password | — |
| **Tenant Code** | `mz` — required, easy to miss |

Then **System → Analytics Providers → Add destination**:

| Field | Value |
|---|---|
| Code | `matomo-local` — permanent, and it is the MDMS identity. Pick something durable |
| Provider | `MATOMO` |
| Script URL | `/matomo/matomo.js` |
| Endpoint URL | `/matomo/matomo.php` |
| Matomo site ID | `1` |
| Surfaces | leave empty for both, or `citizen` / `employee` |
| Enabled | **leave unticked for this first save** |

Save.

> The greyed text in **Code** is placeholder text, not a value. Leaving it
> untouched gives you "a code is required".

> **Why a path and not a full URL?** `/matomo/matomo.js` is same-origin: it needs
> no TLS, needs no entry in the ops host allowlist, and inherits the page's
> scheme. It is the only form that works where the portal is served over plain
> http. A full `https://…` URL is also supported, but its host must then be
> declared by ops in `analytics_script_hosts`.

> **TRAP 4 — a path under the SPA prefix will be refused.** `/digit-ui/matomo.js`
> looks reasonable and is rejected on purpose: nginx answers anything under
> `/digit-ui/` with the HTML shell, which would throw on every page load. Keep the
> collector at a top-level path like `/matomo/`.

### C3. Turn it on

Edit the row, tick **Enabled**, save. Self-hosted Matomo needs no residency
acknowledgement; a cloud destination (GA4, PostHog, Sentry) does.

Changes reach the portal on the next page load, worst case ~90 seconds later.

### C4. Verify

Browse the portal — a few different pages. Then in Matomo:

**Visitors → Visits Log**

> **TRAP 5 — check the date first.** The installer leaves `date=yesterday` in the
> URL, so the report reads "There is no data" even when tracking is working
> perfectly. Switch the date picker to **Today**. **Visitors → Real-time** ignores
> the date entirely and is the fastest sanity check.

You should see one visit with your pages, each carrying a derived title:

| Page | Title |
|---|---|
| `/employee/user/login` | Account · Login · Employee |
| `/citizen/pgr/complaints` | Complaints · Complaints · Citizen |
| `/employee/pgr/inbox` | Complaints · Inbox · Employee |
| `/citizen/pgr/complaint-details/:id` | Complaints · Complaint Details · Citizen |

Then prove the scrubbing yourself. Open a complaint page with PII in the URL:

```
http://localhost/digit-ui/citizen/pgr/complaint-details/PRD-2026-000023?mobileNumber=841234567&tenantId=mz
```

In the Visits Log that page must appear as
`/citizen/pgr/complaint-details/:id?tenantId=mz` — the complaint id parameterised,
the mobile number and its parameter gone, `tenantId` kept because it is on the
allowlist.

If you have shell access, check what was *stored* rather than what was sent:

```bash
docker exec matomo-db mariadb -umatomo -pmatomo_local_only matomo -N -e "
  select count(*) from matomo_log_action where name like '%841234567%';"    # expect 0
```

### C5. Privacy settings on the Matomo side

The shim controls the payload, but the visitor IP is derived server-side from the
request and is the one identifying field it cannot reach:

- **Administration → Privacy → Anonymize data** → anonymise visitor IP (2–3 bytes)
- **Administration → Privacy** → set a retention period for raw logs
- **Administration → Websites → Manage → Excluded IPs** → add your own QA IPs;
  Matomo has no bot filter, so automated test traffic *does* land in reports

---

## If nothing arrives

Work down this list; the first check usually answers it.

| Check | What it tells you |
|---|---|
| Browser console, `[analytics]` lines (enable **Verbose**) | The shim logs exactly one line naming the reason it stopped: `off: kill switch`, `off: DNT`, `skipping <code>: script_url_not_https`, `no providers configured` |
| `window.DigitAnalytics._internal.providers()` | How many destinations are actually live. `0` means nothing was accepted |
| DevTools → Network, filter `matomo` | `matomo.js` should load, then `matomo.php` once per route change |
| `curl -sI http://localhost/digit-ui/analytics.js` | Content type must be `application/javascript`. `text/html` means the file is missing on that box |
| Matomo date picker | Set to **Today** — see Trap 5 |
| Ad blocker | Blocks Matomo far less often than PostHog, but check in a clean window |

---

## Stopping and removing it

```bash
# stop, keep the data
cd /opt/digit && docker compose -f docker-compose.matomo.yml down

# remove the data too (irreversible)
docker volume rm digit_matomo digit_matomo-db
```

Switching the destination off in the Configurator (`Enabled` unticked) is enough
to stop the portal sending; the containers can stay up.
