# Schema-Driven MDMS Views Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace generic MDMS views with schema-driven views that auto-detect columns, render cross-links from `x-ref-schema`, and show the schema definition — so a DIGIT platform admin can navigate the full config graph without manual resource-by-resource configuration.

**Architecture:** Fetch the MDMS v2 JSON Schema definition at render time via `digitClient.mdmsSchemaSearch()`. Use `properties`, `required`, `x-unique`, and `x-ref-schema` to auto-generate ordered columns (List) and grouped fields (Show) with EntityLink cross-references. Add a collapsible Schema Definition section to every MDMS Show page and a "Referenced By" section using reverse-ref discovery.

**Tech Stack:** React 19, React-Admin 5 (ra-core), TypeScript, @tanstack/react-query 5, Vitest 4, existing component library (DigitShow, DigitList, DigitDatagrid, EntityLink, FieldSection, StatusChip, JsonViewer, ReverseReferenceList)

---

## Context for Implementers

### Key File Locations

- **UI App root:** `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/`
- **Data-provider package:** `/root/DIGIT-MCP/packages/data-provider/`
- **Data-provider is linked:** `"@digit-mcp/data-provider": "file:../../../../../DIGIT-MCP/packages/data-provider"` in the UI app's `package.json`
- **Path alias:** `@` → `./src` (configured in `vite.config.ts` and `vitest.config.ts`)

### Existing Patterns

- **Resource Registry** (`/root/DIGIT-MCP/packages/data-provider/src/providers/resourceRegistry.ts`): Every resource has a `ResourceConfig` with `type`, `label`, `schema?` (MDMS schema code), `idField`, `nameField`. Generic MDMS resources have `schema` set; dedicated resources may not.
- **Bridge** (`src/providers/bridge.ts`): Re-exports registry functions from `@digit-mcp/data-provider` and manages singleton `digitClient: DigitApiClient`.
- **DigitApiClient** has `mdmsSchemaSearch(tenantId, codes?)` that returns `SchemaDefinitions[]`.
- **DigitColumn** type: `{ source: string; label: string; sortable?: boolean; render?: (record) => ReactNode }`.
- **DigitShow** accepts `children` as `ReactNode | ((record: Record<string, unknown>) => ReactNode)`.
- **EntityLink** takes `{ resource: string; id: string; label?: string }` and resolves display name via `useGetOne`.
- **ReverseReferenceList** takes `{ resource, target, id, label, displayField?, limit? }` and uses `useGetManyReference`.
- **StatusChip**, **FieldSection/FieldRow**, **JsonViewer**, **DateField** are in `src/admin/fields/`.
- **Data-provider tests** use `node:test` + `node:assert/strict` (NOT vitest). **UI app tests** use vitest + jsdom + `@testing-library/react`.

### MDMS v2 Schema Shape

```json
{
  "type": "object",
  "properties": {
    "rolecode": { "type": "string" },
    "actionid": { "type": "number" },
    "tenantId": { "type": "string" }
  },
  "required": ["rolecode", "actionid", "tenantId"],
  "x-unique": ["rolecode", "actionid"],
  "x-ref-schema": [
    { "fieldPath": "rolecode", "schemaCode": "ACCESSCONTROL-ROLES.roles" },
    { "fieldPath": "actionid", "schemaCode": "ACCESSCONTROL-ACTIONS-TEST.actions-test" }
  ]
}
```

### Build & Deploy Cycle

```bash
# After modifying data-provider package:
cd /root/DIGIT-MCP/packages/data-provider && npm run build

# After modifying UI app or data-provider:
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npm install && npm run build && pm2 restart crs-mockup
```

---

## Task 1: Add `getResourceBySchema()` to Resource Registry

Adds a reverse-lookup function: given an MDMS schema code, find the react-admin resource name. This is the foundation for EntityLink rendering from `x-ref-schema`.

**Files:**
- Modify: `/root/DIGIT-MCP/packages/data-provider/src/providers/resourceRegistry.ts`
- Modify: `/root/DIGIT-MCP/packages/data-provider/src/providers/resourceRegistry.test.ts`
- Modify: `/root/DIGIT-MCP/packages/data-provider/src/index.ts`

**Step 1: Write the failing test**

Add to the end of `/root/DIGIT-MCP/packages/data-provider/src/providers/resourceRegistry.test.ts`:

```ts
test('getResourceBySchema returns resource name for known schema', () => {
  const result = getResourceBySchema('common-masters.Department');
  assert.strictEqual(result, 'departments');
});

test('getResourceBySchema returns undefined for unknown schema', () => {
  const result = getResourceBySchema('nonexistent.Schema');
  assert.strictEqual(result, undefined);
});

test('getResourceBySchema finds role-actions by schema code', () => {
  const result = getResourceBySchema('ACCESSCONTROL-ROLEACTIONS.roleactions');
  assert.strictEqual(result, 'role-actions');
});
```

