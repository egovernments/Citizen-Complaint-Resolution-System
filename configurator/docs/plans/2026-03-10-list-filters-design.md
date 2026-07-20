# Design: React-Admin Style List Filters for @digit-ui/datagrid

**Date:** 2026-03-10
**Status:** Approved

## Goal

Replicate react-admin's filter pattern (FilterForm + FilterButton + input components) using Radix/Tailwind in the `@digit-ui/datagrid` package. MDMS resources get auto-generated filters from schema. Dedicated resources define filters manually.

## How react-admin filters work

1. Developer defines filters as an array of React elements with a `source` prop
2. `alwaysOn` filters are always visible in a horizontal bar above the datagrid
3. Non-`alwaysOn` filters are hidden behind an "Add filter" dropdown button
4. Active filters show an X button to remove them
5. `FilterLiveForm` (ra-core) auto-submits on input change with 500ms debounce — no submit button
6. `showFilter(name)` / `hideFilter(name)` from `useListContext()` control visibility
7. `displayedFilters` tracks which filters are currently visible in the UI

## Architecture

### Developer API (same pattern as react-admin)

```tsx
// Manual filters for dedicated resources
const filters = [
  <SearchFilterInput source="q" alwaysOn />,
  <SelectFilterInput source="status" label="Status" choices={statusChoices} />,
  <ReferenceFilterInput source="department" label="Department" reference="departments" />,
];

<DigitList title="Complaints" filters={filters}>
  <DigitDatagrid columns={columns} />
</DigitList>
```

```tsx
// Auto-generated filters for MDMS resources (in MdmsResourcePage)
const filterElements = generateFilterElements(schema, refMap);
<DigitList title={label} filters={filterElements}>
  <DigitDatagrid columns={schemaColumns} />
</DigitList>
```

### Component mapping

| react-admin (Material UI) | Our replica (Radix/Tailwind) | Location |
|---|---|---|
| `<List filters={[...]}>` | `<DigitList filters={[...]}>` | `packages/digit-datagrid/src/DigitList.tsx` |
| `<FilterForm>` | `<FilterBar>` | `packages/digit-datagrid/src/filters/FilterBar.tsx` |
| `<FilterButton>` | `<AddFilterButton>` | `packages/digit-datagrid/src/filters/AddFilterButton.tsx` |
| `<FilterFormInput>` | `<FilterFormInput>` | `packages/digit-datagrid/src/filters/FilterFormInput.tsx` |
| `<SearchInput>` | `<SearchFilterInput>` | `packages/digit-datagrid/src/filters/SearchFilterInput.tsx` |
| `<TextInput>` | `<TextFilterInput>` | `packages/digit-datagrid/src/filters/TextFilterInput.tsx` |
| `<SelectInput>` | `<SelectFilterInput>` | `packages/digit-datagrid/src/filters/SelectFilterInput.tsx` |
| `<BooleanInput>` | `<BooleanFilterInput>` | `packages/digit-datagrid/src/filters/BooleanFilterInput.tsx` |
| `<DateInput>` | `<DateFilterInput>` | `packages/digit-datagrid/src/filters/DateFilterInput.tsx` |
| `<ReferenceInput>` | `<ReferenceFilterInput>` | `packages/digit-datagrid/src/filters/ReferenceFilterInput.tsx` |
| `<NullableBooleanInput>` | `<NullableBooleanFilterInput>` | `packages/digit-datagrid/src/filters/NullableBooleanFilterInput.tsx` |
| N/A | `generateFilterElements()` | `packages/digit-datagrid/src/columns/schemaUtils.ts` |

### Component details

#### FilterBar

Renders inside DigitList between search and datagrid. Wraps filter inputs in ra-core's `FilterLiveForm`.

```tsx
interface FilterBarProps {
  filters: React.ReactElement[];  // filter input elements
}
```

Behavior:
- Reads `displayedFilters` and `filterValues` from `useListContext()`
- Renders `alwaysOn` filters directly (no wrapper)
- Renders displayed non-`alwaysOn` filters wrapped in `FilterFormInput` (with X button)
- Renders `AddFilterButton` if there are hidden filters available
- Wraps everything in `FilterLiveForm` for auto-submit with debounce

