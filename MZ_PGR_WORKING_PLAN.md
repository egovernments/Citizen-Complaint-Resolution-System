# Mozambique PGR – Working Plan
**Project:** IGE / IGSAE Complaint Management System
**Platform:** DIGIT PGR (CCRS)
**Date:** 2026-06-12 | **Status:** Active

---

## Quick Reference

| Item | Value |
|---|---|
| Root Tenant | `mz` |
| Child Tenants | `mz.ige`, `mz.igsae` |
| IGE Departments | 105 |
| IGSAE Departments | 17 |
| Boundary Levels | Province → District → Administrative Post (+ Locality as text) |
| Default Language | Portuguese (pt) |
| Application ID Format | `PRD-YYYY-0000001` |
| Workflow SLA | 5 days (432,000,000 ms) |
| Notification Channels | SMS + WhatsApp (Twilio via Novu) |

---

## Work Streams

There are **5 parallel tracks**. Some have hard dependencies on the Onsite Team data delivery.

```
Track A  │ Infrastructure & Tenant Setup
Track B  │ Master Data & MDMS Configuration
Track C  │ Backend Engineering
Track D  │ Frontend / UI Engineering
Track E  │ Notifications, DevOps & Deployment
```

---

## Milestone Overview

| Milestone | Target | Gate |
|---|---|---|
| M0 – Kickoff & Data Collection | Week 1 | Onsite data template sent |
| M1 – Tenants + Workflow Loaded | Week 2 | Workflow running in DEV |
| M2 – Backend Changes Complete | Week 4 | All APIs passing tests |
| M3 – UI Changes Complete | Week 5 | Form + inbox working in DEV |
| M4 – Notifications Live | Week 5 | SMS + WhatsApp delivered in UAT |
| M5 – UAT Ready | Week 6 | End-to-end test pass |
| M6 – Production | Week 8 | Go-live sign-off |

---

## Sprint Plan (2-Week Sprints)

---

### Sprint 0 – Week 1: Kickoff & Unblocking (All Tracks)

**Goal:** Remove blockers. Get onsite data. Align team on scope.

#### Track A – Infrastructure
| Task | Owner | Done When |
|---|---|---|
| A0.1 Provision DEV environment for `mz`, `mz.ige`, `mz.igsae` | DevOps | Tenants accessible |
| A0.2 Verify Portuguese language pack is loaded as default | DevOps | Login screen shows Portuguese |
| A0.3 Confirm IdGen service is deployed and configurable | DevOps | IdGen API responding |
| A0.4 Set up Novu service (via Ansible) in DEV | DevOps | Novu health check passes |

#### Track B – Master Data
| Task | Owner | Done When |
|---|---|---|
| B0.1 Share data collection templates with onsite team | PM/Tech | Templates sent |
| B0.2 Draft Authority Type MDMS JSON (`mz`, `mz.ige`, `mz.igsae`) | Backend | File ready for review |
| B0.3 Draft Complaint Category MDMS JSON (Complaint, Grievance, Petition) | Backend | File ready |
| B0.4 Draft Sector MDMS JSON (11 sectors) | Backend | File ready |
| B0.5 Draft Designation master (Screening Tech, Reception Tech, Supervisor, Case Manager) | Backend | File ready |
| B0.6 Review workflow JSON from Spreadsheet | Backend | Gaps identified |

#### Track C – Backend
| Task | Owner | Done When |
|---|---|---|
| C0.1 Audit current `ServiceDefs.json` schema vs new fields needed (`authorityType`, `category`, `sector`) | Backend | Gap list documented |
| C0.2 Audit `eg_pgr_service_v2` `additionalDetails` — list new fields to persist | Backend | Field list confirmed |
| C0.3 Audit `PGRQueryBuilder.java` — identify where role/dept filters must be added | Backend | Code locations marked |
| C0.4 Audit IdGen config — document change needed for `PRD-YYYY-XXXXXXX` format | Backend | Config key identified |
| C0.5 Audit notification trigger points in `pgr-services` | Backend | List of trigger locations ready |

#### Track D – Frontend
| Task | Owner | Done When |
|---|---|---|
| D0.1 Identify all complaint registration form components | Frontend | Component list ready |
| D0.2 Map current fields vs new fields required — produce delta list | Frontend | Delta document done |
| D0.3 Confirm inbox component used for filtering (department / role / assignment) | Frontend | Component identified |

