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

1. https://script.google.com → New project → paste **`security_scan/apps-script.gs`** (the shared publisher, one level up at the `security_scan/` root).
2. Set the two secrets — **either** edit the config vars at the top of the script:
   ```js
   var SHARED_TOKEN = "eDyz05i…";                 // runners pass this as SECSCAN_TOKEN
   var GH_TOKEN     = "github_pat_…";              // fine-grained PAT (Contents: read+write)
   ```
   **or** leave the `PASTE_…` placeholders and add them in Project Settings → **Script properties**
   (keys `SHARED_TOKEN`, `GH_TOKEN`). The script uses the in-code value if set, else the property.
3. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone** → Deploy.
4. **Authorize the scopes.** When prompted, grant **both** Google Drive **and** "Connect to an
   external service" — the latter (`.../auth/script.external_request`) is what lets the script write
   to GitHub. If it is missing, scans upload to Drive but the dashboard step fails with
   *"You do not have permission to call UrlFetchApp.fetch"* — fix it via **Re-authorizing** below.
5. Copy the `/exec` URL and paste it into **both** scanners: `ansible/scan.py` and `code-base/scan.py` → `WEBAPP_URL` (it is public/safe to commit).

### Re-authorizing (external-requests permission)

If a scan reports `✓ uploaded to Drive` but the gh-pages step returns
`You do not have permission to call UrlFetchApp.fetch … auth/script.external_request`, the
deployment was authorized before it had the GitHub-publishing code. Re-authorize with the external
scope and redeploy:

1. Open the Apps Script project → **Project Settings** → tick **Show "appsscript.json" manifest file in editor**.
2. Open `appsscript.json` and declare the scopes explicitly so they are always requested:
   ```json
   "oauthScopes": [
     "https://www.googleapis.com/auth/script.external_request",
     "https://www.googleapis.com/auth/drive"
   ]
   ```
3. In the editor pick any function and **Run** once; approve the consent screen — it now includes
   **"Connect to an external service"**.
4. **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.** The `/exec` URL
   is preserved (a Web App runs with the scopes authorized at deploy time, so a new version is
   required for the added scope to take effect).
5. Re-run a scan; the dashboard should publish.

## 4. Give the token to runners and CI

`SHARED_TOKEN` is the shared upload gate, distributed through a secure channel (e.g. a shared
password manager). **Never commit it.** Two consumers:

- **Ansible runners** — each person sets `export SECSCAN_TOKEN='<that value>'` before running `run.sh`.
- **Code Base workflow** — add it as a **repo secret** named `SECSCAN_TOKEN`
  (Settings → Secrets and variables → Actions). The `code-scan.yml` workflow reads it there.

## 5. First run

- If the repo's `gh-pages:/security_scan/` already has an old (CI-pipeline) dashboard, clear
  `security_scan/manifest.json` and `security_scan/data/` once so the Claude runs start clean.
  (The Apps Script seeds a fresh `index.html` from this repo's `security_scan/dashboard-index.html`.)
- Run a scan from any branch and confirm it appears at
  `https://egov-global.github.io/CMS-MOZAMBIQUE/security_scan/`.

## Notes

- The Apps Script **creates/updates only** under `security_scan/` — it never deletes.
- Concurrent runs updating `manifest.json` retry on GitHub 409 conflicts.
- **Audit workbook sharing.** The dashboard's *Export audit* button links to the Excel file on
  Drive, so the script shares each new `.xlsx` **view-only, with the link** to the owner's domain
  plus every domain in `EXTRA_SHARE_DOMAINS` (default `["egov.global"]`) — so `egovernments.org`
  and `egov.global` accounts can open it, keeping the full audit internal even though the dashboard
  itself is public. How it works: the owner's own domain is shared via `DriveApp.setSharing`; the
  extra domains are added via the Drive REST API (`_shareAudit`). Caveats:
  1. The Drive owner must be on a Workspace (e.g. `egovernments.org`).
  2. **Each extra domain must be trusted/allowlisted for external sharing by the owner's Workspace
     admin** (Admin console → Apps → Google Workspace → Drive and Docs → Sharing settings). If a
     domain is not trusted, its share call returns a 3xx logged in the execution log and that domain
     stays without access — add those users individually or have the admin allowlist the domain.
  3. To fix workbooks uploaded before this change, run the one-off **`shareExistingPublic`** function
     once from the editor.
  (Note: the findings *JSON* under `security_scan/data/` is public on gh-pages — only the
  downloadable workbook is domain-restricted.)
- To pin the runner command to an immutable version later, cut a tag (e.g. `security-scan-v1`)
  and change `README.md`'s URL + `run.sh`'s `REF` (or `SECSCAN_REF=<tag>`).
