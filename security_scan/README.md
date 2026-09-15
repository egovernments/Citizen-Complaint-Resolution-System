# CMS-MOZAMBIQUE — Security Scanning

Security scanning for this repository, published to one dashboard with a left-nav module switch:
**https://egov-global.github.io/CMS-MOZAMBIQUE/security_scan/**

| Module | Scans | How it runs | URL | Docs |
| --- | --- | --- | --- | --- |
| **Ansible** | the Ansible remote-server **deployment** (config posture) via the Claude CLI | on-demand, `curl … \| bash` | `/security_scan/ansible` | [ansible/docs/](ansible/docs/) |
| **Code Base** | **dependency vulnerabilities** (Maven · npm · Go) in `backend/ frontend/ digit-ui-esbuild/ digit-ui-v2/` via OSV-Scanner | automated GitHub Action | `/security_scan/code` | [code-base/docs/](code-base/docs/) |
| Kubernetes | Helm / k8s path | coming soon | `/security_scan/kubernetes` | — |

The root `/security_scan/` redirects to `/security_scan/ansible`.

## Layout

```
security_scan/
├── README.md · SETUP.md              common docs
├── apps-script.gs                    shared upload endpoint (Drive + gh-pages publisher)
├── dashboard-index.html              shared dashboard app (served to every module)
├── ansible/     run.sh · scan.py · requirements.txt · scripts/ · docs/
└── code-base/   scan.py · code-scan-config.yaml · requirements.txt · docs/
```

## Run the Ansible scan (on-demand)

```bash
export SECSCAN_TOKEN='<token>'      # obtain from your administrator
curl -fsSL https://raw.githubusercontent.com/eGov-Global/CMS-MOZAMBIQUE/master/security_scan/ansible/run.sh | bash
```

You pick a **branch** (type to filter), then a **module** (Ansible). It clones the branch, runs the
deep scan (~5–15 min on `claude-opus-5`), and uploads to Drive + the dashboard. The throwaway Python
environment it creates is removed on exit.

**Prerequisites** (install once): **Claude Code CLI** (`claude`, signed in with your org account),
**git**, **python3** (3.8+), **curl**. Everything else (`certifi`, `openpyxl`) installs into a temp venv.

## Run the Code Base scan (automated)

It runs as a **GitHub Action** (`.github/workflows/code-scan.yml`) — no local run needed:

- on **push to `master`** touching code paths, a weekly **schedule**, or **manual dispatch**
  (Actions → *Code-Base Security Scan* → **Run workflow**);
- reads `code-base/code-scan-config.yaml`, runs OSV-Scanner per project, and publishes to the
  **Code Base** dashboard page (`/security_scan/code`).

## The token (`SECSCAN_TOKEN`)

A shared token gates uploads so only authorized posts reach the dashboard. It is **never committed**.

- **Ansible runners** export it in their shell (the `export …` line above).
- **The Code Base workflow** reads it from the **`SECSCAN_TOKEN` repo secret** (Settings → Secrets → Actions).

Without it the scan still runs but results are not uploaded. Your administrator provides it (see SETUP.md).

## Options (Ansible runner)

- **Faster model:** `SCAN_MODEL=claude-sonnet-4-5 …` (default `claude-opus-5`).
- **Pin the script version:** `SECSCAN_REF=<tag-or-commit> …` (default `master`).
- **Name on the dashboard:** taken from your Claude account; override with `SCAN_USER='Full Name' …`.
- **Safer install:** download `run.sh` and read it before `bash run.sh`.

## Docs

- **[SETUP.md](SETUP.md)** — one-time administrator setup (Apps Script + PAT + Pages + token).
- **[ansible/docs/](ansible/docs/)** — Ansible module: architecture, scoring model, operations, adding a repo.
- **[code-base/docs/](code-base/docs/)** — Code Base module: architecture & CI workflow.

## Troubleshooting (Ansible runner)

- **`missing required tool: claude`** — install the Claude CLI and sign in.
- **`CERTIFICATE_VERIFY_FAILED`** — handled via `certifi`; if it persists, `python3 -m pip install --user certifi`.
- **`unauthorized` on upload** — `SECSCAN_TOKEN` missing or incorrect.
- **arrow keys don't work** — run in a real terminal (Terminal/iTerm), not inside another pipe.