#### Track E – Notifications
| Task | Owner | Done When |
|---|---|---|
| E0.1 List all existing SMS templates in `pgr-services` | Backend | Template list ready |
| E0.2 Identify new SMS provider details from IGE team | PM | Provider API docs received |
| E0.3 Draft Twilio/WhatsApp setup checklist for onsite team | DevOps | Checklist sent |

**Sprint 0 Exit Gate:** Onsite data templates sent; DEV environment live; all code audit gaps documented.

---

### Sprint 1 – Week 2: Foundation (Tracks A, B)

**Goal:** Load tenants, roles, workflow, and application ID format. Unblock all other tracks.

#### Track A – Infrastructure
| Task | Owner | Done When |
|---|---|---|
| A1.1 Create tenants `mz.ige` and `mz.igsae` with proper hierarchy | DevOps | Tenants visible in MDMS |
| A1.2 Configure IdGen format: `PRD-[YEAR]-[SEQ:7]` | DevOps/Backend | New complaints use `PRD-2026-0000001` |
| A1.3 Configure boundary hierarchy definition (3 levels: Province, District, Administrative Post) | DevOps | Boundary API returns structure |

#### Track B – Master Data
| Task | Owner | Done When |
|---|---|---|
| B1.1 Load Authority Type master | Backend | MDMS returns IGE, IGSAE |
| B1.2 Load Complaint Category master | Backend | MDMS returns Complaint, Grievance, Petition |
| B1.3 Load Sector master (11 sectors) | Backend | MDMS returns all sectors |
| B1.4 Load Designation master | Backend | MDMS returns 4 designations |
| B1.5 Load Workflow roles: CITIZEN, RECEPTIONTECHNICIAN, SCREENINGTECHNICIAN, ASSIGNMENTOFFICER, SUPERVISOR, PGR_VIEWER | Backend | Roles active in system |
| B1.6 Load 4-level PGR Workflow (from Spreadsheet JSON) | Backend | Workflow API returns all states |
| B1.7 Configure workflow SLA = 432,000,000 ms (5 days) | Backend | SLA visible in workflow config |
| B1.8 Configure mandatory document upload at `PENDINGINFORMATION` state | Backend | Upload blocks action if missing |

> **Dependency:** B1.6 requires workflow JSON from the spreadsheet to be verified and finalized first.

**Sprint 1 Exit Gate:** New complaint created with `PRD-2026-XXXXXXX` ID; workflow progresses through all states in DEV.

---

### Sprint 2 – Weeks 3–4: Backend Engineering (Track C)

**Goal:** Implement all backend changes — department tracking, PII, role-based filters, form fields.

All tasks below are in `pgr-services` (Java) unless noted.

#### C2.1 – Department Field Capture on Assignment (P0)
| Step | Detail |
|---|---|
| **What** | On first `ASSIGN` action (SCREENING → INVESTIGATION), read assignee's `department` from HRMS and save to `eg_pgr_service_v2.additionalDetails.department` if field is currently empty |
| **File** | `ServiceRequestEnrichmentService.java` or equivalent enrichment util |
| **Why** | Without this, department-level dashboard and search are impossible |
| **Done When** | `additionalDetails.department` populated after first ASSIGN; API response includes it |

#### C2.2 – additionalDetails Schema Extension (P0)
| Step | Detail |
|---|---|
| **What** | Persist new fields in `additionalDetails`: `dateOfFact`, `instituteName`, `instituteAddress`, `witnessName`, `witnessNote`, `location`, `confidential`, `category`, `showPiiData` (default: true), `submissionChannel` |
| **File** | `ServiceRequest.java` model + `ServiceRequestRepository.java` |
| **Done When** | All fields saved and returned in GET API response |

#### C2.3 – Application ID Format Change (P0)
| Step | Detail |
|---|---|
| **What** | Update IdGen config: `pgr.application.id.format = PRD-[cy:yyyy]-[SEQ:07d]` |
| **File** | `application.properties` / IdGen service config |
| **Done When** | All new complaints receive `PRD-2026-XXXXXXX` format IDs |

#### C2.4 – Role-Based Inbox / Search Filter (P0)
| Step | Detail |
|---|---|
| **What** | Filter complaints in `PGRQueryBuilder.java` based on role: ASSIGNMENTOFFICER → own complaints only; SUPERVISOR → full department; SCREENINGTECHNICIAN → SCREENING state only; Leadership → full tenant |
| **File** | `PGRQueryBuilder.java`, `RequestSearchCriteria.java` |
| **Done When** | Each role sees only permitted complaints in inbox and search |

