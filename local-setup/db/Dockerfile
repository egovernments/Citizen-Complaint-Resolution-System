# Minimal image carrying psql + the checked-in DIGIT DB snapshot.
# Consumed by the db-dump-restore Job (devops/deploy-as-code) to seed a
# fresh external managed Postgres. Dump stays the single source of truth
# at local-setup/db/full-dump.sql (also used by compose + local-setup/k8s).
FROM postgres:16-alpine
COPY full-dump.sql /dump/full-dump.sql
