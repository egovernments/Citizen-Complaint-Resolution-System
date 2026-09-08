# Deploying the scanner in another repo

The tool is per-repo: each repo carries its own copy of `security-scan/`. To add it to another
DIGIT/CCRS repo, copy the folder and change a handful of hard-coded values. Placeholders below use
`<owner>/<REPO>` — substitute the target repo (this CCRS install is the reference implementation).

## Steps

1. **Copy** `security-scan/` into the target repo (on a branch, e.g. `security/vulnerability-scan`,
   or on `master`).

2. **Edit `scan.py`** — the per-repo config block near the top:
   ```python
   REPO_NAME = "<REPO>"
   REPO_FULL = "<owner>/<REPO>"
   REPO_URL  = "https://github.com/<owner>/<REPO>"
   PAGES_URL = "https://<owner>.github.io/<REPO>/security_scan/"
   DEFAULT_BRANCH = "master"
   # WEBAPP_URL stays the SAME (one Apps Script serves all repos)
   ```

3. **Edit `run.sh`** — the config block:
   ```bash
   REPO_FULL="<owner>/<REPO>"
   REPO_URL="https://github.com/${REPO_FULL}"
   REF="${SECSCAN_REF:-<branch-the-tool-lives-on>}"   # e.g. master, or security/vulnerability-scan
   ```

4. **Edit `README.md`** — the `curl` URL, repo name, and dashboard URL.

5. **Edit `dashboard-index.html`** — the sidebar brand (`<span>…</span>`) to the repo's short name.

6. **Grant the Apps Script's PAT access** to the new repo (GitHub → the fine-grained PAT →
   Repository access → add `<REPO>`, Contents: read+write). A fine-grained PAT is per-org, so a repo
   in a **different** org needs its own token or a classic `repo`-scoped PAT — see `SETUP.md`. No new
   Apps Script is needed; the same endpoint publishes to whichever repo the POST names.

7. **Enable GitHub Pages** on the new repo (Settings → Pages → branch `gh-pages` `/`).

8. Make sure the runner one-liner's branch resolves: if the tool ships on `master`,
   `curl …/master/security-scan/run.sh` just works; if it ships on a branch, point the URL and
   `SECSCAN_REF` at that branch and seed `security_scan/index.html` by hand (see `SETUP.md`).

## What does NOT change

- The **Apps Script** (one deployment serves every repo; the POST carries `repo`).
- The **`SECSCAN_TOKEN`** (same shared token for all repos).
- The **scoring / checklist** — it's DIGIT-deployment-generic. Checks that don't apply to a repo
  simply come back `present:false`.

## Scope check

Confirm the repo uses the same `local-setup/` layout. The in-scope allowlist (`SCOPE_COMPOSE`,
`SCOPE_SUBDIRS` in `scan.py`) is generic across DIGIT/CCRS repos; adjust only if a repo's deployment
topology differs (new compose stack or mounted config dir).
