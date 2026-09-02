# db-seed dump — DO NOT hand-edit

`full-dump.sql.gz` is a **generated** artifact: a gzip of the canonical seed
dump at `local-setup/db/full-dump.sql` (the same file the ansible/compose tier
loads). Helm's `.Files.Get` can't read outside this chart directory, so the k8s
tier bundles this derived copy instead of referencing the canonical file.

**Never edit this file directly.** Edit `local-setup/db/full-dump.sql`, then
regenerate:

```sh
bash .github/scripts/check-seed-dump-sync.sh --fix
```

CI (`.github/workflows/k8s-seed-dump-sync.yml`) fails if this copy drifts from
the canonical dump — the drift that once made k8s seed 108 localization rows
while ansible seeded 2065.
