# Complaint Search Page — Design Document

**Branch:** `feat/complaint-classification-hierarchy`  
**Author:** Platform Team  
**Date:** 2026-06-21  
**Status:** Draft

---

## 1. Overview

The Complaint Inbox (My Complaints) shows a single employee's assigned or created complaints. This document designs a **dedicated Search page** — separate from the Inbox — that allows the `SUPERUSER` role to search across all complaints in the system using multiple criteria: date range, complaint number, and department.

### Goals

- Provide a centralized search surface for system administrators
- Support cross-complaint lookup using date range, complaint number, and department filters
- Reuse the existing backend search API (`/pgr-services/v2/request/_search`) which already supports all required filter fields
- Gate the page exclusively to the `SUPERUSER` role via navigation guard and route guard

### Non-Goals

- This page does not replace the Inbox; it is a parallel surface
- No complaint editing or status updates from this page (read-only)
- No bulk operations in this iteration
- Citizen-facing UI is not in scope

---

## 2. Target Role

Access is restricted to a single role:

| Role Code    | Display Name         | Rationale                                                    |
|--------------|----------------------|--------------------------------------------------------------|
| `SUPERUSER`  | System Administrator | Full access across all tenants; needs cross-system complaint visibility |

All other roles — including `GRO`, `PGR_LME`, `PGR_VIEWER`, `CITIZEN`, `CSR`, `TICKET_REPORT_VIEWER` — are denied access and redirected to `/dashboard`.

---

## 3. Search Criteria

### 3.1 Date Range (fromDate / toDate)

- Two date pickers: **From** and **To**
- Maps to backend fields: `fromDate` and `toDate` (Unix epoch milliseconds)
- Default: no pre-filled range (returns all when left empty)
- Validation: `toDate` must be ≥ `fromDate`; neither date can be in the future
- Max range: 365 days (to prevent unbounded queries)
- `toDate` is inclusive — sent as end-of-day (`23:59:59.999`) in epoch ms

### 3.2 Complaint Number (serviceRequestId)

- Free-text input
- Maps to backend field: `serviceRequestId`
- Accepts the full complaint number (e.g., `CMP-2024-001234`)
- Client-side: trim whitespace and uppercase before sending
- When entered alongside other filters, all criteria are applied with AND logic

### 3.3 Department

- Single-select dropdown populated from MDMS `ServiceDefs` master
- Maps to the `serviceCode` set — each department owns one or more service codes
- The dropdown groups service codes by their `department` field in the MDMS payload
- On selection, sends `serviceCode` as the full list of service codes belonging to that department
- "All Departments" option (default) sends no `serviceCode` filter

> **Note:** If MDMS `ServiceDefs` records do not yet carry a `department` field, that field must be added as part of this feature. See §8 for the MDMS schema.

---

## 4. UI Design

### 4.1 Route

```
/employee/complaints/search
```

Added to the existing React Router config. Employee routes are prefixed `/employee` to separate them from the citizen path (`/complaints`).

### 4.2 Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Sidebar Nav]          COMPLAINT SEARCH                     │
│  ──────────────                                              │
│  Dashboard              ┌─ Filter Panel ──────────────────┐ │
│  Inbox                  │                                  │ │
│  ▶ Search               │  Complaint No.  [____________]   │ │
│  Profile                │                                  │ │
│                         │  Department     [▼ Select...  ]  │ │
│                         │                                  │ │
│                         │  From Date      [📅 YYYY-MM-DD]  │ │
│                         │  To Date        [📅 YYYY-MM-DD]  │ │
│                         │                                  │ │
│                         │  [Search]  [Clear]               │ │
│                         └──────────────────────────────────┘ │
│                                                              │
│                         ┌─ Results Table ─────────────────┐ │
│                         │ Complaint No │ Dept │ Status │ … │ │
│                         │ ─────────────────────────────── │ │
│                         │ CMP-2024-… │ Water │ Open  │ … │ │
│                         │ …          │ …     │ …     │ … │ │
│                         │                                  │ │
│                         │  ← Prev  [1] [2] [3]  Next →    │ │
│                         └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Results Table Columns

| Column        | Source Field                          | Sortable |
|---------------|---------------------------------------|----------|
| Complaint No. | `serviceRequestId`                    | Yes      |
| Department    | Derived from `serviceCode` via MDMS   | No       |
| Category      | `serviceCode` display label           | No       |
| Status        | `applicationStatus`                   | Yes      |
| Created Date  | `createdTime`                         | Yes      |
| Last Updated  | `lastModifiedTime`                    | Yes      |
| Locality      | `address.locality.name`               | No       |
| Action        | Link → Complaint Detail page          | —        |

Default sort: `createdTime DESC`.

### 4.4 Empty & Loading States

