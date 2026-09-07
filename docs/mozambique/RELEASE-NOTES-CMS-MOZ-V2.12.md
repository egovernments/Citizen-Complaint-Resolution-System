<!-- ============================================================
PASTE-READY GITHUB RELEASE
Tag:            CMS-MOZ-V2.12
Release title:  CMS Mozambique V2.12 — Fala Cidadão (Initial Official Release)
Target:         set to the commit actually running in production.
                Verify on the prod box first:
                  git -C /opt/digit-ui-esbuild log -1 --format='%H %ad %s'
                (As of 2026-09-04, production runs master@~2026-08-31 state:
                 it includes the landing/tutorial and reopen fixes, but NOT
                 the 2026-09-02 error-screen commits or later.)
Everything below this comment block is the release body — paste as-is.
============================================================ -->

# CMS Mozambique V2.12 — Fala Cidadão

**Initial official release of the CMS Mozambique product line.**
Repository: `eGov-Global/CMS-MOZAMBIQUE` · Product baseline: DIGIT Complaint Management System (`egovernments/Citizen-Complaint-Resolution-System` @ `815b2374`) · This release describes the complete Mozambique customization currently live in production.

---

## Release Overview

CMS Mozambique — **Fala Cidadão** — is the Mozambique implementation of the DIGIT Complaint Management System, serving the IGE authority (IGSAE is fully supported by the product and currently switched off by configuration for this deployment). Citizens file and track complaints in Portuguese, on the web, from any device; officers handle them through a multi-tier workflow; administrators configure the product — landing page, categories, analytics, roles, translations — from an admin console without code changes.

---

## What's Included

### For citizens
- **Public "Fala Cidadão" website** — landing page, privacy policy and tutorial (video + user manual), in Portuguese, reachable without login; every text is configurable
- **Rebuilt 3-step complaint form** — authority selection, per-authority dynamic questions, multi-level complaint categories, map location picking, file/photo/video attachments, drafts that survive a refresh, consent capture
- **Reopen & rating that route correctly** — a reopened or rated complaint goes back to the specific officer who handled it; reopen allows documents and requires an explanation; a 72-hour reopen window applies when none is configured
- **Portuguese by default** — including city-specific wording; OTP login with a m:ss resend countdown

### For municipal/authority staff
- **Configurable complaint categories (N levels)** — the classification tree is data, not code: any depth, labels in Portuguese/English, each complaint type mappable to one **or many** departments — and complaints flow correctly even when a type has no department
- **Multi-tier CMS workflow** — Reception Officer → Screening Officer → Supervisor → Case Manager, fully configuration-driven; action screens adapt to whatever workflow a tenant defines
- **Visibility scoping** — staff can be limited to their own department and/or geographic jurisdiction (including everything under their boundary); reception staff see the complaints they filed, with an "only my complaints" toggle
- **Admin cross-department search** — one screen (SUPERUSER/CMS_ADMIN) to search all complaints, filter, and export to Excel
- **Confidential complaints** — complainant identity masked on screen; selected fields (e.g. institution name) remain visible by configuration
- **Attachments everywhere** — evidence can be added on every workflow action and is shown step-by-step in the complaint timeline; video/audio play in the browser
- **Channel of receipt** — in-person, email, letter, Linha Verde recorded on employee-filed complaints

### For administrators & operators
- **Visual Landing Page Builder** — edit the public homepage by drag-and-drop with live preview, no code release
- **Configurable analytics (off by default)** — point the portal at Matomo/GA4/PostHog or a custom destination from the admin screens; one-command self-hosted Matomo provisioning; strict safety rails (host allowlist, PII scrubbing, kill switch)
- **Admin console improvements** — role-actions editable from the UI, sensitive masters gated by role, translations propagate immediately on save, console boots in the environment's language, testing-tenant flag with guard rails
- **Hierarchy management & migration** — the complaint classification tree is managed in the admin console (searchable tree view), including a guided migration that upgrades an existing 2-level tenant to the N-level model
- **Operator tooling** — `ccrs-migrate.cjs` one-command idempotent tenant migration (schemas, hierarchy, localization, CMS roles/workflow, banner, gzip, Matomo); escalation enablement script + runbook; password-gated `/digit-ui-test` entrance (default off); HTTPS/Let's Encrypt guide; CI security scanning with a findings dashboard
- **Notifications for Mozambique's infrastructure** — SMS via the Ozeki gateway; a direct-delivery mode that runs without the Novu stack on small servers; a dedicated OTP delivery pipeline; deep-link placeholders (`{website}`, `{rate_link}`, `{reopen_link}`)