Also add `getResourceBySchema` to the import at the top of the test file.

**Step 2: Run test to verify it fails**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --test src/providers/resourceRegistry.test.ts`
Expected: FAIL — `getResourceBySchema` is not exported

**Step 3: Write the implementation**

Add to `/root/DIGIT-MCP/packages/data-provider/src/providers/resourceRegistry.ts`, after the existing `getResourceLabel` function:

```ts
export function getResourceBySchema(schemaCode: string): string | undefined {
  for (const [name, config] of Object.entries(REGISTRY)) {
    if (config.schema === schemaCode) return name;
  }
  return undefined;
}
```

**Step 4: Export from index.ts**

In `/root/DIGIT-MCP/packages/data-provider/src/index.ts`, add `getResourceBySchema` to the resource registry export line:

```ts
export {
  REGISTRY, getResourceConfig, getAllResources,
  getDedicatedResources, getMdmsResources, getGenericMdmsResources,
  getResourceIdField, getResourceLabel, getResourceBySchema,
} from './providers/resourceRegistry.js';
```

**Step 5: Run test to verify it passes**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --test src/providers/resourceRegistry.test.ts`
Expected: All tests PASS

**Step 6: Re-export from bridge.ts**

In `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/providers/bridge.ts`, add `getResourceBySchema` to the re-export:

```ts
export {
  getResourceConfig,
  getAllResources,
  getDedicatedResources,
  getGenericMdmsResources,
  getResourceIdField,
  getResourceLabel,
  getResourceBySchema,
  REGISTRY,
} from '@digit-mcp/data-provider';
```

**Step 7: Build data-provider**

Run: `cd /root/DIGIT-MCP/packages/data-provider && npm run build`
Expected: Clean build, no errors

**Step 8: Commit**

```bash
cd /root/DIGIT-MCP/packages/data-provider && git add src/providers/resourceRegistry.ts src/providers/resourceRegistry.test.ts src/index.ts
git commit -m "feat: add getResourceBySchema() reverse lookup to registry"
```

---

## Task 2: Create `schemaUtils.ts` — Pure Functions for Schema-Driven Rendering

Pure functions that convert a JSON Schema definition into ordered columns (for List) and grouped fields (for Show). No React dependencies — just data transformation.

**Files:**
- Create: `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/admin/schemaUtils.ts`
- Create: `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/admin/schemaUtils.test.ts`

**Step 1: Write the test file**

