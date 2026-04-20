# Inline List Editing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable double-click inline editing of cells in DigitDatagrid across all resource types.

**Architecture:** Extend `DigitColumn` with an `editable` property. `DigitDatagrid` tracks which cell is being edited via state, renders `EditableCell` for that cell, and calls react-admin's `useUpdate` to persist. Schema-driven columns auto-set `editable` for non-key, non-ref, non-complex fields.

**Tech Stack:** React, react-admin (ra-core `useUpdate`), existing `EditableCell` component, vitest

---

### Task 1: Extend DigitColumn type and add editable cell rendering to DigitDatagrid

**Files:**
- Modify: `src/admin/DigitDatagrid.tsx`
- Modify: `src/admin/index.ts` (export new type)

**Context:** `DigitDatagrid` currently renders all cells as read-only. We need to:
1. Add `editable` to the `DigitColumn` interface
2. Track which cell `{ recordId, source }` is being edited
3. On double-click of an editable cell, enter edit mode (suppress row navigation)
4. Render `EditableCell` for the active cell
5. On save, call `useUpdate` from react-admin

**Step 1: Add types to `src/admin/DigitDatagrid.tsx`**

Add after the existing `DigitColumn` interface (line 22-31):

```tsx
import { useUpdate } from 'ra-core';
import { EditableCell } from '@/components/ui/editable-cell';
import type { ValidationRule } from '@/components/ui/editable-cell';
import { Pencil } from 'lucide-react';

export interface EditableColumnConfig {
  type?: 'text' | 'number';
  validation?: ValidationRule;
}

export interface DigitColumn<RecordType extends RaRecord = RaRecord> {
  source: string;
  label: string;
  sortable?: boolean;
  render?: (record: RecordType) => React.ReactNode;
  /** Enable inline editing. true = text input. Object = config with type/validation. */
  editable?: boolean | EditableColumnConfig;
}
```

**Step 2: Add edit state and handlers inside the `DigitDatagrid` function**

Add state after the existing hooks (after line 74):

```tsx
const [editingCell, setEditingCell] = useState<{ recordId: string | number; source: string } | null>(null);
const [update] = useUpdate();
```

Add a double-click handler:

```tsx
const handleCellDoubleClick = useCallback(
  (e: React.MouseEvent, record: RecordType, col: DigitColumn<RecordType>) => {
    if (!col.editable) return;
    e.stopPropagation(); // prevent row click navigation
    setEditingCell({ recordId: record.id, source: col.source });
  },
  []
);

const handleCellSave = useCallback(
  async (record: RecordType, source: string, newValue: string) => {
    const typedValue = getEditableConfig(record, source, newValue);
    await update(resource!, {
      id: record.id,
      data: { ...record, [source]: typedValue },
      previousData: record,
    });
    setEditingCell(null);
  },
  [resource, update]
);
```

Helper to coerce value type:

```tsx
function getTypedValue(col: DigitColumn, rawValue: string): unknown {
  const config = typeof col.editable === 'object' ? col.editable : {};
  if (config.type === 'number') return Number(rawValue);
  return rawValue;
}
```

**Step 3: Update cell rendering in the `<TableBody>` section**

Replace the cell rendering (lines 169-174) with:

```tsx
{columns.map((col) => {
  const isEditing = editingCell?.recordId === record.id && editingCell?.source === col.source;
  const isEditable = Boolean(col.editable);

  return (
    <TableCell
      key={col.source}
      onDoubleClick={isEditable ? (e) => handleCellDoubleClick(e, record, col) : undefined}
      className={isEditable ? 'group/cell' : ''}
    >
      {isEditing ? (
        <EditableCell
          value={String(getNestedValue(record as Record<string, unknown>, col.source) ?? '')}
          onSave={async (val) => {
            const typedVal = getTypedValue(col, val);
            await update(resource!, {
              id: record.id,
              data: { ...record, [col.source]: typedVal },
              previousData: record,
            });
            setEditingCell(null);
          }}
          type={typeof col.editable === 'object' && col.editable.type === 'number' ? 'number' : 'text'}
          validation={typeof col.editable === 'object' ? col.editable.validation : undefined}
        />
      ) : col.render ? (
        col.render(record)
      ) : (
        <span className="flex items-center gap-1">
          {renderCellValue(getNestedValue(record as Record<string, unknown>, col.source))}
          {isEditable && (
            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/cell:opacity-100 transition-opacity flex-shrink-0" />
          )}
        </span>
      )}
    </TableCell>
  );
})}
```

**Step 4: Prevent row click when double-clicking an editable cell**

The `e.stopPropagation()` in `handleCellDoubleClick` handles this. Also, make `EditableCell` start in edit mode immediately by adding a new `startEditing` prop — actually, the existing `EditableCell` enters edit mode via click. Since we double-click the cell and then render EditableCell, it renders in display mode first. We need it to start in editing mode.

Modify `src/components/ui/editable-cell.tsx` — add `initialEditing` prop:

```tsx
export interface EditableCellProps {
  // ... existing props
  /** Start in editing mode immediately */
  initialEditing?: boolean;
}

export function EditableCell({
  // ... existing destructured props
  initialEditing = false,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(initialEditing);
  // rest unchanged
```