---

### Coming next

- **Mobile app (Android / iOS):** a Flutter WebView wrapper of the Fala Cidadão portal has been merged into the repository (`mobile/`) and will be deployed shortly after this release. Everything about it is configuration-driven (portal URL, app name, colours — `mobile/assets/config/app_config.json`); it is not part of this release tag.

---

## Changes by Area (summary)

| Area | Highlights |
|---|---|
| **Backend (pgr-services)** | Department/jurisdiction-scoped search (opt-in, incl. boundary subtrees) · admin cross-department search endpoint · `createdBy` filter · selective confidential-field visibility (`x-no-mask`) · configurable escalation states · new intake channels · notification recipient/department fixes · acting-employee & deep-link placeholders · sort by last-modified · scope-bypass hardening |
| **Backend (novu-bridge)** | Ozeki SMS (complaints + OTP) · direct SMS/Email delivery without Novu · OTP pipeline |
| **Frontend (citizen)** | Public landing/privacy/tutorial · 3-step wizard with dynamic fields · reopen/rate routing + data-loss fix · attachments & media playback · Portuguese-first with city wording overlays |
| **Frontend (employee)** | Workflow-driven action modals · reception inbox scoping · confidential masking · admin search screen · channel chips · Fala Cidadão branding with MDMS-driven theme colours |
| **Complaint classification** | Fixed 2-level model → N-level hierarchy defined as data · one-to-many department mapping · full operation without a department · routed department preserved across reopen/rate · localized category labels |
| **Workflow** | CMS multi-tier BusinessService (11 states/18 actions) selected per deployment · escalation runbook + enablement script |
| **Configuration / MDMS** | New masters: complaint dispatcher & templates, extended-attribute schemas (IGE/IGSAE), landing page, analytics providers, privacy policy, tenant banner · all new backend settings opt-in with safe defaults |
| **Roles** | 13 new roles (CMS officer chain, scope roles, permission roles) + ~2,180 grant lines |
| **Localization** | Full pt_PT packs seeded per tenant · pt_PT default honoured on first load · configurator localized |
| **Deployment** | gzip + no-cache on the UI bundle · unified migration runner · testing entrance · default-data-handler retired (seeds moved to the DB dump) · security-scanning CI (report-only) |

All new capabilities are **opt-in with off/empty defaults** — a stock deployment is unaffected until each feature is deliberately enabled.

---

## Fixes and Improvements

- Reopen/rate no longer wipes the complaint's routed department (data-loss fix, plus a stale-cache follow-up)
- Complaint-details and employee-create crashes fixed
- Map: reverse-geocode infinite loop fixed; ward tooltip HTML-escaped (XSS); boundaries resolve at the selected authority's tenant
- Boundary picker works on first visit; addresses read as real place names; postal-code input retired
- Videos/audio attachments play instead of rendering as broken images (including an upstream CSS bug fix)
- Login screens no longer double-translate; language selector restored; logout goes to the right screen
- Notification recipient resolves the newest workflow step; department display no longer errors
- MDMS caching moved to IndexedDB (fixes browser storage-quota failures); reference data cached between pages

---

## Testing / UAT

- Functional flows exercised on the UAT environment (`cms-pilot.digit.org`): citizen creation, the full assignment chain, resolve/reopen/rate, notification delivery, document upload/retrieval, dashboard rendering.
- Automated coverage: 19 test files across the delta, concentrated in analytics (786-line suite), backend scoping and direct notification delivery. Workflow transitions, localization and roles rely on manual validation.
- A formal UAT sign-off record is not kept in the repository.

---

## Known Limitations

