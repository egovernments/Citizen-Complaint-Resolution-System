# Scoring & consistency

The scanner is an LLM audit, so the first question is always: **is it reproducible?** The answer:
**severity and priority are 100% deterministic; discovery is ~stable with a small novel tail.**
This doc explains exactly what is fixed, what can vary, and how to read a run.

## How a finding is scored

Claude does **discovery** (reads the code, decides what holds), then a **deterministic layer** in
`scan.py` decides the label. Claude never picks the severity word.

1. **A fixed checklist of ~36 canonical checks** (`CHECKLIST` in `scan.py`) is evaluated on every
   run. For each `check_id` Claude must return a `present: true|false` verdict — this forces it to
   consider every item (recall) and to use the canonical id (no renamed duplicates).
2. **Canonical severity/priority per check** (`CHECK_SCORE`): each checklist id maps to a fixed
   `(severity, priority, status)`. So `jupyter-root-published` is always `CRITICAL/P0`,
   `nginx-security-headers` always `MEDIUM/P3`, etc. — independent of any LLM wording.
3. **Novel findings** (`extra-<slug>`, not on the checklist) fall back to a fact-based rubric
   (`score()`): the model reports objective facts (`impact`, `exposure`, `runtime`,
   `default_active`, `benign`) and code maps those to a label. Same facts → same label.

Net: **for the 36 known issues, two runs on the same commit produce identical severity and
priority.** Verified across many runs (0 drift).

## What can still vary (and why it's fine)

| Metric | Reproducible? | Why |
| --- | --- | --- |
| Severity of a checklist finding | ✅ exact | pinned in `CHECK_SCORE` |
| Priority of a checklist finding | ✅ exact | pinned in `CHECK_SCORE` |
| Which checklist findings appear | ✅ high | `present:true/false` forces evaluation of all 36 |
| `extra-*` novel findings | ⚠️ small tail | genuine new discoveries; 1–3 per run differ |
| **Occurrence counts** | ⚠️ jitter | the number of *matched lines* the LLM enumerates |

**Occurrence count is the least reproducible metric** — it's how many individual lines/ports/routes
the model happened to list for a finding (e.g. "seeded credentials" matched 16 lines in one run, 7
in another). It does not change the finding or its severity.

## How to read a run

- **Trust:** issue **types**, the **action-required set**, **P0/P1 counts**, and per-finding
  **severity/priority**. These are the stable, meaningful signals.
- **Don't over-index on:** raw **occurrence totals** — they wobble by design.
- The dashboard's donut and trend deliberately count **types by severity** (stable), not
  occurrences (jittery). Per-finding `×N` badges still show the occurrence detail.

## Reproducibility levers

- **Model is pinned** (`SCAN_MODEL = "claude-opus-5"`) so every machine uses the same tier.
- **Scoring is code, not prompt** — the model can't drift the labels.
- The only residual variance is the `extra-*` tail. When a novel finding recurs, **promote it to
  the checklist** (add it to `CHECKLIST` + `CHECK_SCORE`) and it becomes fixed from then on. This
  is how the checklist grew from 26 → 36.

## The threat model behind the scores

This is a single internet-facing host: nginx terminates TLS on 443; there is **no host firewall**
and ~33 ports (datastores + admin UIs) bind `0.0.0.0`, so the cloud security group is the only
perimeter. Data is confidential citizen grievance data. Hence:

- datastore/admin exposed to the public edge, active by default → **P0**
- unauthenticated RCE / auth bypass (Jupyter root, OTP-mock, MCP admin, anon Grafana) → **CRITICAL/P0**
- committed credentials / dev secrets → **P0/P1**
- container-escape needing a foothold (docker socket) → **HIGH, lower priority**
- reliability-only / read-only monitoring mounts → **acceptable** (documented, not tracked)
- test/CI-only code (tests/, CI helpers) → **LOW/P3** (real, but not the production runtime)
