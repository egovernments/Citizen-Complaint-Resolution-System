# Design: React-Admin DIGIT Management Studio

**Date:** 2026-03-06
**Status:** Approved
**Approach:** ra-core headless + DIGIT Admin Kit adapter layer

## Summary

Replace the existing management mode with a react-admin-powered admin studio for DIGIT platform admins. Uses `ra-core` (headless) for business logic (dataProvider, caching, routing, forms) with custom DIGIT-styled components (Tailwind + Radix) for the visual layer. Onboarding mode (phases 1-4) remains unchanged.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  App.tsx                                         │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ Onboarding   │  │ Management (react-admin) │  │
│  │ Phases 1-4   │  │                          │  │
│  │ (unchanged)  │  │  CoreAdminContext         │  │
│  │              │  │   ├─ digitDataProvider    │  │
│  │              │  │   ├─ digitAuthProvider    │  │
│  │              │  │   └─ CoreAdminUI          │  │
│  │              │  │       ├─ DigitLayout      │  │
│  │              │  │       ├─ Resource(tenants) │  │
│  │              │  │       ├─ Resource(depts)   │  │
│  │              │  │       ├─ Resource(...)     │  │
│  │              │  │       └─ Resource(mdms/*)  │  │
│  └──────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Three layers:**

1. **Providers** -- `digitDataProvider` + `digitAuthProvider` + `resourceRegistry`
2. **DIGIT Admin Kit** -- Adapter components wrapping ra-core hooks inside DIGIT/Tailwind/Radix components
3. **Resource pages** -- Thin composition files per resource (~20-40 lines each)

## Audience

DIGIT platform admins managing tenants, employees, complaint types, boundaries, etc.

## Resources (v1 -- Everything)

| Type | Resources | Approach |
|------|-----------|----------|
| Core (dedicated pages) | tenants, boundaries, departments, designations, complaint-types, employees | Custom columns/forms per resource |
| PGR | complaints, workflow | Custom show/edit with workflow actions |
| Localization | messages | Custom list with locale/module filters |
| Generic MDMS | 25+ schemas (StateInfo, IdFormat, GenderType, etc.) | Single `<MdmsResourcePage>` auto-generates columns from data |

## Data Provider

Maps DIGIT's non-REST API patterns to react-admin's 9-method interface.

### Three API patterns:

```
1. MDMS:     POST /mdms-v2/v2/_search   { MdmsCriteria: { schemaCode, tenantId, limit, offset } }
2. Services: POST /egov-hrms/employees/_search  { criteria: { tenantId } }
3. PGR:      POST /pgr-services/v2/request/_search  { criteria: { tenantId } }
```

### Resource registry (evolves entityRegistry.ts):

```typescript
const resourceRegistry = {
  tenants:          { type: 'mdms', schema: 'tenant.tenants', idField: 'code' },
  departments:      { type: 'mdms', schema: 'common-masters.Department', idField: 'code' },
  designations:     { type: 'mdms', schema: 'common-masters.Designation', idField: 'code' },
  'complaint-types':{ type: 'mdms', schema: 'RAINMAKER-PGR.ServiceDefs', idField: 'code' },
  employees:        { type: 'hrms', endpoint: '/egov-hrms/employees', idField: 'uuid' },
  boundaries:       { type: 'boundary', endpoint: '/boundary-service/boundary', idField: 'code' },
  complaints:       { type: 'pgr', endpoint: '/pgr-services/v2/request', idField: 'serviceRequestId' },
  // Generic MDMS resources auto-registered from schema list
};
```

### Key behaviors:

- **id normalization:** DIGIT uses `code`/`uuid`/`serviceRequestId`. DataProvider maps to `id` on output, back to native field on input.
- **Pagination:** Translates ra `{ page, perPage }` to DIGIT `{ limit, offset }`.
- **Sorting:** Client-side (DIGIT APIs mostly don't sort server-side).
- **Filtering:** Server-side where API supports it, client-side otherwise.

## Auth Provider

Wraps existing OAuth2 flow from `client.ts`:

```typescript
digitAuthProvider = {
  login({ username, password, environment, tenantId })  // calls existing apiClient.login()
  checkAuth()      // checks localStorage for valid token
  checkError(err)  // if 401/403, clears token
  logout()         // clears localStorage, resets apiClient
  getIdentity()    // returns { id, fullName } from stored userInfo
  getPermissions() // returns role codes (GRO, PGR_LME, SUPERUSER, etc.)
}
```

Login page stays as-is. Auth state shared between onboarding and management modes via same localStorage key (`crs-auth-state`).

## DIGIT Admin Kit Components

| Component | ra-core Hook | DIGIT Component Used | Purpose |
|-----------|-------------|---------------------|---------|
| `<DigitList>` | `useListController` | DigitCard, Header | List page wrapper |
| `<DigitDatagrid>` | `useListContext` | TanStack Table | Sortable, filterable table |
| `<DigitShow>` | `useShowController` | DigitCard, LabelFieldPair | Read-only detail |
| `<DigitEdit>` | `useEditController` | DigitCard, ActionBar | Edit form wrapper |
| `<DigitCreate>` | `useCreateController` | DigitCard, SubmitBar | Create form wrapper |
| `<DigitFormInput>` | `useInput` | Input/Select components | Form field adapter |
| `<DigitReferenceField>` | `useReference` | EntityLink | Linked entity display |
| `<DigitReferenceInput>` | ra-core reference hooks | Select component | Dropdown from another resource |
| `<DigitPagination>` | `useListContext` | DataTablePagination | Page controls |
| `<DigitFilterBar>` | `useListContext` | Search/filter components | Search + faceted filters |
| `<DigitBulkActions>` | `useListContext` | ActionBar | Bulk delete/export toolbar |

## File Structure

```
src/
├── providers/
│   ├── digitDataProvider.ts
│   ├── digitAuthProvider.ts
│   └── resourceRegistry.ts
│
├── admin/                          # DIGIT Admin Kit
│   ├── DigitList.tsx
│   ├── DigitDatagrid.tsx
│   ├── DigitShow.tsx
│   ├── DigitEdit.tsx
│   ├── DigitCreate.tsx
│   ├── DigitFormInput.tsx
│   ├── DigitReferenceField.tsx
│   ├── DigitReferenceInput.tsx
│   ├── DigitPagination.tsx
│   ├── DigitFilterBar.tsx
│   ├── DigitBulkActions.tsx
│   ├── DigitLayout.tsx
│   ├── DigitDashboard.tsx
│   └── MdmsResourcePage.tsx
│
├── resources/                      # Per-resource pages
│   ├── tenants/
│   │   ├── TenantList.tsx
│   │   ├── TenantEdit.tsx
│   │   └── TenantShow.tsx
│   ├── departments/
│   │   ├── DepartmentList.tsx
│   │   └── DepartmentEdit.tsx
│   ├── designations/
│   │   ├── DesignationList.tsx
│   │   └── DesignationEdit.tsx
│   ├── boundaries/
│   │   ├── BoundaryList.tsx
│   │   └── BoundaryShow.tsx
│   ├── complaint-types/
│   │   ├── ComplaintTypeList.tsx
│   │   └── ComplaintTypeEdit.tsx
│   ├── employees/
│   │   ├── EmployeeList.tsx
│   │   ├── EmployeeCreate.tsx
│   │   └── EmployeeEdit.tsx
│   ├── complaints/
│   │   ├── ComplaintList.tsx
│   │   ├── ComplaintShow.tsx
│   │   └── ComplaintCreate.tsx
│   ├── localization/
│   │   └── LocalizationList.tsx
│   └── index.ts
│
├── pages/                          # Onboarding (unchanged)
│   ├── LoginPage.tsx
│   ├── Phase1Page.tsx ... Phase4Page.tsx
│   └── CompletePage.tsx
│
├── components/                     # Shared (unchanged)
│   ├── ui/
│   └── digit/
```

## What Gets Deleted

- `src/pages/manage/` (all management pages)
- `src/pages/ManagementDashboard.tsx`
- `src/components/layout/ManagementLayout.tsx`
- `src/hooks/useEntity.ts` (replaced by ra-core hooks)
- `src/lib/entityRegistry.ts` (evolves into `resourceRegistry.ts`)

## What Stays Unchanged

- Onboarding mode (phases 1-4)
- Login page
- All `src/components/ui/` (Radix primitives)
- All `src/components/digit/` (DIGIT design components)
- `src/utils/excelParser.ts`
- `src/lib/telemetry.ts`
- `src/api/client.ts` (used by dataProvider internally)
- `src/api/services/*` (used by dataProvider internally)

## Migration Strategy

1. Install ra-core, build providers (digitDataProvider, digitAuthProvider, resourceRegistry)
2. Build DIGIT Admin Kit adapter components
3. First resource: departments (simplest MDMS, proves full stack)
4. Remaining core: designations, complaint-types, tenants, employees, boundaries
5. PGR + Workflow: complaints with workflow actions
6. Localization: messages with locale/module filters
7. Generic MDMS: MdmsResourcePage for all 25+ schemas
8. Dashboard: overview cards with counts
9. Cleanup: delete old management pages and hooks

## Risks

- **Boundaries:** Tree hierarchy doesn't fit standard CRUD. Gets a custom page component calling ra-core hooks directly.
- **PGR Complaints:** Workflow state machine (ASSIGN, RESOLVE, REJECT, etc.) needs custom show/edit with action buttons, not generic form save.
- **Client-side sorting:** For large datasets, this may feel slow. Mitigated by server-side filters where APIs support them.
