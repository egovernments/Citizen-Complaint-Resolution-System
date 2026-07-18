# Verification: dump-based K8S seeding + DDH retirement

Prereqs: CI has built and pushed the `db-dump` image; `dbDump.image.repository`
in db-dump-restore values (or an env override) points at that pushed image;
`egov-config` (db-host/db-name) and secret `db` are set for the target env.

## A. Fresh DB, flag ON — dump loads, no Flyway conflicts
1. Point at a brand-new empty managed DB (no DIGIT schema).
2. Deploy with the flag on:
   `helmfile -f digit-helmfile.yaml sync --set dbDump.enabled=true`
3. Confirm the restore Job ran and loaded the dump:
   `kubectl -n egov logs job/db-dump-restore` → shows "DB is empty — restoring" then "Restore complete."
4. Confirm NO service dbMigration initContainer hit 42P07:
   `kubectl -n egov get pods` → all core/common/urban pods Running/Completed;
   spot-check `kubectl -n egov logs <pod> -c db-migration` for egov-user, mdms-v2,
   egov-workflow-v2, egov-enc-service, egov-hrms → Flyway reports "Successfully validated"
   / "up to date" (no "relation already exists").
5. Confirm DDH's former output is present (dump carried it):
   `psql ... -c "SELECT count(*) FROM tenant.tenants;"` → >= 1;
   MDMS DataSecurity + PGR ComplaintHierarchy present; enc-service pod Ready.
6. Confirm DDH is NOT deployed:
   `kubectl -n egov get deploy | grep default-data-handler` → no result.

## B. Re-deploy against the seeded DB — guard skips
1. Re-run: `helmfile -f digit-helmfile.yaml sync --set dbDump.enabled=true`
2. `kubectl -n egov logs job/db-dump-restore` (latest) → shows
   "DB already provisioned ... skipping restore." and exits 0. No data change.

## C. Flag OFF (default) — no Job at all
1. `helmfile -f digit-helmfile.yaml sync` (flag defaults false)
2. `kubectl -n egov get job db-dump-restore` → not found. Normal upgrade.

## Rollback
Set `default-data-handler` back to `installed: true` in urban-helmfile.yaml and
`helmfile sync` to restore the old seeding path.
