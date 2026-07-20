# Inline List Editing Design

## Goal

Enable inline cell editing in list views across all resource types — dedicated (departments, employees, etc.) and schema-driven MDMS. Double-click a cell to edit in place; single click still navigates to the show page.

## Architecture

Extend `DigitColumn` with an `editable` property. When set, `DigitDatagrid` renders that cell with the existing `EditableCell` component on double-click. Saves use react-admin's `useUpdate` hook, which calls the data provider and auto-refreshes the list cache.

## Edit Trigger

- **Single click** on row → navigates to show page (unchanged)
- **Double-click** on an editable cell → enters edit mode (input appears)
- **Hover** on an editable cell → subtle pencil icon hint
- **Enter / blur** → auto-saves the cell
- **Escape** → cancels edit, reverts value

## Column Configuration

```ts
interface DigitColumn {
  source: string;
  label: string;
  sortable?: boolean;
  render?: (record) => ReactNode;
  // NEW:
  editable?: boolean | EditableColumnConfig;
}

interface EditableColumnConfig {
  type?: 'text' | 'number' | 'select';
  choices?: { value: string; label: string }[];  // for type: 'select'
  validation?: ValidationRule;  // reuse existing ValidationRule
}
```

- `editable: true` — text input, no validation
- `editable: { type: 'number' }` — number input
- `editable: { type: 'select', choices: [...] }` — dropdown
- `editable: { validation: { required: true } }` — with validation

## What's Editable

**Dedicated resources** — each List page opts in per column:
- Departments: `name`, `description` (not `code`)
- Designations: `name`, `description` (not `code`)
- Complaint Types: `name`, `slaHours` (not `serviceCode`)
- Localization: `message` (not `code`, `module`, `locale`)
- Employees: not inline-editable (complex nested structure)
- Boundaries, Tenants, Complaints: not inline-editable (complex or read-only)

**Schema-driven MDMS** — auto-set `editable: true` for fields that are:
- Not in `x-unique` (primary keys are read-only)
- Not complex types (array/object)
- Not ref fields (EntityLink columns stay read-only)

## Save Flow

1. User double-clicks cell → `EditableCell` renders with current value
2. User edits and presses Enter (or blurs)
3. `EditableCell.onSave(newValue)` fires
4. `DigitDatagrid` calls `useUpdate(resource, { id: record.id, data: { [source]: newValue }, previousData: record })`
5. Data provider `update()` sends API request
6. On success: react-admin cache updates, cell shows new value
7. On error: cell shows error message inline, value reverts

## Components Modified

- `DigitColumn` type — add `editable` field
- `DigitDatagrid` — double-click handler, render `EditableCell` for editable columns
- `EditableCell` — minor: support being triggered by parent (controlled edit state)
- `schemaUtils.ts` / `generateColumns` — auto-set `editable` for eligible MDMS fields
- 4 dedicated List pages — add `editable: true` to appropriate columns

## Not In Scope

- Inline row creation (use existing Create page)
- Bulk edit / multi-select
- Undo across cells
- Custom edit renderers beyond text/number/select