| State            | Behaviour                                                                 |
|------------------|---------------------------------------------------------------------------|
| No search yet    | Prompt card: "Enter search criteria above and click Search."              |
| Loading          | 5 skeleton rows with Tailwind `animate-pulse` shimmer                    |
| No results       | Empty state illustration + "No complaints found matching your criteria." |
| Error            | Radix Toast notification with error message + Retry button               |

### 4.5 Complaint Detail Drill-through

Each row links to the existing complaint detail page:

```
/complaints/:serviceRequestId/show
```

The detail page opens in the same tab. No status-change actions are surfaced from the search context (SUPERUSER can still act from the detail page directly).

---

## 5. Component Architecture

```
pages/
  ComplaintSearchPage.tsx              ← top-level page, owns search state

components/
  complaint-search/
    ComplaintSearchFilters.tsx         ← filter form (date range, number, dept)
    ComplaintSearchResults.tsx         ← results table + pagination
    ComplaintSearchResultRow.tsx       ← single row renderer
    DepartmentSelect.tsx               ← Radix Select for department
    DateRangePicker.tsx                ← dual date input (reusable)

components/
  auth/
    RequireRole.tsx                    ← route-level role guard (new)

hooks/
  useComplaintSearch.ts                ← TanStack Query search hook

utils/
  departmentUtils.ts                   ← MDMS service-code → dept mapping
```

### 5.1 State Shape

```typescript
interface SearchFilters {
  serviceRequestId: string;   // "" = not applied
  departmentCode: string;     // "" = all departments
  fromDate: Date | null;
  toDate: Date | null;
}

interface SearchState {
  filters: SearchFilters;
  committed: SearchFilters | null; // null = no search run yet
  page: number;
  pageSize: number;                // default 20
}
```

`committed` is a snapshot of `filters` captured when the user clicks **Search**. Results are only fetched when `committed !== null`, preventing auto-fetch on every keystroke.

### 5.2 Data Fetching Hook

```typescript
// hooks/useComplaintSearch.ts
function useComplaintSearch(
  filters: SearchFilters | null,
  page: number,
  pageSize: number
): {
  data: Complaint[];
  total: number;
  isLoading: boolean;
  isError: boolean;
}
```

- Wraps the existing `pgrSearch()` in `citizenBridge.ts` with full filter params
- `enabled: filters !== null` (TanStack Query conditional fetch)
- Query key: `['complaint-search', filters, page, pageSize]`
- Fires two parallel requests: `_search` (paginated rows) + `_count` (total for pagination)

**Criteria mapping:**

```typescript
const criteria: RequestSearchCriteria = {
  tenantId: currentUser.tenantId,
  serviceRequestId: filters.serviceRequestId || undefined,
  serviceCode: departmentToServiceCodes(filters.departmentCode) || undefined,
  fromDate: filters.fromDate ? filters.fromDate.getTime() : undefined,
  toDate: filters.toDate ? endOfDay(filters.toDate).getTime() : undefined,
  limit: pageSize,
  offset: page * pageSize,
  sortBy: 'createdTime',
  sortOrder: 'DESC',
};
```

### 5.3 Department Mapping Utility

```typescript
// utils/departmentUtils.ts

interface DepartmentOption {
  code: string;           // e.g. "WATER_SUPPLY"
  label: string;          // e.g. "Water Supply & Sanitation"
  serviceCodes: string[]; // e.g. ["NoWater", "WaterLeakage"]
}

function buildDepartmentOptions(serviceDefs: ServiceDef[]): DepartmentOption[]
function departmentToServiceCodes(deptCode: string, opts: DepartmentOption[]): string[] | undefined
```

---

## 6. Role-Based Access Control

### 6.1 Navigation Guard

The Search link appears in the sidebar **only** when the authenticated user has the `SUPERUSER` role:

```typescript
// In the employee/admin layout nav array
const nav = [
  { to: '/dashboard',                    label: 'Dashboard', icon: LayoutDashboard },
  { to: '/complaints',                   label: 'Inbox',     icon: Inbox },
  ...(hasRole(currentUser, 'SUPERUSER')
    ? [{ to: '/employee/complaints/search', label: 'Search', icon: Search }]
    : []),
  { to: '/profile',                      label: 'Profile',   icon: UserCircle },
];
```

### 6.2 Route Guard

```tsx
// In App.tsx
<Route
  path="/employee/complaints/search"
  element={
    <RequireRole
      role="SUPERUSER"
      fallback={<Navigate to="/dashboard" replace />}
    >
      <ComplaintSearchPage />
    </RequireRole>
  }
/>
```

### 6.3 `RequireRole` Component (New)

```typescript
// components/auth/RequireRole.tsx
interface RequireRoleProps {
  role: string;
  fallback: ReactElement;
  children: ReactElement;
}

function RequireRole({ role, fallback, children }: RequireRoleProps) {
  const { permissions } = usePermissions(); // react-admin hook
  return permissions?.includes(role) ? children : fallback;
}
```

