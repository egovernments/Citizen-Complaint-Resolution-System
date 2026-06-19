# PGR Workflow Solution Document – IGE / IGSAE (Mozambique)
**Version:** 1.0 | **Date:** 2026-06-11 | **Status:** Draft

---

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Tenant Configuration](#2-tenant-configuration)
3. [Master Data Configuration](#3-master-data-configuration)
4. [Roles & Designations](#4-roles--designations)
5. [Workflow Configuration](#5-workflow-configuration)
6. [Complaint Submission Form Changes](#6-complaint-submission-form-changes)
7. [Backend Changes](#7-backend-changes)
8. [Notification Configuration](#8-notification-configuration)
9. [Dashboard Requirements](#9-dashboard-requirements)
10. [Security & Access Control](#10-security--access-control)
11. [Enhancements – Ordered Development Plan](#11-enhancements--ordered-development-plan)

---

## 1. System Overview

### Context
Mozambique's government has launched two inspectorates to strengthen transparency and consumer safety:
- **IGE** – General State Inspectorate (Public Administration & Public Companies)
- **IGSAE** – General Inspectorate of Economic Activities (Food Safety, Commerce, Consumer Protection)

A unified, traceable channel is required to receive, route, and resolve **Complaints, Denunciations, Grievances, and Petitions** from citizens.

### Channels
| Channel | Phase |
|---|---|
| Web Portal | Pilot |
| Counter (Reception Technician) | Pilot |
| WhatsApp (inbound + outbound) | Next Release |

### Application ID Format
```
PRD-2026-0000001
```

---

## 2. Tenant Configuration

### Tenant Hierarchy
```
mz                     (State / Root Tenant)
├── mz.IGE             (General State Inspectorate)
└── mz.IGSAE           (General Inspectorate of Economic Activities)
```

### Tenant Details
| Tenant ID | Name | Departments |
|---|---|---|
| `mz` | Mozambique (Root) | — |
| `mz.IGE` | Inspectoria Geral do Estado | 105 departments |
| `mz.IGSAE` | Inspectoria Geral de Segurança Alimentar e Económica | 17 departments |

### Default Language
Portuguese (`pt`) must be loaded as the default language post-installation. **Verify** after deployment.

---

## 3. Master Data Configuration

### 3.1 Authority Type Master
> Module: `common-masters` | File: `AuthorityType.json`

```json
[
  { "code": "IGE",   "name": "Public Administration and Public Companies", "active": true },
  { "code": "IGSAE", "name": "Inspectorate General of Economic Activities", "active": true }
]
```

### 3.2 Complaint Category Master
> Module: `RAINMAKER-PGR` | File: `ComplaintCategory.json`

```json
[
  { "code": "COMPLAINT",  "name": "Complaint",  "active": true },
  { "code": "GRIEVANCE",  "name": "Grievance",  "active": true },
  { "code": "PETITION",   "name": "Petition",   "active": true }
]
```

### 3.3 Sector Master
> Module: `RAINMAKER-PGR` | File: `Sector.json`

| Code | Name | Authority |
|---|---|---|
| `PUBLIC_SERVICES` | Public Services | IGE |
| `HUMAN_RESOURCES` | Human Resources | IGE |
| `CUSTOMER_SERVICE` | Customer Service | IGE |
| `LEGALITY` | Legality | IGE |
| `COMMERCE` | Commerce | IGSAE |
| `HEALTH` | Health | IGSAE |
| `TRANSPORT` | Transport | IGSAE |
| `TOURISM` | Tourism | IGSAE |
| `EDUCATION` | Education | IGSAE |
| `FOOD_SECURITY` | Food Security | IGSAE |
| `INTELLECTUAL_PROPERTY` | Intellectual Property | IGSAE |

### 3.4 Complaint Type (ServiceDefs) Master
> Module: `RAINMAKER-PGR` | File: `ServiceDefs.json`
> **Note:** `menuPath` field repurposed/renamed to `sector`.

**Schema per entry:**
```json
{
  "serviceCode": "HEALTH_SERVICE_QUALITY",
  "name": "Health Service Quality",
  "authorityType": "IGSAE",
  "category": "COMPLAINT",
  "sector": "HEALTH",
  "slaHours": 24,
  "keywords": "hospital, clinic, treatment, medicine",
  "active": true,
  "order": 1
}
```

**Sample entries:**
```json
[
  {
    "serviceCode": "HEALTH_SERVICE_QUALITY",
    "name": "Health Service Quality",
    "authorityType": "IGSAE",
    "category": "COMPLAINT",
    "sector": "HEALTH",
    "slaHours": 24,
    "active": true
  },
  {
    "serviceCode": "PUBLIC_SERVICE_DELAY",
    "name": "Delay in Public Service",
    "authorityType": "IGE",
    "category": "GRIEVANCE",
    "sector": "PUBLIC_SERVICES",
    "slaHours": 360,
    "active": true
  }
]
```

### 3.5 Complaint Type → Department Mapping
> Module: `RAINMAKER-PGR` | File: `ServiceDefDepartmentMapping.json`

```json
[
  {
    "serviceCode": "HEALTH_SERVICE_QUALITY",
    "departments": ["HEALTH_REGULATION", "CONSUMER_PROTECTION", "QUALITY_ASSURANCE"]
  }
]
```

> **Onsite Team to Provide:** Full list of complaint types with department mappings.

### 3.6 Master Data Hierarchy (Complete)
```
Authority Type (IGE / IGSAE)
│
├── IGE
│   └── Category: Complaint | Grievance | Petition
│       └── Sector: Public Services | Human Resources | Customer Service | Legality
│           └── Complaint Type (ServiceCode)
│               └── Department Mapping
│
└── IGSAE
    └── Category: Complaint | Grievance | Petition
        └── Sector: Commerce | Health | Transport | Tourism | Education | Food Security | Intellectual Property
            └── Complaint Type (ServiceCode)
                └── Department Mapping
```

### 3.7 Locality (Boundary) Master
**Hierarchy:** Province → District → Administrative Post (3 levels)
> **Onsite Team to Provide:** Full boundary data file.

### 3.8 Department Master
> **Onsite Team to Provide:**
> - 105 departments for mz.IGE
> - 17 departments for mz.IGSAE

---

## 4. Roles & Designations

### 4.1 System Roles
| Role Code | Institution | Responsibility |
|---|---|---|
| `CITIZEN` | Public | Register complaints, provide info, cancel, reopen, rate |
| `RECEPTIONTECHNICIAN` | IGE / IGSAE | Register complaints on behalf of citizens at counter |
| `SCREENINGTECHNICIAN` | IGE / IGSAE | Triage & route complaints to correct department |
| `ASSIGNMENTOFFICER` | IGE / IGSAE | Investigate, request info, resolve, or escalate |
| `SUPERVISOR` | IGE / IGSAE | Approve, escalate, reassign, reject, close cases |
| `IGE_LEADERSHIP` | IGE | Executive overview of all IGE cases |
| `IGSAE_LEADERSHIP` | IGSAE | Executive overview of all IGSAE cases |
| `PGR_VIEWER` | IGE / IGSAE | Supporting role with read/workflow action access |
| `SYSADMIN` | IT IGE / IGSAE | Platform configuration, workflows, SLAs, complaint types |

### 4.2 Designations to Create
```
- Screening Technician
- Reception Technician
- Supervisor
- Case Manager
```

### 4.3 Employee Setup Rules
- For **each department**: create at least one Case Manager and one Supervisor.
- All applications initially route to the **central Screening Technician** role.
- After screening, applications move to the **Case Manager** of the concerned department.

> **Onsite Team to Provide:** Employee data (name, designation, department, role).

---

## 5. Workflow Configuration

### 5.1 Workflow ID
```
PGR                  (businessService)
SLA: 432000000 ms    (5 days total)
```

### 5.2 State Flow (Happy Path)
```
APPLY
  ↓ (by CITIZEN / RECEPTIONTECHNICIAN)
SCREENING
  ↓ (by SCREENINGTECHNICIAN)
INVESTIGATION
  ↓ (by ASSIGNMENTOFFICER)
PENDINGINFORMATION     ← optional branch
  ↓ (by CITIZEN)
INVESTIGATION
  ↓ (by ASSIGNMENTOFFICER)
PENDINGATLME           ← escalation branch
  ↓ (by SUPERVISOR)
RESOLVED
  ↓ (by CITIZEN — RATE action)
CLOSEDAFTERRESOLUTION
```

### 5.3 Alternative / Exception Flows
```
SCREENING → REJECTED → CLOSEDAFTERREJECTION
PENDINGATLME → REASSIGN → PENDINGFORREASSIGNMENT → PENDINGATLME
PENDINGINFORMATION → CANCEL → CANCELLED
RESOLVED / REJECTED → REOPEN → SCREENING
```

### 5.4 Complete State Transition Matrix
| From State | Action | To State | Permitted Roles |
|---|---|---|---|
| APPLY | APPLY | SCREENING | CITIZEN, RECEPTIONTECHNICIAN |
| SCREENING | ASSIGN | INVESTIGATION | SCREENINGTECHNICIAN, PGR_VIEWER |
| SCREENING | REJECT | REJECTED | SCREENINGTECHNICIAN, PGR_VIEWER |
| INVESTIGATION | INFOFROMCITIZEN | PENDINGINFORMATION | ASSIGNMENTOFFICER, PGR_VIEWER |
| INVESTIGATION | RESOLVE | RESOLVED | ASSIGNMENTOFFICER, PGR_VIEWER |
| INVESTIGATION | ASSIGN | PENDINGATLME | ASSIGNMENTOFFICER, PGR_VIEWER |
| PENDINGINFORMATION | COMMENT | INVESTIGATION | CITIZEN, RECEPTIONTECHNICIAN |
| PENDINGINFORMATION | CANCEL | CANCELLED | CITIZEN, RECEPTIONTECHNICIAN |
| PENDINGATLME | REASSIGN | PENDINGFORREASSIGNMENT | SUPERVISOR, PGR_VIEWER |
| PENDINGATLME | REJECT | REJECTED | SUPERVISOR, PGR_VIEWER |
| PENDINGATLME | RESOLVE | RESOLVED | SUPERVISOR, PGR_VIEWER |
| PENDINGFORREASSIGNMENT | ASSIGN | PENDINGATLME | SCREENINGTECHNICIAN, PGR_VIEWER |
| PENDINGFORREASSIGNMENT | REJECT | REJECTED | SCREENINGTECHNICIAN, PGR_VIEWER |
| REJECTED | REOPEN | SCREENING | CITIZEN, RECEPTIONTECHNICIAN, PGR_VIEWER |
| REJECTED | RATE | CLOSEDAFTERREJECTION | CITIZEN, RECEPTIONTECHNICIAN |
| RESOLVED | REOPEN | SCREENING | CITIZEN, RECEPTIONTECHNICIAN, PGR_VIEWER |
| RESOLVED | RATE | CLOSEDAFTERRESOLUTION | CITIZEN, RECEPTIONTECHNICIAN |

### 5.5 Document Upload Requirements per State
| State | Attachment Required |
|---|---|
| APPLY | Optional |
| SCREENING | Optional |
| INVESTIGATION | Optional |
| PENDINGINFORMATION | **Mandatory** |
| RESOLVED | Optional |

### 5.6 SLA Configuration
- **Overall SLA:** 432,000,000 ms (5 days)
- SLA starts at complaint registration date.
- Applies across: SCREENING → INVESTIGATION → PENDINGFORREASSIGNMENT → PENDINGATLME.
- **Pending Decision:** Whether SLA pauses/resumes during PENDINGINFORMATION (awaiting business confirmation).

---

## 6. Complaint Submission Form Changes

### 6.1 Fields to Remove
- `Pincode` — remove from complaint registration screen.

### 6.2 New Fields to Add
| Field | UI Label | Storage | Notes |
|---|---|---|---|
| `complainantAddress` | Complainant Address | `additionalDetails` | New |
| `email` | Email | `additionalDetails` | New |
| `confidential` | Do you prefer confidential? | `additionalDetails` | Radio/checkbox |
| `caseRelatedTo` | Case Related To | `additionalDetails` | Maps to Authority Type |
| `submissionType` | Submission Type | `additionalDetails` | Complaint/Grievance/Petition |
| `reportCategory` | Report Category | `additionalDetails` | Sector |
| `reportDescription` | Report Description (renamed by category) | `additionalDetails` | Renamed field |
| `dateOfFact` | Date of Fact | `additionalDetails` | Date picker, past dates allowed |
| `witnessName` | Witness Name | `additionalDetails` | Free text |
| `witnessNote` | Witness Observation | `additionalDetails` | Free text |
| `instituteName` | Institution Name (IGE) / Related Institution / Public Service (IGSAE) | `additionalDetails` | Conditional label |
| `instituteAddress` | Institution Address | `additionalDetails` | Free text |
| `location` | Location | `additionalDetails` | Free text |
| `department` | Department | `eg_pgr_service_v2.additionalDetails` | Saved on first forward action |

### 6.3 Consent Checkboxes (Mandatory before submission)
```
[ ] Declaration of Truthfulness
    "I declare that the information provided is true."

[ ] Data Processing Authorization
    "I authorize the processing of my personal data for the purpose of handling this submission."
```
Both checkboxes must be checked before form can be submitted.

### 6.4 Attachment Types
| Attachment | Applicable To |
|---|---|
| Photograph | All |
| Documents (PDF, XLSX) | All |
| Evidence | IGSAE only |

Accepted formats: PDF, XLSX, JPG, PNG.

### 6.5 `eg_pgr_service_v2` Additional Detail Fields
The following fields must be persisted in `additionalDetails` column:
```
department      — saved on first ASSIGN action (if empty)
category        — Complaint / Grievance / Petition
showPiiData     — default: true
dateOfFact      — date of the reported event
instituteName
instituteAddress
witnessName
witnessNote
location
```

---

## 7. Backend Changes

### 7.1 Department Tracking on Forward
**Problem:** Currently, there is no way to track which department a complaint was forwarded to; only the assigned user's department is derivable.

**Solution:**
- On the first `ASSIGN` workflow action (SCREENING → INVESTIGATION), capture the assignee's `department` and save it in `eg_pgr_service_v2.additionalDetails.department` if the field is empty.
- This enables department-wise reporting independent of user reassignment.

**File to modify:** `pgr-services` — `ServiceRequestService.java` or equivalent enrichment util.

### 7.2 PII Data Masking
- Store citizen PII (name, phone, address) in **encrypted format** in the database.
- From the backend, **mask PII fields** in search and view API responses for employee roles.
- `showPiiData` flag in `additionalDetails` controls visibility (default: `true` — set to `false` for confidential complaints).
- Employees with `SYSADMIN` or `SUPERVISOR` role may view unmasked data.

**Reference:** Existing PII masking implementation in `egov-user` service.

### 7.3 Application Number Format
Change complaint ID generation format to:
```
PRD-YYYY-XXXXXXX
Example: PRD-2026-0000001
```
Update `IdGenService` configuration for the `pgr.application.id.format` property.

### 7.4 Role-Based Search Filter
| Role | Search Scope |
|---|---|
| CITIZEN | Own complaints only |
| RECEPTIONTECHNICIAN | Complaints created by self |
| ASSIGNMENTOFFICER (Case Manager) | Complaints assigned to self |
| SCREENINGTECHNICIAN | All complaints in SCREENING state |
| SUPERVISOR | All complaints in their department |
| IGE_LEADERSHIP / IGSAE_LEADERSHIP | All complaints in their tenant |
| SYSADMIN | All complaints |

Implement via `RequestSearchCriteria` filters in `PGRQueryBuilder.java`.

### 7.5 File Upload Extensions
Allow: `pdf`, `xlsx`, `jpg`, `jpeg`, `png`
Update file upload validation in the backend service.

---

## 8. Notification Configuration

### 8.1 Channels
| Channel | Pilot | Notes |
|---|---|---|
| SMS (Twilio) | Yes | Validate and correct SMS text templates |
| WhatsApp Outbound (Twilio) | Yes | One option per end-user (SMS or WhatsApp, not both) |
| Email | Optional | For employee notifications only |

**Rule:** End user can enable **either** SMS **or** WhatsApp — not both simultaneously.

### 8.2 Notification Triggers
| Event | Notify Citizen | Notify Employee |
|---|---|---|
| Complaint Registration | Yes | — |
| Assignment (SCREENING → INVESTIGATION) | — | Yes (assigned ASSIGNMENTOFFICER) |
| Request for Information | Yes (CITIZEN) | — |
| Citizen Info Submission | — | Yes (ASSIGNMENTOFFICER) |
| Escalation / Reassignment | — | Yes (SUPERVISOR) |
| Resolution | Yes | — |
| Rejection | Yes | — |
| Reopening | — | Yes (SCREENINGTECHNICIAN) |
| Closure (RATE action) | Yes | — |

**Note:** If complaint was created by a counter operator (RECEPTIONTECHNICIAN), notification still goes to the **citizen's** contact, not the operator.

### 8.3 SMS Templates
- Review and correct all SMS text templates for PGR module.
- Validate all outbound WhatsApp message formats.
- Identify all places in pgr-services where SMS trigger should fire.

### 8.4 Infrastructure Setup
- Run Novu services via **Ansible**.
- Configure **Twilio** account details.
- Register and configure outbound WhatsApp messages in Twilio.

> **Onsite Team to Provide:** Twilio account config, SMS config details, SSL certificate, domain certificate.

---

## 9. Dashboard Requirements

### 9.1 Audience
| Dashboard | Audience |
|---|---|
| Employee Inbox Dashboard | Case Manager, Supervisor |
| Department Dashboard | Supervisor (filtered by dept + date) |
| National Overview | IGE Leadership, IGSAE Leadership, Presidency |

### 9.2 Filter Options
- Department (for Supervisor and below)
- Date Range
- Tenant (IGE / IGSAE) — for leadership

### 9.3 KPI Sections

**Section 1 – Volume Indicators**
| KPI | Description |
|---|---|
| Total Complaints Received | Count all registered complaints |
| Open Complaints | Complaints not yet resolved/closed |
| Complaints by Status | Count per workflow state |
| Complaints by Category | Complaint / Grievance / Petition |
| Complaints by Authority | IGE vs IGSAE |

**Section 2 – Performance Indicators**
| KPI | Description |
|---|---|
| Average Resolution Time | Avg days from APPLY to RESOLVED |
| SLA Compliance Rate | % complaints resolved within SLA |
| Overdue Complaints | Complaints exceeding SLA |
| Complaints Pending > N Days | Configurable threshold |

**Section 3 – IGSAE-Specific Indicators**
| KPI | Description |
|---|---|
| Complaints by Sector (IGSAE) | Commerce / Health / Transport etc. |
| Top Complaint Types (IGSAE) | Ranked by volume |
| Complaints by Province (IGSAE) | Locality-wise breakdown |

**Section 4 – IGE-Specific Indicators**
| KPI | Description |
|---|---|
| Complaints by Department (IGE) | All 105 departments |
| Top Complaint Types (IGE) | Ranked by volume |
| Complaints by Province (IGE) | Locality-wise breakdown |

### 9.4 Known Constraint
Department-level reporting currently relies on the `department` field saved during ASSIGN action (see §7.1). Until this is implemented, department-wise dashboard will show data based on user's department assignment only.

---

## 10. Security & Access Control

### 10.1 Role-Based Access Control (RBAC)
All workflow actions gated by role (see §5.4).

### 10.2 Department-Based Access Control
- Employees see only complaints belonging to their department.
- SCREENINGTECHNICIAN sees all complaints in SCREENING state (cross-department).
- SUPERVISOR sees all complaints in their department (all states).

### 10.3 Jurisdiction / Locality-Based Access
- Employees assigned to specific provinces/districts see only complaints from those localities.
- Boundary hierarchy: Province → District → Administrative Post.
- Configured via HRMS `jurisdictions[]` field on employee records.

### 10.4 Inbox Visibility Rules
| Role | Inbox Shows |
|---|---|
| ASSIGNMENTOFFICER | Only complaints **assigned to that user** |
| SUPERVISOR | **All complaints** in their department |
| SCREENINGTECHNICIAN | All complaints in SCREENING state |
| IGE_LEADERSHIP | All complaints under mz.IGE |
| IGSAE_LEADERSHIP | All complaints under mz.IGSAE |

---

## 11. Enhancements – Ordered Development Plan

The following table lists all enhancements from the SDD in **recommended development order**, grouped by dependency layer.

---

### Phase 1 – Foundation (Pre-development, Blocking Everything Else)
> Data from onsite team required before this phase.

| # | Enhancement | Type | Input Required |
|---|---|---|---|
| 1.1 | Create tenants `mz.IGE` and `mz.IGSAE` in DIGIT platform | Config | — |
| 1.2 | Load boundary data (Province, District, Administrative Post) | Master Data | Onsite team |
| 1.3 | Load Authority Type master (`IGE`, `IGSAE`) | MDMS | — |
| 1.4 | Load Complaint Category master (Complaint, Grievance, Petition) | MDMS | — |
| 1.5 | Load Sector master (11 sectors) | MDMS | — |
| 1.6 | Load Department master for mz.IGE (105) and mz.IGSAE (17) | MDMS | Onsite team |
| 1.7 | Add Designations (Screening Technician, Reception Technician, Supervisor, Case Manager) | MDMS | — |
| 1.8 | Load Complaint Type (ServiceDefs) with `authorityType`, `category`, `sector` | MDMS | Onsite team |
| 1.9 | Load Complaint Type → Department mapping | MDMS | Onsite team |
| 1.10 | Create employee accounts (Case Manager + Supervisor per department) | Data Load | Onsite team |
| 1.11 | Set Portuguese as default language | Config | — |

---

### Phase 2 – Workflow & ID Configuration
> Can begin once Phase 1 foundation is stable.

| # | Enhancement | Type | Effort |
|---|---|---|---|
| 2.1 | Load 4-level PGR workflow (APPLY → SCREENING → INVESTIGATION → PENDINGINFORMATION → PENDINGATLME → RESOLVED → CLOSED) | Workflow Config | Medium |
| 2.2 | Configure SLA = 432,000,000 ms (5 days) at workflow level | Config | Low |
| 2.3 | Confirm SLA pause/resume behavior during PENDINGINFORMATION | Design Decision | Low |
| 2.4 | Change application ID format to `PRD-YYYY-XXXXXXX` via IdGen config | Config | Low |

---

### Phase 3 – Backend Changes
> Core backend enhancements. Should be parallelized where possible.

| # | Enhancement | Type | Effort | Priority |
|---|---|---|---|---|
| 3.1 | **Department tracking on ASSIGN** – save `department` to `additionalDetails` on first forward | Backend | Medium | P0 (blocks dashboard) |
| 3.2 | **Role-based inbox/search filter** – ASSIGNMENTOFFICER sees only own, SUPERVISOR sees full dept | Backend | Medium | P0 |
| 3.3 | **PII data masking** – encrypt citizen PII; mask in search/view responses for employees | Backend | High | P1 |
| 3.4 | **`additionalDetails` schema extension** – add `dateOfFact`, `instituteName`, `instituteAddress`, `witnessName`, `witnessNote`, `location`, `confidential`, `category` | Backend | Medium | P1 |
| 3.5 | **File upload extension** – allow PDF, XLSX, JPG, PNG as evidence attachments | Backend | Low | P1 |
| 3.6 | **Mandatory attachment enforcement** – at PENDINGINFORMATION state, reject action if no attachment | Backend | Low | P1 |
| 3.7 | **Complaint created by counter operator** – ensure citizen (not operator) receives notifications | Backend | Medium | P1 |

---

### Phase 4 – UI / Frontend Changes
> Depends on Phase 3 `additionalDetails` schema.

| # | Enhancement | Type | Effort | Priority |
|---|---|---|---|---|
| 4.1 | Remove `Pincode` field from complaint registration screen | UI | Low | P0 |
| 4.2 | Add `Complainant Address` and `Email` fields | UI | Low | P0 |
| 4.3 | Add `Case Related To` (Authority Type selector – IGE / IGSAE) | UI | Medium | P0 |
| 4.4 | Add `Submission Type` (Complaint / Grievance / Petition) selector | UI | Low | P0 |
| 4.5 | Add `Report Category` (Sector) dropdown | UI | Low | P0 |
| 4.6 | Rename `Report Description` dynamically based on category | UI | Low | P1 |
| 4.7 | Add `Date of Fact` date picker (past dates allowed) | UI | Low | P0 |
| 4.8 | Add `Witness` section (Name + Address + Observation) | UI | Medium | P1 |
| 4.9 | Add `Institution Name` / `Related Institution` field (conditional label by Authority Type) | UI | Low | P1 |
| 4.10 | Add `Institution Address` field | UI | Low | P1 |
| 4.11 | Add `Do you prefer confidential?` radio button | UI | Low | P1 |
| 4.12 | Add consent checkboxes (Declaration of Truthfulness + Data Processing Authorization) – mandatory | UI | Low | P0 |
| 4.13 | Add attachment types: Photograph, Documents, Evidence (IGSAE) | UI | Medium | P1 |
| 4.14 | Rearrange complaint form field order per IGE requirements | UI | Low | P1 |
| 4.15 | Filter complaint types in UI by selected Authority Type (IGE/IGSAE) | UI | Medium | P0 |

---

### Phase 5 – Notification Configuration
> Depends on Phase 3 notification trigger changes.

| # | Enhancement | Type | Effort | Priority |
|---|---|---|---|---|
| 5.1 | Validate and correct all SMS text templates in PGR module | Config | Medium | P0 |
| 5.2 | Validate outbound WhatsApp message formats | Config | Medium | P0 |
| 5.3 | Identify and wire all SMS trigger points in pgr-services | Backend | Medium | P0 |
| 5.4 | Add employee email notification on complaint assignment | Backend | Medium | P1 |
| 5.5 | Enforce SMS-or-WhatsApp exclusivity (not both) per end-user | Backend/UI | Medium | P1 |
| 5.6 | Run Novu services via Ansible | DevOps | Medium | P0 |
| 5.7 | Configure Twilio account + register outbound WhatsApp in Twilio | DevOps | Medium | P0 |

---

### Phase 6 – Dashboard
> Depends on Phase 3.1 (department tracking).

| # | Enhancement | Type | Effort | Priority |
|---|---|---|---|---|
| 6.1 | Employee inbox dashboard with status KPIs (department + date filter) | Frontend | High | P1 |
| 6.2 | Volume Indicators section (total, open, by status, by category, by authority) | Frontend | Medium | P1 |
| 6.3 | Performance Indicators section (avg resolution time, SLA compliance, overdue) | Frontend | Medium | P1 |
| 6.4 | IGSAE-specific dashboard (by sector, top complaint types, by province) | Frontend | Medium | P2 |
| 6.5 | IGE-specific dashboard (by department, top types, by province) | Frontend | Medium | P2 |
| 6.6 | National overview for Leadership / Presidency (consolidated cross-tenant) | Frontend | High | P2 |

---

### Phase 7 – Future Enhancements (Post-Pilot)
| # | Enhancement | Notes |
|---|---|---|
| 7.1 | WhatsApp inbound complaint submission | Next release |
| 7.2 | Auto-assignment based on jurisdiction + complaint type | Requires jurisdiction mapping per employee |
| 7.3 | Auto-escalation based on SLA breach | Requires `AUTO_ESCALATE` role + scheduler |
| 7.4 | Workflow Configurator UI | Low-code workflow editing tool |
| 7.5 | Consent-based citizen data masking toggle | UI flag to reveal/hide PII |
| 7.6 | Dynamic department and complaint type management via UI | Admin configurability |
| 7.7 | Public-facing complaint tracking dashboard | Citizen-accessible status page |
| 7.8 | Jurisdiction-based auto-routing to employees (ward/district level) | Extend HRMS `jurisdictions[]` field |

---

## Appendix A – Onsite Team Deliverables Checklist
| # | Item | Status |
|---|---|---|
| A1 | Department list – IGE (105 departments with codes) | Pending |
| A2 | Department list – IGSAE (17 departments with codes) | Pending |
| A3 | Designation mapping per department | Pending |
| A4 | Complaint type list with sector and authority type | Pending |
| A5 | Complaint type → Department mapping | Pending |
| A6 | Boundary hierarchy data (Province, District, Administrative Post) | Pending |
| A7 | Employee data (name, designation, department, mobile) | Pending |
| A8 | Twilio account credentials and SMS config | Pending |
| A9 | SSL and domain certificates | Pending |

---

## Appendix B – Open / Pending Decisions
| # | Decision | Owner | Notes |
|---|---|---|---|
| B1 | SLA pause/resume during PENDINGINFORMATION state | Business / IGE | Needs confirmation |
| B2 | Which complaint types map to which departments (full list) | Onsite team | — |
| B3 | PII masking — which roles can see unmasked citizen data | Business | Supervisor? Leadership? |
| B4 | Email notification — configure SMTP or use Novu email channel | Tech | — |
| B5 | `menuPath` field in ServiceDefs — rename to `sector` or keep and repurpose | Tech | Backward compat check needed |
| B6 | Portuguese default language — verify auto-load post-install | Tech | Action: verify in dev env |
