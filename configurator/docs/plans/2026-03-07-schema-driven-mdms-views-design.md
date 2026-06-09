# Schema-Driven MDMS Views Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace generic MDMS views with schema-driven views that auto-detect columns, render cross-links from `x-ref-schema`, and show the schema definition — so a DIGIT platform admin can navigate the full config graph without manual resource-by-resource configuration.

**Architecture:** Fetch the MDMS v2 JSON Schema definition at render time. Use `properties`, `required`, `x-unique`, and `x-ref-schema` to auto-generate columns, field renderers, and EntityLinks. Add a collapsible Schema Definition section to every MDMS Show page. For the ~6 resources with complex nested structures, add dedicated override components.

**Tech Stack:** React, React-Admin (ra-core), TypeScript, existing component library (DigitShow, DigitList, DigitDatagrid, EntityLink, FieldSection, StatusChip, JsonViewer, ReverseReferenceList)

---

## 1. Schema-Driven Rendering Engine

### 1.1 Schema Fetching

Add a `useSchemaDefinition(schemaCode)` hook that:
- Calls `digitClient.mdmsSchemaSearch(tenantId, [schemaCode])`
- Caches the result (schemas don't change during a session)
- Returns `{ definition, isLoading, error }`

The hook is called from both `MdmsResourcePage` (List) and `MdmsResourceShow` (Show).

### 1.2 Column Auto-Generation (List View)

Given a schema definition, generate ordered columns:

1. **x-unique fields** first (these are the primary key — always shown)
2. **required fields** next (important data)
3. **Optional fields** last (only if total columns < 8)
4. **Skip** fields that are `type: "array"` or `type: "object"` (too complex for table cells)

Each column gets a renderer based on its type:
- `string` → plain text
- `number` → right-aligned text
- `boolean` → StatusChip (Yes/No)
- Fields in `x-ref-schema` → EntityLink to the referenced resource

### 1.3 Field Auto-Generation (Show View)

Show all fields from the schema definition, plus any extra fields present in the data but not in the schema (for forward compatibility). Order:

1. **x-unique fields** in a "Key" section
2. **required fields** in a "Details" section
3. **Optional fields** in an "Additional" section
4. **Array/Object fields** rendered as JsonViewer or nested tables
5. **Schema Definition** section (collapsible, default collapsed)

### 1.4 Cross-Link Resolution via x-ref-schema

The `x-ref-schema` array declares foreign key relationships:

```json
"x-ref-schema": [
  { "fieldPath": "rolecode", "schemaCode": "ACCESSCONTROL-ROLES.roles" },
  { "fieldPath": "actionid", "schemaCode": "ACCESSCONTROL-ACTIONS-TEST.actions-test" }
]
```

To render an EntityLink, we need to map `schemaCode` → react-admin resource name. Add a `getResourceBySchema(schemaCode)` helper to the registry that does a reverse lookup.

When rendering a field that appears in `x-ref-schema`:
- In **List view**: render the cell as an EntityLink badge
- In **Show view**: render the field value as an EntityLink badge
- The EntityLink fetches the referenced record and shows its `nameField`

### 1.5 Reverse References

For each `x-ref-schema` entry pointing TO this resource's schema, show a "Referenced By" section with ReverseReferenceList.

Example: On the `action-mappings` Show page, we detect that `ACCESSCONTROL-ROLEACTIONS.roleactions` has `x-ref-schema` pointing to `ACCESSCONTROL-ACTIONS-TEST.actions-test` via `actionid`. So we show "Role Actions referencing this action" using ReverseReferenceList.

This requires:
- At schema fetch time, also search ALL schemas to build a reverse-ref index
- Cache this index (it's static per session)
- `useReverseRefs(schemaCode)` hook returns all schemas that reference this one

### 1.6 Schema Code → Resource Name Mapping

Add to `resourceRegistry.ts`:

```ts
export function getResourceBySchema(schemaCode: string): string | undefined {
  for (const [name, config] of Object.entries(REGISTRY)) {
    if (config.schema === schemaCode) return name;
  }
  return undefined;
}
```

This enables:
- `x-ref-schema` → EntityLink (field → resource)
- Reverse ref discovery (schema → resource → ReverseReferenceList)

---

## 2. Component Changes

### 2.1 New: `useSchemaDefinition` Hook

**File:** `src/hooks/useSchemaDefinition.ts`

```ts
function useSchemaDefinition(schemaCode?: string): {
  definition: JSONSchema | null;
  isLoading: boolean;
  error: Error | null;
}
```

Uses React Query with infinite staleTime (schemas don't change).

### 2.2 New: `useReverseRefs` Hook

**File:** `src/hooks/useReverseRefs.ts`

```ts
function useReverseRefs(schemaCode?: string): {
  refs: Array<{ fromSchema: string; fromResource: string; fieldPath: string }>;
  isLoading: boolean;
}
```

Fetches all schema definitions once, builds reverse-ref index, caches it.

### 2.3 New: `schemaUtils.ts` Helper

**File:** `src/admin/schemaUtils.ts`

Pure functions:
- `generateColumns(definition, refSchemas)` → DigitColumn[]
- `generateShowFields(definition)` → ordered field list with section grouping
- `getFieldRenderer(fieldName, fieldSchema, refSchemas)` → render function
- `mapRefToResource(schemaCode)` → resource name or undefined

### 2.4 Enhanced: `MdmsResourcePage` (List View)

Currently auto-detects columns from first record. Change to:

1. Fetch schema definition via `useSchemaDefinition(config.schema)`
2. If schema available: use `generateColumns()` for ordered, typed columns with EntityLinks
3. If schema unavailable (fallback): use current auto-detect behavior
4. Show schema code in subtitle

### 2.5 Enhanced: `MdmsResourceShow` (Show View)

Currently dumps all fields as key-value pairs. Change to:

1. Fetch schema definition via `useSchemaDefinition(config.schema)`
2. Fetch reverse refs via `useReverseRefs(config.schema)`
3. Render fields grouped by importance (key → required → optional)
4. Render x-ref-schema fields as EntityLinks
5. Render arrays as nested tables (if items have properties) or JsonViewer
6. Add "Referenced By" section with ReverseReferenceList for each reverse ref
7. Add collapsible "Schema Definition" section at bottom

---

## 3. Dedicated Override Components (6 resources)

For resources with complex nested structures that can't be auto-generated:

### 3.1 Workflow BusinessService MDMS (`Workflow.BusinessService`)
- State machine with nested `states[]` → `actions[]` → `roles`
- Reuse the visual pattern from existing `WorkflowServiceShow`
- Show state diagram with role links

### 3.2 Workflow AutoEscalation (`Workflow.AutoEscalation`)
- Show `businessService` as EntityLink to workflow-business-services
- Format `stateSLA` and `businessSLA` as human-readable durations
- Show `state` + `action` as a mini state transition

### 3.3 Workflow Config (`Workflow.BusinessServiceConfig`)
- Link `businessService` to workflow-business-services
- Show nested config as structured key-value

### 3.4 Encryption Policy (`DataSecurity.EncryptionPolicy`)
- Show `attributeList[]` as a table: jsonPath | type
- Group by key

### 3.5 Inbox Config (`INBOX.InboxQueryConfiguration`)
- Show `allowedSearchCriteria[]` as a table: name | path | operator | mandatory
- Show `sourceFilterPathList` as badges
- Show `sortBy` as key-value

### 3.6 SLA Config (`common-masters.wfSlaConfig`)
- Render color fields as actual colored swatches
- Show `slotPercentage` with visual indicator

---

## 4. Data Flow

```
User visits /manage/role-actions
  → MdmsResourcePage renders
    → useSchemaDefinition('ACCESSCONTROL-ROLEACTIONS.roleactions')
      → fetches schema from DIGIT API (cached)
      → returns { properties, required, x-unique, x-ref-schema }
    → generateColumns(definition, refSchemas)
      → columns: [rolecode (EntityLink→roles), actionid (EntityLink→action-mappings), tenantId]
    → DigitDatagrid renders with typed columns
    → EntityLink for actionid fetches action name from action-mappings

User clicks a row → MdmsResourceShow renders
  → useSchemaDefinition (same, cached)
  → useReverseRefs (fetches all schemas, finds who refs this schema)
  → Renders:
    Key: rolecode (EntityLink), actionid (EntityLink)
    Details: tenantId, actioncode
    Schema Definition: (collapsible JSON)
```

---

## 5. Files to Create/Modify

### New Files (6):
1. `src/hooks/useSchemaDefinition.ts` — schema fetching hook
2. `src/hooks/useReverseRefs.ts` — reverse reference discovery hook
3. `src/admin/schemaUtils.ts` — column/field generation from JSON Schema
4. `src/resources/workflow-mdms/WorkflowBusinessServiceMdmsShow.tsx` — dedicated
5. `src/resources/workflow-mdms/WorkflowAutoEscalationShow.tsx` — dedicated
6. `src/resources/advanced/InboxConfigShow.tsx` — dedicated

### Modified Files (5):
1. `src/admin/MdmsResourcePage.tsx` — use schema for columns
2. `src/admin/MdmsResourceShow.tsx` — use schema for fields, refs, schema section
3. `src/providers/bridge.ts` — expose schema search via digitClient
4. `packages/data-provider/src/providers/resourceRegistry.ts` — add `getResourceBySchema()`
5. `src/App.tsx` — register dedicated Show overrides for 6 resources

### No Changes (everything else):
- Existing dedicated Show components (14) unchanged
- DigitShow, DigitList, DigitDatagrid, EntityLink unchanged
- Field components unchanged

---

## 6. Edge Cases

- **Schema not found**: Fall back to current auto-detect behavior (from first record)
- **x-ref-schema points to unknown schema**: Render field value as plain text (no EntityLink)
- **Field in data but not in schema**: Show in "Additional" section with auto-detected type
- **Very large schemas** (action-mappings has 253 records): Pagination already handles this
- **Circular references**: x-ref-schema is directional, no cycles possible
- **Nested arrays without `items.properties`**: Render as JsonViewer instead of table
