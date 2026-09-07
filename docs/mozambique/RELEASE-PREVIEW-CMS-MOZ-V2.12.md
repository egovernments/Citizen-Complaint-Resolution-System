# CMS Mozambique V2.12 — Release Documentation (Technical Reference)

This is the detailed technical companion to the **[V2.12 Release Notes](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/mozambique/RELEASE-NOTES-CMS-MOZ-V2.12.md)**. It documents, with evidence, everything Mozambique customized on top of the DIGIT Complaint Management System product — for developers, testers, project managers and reviewers who need the complete picture.

Every commit reference below is a working link into this repository.

---

## Contents

1. [About This Release](#1-about-this-release)
2. [Headline Customizations](#2-headline-customizations)
3. [Backend Changes](#3-backend-changes)
4. [Frontend Changes](#4-frontend-changes)
5. [Complaint Classification Hierarchy (2 Levels → N Levels)](#5-complaint-classification-hierarchy-2-levels--n-levels)
6. [Workflow Changes](#6-workflow-changes)
7. [Configuration & Master Data (MDMS)](#7-configuration--master-data-mdms)
8. [Localization](#8-localization)
9. [Roles & Permissions](#9-roles--permissions)
10. [Integrations](#10-integrations)
11. [Fixes & Improvements](#11-fixes--improvements)
12. [Commit Summary](#12-commit-summary)
13. [Customization Matrix — Product vs Mozambique](#13-customization-matrix--product-vs-mozambique)
14. [Known Technical Issues (under product review)](#14-known-technical-issues-under-product-review)
15. [Testing Status](#15-testing-status)
16. [Known Limitations & Product Decisions](#16-known-limitations--product-decisions)
17. [Documentation](#17-documentation)

---

## 1. About This Release

**CMS Mozambique — Fala Cidadão** is the Mozambique implementation of the DIGIT Complaint Management System, serving the IGE authority. Citizens file and track complaints in Portuguese from any device; officers handle them through a multi-tier workflow; administrators configure the product from an admin console without code changes.

| Fact | Value |
|---|---|
| Release | **CMS-MOZ-V2.12** — initial official release of the Mozambique product line |
| Repository | [`eGov-Global/CMS-MOZAMBIQUE`](https://github.com/eGov-Global/CMS-MOZAMBIQUE), branch `master` |
| Product baseline | [`egovernments/Citizen-Complaint-Resolution-System`](https://github.com/egovernments/Citizen-Complaint-Resolution-System) @ [`815b2374`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/815b2374) (last shared upstream commit, 2026-08-13) |
| Customization delta | 658 commits · 343 files · +44,876 / −3,117 lines · 2026-06-12 → 2026-09-03 |
| Areas touched | frontend 139 files · configurator 61 · backend 40 · docs 32 · deployment 27 · seeders 25 · CI 15 · tests 2 |
| Database migrations added | **0** — the database schema is identical to the upstream product |
| Defaults | every new capability is opt-in with off/empty defaults; a stock deployment is unaffected until a feature is deliberately enabled |

---

## 2. Headline Customizations

The eleven changes that most define this product versus stock DIGIT:

1. **Public "Fala Cidadão" website** — a real public homepage, privacy-policy and tutorial pages in Portuguese, reachable without login, fully content-configurable and visually editable from the admin console ([`ccd8b576`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ccd8b576), [`0737156a`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0737156a), [`0dce489b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0dce489b), [`cec2b6fe`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/cec2b6fe))
2. **Multi-tier CMS workflow** — Reception Officer → Screening Officer → Supervisor → Case Manager; the employee action screens build themselves from the workflow definition, so the chain is configuration, not code ([`772a5986`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/772a5986), [`bffdce15`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/bffdce15))
3. **Configurable complaint classification (N levels)** — the fixed 2-level type/subtype model became an N-level hierarchy defined entirely as data, with department mapping per complaint type evolved from one-to-one to one-to-many — and complaints route correctly even when a type has **no** department ([`0c1123c8`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0c1123c8), [`394e6136`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/394e6136), [`3289ac3f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/3289ac3f))
4. **Visibility scoping** — employees can be restricted to their own department and/or geographic jurisdiction (including everything under their boundary); reception staff see the complaints they filed ([`fe7cab60`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/fe7cab60), [`9e650397`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/9e650397), [`79dae4ef`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/79dae4ef), [`74eac21c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/74eac21c))
5. **Admin cross-department search** — one screen for SUPERUSER/CMS_ADMIN to search everything, with filters and Excel export ([`dae9ec08`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/dae9ec08), [`8da74a9e`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8da74a9e))
6. **Confidential complaints** — complainant identity masked on employee screens; selected fields (e.g. institution name) stay visible via configuration ([`992735af`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/992735af), [`8746bcab`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8746bcab))
7. **Rebuilt citizen complaint form** — 3-step wizard, authority picker, per-authority dynamic questions from MDMS, multi-level complaint categories, drafts, consent ([`81054330`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/81054330), [`be6c9eaa`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/be6c9eaa))
8. **Portuguese product** — pt_PT as the default language, full translation packs seeded per tenant, city-level wording overlays, Fala Cidadão branding with configuration-driven theme colours ([`21a6f1f2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/21a6f1f2), [`f42ad659`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f42ad659), [`954e134d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/954e134d), [`9597f0ab`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/9597f0ab))
9. **Notifications for Mozambique's infrastructure** — SMS via the Ozeki gateway, a direct-delivery mode that runs without the Novu stack, an OTP delivery pipeline, deep-link placeholders ([`a95f8df2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a95f8df2), [`91aded4c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/91aded4c), [`a3be88e5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a3be88e5), [`15ec1db5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/15ec1db5))
10. **Analytics, off by default** — analytics destinations (Matomo/GA4/PostHog/custom) configured as data, with strict safety rails; one-command self-hosted Matomo ([`e9a0f0e4`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e9a0f0e4), [`1fd0711e`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1fd0711e), [`1abef50f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1abef50f))
11. **Operator tooling** — one-command tenant migration, escalation enablement, testing entrance, CI security scanning ([`16b91133`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/16b91133), [`718d65b1`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/718d65b1), [`06ee871e`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/06ee871e), [`bc0ecdac`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/bc0ecdac))

---

## 3. Backend Changes

### pgr-services (complaint engine)

| Change | What it means | Commit |
|---|---|---|
| Department-scoped search | Configured roles see only their department's complaints | [`fe7cab60`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/fe7cab60) |
| Jurisdiction-scoped search | Configured roles see only their geographic area — including every locality **under** their boundary (subtree matching) | [`9e650397`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/9e650397), [`79dae4ef`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/79dae4ef) |
| Admin cross-department search API | New `POST /v2/request/_admin/_search` returning rows + count in one call | [`dae9ec08`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/dae9ec08) |
| "Filed on behalf of" filter | Search by who actually filed the complaint (`createdBy`) — powers the reception-officer inbox | [`1f9b68a2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1f9b68a2) |
| Department search field | Complaints can be filtered by department on the ordinary search | [`4a6537c3`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4a6537c3) |
| Selective confidential-field visibility | Chosen fields stay readable on confidential complaints (`x-no-mask`) | [`8746bcab`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8746bcab) |
| Configurable escalation states | Which statuses the auto-escalation job scans is deployment configuration | [`718d65b1`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/718d65b1) |
| New intake channels | email / in-person / letter / Linha Verde accepted as complaint sources | [`b2272873`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/b2272873) |
| Notification recipient fix | Notifications resolve the newest workflow step, not the first match | [`f05c52d5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f05c52d5) |
| Terminal transition fix | An assignee no longer breaks closing transitions | [`f05c52d5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f05c52d5) |
| Department display in notifications | Three-tier fallback so department names never error or show blank | [`4fa8964c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4fa8964c) |
| Acting-employee placeholders | Templates can name the person who performed an action | [`4fa8964c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4fa8964c) |
| Deep-link placeholders | `{website}`, `{rate_link}`, `{reopen_link}` for SMS/WhatsApp templates | [`15ec1db5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/15ec1db5) |
| Sort by last-modified | New search sort option | [`1f9b68a2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1f9b68a2) |
| Scope-bypass hardening | Internal scoping flags cannot be set through the public API | [`9e650397`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/9e650397) |

### novu-bridge (notifications)

| Change | What it means | Commit |
|---|---|---|
| Direct delivery mode | SMS (straight to the Ozeki gateway) and Email (SMTP) without running the Novu stack — for resource-constrained servers | [`91aded4c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/91aded4c) |
| Ozeki SMS provider via Novu | Complaint SMS and OTP SMS each independently routable through Ozeki | [`a95f8df2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a95f8df2), [`a3be88e5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a3be88e5) |
| OTP delivery pipeline | Login codes delivered before a citizen has an account | [`a3be88e5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a3be88e5) |
| OTP message wording | Expiry text changed from 10 to 5 minutes (message text; the actual code lifetime is enforced by the platform OTP service) | [`0ac4b3f0`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0ac4b3f0) |

**Good to know:** the analytics/KPI dashboard engine (`org.egov.pgr.analytics`, 32 files) is upstream product code — not a Mozambique customization. All new backend settings default to off/empty.

---

## 4. Frontend Changes

The frontend is the largest customization area (139 files, +12,782/−1,292):

| # | Feature | Type | Key commits |
|---|---|---|---|
| 1 | Public landing site + privacy + tutorial pages (33 new files) | New | [`ccd8b576`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ccd8b576), [`0dce489b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0dce489b), [`cec2b6fe`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/cec2b6fe) |
| 2 | Analytics loader (default-off, PII-scrubbed, 786-line test suite) | New | [`e9a0f0e4`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e9a0f0e4), [`4a2e8117`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4a2e8117) |
| 3 | Admin cross-department search screen + Excel export | New | [`a0e18a4b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a0e18a4b), [`8da74a9e`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8da74a9e), [`ec222582`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ec222582) |
| 4 | Workflow-driven employee action modals (enables the CMS tiers) | Modified | [`772a5986`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/772a5986), [`aa500b8d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/aa500b8d) |
| 5 | History-derived routing — reopen returns to the Supervisor, rate to the Case Manager who handled the case | New | [`adbf2da4`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/adbf2da4), [`4d268d8f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4d268d8f) |
| 6 | Reception-officer inbox scoping + "only my complaints" filter | New | [`74eac21c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/74eac21c), [`46d9081d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/46d9081d) |
| 7 | Confidential-complaint masking on details and timeline | New | [`992735af`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/992735af), [`c0c6f30b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/c0c6f30b) |
| 8 | Attachments everywhere: shared uploader, video/audio playback, per-step timeline evidence | New / Fix | [`6bf0084a`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/6bf0084a), [`e81431c2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e81431c2), [`721e44c8`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/721e44c8) |
| 9 | Citizen create wizard rebuild — 3 steps, category hierarchy, dynamic fields, drafts | Modified | [`81054330`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/81054330), [`be6c9eaa`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/be6c9eaa) |
| 10 | Reopen/rating overhaul — routing data preserved (data-loss fix), 72-hour window, mandatory reason | Fix | [`92eaec23`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/92eaec23), [`2debbcfc`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/2debbcfc), [`8597982d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8597982d) |
| 11 | Localization mechanics — city wording overlays, default language honoured, raw-key guards | Modified | [`3289ac3f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/3289ac3f), [`812b36b8`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/812b36b8) |
| 12 | Branding — Fala Cidadão name/emblem/favicon; theme colours driven by configuration | Modified | [`954e134d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/954e134d), [`11c372d8`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/11c372d8) |
| 13 | Maps — boundaries at the selected authority's tenant, geocode loop guard, safe tooltips | Fix | [`62335750`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/62335750), [`60c5198c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/60c5198c), [`8c1120f9`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8c1120f9) |
| 14 | Boundary picker reliability + human-readable addresses; postal-code input retired | Fix | [`da545a8a`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/da545a8a), [`4aa5aa3b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4aa5aa3b) |
| 15 | Channel-of-receipt chips on the employee create form | New | [`6de45287`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/6de45287) |
| 16 | Dashboard — breadcrumb and page gutter when embedded | Fix | [`aeea2cd4`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/aeea2cd4) |
| 17 | Testing-tenant scoping (`isTestingTenant` → separate `/digit-ui-test` entrance) | New | [`d83aa600`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/d83aa600), [`7423ae44`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/7423ae44) |
| 18 | Citizen navigation — single-module sidebar, profile avatar, correct logout destination | Modified | [`7a1afeeb`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/7a1afeeb), [`295b0756`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/295b0756) |
| 19 | Error screens — clear button wording, image fallback, corrected layout | Fix | [`20ef8760`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/20ef8760), [`01446716`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/01446716) |
| 20 | Login/OTP — 120-second resend shown as a m:ss countdown, country code passed, tenant scoping | Modified | [`8fda161f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8fda161f), [`04ba4806`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/04ba4806), [`78ccee51`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/78ccee51) |
| 21 | Performance — request-cache fix, IndexedDB persistence for master data, staff-list caching | Fix | [`ba8a7c27`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ba8a7c27), [`5a096d23`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/5a096d23) |

---

## 5. Complaint Classification Hierarchy (2 Levels → N Levels)

### What changed

The DIGIT product historically classified every complaint on a **fixed two-level** model — complaint type → subtype — and each complaint type was mapped to exactly **one** department (a single text field). Mozambique needed deeper, per-authority classification trees and more flexible department routing, so the model was redesigned:

- **N-level hierarchy as data.** Two masters replace the fixed model: `ComplaintHierarchyDefinition` (how many levels a tenant has and what each level is called) and `ComplaintHierarchy` (the tree of nodes). Any depth works; the citizen wizard renders one picker per level automatically.
- **Department mapping: one-to-one → one-to-many.** A complaint type can now map to **several departments** (`departments` list and the `ComplaintTypeDepartments` master) instead of a single department string; the old field is kept for backward compatibility.
- **Works with no department at all.** A complaint type that maps to no department still flows end-to-end — nothing blocks creation, assignment or resolution.
- **Admin management + migration.** The admin console manages the tree (list/create/show, including a searchable collapsible view) and offers a **guided migration** that upgrades an existing 2-level tenant to the N-level model; operator tooling ([migration guide](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/migration/complaint-type-2level-to-Nlevel.md), [operator runbook](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/migration/operator-runbook.md), dry-run + migrator scripts) covers the cutover.

This foundation was built under the Mozambique programme and adopted into the core DIGIT product (it is part of the product baseline this release builds on). It is documented here because it is central to how CMS Mozambique works and because this release carries substantial work on top of it.

### What this release adds on top

| Change | What it means | Commit |
|---|---|---|
| Routed-department stamping | The department chosen at assignment is stamped on the complaint and every later assignee list is scoped by that **routed** department, not re-derived from the type | [`0c1123c8`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0c1123c8) |
| No-department operation | For types with no/unmapped department: the assignee dropdown explains the situation instead of appearing broken, and the assignee becomes optional on ASSIGN (the screening step stays mandatory) | [`394e6136`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/394e6136), [`af818c2d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/af818c2d) |
| Department survives reopen/rate | Reopening or rating a complaint **merges** its details instead of replacing them, so the routed department is preserved — previously it was wiped, hiding the complaint from department-scoped supervisors | [`92eaec23`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/92eaec23), [`2debbcfc`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/2debbcfc) |
| Department names in notifications | Notification templates resolve the department with a three-tier fallback (hierarchy mapping → department stamped on the complaint → assignee's department) instead of erroring | [`4fa8964c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4fa8964c) |
| Localized hierarchy labels | Category names are localization keys (`COMPLAINT_HIERARCHY.*`) following the key-in-name convention, with city-tenant wording overlays — so trees read correctly in Portuguese and per city | [`23326ca2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/23326ca2), [`3289ac3f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/3289ac3f) |
| Leaf-type titles | Citizen complaint cards are titled by the most specific (leaf) category instead of the top level | [`d109187b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/d109187b) |
| Correct tenant resolution | The hierarchy is fetched at the **complaint's** tenant (not the logged-in tenant), fixing wrong or empty trees on multi-authority environments | [`5a096d23`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/5a096d23), [`9a29c3de`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/9a29c3de) |
| Wizard integration | The citizen create wizard renders the hierarchy pickers with draft persistence across navigation and refresh | [`a3365a70`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a3365a70) |
| Seeding & migration phase | The unified migration runner (`ccrs-migrate.cjs`) seeds and verifies the hierarchy as one of its phases | [`16b91133`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/16b91133) |
| Design record | Spec for the `category` / `authority` MIS fields and the many-to-many department master: [complaint-hierarchy-withnew-parameters.md](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/complaint-hierarchy-withnew-parameters.md) | — |

### Downstream effects (workflow & pgr-services)

The hierarchy + department redesign ripples through the rest of the system, which is why several changes in other sections exist:

- **Workflow assignment** — assignee dropdowns are scoped by the routed department and widen automatically for cross-department roles; an explicit "no eligible employee" message replaces an empty dropdown ([`aa500b8d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/aa500b8d))
- **Search & visibility** — department-scoped employee search reads the same department stamp, so scoping and routing stay consistent ([`fe7cab60`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/fe7cab60), [`4a6537c3`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4a6537c3))
- **Notifications** — department placeholders resolve through the hierarchy mapping first ([`4fa8964c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4fa8964c))
- **Dashboards** — the product's analytics grain follows the hierarchy (materialized views were repointed to `ComplaintHierarchy` in the core product)

---

## 6. Workflow Changes

- **New CMS multi-tier workflow** ([`CmsPgrWorkflowConfig.json`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/utilities/default-data-handler/src/main/resources/CmsPgrWorkflowConfig.json), 11 states / 18 actions), selected per deployment by the `pgr.workflow.variant` setting (default `standard`) — [`bffdce15`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/bffdce15), [`d37299b4`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/d37299b4)
- **Escalation** — the scan states are configurable ([`718d65b1`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/718d65b1)); [`enable-escalation.sh`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/local-setup/scripts/enable-escalation.sh) switches escalation on for a running environment in six independent, re-runnable steps, documented in the [escalation runbook](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/pgr-escalation/RUNBOOK.md). A reopened complaint restarts its escalation clock ([`92eaec23`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/92eaec23))
- **Terminal transitions** accept an assignee where the workflow engine allows it ([`f05c52d5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f05c52d5)); where the engine still rejects one (rating a closed complaint), the frontend retries without it so the citizen is never blocked ([`43d4c8ac`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/43d4c8ac))
- **Attachments per action** — allowed on every workflow action, mandatory only where the target state demands it ([`6bf0084a`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/6bf0084a), [`7dfa7eb8`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/7dfa7eb8))

---

## 7. Configuration & Master Data (MDMS)

**New masters:** complaint authority dispatcher (`ComplaintRelatedToMap`), per-authority form templates (`ComplaintTemplateType`), dynamic-field schemas for IGE/IGSAE (`ComplaintExtendedAttributeSchema`), landing page (`LandingSection`, `LandingPageConfig`), analytics destinations (`AnalyticsProvider`), privacy policy (`commonMDMSConfig.PrivacyPolicy` — module corrected, [`c3e42214`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/c3e42214)), tenant banner image ([`00ffd59f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/00ffd59f)).

**New backend settings (all opt-in, safe defaults):** `pgr.department.scope.roles`, `pgr.jurisdiction.scope.roles`, `pgr.escalation.states`, extended `allowed.source`, boundary-relationship lookup settings, six `novu.bridge.*` keys, `egov.ui.app.host.map`.

**Admin console (Configurator):**
- Visual **Landing Page Builder** — drag-and-drop homepage editing with live preview ([`c2803e7f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/c2803e7f))
- **Analytics destinations editor** with URL/host validation and a telemetry kill switch ([`1fd0711e`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1fd0711e))
- **Write-role gating** on sensitive masters — only authorized roles see Create/Edit ([`a82a9508`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a82a9508))
- **Role-actions editable** from the UI ([`31048d69`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/31048d69), [`6135b38f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/6135b38f))
- **Testing-tenant checkbox** with guard rails against flagging a production tenant ([`0cfebb60`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0cfebb60))
- Boots in the environment's **default language** ([`833f759d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/833f759d)); translation edits **propagate immediately** on save ([`3d6fc082`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/3d6fc082))
- New JSON and object-table form widgets; seven new schema descriptors

**Operator tooling:** [`ccrs-migrate.cjs`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/migration/ccrs-migrate.cjs) — one idempotent, continue-on-error migration runner covering schemas, hierarchy, localization, CMS roles/workflow, banner, gzip and Matomo ([`16b91133`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/16b91133), [`1abef50f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1abef50f)); [`fix-citymodule.sh`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/migration/fix-citymodule.sh) repair script; Ansible tenant template; localhost-bound Matomo compose profile; password-gated testing entrance (default off).

**Deployment ordering note:** the default-data-handler service was retired from the compose stack and its seed data moved to the database dump ([`6e72eed5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/6e72eed5), [`f4d37bbd`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f4d37bbd)). Environments provisioned from older images must run the migration runner to receive the analytics schema and CMS grants.

---

## 8. Localization

- **pt_PT is a first-class locale** — full packs seeded per tenant ([`f42ad659`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f42ad659)), default for the mz tenant ([`21a6f1f2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/21a6f1f2)), honoured on first load ([`812b36b8`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/812b36b8)), admin console included ([`833f759d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/833f759d))
- **City-level wording overlay** — city translations (department names, categories, boundary headings) load and win over state-level ([`3289ac3f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/3289ac3f), [`e33e801d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e33e801d))
- **"Fala Cidadão" rebrand** of the message packs ([`9597f0ab`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/9597f0ab)); Portuguese sidebar, login/OTP, registration, rating and privacy-policy content seeded
- Numerous raw-key and double-translation fixes ([`0466b6d9`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0466b6d9), [`dd746026`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/dd746026), [`dac66d9e`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/dac66d9e))

---

## 9. Roles & Permissions

**13 new roles seeded** ([`e79f0847`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e79f0847), [`8e8c16dd`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8e8c16dd), [`bffdce15`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/bffdce15)), in three families:

| Family | Roles |
|---|---|
| Job roles | CMS_RECEPTION_OFFICER, CMS_SUPERVISOR, CMS_CASE_MANAGER, CMS_VIEWER, CMS_ADMIN, CMS_DASHBOARD_VIEWER, DGRO |
| Scope roles | CENTRAL_USER (cross-tenant read), DEPARTMENT_USER (own department) |
| Permission roles | COMPLAINTS_VIEWER, COMPLAINTS_EDITOR, COMPLAINTS_CREATOR, CONFIDENTIAL_COMPLAINT_VIEWER (unmasked confidential data) |

Approximately 2,180 lines of role-to-permission grants accompany them. (`CMS_SCREENING_OFFICER` already existed in the upstream product.)

**Points for administrators:**
- `CMS_VIEWER` is viewer-*named* but holds full write grants — do not treat it as read-only
- `CENTRAL_USER` and `CONFIDENTIAL_COMPLAINT_VIEWER` are high-privilege; assign deliberately
- Three roles (`CMS_ADMIN`, `CMS_DASHBOARD_VIEWER`, `CONFIDENTIAL_COMPLAINT_VIEWER`) are **not** auto-registered by the migration runner and need a manual post-deploy step
- The admin console's write-gating is a usability layer; server-side access control remains the real authority

---

## 10. Integrations

| Integration | Purpose | Status |
|---|---|---|
| Ozeki SMS gateway | Complaint + OTP SMS (via Novu, or direct HTTP) | New ([`a95f8df2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a95f8df2), [`91aded4c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/91aded4c)) — disabled by default |
| SMTP direct email | Email without the Novu stack | New ([`91aded4c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/91aded4c)) — disabled by default |
| Novu / Twilio WhatsApp | WhatsApp always delivers through Novu | Upstream, unchanged |
| Matomo (self-hosted) | Analytics; one-command provisioning, admin UI bound to localhost | New ([`1abef50f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1abef50f)) — opt-in |
| PostHog / GA4 / custom | Analytics destinations configured as data | New ([`e9a0f0e4`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e9a0f0e4)) — off by default |
| Nominatim / CARTO / OpenFreeMap | Geocoding + map tiles | Upstream, tuned |
| youtube-nocookie | Tutorial video streaming on the public site | New ([`cec2b6fe`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/cec2b6fe)) |

---

## 11. Fixes & Improvements

- Reopening or rating a complaint no longer wipes its routed department (data-loss fix + stale-cache follow-up) — [`92eaec23`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/92eaec23), [`2debbcfc`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/2debbcfc)
- Complaint-details crash ([`12d0a960`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/12d0a960)) and employee-create crash ([`57d6b242`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/57d6b242)) fixed
- Map: reverse-geocode infinite loop stopped ([`60c5198c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/60c5198c)); ward tooltip HTML-escaped ([`8c1120f9`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8c1120f9)); boundaries resolve at the selected authority ([`62335750`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/62335750))
- Boundary picker works on first visit ([`4e2dbb5a`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4e2dbb5a)); addresses read as real place names; postal-code input retired ([`4aa5aa3b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4aa5aa3b))
- Video/audio attachments play instead of showing as broken images ([`e81431c2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e81431c2)), including an upstream CSS bug fix ([`230cf374`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/230cf374))
- Login screens no longer double-translate ([`0466b6d9`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0466b6d9)); logout goes to the right screen ([`295b0756`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/295b0756))
- Notification recipient and department-name resolution hardened ([`f05c52d5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f05c52d5), [`4fa8964c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4fa8964c))
- Master-data caching moved to IndexedDB — fixes browser storage-quota failures; reference data no longer re-downloads on every page ([`ba8a7c27`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ba8a7c27))
- UI bundle served with gzip and sensible cache headers ([`874ec205`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/874ec205))

---

## 12. Commit Summary

**658 commits** = 255 merges + 403 non-merge; about 45 changes landed twice as cherry-pick pairs during branch synchronization, giving **~358 distinct changes**. Around 189 commits reference Jira tickets — **78 unique keys, CCSD-1914 → CCSD-2207**. The security-scanning and analytics work is tracked by GitHub PR numbers (#13–#58) instead of Jira.

| Category | Commits | Representative commits |
|---|---|---|
| Frontend — Citizen (incl. landing, login/OTP) | 57 | [`81054330`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/81054330), [`ccd8b576`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ccd8b576), [`8fda161f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8fda161f) |
| Complaint Workflow (CMS tiers, reopen, rate, confidentiality) | 52 | [`772a5986`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/772a5986), [`bffdce15`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/bffdce15), [`92eaec23`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/92eaec23) |
| Search & Scoping (department/jurisdiction/admin/createdBy) | 48 | [`fe7cab60`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/fe7cab60), [`9e650397`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/9e650397), [`dae9ec08`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/dae9ec08) |
| Frontend — Employee | 41 | [`eca8d109`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/eca8d109), [`b2272873`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/b2272873), [`468bf656`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/468bf656) |
| Onboarding / Migration tooling | 30 | [`16b91133`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/16b91133), [`852ab0a9`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/852ab0a9), [`124678e5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/124678e5) |
| Localization (pt_PT) | 28 | [`f42ad659`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f42ad659), [`3289ac3f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/3289ac3f), [`34f87acc`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/34f87acc) |
| Maps / Geolocation / Boundary | 22 | [`62335750`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/62335750), [`60c5198c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/60c5198c), [`4aa5aa3b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4aa5aa3b) |
| Dashboard & Analytics (incl. Matomo stack) | 21 | [`e9a0f0e4`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e9a0f0e4), [`1abef50f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1abef50f), [`aeea2cd4`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/aeea2cd4) |
| Configurator (Builder, testing tenant) | 20 | [`c2803e7f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/c2803e7f), [`0cfebb60`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0cfebb60), [`3d6fc082`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/3d6fc082) |
| CI / Security scanning | 19 | [`bc0ecdac`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/bc0ecdac), [`844edab5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/844edab5), [`57e28906`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/57e28906) |
| Documentation | 17 | [`ab8c3a2c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ab8c3a2c), [`48e4bc08`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/48e4bc08), [`938623bd`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/938623bd) |
| Deployment / Ops / performance | 15 | [`874ec205`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/874ec205), [`6e72eed5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/6e72eed5), [`b0d99e14`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/b0d99e14) |
| Notifications (novu-bridge, Ozeki, OTP) | 7 | [`a3be88e5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a3be88e5), [`a95f8df2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a95f8df2), [`91aded4c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/91aded4c) |
| Branding / Theming | 4 | [`954e134d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/954e134d), [`9597f0ab`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/9597f0ab) |
| Tests / Reverts / other | 22 | [`ac4ce48a`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ac4ce48a), [`ef956145`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ef956145) |

---

## 13. Customization Matrix — Product vs Mozambique

| # | Area | DIGIT Product | Mozambique Customization | Files/Module | Commit(s) |
|---|---|---|---|---|---|
| 1 | Frontend | No public page; anonymous visitors land on login | Public landing + privacy + tutorial site, configurable, Portuguese-first | `products/pgr/.../Landing/` (33 files) | [`ccd8b576`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ccd8b576), [`0dce489b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0dce489b) |
| 2 | Frontend | 5-step generic complaint form | 3-step wizard, authority dispatcher, dynamic fields, drafts, consent | `CreatePGRFlowV2.tsx` | [`81054330`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/81054330), [`22b8e38a`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/22b8e38a) |
| 3 | Frontend | Hardcoded action-modal list | Action modals built from the workflow definition | `PGRDetails.js`, `PGRWorkflowModal.js` | [`772a5986`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/772a5986) |
| 4 | Frontend | Reopen/rate route nowhere | History-derived routing to the prior Supervisor / Case Manager | `utils/workflowAssignee.js` | [`adbf2da4`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/adbf2da4), [`4d268d8f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4d268d8f) |
| 5 | Frontend | Inbox is assignee-based only | Reception inbox by filer + "only my complaints" filter | `UICustomizations.js`, `OnlyMyComplaintsFilter.js` | [`74eac21c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/74eac21c), [`46d9081d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/46d9081d) |
| 6 | Frontend | No admin-wide search | Cross-department admin search + Excel export | `AdminSearch.js` | [`a0e18a4b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a0e18a4b), [`8da74a9e`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8da74a9e) |
| 7 | Frontend | No confidentiality display rules | Identity masking; complainant details card | `TimeLineWrapper.js`, `PGRDetails.js` | [`992735af`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/992735af), [`c0c6f30b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/c0c6f30b) |
| 8 | Frontend | Basic image upload | Shared uploader; video/audio playback; per-step attachments | `PgrFileUpload.js`, `attachmentKind.js` | [`6bf0084a`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/6bf0084a), [`e81431c2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e81431c2) |
| 9 | Frontend | Complaint details replaced on reopen/rate | Merge instead of replace; 72-hour reopen window; mandatory reason | `utils/additionalDetail.js` | [`92eaec23`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/92eaec23), [`8597982d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8597982d) |
| 10 | Frontend | English hardcoded; state-level translations only | Default language honoured; city wording overlay; raw-key guards | localization services | [`812b36b8`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/812b36b8), [`3289ac3f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/3289ac3f) |
| 11 | Frontend | DIGIT branding, fixed colours | Fala Cidadão brand; configuration-driven theme colours | `overrides.css`, `index.html` | [`954e134d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/954e134d), [`11c372d8`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/11c372d8) |
| 12 | Frontend | Map at the logged-in tenant | Map and boundaries at the authority's tenant; loop guard; safe tooltips | `GeoLocations.js`, `useMapConfig.js` | [`62335750`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/62335750), [`8c1120f9`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8c1120f9) |
| 13 | Frontend | Boundary prefetch at mount; codes shown in address | Reliable picker; readable address; postal code retired | `BoundaryComponent.js` | [`da545a8a`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/da545a8a), [`4aa5aa3b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4aa5aa3b) |
| 14 | Frontend | No channel-of-receipt | In-person / email / letter / Linha Verde chips | `ChannelChipsComponent.js` | [`6de45287`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/6de45287), [`b2272873`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/b2272873) |
| 15 | Frontend | No analytics | Default-off analytics loader with PII scrubbing | `public/analytics.js` | [`e9a0f0e4`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e9a0f0e4) |
| 16 | Frontend | No testing-tenant concept | Test tenants routed to a separate entrance | `utils/testingTenant.js` | [`d83aa600`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/d83aa600) |
| 17 | Frontend | Multi-module citizen shell | Single-module sidebar; avatar; logout fix | `citizen/index.js` | [`7a1afeeb`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/7a1afeeb), [`295b0756`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/295b0756) |
| 18 | Frontend | Shared error-button label; single-source image | Dedicated button wording + image fallback + layout | `ErrorComponent.js` | [`20ef8760`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/20ef8760) |
| 19 | Backend | Platform scoping only | Department-scope service (opt-in) | `EmployeeDepartmentScopeService.java` | [`fe7cab60`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/fe7cab60) |
| 20 | Backend | No geographic scoping | Jurisdiction scoping incl. boundary subtrees (opt-in) | `EmployeeJurisdictionScopeService.java`, `BoundaryUtil.java` | [`9e650397`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/9e650397), [`79dae4ef`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/79dae4ef) |
| 21 | Backend | No admin endpoint | `/v2/request/_admin/_search` rows + count | `AdminComplaintSearchController.java` | [`dae9ec08`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/dae9ec08) |
| 22 | Backend | Filer filter ignored | Real `createdBy` filter | `RequestSearchCriteria.java` | [`1f9b68a2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1f9b68a2) |
| 23 | Backend | All-or-nothing masking | Selective field visibility (`x-no-mask`) | `EncryptionDecryptionService.java` | [`8746bcab`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8746bcab) |
| 24 | Backend | Hardcoded escalation states | Configurable escalation scan states | `EscalationScheduler.java` | [`718d65b1`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/718d65b1) |
| 25 | Backend | web/mobile sources only | + email, in-person, letter, Linha Verde | `application.properties` | [`b2272873`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/b2272873) |
| 26 | Backend | Wrong notification recipient; terminal-assignee break; department errors | Newest-match recipient; safe terminal transitions; department fallback; new placeholders | `NotificationService.java`, `WorkflowService.java` | [`f05c52d5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f05c52d5), [`4fa8964c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4fa8964c), [`15ec1db5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/15ec1db5) |
| 27 | Notifications | Novu stack mandatory | Direct SMS/Email mode; OTP pipeline; Ozeki provider | `DirectDeliveryService.java`, `OzekiOverridesBuilder.java` | [`91aded4c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/91aded4c), [`a95f8df2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a95f8df2), [`a3be88e5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a3be88e5) |
| 28 | Workflow | Flat two-role workflow | CMS four-tier workflow variant | `CmsPgrWorkflowConfig.json` | [`bffdce15`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/bffdce15) |
| 29 | Roles | Stock DIGIT roles | 13 new roles + ~2,180 grant lines | access-control seeds | [`e79f0847`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/e79f0847), [`8e8c16dd`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8e8c16dd) |
| 30 | MDMS | No dispatcher / dynamic-field masters | Authority dispatcher, templates, extended-attribute schemas | seeder data + schemas | [`23326ca2`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/23326ca2), [`8746bcab`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/8746bcab) |
| 31 | MDMS | Static landing | Landing page masters + seeds | seeder + [seed script](https://github.com/eGov-Global/CMS-MOZAMBIQUE/tree/master/docs/migration/landing-config) | [`421db133`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/421db133) |
| 32 | MDMS | No tenant banner | Banner-image property + repair script | `tenant.json`, `fix-citymodule.sh` | [`00ffd59f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/00ffd59f), [`ba39a55d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ba39a55d) |
| 33 | MDMS | Privacy policy in the wrong module | Corrected module + Portuguese/English content | seeder schema + seed | [`c3e42214`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/c3e42214), [`039494e7`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/039494e7) |
| 34 | Localization | English + Hindi seeded | Portuguese packs; Fala Cidadão copy; city overlays | seeder `localisations/` | [`f42ad659`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f42ad659), [`9597f0ab`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/9597f0ab) |
| 35 | Configurator | No landing editing | Visual Landing Page Builder | `admin/landingBuilder/` (14 files) | [`c2803e7f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/c2803e7f) |
| 36 | Configurator | Fixed telemetry, always on | Analytics destinations editor + kill switch | `AnalyticsProvidersEditor.tsx`, `telemetryGate.ts` | [`1fd0711e`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1fd0711e) |
| 37 | Configurator | Every master editable by any user | Role-gated editing on sensitive masters | `useCanWriteResource.ts` | [`a82a9508`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/a82a9508) |
| 38 | Configurator | Role-actions read-only | Role-actions creatable/editable from the UI | `App.tsx`, resource registry | [`31048d69`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/31048d69), [`6135b38f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/6135b38f) |
| 39 | Configurator | English boot; stale translation caches | Environment default language; instant translation propagation | `i18nProvider.ts`, `useLocalizationSaveRefresh.ts` | [`833f759d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/833f759d), [`3d6fc082`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/3d6fc082) |
| 40 | Configurator | Deploy-time testing tenant | Admin-toggleable testing-tenant flag with guard rails | `TestingTenantToggle.tsx` | [`0cfebb60`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0cfebb60) |
| 41 | Deployment | No unified migration | One-command 9-phase migration runner (+ Matomo) | `docs/migration/` | [`16b91133`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/16b91133), [`1abef50f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/1abef50f) |
| 42 | Deployment | No compression on the UI bundle | gzip + cache headers in every serving path; runbook | nginx templates, `enable-gzip.sh` | [`874ec205`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/874ec205) |
| 43 | Deployment | Single UI entrance | Password-gated testing entrance (default off) | ansible templates | [`06ee871e`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/06ee871e) |
| 44 | Deployment | Seeder container in the stack | Seeder retired; data moved into the database dump | compose files | [`6e72eed5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/6e72eed5), [`f4d37bbd`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/f4d37bbd) |
| 45 | Deployment | — | Escalation script + runbook; pilot deploy script; HTTPS guide | `enable-escalation.sh`, `deploy-pilot-fe.sh` | [`718d65b1`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/718d65b1), [`b0d99e14`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/b0d99e14), [`938623bd`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/938623bd) |
| 46 | CI | Product CI only | Security scanning (Checkov/KICS/Strix + AI triage + dashboard); manual trigger, report-only | `.github/` (15 files) | [`bc0ecdac`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/bc0ecdac), [`57e28906`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/57e28906) |
| 47 | Docs | Product docs | PRD/design, migration guides, runbooks, analytics guide | `docs/` (32 files) | [`ab8c3a2c`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ab8c3a2c), [`48e4bc08`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/48e4bc08) |
| 48 | Tests | Postal-code test specs | Retired with the feature; 19 test files touched repo-wide (8 added, 10 modified, 1 deleted) | `tests/`, per-module tests | [`4aa5aa3b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/4aa5aa3b), [`ac4ce48a`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/ac4ce48a) |
| 49 | Classification | Fixed 2-level type/subtype | N-level hierarchy as data (core product, built under the Mozambique programme) + routed-department stamping, localized labels, tenant-correct fetch | `ComplaintHierarchy*` masters, `ComplaintHierarchyComponent.js` | [`0c1123c8`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/0c1123c8), [`3289ac3f`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/3289ac3f) |
| 50 | Classification | One department per complaint type (1-1) | One-to-many department mapping (`departments`, `ComplaintTypeDepartments`) and full operation with **no** department mapped | ServiceDefs schema, assignment flow | [`394e6136`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/394e6136), [`af818c2d`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/af818c2d) |

---

## 14. Known Technical Issues (under product review)

Three issues found during the Mozambique implementation and Ozeki SMS integration. Each was verified against the repository; none is fixed in the repository yet.

### Enabling real OTP does not switch off the gateway mocks

Setting `enable_otp_services: true` starts the real OTP services — but the API gateway keeps answering OTP calls with canned mock responses, so login still uses the fixed test code.

- **Why:** the flag only adds the OTP containers to the stack ([`playbook-deploy.yml`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/local-setup/ansible/playbook-deploy.yml) line 1497) and a health check. The gateway file [`kong.yml`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/local-setup/kong/kong.yml) is static — its `user-otp-mock` and `otp-validate-mock` blocks stay active regardless of the flag, and removing them is a manual edit on the server.
- **Fix needed (product):** make the gateway mock blocks conditional on the same flag, so one setting switches the whole OTP path to real services.

### New-citizen registration fails on a second OTP check

Registration validates the citizen's OTP twice; the code is deleted after the first successful check, so the second check fails and the citizen sees "invalid OTP".

- **Fix applied on the live environment** (user-service settings): `CITIZEN_REGISTRATION_WITHLOGIN_ENABLED=true` and `OTP_VALIDATION_REGISTER_MANDATORY=false` — the citizen is created active after the first successful validation.
- **Repository status:** these two settings exist in the Helm/Kubernetes charts ([`egov-user/values.yaml`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/devops/deploy-as-code/charts/core-services/egov-user/values.yaml)) but are missing from the compose/Ansible path that the Mozambique servers use — a redeploy from the repository reproduces the bug until they are added there.

### Deployment breaks when the default passwords are changed

Changing the bootstrap secrets away from the defaults causes deployment failures, because several deploy steps still expect the default credential.

- **Verified:** six steps in [`playbook-deploy.yml`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/local-setup/ansible/playbook-deploy.yml) hardcode the default password outright (lines 4400, 4440, 4471, 4611, 4707, 4709), and nine more fall back to it as a default. Mixed hardcoded/variable usage is what makes a password change break mid-deploy.
- **Fix needed (product):** route every credential reference through one variable and re-test a full deployment with non-default secrets.

---

## 15. Testing Status

- Functional flows exercised on the UAT environment (`cms-pilot.digit.org`): citizen creation, the full assignment chain, resolve/reopen/rate, notification delivery, document upload and retrieval, dashboard rendering.
- Automated coverage: 19 test files across the delta — concentrated in analytics (a 786-line suite), backend visibility scoping and direct notification delivery. Workflow transitions, localization and roles rely on manual validation.
- A formal UAT sign-off record is not kept in the repository.

---

## 16. Known Limitations & Product Decisions

**Product decisions recorded:**

- **Two-authority support retained, IGSAE switched off** — the product keeps full IGE + IGSAE functionality (schemas, dynamic fields, masters); IGSAE is disabled for this deployment via configuration ([`21ff33d5`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/21ff33d5)) and can be re-enabled without code changes
- **Rating cache behaviour accepted** — a rating submitted from a stale page affects terminal states only; recorded as accepted ([`aafa912b`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/commit/aafa912b))
- **Mobile app** — the Flutter WebView app is merged to the repository ([`mobile/`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/tree/master/mobile)) and ships with the next deployment; it is not part of this release tag

**Known limitations:**

1. The three technical issues in [section 14](#14-known-technical-issues-under-product-review)
2. Confidential-complaint masking is a display control; API-level masking gated on `CONFIDENTIAL_COMPLAINT_VIEWER` is not yet wired end-to-end
3. Three roles need manual registration after deploy (see [Roles & Permissions](#9-roles--permissions))
4. No dashboard geography drill-down in this release
5. Notification templates for the CMS workflow's new states may be incomplete — transitions through those states can send nothing
6. Automated test coverage is thin outside analytics/scoping/notifications
7. The admin console ships external telemetry keys guarded by a kill switch that must be deliberately engaged for a production build
8. Selected fields on confidential complaints stay visible by design (`x-no-mask`) — the field list should be confirmed with the data-protection owner
9. Admin search shows the result count as "N+" until the last page (backend count echo — a display quirk)

---

## 17. Documentation

| Document | Purpose |
|---|---|
| [Release Notes — CMS-MOZ-V2.12](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/mozambique/RELEASE-NOTES-CMS-MOZ-V2.12.md) | The release announcement these notes accompany |
| [Mozambique customization record](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/mozambique-customizations.md) | Backend customization record |
| [Migration runner guide](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/migration/README.md) | Post-deploy tenant migration (`ccrs-migrate.cjs`) |
| [Analytics guide](https://github.com/eGov-Global/CMS-MOZAMBIQUE/tree/master/docs/analytics-guide) | Analytics setup, configuration, self-hosted Matomo |
| [Escalation runbook](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/pgr-escalation/RUNBOOK.md) | Enabling auto-escalation on a running environment |
| [HTTPS with Let's Encrypt](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/docs/enabling-https-with-letsencrypt.md) | TLS setup guide |
| [PRD / solution design](https://github.com/eGov-Global/CMS-MOZAMBIQUE/tree/master/docs/superpowers/specs/mozambique-prd) | Product requirements and solution design |
| [Mobile app](https://github.com/eGov-Global/CMS-MOZAMBIQUE/tree/master/mobile) | Flutter WebView wrapper (configuration: [`app_config.json`](https://github.com/eGov-Global/CMS-MOZAMBIQUE/blob/master/mobile/assets/config/app_config.json)) |
