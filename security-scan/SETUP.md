# Administrator setup (one-time) — Apps Script + gh-pages

This is for the **administrator** — the person who maintains the Google Drive account and the
GitHub write token for the scan dashboard. Runners do not need this; they use `run.sh` (see
README.md).

## 1. GitHub token (write to gh-pages)

Create a **fine-grained PAT**: GitHub → Settings → Developer settings → Fine-grained tokens →
- Resource owner: `eGov-Global`
- Repository access: the CMS repos you'll publish to (e.g. `CMS-MOZAMBIQUE`, `CMS-KENYA`)
- Permissions: **Contents → Read and write**
Copy the token.

## 2. Enable GitHub Pages (per repo)

Repo → Settings → Pages → Source = **Deploy from a branch**, Branch = **gh-pages** `/ (root)`.
(The dashboard serves from `gh-pages:/security_scan/`.)

## 3. Deploy the Apps Script

1. https://script.google.com → New project → paste **`apps-script.gs`** (in this folder).
2. Set the two secrets — **either** edit the config vars at the top of the script:
   ```js
   var SHARED_TOKEN = "eDyz05i…";                 // runners pass this as SECSCAN_TOKEN
   var GH_TOKEN     = "github_pat_…";              // fine-grained PAT (Contents: read+write)
   ```
   **or** leave the `PASTE_…` placeholders and add them in Project Settings → **Script properties**
   (keys `SHARED_TOKEN`, `GH_TOKEN`). The script uses the in-code value if set, else the property.
3. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone** → Deploy,
   and **Authorize** (grant Drive + external requests).
4. Copy the `/exec` URL and paste it into `scan.py` → `WEBAPP_URL` (it's public/safe to commit).

## 4. Give runners the token

Distribute `SHARED_TOKEN` to runners through a secure channel (e.g. a shared password manager).
Each runner sets `export SECSCAN_TOKEN='<that value>'` before running. **Never commit it.**

## 5. First run

- If the repo's `gh-pages:/security_scan/` already has an old (CI-pipeline) dashboard, clear
  `security_scan/manifest.json` and `security_scan/data/` once so the Claude runs start clean.
  (The Apps Script seeds a fresh `index.html` from this repo's `security-scan/dashboard-index.html`.)
- Run a scan from any branch and confirm it appears at
  `https://egov-global.github.io/CMS-MOZAMBIQUE/security_scan/`.

## Notes

- The Apps Script **creates/updates only** under `security_scan/` — it never deletes.
- Concurrent runs updating `manifest.json` retry on GitHub 409 conflicts.
- To pin the runner command to an immutable version later, cut a tag (e.g. `security-scan-v1`)
  and change `README.md`'s URL + `run.sh`'s `REF` (or `SECSCAN_REF=<tag>`).
