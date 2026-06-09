# G5: Notification Templates per workflow state

## Why

Today the outbound notifications fired by the CRS — SMS to citizens on every workflow
transition, escalation alerts to officers, "your complaint is now RESOLVED" closure
messages — are templated in code (hardcoded strings inside the Novu bridge service, with
ad-hoc per-tenant English/Swahili overrides bolted on in a config map). Editing a single
word in any of those messages requires a code change, a service rebuild, and a redeploy.
This is the wrong shape for content that operators want to tweak on the fly.

Phase G5 introduces a **per-state, per-channel, per-locale notification template editor**
in the configurator, backed by an MDMS-resident template store and a small change in the
Novu bridge consumer to look templates up at render time. Variable substitution tokens
(`[SRID]`, `[YEAR]`, `[CITIZEN_NAME]` and friends) are explicitly enumerated per template
so the editor can validate that operators only reference tokens the dispatcher actually
binds. (Cross-reference: the BRD §5.1 E "Citizen Notifications" table is the real-world
shape we'll match for tenants that adopt the Mozambique seed; this phase ships the
generic editor only — no BRD-specific defaults seed.)

## Scope

**In:**

- New MDMS schema `CRS.NotificationTemplate` keyed by `(state, channel, locale)`.
- Configurator pages: list view + per-template editor with a live preview pane that
  renders sample variable values.
- Server-side validation: reject save if the body references a variable not on the
  whitelist for that (state, channel) pair.
- A small Novu-bridge patch: replace the hardcoded template lookup with a
  `(state, channel, locale)` MDMS read; fall back to the existing hardcoded text if the
  MDMS record is absent (zero-downtime rollout).
- "Reset to default" button per row — restores the bridge's hardcoded default body for
  that (state, channel) pair.
- Per-tenant overrides (tenant scope is implicit via the MDMS tenant context).
- An audit-trail row on every save (re-uses the `CRS.ConfigAuditLog` primitive planned
  for G4; if G4 hasn't shipped, G5 inlines its own audit shape and migrates later).

**Out (explicitly):**

- BRD-flavoured default templates. The generic editor ships in this phase; the
  Mozambique-specific seed (BRD §5.1 E verbatim, pt_MZ + en localisations) is a
  follow-up tenant-seed PR that any tenant can opt into, not a default.
- WhatsApp Business API template approval workflow. WhatsApp templates require
  Meta-side review before they can be sent; that flow is BRD §8.2 and is its own
  multi-week piece. G5 stores the WhatsApp body shape but does not orchestrate the
  approval round-trip.
- Email template editing. The BRD only specifies SMS for citizen notifications, and
  the platform's email pipeline is owned by `egov-notification-mail` with its own
  Freemarker template store. Bringing email under this editor is a future phase.
- A/B testing or scheduled template rollouts.
- Rich-media attachments (MMS, image-bearing WhatsApp templates).

## MDMS schemas

This phase introduces **one** schema code, registered as a stub in this draft PR and
fleshed out in the implementation PR:

### `CRS.NotificationTemplate`

| Field | Type | Notes |
|---|---|---|
| `state` | enum | One of the six canonical CRS workflow states (`new`, `triage`, `forwarded`, `investigation`, `awaiting`, `resolved`) plus `rejected`. Sourced from the same `CRS.WorkflowStateMapping` codes shipped in PR #B's parent (PR #775). |
| `channel` | enum | `SMS` \| `WHATSAPP` \| `IN_APP`. (Email deferred — see Scope.) |
| `locale` | string | BCP-47 tag, e.g. `en_KE`, `sw_KE`, `pt_MZ`, `en_US`. |
| `body` | string | The template body, max 1000 chars. Variable tokens written as `[TOKEN]`. |
| `variablesUsed` | string[] | The exact set of tokens the body references. Server-side validation cross-checks against the whitelist for the `(state, channel)` pair and rejects unknown tokens. |
| `audienceRole` | enum | `CITIZEN` \| `OFFICER`. Same `(state, channel, locale)` tuple can have two rows — one per audience. |
| `active` | boolean | Soft-disable a template without deleting it. |
| `updatedAt` | timestamp | Stamped server-side on save; used by the bridge cache to invalidate. |

`x-unique`: `(state, channel, locale, audienceRole)`.
`additionalProperties: false`.
`x-ref-schema: []` — this is a leaf schema; no cross-references.

Conventions match `CRS.CategorySLA` / `CRS.StateSLA` from PR #770 (object type,
strict `x-unique`, no `additionalProperties`, no cross-schema refs).