1. **OTP enablement flag does not de-mock the gateway** — `enable_otp_services: true` starts the real OTP services but Kong keeps routing `/user-otp` and `/otp` to mock responders; removing the mock is currently a manual gateway edit. Fix scheduled product-side.
2. **New-citizen registration second-OTP failure** — on ansible/compose deployments, registration triggers a second validation of an already-consumed OTP. The correction (`CITIZEN_REGISTRATION_WITHLOGIN_ENABLED=true`, `OTP_VALIDATION_REGISTER_MANDATORY=false` on the user service) is applied on the live environment and already templated on the Helm path; it still needs to be committed to the compose/ansible path.
3. **Deployment requires the default bootstrap password** — several deploy steps hardcode the default credential; changing bootstrap secrets currently breaks a full deploy. Sweep scheduled product-side.
4. **Confidential-complaint masking is a display control** — masked values are hidden on screen; API-level masking gated on `CONFIDENTIAL_COMPLAINT_VIEWER` is not yet wired end-to-end.
5. **Three roles need manual registration after deploy** — `CMS_ADMIN`, `CMS_DASHBOARD_VIEWER`, `CONFIDENTIAL_COMPLAINT_VIEWER` are not auto-registered by the migration runner.
6. **No dashboard geography drill-down** in this release.
7. **Notification templates for the CMS workflow's new states** may be incomplete; transitions through those states can send nothing.
8. **IGSAE authority is switched off by configuration** for this deployment (product functionality retained; re-enable via MDMS when required).
9. Admin search shows the result count as "N+" until the last page (backend count echo); rating retries once without an assignee where the workflow engine rejects it (accepted behaviour).

---

## Upgrade / Deployment Notes

- **Fresh tenant / environment:** deploy, then run `node docs/migration/ccrs-migrate.cjs` (idempotent; never overwrites existing localization or master rows), then register the three roles from Known Limitation 5.
- **Environments provisioned before the default-data-handler retirement** must run the migration runner to receive the analytics schema and CMS grants (seeds moved to `local-setup/db/full-dump.sql`).
- After any localization upsert, evict the localization cache (`docker exec digit-redis redis-cli DEL computedMessages messages`) or the UI serves stale text.
- A new/changed workflow BusinessService requires an `egov-workflow-v2` restart (service caches definitions).
- Optional features (escalation, testing entrance, analytics, Ozeki/direct notifications) each have a documented enablement path: `local-setup/scripts/enable-escalation.sh`, `docs/pgr-escalation/RUNBOOK.md`, `docs/analytics-guide/`, `docs/ops/digit-ui-compression.md`.
- No database migration is required by this release.

---

## Documentation

- [Mozambique customization record](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/mozambique-customizations.md)
- [Release audit / evidence document](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/mozambique/RELEASE-PREVIEW-CMS-MOZ-V2.12.md) — full product-baseline comparison behind these notes
- [Migration runner guide](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/migration/README.md) — `ccrs-migrate.cjs`
- [Analytics setup & self-hosted Matomo](https://github.com/eGov-Global/CMS-MOZAMBIQUE/tree/master/docs/analytics-guide)
- [Escalation enablement runbook](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/pgr-escalation/RUNBOOK.md)
- [HTTPS with Let's Encrypt](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/enabling-https-with-letsencrypt.md)
- [PRD / solution design](https://github.com/eGov-Global/CMS-MOZAMBIQUE/tree/master/docs/superpowers/specs/mozambique-prd)
- [Mobile app configuration](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/mobile/assets/config/app_config.json) — portal URL, branding

<!-- ============================================================
END OF RELEASE BODY

When you are ready to actually cut the release:

1. Identify the live commit on the prod box:
     git -C /opt/digit-ui-esbuild log -1 --format='%H %ad %s'

2. Create the annotated tag at that commit and push it:
     git tag -a CMS-MOZ-V2.12 <COMMIT_SHA> -m "CMS Mozambique V2.12 - initial official release (Fala Cidadao)"
     git push origin CMS-MOZ-V2.12

3. Create the GitHub release with this body:
     gh release create CMS-MOZ-V2.12 \
       --repo eGov-Global/CMS-MOZAMBIQUE \
       --title "CMS Mozambique V2.12 — Fala Cidadão (Initial Official Release)" \
       --notes-file docs/mozambique/RELEASE-NOTES-CMS-MOZ-V2.12.md
   (strip these HTML comment blocks first, or paste the body via the web UI)

Full evidence & internal detail: RELEASE-PREVIEW-CMS-MOZ-V2.12.md (Revision 3, in this folder)
============================================================ -->
