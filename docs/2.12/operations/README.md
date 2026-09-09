# DIGIT Complaint Management — Operations & Support Handbook

**Audience:** the team that operates a deployed DIGIT Complaint Management instance — the
IT or infrastructure staff inside the department, council or ministry that owns the server.

**Purpose:** to help you find out *what* broke without waiting for us, and to make it easy
to hand us a report we can act on straight away.

---

## Start here — which page do you need?

| You are | Go to |
|---|---|
| **On the service desk**, someone has just reported a problem | **[l1-first-response.md](l1-first-response.md)** — the checklist |
| **Operating the deployment**, and a ticket has reached you | **[l2-diagnosis.md](l2-diagnosis.md)** — the diagnosis runbook |
| **Looking for something already seen before** | **[known-issues.md](known-issues.md)** |
| **About to report something to us** | **[incident-report.md](incident-report.md)** |
| **Mid-incident and want one page** | **[cheatsheet.md](cheatsheet.md)** |
| **Setting up monitoring** so you hear about problems first | **[alerts-setup.md](alerts-setup.md)** and **[alert-channels.md](alert-channels.md)** |
| **Looking at a Grafana dashboard** and unsure what it means | **[dashboards.md](dashboards.md)** |
| **Looking something up** | **[reference.md](reference.md)** |

The handbook assumes a first line and a second line, and the two runbooks are written for
those roles. If your team doesn't split that way, read them as "the checklist" and "the deep
dive" and ignore the labels — nothing else depends on them.

---

## Who does what — the L1 / L2 line

One rule decides almost every case:

> **If there is a screen for it, it is L1. If it needs the server, a log, a database or a
> configuration file, it is L2.**

L1 is not only incidents. A large part of day-to-day operations is *requests* — "add this
clerk", "we have a new department", "this complaint type is missing" — and all of that is
done through the product's own admin screens. It belongs on the first line.

| Work | Tier | Why |
|---|---|---|
| Creating and deactivating **users / employees** (HRMS screens) | **L1** | It has a UI. No server access, no configuration files |
| Adding or editing **master data** — departments, designations, complaint types, boundaries, localisation strings (Configurator / DIGIT Studio) | **L1** | Same. These are supported product screens |
| Bulk loading master data from the **onboarding spreadsheets** | **L1** | Driven from the wizard; validation errors come back on screen |
| The **first-response checklist** — is it up, did something crash, what does the log say | **L1** | All of it is read-only, in a browser |
| Resolving anything on the **[known-issues](known-issues.md)** list | **L1** | The resolutions there are deliberately UI-only |
| Restarting a service, reading container logs, `docker`/`psql` on the box | **L2** | Server access |
| Anything about **why** — diagnosis, correlating services, tracing a request | **L2** | Complexity, and it needs the full stack in view |
| **Configuration** the UI does not expose — env vars, nginx, Kong routes, compose files | **L2** | Not a screen; changes survive only through a redeploy |
| **Capacity** — raising a memory limit, disk filling, log rotation | **L2** | Host-level, see [l2-diagnosis.md](l2-diagnosis.md) |
| Deploying, upgrading, restoring a backup | **L2**, usually with us | Changes the deployment itself |

Two consequences worth stating plainly:

- **An L1 who cannot create a user is not fully set up.** Give the service desk an admin
  login for the Configurator and HRMS. Without one, routine requests bounce to L2 and the
  second line becomes a queue for work that never needed it.
- **"It has a UI" is about the task, not the person.** If a master-data change needs a
  database edit because the screen cannot express it, that is L2 by this rule — and it is
  also worth telling us, because a screen is missing.

Where exactly your team draws the line is still yours to set. This is the split the handbook
assumes when it says "L1" and "L2".

---

## How a problem moves

```
   Report  ─▶  L1 first response  ─▶  known issue?  ─── yes ──▶  resolve, log it
                                            │
                                            no
                                            ▼
                                     Part A ─▶  L2 diagnosis  ─▶  config / restart fix
                                                      │
                                                 product defect
                                                 or deployment change
                                                      ▼
                                            Part A+B+C ─▶  us
```

The report template is **one document filled in three stages** — L1 completes Part A, L2
adds Part B, and Part C is added when it comes to us. Nothing is re-typed at a handover.

Where the boundary between the tiers sits — what L1 is allowed to do, who may restart a
service, who carries the phone — is your team's call. This handbook describes the work, not
the org chart.

---

## Your four URLs

