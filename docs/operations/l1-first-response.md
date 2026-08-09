# L1 — first response

**For:** the service desk. The person who takes the call from a clerk, a supervisor or a
citizen.

**Your job in one line:** work the checklist below, resolve it if it's on the
[known-issues list](known-issues.md), and if it isn't, hand L2 a filled-in Part A of the
[incident report](incident-report.md).

**Not your job:** working out *why*. If you find yourself forming a theory about the cause,
that's L2's work — capture what you've found and pass it on.

Everything here is done from a browser. You need no server access, and nothing on this page
changes anything.

**What you need before your first call** — check you actually have these, and ask L2 for
anything missing. Each one is assumed by a step below:

| You need | Used in | If you don't have it |
|---|---|---|
| The `/status/` and `/grafana/` URLs, reachable from your desk | Steps 2–4 | Ask L2 — Grafana may sit behind the VPN |
| A **login of your own** for the system | Step 1 | You cannot confirm scope; say so in the ticket rather than guessing |
| A **second test login**, ideally in a different office | Step 1 | Ask a colleague to try instead, and note whose account was used |
| The **maintenance window**, written on your [cheat sheet](cheatsheet.md) | Step 3 | Ask L2 before reporting restarts |

An admin login to the Configurator or HRMS is **not** assumed anywhere here. Some entries in
[known-issues.md](known-issues.md) need one — if yours doesn't have it, those are L2's.

← back to **[Operations handbook](README.md)** · one-page version:
**[cheatsheet.md](cheatsheet.md)**

---

## Contents

