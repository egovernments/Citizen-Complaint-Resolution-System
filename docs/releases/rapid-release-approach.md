# CCRS Rapid Release Approach

**Status:** Accepted (Sprint Goal 2) · **Last updated:** 2026-05-29

CCRS is becoming a multi-tenant SaaS product, so we need a repeatable release process
rather than bespoke per-county installs. This extends the workflow proposed on the
channel with an explicit cadence, a versioning/promotion model, and quality gates.

## Proposal (recap)

> - `egov/ccrs` `develop` is trunk; cut feature/fix branches, merge with 1 review.
> - Nightly builds + deploys to dev (bomet) off `develop`, auto-rollback on break.
> - Nai Pepea built off a release tag as the demo-able, stable instance.
> - eGov servers host a self-hosted GHA runner for scheduled + triggered builds and tests.
> - Rebase bomet & Nai Pepea onto `develop` (both predate the merger) and validate.

## 1. Branching

- **`develop` is trunk** and always releasable.
- **Short-lived branches** — `feature/<slug>`, `fix/<slug>`, `chore/<slug>` — merged
  back within days behind **one review + green CI**. Squash-merge.
- **Feature flags** (config/MDMS or env toggle) for incomplete work, so trunk keeps
  moving and deploy is decoupled from release.

```
feature/x ─┐
fix/y ─────┼──▶ develop (trunk) ──tag──▶ vX.Y.Z
chore/z ───┘
```

## 2. Environments & promotion

A build is promoted to the next environment only after it's green in the current one.

| Env | Tracks | Cadence | Purpose |
|-----|--------|---------|---------|
| **Dev — bomet** | `develop` HEAD | Nightly, automated | Proves trunk builds & deploys daily |
| **Staging — Nai Pepea** | latest release tag | Per release | Stable, demo-able reference |
| **Production — tenant(s)** | promoted release tag | Per release, gated | Paying tenants |

```
develop ──nightly──▶ bomet ──tag──▶ Nai Pepea ──promote──▶ production
```

## 3. Cadence

- **Dev (bomet):** nightly off `develop`, no human in the loop.
- **Staging (Nai Pepea):** weekly release tag (e.g. Tuesday), deployed and validated.
- **Production:** promote a validated staging release bi-weekly or on-demand per tenant
  SLA, after sign-off.

Production stays human-gated until test coverage and rollback are proven; shorten the
intervals as confidence grows.

## 4. Versioning

- **SemVer release tags** `vMAJOR.MINOR.PATCH` — PATCH (fixes, auto-promotable), MINOR
  (backward-compatible features), MAJOR (breaking changes: non-backward-compatible DB
  migration, config schema, or API contract — extra scrutiny + documented migration).
- **Tags are immutable and are the unit of deployment** to staging/prod — staging and
  tenants run a tag, never a moving branch.
- **Release notes** generated per tag from PR titles.

## 5. CI/CD (self-hosted runners)

1. **PR check** (every PR to `develop`): build, test suite (unit + `digit-integration-tests`
   E2E), lint. Required to merge.
2. **Nightly dev deploy** (off `develop`): build → deploy to bomet → smoke/E2E →
   auto-rollback on failure + alert.
3. **Release cut** (weekly or `workflow_dispatch`): tag `vX.Y.Z`, publish
   versioned images, deploy to Nai Pepea, run regression, generate notes.
4. **Production promotion** (`workflow_dispatch`, approval-gated): deploy the chosen tag
   to the tenant environment, validate, one-command rollback available.

**Rollback:** every automated deploy records the previous good tag; a failed health
check (Gatus, smoke tests) redeploys it and posts the failure. Image rollback is only
safe if migrations are backward-compatible with the prior release (expand-contract — see
§6). A release that includes a destructive/non-compatible migration is **roll-forward
only**; recovery is a hotfix, not a redeploy, and the release notes must say so.

## 6. Quality gates

- Build passes for all service images.
- Test suite passes (unit + integration). Growing `digit-integration-tests` coverage is
  the long-pole investment.
- Post-deploy smoke checks: logins, PGR lifecycle, branding/localization, health endpoints.
- DB migrations follow **expand-contract**: each release is backward-compatible with the
  previous one so an image rollback is safe within a release window. Migrations are tested
  on a restored snapshot; any non-compatible/destructive change is flagged at MAJOR and
  marked roll-forward-only.

## 7. Hotfix

1. Branch `hotfix/<slug>` off the production release tag (not `develop` HEAD).
2. Fix, review, targeted tests.
3. Tag a PATCH release, deploy to staging, validate, promote.
4. Merge back into `develop`.

## 8. Immediate action

bomet and Nai Pepea predate the merger into `egov/ccrs develop` and run pre-merger
code/config. To put them on trunk:

- [ ] Rebase **bomet** onto `develop`, redeploy, validate (logins, PGR lifecycle,
      notifications, branding). bomet already redeploys nightly via cron; upgrade that to
      the CI pipeline (off `develop`, with smoke gate + auto-rollback).
- [ ] Rebase **Nai Pepea** onto `develop`, cut the first `vX.Y.Z` release tag, redeploy
      from that tag, validate.
- [ ] Stand up the self-hosted runner(s) and land the pipelines (PR-check + nightly
      first, then release-cut + prod-promotion).

Estimate: ~1–2 evenings for the rebase + validation.

