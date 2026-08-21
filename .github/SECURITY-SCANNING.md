# Security Scanning — Ansible Remote Server Deployment

Automated security scanning for the **Ansible remote-server deployment** path
([setup path C](../local-setup/#choose-your-setup-path): `./deploy.sh <tenant>`).
Runs in CI as **`.github/workflows/security-scan.yml`**
("Security Scan - Ansible Remote Server Deployment").

## What is scanned

| Tool | Covers |
|------|--------|
| **Checkov** | Ansible playbooks, Dockerfiles, secrets (`.checkov.yaml`) |
| **KICS** | docker-compose: exposed ports, protocols, privileged, host-network, host mounts (native severities) |

Excluded (other setup paths / later phases): `local-setup/k8s/**`, `devops/**`.
Later phases: Kubernetes + Helm, then Terraform / cloud infra.

## The public dashboard (primary view)

Every run merges both tools into a per-run `run.json` and publishes it to the
**`gh-pages`** branch, which **keeps all historical reports**. The dashboard
(`/.github/security-dashboard/index.html`, copied to gh-pages) is a single page with:

- a **report switcher** (pick any past run),
- **risk summary** tiles + a **severity donut**,
- a **trend** chart across all reports,
- **findings grouped by rule** with occurrence counts, **why it matters / how to fix**,
  and every location **hyperlinked to the exact line** on the scanned commit.

Public URL (after Pages is enabled): `https://egov-global.github.io/CMS-MOZAMBIQUE/security_scan`

### One-time: enable GitHub Pages
After the first run creates the `gh-pages` branch:
**Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `gh-pages` / `/ (root)`**. (The repo is public, so the dashboard is
public — that is intentional here.)

## Other surfaces
- **Security → Code scanning** — engineer triage (SARIF from both tools; inline PR annotations).
- **Actions run summary** — a condensed severity card.
- **`security-report-data`** artifact — the raw `run.json`.

## Reading the numbers
- **Passed / Failed** = each policy evaluated against each resource; failed = violates it.
- **Count** = how many times one rule matched (occurrences), grouped into one issue type.
- **Severity**: KICS native; Checkov (OSS) bucketed (secrets = High, other = Medium).

## Enforcement (currently report-only)
`soft-fail: true` (Checkov) and `fail_on: ""` (KICS). To enforce after triage: set
`soft-fail: false` + KICS `fail_on: high`, then add the check as required in branch protection.

## Files
- `.github/workflows/security-scan.yml` — the pipeline
- `.checkov.yaml` — Checkov scope
- `.github/scripts/security_report.py` — merge scanners → `run.json`
- `.github/scripts/build_manifest.py` — index runs for the switcher/trend
- `.github/scripts/publish_pages.sh` — publish to gh-pages (keeps history)
- `.github/security-dashboard/index.html` — the dashboard SPA
