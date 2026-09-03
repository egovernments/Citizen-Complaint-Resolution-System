# DIGIT CRS - Local Development Stack

Run the DIGIT Citizen Complaint Resolution System: all core DIGIT services, the PGR
(Public Grievance Redressal) module, the citizen and employee web apps, and the tools
for creating a city and loading its data.

Three ways to run it, from a laptop container stack to a full deployment. Pick one and
follow it start to finish.

## Choose Your Setup Path

There are **three independent ways** to run this stack. Pick one:

| Path | Best for | What you need |
|------|----------|---------------|
| **[Option A: Docker Compose](#option-a-docker-compose)** | Quick setup, no extra tools | Docker only |
| **[Option B: Tilt](#option-b-tilt)** | Dashboard, grouped services, dev buttons | Docker + Tilt |
| **[Option C: Ansible](#option-c-ansible--the-whole-stack-one-command)** | A real deployment — web server, secret store, monitoring, onboarding wizard. This machine or a server. | Ansible (a script installs it) |

Options A and B are development stacks: containers on your machine, everything on
`localhost:18xxx` ports, no web server. **Option C is a deployment** — one command builds
the whole thing, on this machine or on a server, and serves it on the normal web ports.
It is also the only option with the browser onboarding wizard.

**Not sure?** Want to poke at the API or change some code — Option A. Setting the system
up for someone to actually use — Option C.

> **On Windows?** The full Ansible stack also runs locally via WSL2 — see
> [WINDOWS-QUICKSTART.md](../WINDOWS-QUICKSTART.md) (validated end-to-end on a
> 16 GB machine; the playbook self-heals the WSL-specific quirks). The macOS
> equivalent is [MAC-QUICKSTART.md](../MAC-QUICKSTART.md).

---

## Prerequisites

> **Going straight to Option C?** Skip this section. Its prerequisites are different
> (Ansible, Node, Python — not Docker, which the playbook installs for you) and
> [a script installs them](#step-2--install-the-prerequisites).

For Options A and B:

### Required

| Tool | Version | Install Link | What it's for |
|------|---------|-------------|---------------|
| [Docker Desktop](https://docs.docker.com/get-docker/) | 24+ | [Mac](https://docs.docker.com/desktop/install/mac-install/) / [Windows](https://docs.docker.com/desktop/install/windows-install/) / [Linux](https://docs.docker.com/desktop/install/linux/) | Runs all services as containers |
| [Docker Compose](https://docs.docker.com/compose/install/) | v2+ | Included with Docker Desktop | Orchestrates multi-container setup |
| [Git](https://git-scm.com/downloads) | 2.x | [Download](https://git-scm.com/downloads) | Clone the repository |

> **Memory**: Allocate at least **8 GB RAM** to Docker. The stack runs in ~3.8 GB but needs headroom. In Docker Desktop: Settings > Resources > Memory > 8 GB.

### Optional

| Tool | Install Link | When you need it |
|------|-------------|------------------|
| [Tilt](https://docs.tilt.dev/install.html) | [See Tilt install section](#step-1-install-tilt) | Only if using Option B |
| [Node.js 20+](https://nodejs.org/en/download/) | [Download](https://nodejs.org/) | Running Postman tests with Newman (`npx`) |
| [Python 3.8+](https://www.python.org/downloads/) | [Download](https://www.python.org/downloads/) | Running the CI dataloader script |
| **JDK 17 or 21** | [Temurin 17](https://adoptium.net/temurin/releases/?version=17) | Hot reload for PGR Java code (Tilt only) — see note below |
| [Maven 3.9+](https://maven.apache.org/download.cgi) | [Download](https://maven.apache.org/download.cgi) | Hot reload for PGR Java code (Tilt only) |
| [Yarn](https://yarnpkg.com/getting-started/install) | [Download](https://yarnpkg.com/) | Hot reload for DIGIT UI (Tilt only) |

> **JDK version matters.** `backend/pgr-services` sets `<java.version>17</java.version>` and builds only on
> **JDK 17 or 21**. JDK 23 and 25 fail: Lombok 1.18.30 (inherited from the Spring Boot 3.2.2 parent) cannot
> run on their compiler internals, so every `@Builder`-generated method silently disappears and the build
> dies with dozens of `cannot find symbol: method builder()` errors. The error never mentions Lombok or
> your JDK, so it is easy to misread as broken source.
>
> Ubuntu's `default-jdk` may be newer than 21. Check with `mvn -version` (it reports the JDK Maven actually
> uses, which is what matters — not `java -version`), and switch with
> `sudo update-alternatives --config java` if needed.

---

## Option A: Docker Compose

### Step 1: Clone the repository

```bash
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System/local-setup
```

### Step 2: Start all services

```bash
docker compose up -d
```

This pulls ~20 container images and starts them. First run takes 5-10 minutes to download images.

### Step 3: Wait for services to become healthy

```bash
# Watch containers until all show "healthy" (~3-5 minutes after images are pulled)
watch 'docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -v "Exited"'
```

**What to expect**: You'll see containers transition from `starting` to `healthy` one by one. All containers (except `digit-ui` which may show `unhealthy` initially) should show `(healthy)` within 5 minutes.

**How to know it's ready**: When you see all services show `(healthy)`, press `Ctrl+C` to exit the watch. Then verify:

```bash
# Run the health check script to confirm all services are up
bash scripts/health-check.sh http://localhost
```

Expected output: each service prints `OK` or `healthy`.

### Step 4: Access the application

| What | URL |
|------|-----|
| DIGIT UI (Employee login) | http://localhost:18000/digit-ui/employee |
| Kong Gateway (API base) | http://localhost:18000 |
| Gatus Health Dashboard | http://localhost:18889 |

**Login to the UI**:
1. Open http://localhost:18000/digit-ui/employee
2. Select city: **City A**
3. Username: `ADMIN`
4. Password: `eGov@123`

### Step 5: Stop the stack

```bash
docker compose down                        # Stop (preserves data for next time)
docker compose down -v --remove-orphans    # Stop and delete ALL data (clean slate)
```

---

## Option B: Tilt

Tilt wraps Docker Compose with a web dashboard showing live logs, service health, and utility buttons.

### Step 1: Install Tilt

Install upstream Tilt from https://docs.tilt.dev/install.html.

```bash
# Linux amd64
curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash

# Verify
tilt version
```

> **Do not use the `v0.36.3-healthcheck` fork.** We previously recommended a
> [patched Tilt](https://github.com/ChakshuGautam/tilt/releases/tag/v0.36.3-healthcheck) that waits for
> Docker Compose health checks, because upstream Tilt marks containers "ready" before they are healthy
> (upstream PR: https://github.com/tilt-dev/tilt/pull/6682).
>
> That release is currently **broken and unusable**: the published binary ships without its web assets, so
> `tilt up` exits immediately with `Could not find Tilt web static files`. Its version string is
> `v0.36.3-dev`, and the `-dev` suffix makes Tilt serve the UI from the build machine's source tree
> (`/root/code/tilt-fork/web`) instead of embedded assets. `--web-mode=prod` fails too, so there is no
> workaround short of rebuilding and re-releasing the fork.
>
> Consequence of using upstream: Tilt may show a service as ready before its health check passes. The
> stack still comes up — `docker-compose.yml` enforces ordering via `depends_on: service_healthy` — but
> don't trust the dashboard's "ready" as "healthy". Check the `gatus` resource for real health.

### Step 2: Clone and start

```bash
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System/local-setup

# Use the db-dump Tiltfile (recommended — no local builds needed)
tilt up -f Tiltfile.db-dump
```

**Available Tiltfiles**:

| File | Use the `-f` flag | What it does |
|------|-------------------|-------------|
| `Tiltfile.db-dump` | `tilt up -f Tiltfile.db-dump` | Pre-built images only. No Maven/Yarn needed. Best for getting started. |
| `Tiltfile` | `tilt up` (default) | Hot reload for PGR Java and UI code. Requires Maven + Yarn. |

### Step 3: Open the Tilt dashboard

Open http://localhost:10350 in your browser. You'll see:

- Services grouped by category: **infrastructure**, **core-services**, **pgr**, **frontend**, **gateway**, **tools**
- Health check links next to each service
- Utility buttons in the top nav: **Nuke DB**, **Health Check**, **Smoke Tests**
- Live streaming logs for each service

Wait for all services to turn green (healthy). This takes ~3-5 minutes.

### Step 4: Access the application

Same URLs as Docker Compose:

| What | URL |
|------|-----|
| DIGIT UI (Employee login) | http://localhost:18000/digit-ui/employee |
| Tilt Dashboard | http://localhost:10350 |

### Step 5: Stop

```bash
# Must use the same -f flag you started with
tilt down -f Tiltfile.db-dump
```

### Hot Reload Development (Full Tiltfile)

If you're actively editing PGR Java or UI code, use the default `Tiltfile` instead:

```bash
tilt up    # uses the default Tiltfile with hot reload
```

**PGR Services (Java)** — requires Maven installed:
- Edit files in `backend/pgr-services/src/main/java/...`
- Tilt automatically recompiles with Maven and syncs the JAR

**DIGIT UI (React)** — requires Node.js + Yarn:
- Enable "ui-watch" in the Tilt dashboard, or:
  ```bash
  cd ../frontend/micro-ui/web && yarn install && yarn build:webpack --watch
  ```

---

## Option C: Ansible — the whole stack, one command

This is the path to a **real deployment**: every service, a web server in
front of them, a secret store, monitoring, and a browser wizard for creating
your city and loading its data. One command does all of it.

It works two ways, from the same files:

- **on this machine** — nothing to SSH into, good for a demo, a pilot, or
  learning how the system fits together;
- **on a server** — a fresh Ubuntu box you have `root` SSH access to.

The instructions below are written for the first case. Where the second
differs, it says so.

> **New to this?** Read the six steps in order and do not skip ahead. Each one
> takes a few minutes except the deploy itself, which takes 30–60 minutes the
> first time. Every step ends with something you can check, so you find out
> immediately if it did not work.

<details>
<summary><b>Under the hood — what "one command" actually runs</b></summary>

`./deploy.sh <name>` is a thin wrapper. In order it:

1. refuses to start if `ansible-playbook` is not on `PATH`;
2. runs `ansible-lint` and `yamllint` over the playbook and your config
   (skipped with a warning if they are not installed, or with `SKIP_LINT=1`);
3. regenerates `inventory/hosts.yml` from every `host_vars/*.yml` on disk —
   which is why there is no inventory file for you to edit;
4. runs `scripts/preflight.py` against your config, a set of rules each of
   which encodes a real incident (`SKIP_PREFLIGHT=1` bypasses it);
5. hands everything else to `ansible-playbook playbook-deploy.yml`, forwarding
   any extra flags you passed.

The playbook itself installs Docker, creates `/opt/digit/`, syncs the compose
files and configs, initialises and unseals OpenBao and seeds your secrets,
pulls or builds images, starts the stack, waits on health gates, creates your
tenants, and configures nginx. Re-running it is safe: only changed config
causes a restart.

The authoritative reference for all of it is
[`ansible/README.md`](ansible/README.md).

</details>

### What you need

**The machine you deploy to:**

| | What the deploy expects | Comfortable |
|---|---|---|
| CPU | 8 vCPU | 8+ |
| RAM | 16 GB | 32 GB |
| Free disk | 60 GB | 100 GB |
| OS | Ubuntu 22.04 or 24.04 | same |

Fewer cores works — it is just slower, since most of a first deploy is
downloading and building. 16 GB is the figure to take seriously: below it the
JVM services start competing and containers get killed.

Fedora, Rocky, Alma and Debian also work. Ubuntu is what gets tested on every
change, so it is the one to pick if you have a choice.

**If you are deploying to a separate server**, you also need `root` SSH access
to it using a key (not a password), and the machine you run the command from
needs the tools in Step 2.

> **On Windows?** Use WSL2 and follow
> [WINDOWS-QUICKSTART.md](../WINDOWS-QUICKSTART.md) — validated end to end on a
> 16 GB machine. On a Mac, [MAC-QUICKSTART.md](../MAC-QUICKSTART.md).

### Step 1 — Get the code

**For a real deployment, use a release.** `master` is where development lands;
a release tag is a set of versions that were tested together.

```bash
# Newest release — check https://github.com/egovernments/Citizen-Complaint-Resolution-System/releases
git clone --branch v2.12-beta --depth 1 \
  https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System
```

`--depth 1` skips the history and downloads a lot less.

To find the newest tag without opening a browser:

```bash
git ls-remote --tags --refs --sort=-version:refname \
  https://github.com/egovernments/Citizen-Complaint-Resolution-System.git | head -5
```

If you are working *on* DIGIT rather than deploying it, clone the default
branch instead — just be aware you are getting whatever landed this morning:

```bash
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
```

**Check:** `ls local-setup/ansible/deploy.sh` prints the path.

### Step 2 — Install the prerequisites

You need Ansible, Python, Node.js 20 and a few command-line tools on the
machine you run the deploy **from**. There is a script for it:

```bash
cd local-setup/scripts
./install-prereqs.sh
```

It works on Debian/Ubuntu, RHEL/Fedora/Rocky/Alma/CentOS, Arch and openSUSE,
asks for `sudo` only if something is actually missing, and is safe to run
again. Add `--check` to see what it would do without changing anything.

Docker is **not** in the list — the playbook installs Docker on the target
itself, including when that is this same machine.

<details>
<summary><b>Under the hood — what it installs and why</b></summary>

| What | Why |
|---|---|
| `git`, `curl`, `rsync`, `unzip` | `rsync` is not optional: the playbook uses `ansible.posix.synchronize` to copy configs, which shells out to it on both ends |
| `python3` + `venv` + `pip` | Ansible is Python, and `scripts/preflight.py` runs on every deploy |
| Node.js 20 + npm | the browser apps are **built on the controller**, not on the target |
| `ansible`, `ansible-lint`, `yamllint` | `deploy.sh` runs the two linters before touching anything |
| the `ansible.posix` and `community.general` collections | `synchronize` and `ini_file` live there |

Two details that bite people:

- Ansible goes into a private virtualenv at `~/.local/share/digit-ansible`,
  symlinked into `~/.local/bin`. Ubuntu 24.04, Debian 12+, Fedora 38+ and
  Homebrew Python all refuse a plain `pip install` with
  `error: externally-managed-environment` (PEP 668). A virtualenv sidesteps
  that identically everywhere. If `~/.local/bin` is not on your `PATH`, the
  script says so and tells you what to add.
- Node comes from NodeSource on Debian and RHEL family, not from the distro.
  Ubuntu's own `nodejs` package is version 18 **and ships no npm**, which
  surfaces much later as a confusing `Cannot find module 'esbuild'`.

On a distro the script does not recognise it prints the exact package list and
stops rather than guessing.

</details>

**Check:**

```bash
ansible-playbook --version && node --version && python3 --version
```

If `ansible-playbook` is missing right after a successful run, your shell has
not picked up `~/.local/bin` yet — open a new terminal.

### Step 3 — Write your deployment config

Everything specific to your deployment lives in one YAML file. Copy the
quickstart template and name it after your deployment:

```bash
cd ../ansible                 # local-setup/ansible
cp inventory/host_vars/quickstart.yml.example inventory/host_vars/mycity.yml
```

**The file name is the deployment name.** `mycity.yml` means you will run
`./deploy.sh mycity`. Real config files are gitignored — only the `.example`
ones are tracked — so your passwords stay out of git.

Now open `inventory/host_vars/mycity.yml` and change these. Everything else in
the file is already correct for a first deployment.

| Setting | What it is | Example |
|---|---|---|
| `state_root` | Your top-level tenant: the country or state. Lowercase, no dots. Creating it is what the deploy does. | `kenya` |
| `state_tenant_id` | The tenant the browser apps authenticate against. Keep it the same as `state_root`. | `kenya` |
| `tenant_id` | Your **city** tenant, where complaints actually live. Must start with `<state_root>.` | `kenya.nairobi` |
| `boot_tenant` | Default tenant for the citizen app. Same as `tenant_id` is right. | `kenya.nairobi` |
| `ui_state_tenant_id` | The tenant the app lands on after login. Point at the **city**. | `kenya.nairobi` |
| `login_tenant_allowlist` | Which tenants appear in the login screen's City dropdown. List both. | `[kenya, kenya.nairobi]` |
| `map_center` | Where the complaint map opens. **Required — the deploy fails without it.** | `{lat: -1.2864, lng: 36.8172}` |
| `pgr_boundary_highest_level`<br>`pgr_boundary_lowest_level`<br>`boundary_type` | What your administrative areas are called, largest first. These are labels on the complaint form, so use the words your staff use. | `County`, `Ward`, `Ward` |
| `core_mobile_configs` | Your country's phone-number rule. Get this wrong and every citizen signup is rejected. | `+254` / `^0?[17][0-9]{8}$` |
| `core_postal_configs` | Your country's postcode rule. | `^[0-9]{5}$` |
| `secrets_path` | Where this deployment's secrets are filed inside the secret store. Just a path. | `kv/digit/mycity` |
| `bootstrap_secrets` | Your passwords. Change all of them **except** `elasticsearch_master_password`, which must stay as written. | — |

**Deploying to a separate server instead of this machine?** Change two more
lines: put the server's address in `ansible_host`, and delete the
`ansible_connection: local` line. If it has a real domain name and
certificates, set `domain:` to that name and `tls_enabled: true`.

<details>
<summary><b>Under the hood — why there are five tenant settings and not one</b></summary>

Tenants are two levels: a **root** (`kenya`) and a **city** under it
(`kenya.nairobi`). Five variables name them because different parts of the
system need a different one, and they are genuinely not interchangeable:

| Variable | Read by | Consequence of getting it wrong |
|---|---|---|
| `state_root` | the JVM services, as `STATE_LEVEL_TENANT_ID` — it decides which tenant's encryption keys and MDMS defaults they load at boot | pointing it at a tenant that does not exist yet crash-loops `egov-workflow-v2` and `egov-enc-service` |
| `state_tenant_id` | the browser apps; the configurator takes its login-tenant default from the first segment of this | if it names a root the deploy never creates, there is no `ADMIN` there to log in as |
| `tenant_id` | templates that need a single city value; also the city tenant the deploy bootstraps | data lands under a tenant nothing queries |
| `boot_tenant` | only the opt-in CI suite, as `BOOT_TENANT`/`DIGIT_TENANT` | inert unless `run_ci_tests: true` — but preflight still checks it sits under `state_root` |
| `ui_state_tenant_id` | the SPA, as the tenant it lands on | the wizard writes boundaries to the city; if the app reads the root instead, every location dropdown is empty |

The tenant-creation step only runs when `state_root` is something other than
`pg`, and it creates `state_root` and `tenant_id` — **not** `state_tenant_id`.
(`pg` is the demo tenant that ships inside the database dump; leaving
`state_root: pg` means "use the demo data as-is".) If `state_tenant_id` names a
root that was never created, the playbook notices there is no `ADMIN` there,
points the app at `pg` so you can still log in, and prints exactly that.

The deploy does this in two phases on purpose: the stack boots against `pg`,
your tenants are created through the API, and only then are the
`STATE_LEVEL_TENANT_ID` values rewritten and the services restarted. That is
why a first deploy restarts things partway through and why it takes as long as
it does.

</details>

<details>
<summary><b>Under the hood — the rest of the settings</b></summary>

`quickstart.yml.example` is deliberately short.
[`_example.yml`](ansible/inventory/host_vars/_example.yml) in the same
directory is the full catalogue: every flag the playbook understands, what it
does, what values it takes and what it pairs with. Highlights you are likely to
want soon:

- `enable_search_stack` — Elasticsearch, the indexer and the employee inbox.
  Costs about 3 GB of RAM; without it the inbox screen returns 503, which is
  why `employee_module_denylist: [IM]` hides it by default.
- `enable_novu` — SMS, email and WhatsApp notifications. Eight more containers.
  There is a turn-key installer, `scripts/enable-notifications.sh`, rather than
  just the flag.
- `enable_keycloak` — single sign-on. DIGIT's own OTP login works without it.
- `enable_otp_services` — real SMS one-time passwords. Off means the citizen
  login OTP is always `123456`, which is what you want while testing.
- `observability_level` — `metrics`, `logs` or `traces` (the default, meaning
  everything). Lowering it deploys fewer monitoring containers.
- `enable_matomo` — self-hosted web analytics for the portal. Three more
  containers, about 1 GB. The deploy installs Matomo for you — no browser
  wizard — and stores the generated admin password in OpenBao. Standing it up
  sends nothing anywhere: pointing the portal at it is a separate MDMS step, so
  collection turns on and off without a redeploy. Pair it with
  `nginx_features.matomo`. There is a turn-key installer,
  `scripts/enable-matomo.sh`, and a full walkthrough in
  [`docs/matomo-deployment.md`](../docs/matomo-deployment.md).
- `run_ci_tests` — runs the Postman and Playwright suites at the end of every
  deploy. Adds 5–10 minutes.

Where a service has an `nginx_features.*` twin, you need **both**: the service
flag runs it, the nginx flag makes it reachable from a browser. Keep every key
in the `nginx_features` block — six of them are read without a fallback, so
deleting a line fails the vhost render instead of turning that path off.

</details>

**Check:** the config is validated for you at the start of the next step, so
there is nothing to run here.

### Step 4 — Deploy

```bash
./deploy.sh mycity
```

That is the whole command. Expect **30–60 minutes** on a first run and a few
minutes after that. Pulling the stack alone is around ten minutes on Linux, and
the quickstart config additionally builds the onboarding wizard, the UI bundle
and the tenant-creation service from source on top of that.

Ansible prints nothing while a long task is running, which looks like a hang.
It is not. Watch progress in a second terminal:

```bash
tail -f /opt/digit/digit-stack-up.mycity.progress
watch -n5 "docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'healthy|Exited|Restart'"
```

**Two things to expect on the way through:**

- **It asks for your sudo password, or fails saying it needs one.** The
  playbook installs packages and writes nginx config, which needs root.
  `deploy.sh` does not ask for the password itself, so on a local deployment
  pass it through:

  ```bash
  ./deploy.sh mycity -K            # prompts for the sudo password
  ```

  Deploying to a remote server as `root` does not need this.

- **A preflight warning about `configurator_build`.** Expected and harmless:
  the value is produced by the build task later in the same run, so it cannot
  be set in your config beforehand.

<details>
<summary><b>Under the hood — passing extra flags, and re-running</b></summary>

`deploy.sh` forwards anything after the deployment name straight to
`ansible-playbook`:

```bash
./deploy.sh mycity --tags=nginx        # only the nginx tasks
./deploy.sh mycity --start-at-task="..."   # resume from a named task
./deploy.sh mycity -vvv                # verbose, for debugging a failure
```

Two environment escape hatches, both for when you know what you are doing:
`SKIP_LINT=1` skips the linters, `SKIP_PREFLIGHT=1` skips the config gate.

Re-running the whole thing is the normal way to recover from a failure part
way through. The playbook is idempotent: work already done is detected and
skipped, and only changed config causes a restart. It is not a fresh start,
though — set `force_clean: true` for that (it removes containers and networks
but keeps the database).

</details>

### Step 5 — Check that it worked

The last thing the deploy prints is a summary. Then, in a browser:

| What | URL (local deployment) | URL (server with a domain) |
|---|---|---|
| Employee app | http://localhost/digit-ui/employee | `https://<domain>/digit-ui/employee` |
| Citizen app | http://localhost/digit-ui/citizen | `https://<domain>/digit-ui/citizen` |
| Onboarding wizard | http://localhost/configurator/ | `https://<domain>/configurator/` |
| Health dashboard | http://localhost/status/ | `https://<domain>/status/` |
| Dashboards (Grafana) | http://localhost/grafana/ | `https://<domain>/grafana/` |

Unlike Options A and B, everything here is on the **normal web ports** (80, and
443 with TLS) because a real web server is in front of the stack — there is no
`:18000` in these URLs.

From a terminal on the deployment machine:

```bash
# every container and its health
docker ps --format 'table {{.Names}}\t{{.Status}}'

# the health dashboard's own view, as JSON
curl -s http://localhost/status/api/v1/endpoints/statuses | head -40
```

`digit-gatus` never reports `healthy` — it declares no health check at all, so
it sits at a plain `Up`. That is normal and not a failure.

### Step 6 — Log in

The deploy creates one administrator account per tenant. **On a stock config
those credentials are `ADMIN` / `eGov@123`, which are published in this
repository — change them before anyone else can reach the machine.**

| Where | Username | Password | Which tenant |
|---|---|---|---|
| Onboarding wizard (`/configurator/`) | `ADMIN` | `eGov@123` | your **root** — the field is pre-filled from `state_tenant_id` |
| Employee app (`/digit-ui/employee`) | `ADMIN` | `eGov@123` | pick from the City dropdown; only tenants in `login_tenant_allowlist` appear |
| Employees you onboard later | their **employee code** | `eGov@123` | their city tenant |
| Citizen app | a mobile number | OTP `123456` | — |
| Grafana (`/grafana/`) | `admin` | generated — see below | — |

To change the administrator credentials, set `bootstrap_user` and
`bootstrap_password` in your config and redeploy. To change the default
password every new employee gets, set
`bootstrap_secrets.egov_hrms_default_password` — but only before the first
deploy, because those secrets are written to the secret store once and then
owned by it.

Grafana's password is generated on the first deploy and stored in OpenBao.
Read it back on the deployment machine:

```bash
sudo docker exec \
  -e BAO_TOKEN="$(sudo jq -r .root_token /opt/digit/.openbao/init.json)" \
  openbao bao kv get -field=grafana_admin_password kv/digit/mycity
```

<details>
<summary><b>Under the hood — where these accounts come from</b></summary>

The employee code overriding the username is not a typo: HRMS replaces the
`userName` you supply with the employee code when it creates the record, and
the employee code is what actually authenticates.

The citizen OTP is fixed at `123456` because `enable_otp_services` is off and
Kong answers `/user-otp/*` with a canned response — no SMS provider needed.
Turning real OTP on takes more than the flag; see the notes in
`kong/kong.yml`.

Every other secret lives in OpenBao under your `secrets_path`, seeded from
`bootstrap_secrets` on the **first** deploy only. Editing those values in your
config afterwards does nothing; change them in OpenBao instead, and redeploy so
services pick them up. The root token is at `/opt/digit/.openbao/init.json`
(mode 0600) — **back that file up somewhere else**, because losing it means
losing every secret in this deployment with no way to recover them.
[`ansible/runbooks/01-openbao.md`](ansible/runbooks/01-openbao.md) covers
reading, rotating and unsealing.

</details>

### When it does not work

| What you see | What it means | What to do |
|---|---|---|
| `ERROR: 'ansible-playbook' not found on PATH` | Step 2 has not run, or your shell has not picked up `~/.local/bin` | run `install-prereqs.sh`, then open a new terminal |
| `preflight failed: db_fast_path: true requires db_fast_path_ack_data_wipe: true` | The database loader recreates the Postgres container, which destroys data held in an anonymous volume, so it wants that acknowledged | on a first deploy, set `db_fast_path_ack_data_wipe: true`. On a machine with data you care about, back it up first |
| `preflight failed: enable_mcp: true requires docker_registry` | The tenant-creation service needs a registry name even when it is built locally | keep the `docker_registry` line from the template |
| Ansible fails on an apt/dnf or nginx task with a permissions error | `deploy.sh` never prompts for `sudo` | re-run as `./deploy.sh mycity -K` |
| A container keeps restarting | usually memory | `docker stats --no-stream`, then either free memory or turn off `enable_search_stack` / lower `observability_level` |
| The login screen has no City dropdown entry for your tenant | `login_tenant_allowlist` | add the tenant and redeploy |
| Login fails for `ADMIN` on your root tenant | that root was never created — see the tenant note in Step 3 | check the deploy output for the line naming the fallback to `pg` |

Deeper diagnosis, including reading logs and metrics, is in the
[operations handbook](../docs/operations/README.md).

### Next: onboard a tenant

The stack is running but has no city data in it yet — no wards, no
departments, no complaint types, no staff. That comes next, in the browser:

**→ [Onboarding & Add-ons guide](docs/ONBOARDING-AND-ADDONS.md)**

---

## Reference

Ports, memory budgets, what each service does, direct API and database access,
the Postman collections, and general troubleshooting have moved to
**[docs/STACK-REFERENCE.md](docs/STACK-REFERENCE.md)**, so this page stays a
walkthrough.

| Looking for | Go to |
|---|---|
| Every service, port and memory limit | [STACK-REFERENCE.md](docs/STACK-REFERENCE.md#whats-included) |
| Calling the API by hand | [STACK-REFERENCE.md](docs/STACK-REFERENCE.md#api-access) |
| Connecting to the database | [STACK-REFERENCE.md](docs/STACK-REFERENCE.md#database-access) |
| Running the Postman collections | [STACK-REFERENCE.md](docs/STACK-REFERENCE.md#running-postman-api-tests) |
| Loading master data from a script | [STACK-REFERENCE.md](docs/STACK-REFERENCE.md#loading-master-data-from-a-script) |
| Troubleshooting a Compose or Tilt stack | [STACK-REFERENCE.md](docs/STACK-REFERENCE.md#troubleshooting) |
| Repository layout | [STACK-REFERENCE.md](docs/STACK-REFERENCE.md#project-structure) |
| Everything the Ansible playbook does | [ansible/README.md](ansible/README.md) |
| Running the stack in production | [operations handbook](../docs/operations/README.md) |

### Other guides in `docs/`

| Guide | What it covers |
|---|---|
| [ONBOARDING-AND-ADDONS.md](docs/ONBOARDING-AND-ADDONS.md) | Create a city and load its data; turn on notifications, the dashboard and the other add-ons |
| [STACK-REFERENCE.md](docs/STACK-REFERENCE.md) | Ports, memory, API and database access, Postman, troubleshooting |
| [LOCALHOST-FULL-AND-SLIM.md](docs/LOCALHOST-FULL-AND-SLIM.md) | Two ready-made presets for deploying Option C to this machine |
| [LOCAL-SETUP-GUIDE.md](docs/LOCAL-SETUP-GUIDE.md) | Running the Compose stack on a machine with about 4 GB of RAM |
| [HYBRID-SETUP.md](docs/HYBRID-SETUP.md) | Some services local, the rest on a shared server |
| [REMOTE-DEV-SETUP.md](docs/REMOTE-DEV-SETUP.md) | Developing against a remote stack |
| [HOT-DEPLOY-GUIDE.md](docs/HOT-DEPLOY-GUIDE.md) | Pushing a code change into a running stack without a full redeploy |
| [SERVICE-STARTUP-SEQUENCE.md](docs/SERVICE-STARTUP-SEQUENCE.md) | The order services come up in, and what waits on what |
