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
- **Operator tooling** — `ccrs-migrate.cjs` one-command idempotent tenant migration (schemas, hierarchy, localization, CMS roles/workflow, banner, gzip, Matomo); escalation enablement script + runbook; password-gated `/digit-ui-test` entrance (default off); HTTPS/Let's Encrypt guide; repo-embedded deep security scanner (`security-scan/`) with a public findings dashboard
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
| **Workflow** | CMS multi-tier BusinessService (11 states/18 actions) selected per deployment · reopened complaints (rejected **or** resolved) return to the Supervisor's REFERRED queue (production workflow updated 2026-08-21) · escalation runbook + enablement script |
| **Configuration / MDMS** | New masters: complaint dispatcher & templates, extended-attribute schemas (IGE/IGSAE), landing page, analytics providers, privacy policy, tenant banner · all new backend settings opt-in with safe defaults |
| **Roles** | 13 new roles (CMS officer chain + permission roles) + ~2,180 grant lines |
| **Localization** | Full pt_PT packs seeded per tenant · pt_PT default honoured on first load · configurator localized |
| **Deployment** | gzip + no-cache on the UI bundle · unified migration runner · testing entrance · default-data-handler retired (seeds moved to the DB dump) · self-contained security scanner (repo-embedded, report-only, public dashboard) · Grafana requires login (anonymous access disabled) |

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
- Grafana requires login — anonymous access disabled, standard role model

---

## Testing / UAT

