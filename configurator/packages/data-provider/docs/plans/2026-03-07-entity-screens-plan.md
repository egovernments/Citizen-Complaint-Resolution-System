# Entity Screens Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the CRS management tab's local data layer with `@digit-mcp/data-provider` and build List/Show/Edit screens for every DIGIT entity with full cross-linking.

**Architecture:** Hybrid approach — dedicated screens for 8 core entities + 5 read-only entities, generic schema-driven screens for 20+ MDMS resources. EntityLink component provides cross-linking. Data layer from `@digit-mcp/data-provider` replaces 3 local files (~1200 lines).

**Tech Stack:** React 19, ra-core 5.14.3, Tailwind CSS 3.4, shadcn/ui, Lucide icons, `@digit-mcp/data-provider` (DigitApiClient + DataProvider + AuthProvider + ResourceRegistry).

**Design Doc:** `docs/plans/2026-03-07-entity-screens-design.md`

**CRS UI Root:** `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup`

**Data Provider Package:** `/root/DIGIT-MCP/packages/data-provider`

---

## Task 1: Wire `@digit-mcp/data-provider` Into CRS UI

Replace the 3 local provider files with the package. The CRS UI currently has its own `digitDataProvider.ts` (749 lines), `digitAuthProvider.ts` (89 lines), and `resourceRegistry.ts` (422 lines). These are functionally identical to the package but less complete.

