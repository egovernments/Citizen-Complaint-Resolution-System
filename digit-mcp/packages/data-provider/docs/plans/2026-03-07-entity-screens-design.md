# Entity Screens Design

## Goal

Replace the CRS management tab's hand-rolled data layer with `@digit-mcp/data-provider` and build List/Show/Edit screens for every DIGIT entity with full cross-linking between related entities.

## Architecture

**Approach C (Hybrid):** Dedicated components for 8 core entities with complex relationships. Read-only dedicated screens for 5 reference entities. One generic schema-driven component set for 20+ simple MDMS resources.

**Data layer:** `@digit-mcp/data-provider` package provides `DigitApiClient`, `createDigitDataProvider()`, `createDigitAuthProvider()`, and the resource registry. Installed via `file:` dependency from the monorepo.

**Cross-linking:** Every foreign key renders as a clickable `EntityLink` component that navigates to the referenced entity's Show page. The link resolves the entity's display name by fetching from the data provider.

## Entity Relationship Map

```
Tenant
  ├── Department ◄── ComplaintType.department
  │       ▲
  │       └── Employee.assignment.department
  ├── Designation ◄── Employee.assignment.designation
  ├── Employee ◄── Complaint.assignee
  │       ├── User (nested .user)
  │       │     └── Roles[] ◄── AccessRole
  │       └── Boundary ◄── Employee.jurisdiction.boundary
  │              ▲
  │              └── Complaint.address.locality
  ├── Localization (labels for all codes)
  ├── BoundaryHierarchy (defines levels)
  └── WorkflowBusinessService ◄── Complaint workflow
        └── WorkflowProcess[] (audit trail per complaint)

  MdmsSchema (defines structure of all MDMS entities)
```

### Cross-Link Table

| Source Field | Target Resource | Link By |
|---|---|---|
| `ComplaintType.department` | departments | code |
| `Employee.assignments[].department` | departments | code |
| `Employee.assignments[].designation` | designations | code |
| `Employee.jurisdictions[].boundary` | tenants | code |
| `Employee.user.roles[].code` | access-roles | code |
| `Complaint.serviceCode` | complaint-types | serviceCode |
| `Complaint.address.locality.code` | boundaries | code |
| `WorkflowProcess.businessId` | complaints | serviceRequestId |

## Core Entities (8 — dedicated List/Show/Edit)

### Departments

**Fields:** `code`, `name`, `active`, `description`

- **List:** code, name, active (chip), description. Sortable by code/name. Filter by active.
- **Show:** All fields + reverse links: "Complaint Types in this department", "Employees assigned to this department".
- **Edit:** name (text), active (toggle), description (text). Code is read-only.

### Designations

**Fields:** `code`, `name`, `active`, `description`

- **List:** code, name, active (chip), description.
- **Show:** All fields + reverse link: "Employees with this designation".
- **Edit:** name (text), active (toggle), description (text). Code is read-only.

### Complaint Types

**Fields:** `serviceCode`, `name`, `department`, `slaHours`, `menuPath`, `active`, `keywords`

- **List:** serviceCode, name, department (EntityLink → departments), slaHours, active (chip).
- **Show:** All fields. department as link. keywords as tag chips. + reverse link: "Recent complaints of this type".
- **Edit:** name, department (dropdown picker), slaHours (number), menuPath, active (toggle), keywords (text). serviceCode read-only.

### Employees

**Fields:** Top: `code`, `employeeStatus`, `employeeType`, `isActive`, `dateOfAppointment`. Nested: `user.name`, `user.userName`, `user.mobileNumber`, `user.gender`, `user.roles[]`. Sub-arrays: `assignments[]` (department, designation, isCurrentAssignment), `jurisdictions[]` (hierarchy, boundaryType, boundary).

- **List:** code, user.name, user.mobileNumber, employeeStatus (chip), current assignment department (EntityLink), current assignment designation (EntityLink), isActive (chip).
- **Show:** Sections: Header (code, name, mobile, status, type, active), User (userName, gender, dob, roles → each links to AccessRole), Assignments (table: department → link, designation → link, fromDate, isCurrent), Jurisdictions (table: hierarchy, boundaryType, boundary → link). + reverse link: "Complaints assigned to this employee".
- **Edit:** User fields: name, mobileNumber, gender (dropdown). Assignment: department (dropdown), designation (dropdown). Status: employeeStatus (dropdown), isActive (toggle). Full employee object sent on update.

### Complaints (PGR)

