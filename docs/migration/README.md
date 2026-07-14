# CCRS migrations — unified runner

Recommended entry point: one idempotent script that covers every migration
(the individual legacy scripts below still exist and work; the runner
supersedes them for day-to-day use):

```bash
node docs/migration/ccrs-migrate.cjs --host http://<gateway> --tenant mz [--pass '<admin-pass>']
```

- **Continue-on-error**: a failing phase records its ERROR CODE + remediation
  and the run moves on; the final summary table shows every phase.
- **Idempotent**: completed work is detected and skipped — re-run any time,
  including after fixing a single failed phase.
- **Dry-run**: `--dry-run` prints the plan (the old preflight), zero writes.
- **Scoping**: `--phases schemas,landing` runs a subset; `--report out.json`
  writes a machine-readable result; `--cms` opts into the CMS workflow phase.
- Exit code = number of phases needing attention (0 = clean).

| Phase | What it covers | Equivalent legacy script |
|---|---|---|
| auth | login / token | (inline in every script) |
| schemas | all RAINMAKER-PGR + Landing MDMS schemas | `install-schemas.cjs` |
| hierarchy | 2-level → N-level complaint hierarchy (preserve/derive) | `migrate.cjs`, `preflight-dryrun.cjs` (= `--dry-run`), `run-data-migration.sh` |
| pgr-masters | RelatedToMap / TemplateType / ExtAttrSchema seeds | `seed-pgr-masters.cjs`, `seed-data.cjs` |
| landing | landing sections + page config + PGR_LANDING_* keys | `landing-config/seed-landing-config.sh` |
| cms | CMS roles / actions / grants / workflow (opt-in `--cms`) | `seed-pgr-masters.cjs CMS=1` |
| verify | consolidated v1 read-back | (manual SQL in `run-data-migration.sh`) |

Seed data stays in `docs/migration/seed/` and the DDH resources tree — the
runner reads them from the checkout it lives in.

Known environment quirks the runner handles or surfaces with remediation:
async schema persist (202 + verify-after), the `x-ref-schema []→{}` bug
(strip-on-create + SQL hint on hit), silently-dropped schema creates on old
images (verify-after + DB-insert hint), non-ASCII schema descriptions
(sanitised), one-locale-per-call localization upserts.

The hierarchy cutover REMAINS lockstep and human-checkpointed — see
`operator-runbook.md` §8 for the deploy/retire ordering after data migration.
