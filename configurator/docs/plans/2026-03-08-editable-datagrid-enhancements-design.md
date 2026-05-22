# Publishable DIGIT EditableDatagrid Enhancements Design

**Goal:** Elevate DigitDatagrid into a publishable `@digit-ui/datagrid` package with undoable/optimistic mutations, polymorphic cell editing (boolean/date/select), inline delete, auto row actions, column configurability, and mutation callbacks/transforms.

**Architecture:** Monorepo workspace package at `packages/digit-datagrid/`. Hook-based mutation controller (`useMutationMode`) wraps ra-core's `useUpdate`/`useDelete`. Polymorphic `EditableCell` handles all input types. Schema-driven auto-detection extended for boolean/date/enum fields.

**Tech Stack:** React 18, ra-core (headless), shadcn/ui primitives (vendored), vitest + @testing-library/react.

---

## 1. Package Structure

```
packages/digit-datagrid/
  package.json            @digit-ui/datagrid, peer deps: ra-core, react, react-dom
  tsconfig.json
  vitest.config.ts
  src/
    index.ts              Public barrel export
    DigitDatagrid.tsx      Main datagrid component
    DigitList.tsx          List wrapper with search/refresh/create
    columns/
      types.ts            DigitColumn, EditableColumnConfig, MutationMode
      schemaUtils.ts       Auto-column generation from JSON Schema
    editing/
      EditableCell.tsx     Polymorphic cell (text/number/boolean/date/select/reference)
      ReferenceSelect.tsx  Foreign-key dropdown via useGetList
      useMutationMode.ts   Undoable/optimistic/pessimistic mutation hook
      useColumnConfig.ts   Column show/hide with localStorage persistence
    actions/
      RowActions.tsx       Auto-generated edit/delete hover buttons
      InlineDelete.tsx     Delete with confirm, supports mutation modes
      AddRowDialog.tsx     Modal-based row creation form
    primitives/            shadcn primitives (vendored, zero external UI dep)
      select.tsx, toast.tsx, toaster.tsx, switch.tsx,
      popover.tsx, alert-dialog.tsx, badge.tsx, button.tsx,
      input.tsx, label.tsx, table.tsx, card.tsx
    __tests__/
      EditableCell.test.tsx
      useMutationMode.test.ts
      useColumnConfig.test.ts
      schemaUtils.test.ts
      DigitDatagrid.test.tsx
      RowActions.test.tsx
```

The app at `ui-mockup/` imports via workspace: `"@digit-ui/datagrid": "workspace:*"`.

## 2. Mutation System — `useMutationMode`

Three modes matching react-admin semantics:

```typescript
type MutationMode = 'pessimistic' | 'optimistic' | 'undoable';

interface UseMutationModeOptions {
  mode?: MutationMode;            // default: 'undoable'
  undoTimeout?: number;            // default: 5000ms
  onSuccess?: (data: unknown) => void;
  onError?: (error: Error) => void;
  transform?: (data: Record<string, unknown>) => Record<string, unknown>;
}
```

**Pessimistic** (current behavior): `await update()`, show spinner, update UI on success.

**Optimistic**: Update local state immediately. Fire API in background. On error, revert local state and show destructive toast.

**Undoable** (default): Update local state immediately. Show toast with "Undo" action button + countdown bar. After timeout (5s), fire API. If user clicks Undo, revert local state — no API call.

Hook returns:
```typescript
{
  mutate: (resource: string, params: UpdateParams) => void;
  deleteMutate: (resource: string, params: DeleteParams) => void;
  undoPending: Map<string, PendingMutation>;
  undo: (mutationId: string) => void;
}
```

`DigitDatagrid` accepts `mutationMode` prop (default: `'undoable'`). Individual columns can override via `editable.mutationMode`.

## 3. Polymorphic EditableCell

```typescript
type EditableCellType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'reference';

interface EditableColumnConfig {
  type?: EditableCellType;
  validation?: ValidationRule;
  reference?: string;              // for type: 'reference'
  displayField?: string;           // for type: 'reference' (default: 'name')
  options?: { value: string; label: string }[];  // for type: 'select'
  mutationMode?: MutationMode;     // per-column override
  transform?: (value: unknown) => unknown;        // per-column transform
}
```