#### C2.5 – Department-Based Access Control (P0)
| Step | Detail |
|---|---|
| **What** | When employee logs in, fetch their `department` from HRMS and add as filter in search/inbox query. Health dept employees cannot see Transport dept complaints. |
| **File** | `PGRQueryBuilder.java` + `HRMSUtil.java` |
| **Done When** | Cross-department complaints invisible to wrong dept users |

#### C2.6 – Complaint Type → Department Lookup Change (P1)
| Step | Detail |
|---|---|
| **What** | Change department lookup to resolve from tenant first (`mz.ige` / `mz.igsae`), then fall back to country (`mz`). Currently defaults to country level only. |
| **File** | MDMS call in `ServiceDefs` loader / enrichment |
| **Done When** | Complaint type shows tenant-specific departments |

#### C2.7 – PII Data Masking (P1)
| Step | Detail |
|---|---|
| **What** | Mask PII in API responses for employee roles. Mobile: `84XXXXXXX`, Email: `pr***@domain.com`. Controlled by `showPiiData` flag in `additionalDetails`. |
| **File** | `UserUtils.java` / response enrichment layer |
| **Done When** | Employee role cannot see full mobile/email in search or view; SUPERVISOR/SYSADMIN can |

#### C2.8 – File Upload Extension (P1)
| Step | Detail |
|---|---|
| **What** | Allow PDF, XLSX, JPG, PNG as evidence attachments. Update validation. |
| **File** | File upload service / filestore integration |
| **Done When** | All listed formats accepted; others rejected with error |

#### C2.9 – Notification: Employee Assignment Alert (P1)
| Step | Detail |
|---|---|
| **What** | When a complaint is assigned to an employee (any ASSIGN action), trigger notification to assignee (email/SMS). Currently only citizen gets notified. |
| **File** | `NotificationService.java` + notification event list |
| **Done When** | Employee receives notification on assignment in all configured channels |

#### C2.10 – Consent Fields Storage (P1)
| Step | Detail |
|---|---|
| **What** | Store consent acknowledgments (`declarationOfTruthfulness: true`, `dataProcessingConsent: true`) in `additionalDetails` at complaint creation. |
| **File** | `ServiceRequest.java` + create validation |
| **Done When** | Consent flags persisted and returned in GET |

**Sprint 2 Exit Gate:** All P0 backend tasks pass unit tests. Department tracking verified. Role-based inbox tested with 3 different role logins.

---

### Sprint 3 – Week 5: Frontend Engineering (Track D)

**Goal:** Implement all complaint registration form and inbox changes.

#### D3.1 – Remove Pincode Field (P0)
Remove `Pincode` input from complaint registration form.

#### D3.2 – New Fields: Core (P0)
Add the following to the complaint form (in order of display):

| Field | Component | Validation |
|---|---|---|
| Case Related To (Authority Type) | Dropdown: IGE / IGSAE | Required |
| Submission Type | Radio: Complaint / Grievance / Petition | Required |
| Report Category (Sector) | Dropdown — filtered by Authority Type | Required |
| Complaint Sub-Type | Dropdown — filtered by Sector | Required |
| Date of Fact | Date picker — past dates only | Optional |
| Complainant Address | Text area | Optional |
| Email ID | Email input with validation | Optional |
| Do you prefer confidentiality? | Radio: Yes / No | Required |

#### D3.3 – New Fields: Incident Details (P1)
| Field | Component | Notes |
|---|---|---|
| Institution Name | Text | Label = "Institution Name" (IGE) / "Related Institution / Public Service" (IGSAE) — conditional on Case Related To |
| Institution Address | Text area | — |
| Location | Text field | Incident location, separate from Complainant Address |

#### D3.4 – Witness Section (P1)
Support adding one or more witnesses. Each witness entry:
```
Witness Name         [text input]
Witness Address      [text input]
Witness Observation  [text area]
[+ Add Another Witness]
```
Store as array in `additionalDetails.witnesses[]`.

#### D3.5 – Consent Checkboxes (P0)
Add before form submission button. Both must be checked to submit:
```
[ ] Declaration of Truthfulness
    "I declare that the information provided is true."

[ ] Data Processing Authorization
    "I authorize the processing of my personal data for
     the purpose of handling this submission."
```
Show error if unchecked on submit attempt.