The schema **code is reserved in this draft PR** via a stub envelope at
`utilities/default-data-handler/src/main/resources/schema/CRS.G5.json` with
`isActive: false` and a placeholder property bag. The implementation PR replaces
the stub with the table above and flips `isActive: true`.

## Configurator routes + UI sketch

### Routes

| Route | Page |
|---|---|
| `/manage/crs-notifications` | Template list / table view |
| `/manage/crs-notifications/:code/edit` | Template editor with live preview |
| `/manage/crs-notifications/new` | Create a new template row |

Sidebar nav: under the existing **"CRS Configuration"** group (same group that hosts
the SLA Matrix from PR #770), as a new item **"Notification Templates"** placed below
"SLA Matrix" and above the future "Permission Matrix" (G4) slot.

### Page anatomy — list view (`/manage/crs-notifications`)

- **Header:** page title, breadcrumb, "Add Template" button (top-right).
- **Toolbar:** filter dropdowns for `state`, `channel`, `locale`, `audienceRole`; a
  text-search box over `body`; an "Inactive only" toggle.
- **Body:** a paginated table, one row per template, columns:
  `State | Channel | Audience | Locale | Body (truncated, hover-to-expand) | Updated | Actions`.
  Row actions: `Edit`, `Reset to default` (only shown when the row diverges from the
  bridge default), `Deactivate` (soft delete).

### Page anatomy — editor (`/manage/crs-notifications/:code/edit`)

ASCII wireframe:

```
+---------------------------------------------------------------+
|  < Notification Templates / Edit                       [Save] |
+---------------------------------------------------------------+
|  State:    [forwarded   v]   Channel: [SMS   v]               |
|  Locale:   [en_KE       v]   Audience:[CITIZEN v]             |
|  Active:   [x]                                                |
+---------------------------------------------------------------+
|  Body                                                         |
|  +---------------------------------------------------------+  |
|  | Hi [CITIZEN_NAME], complaint [SRID] has been forwarded  |  |
|  | to [DEPARTMENT_NAME] in [YEAR]. We will keep you        |  |
|  | informed.                                               |  |
|  +---------------------------------------------------------+  |
|  Chars: 113 / 1000      Variables: [CITIZEN_NAME] [SRID]      |
|                                    [DEPARTMENT_NAME] [YEAR]   |
+---------------------------------------------------------------+
|  Preview (sample values)                                      |
|  +---------------------------------------------------------+  |
|  | Hi Jane Doe, complaint SR-2026-000123 has been forwarded|  |
|  | to Water Department in 2026. We will keep you informed. |  |
|  +---------------------------------------------------------+  |
|  Sample values can be edited inline ↑                         |
+---------------------------------------------------------------+
|  Available variables for (forwarded, SMS, CITIZEN):           |
|  [SRID]            Service request id (always available)      |
|  [YEAR]            4-digit year of complaint creation         |
|  [CITIZEN_NAME]    First + last from the complainant record   |
|  [DEPARTMENT_NAME] Name of the assigned department            |
|  [DUE_DATE]        SLA breach date (forwarded → investigation)|
+---------------------------------------------------------------+
|         [Reset to default]    [Cancel]    [Save]              |
+---------------------------------------------------------------+
```

The variable list at the bottom is the **whitelist for this (state, channel, audience)
tuple** — both UI and server-side validation use the same source of truth, served by a
read-only GET on the bridge.

## API endpoints touched

- **mdms-v2** — the default path. CRUD on `CRS.NotificationTemplate` rows via
  `_create`, `_update`, `_search`. No new backend service is needed; the existing
  `egov-mdms-v2` handles persistence.
- **novu-bridge** — one small patch (~80 LOC + tests) to swap the hardcoded template
  map for an MDMS-cached lookup keyed by `(state, channel, locale, audienceRole)`. The
  bridge already caches MDMS reads (5-minute TTL); we extend the cache key.
- **novu-bridge** — one new internal GET endpoint, `/notification-template/variables`,
  returns the whitelist of available variables per `(state, channel, audienceRole)`
  tuple. Read-only, used by the configurator editor and the server-side validator.
- **No** changes to `egov-user`, `egov-workflow-v2`, `pgr-services`, or `egov-persister`.
  This phase is fully decoupled from the workflow core.

## Dependencies on prior phases

**Hard dependencies (must ship first):**

- **PR #770** (escalation foundation) — establishes the `CRS.*` namespace and the
  audit primitive pattern that G5 reuses.
- **PR #A** (state-name MDMS, `CRS.WorkflowStateMapping`) — G5's `state` enum is
  sourced from the same canonical state-name codes. If PR #A is still in flight, G5
  inlines the enum and migrates to the lookup later.
- **Novu bridge in the deploy** — the bridge is part of the standard CCRS Docker
  Compose / Ansible stack now (CCRS#23, CCRS#24), so this is satisfied by default on
  any 2026-Q2-onwards tenant.

**Soft dependencies (nice to have, not blocking):**

- **G4 Permission Matrix** — gates who can edit templates (vs. just view). Without
  G4, the editor is open to anyone with the `ADMINISTRATOR` role.
- **G1 Category Taxonomy** — if templates ever want to reference category names in
  preview rendering, G1's taxonomy is the source. Not in scope for G5.

**What G5 blocks:**

- Localisation-driven tenant onboarding flows that want to translate the message
  pack as part of city setup — those flows can land after G5.
- BRD §5.1 E Mozambique seed PR (tenant-side opt-in) — depends on G5's schema and
  editor existing.

## Acceptance criteria

1. On a fresh tenant with no `CRS.NotificationTemplate` rows seeded, citizen
   notifications still fire correctly using the bridge's hardcoded fallback strings
   (zero-downtime rollout proved by deploying the bridge patch to an unseeded tenant
   and watching `forwarded` SMS still go out).
2. An operator can navigate to `/manage/crs-notifications`, create a new row for
   `(forwarded, SMS, en_KE, CITIZEN)` with body `Hi [CITIZEN_NAME], complaint [SRID]
   forwarded.`, save it, and on the very next `forwarded` transition the SMS uses
   the new body (no service restart; bridge cache TTL ≤ 5 min).
3. Saving a body that references `[UNKNOWN_TOKEN]` is rejected by the server with a
   clear error message that names the offending token and lists the valid whitelist.
4. The preview pane on the editor renders sample values for every token in the
   whitelist; operators can edit the sample values inline to test edge cases.
5. "Reset to default" on a row restores the bridge's hardcoded default body for that
   `(state, channel, audienceRole)` tuple and marks the row inactive (the bridge
   then falls through to its hardcoded path).
6. Every save writes one row to the audit log table (`CRS.ConfigAuditLog` or G5's
   inlined equivalent) with `before`, `after`, `actor`, `timestamp`.
7. Switching `locale` on the editor and re-saving creates a **separate** MDMS row
   (does not overwrite the previous locale's body). Verified by listing all rows for
   a single `(state, channel, audienceRole)` and seeing N rows where N = number of
   active locales.

## Estimated effort

**M (~3-4 days)** — One MDMS schema, one bridge patch with cache-invalidation, one
list view + one editor view in the configurator, one server-side validator, one
audit-write hook. The novu-bridge integration and the variable-whitelist plumbing are
the slowest pieces; the configurator UI is largely a clone of the existing SLA Matrix
editor pattern from PR #770.

## Open questions

1. **Whitelist source of truth.** Should the per-tuple variable whitelist live in
   MDMS too (a separate `CRS.NotificationVariable` schema) or be a hardcoded constant
   in the novu-bridge served via the read-only GET endpoint? Hardcoded is faster to
   ship but less flexible; MDMS is more flexible but introduces a second schema this
   phase has to own. **Current lean:** hardcoded in the bridge for v1, migrate to
   MDMS in G5.1 if operators ask.

2. **Multi-tenant template inheritance.** If `ke.bomet` has no `(forwarded, SMS,
   en_KE, CITIZEN)` row but the root `ke` tenant does, should the bridge inherit the
   root row? MDMS v2 supports tenant inheritance for reads; we need to confirm the
   bridge consumer respects it. **Current lean:** yes, inherit — matches the
   `CRS.StateSLA` precedent from PR #770.

3. **WhatsApp template approval coupling.** If we ship the `WHATSAPP` channel enum
   value in this phase, operators may try to edit a WhatsApp template and expect it
   to start sending — but Meta requires pre-approval. Do we hide `WHATSAPP` from the
   channel dropdown until BRD §8.2 lands, or show it with a "pending Meta approval"
   warning banner? **Current lean:** ship the enum value but disable the dropdown
   option with a tooltip until G8 (or whatever WhatsApp-approval phase ends up
   being).

4. **Audit-log location.** G4's `CRS.ConfigAuditLog` may not have shipped by the
   time G5 implementation starts. Do we (a) block G5 on G4, (b) inline a G5-specific
   audit shape and migrate later, or (c) reuse the existing `CRS.SLAAuditLog` shape
   from PR #770 by renaming it? **Current lean:** (b) — inline, document the
   migration, ship.

5. **Fallback semantics on render failure.** If the MDMS lookup succeeds but the body
   references a variable the bridge can't bind (e.g. `[CITIZEN_NAME]` for an
   anonymous complaint), do we (a) send the message with the raw token left in, (b)
   skip the notification entirely, or (c) fall back to the hardcoded default? Each
   has citizen-experience trade-offs. **Current lean:** (c) for v1, with an OTEL
   counter so operators can see how often it happens.

## Cross-references

- **Discussion:** _filled in after the linked Discussion is opened — see PR body for
  the live link._
- **Roadmap doc:** [`docs/crs-configurator-roadmap.md`](../crs-configurator-roadmap.md)
  — §"Phase G5 — Notification Templates" is the canonical scope summary; this sub-doc
  is the design expansion.
- **Escalation design doc:** [`docs/escalation-feature-design.md`](../escalation-feature-design.md)
  — establishes the configurator UI pattern G5 reuses (list view + editor + audit
  trail).
- **CategorySLA wiring strategies:** [`docs/categorysla-wiring-strategies.md`](../categorysla-wiring-strategies.md)
  — sibling doc for PR #B; cross-tenant inheritance precedent referenced in Open
  Question 2.
- **PR #770** — escalation foundation (`CRS.CategorySLA`, `CRS.StateSLA`,
  `CRS.SLAAuditLog`, scheduler patch, SLA Matrix editor). G5 mirrors its schema
  conventions, sidebar grouping, and audit-on-save pattern.
- **PR #A** — `CRS.WorkflowStateMapping` (the source of truth for the `state` enum
  in `CRS.NotificationTemplate`).
- **PR #B** — `categorysla-wiring-strategies.md` (the inheritance/payload-shape
  precedent referenced in Open Question 2).