Rendering by type:
- **text / number**: Input field (existing behavior)
- **boolean**: shadcn Switch, saves on toggle immediately (no Enter needed)
- **date**: Native `<input type="date">`, Enter to save
- **select**: shadcn Select with static options (from column config or schema `enum`)
- **reference**: ReferenceSelect (fetches from API via `useGetList`)

Schema auto-detection in `generateColumns`:
- `"type": "boolean"` → `editable: { type: 'boolean' }`
- `"format": "date"` or `"format": "date-time"` → `editable: { type: 'date' }`
- `"enum": [...]` → `editable: { type: 'select', options: [...] }`

## 4. Inline Delete + Row Actions

```typescript
interface DigitDatagridProps<T extends RaRecord = RaRecord> {
  // ... existing props
  rowActions?: 'auto' | 'none' | ((record: T) => ReactNode);
  noDelete?: boolean;
  disableAutofocus?: boolean;
  mutationMode?: MutationMode;
  mutationOptions?: {
    onSuccess?: (data: unknown) => void;
    onError?: (error: Error) => void;
    transform?: (data: Record<string, unknown>) => Record<string, unknown>;
  };
}
```

When `rowActions='auto'` (default when any column is editable):
- Row hover shows semi-transparent action overlay pinned to right edge
- Delete button (trash icon) — confirmation depends on mutation mode:
  - **pessimistic/optimistic**: AlertDialog confirmation first
  - **undoable**: Delete immediately, show "Undo" toast
- `noDelete={true}` hides delete button
- `rowActions='none'` hides all auto-actions
- Custom function `rowActions={(record) => <MyButtons />}` for full control

## 5. Column Configurability — `useColumnConfig`

```typescript
interface UseColumnConfigOptions {
  resource: string;
  columns: DigitColumn[];
  preferenceKey?: string;
}

// Returns
{
  visibleColumns: DigitColumn[];
  hiddenColumns: DigitColumn[];
  toggleColumn: (source: string) => void;
  resetColumns: () => void;
}
```

Persisted to `localStorage` key: `digit-datagrid:${resource}:columns` (optionally `digit-datagrid:${preferenceKey}:columns`).

A "Columns" button (grid icon) in the DigitList header opens a Popover with checkboxes. Columns with `x-unique` are always visible (checkbox disabled).

`configurable` prop on DigitDatagrid (default: `false`) enables this feature.

## 6. Testing Strategy

| Module | Test Cases |
|--------|------------|
| `useMutationMode` | Pessimistic: waits for API before UI update. Optimistic: updates UI then API, reverts on error. Undoable: delays API call, undo cancels, timeout fires API. |
| `EditableCell` | Renders correct input per type. Boolean toggle saves immediately. Date input. Select dropdown. Validation rules fire. Transform applied before save. |
| `useColumnConfig` | Persists to localStorage. Toggle visibility. Reset to defaults. x-unique always visible. |
| `RowActions` | Shows on hover. Delete with confirm. noDelete hides button. Undoable delete shows toast. |
| `schemaUtils` | Boolean/date/enum auto-detection. Existing 16 tests preserved + extended. |
| `DigitDatagrid` | Integration: mutation modes propagate to cells. Column config filters visible columns. Row actions render on hover. disableAutofocus works. |

All tests: vitest + @testing-library/react. Mock ra-core hooks (`useUpdate`, `useDelete`, `useGetList`, `useListContext`).

## 7. Migration Path

The app at `ui-mockup/src/admin/` will be refactored to re-export from `@digit-ui/datagrid`. Existing resource files (DepartmentList, ComplaintTypeList, etc.) continue working with no changes — the DigitColumn interface is backward-compatible (all new props are optional).

Default `mutationMode` changes from implicit pessimistic to `'undoable'`, which is the only behavioral change. Consumers can set `mutationMode="pessimistic"` to preserve old behavior.