### 6.4 Backend Authorization

Ensure MDMS `ACCESSCONTROL-ROLEACTIONS` includes an action entry for `SUPERUSER`:

```json
{
  "rolecode": "SUPERUSER",
  "actionid": 1700,
  "actioncode": "pgr-services.v2.request._search",
  "tenantId": "pb"
}
```

Also add an entry for `pgr-services.v2.request._count` if it is not already covered by the SUPERUSER wildcard.

---

## 7. API Contract

### 7.1 Search Request

```
POST /pgr-services/v2/request/_search
     ?tenantId={tenantId}
     &serviceRequestId={optional}
     &serviceCode={optional, comma-separated}
     &fromDate={optional, epoch ms}
     &toDate={optional, epoch ms}
     &limit={pageSize}
     &offset={page * pageSize}
     &sortBy=createdTime
     &sortOrder=DESC
```

**Request Body:**
```json
{
  "RequestInfo": {
    "apiId": "Rainmaker",
    "authToken": "<JWT>",
    "userInfo": {
      "uuid": "...",
      "roles": [{ "code": "SUPERUSER" }]
    }
  }
}
```

### 7.2 Count Request

Fires in parallel with the search to enable accurate pagination:

```
POST /pgr-services/v2/request/_count
     ?tenantId={tenantId}&...same filters (no limit/offset)...
```

Response: `{ "count": 142 }`

### 7.3 Search Response

```json
{
  "ResponseInfo": { ... },
  "ServiceWrappers": [
    {
      "service": {
        "serviceRequestId": "CMP-2024-001234",
        "serviceCode": "NoWater",
        "applicationStatus": "OPEN",
        "description": "No water supply since 2 days",
        "createdTime": 1719849600000,
        "lastModifiedTime": 1719936000000,
        "address": {
          "locality": { "code": "SUN01", "name": "Sunshine Colony" },
          "city": "Amritsar"
        }
      },
      "workflow": { "processInstances": [...] }
    }
  ]
}
```

---

## 8. MDMS Data Requirements

### 8.1 Service Defs — Add `department` Field

The existing `ServiceDefs` master in MDMS (`RAINMAKER-PGR` module) must carry a `department` field on each service definition:

```json
{
  "serviceCode": "NoWater",
  "name": "No Water Supply",
  "department": "WATER_SUPPLY",
  "slaHours": 48,
  "menuPath": "Water",
  "active": true
}
```

If `department` is absent today, add it via a MDMS data migration as part of this feature.

### 8.2 Departments Master (New, if needed)

If a standalone department list is needed for dropdown labels:

**Module:** `RAINMAKER-PGR`  
**Master:** `Departments`

```json
[
  { "code": "WATER_SUPPLY",   "name": "Water Supply & Sanitation" },
  { "code": "ROADS_INFRA",    "name": "Roads & Infrastructure"    },
  { "code": "SOLID_WASTE",    "name": "Solid Waste Management"    },
  { "code": "STREET_LIGHTS",  "name": "Street Lights"             },
  { "code": "PARKS_GARDENS",  "name": "Parks & Gardens"           }
]
```

---

## 9. Data Flow Diagram

```
SUPERUSER
  │
  ▼
ComplaintSearchPage
  │  manages SearchState (filters, committed, page)
  │
  ├─► ComplaintSearchFilters
  │     │  fills SearchFilters (serviceRequestId, dept, fromDate, toDate)
  │     │  "Search" → sets committed = snapshot of filters
  │     │  "Clear"  → resets all fields, committed = null
  │     │
  │     └─► DepartmentSelect
  │           │  fetches MDMS ServiceDefs once (React Query cache)
  │           │  buildDepartmentOptions() → DepartmentOption[]
  │           └─► renders Radix Select
  │
  └─► ComplaintSearchResults
        │  receives committed, page, pageSize
        │
        ├─► useComplaintSearch(committed, page, pageSize)
        │     │  enabled only when committed !== null
        │     │  parallel:
        │     │    POST /pgr-services/v2/request/_search   → rows
        │     │    POST /pgr-services/v2/request/_count    → total
        │     └─► { data, total, isLoading, isError }
        │
        ├─► ComplaintSearchResultRow × N
        │     └─► <Link to="/complaints/:id/show">
        │
        └─► Pagination controls
              └─► page change → parent state → new query
```

---

## 10. Permissions Matrix

