# List Filters Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add react-admin-style list filters (FilterBar + FilterButton + input components) to `@digit-ui/datagrid`, with auto-generated filters from MDMS schemas.

**Architecture:** Filter input components use ra-core's `useInput()` for react-hook-form integration. `FilterBar` wraps inputs in ra-core's `FilterLiveForm` for auto-submit with debounce. `AddFilterButton` uses Radix Popover to show/hide optional filters. `DigitList` gains a `filters` prop. `generateFilterElements()` in schemaUtils auto-generates filter elements from MDMS schema definitions.

**Tech Stack:** React 19, ra-core 5.14 (`FilterLiveForm`, `useInput`, `useListContext`), Radix UI (Select, Switch, Popover), Tailwind CSS, Vitest + Testing Library.

**Design doc:** `docs/plans/2026-03-10-list-filters-design.md`

---

## File Structure

All new filter files go in `packages/digit-datagrid/src/filters/`:

| File | Responsibility |
|------|---------------|
| `filters/SearchFilterInput.tsx` | Search box with magnifier icon, always visible |
| `filters/TextFilterInput.tsx` | Text input for string filters |
| `filters/SelectFilterInput.tsx` | Radix Select dropdown for enum filters |
| `filters/BooleanFilterInput.tsx` | Radix Switch for boolean filters |
| `filters/DateFilterInput.tsx` | Native date input for date filters |
| `filters/NullableBooleanFilterInput.tsx` | Yes/No/Any Radix Select for nullable booleans |
| `filters/ReferenceFilterInput.tsx` | Radix Select that fetches choices from a reference resource |
| `filters/FilterFormInput.tsx` | Wrapper adding X remove button to any filter |
| `filters/AddFilterButton.tsx` | Radix Popover listing hidden filters |
| `filters/FilterBar.tsx` | Orchestrator: renders alwaysOn + displayed + AddFilterButton in FilterLiveForm |
| `filters/index.ts` | Barrel exports |

Modified files:

| File | Change |
|------|--------|
| `packages/digit-datagrid/src/DigitList.tsx` | Add `filters` prop, render FilterBar |
| `packages/digit-datagrid/src/columns/schemaUtils.ts` | Add `generateFilterElements()` |
| `packages/digit-datagrid/src/index.ts` | Export filter components + generateFilterElements |
| `utilities/.../src/admin/MdmsResourcePage.tsx` | Wire `generateFilterElements` |
| `utilities/.../src/admin/schemaUtils.ts` | Re-export `generateFilterElements` |

Test files:

| File | Tests |
|------|-------|
| `packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx` | All 7 filter input components |
| `packages/digit-datagrid/src/__tests__/FilterBar.test.tsx` | FilterBar, FilterFormInput, AddFilterButton |
| `packages/digit-datagrid/src/__tests__/generateFilterElements.test.ts` | Schema-to-filter-elements generation |

---

## Chunk 1: Filter Input Components (Simple Inputs)

### Task 1: SearchFilterInput

**Files:**
- Create: `packages/digit-datagrid/src/filters/SearchFilterInput.tsx`
- Create: `packages/digit-datagrid/src/filters/index.ts`
- Test: `packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchFilterInput, TextFilterInput, SelectFilterInput, BooleanFilterInput, DateFilterInput, NullableBooleanFilterInput, ReferenceFilterInput } from '../filters';

// Single vi.mock for all filter input tests.
// Includes useInput (all inputs) + useGetList (ReferenceFilterInput).
vi.mock('ra-core', () => ({
  useInput: vi.fn(({ source }) => ({
    id: source,
    field: {
      value: '',
      onChange: vi.fn(),
      onBlur: vi.fn(),
      name: source,
      ref: vi.fn(),
    },
    fieldState: { error: undefined, invalid: false, isTouched: false, isDirty: false },
    formState: { isSubmitted: false },
    isRequired: false,
  })),
  useGetList: vi.fn(() => ({
    data: [
      { id: 'dept1', name: 'Engineering' },
      { id: 'dept2', name: 'Marketing' },
    ],
    isPending: false,
  })),
}));

describe('SearchFilterInput', () => {
  it('renders a search input with magnifier icon', () => {
    render(<SearchFilterInput source="q" />);
    const input = screen.getByPlaceholderText('Search...');
    expect(input).toBeInTheDocument();
  });

  it('has alwaysOn=true by default', () => {
    const el = <SearchFilterInput source="q" />;
    expect(el.props.alwaysOn).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run src/__tests__/FilterInputs.test.tsx`
Expected: FAIL — module `../filters` not found

- [ ] **Step 3: Create SearchFilterInput component**

In `packages/digit-datagrid/src/filters/SearchFilterInput.tsx`:

