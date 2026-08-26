# CMS Mozambique — Backend Customizations

*Changes made on top of the base DIGIT Complaint Management System (CCRS) product, covering `pgr-services` and `novu-bridge`.*

> This document tracks customizations specific to this deployment that are not part of the upstream product.

---

## PGR-Services

### New Capabilities

**1. Employee Department-Scoped Complaint Search**
Employees holding specific configured roles can now be restricted to see only complaints belonging to their own department (resolved live from HRMS), instead of all complaints across departments. Opt-in via configuration — no role is restricted by default, so existing deployments are unaffected until explicitly enabled per role.

**2. Employee Jurisdiction-Scoped Complaint Search**
Employees holding specific configured roles can now be restricted to see only complaints filed within their own HRMS jurisdiction (geographic boundary), instead of every locality. Mirrors the department-scoping feature above — a separate opt-in role list, so the two can be enabled independently or together. Intersects with (rather than replaces) an employee's own explicit locality filter on a search request.

**3. Admin Cross-Department Search API**
A new dedicated search endpoint for SUPERUSER-level admins, allowing search across all departments in one call with department filtering and a combined result count — without altering the existing citizen/employee search APIs. Exempt from both the department- and jurisdiction-scoping features above, so this cross-boundary admin view is never silently narrowed to the caller's own department/jurisdiction.

**4. "Filed On Behalf Of" Search Filter (createdBy)**
Complaint search now supports filtering by who actually filed the complaint (e.g., a reception officer filing for a citizen), separate from who the complaint belongs to. Supports the reception-officer workflow where staff log complaints on citizens' behalf and need to retrieve their own filed records.

**5. Selective Field Visibility on Confidential Complaints**
Certain fields (e.g., institution name) can now be configured to stay visible even when a complaint is marked confidential and the viewer isn't authorized to see the rest, instead of an all-or-nothing mask. MDMS-configurable per complaint type.

**6. Configurable Escalation States**
The auto-escalation scheduler's set of "pending" statuses it scans for candidate escalations is now configurable per deployment, instead of hardcoded — letting each tenant's workflow configuration define which states escalate.

**7. Additional Complaint Intake Channels**
Added support for new channel-of-receipt values — email, in-person, letter, and "Linha Verde" (hotline) — so complaints logged through these channels are correctly attributed at creation.

### Behavior Fixes & Improvements

**8. Correct Notification Recipient on Closed/Rated Complaints**
Fixed a bug where closing-stage notifications (e.g., rating emails) could greet the wrong staff member — the system now resolves the *most recent* workflow step instead of the first matching one.

**9. Reliable Terminal Workflow Transitions**
Fixed an issue where transitions into a closing/terminal status could be rejected by the workflow engine when an assignee was attached. The assignee is still recorded for notifications without being forwarded in a way that breaks the transition.

**10. Improved Department Display in Notifications**
Reworked how a complaint's department is resolved for notification placeholders, with a clear fallback order (category-configured department → department stored on the complaint → assignee's current HRMS department), so notifications degrade gracefully instead of showing blank/incorrect department names.

**11. New Notification Placeholders**
Added placeholders for the *acting* employee's department, name, and designation (the person who performed a given workflow action), in addition to the existing assignee placeholders — enabling more informative notification templates.

**12. Sort by Last Modified**
Complaint search can now be sorted by last-modified time, in addition to created time.

**13. Hardened Search Endpoint Against Scope-Bypass**
The internal-only flags that exempt the admin search from department/jurisdiction scoping are now explicitly blocked from being set via search API query parameters — closing a path where an employee could otherwise have supplied them directly to bypass their own scoping.

### Configuration Additions

| Property | Purpose |
|---|---|
| `pgr.department.scope.roles` | Roles subject to department-scoped search (empty = disabled, default) |
| `pgr.jurisdiction.scope.roles` | Roles subject to jurisdiction-scoped search (empty = disabled, default) |
| `pgr.escalation.states` | Statuses the escalation scheduler scans for candidates |
| `allowed.source` | Extended with `email`, `inperson`, `letter`, `linhaverde` |

---

## Novu-Bridge

### New Capabilities

**1. Direct Delivery Mode (bypass Novu entirely)**
For deployments where the Novu service can't be run (e.g. resource-constrained environments), SMS and Email can now be delivered directly — SMS straight to the Ozeki gateway's HTTP API, Email straight over SMTP — configurable per channel. WhatsApp is unaffected and always continues through Novu, since it depends on Twilio's approved template format. Disabled by default; existing deployments are unaffected.

**2. Ozeki SMS Gateway Support (via Novu)**
Added support for routing SMS through the Ozeki SMS gateway as a Novu-integrated provider, as an alternative to the default provider — usable independently for:
- **Complaint notifications** (citizen-facing SMS on complaint status/updates)
- **OTP/login codes** (one-time-password delivery, used before a citizen has an account)

Each is controlled by its own setting, so enabling one does not affect the other, and WhatsApp/Email delivery is untouched either way. Disabled by default (falls back to the existing default provider).

**3. OTP Delivery Pipeline**
Added a dedicated delivery path for one-time-password/login-code messages, separate from complaint notifications, since OTPs are sent before a citizen has an account and carry no complaint context. Reuses the existing SMS delivery workflow rather than requiring separate setup.

### Configuration Additions

| Property | Purpose |
|---|---|
| `novu.bridge.sms.provider` | Route complaint SMS through Ozeki instead of the default provider |
| `novu.bridge.otp.sms.provider` | Route OTP SMS through Ozeki instead of the default provider |
| `novu.bridge.ozeki.integration.identifier` | Which configured Ozeki integration to use |
| `novu.bridge.direct.channels` | Which channels (SMS/Email) bypass Novu entirely |
| `novu.bridge.direct.ozeki.*` | Ozeki gateway URL/credentials for direct SMS |
| `novu.bridge.direct.email.from` + `spring.mail.*` | SMTP sender configuration for direct email |

All additions are opt-in with empty/off defaults — no behavior change for existing deployments unless explicitly configured.