Create `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/admin/schemaUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  getRefMap,
  orderFields,
  generateColumns,
  groupShowFields,
  formatFieldLabel,
  type SchemaDefinition,
} from './schemaUtils';

const ROLEACTIONS_SCHEMA: SchemaDefinition = {
  type: 'object',
  properties: {
    rolecode: { type: 'string' },
    actionid: { type: 'number' },
    tenantId: { type: 'string' },
    actioncode: { type: 'string' },
  },
  required: ['rolecode', 'actionid', 'tenantId'],
  'x-unique': ['rolecode', 'actionid'],
  'x-ref-schema': [
    { fieldPath: 'rolecode', schemaCode: 'ACCESSCONTROL-ROLES.roles' },
    { fieldPath: 'actionid', schemaCode: 'ACCESSCONTROL-ACTIONS-TEST.actions-test' },
  ],
};

const DEPARTMENT_SCHEMA: SchemaDefinition = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    active: { type: 'boolean' },
  },
  required: ['code', 'name'],
  'x-unique': ['code'],
};

const SCHEMA_WITH_NESTED: SchemaDefinition = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    items: { type: 'array', items: { type: 'object' } },
    config: { type: 'object' },
    active: { type: 'boolean' },
  },
  required: ['key'],
  'x-unique': ['key'],
};

describe('getRefMap', () => {
  it('builds fieldPath → { schemaCode, resource } map from x-ref-schema', () => {
    // Mock resource lookup: rolecode→roles, actionid→action-mappings
    const lookup = (schema: string) => {
      if (schema === 'ACCESSCONTROL-ROLES.roles') return 'roles';
      if (schema === 'ACCESSCONTROL-ACTIONS-TEST.actions-test') return 'action-mappings';
      return undefined;
    };
    const refMap = getRefMap(ROLEACTIONS_SCHEMA, lookup);
    expect(refMap).toEqual({
      rolecode: { schemaCode: 'ACCESSCONTROL-ROLES.roles', resource: 'roles' },
      actionid: { schemaCode: 'ACCESSCONTROL-ACTIONS-TEST.actions-test', resource: 'action-mappings' },
    });
  });

  it('returns empty map when no x-ref-schema', () => {
    const refMap = getRefMap(DEPARTMENT_SCHEMA, () => undefined);
    expect(refMap).toEqual({});
  });

  it('omits entries where resource lookup fails', () => {
    const lookup = (schema: string) => {
      if (schema === 'ACCESSCONTROL-ROLES.roles') return 'roles';
      return undefined; // actionid schema not found
    };
    const refMap = getRefMap(ROLEACTIONS_SCHEMA, lookup);
    expect(Object.keys(refMap)).toEqual(['rolecode']);
  });
});

describe('orderFields', () => {
  it('orders: x-unique first, then required, then optional', () => {
    const fields = orderFields(ROLEACTIONS_SCHEMA);
    expect(fields).toEqual(['rolecode', 'actionid', 'tenantId', 'actioncode']);
  });

  it('handles schema with no x-unique gracefully', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a'],
    };
    const fields = orderFields(schema);
    expect(fields).toEqual(['a', 'b']);
  });
});

describe('generateColumns', () => {
  it('generates columns from schema with correct order and max 8', () => {
    const refMap = {
      rolecode: { schemaCode: 'ACCESSCONTROL-ROLES.roles', resource: 'roles' },
      actionid: { schemaCode: 'ACCESSCONTROL-ACTIONS-TEST.actions-test', resource: 'action-mappings' },
    };
    const cols = generateColumns(ROLEACTIONS_SCHEMA, refMap);
    expect(cols.length).toBe(4);
    expect(cols[0].source).toBe('rolecode');
    expect(cols[1].source).toBe('actionid');
    expect(cols[2].source).toBe('tenantId');
    expect(cols[3].source).toBe('actioncode');
  });

  it('skips array and object fields', () => {
    const cols = generateColumns(SCHEMA_WITH_NESTED, {});
    const sources = cols.map((c) => c.source);
    expect(sources).not.toContain('items');
    expect(sources).not.toContain('config');
    expect(sources).toContain('key');
    expect(sources).toContain('active');
  });

  it('caps columns at 8', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [`field${i}`, { type: 'string' }])
      ),
      required: Array.from({ length: 12 }, (_, i) => `field${i}`),
      'x-unique': ['field0'],
    };
    const cols = generateColumns(schema, {});
    expect(cols.length).toBeLessThanOrEqual(8);
  });

  it('marks ref columns with hasRef', () => {
    const refMap = {
      rolecode: { schemaCode: 'ACCESSCONTROL-ROLES.roles', resource: 'roles' },
    };
    const cols = generateColumns(ROLEACTIONS_SCHEMA, refMap);
    const roleCol = cols.find((c) => c.source === 'rolecode');
    expect(roleCol?.render).toBeDefined(); // has custom render for EntityLink
  });
});

describe('groupShowFields', () => {
  it('groups fields into key, details, optional, complex sections', () => {
    const groups = groupShowFields(ROLEACTIONS_SCHEMA);
    expect(groups.key).toEqual(['rolecode', 'actionid']);
    expect(groups.details).toEqual(['tenantId']);
    expect(groups.optional).toEqual(['actioncode']);
    expect(groups.complex).toEqual([]);
  });

  it('puts array/object fields in complex group', () => {
    const groups = groupShowFields(SCHEMA_WITH_NESTED);
    expect(groups.complex).toEqual(['items', 'config']);
    expect(groups.key).toEqual(['key']);
    expect(groups.details).toEqual([]);
    expect(groups.optional).toEqual(['active']);
  });
});

describe('formatFieldLabel', () => {
  it('converts camelCase to Title Case', () => {
    expect(formatFieldLabel('rolecode')).toBe('Rolecode');
    expect(formatFieldLabel('actionId')).toBe('Action Id');
    expect(formatFieldLabel('businessService')).toBe('Business Service');
  });

  it('converts snake_case to Title Case', () => {
    expect(formatFieldLabel('tenant_id')).toBe('Tenant Id');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx vitest run src/admin/schemaUtils.test.ts`
Expected: FAIL — module `./schemaUtils` not found

**Step 3: Write the implementation**

Create `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/admin/schemaUtils.ts`:

```ts
import React from 'react';
import type { DigitColumn } from './DigitDatagrid';
import { EntityLink } from '@/components/ui/EntityLink';

// --- Types ---

export interface SchemaProperty {
  type?: string;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  enum?: unknown[];
  description?: string;
}

export interface RefSchemaEntry {
  fieldPath: string;
  schemaCode: string;
}

export interface SchemaDefinition {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  'x-unique'?: string[];
  'x-ref-schema'?: RefSchemaEntry[];
}

export interface RefMapEntry {
  schemaCode: string;
  resource: string;
}

export interface ShowFieldGroups {
  key: string[];
  details: string[];
  optional: string[];
  complex: string[];
}

// --- Pure Functions ---

/**
 * Build a map of fieldPath → { schemaCode, resource } from x-ref-schema.
 * Uses `resourceLookup` to resolve schema codes to react-admin resource names.
 * Entries where the resource can't be found are omitted.
 */
export function getRefMap(
  schema: SchemaDefinition,
  resourceLookup: (schemaCode: string) => string | undefined
): Record<string, RefMapEntry> {
  const refs = schema['x-ref-schema'];
  if (!refs || !Array.isArray(refs)) return {};

  const map: Record<string, RefMapEntry> = {};
  for (const ref of refs) {
    const resource = resourceLookup(ref.schemaCode);
    if (resource) {
      map[ref.fieldPath] = { schemaCode: ref.schemaCode, resource };
    }
  }
  return map;
}

/**
 * Order fields from a schema definition:
 * 1. x-unique fields (primary keys)
 * 2. required fields (not in x-unique)
 * 3. optional fields (not required, not x-unique)
 */
export function orderFields(schema: SchemaDefinition): string[] {
  const props = schema.properties ?? {};
  const allFields = Object.keys(props);
  const unique = new Set(schema['x-unique'] ?? []);
  const required = new Set(schema.required ?? []);

  const uniqueFields = allFields.filter((f) => unique.has(f));
  const requiredFields = allFields.filter((f) => required.has(f) && !unique.has(f));
  const optionalFields = allFields.filter((f) => !required.has(f) && !unique.has(f));

  return [...uniqueFields, ...requiredFields, ...optionalFields];
}

/**
 * Check if a field has a complex type (array or object) that shouldn't appear in table columns.
 */
function isComplexType(prop: SchemaProperty): boolean {
  return prop.type === 'array' || prop.type === 'object';
}

/**
 * Generate DigitColumn[] from a schema definition for List view.
 * - Orders by x-unique → required → optional
 * - Skips array/object fields
 * - Caps at 8 columns
 * - Adds EntityLink render for x-ref-schema fields
 */
export function generateColumns(
  schema: SchemaDefinition,
  refMap: Record<string, RefMapEntry>
): DigitColumn[] {
  const props = schema.properties ?? {};
  const ordered = orderFields(schema);

  const columns: DigitColumn[] = [];

  for (const fieldName of ordered) {
    if (columns.length >= 8) break;

    const prop = props[fieldName];
    if (!prop || isComplexType(prop)) continue;

    const col: DigitColumn = {
      source: fieldName,
      label: formatFieldLabel(fieldName),
    };

    // Add EntityLink renderer for ref fields
    const ref = refMap[fieldName];
    if (ref) {
      col.render = (record) => {
        const value = (record as Record<string, unknown>)[fieldName];
        if (value == null || value === '') return React.createElement('span', { className: 'text-muted-foreground' }, '--');
        return React.createElement(EntityLink, {
          resource: ref.resource,
          id: String(value),
        });
      };
    }

    columns.push(col);
  }

  return columns;
}

/**
 * Group fields into sections for Show view:
 * - key: x-unique fields
 * - details: required fields (not in x-unique), non-complex
 * - optional: non-required, non-complex
 * - complex: array or object type fields
 */
export function groupShowFields(schema: SchemaDefinition): ShowFieldGroups {
  const props = schema.properties ?? {};
  const allFields = Object.keys(props);
  const unique = new Set(schema['x-unique'] ?? []);
  const required = new Set(schema.required ?? []);

  const groups: ShowFieldGroups = { key: [], details: [], optional: [], complex: [] };

  for (const field of allFields) {
    const prop = props[field];
    if (!prop) continue;

    if (isComplexType(prop)) {
      groups.complex.push(field);
    } else if (unique.has(field)) {
      groups.key.push(field);
    } else if (required.has(field)) {
      groups.details.push(field);
    } else {
      groups.optional.push(field);
    }
  }

  return groups;
}

/**
 * Convert a field name to a human-readable label.
 * camelCase → Title Case, snake_case → Title Case
 */
export function formatFieldLabel(fieldName: string): string {
  return fieldName
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx vitest run src/admin/schemaUtils.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup
git add src/admin/schemaUtils.ts src/admin/schemaUtils.test.ts
git commit -m "feat: add schemaUtils — pure functions for schema-driven column/field generation"
```

---

## Task 3: Create `useSchemaDefinition` Hook