- [Step 0 — take the details](#step-0--take-the-details)
- [Step 1 — is it just this one person?](#step-1--is-it-just-this-one-person)
- [Step 2 — is everything up?](#step-2--is-everything-up)
- [Step 3 — did something crash or run out of memory?](#step-3--did-something-crash-or-run-out-of-memory)
- [Step 4 — what does the log say?](#step-4--what-does-the-log-say)
- [Step 5 — resolve or escalate](#step-5--resolve-or-escalate)
- [What to capture, always](#what-to-capture-always)

---

## Step 0 — take the details

Ask for these while the caller is still on the line. Going back for them later is the main
reason a ticket stalls.

| Ask | Why it matters |
|---|---|
| **What exactly were you doing?** The screen, the button, the action | Narrows it to one service |
| **What happened instead?** The exact message on screen | Often names the failure outright |
| **When did it start?** Date, time, timezone | Everything downstream is a time-range search |
| **Is it still happening right now?** | Decides whether evidence is still live |
| **Which city / office / login?** | Tenant and role scope |
| **Complaint number**, if there is one | Lets any tier trace it end to end |

If the caller can send a screenshot, ask for one **with the error visible**.

---

## Step 1 — is it just this one person?

Before anything else, find out whether this is one machine or the system.

1. **Open the site yourself, in a private/incognito window**, and try the same action. This
   one test is the important one, and it needs nothing but your own login.
2. If you can, also vary **the account** (a second test login, or ask a colleague in another
   office to try) and **the network** (a phone hotspot).

| Result | What it means | Do this |
|---|---|---|
| Works for you, fails for them | Their browser, network or account | Try the browser-side items in [known-issues.md](known-issues.md) |
| Fails for you too | Server-side | Continue to Step 2 |
| You can't test it yourself | Unknown scope | Say so explicitly in the ticket — "could not reproduce, no second account" is information; silence reads as "not checked" |

**If you can reproduce it, capture the failing request while you're there** — it is the
single most useful attachment and the caller cannot get it for you. Press **F12** → the
**Network** tab → repeat the action → click the red row → screenshot the **URL and status
code**. If you cannot reproduce it, skip this; do not talk a caller through developer tools
on the phone.

Skipping this step is the most common way a single stale login turns into a system-wide
alarm.

---

## Step 2 — is everything up?

Open **`https://<your-domain>/status/`** — the health dashboard. It checks around 50 parts
of the system every 30 seconds. Green means responding, red means not.

**Screenshot anything red immediately.** This page keeps no history — if the page reloads,
the red is gone and cannot be recovered.

What the groups mean:

| Group is red | What's affected |
|---|---|
| **Infrastructure** | Database, cache or message broker. Nothing else will work — this is the most serious thing on the page |
| **Core Services** | A platform service. Expect several unrelated-looking symptoms at once |
| **API Gateway** | Requests can't be routed; users see "502" or a blank screen |
| **Application** | The complaint system itself |
| **Search** | Inbox and search break; filing complaints still works |
| **Notifications** | SMS / email / WhatsApp not going out; everything else fine |
| **Keycloak** | Sign-in / identity |
| **OTP** | OTP delivery for login |
| **MCP** | Integration tooling — no effect on citizens or staff using the system |
| **API Tests** | The service is running but its API is failing — usually data or configuration |

Two things worth knowing:

- **PostgreSQL and PgBouncer are listed separately.** If PgBouncer is green and PostgreSQL
  is red, the system is still accepting connections to a database that isn't answering.
  Treat it as Infrastructure red.
- **An *API Tests* tile red while everything else is green is a useful signal**, not a
  contradiction. Note it and pass it on.

**Record the exact names of the red tiles.** That list is most of what L2 needs.

---

## Step 3 — did something crash or run out of memory?

Two readings. Write down what they say and leave what they *mean* to L2.

**a. Out-of-memory count.** Open **Grafana → `DIGIT JVM Services`**
(`https://<your-domain>/grafana/d/digit-jvm/`) and set the time range (top right) to
**Last 6 hours**, or wider if the problem started earlier.

Read **"OOM events (current range)"** — a single number. Anything above `0` means a service
ran out of memory somewhere in that window. The panel below it, *"Incidents — OOM /
heap-space errors"*, names the service and carries the error. Copy those lines into the
ticket.

**b. Restarts.** Open **Grafana → Explore**, choose **Loki** from the datasource dropdown,
and paste this in:

```logql
{compose_project="digit", compose_service!="loki"} |~ `Started .+Application in`
```

Each line it returns is one service starting up. Widen the range to 24 hours. **The same
service appearing over and over is a service stuck restarting** — that is the single most
useful thing you can report.

> **Check the maintenance window before you report restarts.** If this deployment redeploys
> on a schedule, every service restarts then and this query fills with normal activity. The
> window should be written on your [cheat sheet](cheatsheet.md) — restarts *outside* it are
> the interesting ones. If that blank has never been filled in, ask L2 what the window is
> before treating restarts as a finding.

**Record it, don't conclude from it.** `OOM events: 3 — egov-indexer, 09:12` is the right
note. "The system crashed because it ran out of memory" is not — the OOM may be a
consequence of the real fault, or unrelated to what the caller reported. Say what you saw
rather than what it means, to the ticket and to the caller.

Reading the heap graphs and the right-sizing table is L2's work
([l2-diagnosis.md](l2-diagnosis.md#reading-the-evidence-l1-captured)): telling an ordinary
memory sawtooth from a crash needs to know what that service's normal looks like.

---

## Step 4 — what does the log say?

Open **Grafana → `DIGIT — Logs (Loki)`**
(`https://<your-domain>/grafana/d/digit-loki-logs/`).

You don't need to write a query. Use the three dropdowns at the top:

- **service** — pick the one you suspect from Step 2 or 3. If you have no suspect, leave it
  as `.+` for all of them.
- **level** — set it to `ERROR`.
- **q** — leave empty, or paste a complaint number to follow one case.

Then set the time range to **start ten minutes before the problem began**.

**Copy the oldest error you can see, not the newest.** When something breaks, other things
fail after it — the first error is the one that matters. Copy 10–20 lines around it **as
text**, and note the time range you used.

If you see no errors at all, that's a real finding. Write "no ERROR lines between HH:MM and
HH:MM" in the ticket — it rules a lot out.

---

## Step 5 — resolve or escalate

**Check [known-issues.md](known-issues.md) first.** If your symptom is in that table and
the resolution is marked as one you're able to apply, do it and close the ticket, adding a
line to the incident log.

Otherwise, escalate to L2 with **Part A** of [incident-report.md](incident-report.md)
filled in. Part A is exactly what you gathered above, so it should be a copy-paste job.

Escalate straight away, without finishing the steps, if any of these are true:

- **Infrastructure is red** on the health dashboard.
- **Nobody can log in**, or the site doesn't load at all.
- **No complaint can be filed** by anyone.
- **A disk-full or "no space left on device" message** appears anywhere.

For those, do Step 2 (screenshot the red tiles) and hand over immediately. The remaining
steps can be done by L2 while you're notifying people.

---

## What to capture, always

Attach these to every ticket you pass on. Text, not photographs of a screen — text can be
searched.

- [ ] The answers from **Step 0**
- [ ] **Scope** — did it fail for you too, in a private window, on another account?
- [ ] **Health dashboard screenshot**, if anything was red
- [ ] Any **red tile names**
- [ ] **Restart / OOM findings** from Step 3, with times
- [ ] The **error text** from Step 4, plus the time range and service you used
- [ ] The **complaint number / user ID**, if there is one
- [ ] A screenshot of the failing screen — and if the caller can manage it, with the browser
      developer tools **Network** tab open (F12), showing the failed request

One thing to be aware of before attaching anything: logs and screenshots from this system
can contain citizens' names, phone numbers and complaint text. The redaction guidance in
[incident-report.md](incident-report.md#redaction--what-not-to-send-us) covers what to strip.
