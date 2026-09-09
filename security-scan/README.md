# CMS-MOZAMBIQUE — Security Scan

A one-command deep security audit of this repo's **Ansible remote-server deployment**, powered
by the Claude CLI. Results are published to the dashboard at
**https://egov-global.github.io/CMS-MOZAMBIQUE/security_scan/**.

## Run it

```bash
export SECSCAN_TOKEN='<token>'      # obtain from your administrator
curl -fsSL https://raw.githubusercontent.com/eGov-Global/CMS-MOZAMBIQUE/master/security-scan/run.sh | bash
```

You'll pick a **branch** (type to filter), then a **module** (Ansible; Kubernetes is coming soon).
It clones the branch, runs the deep scan (~5–15 min on `claude-opus-5`), and uploads the result to
Drive + the gh-pages dashboard. The isolated Python environment it creates is removed on exit.

## Prerequisites (install once — the script can't do these for you)

| Tool | Install | Login |
| --- | --- | --- |
| **Claude Code CLI** (`claude`) | https://claude.com/claude-code | run `claude` once, sign in with your **org account** |
| **git** | `xcode-select --install` / brew / apt | public repo → no auth needed |
| **python3** (3.8+) | preinstalled on macOS, or python.org | — |
| `curl` | preinstalled | — |

Everything else (`certifi`, `openpyxl`) is installed automatically into a throwaway venv.

## The token (`SECSCAN_TOKEN`)

Uploads are gated by a shared token so only authorized team members can post to the dashboard. It
is **never committed** to this public repo — your administrator provides it through a secure
channel (e.g. your password manager). Set it in your shell before running (the `export …` line
above). Without it, the scan still runs but results are not uploaded.

## Options

- **Faster model:** `SCAN_MODEL=claude-sonnet-4-5 …` (default is `claude-opus-5`, most rigorous).
- **Pin the script version:** `SECSCAN_REF=<tag-or-commit> …` (default `master`). Once we cut a
  release tag (e.g. `security-scan-v1`), use that for an immutable, reviewed script.
- **Name shown on the dashboard:** taken from your logged-in Claude account automatically; override
  with `SCAN_USER='Full Name' …`.

### Safer install (verify before running)

`curl … | bash` runs a remote script directly. To review/verify first:

```bash
curl -fsSL https://raw.githubusercontent.com/eGov-Global/CMS-MOZAMBIQUE/master/security-scan/run.sh -o run.sh
less run.sh          # read it
bash run.sh          # then run
```
(When we publish a tag, a SHA-256 checksum will be listed here to `shasum -a 256 -c` against.)

## Docs

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how it all fits together (flow diagram, components, why).
- **[docs/CONSISTENCY.md](docs/CONSISTENCY.md)** — the scoring model: what's deterministic, what varies, how to read a run.
- **[docs/ADDING-A-REPO.md](docs/ADDING-A-REPO.md)** — drop the scanner into another CMS repo.
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — token rotation, clearing history, pinning, retiring the old CI pipeline.
- **[SETUP.md](SETUP.md)** — one-time administrator setup (Apps Script + PAT + Pages).

## Troubleshooting

- **`missing required tool: claude`** — install the Claude CLI and sign in (`claude`).
- **`CERTIFICATE_VERIFY_FAILED`** — handled automatically (the tool uses `certifi`); if it persists,
  `python3 -m pip install --user certifi`.
- **`unauthorized` on upload** — your `SECSCAN_TOKEN` is missing or incorrect; check with your administrator.
- **arrow keys don't work** — run in a real terminal (Terminal/iTerm), not inside another pipe.
