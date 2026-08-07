# DIGIT / CCRS — Operations & Support Handbook

**Audience:** the team that operates a deployed DIGIT / CCRS instance — the IT or
infrastructure staff inside the department, council or ministry that owns the server.

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
| **Looking something up** | **[reference.md](reference.md)** |

The handbook assumes a first line and a second line, and the two runbooks are written for
those roles. If your team doesn't split that way, read them as "the checklist" and "the deep
dive" and ignore the labels — nothing else depends on them.

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
| **Health dashboard** (Gatus) | `https://<your-domain>/status/` | *Is everything up?* — ~50 live checks, red/green, refreshed every 30s |
| **Grafana** | `https://<your-domain>/grafana/` | Metrics, logs, traces, alerts |
| **Logs** | `https://<your-domain>/grafana/d/digit-loki-logs/` | The actual error text |
| **Service metrics** | `https://<your-domain>/grafana/d/digit-jvm/` | Memory, CPU, restarts, OOM |

> **Access note.** Grafana on these deployments is configured with anonymous access at
> **Admin** level (`GF_AUTH_ANONYMOUS_ENABLED=true`, login form disabled). You do not need a
> password — but it also means anyone who knows the URL has full Grafana access. If your
> deployment is reachable from the public internet, raise it with us and we will put it
> behind your VPN or an authentication proxy. See
> [alerts-setup.md § Before you start](alerts-setup.md#before-you-start).

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
| Health check history | Gatus | in-memory, **lost on restart** | Worth screenshotting while it's red |

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
| **[reference.md](reference.md)** | everyone | Lookup: service catalogue, coverage, retention, queries, glossary |

---

## What this handbook does not cover

- **Deploying or upgrading** the stack — that is `local-setup/ansible/`, and normally ours.
- **Onboarding a city, boundaries, departments or employees** — see
  [`../migration/operator-runbook.md`](../migration/operator-runbook.md) and the XLSX
  onboarding flow.
- **Changing application configuration** (complaint types, SLAs, branding) — that is the
  Configurator, not an incident.

If you're not sure whether your problem is an incident or a configuration question, file it
as **S4** and we will re-classify it.