#### D3.6 – Enhanced Attachments (P1)
- Allow: PDF, XLSX, JPG, PNG
- Show attachment type selector for IGSAE: Photograph / Document / Evidence
- Remove file type restrictions for the above formats

#### D3.7 – Rename Description Field (P1)
Dynamically change label of description field based on Submission Type:
- Complaint → "Complaint Description"
- Grievance → "Grievance Description"
- Petition → "Petition Content"

#### D3.8 – Submission Channel Field (P2)
Hidden field auto-populated based on login context:
- Web → `WEB_PORTAL`
- Counter login → `WALK_IN_COUNTER`

#### D3.9 – Inbox / Search UI Restrictions (P0)
Apply role-based inbox filters on the frontend:
- ASSIGNMENTOFFICER: show only "Assigned to Me" tab, hide "All Department" tab
- SUPERVISOR: show "All Department" tab; department filter pre-populated
- SCREENINGTECHNICIAN: show all SCREENING state complaints

#### D3.10 – Complaint Type Cascade (P0)
When user selects Authority Type → filter Sectors shown.
When user selects Sector → filter Complaint Sub-Types shown.
Drive from MDMS master data.

**Sprint 3 Exit Gate:** Full complaint form rendered in DEV. Cascade dropdowns working. Consent blocks submission when unchecked. Role-based inbox visible.

---

### Sprint 4 – Week 5 (parallel to D): Notifications & DevOps (Track E)

**Goal:** Notifications live in UAT.

#### E4.1 – SMS Templates Validation (P0)
| Task | Detail |
|---|---|
| List all PGR SMS templates | Extract from `pgr-services` notification config |
| Validate content & placeholders | Check character limits, variable names |
| Correct formats | Update templates with Portuguese content |
| Confirm with IGE SMS provider | Submit templates for provider approval |

#### E4.2 – Novu Deployment (P0)
| Task | Detail |
|---|---|
| Deploy Novu via Ansible to DEV | Run ansible playbook, verify health |
| Configure Twilio in Novu | Account SID, Auth Token, WhatsApp Sender Number |
| Configure notification templates in Novu | Map each PGR event to template |
| Test SMS delivery end-to-end | Trigger complaint creation, verify SMS received |

#### E4.3 – WhatsApp Outbound Setup (P0)
| Task | Detail |
|---|---|
| Register WhatsApp Business number in Twilio | Onsite team provides number |
| Complete Meta/WhatsApp Business verification | Coordinate with onsite team |
| Configure approved message templates | Per notification event |
| Test outbound WhatsApp delivery | Verify in UAT environment |

#### E4.4 – SMS vs WhatsApp Exclusivity (P1)
| Task | Detail |
|---|---|
| Add preference field to citizen profile | `notificationChannel: SMS | WHATSAPP` |
| Enforce in notification service | Send only to selected channel |
| UI: preference selector in citizen profile | Optional toggle |

#### E4.5 – Employee Email Notifications (P1)
| Task | Detail |
|---|---|
| Configure email channel in Novu | SMTP or Novu email provider |
| Add email notification events | ASSIGN, REASSIGN, ESCALATE |
| Test email delivery | Verify in DEV |

**Sprint 4 Exit Gate:** SMS delivered on complaint creation in UAT. WhatsApp outbound confirmed. Employee gets notified on assignment.

---

### Sprint 5 – Week 6: Master Data Load & UAT Prep (Track B, All)

> **Dependency:** Onsite team data must be received by start of Sprint 5.

#### B5.1 – Load Boundary Data
| Task | Detail |
|---|---|
| Receive boundary file from onsite team | Province, District, Administrative Post |
| Validate format and hierarchy | Run schema check |
| Load into MDMS | Boundary API returns all levels |
| Verify in UI | Locality picker shows 3 levels |

#### B5.2 – Load Department Master
| Task | Detail |
|---|---|
| Receive department list (IGE: 105, IGSAE: 17) | From onsite team |
| Load to `common-masters/Department.json` per tenant | One file per tenant |
| Verify departments visible in complaint form | Department shown in SCREENING assign dropdown |

#### B5.3 – Load Complaint Type (ServiceDefs)
| Task | Detail |
|---|---|
| Receive complaint type list from onsite team | With sector and authority type per type |
| Format into `ServiceDefs.json` with new schema | `authorityType`, `category`, `sector`, `slaHours` |
| Load to MDMS | Complaint type API returns all types |
| Verify cascade in UI | Sector → Sub-type dropdown works |

