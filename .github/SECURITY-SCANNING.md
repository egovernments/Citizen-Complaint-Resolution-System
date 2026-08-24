# Security Scanning - Ansible Remote Server Deployment

Security scanning for the Ansible remote-server deployment path
([setup path C](../local-setup/#choose-your-setup-path): `./deploy.sh <tenant>`).
Runs in CI as `.github/workflows/security-scan.yml` and publishes a public dashboard.

## What runs

| Tool | Scope |
|------|-------|
| **Checkov** | Ansible deployment code (`local-setup/ansible`) - config hardening (`.checkov.yaml`) |
| **KICS** | `docker-compose` files - exposed ports, protocols, privileged, host-network, host mounts (native severities) |
| **GitHub secret scanning** (native) | Secrets - lower false positives than entropy-based scanners; Checkov secret scanning is intentionally off |

Out of scope here (later phases): `local-setup/k8s/**` (Kubernetes/Tilt) and
`devops/**` (Helm charts + Terraform).

## Trigger

**Manual only.** Actions -> "Security Scan - Ansible Remote Server Deployment" ->
**Run workflow** -> pick the branch from the dropdown. (The button appears once the
workflow is on the default branch.)

## Where results go

- **Public dashboard (primary):** `https://egov-global.github.io/CMS-MOZAMBIQUE/security_scan`
  - report switcher (any past run), risk summary + severity donut, trend across runs
  - findings grouped by rule with **why / how-to-fix**, every location **linked to the exact line** on the scanned commit
  - AI additions (when enabled): executive summary, priority actions, triage badges, dual-pass verify markers, and a "hide likely false positives" toggle
  - timestamps render in the **viewer's local timezone**
- **Security -> Code scanning:** SARIF from both tools + inline PR annotations (engineer triage)
- **Actions run:** a condensed severity summary + the `security-report-data` artifact (`run.json`)

One-time to make the dashboard live: **Settings -> Pages -> Deploy from a branch ->
`gh-pages` / root**. The repo is public, so the dashboard is public by design.

## AI enrichment (optional, free)

A 5-stage agent pipeline enriches each report when a key is present. Engine is any
OpenAI-compatible LLM; default is **Google Gemini**.

1. **context** - reads the real code around each finding
2. **triage** - confirmed / likely false positive / needs review (+ reason)
3. **remediate** - context-aware why/fix grounded in the actual code
4. **verify** - **dual-pass critic**: a fix is "verified" only if two independent reviewers agree
5. **summary** - executive summary + prioritized action list

**Enable:** add a repo secret **`GEMINI_API_KEY`** (free key from
[aistudio.google.com](https://aistudio.google.com); a personal Google account works
if your org blocks AI Studio). Optional repo variable `GEMINI_MODEL` (default
`gemini-2.0-flash`). To use a different provider, set `LLM_BASE` + the key and model.

**Guardrails:** no key = clean no-op (curated remediation kept); raw scanner findings
are never altered (agents only annotate); likely false positives are **labelled, never
dropped**; per-rule results are cached on `gh-pages` so unchanged rules aren't re-run.
Any failure falls back to curated text - it never breaks the pipeline.

## Reading the report

- **Count** = how many times a rule matched, grouped into one issue type.
- **Severity** = KICS native; Checkov findings are bucketed (Medium).
- **Triage** (AI) = confirmed / likely false positive / needs review.
- **Verify** (AI) = the fix passed both critics (`verified`) or was flagged (`needs review`).

## Enforcement (currently report-only)

`soft-fail: true` (Checkov) and `fail_on: ""` (KICS) report without failing. To enforce
after triage: set `soft-fail: false` + KICS `fail_on: high`, then add the check as
required in branch protection.

## Files

| File | Role |
|------|------|
| `.github/workflows/security-scan.yml` | the pipeline |
| `.checkov.yaml` | Checkov scope (Ansible) |
| `.github/scripts/security_report.py` | merge scanners -> `run.json` |
| `.github/scripts/enrich_report.py` | Gemini agent pipeline (optional) |
| `.github/scripts/build_manifest.py` | index runs for the switcher/trend |
| `.github/scripts/publish_pages.sh` | publish to `gh-pages` (keeps history) |
| `.github/security-dashboard/index.html` | the dashboard |