**Files:**
- Modify: `package.json` — add `file:` dependency
- Modify: `src/App.tsx` — import from package instead of local providers
- Modify: `src/admin/DigitDashboard.tsx` — import from package
- Modify: `src/admin/DigitLayout.tsx` — import from package
- Modify: `src/admin/MdmsResourcePage.tsx` — import from package
- Keep (don't delete yet): `src/providers/` — keep until verified

**Step 1: Add package dependency**

In `package.json`, add to `dependencies`:

```json
"@digit-mcp/data-provider": "file:../../../../../DIGIT-MCP/packages/data-provider"
```

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npm install`
Expected: Package linked successfully, `node_modules/@digit-mcp/data-provider` exists.

**Step 2: Build the data-provider package**

Run: `cd /root/DIGIT-MCP/packages/data-provider && npm run build`
Expected: `dist/` directory created with compiled JS + type declarations.

**Step 3: Create a bridge module**

Create `src/providers/bridge.ts` — a single file that instantiates the package's client, data provider, and auth provider using the CRS UI's existing `apiClient` pattern. This bridges the gap between the package (which takes a `DigitApiClient` instance) and the CRS UI (which uses a global `apiClient` singleton).

```typescript
// src/providers/bridge.ts
import { DigitApiClient, createDigitDataProvider, createDigitAuthProvider } from '@digit-mcp/data-provider';
export { getResourceConfig, getAllResources, getDedicatedResources, getGenericMdmsResources, getResourceIdField, getResourceLabel } from '@digit-mcp/data-provider';
export type { ResourceConfig } from '@digit-mcp/data-provider';

// Singleton client — mirrors the existing apiClient pattern
export const digitClient = new DigitApiClient({ url: '' });

// These are re-created when tenant changes
let _dataProvider: ReturnType<typeof createDigitDataProvider> | null = null;
let _authProvider: ReturnType<typeof createDigitAuthProvider> | null = null;

export function getDataProvider(tenantId: string) {
  if (!_dataProvider) {
    _dataProvider = createDigitDataProvider(digitClient, tenantId);
  }
  return _dataProvider;
}

export function getAuthProvider() {
  if (!_authProvider) {
    _authProvider = createDigitAuthProvider(digitClient);
  }
  return _authProvider;
}

export function resetProviders() {
  _dataProvider = null;
  _authProvider = null;
}

export { digitClient as apiClient };
```

**Step 4: Update App.tsx imports**

Replace all imports from `./providers/resourceRegistry` and `./providers/digitDataProvider` and `./providers/digitAuthProvider` with imports from `./providers/bridge`. Update the `ManagementAdmin` component to use `getDataProvider(state.tenant)` and `getAuthProvider()`.

In `src/App.tsx`, change:
```typescript
// Old:
import { digitDataProvider } from './providers/digitDataProvider';
import { digitAuthProvider } from './providers/digitAuthProvider';
import { getGenericMdmsResources } from './providers/resourceRegistry';

// New:
import { getDataProvider, getAuthProvider, getGenericMdmsResources, digitClient } from './providers/bridge';
```

And in `ManagementAdmin()`:
```typescript
function ManagementAdmin() {
  const { state } = useApp();
  const dataProvider = getDataProvider(state.tenant);
  const authProvider = getAuthProvider();
  return (
    <CoreAdminContext
      dataProvider={dataProvider}
      authProvider={authProvider}
      queryClient={queryClient}
      basename="/manage"
    >
      ...
    </CoreAdminContext>
  );
}
```

Also update `restoreApiClientFromStorage()` to call `digitClient.setAuth()` and set `digitClient.stateTenantId`.

**Step 5: Update DigitLayout.tsx imports**

Change:
```typescript
// Old:
import { getGenericMdmsResources, getResourceLabel } from '@/providers/resourceRegistry';
// New:
import { getGenericMdmsResources, getResourceLabel } from '@/providers/bridge';
```

**Step 6: Update DigitDashboard.tsx imports**

Change:
```typescript
// Old:
import { getDedicatedResources, getResourceLabel } from '@/providers/resourceRegistry';
// New:
import { getDedicatedResources, getResourceLabel } from '@/providers/bridge';
```

**Step 7: Update MdmsResourcePage.tsx imports**

Change:
```typescript
// Old:
import { getResourceConfig, getResourceLabel } from '@/providers/resourceRegistry';
// New:
import { getResourceConfig, getResourceLabel } from '@/providers/bridge';
```

**Step 8: Verify the app builds and runs**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx vite build`
Expected: Build succeeds with no errors.

Run: `npx vite --host 0.0.0.0 --port 3000 &` and test in browser.
Expected: Management tab loads, dashboard shows resource counts, list views work.

**Step 9: Commit**

```bash
git add package.json package-lock.json src/providers/bridge.ts src/App.tsx src/admin/DigitDashboard.tsx src/admin/DigitLayout.tsx src/admin/MdmsResourcePage.tsx
git commit -m "feat: wire @digit-mcp/data-provider into CRS management tab

Replace local data layer (~1200 lines) with shared package.
Bridge module adapts DigitApiClient to existing app patterns.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Build EntityLink Component

The cross-linking foundation. Given a resource name and ID, renders a clickable chip that navigates to the entity's Show page and resolves the display name via `useGetOne()`.

**Files:**
- Create: `src/components/ui/EntityLink.tsx`

**Step 1: Write EntityLink component**

```tsx
// src/components/ui/EntityLink.tsx
import { useGetOne } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { Badge } from './badge';
import { getResourceConfig } from '@/providers/bridge';

interface EntityLinkProps {
  /** react-admin resource name (e.g. "departments") */
  resource: string;
  /** The ID value to look up (e.g. "DEPT_5") */
  id: string;
  /** Optional: override the display label */
  label?: string;
}

export function EntityLink({ resource, id, label }: EntityLinkProps) {
  const navigate = useNavigate();
  const config = getResourceConfig(resource);
  const nameField = config?.nameField ?? 'name';

  const { data, isPending, error } = useGetOne(
    resource,
    { id },
    { enabled: !!id && !!resource }
  );

  if (!id) return <span className="text-muted-foreground">--</span>;

  const displayName = label
    ?? (data ? String((data as Record<string, unknown>)[nameField] ?? id) : undefined);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/manage/${resource}/${encodeURIComponent(id)}`);
  };

  return (
    <Badge
      variant="outline"
      className="cursor-pointer hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors text-xs font-medium"
      onClick={handleClick}
    >
      {isPending ? (
        <span className="animate-pulse">{id}</span>
      ) : error ? (
        <span>{id}</span>
      ) : (
        <span>{displayName}</span>
      )}
    </Badge>
  );
}
```

**Step 2: Verify build**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx vite build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/components/ui/EntityLink.tsx
git commit -m "feat: add EntityLink cross-linking component

Renders clickable badge that resolves entity name via useGetOne()
and navigates to the Show page. Foundation for all cross-links.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Build Shared UI Helpers

Reusable components used across multiple entity screens: `StatusChip`, `FieldSection`, `ReverseReferenceList`, `JsonViewer`, and `DateField`.

**Files:**
- Create: `src/admin/fields/StatusChip.tsx`
- Create: `src/admin/fields/FieldSection.tsx`
- Create: `src/admin/fields/ReverseReferenceList.tsx`
- Create: `src/admin/fields/JsonViewer.tsx`
- Create: `src/admin/fields/DateField.tsx`
- Create: `src/admin/fields/index.ts`

**Step 1: Write StatusChip**

```tsx
// src/admin/fields/StatusChip.tsx
import { Badge } from '@/components/ui/badge';

const STATUS_COLORS: Record<string, string> = {
  // PGR statuses
  PENDINGFORASSIGNMENT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  PENDINGATLME: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  PENDINGFORREASSIGNMENT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  RESOLVED: 'bg-green-100 text-green-800 border-green-200',
  REJECTED: 'bg-red-100 text-red-800 border-red-200',
  CLOSEDAFTERRESOLUTION: 'bg-blue-100 text-blue-800 border-blue-200',
  // Employee statuses
  EMPLOYED: 'bg-green-100 text-green-800 border-green-200',
  INACTIVE: 'bg-gray-100 text-gray-600 border-gray-200',
  // Boolean-like
  true: 'bg-green-100 text-green-800 border-green-200',
  false: 'bg-gray-100 text-gray-600 border-gray-200',
  Active: 'bg-green-100 text-green-800 border-green-200',
  Inactive: 'bg-gray-100 text-gray-600 border-gray-200',
};

interface StatusChipProps {
  value: unknown;
  /** Map value to display text. Defaults to string conversion. */
  labels?: Record<string, string>;
}

export function StatusChip({ value, labels }: StatusChipProps) {
  if (value == null) return <span className="text-muted-foreground">--</span>;

  const strValue = String(value);
  const displayText = labels?.[strValue] ?? strValue;
  const colorClass = STATUS_COLORS[strValue] ?? 'bg-gray-100 text-gray-700 border-gray-200';

  return (
    <Badge variant="outline" className={`text-xs ${colorClass}`}>
      {displayText}
    </Badge>
  );
}
```

**Step 2: Write FieldSection**

```tsx
// src/admin/fields/FieldSection.tsx
import type { ReactNode } from 'react';

interface FieldSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function FieldSection({ title, children, className }: FieldSectionProps) {
  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 pb-2 border-b border-border">
        {title}
      </h3>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
}

interface FieldRowProps {
  label: string;
  children: ReactNode;
}

export function FieldRow({ label, children }: FieldRowProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-0 py-1">
      <dt className="text-sm font-medium text-muted-foreground sm:w-[200px] sm:flex-shrink-0">
        {label}
      </dt>
      <dd className="text-sm text-foreground">
        {children ?? <span className="text-muted-foreground">--</span>}
      </dd>
    </div>
  );
}
```

**Step 3: Write ReverseReferenceList**

Uses `useGetManyReference` from ra-core to show "N items that reference this record".

```tsx
// src/admin/fields/ReverseReferenceList.tsx
import { useGetManyReference } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronRight } from 'lucide-react';

interface ReverseReferenceListProps {
  /** Resource to query (e.g. "complaint-types") */
  resource: string;
  /** Field on the target resource that references this record (e.g. "department") */
  target: string;
  /** The current record's ID value */
  id: string;
  /** Label to display (e.g. "Complaint Types") */
  label: string;
  /** Field on the referenced records to display */
  displayField?: string;
  /** Max items to show inline */
  limit?: number;
}

export function ReverseReferenceList({
  resource,
  target,
  id,
  label,
  displayField = 'name',
  limit = 5,
}: ReverseReferenceListProps) {
  const navigate = useNavigate();
  const { data, total, isPending } = useGetManyReference(
    resource,
    {
      target,
      id,
      pagination: { page: 1, perPage: limit },
      sort: { field: displayField, order: 'ASC' },
      filter: {},
    },
    { enabled: !!id }
  );

  if (isPending) {
    return (
      <div className="text-sm text-muted-foreground animate-pulse">
        Loading {label}...
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No {label.toLowerCase()} found
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <Badge variant="secondary" className="text-xs">{total}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {data.map((record) => (
          <Badge
            key={record.id}
            variant="outline"
            className="cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors text-xs"
            onClick={() => navigate(`/manage/${resource}/${encodeURIComponent(record.id)}`)}
          >
            {String((record as Record<string, unknown>)[displayField] ?? record.id)}
          </Badge>
        ))}
        {total != null && total > limit && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground"
            onClick={() => navigate(`/manage/${resource}?filter=${encodeURIComponent(JSON.stringify({ [target]: id }))}`)}
          >
            +{total - limit} more <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Write JsonViewer**

```tsx
// src/admin/fields/JsonViewer.tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface JsonViewerProps {
  data: unknown;
  initialExpanded?: boolean;
}

export function JsonViewer({ data, initialExpanded = true }: JsonViewerProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [copied, setCopied] = useState(false);

  const jsonStr = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          JSON
        </button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleCopy}>
          {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
        </Button>
      </div>
      {expanded && (
        <pre className="p-3 text-xs font-mono overflow-auto max-h-96 text-foreground">
          {jsonStr}
        </pre>
      )}
    </div>
  );
}
```

**Step 5: Write DateField**

```tsx
// src/admin/fields/DateField.tsx