#### AddFilterButton

Radix Popover listing available (currently hidden) filters.

```tsx
interface AddFilterButtonProps {
  filters: React.ReactElement[];      // all filter elements
  displayedFilters: Record<string, boolean>;  // currently shown
  showFilter: (name: string, defaultValue?: any) => void;
}
```

Behavior:
- Shows only filters that are NOT `alwaysOn` and NOT currently in `displayedFilters`
- On click, calls `showFilter(source)` which adds the filter to the bar
- Uses the filter element's `label` prop for display

#### FilterFormInput

Wraps a single filter input with a remove (X) button.

```tsx
interface FilterFormInputProps {
  filterElement: React.ReactElement;
  hideFilter: (name: string) => void;
}
```

Behavior:
- Renders the filter input + small X icon button
- X button calls `hideFilter(source)` which removes the filter and clears its value
- Not rendered for `alwaysOn` filters

#### Filter Input Components

All filter inputs use ra-core's `useInput()` hook for react-hook-form integration. Each accepts:

```tsx
interface BaseFilterInputProps {
  source: string;        // field name, maps to filter key
  label?: string;        // display label (used by AddFilterButton and as placeholder)
  alwaysOn?: boolean;    // if true, always visible, no X button
  defaultValue?: any;    // initial value when filter is shown
}
```

| Component | Extra Props | Renders |
|---|---|---|
| `SearchFilterInput` | — | Radix Input with magnifier icon, clear button. Always `alwaysOn`. |
| `TextFilterInput` | — | Radix Input with label |
| `SelectFilterInput` | `choices: {id, name}[]` | Radix Select dropdown |
| `BooleanFilterInput` | — | Radix Switch |
| `DateFilterInput` | — | Native `<input type="date">` styled with Tailwind |
| `ReferenceFilterInput` | `reference: string`, `displayField?: string` | Radix Select, fetches choices via `useGetList` |
| `NullableBooleanFilterInput` | — | Radix Select with Yes/No/Any options |

### Schema auto-generation (generateFilterElements)

Added to `schemaUtils.ts`. Produces React elements from schema definition.

Rules:
- `x-unique` fields: skip (keys aren't useful filters)
- `enum` fields: `<SelectFilterInput>` with enum values as choices, `alwaysOn` if required
- `type: 'boolean'`: `<NullableBooleanFilterInput>`, `alwaysOn` if required
- `x-ref-schema` match: `<ReferenceFilterInput>`, `alwaysOn` if required
- `format: 'date'` / `'date-time'`: `<DateFilterInput>`
- Required string fields: `<TextFilterInput>` (only first 2 to avoid clutter)
- Always prepend `<SearchFilterInput source="q" alwaysOn />`

### DigitList changes

New prop:
```tsx
interface DigitListProps {
  // ... existing props
  filters?: React.ReactElement[];  // filter input elements
}
```

When `filters` is provided, DigitList renders `<FilterBar>` between the existing search input and the datagrid content. The existing search input is kept as-is (it's separate from the filter system), OR replaced by a `SearchFilterInput` if one is present in `filters`.

### Data flow

```
Schema → generateFilterElements() → React.ReactElement[]
                                          ↓
                                    DigitList.filters prop
                                          ↓
                                    FilterBar component
                                          ↓
                                    FilterLiveForm (ra-core)
                                          ↓
                              useInput() per filter input
                                          ↓
                              watch() → debounce → setFilters()
                                          ↓
                              listContext.filterValues updated
                                          ↓
                              dataProvider.getList({ filter: {...} })
                                          ↓
                              clientFilter() applies filter matching
                                          ↓
                              DigitDatagrid re-renders with filtered data
```

### What stays the same

- `clientFilter()` in the data provider already handles arbitrary filter keys with substring matching
- The `q` search filter already works (full-text JSON search)
- `useListController` already supports `displayedFilters`, `showFilter`, `hideFilter`
- `FilterLiveForm` from ra-core handles all form state and debouncing

## Out of scope

- Filter URL sync (we use `disableSyncWithLocation: true`)
- Saved queries / filter presets
- Complex filter operators (gt, lt, between)
- Array/multi-select filters (SelectArrayInput)