React hook that fetches the MDMS v2 JSON Schema definition for a schema code. Caches permanently (schemas don't change during a session).

**Files:**
- Create: `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/hooks/useSchemaDefinition.ts`

**Step 1: Write the hook**

Create `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/hooks/useSchemaDefinition.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { digitClient } from '@/providers/bridge';
import type { SchemaDefinition } from '@/admin/schemaUtils';

interface UseSchemaDefinitionResult {
  definition: SchemaDefinition | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetch the MDMS v2 JSON Schema definition for a given schema code.
 * Results are cached with infinite staleTime — schemas don't change during a session.
 *
 * The hook resolves the tenant from the digitClient's stateTenantId.
 */
export function useSchemaDefinition(schemaCode?: string): UseSchemaDefinitionResult {
  const tenantId = digitClient.stateTenantId;

  const { data, isLoading, error } = useQuery<SchemaDefinition | null, Error>({
    queryKey: ['mdms-schema-definition', tenantId, schemaCode],
    queryFn: async () => {
      if (!schemaCode || !tenantId) return null;
      const results = await digitClient.mdmsSchemaSearch(tenantId, [schemaCode]);
      if (results.length === 0) return null;
      const schemaDef = results[0] as Record<string, unknown>;
      return (schemaDef.definition as SchemaDefinition) ?? null;
    },
    enabled: !!schemaCode && !!tenantId,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return {
    definition: data ?? null,
    isLoading,
    error: error ?? null,
  };
}
```

**Step 2: Verify it compiles**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx tsc --noEmit src/hooks/useSchemaDefinition.ts 2>&1 | head -20`

If the path alias `@` doesn't resolve in `tsc --noEmit` alone, that's fine — the real compile check is the Vite build in the final task. Just make sure there are no obvious syntax errors.

**Step 3: Commit**

```bash
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup
git add src/hooks/useSchemaDefinition.ts
git commit -m "feat: add useSchemaDefinition hook — fetches MDMS schema with infinite cache"
```

---

## Task 4: Create `useReverseRefs` Hook

React hook that discovers which other schemas reference a given schema code via their `x-ref-schema`. Fetches ALL schema definitions once, builds a reverse-ref index, caches it.

**Files:**
- Create: `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/hooks/useReverseRefs.ts`

**Step 1: Write the hook**

Create `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/hooks/useReverseRefs.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { digitClient, getResourceBySchema } from '@/providers/bridge';
import type { RefSchemaEntry } from '@/admin/schemaUtils';

export interface ReverseRef {
  /** Schema code of the referencing resource */
  fromSchema: string;
  /** react-admin resource name of the referencing resource (empty if not in registry) */
  fromResource: string;
  /** The field in the referencing schema that points to us */
  fieldPath: string;
  /** Human label for the referencing resource */
  fromLabel: string;
}

interface UseReverseRefsResult {
  refs: ReverseRef[];
  isLoading: boolean;
}

/**
 * Fetch all MDMS schema definitions, then find which schemas reference
 * the given schemaCode via their x-ref-schema entries.
 *
 * Result is cached with infinite staleTime — schema relationships are static.
 */
export function useReverseRefs(schemaCode?: string): UseReverseRefsResult {
  const tenantId = digitClient.stateTenantId;

  // Fetch ALL schemas once and build a reverse-ref index
  const { data: allSchemas, isLoading: schemasLoading } = useQuery<Record<string, unknown>[], Error>({
    queryKey: ['mdms-all-schemas', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      return digitClient.mdmsSchemaSearch(tenantId);
    },
    enabled: !!tenantId && !!schemaCode,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (!schemaCode || schemasLoading || !allSchemas) {
    return { refs: [], isLoading: schemasLoading };
  }

  // Build reverse-ref index: for each schema, check if its x-ref-schema points to our schemaCode
  const refs: ReverseRef[] = [];
  for (const schemaDef of allSchemas) {
    const code = schemaDef.code as string | undefined;
    const definition = schemaDef.definition as Record<string, unknown> | undefined;
    if (!code || !definition) continue;

    const xRefSchema = definition['x-ref-schema'] as RefSchemaEntry[] | undefined;
    if (!xRefSchema || !Array.isArray(xRefSchema)) continue;

    for (const ref of xRefSchema) {
      if (ref.schemaCode === schemaCode) {
        const fromResource = getResourceBySchema(code) ?? '';
        refs.push({
          fromSchema: code,
          fromResource,
          fieldPath: ref.fieldPath,
          fromLabel: fromResource
            ? fromResource.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
            : code,
        });
      }
    }
  }

  return { refs, isLoading: false };
}
```

**Step 2: Commit**

```bash
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup
git add src/hooks/useReverseRefs.ts
git commit -m "feat: add useReverseRefs hook — discovers inbound schema references"
```

---

## Task 5: Enhance `MdmsResourcePage` (List View) with Schema-Driven Columns

Replace the auto-detect-from-first-record logic with schema-driven column generation. Falls back to current behavior if schema isn't available.

**Files:**
- Modify: `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/admin/MdmsResourcePage.tsx`

**Step 1: Read the current file**

Read `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/admin/MdmsResourcePage.tsx` to confirm current content.

**Step 2: Replace the file content**

Replace the entire content of `src/admin/MdmsResourcePage.tsx` with:

```tsx
import { useMemo } from 'react';
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { useListController, ListContextProvider, useResourceContext } from 'ra-core';
import { getResourceConfig, getResourceLabel, getResourceBySchema } from '@/providers/bridge';
import { useSchemaDefinition } from '@/hooks/useSchemaDefinition';
import { generateColumns, getRefMap } from './schemaUtils';

export function MdmsResourcePage() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const label = getResourceLabel(resource);

  const listContext = useListController({
    sort: { field: config?.idField ?? 'id', order: 'ASC' },
    perPage: 25,
  });

  // Fetch schema definition for this resource
  const { definition } = useSchemaDefinition(config?.schema);

  // Generate columns from schema (or fall back to auto-detect)
  const schemaColumns = useMemo(() => {
    if (!definition) return null;
    const refMap = getRefMap(definition, getResourceBySchema);
    return generateColumns(definition, refMap);
  }, [definition]);

  // Fallback: auto-detect columns from first record (original behavior)
  const firstRecord = listContext.data?.[0];
  const autoColumns: DigitColumn[] = useMemo(() => {
    if (!firstRecord) return [{ source: 'id', label: 'ID' }];
    return Object.keys(firstRecord as Record<string, unknown>)
      .filter((key) => !key.startsWith('_') && key !== 'id')
      .slice(0, 8)
      .map((key) => ({
        source: key,
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()),
      }));
  }, [firstRecord]);

  const columns = schemaColumns ?? autoColumns;

  // Subtitle showing schema code when available
  const subtitle = config?.schema ? `Schema: ${config.schema}` : undefined;

  return (
    <ListContextProvider value={listContext}>
      <DigitList title={label} subtitle={subtitle}>
        <DigitDatagrid columns={columns} rowClick="show" />
      </DigitList>
    </ListContextProvider>
  );
}
```

**Step 3: Check if `DigitList` supports `subtitle` prop**

Read `src/admin/DigitList.tsx` to check if it accepts a `subtitle` prop. If not, we need to add it.

If `DigitList` does NOT have a `subtitle` prop, add it:

In `src/admin/DigitList.tsx`, add `subtitle?: string` to the props interface. Then render it below the title as:

```tsx
{subtitle && (
  <p className="text-xs text-muted-foreground font-mono mt-0.5">{subtitle}</p>
)}
```

If `DigitList` already supports `subtitle`, skip this step.

**Step 4: Verify the app compiles**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 5: Commit**

```bash
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup
git add src/admin/MdmsResourcePage.tsx
# Also add DigitList.tsx if modified
git commit -m "feat: MdmsResourcePage uses schema-driven columns with EntityLink refs"
```

---

## Task 6: Enhance `MdmsResourceShow` (Show View) with Schema-Driven Fields

Replace the flat key-value dump with schema-driven grouped fields, EntityLink cross-references, reverse references, and a collapsible Schema Definition section.

**Files:**
- Modify: `/root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup/src/admin/MdmsResourceShow.tsx`

**Step 1: Read the current file**

Read `src/admin/MdmsResourceShow.tsx` to confirm current content.

**Step 2: Replace the file content**

Replace the entire content of `src/admin/MdmsResourceShow.tsx` with:

```tsx
import { DigitShow } from './DigitShow';
import { FieldSection, FieldRow, StatusChip, JsonViewer } from './fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { ReverseReferenceList } from './fields/ReverseReferenceList';
import { useShowController, useResourceContext } from 'ra-core';
import { getResourceConfig, getResourceLabel, getResourceBySchema } from '@/providers/bridge';
import { useSchemaDefinition } from '@/hooks/useSchemaDefinition';
import { useReverseRefs } from '@/hooks/useReverseRefs';
import { groupShowFields, getRefMap, formatFieldLabel } from './schemaUtils';
import type { SchemaDefinition, RefMapEntry } from './schemaUtils';

export function MdmsResourceShow() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const label = getResourceLabel(resource);
  const { record } = useShowController();

  // Fetch schema definition and reverse refs
  const { definition } = useSchemaDefinition(config?.schema);
  const { refs: reverseRefs } = useReverseRefs(config?.schema);

  return (
    <DigitShow title={record ? `${label}: ${record[config?.idField ?? 'id'] ?? record.id}` : label} hasEdit>
      {(rec: Record<string, unknown>) => {
        if (definition) {
          return <SchemaShowContent rec={rec} definition={definition} reverseRefs={reverseRefs} />;
        }
        // Fallback: original generic rendering
        return <FallbackShowContent rec={rec} />;
      }}
    </DigitShow>
  );
}

