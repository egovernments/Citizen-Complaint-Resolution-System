# dss-mdms-seed — dashboard schemas + localization packs

Supporting files for `local-setup/scripts/enable-dashboard.sh`, which turns the
supervisor dashboard on for a tenant on a **running** deployment.

```
schemas/       the three dss MDMS schema definitions (registered in mdms-v2)
l10n/          the rainmaker-dashboard message packs, one file per locale
export-l10n.mjs  regenerates l10n/ from the digit-mcp TypeScript source
```

The **KPI catalog data is deliberately not here.** It lives at
`ansible/nairobi-mdms/mdms/dss/{KpiDefinition,DashboardPack,DashboardConfig}.json`
and the script reads it from there. Two copies of the catalog in one repo is
how "works on bomet, empty on the repro box" happens — see
`docs/dashboard-configuration/60-operations.md` §4.

## Quick start

```bash
# stock CCRS role taxonomy
DASHBOARD_TENANT=ke ./local-setup/scripts/enable-dashboard.sh

# a deployment with its own role names
DASHBOARD_TENANT=mz \
  ROLE_MAP="PGR_SUPERVISOR=CMS_SUPERVISOR,PGR_LME=CMS_CASE_MANAGER" \
  DASHBOARD_ALLOWED_ROLES="SUPERVISOR,SUPERUSER,GRO,DGRO,CMS_SUPERVISOR" \
  ./local-setup/scripts/enable-dashboard.sh --repair
```

Run `--dry-run` first: step 0 is read-only and reports every precondition,
including problems the seed cannot fix (unheld roles, missing department
enrichment, corrupt records).

## schemas/

Each file is the bare JSON Schema. The script wraps it in the mdms-v2
`SchemaDefinition` envelope (`tenantId`, `code`, `definition`, `isActive`) at
registration time.

**Do not POST these files to `/v2/_create/<schema>`.** That endpoint takes
*data*; posting a schema body there creates a record whose payload is the
schema, which occupies the `uniqueIdentifier` a real record needs and makes
every later seed of that record fail as a duplicate. This has happened in
production (`mz`, both `dss.KpiDefinition` and `dss.DashboardPack`). The
script detects the shape in preflight and `--repair` deactivates it.

## l10n/

`<locale>.json` — the `rainmaker-dashboard` message pack for that locale, 315
codes each, 1:1 across locales. 65 codes carry the `CMS-DASHBOARD.` prefix and
are referenced by the catalog's `titleKey`/`subtitleKey`/`labelKeys`; the rest
are dashboard chrome. The prefix is part of the **code**, not a module name —
all of them live in module `rainmaker-dashboard`.

These files are **derived**. The source of truth is
`digit-mcp/src/tools/dashboard-l10n-seed.ts` (itself generated from the FE
`t("KEY", "English")` literals and the KpiDefinition title/subtitle/label
pairs), because `tenant_bootstrap` seeds from the TypeScript. Regenerate after
changing it:

```bash
node local-setup/db/dss-mdms-seed/export-l10n.mjs           # rewrite l10n/
node local-setup/db/dss-mdms-seed/export-l10n.mjs --check   # fail on drift
```

Adding a locale means adding a pack to the `.ts` file and re-running the
export — not hand-writing a JSON file here, which would drift from what
bootstrap seeds. Locales with no pack (bomet runs `fr_FR`) exist only as live
DB rows; the script's step 7 still verifies them, against the locales the
deployment offers in `common-masters.StateInfo.languages`.

## Related

- **`enable-dashboard.sh --help`** — the full runbook: prerequisites, the seven steps, the
  role-remap decision, and a symptom→cause table for every known blocker
- Runbook (issue #631): the original, with the manual form of each step
- `docs/dashboard-configuration/` — the reference docs this seeds against
- `local-setup/db/notif-mdms-seed/` — the same pattern for notification masters