Replace `<your-domain>` with your deployment's domain throughout this handbook.

| What | URL | Use it for |
|---|---|---|
| **Health dashboard** (Gatus) | `https://<your-domain>/status/` | *Is everything up?* — up to 57 live checks in 12 groups, red/green, refreshed every 30s |
| **Grafana** | `https://<your-domain>/grafana/` | Metrics, logs, traces, alerts |
| **Logs** | `https://<your-domain>/grafana/d/digit-loki-logs/` | The actual error text |
| **Service metrics** | `https://<your-domain>/grafana/d/digit-jvm/` | Memory, CPU, restarts, OOM |

Those four are all first response needs. Grafana carries **nine dashboards** in total —
including the database, the API gateway, the message broker and the supervisor dashboard's
own timings. What each one shows and which panels to read is
**[dashboards.md](dashboards.md)**.

> **Access note — who gives you a Grafana login.** Grafana asks for a login, and a fresh
> deployment has exactly **one** account: `admin`. That account belongs to your **system
> administrator** — its password is generated on the first deploy and stored in this
> deployment's OpenBao. Self-registration is disabled, so **the administrator creates a
> Grafana account for each L1 and L2 person** who needs one. Ask them for *your own*
> account rather than for the admin password; see
> [reference.md § Credentials](reference.md#credentials--who-to-ask) for what to ask for.
>
> **Ask for the Editor role.** Grafana hands new accounts the **Viewer** role by default,
> and a Viewer cannot open **Explore** — which [Step 4](l1-first-response.md#step-4--what-does-the-log-say)
> of first response and most of L2's work depend on. **Editor** is the right role for the
> service desk. It still cannot change passwords, add users or edit datasources, and
> nothing in this handbook writes to the system — Grafana only displays data.
>
> Anonymous access is off unless the deployment explicitly sets
> `grafana_anonymous_enabled: true`, and even then it grants **Viewer**, never Admin. If
> your deployment does have anonymous access on and is reachable from the public internet,
> raise it with us: a Viewer can run arbitrary Loki queries, and the logs contain live
> session tokens. See [alerts-setup.md § Before you start](alerts-setup.md#before-you-start).
>
> **Credentials.** The health dashboard needs no login; Grafana does, so the service desk
> needs accounts in advance — see above. For everything else — the Novu notification
> dashboard, the SMS/WhatsApp provider console, or server access — **ask your system
> administrator**. Never send credentials in a ticket or a chat message, including to us.

---

## How much monitoring this deployment runs

**Not every deployment collects everything.** Monitoring costs memory and disk, so a
deployment picks one of three **observability levels**. The levels are cumulative, and the
default is the full stack:

| Level | You have | You do **not** have |
|---|---|---|
| **metrics** | Grafana, health dashboard, host / database / broker / gateway metrics, and every dashboard except the two below | **Logs (Loki)** and **Traces (Tempo)** |
| **logs** | the above, plus searchable logs | **Traces (Tempo)** |
| **traces** *(the default)* | everything in this handbook | — |

**Why this matters more than it sounds.** Reading the logs is
[Step 4 of the first-response checklist](l1-first-response.md#step-4--what-does-the-log-say)
and most of the second line's method. On a **metrics**-level deployment there is no Loki to
read them from — the log dashboard is simply not there. That is a deployment decision, not a
fault, and nobody should spend an incident discovering it.

> **Find out which level this deployment runs, and write it on your
> [cheat sheet](cheatsheet.md), before you need it.** Ask us, or ask whoever runs your
> deployment. It takes one question now and saves an hour later.

Changing the level is a redeploy, not a switch on the box. If you are on **metrics** and want
logs, that is a reasonable thing to ask us for — say so, and say why.

---

## What a good report contains

Five facts let us start work immediately instead of starting with questions. All five are
obtainable in a few minutes, from a browser, without server access:

| # | Question | Where you get it |
|---|---|---|
| 1 | **What** is broken (URL, screen, action, API) | your own observation |
| 2 | **When** it started, and whether it's still happening | Health dashboard / Grafana time picker |
| 3 | **Who/how many** are affected (one user, one office, everyone) | your own observation |
| 4 | **Which service** is unhealthy or restarting | Health dashboard + Grafana |
| 5 | **The error text** from that service's logs | Grafana → Logs (Loki) |

If you can only get some of them, send what you have — a partial report early is more useful
than a complete one late.

---

## Report it early — the evidence expires

Observability data on these deployments is deliberately short-lived, so it costs no disk.
The trade-off is that **a problem reported late may no longer have any evidence behind it**.

| Data | Where | Kept for | What that means for you |
|---|---|---|---|
| **Traces** (per-request timing) | Tempo | **24 hours** | Slowness reports older than a day can't be diagnosed from traces |
| **Logs** | Loki | **72 hours (3 days)** | The error text is gone after 3 days |
| **Metrics** (memory, CPU, restarts) | Prometheus | **15 days** | Trends and restart history survive two weeks |
| Health check history | Gatus | **survives restarts** — SQLite on disk | Roughly the last 100 results and 50 events per endpoint |

If a problem happened over a weekend, the logs may already have rolled off by Monday — just
say so in the report so we know what's available.

---

## Severity

Use these labels in the subject line of your report; they set our response. Response times
and who is on call are yours to define.

| Severity | Definition | Examples |
|---|---|---|
| **S1 — Critical** | Citizens or staff cannot use the system at all | Site down, login broken for everyone, no complaint can be filed |
| **S2 — Major** | A core function is broken for many users, with no workaround | Complaints can be filed but not assigned; notifications not going out; dashboard empty for all supervisors |
| **S3 — Minor** | Degraded or broken for some users, workaround exists | One office's boundary missing; a report is slow; one screen mis-labelled |
| **S4 — Question / request** | Not broken; a change, a doubt, a new tenant, a data load | "How do I add a department?" |

Keeping S1 for genuine full-stop outages is what keeps the S1 path fast for everyone.

**A quick check before escalating to S1:** confirm the problem isn't local to one machine —
try a different network (mobile hotspot), a different browser in private mode, and a
different user account. Client-side DNS and stale logins produce symptoms that look
identical to an outage, and ruling them out takes a minute.

---

## Escalating to us

1. Fill in the template in **[incident-report.md](incident-report.md)** — Parts A, B and C.
2. Attach the evidence it asks for (log excerpts, screenshots, trace IDs, the queries and
   time ranges you used).
3. Post it in the agreed support channel; for S1, also use the phone/escalation path.
4. **If you can, capture the evidence before restarting or redeploying.** A restart often
   clears the symptom and the logs together, which leaves us without much to work from. If
   you do need to restart to get users moving — that is usually the right call — just note
   in the report that you did, and when.

Details we'll ask for if they're missing, so they're worth including up front: the **exact
time** (with timezone), the **tenant / city code**, the **complaint or user ID** involved,
and whether it is **reproducible on demand**.

---

## Document map

| Document | For | Read it when |
|---|---|---|
| **README.md** (this file) | everyone | Start here. Routing, severity, URLs, escalation |
| **[cheatsheet.md](cheatsheet.md)** | everyone | Mid-incident. One printable page |
| **[l1-first-response.md](l1-first-response.md)** | L1 | A problem has just been reported. Checklist, what to capture, when to hand over |
| **[l2-diagnosis.md](l2-diagnosis.md)** | L2 | A ticket has reached you. Layer model, deeper queries, host, server commands |
| **[known-issues.md](known-issues.md)** | L1 + L2 | Before diagnosing anything. Symptom → known resolution |
| **[incident-report.md](incident-report.md)** | L1 + L2 | At every handover. The three-part template and evidence checklist |
| **[alerts-setup.md](alerts-setup.md)** | L2 | Making the system tell you first. Rules, thresholds, provisioning |
| **[alert-channels.md](alert-channels.md)** | L2 | Where alerts land — Slack, Chat, Teams, email, WhatsApp, SMS |
| **[dashboards.md](dashboards.md)** | L1 + L2 | At a desk, with Grafana open. What each of the nine dashboards shows and which panels to read |
| **[reference.md](reference.md)** | everyone | Lookup: service catalogue, coverage, retention, queries, glossary |

---

## What this handbook does not cover

This handbook is about **things going wrong**. The routine admin work in the table above is
L1's, but it is documented elsewhere, because it is not incident response:

- **Onboarding a city, boundaries, departments or employees** — see
  [`../../migration/operator-runbook.md`](../../migration/operator-runbook.md) and the XLSX
  onboarding flow.
- **Changing application configuration** (complaint types, SLAs, branding) — that is the
  Configurator. Doing it is L1 work; it is just not an incident.
- **Deploying or upgrading** the stack — that is `local-setup/ansible/`, and normally ours.

If you're not sure whether your problem is an incident or a configuration question, file it
as **S4** and we will re-classify it.