**Fields:** `serviceRequestId`, `serviceCode`, `description`, `applicationStatus`, `source`, `active`, `rating`, `address` (locality.code, city, geoLocation), `citizen` (name, mobileNumber), `auditDetails` (createdTime, lastModifiedTime).

- **List:** serviceRequestId, serviceCode (EntityLink → complaint-types), description (truncated), applicationStatus (colored chip: green=RESOLVED, red=REJECTED, yellow=PENDING*, blue=CLOSED), citizen.name, address.locality.code (EntityLink → boundaries), createdTime (formatted).
- **Show:** Header (serviceRequestId, status chip, rating stars). Details (serviceCode → link, description, source). Citizen (name, mobileNumber). Address (locality → link, city, geoLocation). Timeline: WorkflowProcess instances for this complaint showing action, assignee, comment, timestamp per step. Audit (createdTime, lastModifiedTime).
- **Edit:** Workflow transition only: action dropdown (ASSIGN/RESOLVE/REJECT/REOPEN/RATE), comment (textarea), assignee (employee picker, only for ASSIGN).

### Boundaries

**Fields:** `code`, `boundaryType`, `geometry`, `additionalDetails`, `tenantId`

- **List:** code, boundaryType, tenantId.
- **Show:** All fields. tenantId → link. Parent/children from relationship tree if available.
- **Edit:** additionalDetails (JSON editor). Geometry read-only.

### Localization

**Fields:** `code`, `message`, `module`, `locale`

- **List:** code, message, module, locale. Filter by module. Search by code/message.
- **Show:** All fields.
- **Edit:** message (textarea), module (text), locale (dropdown). Code read-only.

### Users

**Fields:** `uuid`, `userName`, `name`, `mobileNumber`, `gender`, `type`, `active`, `roles[]`, `emailId`, `dob`, `tenantId`

- **List:** userName, name, mobileNumber, type (chip), active (chip), role count badge.
- **Show:** Profile (uuid, userName, name, mobileNumber, emailId, gender, type, active, dob). Roles table (code → link to AccessRole, name, tenantId → link).
- **Edit:** name, mobileNumber, emailId, gender (dropdown), active (toggle). Roles managed separately.

## Read-Only Entities (5 — dedicated List/Show, no Edit)

### Access Roles

- **List:** code, name, description.
- **Show:** All fields + reverse links: "Employees with this role", "Users with this role".

### Workflow Business Services

- **List:** businessService, business, businessServiceSla (formatted).
- **Show:** Header + state machine: table of states with state name, applicationStatus, start/terminate flags, actions (action name, nextState, roles → link to AccessRole).

### Workflow Processes

- **List:** businessId (EntityLink → complaints), action, state, createdTime. Requires businessId filter.
- **Show:** All fields. businessId → link to Complaint. assignee → link to User.

### MDMS Schemas

- **List:** code, tenantId, description, isActive (chip).
- **Show:** All fields. definition as formatted JSON viewer. tenantId → link.

### Boundary Hierarchies

- **List:** hierarchyType, tenantId.
- **Show:** Header + hierarchy levels as vertical chain (Country → State → ... → Locality). tenantId → link.

## Generic MDMS Screens (20+ resources)

One component set shared by all non-dedicated MDMS resources.

- **List:** Auto-detect columns from first record's keys. idField and nameField first, then remaining. Booleans as chips.
- **Show:** Key-value display. JSON objects/arrays in a JSON viewer.
- **Edit:** Text inputs for strings, toggles for booleans, numbers for numbers. idField read-only. Full CRUD via MDMS.

## Navigation Sidebar

```
Tenant Management
  ├── Tenants
  ├── Departments
  ├── Designations
  └── Boundary Hierarchies

Complaint Management
  ├── Complaint Types
  ├── Complaints
  └── Localization

People
  ├── Employees
  └── Users

System
  ├── Access Roles
  ├── Workflow Services
  ├── Workflow Processes
  ├── MDMS Schemas
  └── Boundaries

Configuration (collapsible)
  ├── Roles (MDMS)
  ├── ID Formats
  ├── Gender Types
  ├── Employee Status
  ├── Employee Type
  └── ... (all generic MDMS)
```

## EntityLink Component

Reusable cross-link component. Given resource name and ID, renders a clickable chip that navigates to the Show page.

```tsx
<EntityLink resource="departments" id="DEPT_5" />
// renders: [DEPT_5: Public Works] → navigates to /departments/DEPT_5/show
```

Resolves display name via `useGetOne()` from react-admin, with caching. Falls back to showing the raw code if fetch fails.