#### B5.4 – Load Complaint Type → Department Mapping
| Task | Detail |
|---|---|
| Map each complaint type to applicable departments | From onsite team |
| Create `ServiceDefDepartmentMapping.json` | One entry per complaint type |
| Load to MDMS | Mapping API returns correctly |

#### B5.5 – Create Employees
| Task | Detail |
|---|---|
| Receive employee data from onsite team | Name, designation, department, role, jurisdiction |
| Create employees in system | At least 1 Case Manager + 1 Supervisor per department |
| Assign roles | ASSIGNMENTOFFICER, SUPERVISOR etc. |
| Assign jurisdiction | Province/District/Post per employee |
| Verify login + inbox | Employee sees correct dept complaints |

#### B5.6 – UAT Test Plan Execution
| Scenario | Roles Involved |
|---|---|
| Citizen submits complaint via Web | CITIZEN |
| Reception Technician registers complaint at counter | RECEPTIONTECHNICIAN |
| Screening Technician triages and assigns | SCREENINGTECHNICIAN |
| Case Manager investigates, requests info from citizen | ASSIGNMENTOFFICER, CITIZEN |
| Case Manager escalates to Supervisor | ASSIGNMENTOFFICER, SUPERVISOR |
| Supervisor reassigns via PENDINGFORREASSIGNMENT | SUPERVISOR, SCREENINGTECHNICIAN |
| Supervisor resolves complaint | SUPERVISOR |
| Citizen rates and closes | CITIZEN |
| Citizen reopens rejected complaint | CITIZEN |
| Supervisor views all dept complaints | SUPERVISOR |
| Case Manager sees only own complaints | ASSIGNMENTOFFICER |
| Cross-dept access blocked | ASSIGNMENTOFFICER (wrong dept) |
| PII masked for employee | ASSIGNMENTOFFICER |
| SMS received on complaint creation | CITIZEN |
| Employee email on assignment | ASSIGNMENTOFFICER |

**Sprint 5 Exit Gate:** UAT test pass rate > 90%. All P0 bugs fixed. Onsite team signs off on UAT.

---

### Sprint 6 – Weeks 7–8: Production Deployment

| Task | Owner | Done When |
|---|---|---|
| Receive SSL cert + domain from onsite team | PM | Cert in hand |
| Configure DNS for production domain | DevOps | Domain resolves |
| Deploy all services to Production | DevOps | Health checks pass |
| Load all master data to Production | Backend | Data visible in prod |
| Configure Twilio + Novu in Production | DevOps | SMS/WA works in prod |
| Smoke test on Production | QA | 5 test complaints filed and resolved |
| Portuguese language verified in Production | QA | Default language = Portuguese |
| Leadership dashboard visible | QA | Dashboard loads for IGE/IGSAE Leadership |
| Go-live sign-off | PM + IGE/IGSAE | Signed |

---

## Dependency Map

```
Onsite Data  ──────────────────────────────────────────────────────┐
(Departments, Employees,                                           │
 Complaint Types, Boundaries,                               Sprint 5
 Twilio Credentials)                                               │
                                                                   │
Sprint 0 ──► Sprint 1 ──► Sprint 2 ──► Sprint 3 ──► Sprint 5 ──► Sprint 6
(Audit)      (Tenants,    (Backend     (Frontend    (Data Load,   (Production)
              Workflow,    Changes)     Changes)     UAT)
              IdGen)
                │
                └──► Sprint 4 (Notifications) ──► Sprint 5
```

---

## Data Required From Onsite Team

All items below are **blocking** Sprint 5. Request these in Sprint 0.

| # | Item | Format | Needed By |
|---|---|---|---|
| 1 | IGE Department list (105 departments) with codes | Excel / JSON | Sprint 2 start |
| 2 | IGSAE Department list (17 departments) with codes | Excel / JSON | Sprint 2 start |
| 3 | Designation master per department | Excel | Sprint 1 |
| 4 | Complaint type list (with authority type, category, sector) | Excel | Sprint 3 start |
| 5 | Complaint type → Department mapping | Excel | Sprint 3 start |
| 6 | Boundary hierarchy definition (Province, District, Admin Post) | Excel | Sprint 4 start |
| 7 | Boundary data (all provinces, districts, admin posts) | Excel / JSON | Sprint 4 start |
| 8 | Employee data (name, designation, department, mobile, role, jurisdiction) | Excel | Sprint 4 start |
| 9 | Twilio Account SID and Auth Token | Credentials | Sprint 4 start |
| 10 | WhatsApp Business number + approved templates | Credentials | Sprint 4 start |
| 11 | SMS provider API details + approved SMS templates | Credentials | Sprint 4 start |
| 12 | Domain name for UAT and Production | Docs | Sprint 5 |
| 13 | SSL certificate + DNS config | Files | Sprint 6 |

