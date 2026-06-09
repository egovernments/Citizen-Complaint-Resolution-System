# Launch-fixes regression suite — 2026-04-29

Verifies the fixes that landed in the wave of PRs leading up to the Nai
Pepea launch on 2026-07-24. Each spec is a *self-contained API
regression* (fast, deterministic, no UI auth required) with a couple of
focused UI / bundle scrapes where the bug was strictly client-side.

## Issues covered

| Spec | egovernments/CCRS issue | PR(s) | What's guarded |
|---|---|---|---|
| `01-configurator-mdms` | #472 | digit-configurator#40, #41 | Department CRUD: `description` schema mismatch, `_*` metadata leak on create + update, Excel `FALSE` coalescing |
| `02-pgr-employee` | #479 | digit-ui-esbuild#68, #71 | Assign-modal role filter (next-state forward roles only), REJECT payload reason plumbing, RejectionReasons MDMS presence |
| `03-citizen-create` | #478 | digit-ui-esbuild#69, #72 | Kenya 5-digit pincode pattern, AddressOne/AddressTwo populators present in bundle |
| `04-citizen-timeline` | #473 | digit-ui-esbuild#67, #70 | Star rating render after PR #64, localization keys seeded en_IN + sw_KE |
| `05-filestore` | #474 | filestore JAR patch (StorageService + CloudFileMgrUtils) | Tiny + realistic JPEG upload no longer trips `EG_FILESTORE_INPUT_ERROR` |
| `00-smoke` | n/a | n/a | API helpers reach naipepea (login, mdms, pgr, hrms, workflow) |

## Running

```bash
# from repo root
NAIPEPEA_BASE=https://naipepea.digit.org \
  npx playwright test specs/launch-fixes-2026-04-29 --reporter=list
```

## Auth model

These specs do their own oauth via the `egov-user-client:` (no-secret)
basic-auth pair — naipepea convention. They don't depend on
`auth.setup.ts`'s configurator session, so they're safe to run before
or after the manage suite.

## Filestore note

`05-filestore` requires the patched `egov-filestore-2.9.1-SNAPSHOT.jar`
on the box (StorageService.setThumbnailImages reading the original
multipart stream + null-safe finally in CloudFileMgrUtils). Without
the patch, the tiny-JPEG case stays red.
