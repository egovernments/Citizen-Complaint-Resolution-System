# Deploying the scanner in another repo

The tool is per-repo: each repo carries its own copy of `security_scan/ansible/`. To add it to another
CMS repo (e.g. `CCRS`), copy the folder and change a handful of hard-coded values.

## Steps

1. **Copy** `security_scan/ansible/` into the target repo's root (on a branch, e.g. `security/security-scan`).

2. **Edit `scan.py`** — the per-repo config block near the top:
   ```python
   REPO_NAME = "CCRS"
   REPO_FULL = "egovernments/Citizen-Complaint-Resolution-System"
   REPO_URL  = "https://github.com/egovernments/Citizen-Complaint-Resolution-System"
   PAGES_URL = "https://egovernments.github.io/Citizen-Complaint-Resolution-System/security_scan/"
   DEFAULT_BRANCH = "master"
   # WEBAPP_URL stays the SAME (one Apps Script serves all repos)
   ```

3. **Edit `run.sh`** — the config block:
   ```bash
   REPO_FULL="egovernments/Citizen-Complaint-Resolution-System"
   REPO_URL="https://github.com/${REPO_FULL}"
   # REF stays master (or your pinned tag)
   ```

4. **Edit `README.md`** — the `curl` URL and repo name.

5. **Grant the Apps Script's PAT access** to the new repo (GitHub → the fine-grained PAT →
   Repository access → add `CCRS`, Contents: read+write). No new Apps Script is needed —
   the same endpoint publishes to whichever repo the POST names.

6. **Enable GitHub Pages** on the new repo (Settings → Pages → branch `gh-pages` `/`).

7. **Merge** the branch to master so `curl …/master/security_scan/ansible/run.sh` resolves.

## What does NOT change

- The **Apps Script** (one deployment serves every repo; the POST carries `repo`).
- The **`SECSCAN_TOKEN`** (same shared token for all repos).
- The **scoring / checklist** — it's DIGIT-deployment-generic. Checks that don't apply to a repo
  simply come back `present:false`.

## Scope check

Confirm the repo uses the same `local-setup/` layout. The in-scope allowlist (`SCOPE_COMPOSE`,
`SCOPE_SUBDIRS` in `scan.py`) is generic across CMS repos; adjust only if a repo's deployment
topology differs (new compose stack or mounted config dir).
