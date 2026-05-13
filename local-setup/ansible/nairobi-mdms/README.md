# Nairobi City County MDMS Configuration

MDMS records for the **Nai Pepea** (Nairobi City County Complaints Management System) DIGIT deployment.

**Source**: `NCCG _Nai Pepea__ Project Plan & Tracker Sheet.xlsx`

## Tenant

| Field | Value |
|-------|-------|
| Root tenant | `ke` |
| City tenant | `ke.nairobi` |
| City name | Nairobi City |
| Pilot wards | Makadara (4 wards), Kibra (5 wards) |

## Data Summary

| Category | Count |
|----------|-------|
| Departments | 18 |
| Designations | 29 |
| Complaint types (ServiceDefs) | 37 |
| Employees | 40 |
| Sub-counties (pilot) | 2 (Makadara, Kibra) |
| Wards (pilot) | 9 |

## Departments

| Code | Department |
|------|-----------|
| DEPT_01 | Water and Sewerage |
| DEPT_02 | Electricity |
| DEPT_03 | Finance and Revenue |
| DEPT_04 | Customer Service Centre |
| DEPT_05 | Public Service |
| DEPT_06 | Urban Development and Planning |
| DEPT_07 | Environment |
| DEPT_08 | Lands |
| DEPT_09 | Security and Compliance |
| DEPT_10 | Boroughs and Sub County Administration |
| DEPT_11 | ECD and Vocational Training |
| DEPT_12 | ICT Lab |
| DEPT_13 | Youth Talent and Sports |
| DEPT_14 | Office of the County Attorney |
| DEPT_15 | Innovation and Digital Economy |
| DEPT_16 | Mobility and Works |
| DEPT_17 | Disaster Management |
| DEPT_18 | Administration |

## Boundary Hierarchy (Pilot)

```
Nairobi City (County)
├── Makadara (Sub-County)
│   ├── Harambee
│   ├── Maringo/Hamza
│   ├── Makongeni
│   └── Viwandani
└── Kibra (Sub-County)
    ├── Sarang'ombe
    ├── Makina
    ├── Laini Saba
    ├── Silanga
    └── Mashimoni
```

## Directory Structure

```
nairobi-mdms/
├── README.md
├── boundaries.json              # Boundary hierarchy (reference)
├── employees.json               # Employee list (reference)
└── mdms/
    ├── ACCESSCONTROL-ACTIONS-TEST/
    │   └── actions-test.json
    ├── ACCESSCONTROL-ROLEACTIONS/
    │   └── roleactions.json
    ├── ACCESSCONTROL-ROLES/
    │   └── roles.json
    ├── common-masters/
    │   ├── CronJobAPIConfig.json
    │   ├── Department.json       # 18 Nairobi departments
    │   ├── Designation.json      # 29 designations
    │   ├── GenderType.json
    │   ├── IdFormat.json
    │   ├── StateInfo.json
    │   ├── uiHomePage.json
    │   └── wfSlaConfig.json
    ├── CRS-ADMIN-CONSOLE/
    │   └── adminSchema.json
    ├── DataSecurity/
    │   ├── DecryptionABAC.json
    │   ├── EncryptionPolicy.json
    │   ├── MaskingPatterns.json
    │   └── SecurityPolicy.json
    ├── egov-hrms/
    │   ├── DeactivationReason.json
    │   ├── Degree.json
    │   ├── EmployeeStatus.json
    │   ├── EmployeeType.json
    │   ├── EmploymentTest.json
    │   └── Specalization.json
    ├── egov-location/
    │   └── TenantBoundary.json
    ├── INBOX/
    │   └── InboxQueryConfiguration.json
    ├── RAINMAKER-PGR/
    │   ├── ServiceDefs.json      # 37 complaint types
    │   └── UIConstants.json
    ├── tenant/
    │   ├── citymodule.json       # PGR, HRMS, Workbench modules
    │   └── tenants.json          # ke (root) + ke.nairobi (city)
    └── Workflow/
        ├── AutoEscalation.json
        ├── AutoEscalationStatesToIgnore.json
        ├── BusinessService.json
        ├── BusinessServiceConfig.json
        └── BusinessServiceMasterConfig.json
```

## Complaint Types by Category

| Category | Sub-types | Department | SLA (hrs) |
|----------|-----------|-----------|-----------|
| Water Related | No Water Supply | Water and Sewerage | 72 |
| Finance and Revenue | Incorrect Billing, Payment Not Reflected | Finance and Revenue | 24-48 |
| Parking | Illegal Clamping, Parking Ticket Dispute | Finance and Revenue | 4-48 |
| Land Rates | Land Rates Dispute, Land Rates Clearance | Finance and Revenue | 48-72 |
| Markets | Market Stall Dispute, Illegal Hawking | Boroughs & Sub County Admin | 24-48 |
| Customer Service | Delayed Service, Rude Staff | Customer Service Centre | 8-24 |
| Environment | Illegal Dumping, Water Contamination | Environment | 24-48 |
| Urban Development | Illegal Construction, Planning Permit Delay | Urban Dev & Planning | 48-72 |
| Security | Harassment by Askaris, Noise Pollution | Security & Compliance | 8-24 |
| Mobility and Works | Pothole/Road Damage, Street Light Outage | Mobility and Works | 48-72 |
| Disaster Management | Flooding, Fire Incident | Disaster Management | 4-12 |
| Public Service | Staff Misconduct, Service Delivery Failure | Public Service | 24-48 |
| Lands | Land Ownership Dispute, Surveying Delay | Lands | 72 |
| ECD & Vocational | ECD Facility, Training Quality | ECD & Vocational Training | 48 |
| ICT Lab | Equipment Fault, System Access Issue | ICT Lab | 12-24 |
| Youth & Sports | Sports Facility Damage, Youth Programme | Youth Talent and Sports | 48 |
| County Attorney | Legal Advice Delay, Contract Dispute | Office of County Attorney | 72 |
| Innovation & Digital | Digital Service Outage, Startup Support | Innovation & Digital Economy | 12-72 |
| Administration | Office Services, Document Processing Delay | Administration | 24-48 |

## Generated From

Generated by `gen-nairobi-mdms.js` from the Nai Pepea project tracker Excel sheet.
Standard MDMS configs (roles, workflows, security, HRMS) copied from `bomet-digit-configs` reference.
