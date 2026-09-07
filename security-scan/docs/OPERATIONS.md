# Operations & maintenance

Day-to-day operational notes for the administrator.

## Cost & time

- One scan ≈ **5–15 min** on `claude-opus-5` (agentic read of ~200 in-scope files). It runs on the
  runner's own Claude org account — no shared/metered API cost.
- `SCAN_MODEL=claude-sonnet-4-5 …` is faster and still accurate for routine checks.

## Rotating the shared token

If `SECSCAN_TOKEN` leaks (it gates uploads):
1. Change `SHARED_TOKEN` in `apps-script.gs` (or the Script Property) to a new value.
2. Re-deploy the Apps Script (Manage deployments → New version — same `/exec` URL).
3. Distribute the new token to runners through a secure channel.

The endpoint URL and the GitHub PAT don't need to change.

## Rotating the GitHub PAT

Update `GH_TOKEN` (in `apps-script.gs` or Script Properties) and re-deploy a new version. Use a
fine-grained PAT scoped to only the CMS repos with **Contents: read+write**.

## Retiring the old CI pipeline

The legacy workflow (`.github/workflows/security-scan.yml`, Checkov/KICS/Gemini/Strix) also
publishes to `gh-pages:/security_scan/`. Once the Claude scanner is your dashboard, **disable or
delete that workflow** so it doesn't overwrite `manifest.json`. Until then, run only one of the two.

## Clearing dashboard history

The Apps Script never deletes — do cleanup yourself in the two stores:
- **Drive:** delete files under `CMS-Security-Scan/<owner>/<repo>/` in the Drive UI.
- **gh-pages:** delete `security_scan/data/*` and reset `security_scan/manifest.json` to
  `{"runs":[]}` on the `gh-pages` branch (leave `index.html`).

## Concurrency

Two runs finishing together both update `security_scan/manifest.json`; the Apps Script retries on
GitHub `409` conflicts (up to 4 attempts). No action needed.

## Pinning the runner command (recommended once stable)

`README.md` currently points at `master` (mutable). To make the piped script immutable:
1. Cut a tag, e.g. `git tag security-scan-v1 && git push origin security-scan-v1`.
2. In `README.md`/`run.sh`, change the URL/`REF` to the tag (or a full commit SHA — strongest).
3. Optionally publish `shasum -a 256 security-scan/run.sh` in `README.md` for verify-before-run.

## Common issues

| Symptom | Fix |
| --- | --- |
| `missing required tool: claude` | install Claude CLI + `claude` login (org account) |
| `unauthorized` on upload | `SECSCAN_TOKEN` missing/wrong; must equal the Apps Script's `SHARED_TOKEN` |
| gh-pages not updating | PAT lacks Contents:write on the repo, or `GH_TOKEN` unset; check Apps Script exec logs |
| dashboard blank | first run hasn't published, or `manifest.json` empty; check `security_scan/` on gh-pages |
| `CERTIFICATE_VERIFY_FAILED` | handled via `certifi`; if it persists, `pip install --user certifi` |
| arrow keys dead | run in a real terminal; `run.sh` already reattaches `</dev/tty` |