---

## Open Decisions (Must Be Resolved Before Sprint Indicated)

| # | Decision | Owner | Must Resolve By | Impact |
|---|---|---|---|---|
| D1 | SLA pause during `PENDINGINFORMATION`? | IGE Business | Sprint 1 | Workflow SLA config |
| D2 | Which roles can see unmasked PII? (Supervisor only? Leadership too?) | IGE Business | Sprint 2 | PII masking logic |
| D3 | `menuPath` field in ServiceDefs — rename to `sector` or repurpose existing field? | Tech Lead | Sprint 1 | MDMS schema change |
| D4 | Email notification — use Novu email channel or separate SMTP? | Tech + IGE | Sprint 3 | Notification setup |
| D5 | WhatsApp inbound complaints — in scope for pilot? | PM + IGE | Sprint 0 | Scope of Sprint 4 |
| D6 | Witness data — how many witnesses max? | IGE Business | Sprint 3 | UI form design |
| D7 | Dashboard — public-facing optional dashboard needed for pilot? | PM + IGE | Sprint 5 | Frontend scope |
| D8 | New SMS provider (IGE to provide) — API integration or Twilio only? | IGE + Tech | Sprint 3 | Notification integration |

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Onsite team data late | High | Critical | Send templates in Sprint 0; set hard deadline Week 3 |
| R2 | Twilio WhatsApp verification takes 2–3 weeks | High | High | Start WhatsApp registration in Sprint 0 |
| R3 | 105 IGE departments take long to configure | Medium | Medium | Semi-automate via bulk MDMS loader script |
| R4 | SMS provider integration (non-Twilio) delays Sprint 4 | Medium | High | Start SMS template collection in Sprint 0; parallel track |
| R5 | PII masking breaks existing citizen search flows | Medium | High | Test with dedicated test suite before UAT |
| R6 | Portuguese language incomplete (missing keys) | Low | Medium | Run i18n audit in Sprint 0 against new field labels |
| R7 | Workflow JSON from spreadsheet has gaps | Medium | High | Review and dry-run workflow in DEV in Sprint 1 |

---

## Team Assignments

| Track | Work | Team / Person |
|---|---|---|
| Track A | Infrastructure, Tenant setup, DevOps | DevOps Engineer |
| Track B | MDMS, Master data, Workflow config | Backend Engineer 1 |
| Track C | pgr-services Java backend changes | Backend Engineer 2 |
| Track D | Frontend / UI (React) | Frontend Engineer |
| Track E | Novu, Twilio, SMS, Notification wiring | Backend Engineer 1 + DevOps |
| Data Load | Excel → JSON → MDMS load scripts | Backend Engineer 2 |
| QA / UAT | Test case execution | QA Engineer + Onsite team |

---

## Summary: What to Start Immediately (This Week)

### Day 1–2 (Today):
1. Send onsite team data collection template (items 1–13 in Data Required section)
2. Start WhatsApp Business registration with Twilio — **this takes 1–3 weeks**
3. Stand up DEV environment for `mz.ige` and `mz.igsae`
4. Pull and review workflow JSON from Google Spreadsheet — validate all states and transitions

### Day 3–5:
5. Load Authority Type, Complaint Category, Sector, Designation masters to DEV
6. Load workflow + roles
7. Change IdGen format to `PRD-YYYY-XXXXXXX`
8. Begin backend audit (C0.1–C0.5 tasks)

### By End of Week 1:
9. Workflow running end-to-end in DEV with test users
10. All open decisions (D1–D8) assigned to owners with response deadline

---

## Definition of Done (Each Task)

- Code reviewed and merged to `develop` branch
- MDMS data loaded and verified via API call
- Corresponding test (unit or manual) documented
- No regressions in existing complaint flow
- Portuguese labels added for all new UI fields