/** Schema-driven Show content with grouped fields, EntityLinks, and reverse refs */
function SchemaShowContent({
  rec,
  definition,
  reverseRefs,
}: {
  rec: Record<string, unknown>;
  definition: SchemaDefinition;
  reverseRefs: Array<{ fromSchema: string; fromResource: string; fieldPath: string; fromLabel: string }>;
}) {
  const refMap = getRefMap(definition, getResourceBySchema);
  const groups = groupShowFields(definition);

  // Find extra fields in data that aren't in the schema
  const schemaFields = new Set(Object.keys(definition.properties ?? {}));
  const extraFields = Object.keys(rec).filter(
    (k) => !k.startsWith('_') && k !== 'id' && !schemaFields.has(k)
  );

  return (
    <div className="space-y-6">
      {/* Key fields (x-unique) */}
      {groups.key.length > 0 && (
        <FieldSection title="Key">
          {groups.key.map((field) => (
            <SchemaFieldRow key={field} field={field} value={rec[field]} refMap={refMap} definition={definition} />
          ))}
        </FieldSection>
      )}

      {/* Required fields */}
      {groups.details.length > 0 && (
        <FieldSection title="Details">
          {groups.details.map((field) => (
            <SchemaFieldRow key={field} field={field} value={rec[field]} refMap={refMap} definition={definition} />
          ))}
        </FieldSection>
      )}

      {/* Optional fields */}
      {groups.optional.length > 0 && (
        <FieldSection title="Additional">
          {groups.optional.map((field) => (
            <SchemaFieldRow key={field} field={field} value={rec[field]} refMap={refMap} definition={definition} />
          ))}
        </FieldSection>
      )}

      {/* Complex fields (arrays, objects) */}
      {groups.complex.length > 0 && (
        <FieldSection title="Nested Data">
          {groups.complex.map((field) => (
            <FieldRow key={field} label={formatFieldLabel(field)}>
              {rec[field] != null ? (
                <JsonViewer data={rec[field]} initialExpanded={false} />
              ) : (
                <span className="text-muted-foreground">--</span>
              )}
            </FieldRow>
          ))}
        </FieldSection>
      )}

      {/* Extra fields not in schema */}
      {extraFields.length > 0 && (
        <FieldSection title="Extra Fields">
          {extraFields.map((field) => {
            const value = rec[field];
            if (value != null && typeof value === 'object') {
              return (
                <FieldRow key={field} label={formatFieldLabel(field)}>
                  <JsonViewer data={value} initialExpanded={false} />
                </FieldRow>
              );
            }
            return (
              <FieldRow key={field} label={formatFieldLabel(field)}>
                {value != null ? String(value) : '--'}
              </FieldRow>
            );
          })}
        </FieldSection>
      )}

      {/* Reverse References */}
      {reverseRefs.length > 0 && (
        <FieldSection title="Referenced By">
          {reverseRefs
            .filter((ref) => ref.fromResource) // only show if resource is in registry
            .map((ref) => (
              <ReverseReferenceList
                key={`${ref.fromSchema}-${ref.fieldPath}`}
                resource={ref.fromResource}
                target={ref.fieldPath}
                id={String(rec[getTargetField(ref, definition)] ?? rec.id ?? '')}
                label={ref.fromLabel}
                limit={5}
              />
            ))}
        </FieldSection>
      )}

      {/* Schema Definition (collapsible) */}
      <FieldSection title="Schema Definition">
        <JsonViewer data={definition} initialExpanded={false} />
      </FieldSection>
    </div>
  );
}