Then in `DigitDatagrid`, pass `initialEditing`:

```tsx
<EditableCell
  value={...}
  onSave={...}
  initialEditing
  // ...
/>
```

**Step 5: Update the `src/admin/index.ts` exports**

Add to the existing exports:

```ts
export type { EditableColumnConfig } from './DigitDatagrid';
```

**Step 6: Build and verify**

Run: `npx tsc -b --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/admin/DigitDatagrid.tsx src/components/ui/editable-cell.tsx src/admin/index.ts
git commit -m "feat: Add inline editing support to DigitDatagrid"
```

---

### Task 2: Add editable columns to dedicated List pages

**Files:**
- Modify: `src/resources/departments/DepartmentList.tsx`
- Modify: `src/resources/designations/DesignationList.tsx`
- Modify: `src/resources/complaint-types/ComplaintTypeList.tsx`
- Modify: `src/resources/localization/LocalizationList.tsx`

**Context:** Each list page defines a `columns` array. Add `editable: true` to appropriate columns. Primary keys and computed fields stay read-only.

**Step 1: Update DepartmentList.tsx**

```tsx
const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'name', label: 'Name', editable: true },
  {
    source: 'active',
    label: 'Status',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
  { source: 'description', label: 'Description', editable: true },
];
```

**Step 2: Update DesignationList.tsx**

Same pattern — `name` and `description` editable:

```tsx
const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'name', label: 'Name', editable: true },
  {
    source: 'active',
    label: 'Status',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
  { source: 'description', label: 'Description', editable: true },
];
```

**Step 3: Update ComplaintTypeList.tsx**

`name` and `slaHours` editable (slaHours as number):

```tsx
const columns: DigitColumn[] = [
  { source: 'serviceCode', label: 'Service Code' },
  { source: 'name', label: 'Name', editable: true },
  {
    source: 'department',
    label: 'Department',
    render: (record) => {
      const dept = String(record.department ?? '');
      return dept ? <EntityLink resource="departments" id={dept} /> : <span className="text-muted-foreground">--</span>;
    },
  },
  { source: 'slaHours', label: 'SLA (hrs)', editable: { type: 'number' } },
  {
    source: 'active',
    label: 'Status',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
];
```

**Step 4: Update LocalizationList.tsx**

`message` editable:

```tsx
const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  {
    source: 'message',
    label: 'Message',
    editable: true,
    render: undefined, // remove the truncation render — EditableCell handles display
  },
  { source: 'module', label: 'Module' },
  { source: 'locale', label: 'Locale' },
];
```

Wait — if a column has both `render` and `editable`, the `render` is used for display and EditableCell only appears on double-click. So we can keep the truncation render. However, the current DigitDatagrid cell rendering logic uses `col.render` when not editing. This is fine — on double-click the full value appears in the input. Update LocalizationList to just add `editable`:

```tsx
const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  {
    source: 'message',
    label: 'Message',
    editable: true,
    render: (record) => {
      const msg = String(record.message ?? '');
      return <span className="truncate max-w-[300px] block">{msg.length > 80 ? msg.slice(0, 80) + '...' : msg}</span>;
    },
  },
  { source: 'module', label: 'Module' },
  { source: 'locale', label: 'Locale' },
];
```

Note: When `render` is present AND `editable` is set, the pencil icon won't show (it only renders when `col.render` is falsy). We need to handle this in DigitDatagrid — show the pencil icon even when `render` is present. Update the cell rendering in Task 1 to wrap custom renderers too:

In the cell rendering section, when `col.render` is present and `isEditable` is true:

```tsx
) : col.render ? (
  <span className="flex items-center gap-1">
    {col.render(record)}
    {isEditable && (
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/cell:opacity-100 transition-opacity flex-shrink-0" />
    )}
  </span>
) : (
```

**Step 5: Build and verify**

Run: `npx tsc -b --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/resources/departments/DepartmentList.tsx src/resources/designations/DesignationList.tsx src/resources/complaint-types/ComplaintTypeList.tsx src/resources/localization/LocalizationList.tsx
git commit -m "feat: Enable inline editing for departments, designations, complaint types, localization"
```

---

### Task 3: Auto-set editable for schema-driven MDMS columns

**Files:**
- Modify: `src/admin/schemaUtils.ts` — update `generateColumns`
- Modify: `src/admin/schemaUtils.test.ts` — add tests

**Context:** `generateColumns` produces `DigitColumn[]` from schema definitions. Columns for fields that are NOT in `x-unique` and NOT in `refMap` should get `editable: true`.

**Step 1: Write the failing test in `src/admin/schemaUtils.test.ts`**

Add to the `generateColumns` describe block:

```ts
it('sets editable on non-key, non-ref columns', () => {
  const refMap = getRefMap(ROLEACTIONS_SCHEMA, mockLookup);
  const cols = generateColumns(ROLEACTIONS_SCHEMA, refMap);
  // rolecode and actionid are x-unique → not editable
  // rolecode and actionid are also refs → not editable
  // tenantId is required but not key/ref → editable
  // actioncode is optional, not key/ref → editable
  const tenantCol = cols.find((c) => c.source === 'tenantId');
  const actioncodeCol = cols.find((c) => c.source === 'actioncode');
  const rolecodeCol = cols.find((c) => c.source === 'rolecode');
  expect(tenantCol?.editable).toBe(true);
  expect(actioncodeCol?.editable).toBe(true);
  expect(rolecodeCol?.editable).toBeFalsy();
});

it('sets editable with type number for number fields', () => {
  const schema: SchemaDefinition = {
    type: 'object',
    properties: {
      code: { type: 'string' },
      count: { type: 'number' },
      score: { type: 'integer' },
    },
    required: ['code', 'count'],
    'x-unique': ['code'],
  };
  const cols = generateColumns(schema, {});
  const countCol = cols.find((c) => c.source === 'count');
  const scoreCol = cols.find((c) => c.source === 'score');
  expect(countCol?.editable).toEqual({ type: 'number' });
  expect(scoreCol?.editable).toEqual({ type: 'number' });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/schemaUtils.test.ts`
Expected: 2 new tests FAIL (editable property is undefined)

**Step 3: Update `generateColumns` in `src/admin/schemaUtils.ts`**

Replace the column building inside the for loop (lines 105-129):

```ts
export function generateColumns(
  schema: SchemaDefinition,
  refMap: Record<string, RefMapEntry>
): DigitColumn[] {
  const props = schema.properties ?? {};
  const ordered = orderFields(schema);
  const unique = new Set(schema['x-unique'] ?? []);

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

    // Auto-set editable for non-key, non-ref fields
    if (!unique.has(fieldName) && !ref) {
      if (prop.type === 'number' || prop.type === 'integer') {
        col.editable = { type: 'number' };
      } else {
        col.editable = true;
      }
    }

    columns.push(col);
  }

  return columns;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/admin/schemaUtils.test.ts`
Expected: All 15 tests pass (13 existing + 2 new)

**Step 5: Build check**

Run: `npx tsc -b --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/admin/schemaUtils.ts src/admin/schemaUtils.test.ts
git commit -m "feat: Auto-set editable on schema-driven MDMS columns"
```

---

### Task 4: Build, deploy, and verify

**Files:** None (build + deploy + test)

**Step 1: Build the project**

Run: `npm run build`
Expected: Build succeeds

**Step 2: Deploy**

Run: `pm2 restart crs-mockup`
Expected: Process restarts successfully

**Step 3: Verify with puppeteer**

Create `/tmp/verify-inline-edit.mjs`:

```js
import puppeteer from 'puppeteer';

const BASE = 'https://crs-mockup.egov.theflywheel.in';

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Management')) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 300));
  const tenantInput = await page.$('#tenantCode');
  if (tenantInput) {
    await tenantInput.click({ clickCount: 3 });
    await tenantInput.press('Backspace');
    await tenantInput.type('mz', { delay: 50 });
  }
  await page.evaluate(() => {
    const form = document.querySelector('form');
    if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  try { await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }); } catch {}
  await new Promise(r => setTimeout(r, 2000));

  // Test 1: Departments — check pencil icon on hover
  console.log('\n=== Test 1: Departments inline editing ===');
  await page.goto(`${BASE}/manage/departments`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Hover over a Name cell and check for pencil
  const nameCell = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('td'));
    // Find a cell with "Street Lights" or similar
    const cell = cells.find(c => c.textContent?.includes('Street Lights'));
    return cell ? cell.textContent : 'NOT FOUND';
  });
  console.log(`  Found name cell: ${nameCell}`);

  // Double-click the Name cell
  const nameCellEl = await page.evaluateHandle(() => {
    const cells = Array.from(document.querySelectorAll('td'));
    return cells.find(c => c.textContent?.includes('Street Lights'));
  });
  if (nameCellEl) {
    await nameCellEl.asElement()?.click({ clickCount: 2 });
    await new Promise(r => setTimeout(r, 500));

    // Check if an input appeared
    const hasInput = await page.evaluate(() => {
      return document.querySelector('td input') !== null;
    });
    console.log(`  Input appeared after double-click: ${hasInput}`);

    // Press Escape to cancel
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
  }

  await page.screenshot({ path: '/tmp/inline-edit-departments.png' });

  // Test 2: MDMS schema-driven (role-actions)
  console.log('\n=== Test 2: Role Actions inline editing ===');
  await page.goto(`${BASE}/manage/role-actions`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Check if any cells have the pencil icon CSS
  const editableCellCount = await page.evaluate(() => {
    return document.querySelectorAll('td .group-hover\\/cell\\:opacity-100, td [class*="group-hover"]').length;
  });
  console.log(`  Editable cells with pencil hint: ${editableCellCount}`);

  await page.screenshot({ path: '/tmp/inline-edit-role-actions.png' });

  await browser.close();
  console.log('\n=== Verification complete ===');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
```

Run: `node /tmp/verify-inline-edit.mjs`
Expected: Input appears after double-click, editable cells detected

**Step 4: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: inline editing adjustments from verification"
```