- Functional flows exercised on the UAT environment (`cms-pilot.digit.org`): citizen creation, the full assignment chain, resolve/reopen/rate, notification delivery, document upload/retrieval, dashboard rendering.
- Automated suites (run against `master`, 2026-09-08): frontend unit **51/51** + product **234/234** pass; configurator **137/137** tests pass; Playwright integration suite counts **281 tests in 100 files** (smoke: 5/6 on the local box — the miss is a seed gap the suite itself flags, not an app bug). Suite locations, run commands, prerequisites and recorded CI results are in the [technical reference, §15](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/mozambique/RELEASE-PREVIEW-CMS-MOZ-V2.12.md#15-testing-status).
- Workflow transitions, localization completeness and role assignments still rely primarily on manual validation; a formal UAT sign-off record is not kept in the repository.

---

## Known Limitations

1. **Deployment requires the default bootstrap password** — several deploy steps hardcode the default credential; changing bootstrap secrets currently breaks a full deploy. Sweep scheduled product-side.
2. **Confidential-complaint field masking is enforced at the API** — every complaint read path and the update response mask the confidential fields (`extendedAttributes`) to `****` server-side unless the caller is the complainant or holds a role in `ComplaintTemplateType.allowedViewerRoles` (default `CONFIDENTIAL_COMPLAINT_VIEWER`); configured `x-no-mask` fields (e.g. institution name) stay visible. The complainant identity block (name/mobile/typed address) is masked on employee screens as a display control — API-level masking of that block is the remaining gap.
3. **Three roles need manual registration after deploy** — `CMS_ADMIN`, `CMS_DASHBOARD_VIEWER`, `CONFIDENTIAL_COMPLAINT_VIEWER` are not auto-registered by the migration runner (it registers the five workflow roles). Already registered on the production environment.
4. **Notification templates** are seeded for apply/assign/reassign/reject/resolve/reopen/rate; the AWAITINGINFORMATION and COMMENT transitions have none seeded and send nothing until templates are added (the admin console can add them per transition).
5. **IGSAE authority is switched off by configuration** for this deployment (product functionality retained; re-enable via MDMS when required).
6. Admin search shows the result count as "N+" until the last page (backend count echo); rating retries once without an assignee where the workflow engine rejects it (accepted behaviour).

---

## Upgrade / Deployment Notes

- **Fresh tenant / environment:** deploy, then run `node docs/migration/ccrs-migrate.cjs` (idempotent; never overwrites existing localization or master rows), then register the three roles from Known Limitation 5.
- **Environments provisioned before the default-data-handler retirement** must run the migration runner to receive the analytics schema and CMS grants (seeds moved to `local-setup/db/full-dump.sql`).
- After any localization upsert, evict the localization cache (`docker exec digit-redis redis-cli DEL computedMessages messages`) or the UI serves stale text.
- A new/changed workflow BusinessService requires an `egov-workflow-v2` restart (service caches definitions).
- The production workflow was updated in place on 2026-08-21 (reopening a **resolved** complaint now routes to the Supervisor's REFERRED queue). The seeded `CmsPgrWorkflowConfig.json` still carries the original transition — align a fresh deployment's workflow with production before go-live.
- Optional features (escalation, testing entrance, analytics, Ozeki/direct notifications) each have a documented enablement path: `local-setup/scripts/enable-escalation.sh`, `docs/pgr-escalation/RUNBOOK.md`, `docs/analytics-guide/`, `docs/ops/digit-ui-compression.md`.
- No database migration is required by this release.

---

## Container Image Inventory

The image versions this release runs, captured from the live production deployment on 2026-09-09. Use this as the authoritative pin list when reproducing or upgrading an environment.

### CMS application services

| Container | Image |
|---|---|
| pgr-services | `egovio/pgr-services:master-df7ca8d` |
| digit-ui | `egovio/digit-ui-esbuild:master-cae07a3` |
| configurator | `egovio/configurator:master-cae07a3` |
| digit-config-service | `egovio/digit-config-service:2.12-beta-96dcf10` |
| digit-user-preferences-service | `egovio/digit-user-preferences-service:2.12-beta-96dcf10` |
| digit-mcp | `digit-mcp:local` |
| digit-mcp-postgres | `postgres:16-alpine` |
| rest-adapter | `rest-adapter:current` |
| otp-publisher | `otp-publisher:local` |

### DIGIT platform services

| Container | Image |
|---|---|
| egov-user | `egovio/egov-user:2.12-87e13fe` |
| egov-workflow-v2 | `egovio/egov-workflow-v2:2.12-87e13fe` |
| egov-localization | `egovio/egov-localization:2.12-87e13fe` |
| egov-enc-service | `egovio/egov-enc-service:2.12-87e13fe` |
| egov-hrms | `egovio/egov-hrms:2.12-beta-dd641a6` |
| mdms-backend (mdms-v2) | `egovio/mdms-v2:maven-jdk21-9f83afb` |
| egov-filestore | `egovio/egov-filestore:maven-jdk21-9f83afb` |
| boundary-service | `egovio/boundary-service:maven-jdk21-9f83afb` |
| egov-idgen | `egovio/egov-idgen:maven-jdk21-9f83afb` |
| egov-persister | `egovio/egov-persister:maven-jdk21-9f83afb` |
| egov-accesscontrol | `egovio/egov-accesscontrol:maven-jdk21-9f83afb` |
| egov-bndry-mgmnt | `egovio/egov-bndry-mgmnt:bndry-mgmnt-3794b8c` |
| egov-url-shortening | `egovio/egov-url-shortening:maven-jdk21-983e8b2` |
| egov-otp | `egovio/egov-otp:v2.9.2-4a60f20` |
| audit-service | `egovio/audit-service:v2.9.2-4a60f20` |
| user-otp | `egovio/user-otp:master-e22c7c5` |
| egov-notification-sms | `egovio/egov-notification-sms:master-e22c7c5` |
| egov-user-proxy / egov-workflow-proxy / egov-mdms-service | `egovio/nginx:alpine` |

### Gateway & data infrastructure

| Container | Image |
|---|---|
| kong-gateway | `egovio/kong:3.6` |
| postgres | `egovio/postgres:16` |
| pgbouncer | `egovio/pgbouncer:latest` |
| redis | `egovio/redis:7.2.4` |
| redpanda | `egovio/redpanda:v24.1.1` |
| minio | `egovio/minio:RELEASE.2024-01-16T16-07-38Z` |
| openbao | `openbao/openbao:latest` |

### Notifications (Novu)

| Container | Image |
|---|---|
| novu-api | `ghcr.io/novuhq/novu/api:2.3.0` |
| novu-worker | `ghcr.io/novuhq/novu/worker:2.3.0` |
| novu-ws | `ghcr.io/novuhq/novu/ws:2.3.0` |
| novu-dashboard | `ghcr.io/novuhq/novu/dashboard:2.3.0` |
| novu-mongo | `mongo:8.0.3` |
| novu-bridge | `egovio/novu-bridge:develop-2cf2660` |
| novu-bridge-endpoint | `egovio/novu-bridge-endpoint:latest` |

### Analytics & observability

| Container | Image |
|---|---|
| matomo | `matomo:5-apache` |
| matomo-db | `mariadb:11.4` |
| grafana | `egovio/grafana:11.4.0` |
| prometheus | `prom/prometheus:v2.55.1` |
| loki | `grafana/loki:3.4.2` |
| promtail | `grafana/promtail:3.4.2` |
| tempo | `egovio/tempo:2.6.1` |
| node-exporter | `prom/node-exporter:v1.8.2` |
| otel-collector | `egovio/opentelemetry-collector-contrib:0.114.0` |
| gatus | `egovio/gatus:latest` |
| jupyter (ops tooling) | `egovio/tilt-demo-jupyter:latest` |

> Note: a few images run under floating or locally-built tags (`:latest`, `:local`, `:current` — pgbouncer, openbao, gatus, novu-bridge-endpoint, jupyter, digit-mcp, otp-publisher, rest-adapter). When rebuilding an environment to match this release, pin these to the digests running in production rather than re-pulling the tag.

---

## Documentation

- [Mozambique customization record](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/mozambique-customizations.md)
- [Release audit / evidence document](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/mozambique/RELEASE-PREVIEW-CMS-MOZ-V2.12.md) — full product-baseline comparison behind these notes
- [Migration runner guide](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/migration/README.md) — `ccrs-migrate.cjs`
- [Localization workbook](https://docs.google.com/spreadsheets/d/1u_pWLayblgs7VVsuIifK14GHAD0DFMi3/edit?usp=sharing&rtpof=true&sd=true) — master translation Excel sheet (pt_PT / en_IN)
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