/** Render a single field with type-aware formatting and EntityLink for refs */
function SchemaFieldRow({
  field,
  value,
  refMap,
  definition,
}: {
  field: string;
  value: unknown;
  refMap: Record<string, RefMapEntry>;
  definition: SchemaDefinition;
}) {
  const label = formatFieldLabel(field);
  const ref = refMap[field];
  const propType = definition.properties?.[field]?.type;

  // EntityLink for referenced fields
  if (ref && value != null && value !== '') {
    return (
      <FieldRow label={label}>
        <EntityLink resource={ref.resource} id={String(value)} />
      </FieldRow>
    );
  }

  // Boolean → StatusChip
  if (propType === 'boolean' || typeof value === 'boolean') {
    return (
      <FieldRow label={label}>
        <StatusChip value={value} labels={{ true: 'Yes', false: 'No' }} />
      </FieldRow>
    );
  }

  // Default: plain text
  return (
    <FieldRow label={label}>
      {value != null ? String(value) : <span className="text-muted-foreground">--</span>}
    </FieldRow>
  );
}

/**
 * For reverse references, determine which field of the CURRENT record
 * the referencing schema's fieldPath points to. For most cases, the
 * fieldPath IS the field on the current record that holds the value
 * the referencing record uses as its foreign key. But we need to find
 * the right ID value to filter on.
 *
 * Example: role-actions has x-ref-schema pointing to roles via "rolecode".
 * On the roles Show page, we want to show role-actions where rolecode = THIS role's code.
 * So the target field is whatever x-unique field of the current schema matches.
 */