| Action                               | CITIZEN | CSR | GRO | PGR_LME | PGR_VIEWER | SUPERUSER |
|--------------------------------------|:-------:|:---:|:---:|:-------:|:----------:|:---------:|
| See Search in sidebar                | ✗       | ✗   | ✗   | ✗       | ✗          | ✓         |
| Access `/employee/complaints/search` | ✗       | ✗   | ✗   | ✗       | ✗          | ✓         |
| Search by date range                 | ✗       | ✗   | ✗   | ✗       | ✗          | ✓         |
| Search by complaint number           | ✗       | ✗   | ✗   | ✗       | ✗          | ✓         |
| Search by department                 | ✗       | ✗   | ✗   | ✗       | ✗          | ✓         |
| View complaint detail (drill-through)| ✗       | ✗   | ✗   | ✗       | ✗          | ✓         |

---

## 11. Validation Rules

| Field              | Rule                                           | Error Message                                     |
|--------------------|------------------------------------------------|---------------------------------------------------|
| `fromDate`         | Must be ≤ today                                | "From date cannot be in the future"               |
| `toDate`           | Must be ≥ `fromDate`                           | "To date must be on or after the from date"       |
| Date range span    | Max 365 days between `fromDate` and `toDate`   | "Date range cannot exceed 365 days"               |
| `serviceRequestId` | Alphanumeric + hyphens, max 64 chars           | "Invalid complaint number format"                 |
| At least one filter| At least one field must be filled before Search| "Please enter at least one search criterion"      |

---

## 12. Pagination

- Default page size: **20 rows**
- Max page size: **50 rows**
- Backend `limit` / `offset` pagination (not cursor-based)
- Page controls: Previous / Next + up to 5 visible page number buttons
- `_count` fires in parallel with the first `_search` to pre-calculate total pages
- On new Search click: always reset to page 1

---

## 13. URL State (Deep Linking)

Search state is reflected in the URL query string so the SUPERUSER can bookmark or share searches:

```
/employee/complaints/search?serviceRequestId=CMP-2024-001234&dept=WATER_SUPPLY&from=2024-01-01&to=2024-06-30&page=1
```

Use React Router 7's `useSearchParams` to:
- Initialise form state from URL params on mount
- Update URL on every Search click (without browser history push — use `replace`)

---

## 14. Implementation Steps

| Step | Task                                               | File(s) to Create / Modify                                      |
|------|----------------------------------------------------|-----------------------------------------------------------------|
| 1    | Add `department` field to MDMS `ServiceDefs`       | MDMS data files (`RAINMAKER-PGR/ServiceDefs`)                   |
| 2    | Create `departmentUtils.ts`                        | `digit-ui-v2/src/utils/departmentUtils.ts`                      |
| 3    | Create `DepartmentSelect` component                | `digit-ui-v2/src/components/complaint-search/DepartmentSelect.tsx` |
| 4    | Create `DateRangePicker` component                 | `digit-ui-v2/src/components/complaint-search/DateRangePicker.tsx` |
| 5    | Extend `citizenBridge.ts` to pass full search params | `digit-ui-v2/src/providers/citizenBridge.ts`                  |
| 6    | Create `useComplaintSearch` hook                   | `digit-ui-v2/src/hooks/useComplaintSearch.ts`                   |
| 7    | Create `ComplaintSearchFilters`                    | `digit-ui-v2/src/components/complaint-search/ComplaintSearchFilters.tsx` |
| 8    | Create `ComplaintSearchResults` + row              | `digit-ui-v2/src/components/complaint-search/ComplaintSearchResults.tsx` |
| 9    | Create `ComplaintSearchPage`                       | `digit-ui-v2/src/pages/ComplaintSearchPage.tsx`                 |
| 10   | Create `RequireRole` guard                         | `digit-ui-v2/src/components/auth/RequireRole.tsx`               |
| 11   | Add route to App.tsx                               | `digit-ui-v2/src/App.tsx`                                       |
| 12   | Update sidebar nav to show Search for SUPERUSER    | `digit-ui-v2/src/components/layout/CitizenLayout.tsx`           |
| 13   | Add MDMS ROLEACTIONS entry for `_search` + `_count`| MDMS config (`ACCESSCONTROL-ROLEACTIONS`)                       |

---

## 15. Open Questions

1. **Employee vs Citizen layout:** The current `CitizenLayout` targets citizen users. Should the search page live inside a separate `EmployeeLayout`, or be added to the existing layout with role-conditional nav?

2. **Multi-tenant scope:** Should the SUPERUSER search be scoped to their own `tenantId` or allowed to search across all tenants? If cross-tenant, a Tenant dropdown should be added as an additional filter.

3. **`_plainsearch` vs `_search`:** The backend also exposes `/requests/_plainsearch` for unencrypted PII lookup. Confirm with the backend team whether SUPERUSER should use `_plainsearch` when searching by `serviceRequestId` in an encrypted-storage environment.

4. **Audit / compliance logging:** Should SUPERUSER search queries be logged for compliance? If yes, the frontend should emit an audit event (or the backend should log the authenticated search call automatically).

5. **Export to CSV:** Out of scope for this iteration but likely required by SUPERUSER for reporting. Flag for next iteration.