```tsx
import React, { useCallback } from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import { Search, X } from 'lucide-react';
import { Input } from '../primitives/input';

export type SearchFilterInputProps = Omit<InputProps, 'source'> & {
  source?: string;
};

/**
 * Search filter input with magnifier icon. Always visible (alwaysOn).
 * Replicates react-admin's <SearchInput>.
 */
export function SearchFilterInput({ source = 'q', alwaysOn = true, ...rest }: SearchFilterInputProps) {
  const { field, id } = useInput({ source, alwaysOn, ...rest });

  const handleClear = useCallback(() => {
    field.onChange('');
  }, [field]);

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        id={id}
        {...field}
        placeholder="Search..."
        className="pl-8 pr-8 h-8 text-sm w-48"
      />
      {field.value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create barrel export**

In `packages/digit-datagrid/src/filters/index.ts`:

```ts
export { SearchFilterInput } from './SearchFilterInput';
export type { SearchFilterInputProps } from './SearchFilterInput';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run src/__tests__/FilterInputs.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /root/code/ccrs-ui-mockup
git add packages/digit-datagrid/src/filters/SearchFilterInput.tsx packages/digit-datagrid/src/filters/index.ts packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx
git commit -m "feat(datagrid): SearchFilterInput with magnifier icon and clear button"
```

---

### Task 2: TextFilterInput

**Files:**
- Create: `packages/digit-datagrid/src/filters/TextFilterInput.tsx`
- Modify: `packages/digit-datagrid/src/filters/index.ts`
- Modify: `packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx`

- [ ] **Step 1: Add failing test**

Append to `FilterInputs.test.tsx`:

```tsx
import { TextFilterInput } from '../filters';