function getTargetField(
  ref: { fieldPath: string },
  definition: SchemaDefinition
): string {
  // The fieldPath tells us which field in the REFERENCING schema points to us.
  // We need to find which field in OUR schema is the one being referenced.
  // Usually it's the first x-unique field.
  const unique = definition['x-unique'];
  if (unique && unique.length > 0) return unique[0];
  return 'id';
}

/** Fallback: original generic rendering (no schema) */
function FallbackShowContent({ rec }: { rec: Record<string, unknown> }) {
  const keys = Object.keys(rec).filter((k) => !k.startsWith('_') && k !== 'id');

  return (
    <div className="space-y-6">
      <FieldSection title="Details">
        {keys.map((key) => {
          const value = rec[key];
          const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

          if (typeof value === 'boolean') {
            return (
              <FieldRow key={key} label={displayKey}>
                <StatusChip value={value} labels={{ true: 'Yes', false: 'No' }} />
              </FieldRow>
            );
          }

          if (value != null && typeof value === 'object') {
            return (
              <FieldRow key={key} label={displayKey}>
                <JsonViewer data={value} initialExpanded={false} />
              </FieldRow>
            );
          }

          return (
            <FieldRow key={key} label={displayKey}>
              {value != null ? String(value) : '--'}
            </FieldRow>
          );
        })}
      </FieldSection>
    </div>
  );
}
```

**Step 3: Verify the app compiles**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx vite build 2>&1 | tail -10`
Expected: Build succeeds

**Step 4: Commit**

```bash
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup
git add src/admin/MdmsResourceShow.tsx
git commit -m "feat: MdmsResourceShow uses schema-driven grouped fields, EntityLinks, reverse refs, schema definition section"
```

---

## Task 7: Build, Install, Deploy, and Verify

Build the data-provider package, install it in the UI app, build the UI app, restart PM2, and verify the changes work on the live site.

**Files:** None created/modified — this is a build/deploy/verify task.

**Step 1: Build data-provider package**

Run: `cd /root/DIGIT-MCP/packages/data-provider && npm run build`
Expected: Clean build

**Step 2: Install updated data-provider in UI app**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npm install`
Expected: No errors

**Step 3: Run all tests**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx vitest run`
Expected: All tests pass (schemaUtils tests + any existing tests)

**Step 4: Build UI app**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npm run build`
Expected: Clean Vite build with no errors

**Step 5: Restart PM2**

Run: `pm2 restart crs-mockup`
Expected: PM2 shows `online` status

**Step 6: Verify role-actions List page**

Navigate to `https://crs-mockup.egov.theflywheel.in/manage/role-actions` and confirm:
- Columns are ordered: rolecode, actionid, tenantId, actioncode
- rolecode column shows EntityLink badges (clickable, linking to roles)
- actionid column shows EntityLink badges (clickable, linking to action-mappings)
- Subtitle shows "Schema: ACCESSCONTROL-ROLEACTIONS.roleactions"

**Step 7: Verify role-actions Show page**

Click a row and confirm:
- "Key" section with rolecode (EntityLink) and actionid (EntityLink)
- "Details" section with tenantId
- "Additional" section with actioncode
- "Referenced By" section (if any schemas reference roleactions)
- "Schema Definition" section (collapsible, collapsed by default)

**Step 8: Verify departments Show page**

Navigate to `https://crs-mockup.egov.theflywheel.in/manage/departments`, click a department:
- Should still use its dedicated DepartmentShow component (not affected by this change)

**Step 9: Verify a schema-less resource falls back gracefully**

Check any generic MDMS resource that might not have a schema defined — it should render with the original auto-detect behavior.

**Step 10: Commit final state**

```bash
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup
git add -A
git commit -m "chore: build and deploy schema-driven MDMS views"
```

---

## Future Work (Not in This Plan)

### Dedicated Override Components (Phase 2)

The following 6 resources have complex nested structures that would benefit from custom Show components beyond what the schema-driven engine provides:

1. **Workflow BusinessService MDMS** (`Workflow.BusinessService`) — state machine visualization
2. **Workflow AutoEscalation** (`Workflow.AutoEscalation`) — SLA duration formatting
3. **Workflow Config** (`Workflow.BusinessServiceConfig`) — structured config display
4. **Encryption Policy** (`DataSecurity.EncryptionPolicy`) — attribute list table
5. **Inbox Config** (`INBOX.InboxQueryConfiguration`) — search criteria table
6. **SLA Config** (`common-masters.wfSlaConfig`) — color swatches

These would be registered as dedicated Show overrides in `App.tsx`, replacing the generic `MdmsResourceShow` for those specific resources.