interface DateFieldProps {
  value: unknown;
  showTime?: boolean;
}

export function DateField({ value, showTime = true }: DateFieldProps) {
  if (value == null) return <span className="text-muted-foreground">--</span>;

  const timestamp = typeof value === 'number' ? value : Number(value);
  if (isNaN(timestamp)) return <span className="text-muted-foreground">{String(value)}</span>;

  const date = new Date(timestamp);
  const formatted = showTime
    ? date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : date.toLocaleDateString('en-IN', { dateStyle: 'medium' });

  return <span className="text-sm">{formatted}</span>;
}
```

**Step 6: Write barrel export**

```typescript
// src/admin/fields/index.ts
export { StatusChip } from './StatusChip';
export { FieldSection, FieldRow } from './FieldSection';
export { ReverseReferenceList } from './ReverseReferenceList';
export { JsonViewer } from './JsonViewer';
export { DateField } from './DateField';
```

**Step 7: Verify build**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx vite build`
Expected: Build succeeds.

**Step 8: Commit**

```bash
git add src/admin/fields/
git commit -m "feat: add shared UI field components

StatusChip, FieldSection/FieldRow, ReverseReferenceList,
JsonViewer, DateField — reusable across all entity screens.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Department Screens (List/Show/Edit)

Simplest core entity. Replace existing `DepartmentList` with enhanced version, add `DepartmentShow` with reverse links, keep `DepartmentEdit`.

**Files:**
- Modify: `src/resources/departments/DepartmentList.tsx`
- Create: `src/resources/departments/DepartmentShow.tsx`
- Modify: `src/resources/departments/DepartmentEdit.tsx`
- Modify: `src/resources/index.ts`

**Step 1: Enhance DepartmentList**

```tsx
// src/resources/departments/DepartmentList.tsx
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'name', label: 'Name' },
  {
    source: 'active',
    label: 'Status',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
  { source: 'description', label: 'Description' },
];