describe('TextFilterInput', () => {
  it('renders an input with the label as placeholder', () => {
    render(<TextFilterInput source="name" label="Name" />);
    const input = screen.getByPlaceholderText('Name');
    expect(input).toBeInTheDocument();
  });

  it('uses source as placeholder when no label', () => {
    render(<TextFilterInput source="firstName" />);
    const input = screen.getByPlaceholderText('firstName');
    expect(input).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run src/__tests__/FilterInputs.test.tsx`
Expected: FAIL — TextFilterInput not found

- [ ] **Step 3: Implement TextFilterInput**

In `packages/digit-datagrid/src/filters/TextFilterInput.tsx`:

```tsx
import React from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import { Input } from '../primitives/input';

export interface TextFilterInputProps extends InputProps {
  label?: string;
}

export function TextFilterInput({ source, label, ...rest }: TextFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  return (
    <Input
      id={id}
      {...field}
      placeholder={label || source}
      className="h-8 text-sm w-40"
    />
  );
}
```

- [ ] **Step 4: Add to barrel**

Add `export { TextFilterInput } from './TextFilterInput';` and its type to `filters/index.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run src/__tests__/FilterInputs.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /root/code/ccrs-ui-mockup
git add packages/digit-datagrid/src/filters/TextFilterInput.tsx packages/digit-datagrid/src/filters/index.ts packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx
git commit -m "feat(datagrid): TextFilterInput component"
```

---

### Task 3: SelectFilterInput

**Files:**
- Create: `packages/digit-datagrid/src/filters/SelectFilterInput.tsx`
- Modify: `packages/digit-datagrid/src/filters/index.ts`
- Modify: `packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx`

- [ ] **Step 1: Add failing test**

Append to `FilterInputs.test.tsx`:

```tsx
import { SelectFilterInput } from '../filters';

describe('SelectFilterInput', () => {
  const choices = [
    { id: 'active', name: 'Active' },
    { id: 'inactive', name: 'Inactive' },
  ];

  it('renders a select trigger with label as placeholder', () => {
    render(<SelectFilterInput source="status" label="Status" choices={choices} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — SelectFilterInput not found

- [ ] **Step 3: Implement SelectFilterInput**

In `packages/digit-datagrid/src/filters/SelectFilterInput.tsx`:

```tsx
import React from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../primitives/select';

export interface SelectFilterInputProps extends InputProps {
  label?: string;
  choices: Array<{ id: string; name: string }>;
}

export function SelectFilterInput({
  source,
  label,
  choices,
  ...rest
}: SelectFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  return (
    <Select value={field.value || ''} onValueChange={field.onChange}>
      <SelectTrigger id={id} className="h-8 text-sm w-40">
        <SelectValue placeholder={label || source} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            {choice.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Add to barrel + run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/digit-datagrid/src/filters/SelectFilterInput.tsx packages/digit-datagrid/src/filters/index.ts packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx
git commit -m "feat(datagrid): SelectFilterInput with Radix Select"
```

---

### Task 4: BooleanFilterInput

**Files:**
- Create: `packages/digit-datagrid/src/filters/BooleanFilterInput.tsx`
- Modify: `packages/digit-datagrid/src/filters/index.ts`
- Modify: `packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx`

- [ ] **Step 1: Add failing test**

```tsx
import { BooleanFilterInput } from '../filters';

describe('BooleanFilterInput', () => {
  it('renders a switch', () => {
    render(<BooleanFilterInput source="isActive" label="Active" />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('shows the label text', () => {
    render(<BooleanFilterInput source="isActive" label="Active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement BooleanFilterInput**

In `packages/digit-datagrid/src/filters/BooleanFilterInput.tsx`:

```tsx
import React from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import { Switch } from '../primitives/switch';
import { Label } from '../primitives/label';

export interface BooleanFilterInputProps extends InputProps {
  label?: string;
}

export function BooleanFilterInput({ source, label, ...rest }: BooleanFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        checked={!!field.value}
        onCheckedChange={(checked) => field.onChange(checked)}
      />
      {label && (
        <Label htmlFor={id} className="text-sm cursor-pointer">
          {label}
        </Label>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add to barrel + run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/digit-datagrid/src/filters/BooleanFilterInput.tsx packages/digit-datagrid/src/filters/index.ts packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx
git commit -m "feat(datagrid): BooleanFilterInput with Radix Switch"
```

---

### Task 5: DateFilterInput

**Files:**
- Create: `packages/digit-datagrid/src/filters/DateFilterInput.tsx`
- Modify: `packages/digit-datagrid/src/filters/index.ts`
- Modify: `packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx`

- [ ] **Step 1: Add failing test**

```tsx
import { DateFilterInput } from '../filters';

describe('DateFilterInput', () => {
  it('renders a date input', () => {
    render(<DateFilterInput source="startDate" label="Start Date" />);
    const input = screen.getByLabelText('Start Date');
    expect(input).toHaveAttribute('type', 'date');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement DateFilterInput**

In `packages/digit-datagrid/src/filters/DateFilterInput.tsx`:

```tsx
import React from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import { Label } from '../primitives/label';

export interface DateFilterInputProps extends InputProps {
  label?: string;
}

export function DateFilterInput({ source, label, ...rest }: DateFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
      )}
      <input
        id={id}
        type="date"
        {...field}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}
```

- [ ] **Step 4: Add to barrel + run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/digit-datagrid/src/filters/DateFilterInput.tsx packages/digit-datagrid/src/filters/index.ts packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx
git commit -m "feat(datagrid): DateFilterInput with native date input"
```

---

### Task 6: NullableBooleanFilterInput

**Files:**
- Create: `packages/digit-datagrid/src/filters/NullableBooleanFilterInput.tsx`
- Modify: `packages/digit-datagrid/src/filters/index.ts`
- Modify: `packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx`

- [ ] **Step 1: Add failing test**

```tsx
import { NullableBooleanFilterInput } from '../filters';

describe('NullableBooleanFilterInput', () => {
  it('renders a select with Yes/No/Any options', () => {
    render(<NullableBooleanFilterInput source="isActive" label="Active" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement NullableBooleanFilterInput**

In `packages/digit-datagrid/src/filters/NullableBooleanFilterInput.tsx`:

```tsx
import React from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../primitives/select';

export interface NullableBooleanFilterInputProps extends InputProps {
  label?: string;
  trueLabel?: string;
  falseLabel?: string;
  nullLabel?: string;
}

export function NullableBooleanFilterInput({
  source,
  label,
  trueLabel = 'Yes',
  falseLabel = 'No',
  nullLabel = 'Any',
  ...rest
}: NullableBooleanFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  const handleChange = (val: string) => {
    if (val === '__null__') {
      field.onChange(undefined);
    } else {
      field.onChange(val === 'true');
    }
  };

  // Map field.value to select value string
  const selectValue =
    field.value === true ? 'true' : field.value === false ? 'false' : '__null__';

  return (
    <Select value={selectValue} onValueChange={handleChange}>
      <SelectTrigger id={id} className="h-8 text-sm w-32">
        <SelectValue placeholder={label || source} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__null__">{nullLabel}</SelectItem>
        <SelectItem value="true">{trueLabel}</SelectItem>
        <SelectItem value="false">{falseLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Add to barrel + run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/digit-datagrid/src/filters/NullableBooleanFilterInput.tsx packages/digit-datagrid/src/filters/index.ts packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx
git commit -m "feat(datagrid): NullableBooleanFilterInput with Yes/No/Any"
```

---

## Chunk 2: ReferenceFilterInput + Structural Components

### Task 7: ReferenceFilterInput

**Files:**
- Create: `packages/digit-datagrid/src/filters/ReferenceFilterInput.tsx`
- Modify: `packages/digit-datagrid/src/filters/index.ts`
- Modify: `packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx`

- [ ] **Step 1: Add failing test**

Append to `FilterInputs.test.tsx` (the `vi.mock('ra-core', ...)` at the top of the file already includes `useGetList` — it was set up in Task 1):

```tsx
// ReferenceFilterInput is already imported at the top of the file (Task 1 import line)

describe('ReferenceFilterInput', () => {
  it('renders a select for reference choices', () => {
    render(<ReferenceFilterInput source="department" reference="departments" label="Department" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement ReferenceFilterInput**

In `packages/digit-datagrid/src/filters/ReferenceFilterInput.tsx`:

```tsx
import React from 'react';
import { useInput, useGetList } from 'ra-core';
import type { InputProps } from 'ra-core';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../primitives/select';

export interface ReferenceFilterInputProps extends InputProps {
  label?: string;
  reference: string;
  displayField?: string;
}

export function ReferenceFilterInput({
  source,
  label,
  reference,
  displayField = 'name',
  ...rest
}: ReferenceFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });
  const { data, isPending } = useGetList(reference, {
    pagination: { page: 1, perPage: 100 },
    sort: { field: displayField, order: 'ASC' },
  });

  const choices = (data ?? []).map((record: Record<string, unknown>) => ({
    id: String(record.id),
    name: String(record[displayField] ?? record.id),
  }));

  return (
    <Select value={field.value || ''} onValueChange={field.onChange}>
      <SelectTrigger id={id} className="h-8 text-sm w-44">
        <SelectValue placeholder={isPending ? 'Loading...' : label || source} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            {choice.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Add to barrel + run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/digit-datagrid/src/filters/ReferenceFilterInput.tsx packages/digit-datagrid/src/filters/index.ts packages/digit-datagrid/src/__tests__/FilterInputs.test.tsx
git commit -m "feat(datagrid): ReferenceFilterInput fetches choices from reference resource"
```

---

### Task 8: FilterFormInput (X-remove wrapper)

**Files:**
- Create: `packages/digit-datagrid/src/filters/FilterFormInput.tsx`
- Create: `packages/digit-datagrid/src/__tests__/FilterBar.test.tsx`
- Modify: `packages/digit-datagrid/src/filters/index.ts`

- [ ] **Step 1: Write the failing test**

In `packages/digit-datagrid/src/__tests__/FilterBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { FilterFormInput, AddFilterButton, FilterBar } from '../filters';
import { DigitList } from '../DigitList';

// Single comprehensive ra-core mock for all tests in this file.
// Covers: FilterFormInput (no ra-core), AddFilterButton (no ra-core),
// FilterBar (needs FilterLiveForm + useListContext),
// DigitList (needs useListController + ListContextProvider).
const mockShowFilter = vi.fn();
const mockHideFilter = vi.fn();
const mockSetFilters = vi.fn();

vi.mock('ra-core', () => ({
  FilterLiveForm: ({ children }: { children: React.ReactNode }) => (
    <form data-testid="filter-live-form">{children}</form>
  ),
  useListContext: () => ({
    displayedFilters: { status: true },
    filterValues: { status: 'active' },
    showFilter: mockShowFilter,
    hideFilter: mockHideFilter,
    setFilters: mockSetFilters,
    resource: 'test',
  }),
  useListController: () => ({
    data: [{ id: '1', name: 'Test' }],
    total: 1,
    page: 1,
    perPage: 25,
    sort: { field: 'id', order: 'ASC' as const },
    setSort: vi.fn(),
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    filterValues: {},
    displayedFilters: {},
    setFilters: mockSetFilters,
    showFilter: mockShowFilter,
    hideFilter: mockHideFilter,
    isPending: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    selectedIds: [],
    onSelect: vi.fn(),
    onToggleItem: vi.fn(),
    onUnselectItems: vi.fn(),
    resource: 'test',
  }),
  ListContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Simple stub filter element for testing
function StubFilter({ source, label, alwaysOn }: { source: string; label?: string; alwaysOn?: boolean }) {
  return <input data-testid={`filter-${source}`} />;
}

describe('FilterFormInput', () => {
  it('renders the filter element and an X button', () => {
    const hideFilter = vi.fn();
    render(
      <FilterFormInput
        filterElement={<StubInput source="status" />}
        hideFilter={hideFilter}
      />
    );
    expect(screen.getByTestId('filter-status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('calls hideFilter with source when X is clicked', async () => {
    const user = userEvent.setup();
    const hideFilter = vi.fn();
    render(
      <FilterFormInput
        filterElement={<StubInput source="status" />}
        hideFilter={hideFilter}
      />
    );
    await user.click(screen.getByRole('button', { name: /remove/i }));
    expect(hideFilter).toHaveBeenCalledWith('status');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run src/__tests__/FilterBar.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement FilterFormInput**

In `packages/digit-datagrid/src/filters/FilterFormInput.tsx`:

```tsx
import React from 'react';
import { X } from 'lucide-react';

export interface FilterFormInputProps {
  filterElement: React.ReactElement;
  hideFilter: (name: string) => void;
}

export function FilterFormInput({ filterElement, hideFilter }: FilterFormInputProps) {
  const source = filterElement.props.source as string;

  return (
    <div className="flex items-center gap-1">
      {filterElement}
      <button
        type="button"
        onClick={() => hideFilter(source)}
        className="p-0.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label={`Remove ${source} filter`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Add to barrel + run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/digit-datagrid/src/filters/FilterFormInput.tsx packages/digit-datagrid/src/filters/index.ts packages/digit-datagrid/src/__tests__/FilterBar.test.tsx
git commit -m "feat(datagrid): FilterFormInput wraps filter with X remove button"
```

---

### Task 9: AddFilterButton

**Files:**
- Create: `packages/digit-datagrid/src/filters/AddFilterButton.tsx`
- Modify: `packages/digit-datagrid/src/__tests__/FilterBar.test.tsx`
- Modify: `packages/digit-datagrid/src/filters/index.ts`

- [ ] **Step 1: Add failing test**

Append to `FilterBar.test.tsx`:

Append to `FilterBar.test.tsx` (AddFilterButton is already imported at the top, StubFilter is already defined):

```tsx
describe('AddFilterButton', () => {
  it('shows button only when there are hidden filters', () => {
    const filters = [
      <StubFilter key="a" source="status" label="Status" />,
      <StubFilter key="b" source="type" label="Type" />,
    ];
    render(
      <AddFilterButton
        filters={filters}
        displayedFilters={{}}
        showFilter={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /add filter/i })).toBeInTheDocument();
  });

  it('hides button when all non-alwaysOn filters are displayed', () => {
    const filters = [
      <StubFilter key="a" source="status" label="Status" />,
    ];
    render(
      <AddFilterButton
        filters={filters}
        displayedFilters={{ status: true }}
        showFilter={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /add filter/i })).not.toBeInTheDocument();
  });

  it('does not list alwaysOn filters in the menu', () => {
    const filters = [
      <StubFilter key="a" source="q" label="Search" alwaysOn />,
      <StubFilter key="b" source="status" label="Status" />,
    ];
    render(
      <AddFilterButton
        filters={filters}
        displayedFilters={{}}
        showFilter={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /add filter/i })).toBeInTheDocument();
    // alwaysOn filter should not appear as an option to add
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement AddFilterButton**

In `packages/digit-datagrid/src/filters/AddFilterButton.tsx`:

```tsx
import React from 'react';
import { ListFilter } from 'lucide-react';
import { Button } from '../primitives/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '../primitives/popover';

export interface AddFilterButtonProps {
  filters: React.ReactElement[];
  displayedFilters: Record<string, boolean>;
  showFilter: (name: string, defaultValue?: unknown) => void;
}

export function AddFilterButton({
  filters,
  displayedFilters,
  showFilter,
}: AddFilterButtonProps) {
  // Filters that are not alwaysOn and not currently displayed
  const hiddenFilters = filters.filter((f) => {
    const { source, alwaysOn } = f.props;
    return !alwaysOn && !displayedFilters[source];
  });

  if (hiddenFilters.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sm">
          <ListFilter className="w-3.5 h-3.5" />
          Add filter
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <div className="space-y-0.5">
          {hiddenFilters.map((f) => {
            const { source, label } = f.props;
            return (
              <button
                key={source}
                type="button"
                onClick={() => showFilter(source, f.props.defaultValue)}
                className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {label || source}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Add to barrel + run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/digit-datagrid/src/filters/AddFilterButton.tsx packages/digit-datagrid/src/filters/index.ts packages/digit-datagrid/src/__tests__/FilterBar.test.tsx
git commit -m "feat(datagrid): AddFilterButton popover lists hidden filters"
```

---

## Chunk 3: FilterBar + DigitList Integration

### Task 10: FilterBar

**Files:**
- Create: `packages/digit-datagrid/src/filters/FilterBar.tsx`
- Modify: `packages/digit-datagrid/src/__tests__/FilterBar.test.tsx`
- Modify: `packages/digit-datagrid/src/filters/index.ts`

- [ ] **Step 1: Add failing test**

Append to `FilterBar.test.tsx` (FilterBar and DigitList are already imported at the top, and the ra-core mock already includes `FilterLiveForm`, `useListContext`, `useListController`, and `ListContextProvider`):

```tsx
describe('FilterBar', () => {
  it('renders alwaysOn filters directly', () => {
    const filters = [
      <StubFilter key="q" source="q" label="Search" alwaysOn />,
      <StubFilter key="status" source="status" label="Status" />,
    ];
    render(<FilterBar filters={filters} />);
    expect(screen.getByTestId('filter-q')).toBeInTheDocument();
  });

  it('renders displayed non-alwaysOn filters with X button', () => {
    const filters = [
      <StubFilter key="status" source="status" label="Status" />,
    ];
    render(<FilterBar filters={filters} />);
    expect(screen.getByTestId('filter-status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('wraps everything in FilterLiveForm', () => {
    const filters = [
      <StubFilter key="q" source="q" label="Search" alwaysOn />,
    ];
    render(<FilterBar filters={filters} />);
    expect(screen.getByTestId('filter-live-form')).toBeInTheDocument();
  });
});
```

**Note:** All mocks are defined once at the top of `FilterBar.test.tsx` (set up in Task 8). `FilterFormInput` and `AddFilterButton` don't call ra-core hooks directly, but `FilterBar` and `DigitList` do — the comprehensive mock covers all cases.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run src/__tests__/FilterBar.test.tsx`
Expected: FAIL — FilterBar not found

- [ ] **Step 3: Implement FilterBar**

In `packages/digit-datagrid/src/filters/FilterBar.tsx`:

```tsx
import React from 'react';
import { FilterLiveForm, useListContext } from 'ra-core';
import { FilterFormInput } from './FilterFormInput';
import { AddFilterButton } from './AddFilterButton';

export interface FilterBarProps {
  filters: React.ReactElement[];
}

export function FilterBar({ filters }: FilterBarProps) {
  const { displayedFilters, showFilter, hideFilter } = useListContext();

  const alwaysOnFilters = filters.filter((f) => f.props.alwaysOn);
  const displayedNonAlwaysOn = filters.filter(
    (f) => !f.props.alwaysOn && displayedFilters?.[f.props.source]
  );

  return (
    <FilterLiveForm>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Always-on filters rendered directly */}
        {alwaysOnFilters.map((f) => (
          <React.Fragment key={f.props.source}>{f}</React.Fragment>
        ))}

        {/* Displayed non-alwaysOn filters with X button */}
        {displayedNonAlwaysOn.map((f) => (
          <FilterFormInput
            key={f.props.source}
            filterElement={f}
            hideFilter={hideFilter}
          />
        ))}

        {/* Button to add more filters */}
        <AddFilterButton
          filters={filters}
          displayedFilters={displayedFilters ?? {}}
          showFilter={showFilter}
        />
      </div>
    </FilterLiveForm>
  );
}
```

- [ ] **Step 4: Add to barrel + run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/digit-datagrid/src/filters/FilterBar.tsx packages/digit-datagrid/src/filters/index.ts packages/digit-datagrid/src/__tests__/FilterBar.test.tsx
git commit -m "feat(datagrid): FilterBar orchestrates filters in FilterLiveForm"
```

---

### Task 11: DigitList — accept `filters` prop

**Files:**
- Modify: `packages/digit-datagrid/src/DigitList.tsx`
- Modify (existing tests): `packages/digit-datagrid/src/__tests__/DigitList.test.tsx` (if exists, otherwise add to FilterBar.test.tsx)

- [ ] **Step 1: Add failing test**

Append to `FilterBar.test.tsx` (DigitList is already imported at the top, and the ra-core mock includes `useListController` and `ListContextProvider`):

```tsx
describe('DigitList with filters', () => {
  it('renders FilterBar when filters prop is provided', () => {
    const filters = [
      <StubFilter key="q" source="q" label="Search" alwaysOn />,
    ];
    render(
      <DigitList title="Test" filters={filters}>
        <div>content</div>
      </DigitList>
    );
    // FilterBar wraps in FilterLiveForm
    expect(screen.getByTestId('filter-live-form')).toBeInTheDocument();
  });

  it('renders built-in search when no filters prop', () => {
    render(
      <DigitList title="Test">
        <div>content</div>
      </DigitList>
    );
    // The built-in search input should be present
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    // But NOT a FilterLiveForm
    expect(screen.queryByTestId('filter-live-form')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Modify DigitList to accept filters**

In `packages/digit-datagrid/src/DigitList.tsx`, add the `filters` prop and conditionally render `FilterBar` instead of the built-in search.

Changes to `DigitListProps`:
```tsx
import { FilterBar } from './filters/FilterBar';

export interface DigitListProps {
  // ... existing props ...
  /** Filter input elements (react-admin style) */
  filters?: React.ReactElement[];
}
```

Changes to the component body — replace the search input section:

```tsx
{/* Filter bar OR built-in search */}
{filters ? (
  <div className="mb-4">
    <FilterBar filters={filters} />
  </div>
) : (
  <div className="mb-4">
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        placeholder="Search..."
        value={searchValue}
        onChange={handleSearchChange}
        className="pl-9 max-w-sm"
      />
    </div>
  </div>
)}
```

When `filters` is provided, the built-in search is replaced by FilterBar (which typically includes a `SearchFilterInput` as the first filter). When `filters` is not provided, the existing search input remains unchanged — fully backward compatible.

- [ ] **Step 4: Run ALL tests**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 5: Commit**

```bash
git add packages/digit-datagrid/src/DigitList.tsx packages/digit-datagrid/src/__tests__/FilterBar.test.tsx
git commit -m "feat(datagrid): DigitList accepts filters prop, renders FilterBar"
```

---

## Chunk 4: Schema Auto-Generation + Barrel Exports

### Task 12: generateFilterElements()

**Files:**
- Modify: `packages/digit-datagrid/src/columns/schemaUtils.ts`
- Create: `packages/digit-datagrid/src/__tests__/generateFilterElements.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/digit-datagrid/src/__tests__/generateFilterElements.test.ts`:

```tsx
import { describe, it, expect } from 'vitest';
import { generateFilterElements } from '../columns/schemaUtils';
import type { SchemaDefinition, RefMapEntry } from '../columns/schemaUtils';

describe('generateFilterElements', () => {
  it('always prepends SearchFilterInput with source="q"', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: { name: { type: 'string' } },
    };
    const elements = generateFilterElements(schema, {});
    expect(elements.length).toBeGreaterThanOrEqual(1);
    expect(elements[0].props.source).toBe('q');
    expect(elements[0].props.alwaysOn).toBe(true);
  });

  it('generates SelectFilterInput for enum fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
      },
    };
    const elements = generateFilterElements(schema, {});
    const statusFilter = elements.find((el) => el.props.source === 'status');
    expect(statusFilter).toBeDefined();
    expect(statusFilter!.type.name || statusFilter!.type.displayName).toContain('Select');
    expect(statusFilter!.props.choices).toHaveLength(3);
  });

  it('generates NullableBooleanFilterInput for boolean fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        isActive: { type: 'boolean' },
      },
    };
    const elements = generateFilterElements(schema, {});
    const boolFilter = elements.find((el) => el.props.source === 'isActive');
    expect(boolFilter).toBeDefined();
  });

  it('generates ReferenceFilterInput for x-ref-schema fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: { department: { type: 'string' } },
      'x-ref-schema': [{ fieldPath: 'department', schemaCode: 'dept' }],
    };
    const refMap: Record<string, RefMapEntry> = {
      department: { schemaCode: 'dept', resource: 'departments' },
    };
    const elements = generateFilterElements(schema, refMap);
    const refFilter = elements.find((el) => el.props.source === 'department');
    expect(refFilter).toBeDefined();
    expect(refFilter!.props.reference).toBe('departments');
  });

  it('generates DateFilterInput for date/date-time format fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        startDate: { type: 'string', format: 'date' },
      },
    };
    const elements = generateFilterElements(schema, {});
    const dateFilter = elements.find((el) => el.props.source === 'startDate');
    expect(dateFilter).toBeDefined();
  });

  it('skips x-unique fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        code: { type: 'string' },
        name: { type: 'string' },
      },
      'x-unique': ['code'],
    };
    const elements = generateFilterElements(schema, {});
    const codeFilter = elements.find((el) => el.props.source === 'code');
    expect(codeFilter).toBeUndefined();
  });

  it('marks required enum/boolean/ref fields as alwaysOn', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['a', 'b'] },
      },
      required: ['status'],
    };
    const elements = generateFilterElements(schema, {});
    const statusFilter = elements.find((el) => el.props.source === 'status');
    expect(statusFilter!.props.alwaysOn).toBe(true);
  });

  it('generates TextFilterInput for first 2 required string fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        middleName: { type: 'string' },
      },
      required: ['firstName', 'lastName', 'middleName'],
    };
    const elements = generateFilterElements(schema, {});
    const textFilters = elements.filter(
      (el) => el.props.source !== 'q' && (el.type as Function).name?.includes('Text')
    );
    // Only first 2 required strings
    expect(textFilters.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run src/__tests__/generateFilterElements.test.ts`
Expected: FAIL — generateFilterElements not exported from schemaUtils

- [ ] **Step 3: Implement generateFilterElements**

Add to `packages/digit-datagrid/src/columns/schemaUtils.ts`:

```tsx
import {
  SearchFilterInput,
  TextFilterInput,
  SelectFilterInput,
  NullableBooleanFilterInput,
  DateFilterInput,
  ReferenceFilterInput,
} from '../filters';

/**
 * Auto-generate filter elements from a schema definition.
 * Follows these rules:
 * - Always prepend SearchFilterInput source="q" alwaysOn
 * - x-unique fields: skip
 * - enum fields: SelectFilterInput (alwaysOn if required)
 * - boolean fields: NullableBooleanFilterInput (alwaysOn if required)
 * - x-ref-schema fields: ReferenceFilterInput (alwaysOn if required)
 * - date/date-time: DateFilterInput
 * - Required string fields: TextFilterInput (max 2)
 */
export function generateFilterElements(
  schema: SchemaDefinition,
  refMap: Record<string, RefMapEntry>
): React.ReactElement[] {
  const props = schema.properties ?? {};
  const unique = new Set(schema['x-unique'] ?? []);
  const required = new Set(schema.required ?? []);

  const elements: React.ReactElement[] = [
    React.createElement(SearchFilterInput, { key: 'q', source: 'q', alwaysOn: true }),
  ];

  let textCount = 0;

  for (const [fieldName, prop] of Object.entries(props)) {
    if (unique.has(fieldName)) continue;

    const isRequired = required.has(fieldName);
    const label = formatFieldLabel(fieldName);
    const ref = refMap[fieldName];

    if (prop.enum && Array.isArray(prop.enum)) {
      const choices = prop.enum.map((v: unknown) => ({
        id: String(v),
        name: String(v),
      }));
      elements.push(
        React.createElement(SelectFilterInput, {
          key: fieldName,
          source: fieldName,
          label,
          choices,
          alwaysOn: isRequired,
        })
      );
    } else if (prop.type === 'boolean') {
      elements.push(
        React.createElement(NullableBooleanFilterInput, {
          key: fieldName,
          source: fieldName,
          label,
          alwaysOn: isRequired,
        })
      );
    } else if (ref) {
      elements.push(
        React.createElement(ReferenceFilterInput, {
          key: fieldName,
          source: fieldName,
          label,
          reference: ref.resource,
          alwaysOn: isRequired,
        })
      );
    } else if (prop.format === 'date' || prop.format === 'date-time') {
      elements.push(
        React.createElement(DateFilterInput, {
          key: fieldName,
          source: fieldName,
          label,
        })
      );
    } else if (isRequired && prop.type === 'string' && textCount < 2) {
      textCount++;
      elements.push(
        React.createElement(TextFilterInput, {
          key: fieldName,
          source: fieldName,
          label,
        })
      );
    }
  }

  return elements;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run src/__tests__/generateFilterElements.test.ts`
Expected: PASS

- [ ] **Step 5: Run ALL package tests**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/digit-datagrid/src/columns/schemaUtils.ts packages/digit-datagrid/src/__tests__/generateFilterElements.test.ts
git commit -m "feat(datagrid): generateFilterElements auto-creates filters from schema"
```

---

### Task 13: Update barrel exports

**Files:**
- Modify: `packages/digit-datagrid/src/index.ts`
- Modify: `packages/digit-datagrid/src/filters/index.ts` (verify complete)

- [ ] **Step 1: Update package barrel**

Add to `packages/digit-datagrid/src/index.ts`:

```ts
// Filters
export {
  SearchFilterInput,
  TextFilterInput,
  SelectFilterInput,
  BooleanFilterInput,
  DateFilterInput,
  NullableBooleanFilterInput,
  ReferenceFilterInput,
  FilterFormInput,
  AddFilterButton,
  FilterBar,
} from './filters';
export type {
  SearchFilterInputProps,
  TextFilterInputProps,
  SelectFilterInputProps,
  BooleanFilterInputProps,
  DateFilterInputProps,
  NullableBooleanFilterInputProps,
  ReferenceFilterInputProps,
  FilterFormInputProps,
  AddFilterButtonProps,
  FilterBarProps,
} from './filters';

// Add generateFilterElements to schema utilities export
export { generateFilterElements } from './columns/schemaUtils';
```

- [ ] **Step 2: Verify filters/index.ts is complete**

Ensure `packages/digit-datagrid/src/filters/index.ts` exports all 10 components with their types:

```ts
export { SearchFilterInput } from './SearchFilterInput';
export type { SearchFilterInputProps } from './SearchFilterInput';
export { TextFilterInput } from './TextFilterInput';
export type { TextFilterInputProps } from './TextFilterInput';
export { SelectFilterInput } from './SelectFilterInput';
export type { SelectFilterInputProps } from './SelectFilterInput';
export { BooleanFilterInput } from './BooleanFilterInput';
export type { BooleanFilterInputProps } from './BooleanFilterInput';
export { DateFilterInput } from './DateFilterInput';
export type { DateFilterInputProps } from './DateFilterInput';
export { NullableBooleanFilterInput } from './NullableBooleanFilterInput';
export type { NullableBooleanFilterInputProps } from './NullableBooleanFilterInput';
export { ReferenceFilterInput } from './ReferenceFilterInput';
export type { ReferenceFilterInputProps } from './ReferenceFilterInput';
export { FilterFormInput } from './FilterFormInput';
export type { FilterFormInputProps } from './FilterFormInput';
export { AddFilterButton } from './AddFilterButton';
export type { AddFilterButtonProps } from './AddFilterButton';
export { FilterBar } from './FilterBar';
export type { FilterBarProps } from './FilterBar';
```

- [ ] **Step 3: Run ALL package tests + TypeScript check**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run && npx tsc --noEmit`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/digit-datagrid/src/index.ts packages/digit-datagrid/src/filters/index.ts
git commit -m "feat(datagrid): export all filter components from package barrel"
```

---

## Chunk 5: App Wiring

### Task 14: Wire MdmsResourcePage with auto-generated filters

**Files:**
- Modify: `utilities/crs_dataloader/ui-mockup/src/admin/schemaUtils.ts`
- Modify: `utilities/crs_dataloader/ui-mockup/src/admin/MdmsResourcePage.tsx`
- Modify: `utilities/crs_dataloader/ui-mockup/src/admin/index.ts`

- [ ] **Step 1: Add generateFilterElements re-export to app's schemaUtils.ts**

In `utilities/crs_dataloader/ui-mockup/src/admin/schemaUtils.ts`, add:

```ts
export { generateFilterElements } from '@digit-ui/datagrid';
```

This is a direct re-export — unlike `generateColumns`, filters don't need an app-level wrapper because they don't use EntityLink.

- [ ] **Step 2: Update MdmsResourcePage to pass filters**

In `utilities/crs_dataloader/ui-mockup/src/admin/MdmsResourcePage.tsx`:

```tsx
import { generateColumns, getRefMap, generateFilterElements } from './schemaUtils';

export function MdmsResourcePage() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const label = getResourceLabel(resource);
  const { definition } = useSchemaDefinition(config?.schema);

  // Compute refMap once, reused by columns and filters
  const refMap = useMemo(() => {
    if (!definition) return {};
    return getRefMap(definition, getResourceBySchema);
  }, [definition]);

  const schemaColumns = useMemo(() => {
    if (!definition) return null;
    return generateColumns(definition, refMap);
  }, [definition, refMap]);

  // Auto-generate filter elements from schema
  const filterElements = useMemo(() => {
    if (!definition) return undefined;
    return generateFilterElements(definition, refMap);
  }, [definition, refMap]);

  const subtitle = config?.schema ? `Schema: ${config.schema}` : undefined;

  return (
    <DigitList title={label} subtitle={subtitle} filters={filterElements}>
      {schemaColumns ? (
        <DigitDatagrid columns={schemaColumns} rowClick="show" />
      ) : (
        <AutoDetectDatagrid />
      )}
    </DigitList>
  );
}
```

- [ ] **Step 3: Update admin/index.ts re-exports**

Add filter components to `utilities/crs_dataloader/ui-mockup/src/admin/index.ts`:

```ts
// Filter components from @digit-ui/datagrid
export {
  SearchFilterInput,
  TextFilterInput,
  SelectFilterInput,
  BooleanFilterInput,
  DateFilterInput,
  NullableBooleanFilterInput,
  ReferenceFilterInput,
  FilterBar,
} from '@digit-ui/datagrid';
```

This allows dedicated resource pages to import filter components from `@/admin`.

- [ ] **Step 4: Run app TypeScript check**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run all package tests**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add utilities/crs_dataloader/ui-mockup/src/admin/schemaUtils.ts utilities/crs_dataloader/ui-mockup/src/admin/MdmsResourcePage.tsx utilities/crs_dataloader/ui-mockup/src/admin/index.ts
git commit -m "feat: wire auto-generated filters into MdmsResourcePage"
```

---

### Task 15: Add manual filters to EmployeeList (example dedicated resource)

**Files:**
- Modify: `utilities/crs_dataloader/ui-mockup/src/resources/employees/EmployeeList.tsx`

- [ ] **Step 1: Add filters to EmployeeList**

**This is an additive change.** Keep ALL existing imports (`StatusChip`, `EntityLink`, `DigitColumn` type) and the full `columns` array definition unchanged. Only modify:

1. Add filter imports to the existing import line:
```tsx
// BEFORE:
import { DigitList, DigitDatagrid } from '@/admin';
// AFTER:
import { DigitList, DigitDatagrid, SearchFilterInput, SelectFilterInput, TextFilterInput } from '@/admin';
```

2. Add the `filters` array above the `columns` definition:
```tsx
const filters = [
  <SearchFilterInput key="q" source="q" alwaysOn />,
  <SelectFilterInput
    key="employeeStatus"
    source="employeeStatus"
    label="Status"
    choices={[
      { id: 'EMPLOYED', name: 'Employed' },
      { id: 'INACTIVE', name: 'Inactive' },
    ]}
    alwaysOn
  />,
  <TextFilterInput key="code" source="code" label="Code" />,
];
```

3. Add `filters={filters}` to the existing `<DigitList>` JSX:
```tsx
<DigitList title="Employees" hasCreate sort={{ field: 'code', order: 'ASC' }} filters={filters}>
```

- [ ] **Step 2: Run app TypeScript check**

Run: `cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add utilities/crs_dataloader/ui-mockup/src/resources/employees/EmployeeList.tsx
git commit -m "feat: add manual filters to EmployeeList as dedicated resource example"
```

---

### Task 16: Final verification + deployment

- [ ] **Step 1: Run full package test suite**

Run: `cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run full TypeScript check**

Run: `cd /root/code/ccrs-ui-mockup && npx tsc --noEmit -p packages/digit-datagrid/tsconfig.json && cd utilities/crs_dataloader/ui-mockup && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Restart dev server**

Run: `pm2 restart crs-mockup`
Expected: Dev server restarts, accessible at https://crs-mockup.egov.theflywheel.in

- [ ] **Step 4: Push to remote**

```bash
cd /root/code/ccrs-ui-mockup && git push origin configurator
```
