# Deploying self-hosted Matomo

Matomo is the analytics destination a CCRS deployment sends portal usage to. It
is [open-source web analytics](https://matomo.org/) — the self-hostable
alternative to Google Analytics — and self-hosting is the whole point here:
with Google Analytics, citizen browsing data leaves the deployment's
infrastructure. With Matomo On-Premise, the visit data stays in a database the
deployment owns.

This document covers **standing the server up**, on both deployment tiers.

## What this is not

Deploying Matomo sends nothing anywhere. It stands up an empty, self-contained
analytics server that no page is yet pointed at.

Pointing the portal at it is a **separate, MDMS-driven step** — configurator →
*System → Analytics Providers* — done deliberately that way so collection can
be switched on and off without a redeploy. The browser-side half (the analytics
shim, the PII scrubbing, the provider registry) is its own piece of work; this
document stops where that one starts, and §"Pointing the portal at it" below is
the handover.

Two other things this is not:

- **Not the install telemetry.** `local-setup/telemetry/sidecar.sh` already
  sends *installation* events (did this stack come up, did a container die)
  outbound to eGov's central Matomo at `unified-demo.digit.org`. That is a
  different thing, on a different instance, answering a different question, and
  it is not in the ansible-deployed compose stack at all.
- **Not Matomo Cloud.** Matomo On-Premise is free and there is no account to
  create anywhere. Its first-run installer creates the admin user on your own
  instance. Matomo *Cloud* is the paid hosted product with a signup; that is a
  separate product and none of this applies to it.

---

## Which tier are you on?

| | Compose / Ansible | Kubernetes / Helm |
|---|---|---|
| Where | `local-setup/` | `devops/deploy-as-code/` |
| Switch | `enable_matomo: true` in `host_vars/<tenant>.yml` | `installed: true` on the `matomo` release |
| Matomo install | unattended, by the deploy | unattended, by the chart |
| Public surface | two tracking endpoints only | `/matomo` ingress |
| Verified | yes — installed and tracked end to end | template-level only (see §Status) |

Both tiers install Matomo without a human. They get there differently: the k8s
tier uses Bitnami's chart, which installs from `matomoUsername` /
`matomoPassword`; the compose tier uses the **official** `matomo:5-apache`
image, which has no such support, so the deploy drives Matomo's own install API
directly (`local-setup/ansible/files/matomo-bootstrap.php`). See §"How the
headless install works" for why that script exists and what it does.

---

## Compose / Ansible tier

### 1. Turn it on

Two flags in `local-setup/ansible/inventory/host_vars/<tenant>.yml`, and it must
be both:

```yaml
enable_matomo: true

nginx_features:
  matomo: true
  # ... your other nginx_features; this map REPLACES the group_vars default
  # wholesale, so list everything you want, not just this line.
```

`preflight.py` refuses either flag on its own, because each half without the
other produces a deploy that reports success and collects nothing:

- `enable_matomo` alone starts the containers bound to `127.0.0.1`, so the
  browser has nothing same-origin to talk to.
- `nginx_features.matomo` alone renders location blocks proxying to a loopback
  port nothing is listening on — 502 on every tracking request.

Then:

```bash
cd local-setup/ansible
./deploy.sh <tenant>
```

The deploy copies `docker-compose.matomo.yml`, generates and stores the MariaDB
credentials in OpenBao, renders the nginx blocks, and starts three containers:

| Container | What it is | Memory cap |
|---|---|---|
| `digit-matomo` | Matomo itself (PHP + Apache), bound to `127.0.0.1:18081` | 512M |
| `digit-matomo-db` | its own MariaDB, no published port | 512M |
| `digit-matomo-archiver` | hourly `core:archive` loop | 384M |

**Why its own database:** Matomo is PHP + MySQL/MariaDB and cannot use the
platform's Postgres. The overlay brings its own. It shares nothing with the
platform except the docker network.

**Roughly 1 GB of RAM** for the three. On a 16 GB box with no swap that is a
real allocation — which is why the default is off.

### 2. Sign in

There is nothing to install — `./deploy.sh` already did it. The deploy prints:

```
Matomo: INSTALLED. Sign in as admin — password: bao kv get -field=matomo_admin_password <secrets_path>
```

The password is generated once and kept in OpenBao. It is never written to
`host_vars`, and it is not something you choose — which is deliberate, and
better than the wizard's typed password on every axis: unique per tenant, never
on disk in the inventory, and recoverable at any time with that command.

The admin UI is on loopback, so reach it through a tunnel:

```bash
ssh -L 18081:127.0.0.1:18081 <your-digit-host>
# then open http://127.0.0.1:18081/
```

Note the **Site ID** (normally `1`) — you need it when pointing the portal at
this instance.

> Matomo's dashboard will offer to show you a **JavaScript tracking code**.
> Ignore it. The portal's analytics shim already sends these events, with PII
> scrubbing on top; pasting Matomo's snippet creates a second, independent
> tracker that doubles every count and bypasses every guard.

Prefer to click through the wizard yourself? Set `matomo_auto_install: false`.
Everything else about the packaging is identical; you get an uninstalled Matomo
on loopback and the eight steps.

### 3. Adding it to a box that is already running

If you would rather not re-run a full deploy, there is an incremental path,
matching `enable-dashboard.sh` and `enable-notifications.sh`:

```bash
# on the box — MATOMO_ADMIN_PASSWORD is the one value you supply
MATOMO_ADMIN_PASSWORD='...' local-setup/scripts/enable-matomo.sh
local-setup/scripts/enable-matomo.sh --list     # what it will do
local-setup/scripts/enable-matomo.sh --dry-run  # change nothing
local-setup/scripts/enable-matomo.sh --only step6   # just verify
```

It preflights, generates the database credentials, starts the three containers,
installs Matomo headlessly, applies the post-install settings, and verifies.

`MATOMO_ADMIN_PASSWORD` is required rather than generated — same convention as
`enable-notifications.sh` and its `TWILIO_*` variables. If ansible has already
deployed this tenant, use the password it stored, so the two do not disagree
about a credential nobody can then look up:

```bash
bao kv get -field=matomo_admin_password <secrets_path>
```

It deliberately **does not touch the nginx vhost.**
`/etc/nginx/sites-enabled/<site>` is generated by ansible, so hand-edits there
are erased by the next deploy — silently, with the symptom being analytics that
worked for a week and then stopped. The location blocks come from
`nginx_features.matomo` and a deploy; the script tells you whether they are live
yet.

### 4. Verify

```bash
# the admin UI (through your tunnel)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18081/     # 200

# what the browser actually fetches — check the CONTENT TYPE, not just the code
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  http://localhost/matomo/matomo.js                                  # 200 text/javascript
```

`200 text/html` on that second command is the failure worth knowing about: with
`nginx_features.matomo` off there is no block for that path, so it falls through
to the digit-ui location, whose `try_files` ends at the SPA shell. nginx answers
**200** with HTML. Nothing looks broken; the browser just tries to execute HTML
as JavaScript.

---

## Kubernetes / Helm tier

The chart is vendored at
`devops/deploy-as-code/charts/backbone-services/matomo` (Bitnami matomo 11.0.0,
taken from `DIGIT-DevOps@central-instance-deployment`), with its `mariadb` and
`common` subcharts vendored unpacked under `charts/`, matching how the
`postgresql` chart in the same directory is vendored.

### 1. Set the secrets first

In `devops/deploy-as-code/charts/environments/env-secrets.yaml`:

```yaml
secrets:
    matomo:
        password: <the Matomo superuser password>
        dbPassword: <MariaDB app password>
        dbRootPassword: <MariaDB root password>
```

**Before the first apply, not after.** The chart installs Matomo unattended, and
its first run is the only moment `matomoPassword` is read. Fixing it later means
resetting the password from inside the pod.

### 2. Turn it on

In `charts/backbone-services/backboneservices-helmfile.yaml`, flip the `matomo`
release to `installed: true`. That is the only switch — the chart has no second
internal gate.

It asks for **two 30 Gi volumes** (Matomo + MariaDB), publishes at
`https://<domain>/matomo` with the deployment's existing `<domain>-tls-certs`,
and runs in the `backbone` namespace.

### 3. Know what you are running: `bitnamilegacy`

Every image this chart and its mariadb subchart pin is **404 on Docker Hub
today.** Verified against the registry API:

| Pinned by the chart | On Docker Hub | Under `bitnamilegacy/` |
|---|---|---|
| `bitnami/matomo:5.3.2-debian-12-r12` | 404 | present |
| `bitnami/os-shell:12-debian-12-r50` | 404 | present |
| `bitnami/apache-exporter:1.0.10-debian-12-r55` | 404 | present |
| `bitnami/mariadb:12.0.2-debian-12-r0` | 404 | present |
| `bitnami/mysqld-exporter:0.17.2-debian-12-r16` | 404 | present |

Bitnami moved its legacy tags to the `bitnamilegacy/` namespace, so the helmfile
release re-points every one of them there — the same remedy, for the same cause,
as the kafka-kraft exporters a few releases above it. Deployed as the guide
writes it, without those overrides, the release is ImagePullBackOff on every
pod, not a partial degradation.

One image could not be fixed from the helmfile: the chart hardcodes
`bitnami/os-shell` inside its `sidecars:` template string, where no values
override reaches it. That one is patched in the vendored `values.yaml` and
carries a `LOCAL MODIFICATION` comment — **re-apply it if the chart is ever
re-vendored from upstream.**

And be clear about what `bitnamilegacy` *means*: those tags are frozen and
receive no further updates, security ones included. For a server holding citizen
browsing data that is a real posture cost. The durable fix is mirroring these
into `egovio/` with version tags, which needs registry push rights this work did
not have — the same follow-up the kafka comment names.

---

## Pointing the portal at it

This is MDMS, not a redeploy. In the configurator (*Management* mode — note it
needs a **Tenant Code** as well as username and password), go to *System →
Analytics Providers → Add destination*:

| Field | Value |
|---|---|
| Code | something durable — this is the permanent MDMS identity |
| Provider | `MATOMO` |
| Script URL | `/matomo/matomo.js` |
| Endpoint URL | `/matomo/matomo.php` |
| Matomo site ID | `1` (whatever the installer showed you) |
| Enabled | tick it when you want collection to start |

**Why a path and not a full URL.** `/matomo/matomo.js` is same-origin: it needs
no TLS of its own, no entry in the ops host allowlist, and it inherits the
page's scheme. It is the only form that works where the portal is served over
plain http.

**Do not use a path under `/digit-ui/`.** It looks reasonable and is refused on
purpose: nginx answers anything under the SPA prefix with the HTML shell.

---

## Traps

These are the ones that cost real time. Most are already handled by the packaged
config — they are here so the config makes sense, and so you recognise the
symptom if you diverge from it.

**The `Host` header, and what the trusted-host check actually does.** The
installer records only the origin you reached it through — after a tunnelled
install, `config.ini.php` contains exactly:

```
trusted_hosts[] = "127.0.0.1:18081"
```

The nginx template therefore sends `Host 127.0.0.1:<upstream_matomo_port>`
rather than `$host`, so Matomo's view of its own origin stays consistent with
what it was installed as.

The widely-repeated justification for this — that Matomo refuses requests whose
`Host` it does not recognise, so `$host` breaks tracking — is **not what
happens**, and this was measured rather than assumed. A tracking hit sent
through a deliberately naive `proxy_set_header Host $host;` block carrying
`Host: evil.example.org` was recorded normally, with the correct visitor IP. The
trusted-host check guards the **UI and API**, where a poisoned `Host` would end
up in generated links and password-reset mail; it does not gate `matomo.php`.

So keep the override — it is free, and it is right — but if you inherit a
deployment that uses `$host`, that is not why analytics is missing. Look at
`proxy_client_headers` and the archiver first.

**Do not try to fix that with `MATOMO_GENERAL_TRUSTED_HOSTS`.** The
`matomo:5-apache` image reads its `MATOMO_DATABASE_*` variables and nothing
else, so any `MATOMO_GENERAL_*` you set is silently inert. Post-install General
settings go through `console config:set`, which is what the deploy does.

**`config:set --key='name[]'` does not append to arrays.** Matomo's own help
says so plainly. The option form silently writes nothing useful for array
settings; only the positional, JSON-encoded form works:

```bash
docker exec digit-matomo php /var/www/html/console config:set 'General.trusted_hosts[]="matomo"'
```

**Visitor IPs are the Docker bridge gateway unless you say otherwise.** This is
the one setting here that was proved load-bearing by breaking it. Matomo derives
the visitor IP from `REMOTE_ADDR`, which behind the host proxy and docker-proxy
is the bridge gateway. Same client, same request, only the setting differing:

| `General.proxy_client_headers` | Stored IP |
|---|---|
| `HTTP_X_FORWARDED_FOR` | `192.168.0.0` — the real visitor, 2 bytes masked |
| removed | `172.19.0.0` — the Docker bridge gateway |

Without it every visit in the country lands on one address, geolocation reports
a single point, and "anonymise visitor IP" has nothing meaningful left to
anonymise. The deploy sets it; `enable-matomo.sh --only step5` repairs it.

Note that the anonymiser is on by default on a fresh install (2 bytes masked),
which is why both values above end in `.0.0`. That is Matomo's own privacy
default, not something this packaging adds.

**Reports read "no data" when everything is working.** The installer leaves
`date=yesterday` in the URL. Set the date picker to **Today**. *Visitors →
Real-time* ignores the date entirely and is the fastest sanity check.

**Dashboards stay empty without archiving.** Matomo records hits and computes
reports separately. The `digit-matomo-archiver` container runs
`console core:archive` hourly for exactly this reason; if you deploy Matomo some
other way, you need that cron or the graphs are blank forever.

Its `--url=http://matomo/` is why the deploy adds `matomo` to `trusted_hosts` —
but that is insurance, not a fix. Measured: forcing real archiving work with
`--url=http://definitely-not-trusted.invalid/` processed 4 archives and reported
no error, because this image supports CliMulti and archives in CLI subprocesses
that never issue an HTTP request. The host only matters on the fallback path,
where `exec()` is unavailable and CliMulti fetches `index.php` over HTTP into the
API's trusted-host check.

Also note the throttle: reports for today are recomputed at most every 900
seconds, so an archiving run that reports `Processed 0 archives` immediately
after another one is behaving correctly, not failing.

**"Is Matomo installed?" has two wrong answers and one right one.** The image
writes `config.ini.php` on first boot containing only
`[General] installation_first_accessed`, so testing for the *file* is wrong. And
testing for the `[database]` section is wrong too once the deploy exists, since
the deploy seeds that section *before* installing — it would report "installed"
for an instance with no schema at all, which is a false positive that makes a
failed install look successful. `[PluginsInstalled]` is the honest signal: it is
written only once the bundled plugins are actually in.

**Matomo rejects an email address with no dot in the domain.** `admin@localhost`
fails validation outright; `admin@matomo.local` passes. This matters because the
admin email defaults to `admin@<domain>`, and deployments with
`domain: localhost` do exist — the deploy falls back rather than failing the
whole install on an address nobody will read mail at.

**The installer's Website URL field is pre-filled with `https://`.** Typing over
it produces `http://hosthttps://`. Clear the field completely first.

---

## How the headless install works

Matomo ships no unattended installer for the official image, and Matomo 5's
console has no `core:create-superuser` — checked against the running image's
`console list`. But its wizard is thin: `plugins/Installation/Controller.php`
comes down to a handful of API calls. `local-setup/ansible/files/matomo-bootstrap.php`
makes those calls directly. It drives Matomo's own code rather than scraping its
forms, so there are no nonces or HTML to break on an upgrade.

The deploy runs it **twice**, and that is required rather than defensive:

| Pass | What it does |
|---|---|
| 1 | creates the schema, the superuser and `trusted_hosts`; **defers** the site |
| 2 | installs the bundled plugins, runs component updates, creates the site |

The reason is process-scoped state. `Environment->init()` builds the plugin
manager's view of the world at startup, and on pass 1 that happens against an
empty database — so `installLoadedPlugins()` later in the same process sees a
stale view and silently does nothing. A second process, starting against the
schema pass 1 laid down, gets it right.

Three things about this were learned the hard way and are worth keeping:

**Plugin installation is a separate step from creating the schema, and it is
the one that is easy to miss entirely** — because in a browser install it is not
part of the wizard at all. `FrontController::init()` calls
`installLoadedPlugins()` on *every request*, so the web installer gets it for
free. A CLI script never goes through `FrontController`. Skip it and you get an
install that looks completely finished — schema, superuser, site, working UI,
successful login — that answers **HTTP 400 on every tracking request**, because
the tracker touches `matomo_custom_dimensions` and no plugin table was ever
created. `DbHelper::createTables()` creates core tables only.

**It must run as `www-data`.** As root it leaves root-owned files under `tmp/`
and `config/`, and the next `www-data` run dies with *the directory
`/var/www/html/tmp/cache/tracker/` is not writable*. The console warns about
this if you ever run it as root; the warning is worth heeding.

**`console core:update` is not needed alongside it.** Measured: pass 2's own
component update covers the same ground and the result tracks. It is harmless if
you run it, but it is not load-bearing.

The superuser password is generated once and stored in OpenBao, exactly like the
Grafana admin password, and read back with
`bao kv get -field=matomo_admin_password <secrets_path>`. That is a better
answer than a wizard-typed password rather than a compromise: unique per tenant,
never on disk in the inventory, and recoverable.

## Turning it off, and removing the data

Set `enable_matomo: false` and re-deploy. The playbook tears the three
containers down — the same treatment `observability_level` gets, so that
"turned it off" and "it stopped running" mean the same thing.

The two named volumes survive, so the install and every recorded visit are still
there when you turn it back on. Removing the data is deliberately separate and
irreversible:

```bash
docker volume rm digit_matomo_data digit_matomo_db_data
```

To stop collection without touching the containers at all, untick **Enabled** on
the destination in the configurator. That is the fastest lever and needs no
deploy.

---

## Status of this work

Honest accounting of what was exercised.

**Verified by running it** — a real Matomo install on a local stack, tracked
through a real nginx proxy:

- profile gating — the overlay contributes no service without the `matomo`
  profile and all three with it
- all three containers start; MariaDB's healthcheck gates Matomo's start; Matomo
  answers `200`
- the rendered nginx blocks are valid config and serve `/matomo/matomo.js` as
  `200 text/javascript`
- **a tracking hit through `/matomo/matomo.php` lands as a visit**, with the page
  URL and derived title stored in `matomo_log_action` and linked to a visit
- **the visitor IP survives the proxy** — `192.168.0.0` (real client, 2 bytes
  masked) rather than `172.19.0.0` (the bridge gateway). Proved by removing
  `proxy_client_headers` and watching it regress, then restoring it with
  `enable-matomo.sh --only step5`
- **the archiver works** — the container's own loop reported
  `done: 3 req, 377 ms, no error`, and `matomo_archive_numeric_2026_08` holds
  computed `nb_visits` / `nb_uniq_visitors` rows
- **the post-install `config:set` task applies**, is idempotent on re-run (no
  duplicate array entries), and repairs a setting that has been removed
- **the headless install works from an empty volume** — schema, 68 plugins, 78
  component updates, superuser and site, with no browser involved; the resulting
  instance accepts a tracking hit (`200`, action stored) and the generated
  superuser genuinely authenticates (login `302`, dashboard `200`, no bounce
  back to the login form). Re-running it is a no-op
- **the ansible tasks themselves were executed**, not just linted: the five
  Matomo tasks were lifted verbatim out of `playbook-deploy.yml` into a minimal
  play and run against a throwaway container. They installed it, the templated
  values all landed (`tls_enabled: false` produced `http://` in the site URL,
  and the dotted-domain email fallback produced `admin@<domain>`), tracking
  returned `200`, and a second run reported **`changed=0`** with no duplicated
  `trusted_hosts` entries, no second `[database]` section and no extra site or
  user rows. Worth stating because these tasks carry `failed_when: false` — a
  green play is not on its own evidence that anything worked
- `yamllint`, `ansible-lint` (0 failures, 0 warnings, production profile) and
  `ansible-playbook --syntax-check` all pass
- `preflight.py --self-test`: 34/34, including three new Matomo cases
- the Helm chart renders through both `helm template` and `helmfile template`,
  every rendered image resolves to a tag that exists, and `spec.tls` has exactly
  one entry

**Two claims corrected by testing rather than inherited:** the trusted-host
check does not gate the tracker, and archiving succeeds with an untrusted
`--url`. Both settings are kept as cheap insurance, but the comments in the code
now say what was measured rather than repeating the folklore. See §Traps.

**One earlier conclusion reversed.** This work first shipped with the browser
wizard as a deliberate manual step, on the reasoning that an operator should
choose the admin password. That was wrong twice over: Matomo's installer is only
a handful of API calls, so headless is achievable; and a generated password held
in OpenBao is better than a typed one, not a compromise — which is exactly the
pattern this repo already uses for Grafana.

**Not verified — no cluster was available:** everything about the Helm tier
beyond rendering. The chart lints and templates; it has not been applied, so the
unattended install, the two 30 Gi PVCs and the ingress are unexercised.