export function DepartmentList() {
  return (
    <DigitList title="Departments" hasCreate sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
```

**Step 2: Create DepartmentShow**

```tsx
// src/resources/departments/DepartmentShow.tsx
import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, StatusChip, ReverseReferenceList } from '@/admin/fields';
import { useShowController } from 'ra-core';

export function DepartmentShow() {
  const { record } = useShowController();
  if (!record) return null;

  return (
    <DigitShow title={`Department: ${record.name ?? record.id}`} hasEdit>
      {() => (
        <div className="space-y-6">
          <FieldSection title="Details">
            <FieldRow label="Code">{String(record.code ?? '')}</FieldRow>
            <FieldRow label="Name">{String(record.name ?? '')}</FieldRow>
            <FieldRow label="Status">
              <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
            </FieldRow>
            <FieldRow label="Description">{String(record.description ?? '')}</FieldRow>
          </FieldSection>

          <FieldSection title="Related">
            <ReverseReferenceList
              resource="complaint-types"
              target="department"
              id={String(record.code ?? record.id)}
              label="Complaint Types"
              displayField="name"
            />
            <div className="mt-4">
              <ReverseReferenceList
                resource="employees"
                target="assignments.department"
                id={String(record.code ?? record.id)}
                label="Employees"
                displayField="code"
              />
            </div>
          </FieldSection>
        </div>
      )}
    </DigitShow>
  );
}
```

**Step 3: Update DepartmentEdit**

Add description and active toggle:

```tsx
// src/resources/departments/DepartmentEdit.tsx
import { DigitEdit, DigitFormInput } from '@/admin';
import { required } from 'ra-core';

export function DepartmentEdit() {
  return (
    <DigitEdit title="Edit Department">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="name" label="Name" validate={required()} />
      <DigitFormInput source="description" label="Description" />
    </DigitEdit>
  );
}
```

**Step 4: Update resources/index.ts**

Add DepartmentShow export:

```typescript
export { DepartmentShow } from './departments/DepartmentShow';
```

**Step 5: Verify build**

Run: `npx vite build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add src/resources/departments/ src/resources/index.ts
git commit -m "feat: department List/Show/Edit screens with reverse links

Show page displays related complaint types and employees.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Designation Screens (List/Show/Edit)

Almost identical to departments. Replace existing `DesignationList`, add `DesignationShow` and `DesignationEdit`.

**Files:**
- Modify: `src/resources/designations/DesignationList.tsx`
- Create: `src/resources/designations/DesignationShow.tsx`
- Create: `src/resources/designations/DesignationEdit.tsx`
- Modify: `src/resources/index.ts`

**Step 1: Update DesignationList**

Same pattern as DepartmentList: code, name, active (StatusChip), description.

**Step 2: Create DesignationShow**

Same layout as DepartmentShow but with reverse link "Employees with this designation" targeting `assignments.designation`.

**Step 3: Create DesignationEdit**

Same as DepartmentEdit: code (read-only), name (required), description.

**Step 4: Update resources/index.ts**

Add exports: `DesignationShow`, `DesignationEdit`.

**Step 5: Verify build and commit**

```bash
git add src/resources/designations/ src/resources/index.ts
git commit -m "feat: designation List/Show/Edit screens with reverse links

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Complaint Type Screens (List/Show/Edit)

First entity with EntityLink cross-references. Department field links to department Show page.

**Files:**
- Modify: `src/resources/complaint-types/ComplaintTypeList.tsx`
- Create: `src/resources/complaint-types/ComplaintTypeShow.tsx`
- Create: `src/resources/complaint-types/ComplaintTypeEdit.tsx`
- Modify: `src/resources/index.ts`

**Step 1: Update ComplaintTypeList**

Columns: serviceCode, name, department (EntityLink → departments), slaHours, active (StatusChip).

```tsx
import { EntityLink } from '@/components/ui/EntityLink';

const columns: DigitColumn[] = [
  { source: 'serviceCode', label: 'Service Code' },
  { source: 'name', label: 'Name' },
  {
    source: 'department',
    label: 'Department',
    render: (record) => (
      <EntityLink resource="departments" id={String(record.department ?? '')} />
    ),
  },
  { source: 'slaHours', label: 'SLA (hrs)' },
  {
    source: 'active',
    label: 'Status',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
];
```

**Step 2: Create ComplaintTypeShow**

Fields: all fields. Department as EntityLink. Keywords as tag chips. Reverse link: "Recent complaints of this type".

**Step 3: Create ComplaintTypeEdit**

Fields: serviceCode (read-only), name, department (text input — picker is a future enhancement), slaHours (number), menuPath, keywords.

**Step 4: Update resources/index.ts, verify build, commit**

```bash
git add src/resources/complaint-types/ src/resources/index.ts
git commit -m "feat: complaint type List/Show/Edit with EntityLink to department

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Employee Screens (List/Show/Edit)

Most complex entity. Nested user object, assignments array, jurisdictions array. Multiple EntityLinks.

**Files:**
- Modify: `src/resources/employees/EmployeeList.tsx`
- Create: `src/resources/employees/EmployeeShow.tsx`
- Create: `src/resources/employees/EmployeeEdit.tsx`
- Modify: `src/resources/index.ts`

**Step 1: Update EmployeeList**

Columns: code, user.name, user.mobileNumber, employeeStatus (StatusChip), current assignment department (EntityLink), current assignment designation (EntityLink), isActive (StatusChip).

```tsx
const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'user.name', label: 'Name' },
  { source: 'user.mobileNumber', label: 'Mobile' },
  {
    source: 'employeeStatus',
    label: 'Status',
    render: (record) => <StatusChip value={record.employeeStatus} />,
  },
  {
    source: 'assignments',
    label: 'Department',
    sortable: false,
    render: (record) => {
      const assignments = record.assignments as Array<Record<string, unknown>> | undefined;
      const current = assignments?.find((a) => a.isCurrentAssignment);
      return current?.department
        ? <EntityLink resource="departments" id={String(current.department)} />
        : <span className="text-muted-foreground">--</span>;
    },
  },
  {
    source: 'assignments',
    label: 'Designation',
    sortable: false,
    render: (record) => {
      const assignments = record.assignments as Array<Record<string, unknown>> | undefined;
      const current = assignments?.find((a) => a.isCurrentAssignment);
      return current?.designation
        ? <EntityLink resource="designations" id={String(current.designation)} />
        : <span className="text-muted-foreground">--</span>;
    },
  },
  {
    source: 'isActive',
    label: 'Active',
    render: (record) => (
      <StatusChip value={record.isActive} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
];
```

**Step 2: Create EmployeeShow**

Sections:
- **Header**: code, name, mobile, status, type, active, dateOfAppointment
- **User**: userName, gender, dob, roles (each as EntityLink → access-roles)
- **Assignments**: table with department (EntityLink), designation (EntityLink), fromDate, isCurrent
- **Jurisdictions**: table with hierarchy, boundaryType, boundary (EntityLink)

**Step 3: Create EmployeeEdit**

Fields: user.name, user.mobileNumber, user.gender (select), employeeStatus (select), isActive (toggle). Uses the full employee object pattern for update.

**Step 4: Update resources/index.ts, verify build, commit**

```bash
git add src/resources/employees/ src/resources/index.ts
git commit -m "feat: employee List/Show/Edit with cross-linked assignments and roles

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Complaint Screens (List/Show/Edit)

PGR complaints with colored status chips, workflow timeline, and workflow transition edit.

**Files:**
- Create: `src/resources/complaints/ComplaintList.tsx`
- Create: `src/resources/complaints/ComplaintShow.tsx`
- Create: `src/resources/complaints/ComplaintEdit.tsx`
- Modify: `src/resources/index.ts`

**Step 1: Create ComplaintList**

Columns: serviceRequestId, serviceCode (EntityLink → complaint-types), description (truncated to 60 chars), applicationStatus (StatusChip with PGR colors), citizen.name, address.locality.code (EntityLink → boundaries), createdTime (DateField).

**Step 2: Create ComplaintShow**

Sections:
- **Header**: serviceRequestId, status chip, rating stars (1-5)
- **Details**: serviceCode (EntityLink), description, source
- **Citizen**: name, mobileNumber
- **Address**: locality (EntityLink → boundaries), city, geoLocation
- **Timeline**: Fetch workflow processes for this complaint's serviceRequestId. Display as vertical timeline with action, assignee, comment, timestamp per step.
- **Audit**: createdTime, lastModifiedTime (DateField)

**Step 3: Create ComplaintEdit**

Workflow transition form: action dropdown (ASSIGN/RESOLVE/REJECT/REOPEN/RATE), comment textarea, assignee employee picker (shown only for ASSIGN action). Submits via `pgr_update` through the data provider.

**Step 4: Update resources/index.ts, verify build, commit**

```bash
git add src/resources/complaints/ src/resources/index.ts
git commit -m "feat: complaint List/Show/Edit with workflow timeline and transitions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Boundary Screens (List/Show/Edit)

**Files:**
- Modify: `src/resources/boundaries/BoundaryList.tsx`
- Create: `src/resources/boundaries/BoundaryShow.tsx`
- Create: `src/resources/boundaries/BoundaryEdit.tsx`
- Modify: `src/resources/index.ts`

**Step 1: Update BoundaryList**

Columns: code, boundaryType, tenantId.

**Step 2: Create BoundaryShow**

Fields: all fields. tenantId as EntityLink → tenants. additionalDetails as JsonViewer. Parent/children if available from relationship tree.

**Step 3: Create BoundaryEdit**

Fields: additionalDetails (textarea/JSON editor). Code and geometry are read-only.

**Step 4: Update resources/index.ts, verify build, commit**

```bash
git add src/resources/boundaries/ src/resources/index.ts
git commit -m "feat: boundary List/Show/Edit screens

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Localization Screens (List/Show/Edit)

**Files:**
- Create: `src/resources/localization/LocalizationList.tsx`
- Create: `src/resources/localization/LocalizationShow.tsx`
- Create: `src/resources/localization/LocalizationEdit.tsx`
- Modify: `src/resources/index.ts`

**Step 1: Create LocalizationList**

Columns: code, message (truncated), module, locale. Searchable by code/message.

**Step 2: Create LocalizationShow**

All fields displayed. Message shown in full.

**Step 3: Create LocalizationEdit**

Fields: code (read-only), message (textarea), module (text), locale (select with en_IN as default).

**Step 4: Update resources/index.ts, verify build, commit**

```bash
git add src/resources/localization/ src/resources/index.ts
git commit -m "feat: localization List/Show/Edit screens

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 11: User Screens (List/Show/Edit)

**Files:**
- Create: `src/resources/users/UserList.tsx`
- Create: `src/resources/users/UserShow.tsx`
- Create: `src/resources/users/UserEdit.tsx`
- Modify: `src/resources/index.ts`

**Step 1: Create UserList**

Columns: userName, name, mobileNumber, type (StatusChip), active (StatusChip), role count badge.

**Step 2: Create UserShow**

Sections:
- **Profile**: uuid, userName, name, mobileNumber, emailId, gender, type, active, dob
- **Roles**: table with code (EntityLink → access-roles), name, tenantId (EntityLink → tenants)

**Step 3: Create UserEdit**

Fields: name, mobileNumber, emailId, gender (select), active (toggle). Roles managed separately.

**Step 4: Update resources/index.ts, verify build, commit**

```bash
git add src/resources/users/ src/resources/index.ts
git commit -m "feat: user List/Show/Edit screens with role cross-links

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Read-Only Entity Screens (5 entities)

Access Roles, Workflow Business Services, Workflow Processes, MDMS Schemas, Boundary Hierarchies. All List + Show only, no Edit.

**Files:**
- Create: `src/resources/access-roles/AccessRoleList.tsx`
- Create: `src/resources/access-roles/AccessRoleShow.tsx`
- Create: `src/resources/workflow-services/WorkflowServiceList.tsx`
- Create: `src/resources/workflow-services/WorkflowServiceShow.tsx`
- Create: `src/resources/workflow-processes/WorkflowProcessList.tsx`
- Create: `src/resources/workflow-processes/WorkflowProcessShow.tsx`
- Create: `src/resources/mdms-schemas/MdmsSchemaList.tsx`
- Create: `src/resources/mdms-schemas/MdmsSchemaShow.tsx`
- Create: `src/resources/boundary-hierarchies/BoundaryHierarchyList.tsx`
- Create: `src/resources/boundary-hierarchies/BoundaryHierarchyShow.tsx`
- Modify: `src/resources/index.ts`

**Step 1: Access Roles (List/Show)**

List columns: code, name, description.
Show: All fields + reverse links: "Employees with this role", "Users with this role".

**Step 2: Workflow Business Services (List/Show)**

List columns: businessService, business, businessServiceSla (formatted as days).
Show: Header fields + state machine table (states with actions, nextState, roles as EntityLinks → access-roles).

**Step 3: Workflow Processes (List/Show)**

List columns: businessId (EntityLink → complaints), action, state, createdTime (DateField).
Show: All fields. businessId → EntityLink to Complaint. assignee → EntityLink to User.

**Step 4: MDMS Schemas (List/Show)**

List columns: code, tenantId, description, isActive (StatusChip).
Show: All fields. definition as JsonViewer. tenantId → EntityLink.

**Step 5: Boundary Hierarchies (List/Show)**

List columns: hierarchyType, tenantId.
Show: Header + hierarchy levels as vertical chain with arrows (Country → State → ... → Locality).

**Step 6: Update resources/index.ts with all new exports**

**Step 7: Verify build and commit**

```bash
git add src/resources/access-roles/ src/resources/workflow-services/ src/resources/workflow-processes/ src/resources/mdms-schemas/ src/resources/boundary-hierarchies/ src/resources/index.ts
git commit -m "feat: read-only screens for 5 reference entities

Access Roles, Workflow Business Services, Workflow Processes,
MDMS Schemas, Boundary Hierarchies — all with cross-links.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 13: Enhanced Generic MDMS Screens

Upgrade `MdmsResourcePage` to support Show and Edit views. The existing auto-detect column logic works for List. Add a generic Show (key-value pairs with JSON viewer for objects) and Edit (text inputs for strings, toggles for booleans, numbers for numbers).

**Files:**
- Modify: `src/admin/MdmsResourcePage.tsx` — add show/edit support
- Create: `src/admin/MdmsResourceShow.tsx`
- Create: `src/admin/MdmsResourceEdit.tsx`
- Modify: `src/admin/index.ts`

**Step 1: Create MdmsResourceShow**

Auto-detect fields from record. Render as key-value pairs. Objects/arrays as JsonViewer. Booleans as StatusChip.

**Step 2: Create MdmsResourceEdit**

Auto-detect fields from record. Render text inputs for strings, toggles for booleans, number inputs for numbers. idField is read-only.

**Step 3: Export new components from admin/index.ts**

**Step 4: Verify build and commit**

```bash
git add src/admin/MdmsResourcePage.tsx src/admin/MdmsResourceShow.tsx src/admin/MdmsResourceEdit.tsx src/admin/index.ts
git commit -m "feat: generic MDMS Show/Edit screens with auto-detected fields

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 14: Update Navigation Sidebar

Replace the flat nav list with grouped sections per the design doc. Add new resources (Users, Complaints, Access Roles, Workflow Services, Workflow Processes, MDMS Schemas, Boundary Hierarchies).

**Files:**
- Modify: `src/admin/DigitLayout.tsx`

**Step 1: Define grouped navigation**

```typescript
const navGroups = [
  {
    label: 'Tenant Management',
    items: [
      { id: 'tenants', name: 'Tenants', path: '/manage/tenants', icon: Building2 },
      { id: 'departments', name: 'Departments', path: '/manage/departments', icon: Briefcase },
      { id: 'designations', name: 'Designations', path: '/manage/designations', icon: Award },
      { id: 'boundary-hierarchies', name: 'Boundary Hierarchies', path: '/manage/boundary-hierarchies', icon: GitBranch },
    ],
  },
  {
    label: 'Complaint Management',
    items: [
      { id: 'complaint-types', name: 'Complaint Types', path: '/manage/complaint-types', icon: AlertTriangle },
      { id: 'complaints', name: 'Complaints', path: '/manage/complaints', icon: MessageSquare },
      { id: 'localization', name: 'Localization', path: '/manage/localization', icon: Globe },
    ],
  },
  {
    label: 'People',
    items: [
      { id: 'employees', name: 'Employees', path: '/manage/employees', icon: Users },
      { id: 'users', name: 'Users', path: '/manage/users', icon: User },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'access-roles', name: 'Access Roles', path: '/manage/access-roles', icon: Shield },
      { id: 'workflow-business-services', name: 'Workflow Services', path: '/manage/workflow-business-services', icon: Workflow },
      { id: 'workflow-processes', name: 'Workflow Processes', path: '/manage/workflow-processes', icon: History },
      { id: 'mdms-schemas', name: 'MDMS Schemas', path: '/manage/mdms-schemas', icon: FileCode },
      { id: 'boundaries', name: 'Boundaries', path: '/manage/boundaries', icon: MapPin },
    ],
  },
];
```

**Step 2: Update sidebar rendering**

Replace the flat `navItems.map()` with grouped rendering. Each group gets a small label header and the items below it.

**Step 3: Verify build and commit**

```bash
git add src/admin/DigitLayout.tsx
git commit -m "feat: grouped navigation sidebar with all entity resources

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 15: Wire All Screens Into App.tsx

Register all new resources and screens in the `ManagementAdmin` component. This is the final wiring step.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/resources/index.ts` (ensure all exports)

**Step 1: Add all resource imports**

Import all new List/Show/Edit components from `@/resources`.

**Step 2: Register resources in ManagementAdmin**

```tsx
{/* Core entities with List/Show/Edit */}
<Resource name="tenants" list={TenantList} show={TenantShow} />
<Resource name="departments" list={DepartmentList} show={DepartmentShow} edit={DepartmentEdit} />
<Resource name="designations" list={DesignationList} show={DesignationShow} edit={DesignationEdit} />
<Resource name="complaint-types" list={ComplaintTypeList} show={ComplaintTypeShow} edit={ComplaintTypeEdit} />
<Resource name="employees" list={EmployeeList} show={EmployeeShow} edit={EmployeeEdit} />
<Resource name="complaints" list={ComplaintList} show={ComplaintShow} edit={ComplaintEdit} />
<Resource name="boundaries" list={BoundaryList} show={BoundaryShow} edit={BoundaryEdit} />
<Resource name="localization" list={LocalizationList} show={LocalizationShow} edit={LocalizationEdit} />
<Resource name="users" list={UserList} show={UserShow} edit={UserEdit} />

{/* Read-only entities with List/Show */}
<Resource name="access-roles" list={AccessRoleList} show={AccessRoleShow} />
<Resource name="workflow-business-services" list={WorkflowServiceList} show={WorkflowServiceShow} />
<Resource name="workflow-processes" list={WorkflowProcessList} show={WorkflowProcessShow} />
<Resource name="mdms-schemas" list={MdmsSchemaList} show={MdmsSchemaShow} />
<Resource name="boundary-hierarchies" list={BoundaryHierarchyList} show={BoundaryHierarchyShow} />

{/* Generic MDMS with Show/Edit */}
{Object.keys(getGenericMdmsResources()).map((name) => (
  <Resource key={name} name={name} list={MdmsResourcePage} show={MdmsResourceShow} edit={MdmsResourceEdit} />
))}
```

**Step 3: Update Dashboard**

Update `DigitDashboard.tsx` to show cards for the new resources (complaints, users, access-roles, workflow-business-services) with appropriate icons.

**Step 4: Verify full build**

Run: `npx vite build`
Expected: Build succeeds with all resources registered.

**Step 5: Commit**

```bash
git add src/App.tsx src/resources/index.ts src/admin/DigitDashboard.tsx
git commit -m "feat: wire all entity screens into ManagementAdmin

14 dedicated resources (8 with edit, 5 read-only, 1 tenant show-only)
plus 20+ generic MDMS resources with auto-detected Show/Edit.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 16: Clean Up Old Local Providers

Now that everything uses the package via the bridge, remove the old local provider files.

**Files:**
- Delete: `src/providers/digitDataProvider.ts` (749 lines)
- Delete: `src/providers/digitAuthProvider.ts` (89 lines)
- Delete: `src/providers/resourceRegistry.ts` (422 lines)
- Delete: `src/providers/digitDataProvider.test.ts`
- Delete: `src/providers/digitAuthProvider.test.ts`
- Delete: `src/providers/resourceRegistry.test.ts`
- Verify: No remaining imports from deleted files

**Step 1: Search for remaining imports**

Run: `grep -r "from.*providers/digitDataProvider\|from.*providers/digitAuthProvider\|from.*providers/resourceRegistry" src/`
Expected: No matches (all updated to use `bridge`).

**Step 2: Remove old files**

```bash
rm src/providers/digitDataProvider.ts src/providers/digitAuthProvider.ts src/providers/resourceRegistry.ts
rm -f src/providers/digitDataProvider.test.ts src/providers/digitAuthProvider.test.ts src/providers/resourceRegistry.test.ts
```

**Step 3: Verify build**

Run: `npx vite build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add -u src/providers/
git commit -m "chore: remove local provider files replaced by @digit-mcp/data-provider

Removes ~1260 lines of code now handled by the shared package.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Execution Summary

| Task | What | New Files | Key Patterns |
|------|------|-----------|--------------|
| 1 | Wire data-provider package | bridge.ts | `file:` dep, bridge module |
| 2 | EntityLink component | EntityLink.tsx | useGetOne, Badge click |
| 3 | Shared field components | 6 files in fields/ | StatusChip, FieldSection, etc. |
| 4 | Department screens | DepartmentShow.tsx | FieldSection + ReverseReferenceList |
| 5 | Designation screens | DesignationShow/Edit.tsx | Same pattern as departments |
| 6 | Complaint Type screens | ComplaintTypeShow/Edit.tsx | EntityLink to department |
| 7 | Employee screens | EmployeeShow/Edit.tsx | Nested user, assignment arrays |
| 8 | Complaint screens | 3 complaint files | Workflow timeline, status colors |
| 9 | Boundary screens | BoundaryShow/Edit.tsx | JsonViewer for additionalDetails |
| 10 | Localization screens | 3 localization files | Search by code/message |
| 11 | User screens | 3 user files | Roles table with cross-links |
| 12 | 5 read-only entities | 10 files | List + Show only |
| 13 | Generic MDMS Show/Edit | 2 new files | Auto-detect fields |
| 14 | Navigation sidebar | DigitLayout.tsx mod | Grouped sections |
| 15 | Wire all in App.tsx | App.tsx mod | 14 dedicated + 20+ generic |
| 16 | Clean up old providers | Delete 6 files | -1260 lines |
