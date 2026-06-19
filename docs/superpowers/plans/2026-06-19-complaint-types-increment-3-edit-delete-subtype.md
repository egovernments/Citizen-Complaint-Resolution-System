# Complaint Types — Increment 3 (Edit / Delete Sub-Type) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-row **Edit** and **Delete** actions to each sub-type in the complaint-types accordion, with a strong warning when deleting the last sub-type of a type.

**Architecture:** `SubTypeTable` stays presentational — it gains an **Actions** column (Edit icon → navigate to the existing edit route; Delete icon → existing `DeleteConfirmDialog`) and a new `onDelete(record)` callback prop. The parent `ComplaintTypeList` owns the actual mutation via the react-admin data provider's `delete` (which the provider already maps to MDMS soft-delete, `isActive:false`), then notifies and refetches. Deleting the last sub-type empties the type, so it disappears from the (active-only) list automatically.

**Tech Stack:** React 19, ra-core (`useDataProvider`, `useNotify`, `useGetList`), shadcn/Radix (`AlertDialog` via `DeleteConfirmDialog`), Tailwind, lucide-react, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-19-complaint-types-hierarchy-design.md` — Increment 3 (“Edit / Delete Sub-Type — row actions: edit (existing form) + soft-delete with the last-sub-type warning”). Delete is **soft-delete**; MDMS has no hard delete; `mdmsGetList` filters to `isActive` records so a deleted sub-type vanishes on refetch.

**Conventions for every task:**
- Paths are relative to `configurator/` (the npm workspace). Run npm/npx from there.
- Tests: `npx vitest run <path>`. Type-check: `npx tsc --noEmit`. Lint: `npx eslint <files>`.
- Branch: `feature/complaint-types-accordion` (already checked out). Commit trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File structure
- Modify `src/test/setup.ts` — add jsdom polyfills so Radix `AlertDialog` can open in tests.
- Modify `src/resources/complaint-types/SubTypeTable.tsx` — Actions column + `onDelete` prop + last-sub-type warning.
- Modify `src/resources/complaint-types/SubTypeTable.test.tsx` — cover the new actions.
- Modify `src/resources/complaint-types/ComplaintTypeList.tsx` — wire `handleDeleteSubType` and pass it to `SubTypeTable`.

---

### Task 1: jsdom polyfills for Radix AlertDialog

**Files:**
- Modify: `src/test/setup.ts`

Radix `AlertDialog` (used by `DeleteConfirmDialog`) calls `Element.prototype.scrollIntoView` and the pointer-capture methods when opening/focusing. jsdom does not implement these, so the dialog tests would throw. Add no-op polyfills (alongside the existing `ResizeObserver`/`matchMedia` mocks).

- [ ] **Step 1: Add the polyfills**

In `src/test/setup.ts`, after the `ResizeObserver` mock block, add:

```ts
// jsdom doesn't implement these DOM methods that Radix (AlertDialog/Dialog)
// relies on when opening/focusing content. No-op them so portal dialogs render.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
```

- [ ] **Step 2: Verify the suite still passes**

Run: `npx vitest run`
Expected: PASS (current count 41+; no regressions — this only adds globals).

- [ ] **Step 3: Commit**

```bash
git add src/test/setup.ts
git commit -m "test(setup): polyfill scrollIntoView + pointer capture for Radix dialogs"
```

---

### Task 2: SubTypeTable — Edit/Delete actions column (TDD)

**Files:**
- Modify: `src/resources/complaint-types/SubTypeTable.tsx`
- Test: `src/resources/complaint-types/SubTypeTable.test.tsx`

The current `SubTypeTable` takes only `subTypes` and navigates the whole row to the Show page. Add an `onDelete` prop and an Actions column. The Edit/Delete controls must `stopPropagation` so they don't trigger the row's Show navigation. When `subTypes.length === 1`, the delete dialog shows a strong "this removes the entire complaint type" warning.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `src/resources/complaint-types/SubTypeTable.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import { SubTypeTable } from './SubTypeTable';
import type { SubTypeRecord } from './groupComplaintTypes';

const sub: SubTypeRecord = {
  id: 'GarbageNotCollected',
  serviceCode: 'GarbageNotCollected',
  name: 'Garbage not collected',
  department: 'Public Health',
  slaHours: 48,
  active: true,
};

const twoSubs: SubTypeRecord[] = [
  sub,
  { id: 'Overflow', serviceCode: 'Overflow', name: 'Bin overflow', active: true },
];

describe('SubTypeTable', () => {
  it('renders sub-type rows', () => {
    render(<SubTypeTable subTypes={[sub]} onDelete={vi.fn()} />);
    expect(screen.getByText('Garbage not collected')).toBeInTheDocument();
    expect(screen.getByText('GarbageNotCollected')).toBeInTheDocument();
  });

  it('navigates to the Show page on row click', () => {
    navigate.mockClear();
    render(<SubTypeTable subTypes={[sub]} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Garbage not collected'));
    expect(navigate).toHaveBeenCalledWith(
      '/manage/complaint-types/GarbageNotCollected/show',
    );
  });

  it('Edit action navigates to the edit route and not the Show route', () => {
    navigate.mockClear();
    render(<SubTypeTable subTypes={[sub]} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Edit Garbage not collected'));
    expect(navigate).toHaveBeenCalledWith('/manage/complaint-types/GarbageNotCollected');
    expect(navigate).not.toHaveBeenCalledWith('/manage/complaint-types/GarbageNotCollected/show');
  });

  it('Delete action opens a confirm dialog and calls onDelete with the record', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<SubTypeTable subTypes={twoSubs} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText('Delete Garbage not collected'));
    const confirm = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(confirm);
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(sub));
  });

  it('warns that deleting the last sub-type removes the whole complaint type', async () => {
    render(<SubTypeTable subTypes={[sub]} onDelete={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByLabelText('Delete Garbage not collected'));
    expect(await screen.findByText(/remove the entire complaint type/i)).toBeInTheDocument();
  });

  it('does not show the last-sub-type warning when other sub-types remain', async () => {
    render(<SubTypeTable subTypes={twoSubs} onDelete={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByLabelText('Delete Garbage not collected'));
    await screen.findByRole('button', { name: 'Delete' });
    expect(screen.queryByText(/remove the entire complaint type/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, confirm they FAIL**

Run: `npx vitest run src/resources/complaint-types/SubTypeTable.test.tsx`
Expected: FAIL — `onDelete` not used / no Edit/Delete controls (the new tests fail; the two original-style tests may still pass).

- [ ] **Step 3: Implement the Actions column**

Replace the entire contents of `src/resources/complaint-types/SubTypeTable.tsx` with:

```tsx
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { StatusChip } from '@/admin/fields';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import type { SubTypeRecord } from './groupComplaintTypes';

interface SubTypeTableProps {
  subTypes: SubTypeRecord[];
  /** Soft-deletes the sub-type. Rejecting surfaces the error inside the dialog. */
  onDelete: (record: SubTypeRecord) => Promise<void>;
}

export function SubTypeTable({ subTypes, onDelete }: SubTypeTableProps) {
  const navigate = useNavigate();
  // Deleting the only remaining sub-type empties (and thus removes) the type.
  const isLastSubType = subTypes.length === 1;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-muted-foreground">
          <th className="px-3 py-2 font-medium">Sub-Type</th>
          <th className="px-3 py-2 font-medium">Service Code</th>
          <th className="px-3 py-2 font-medium">Department</th>
          <th className="px-3 py-2 font-medium">SLA</th>
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="px-3 py-2 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {subTypes.map((s) => {
          const label = s.name ?? s.serviceName ?? '--';
          const id = encodeURIComponent(String(s.id));
          return (
            <tr
              key={String(s.id)}
              onClick={() => navigate(`/manage/complaint-types/${id}/show`)}
              className="cursor-pointer border-t border-border hover:bg-muted/40"
            >
              <td className="px-3 py-2">{label}</td>
              <td className="px-3 py-2 font-mono text-xs text-primary">{s.serviceCode}</td>
              <td className="px-3 py-2">{s.department ?? '--'}</td>
              <td className="px-3 py-2">{s.slaHours != null ? `${s.slaHours}h` : '--'}</td>
              <td className="px-3 py-2">
                <StatusChip value={s.active} labels={{ true: 'Active', false: 'Inactive' }} />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/manage/complaint-types/${id}`);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <DeleteConfirmDialog
                    title="Delete Sub-Type"
                    itemName={label}
                    description={
                      isLastSubType
                        ? `"${label}" is the last sub-type of this complaint type. Deleting it will remove the entire complaint type. This action cannot be undone.`
                        : undefined
                    }
                    onConfirm={() => onDelete(s)}
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${label}`}
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                  />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run tests, confirm they PASS**

Run: `npx vitest run src/resources/complaint-types/SubTypeTable.test.tsx`
Expected: PASS (all 6 tests). If the dialog tests can't find the confirm button, ensure Task 1's polyfills are in place.

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit` → expect clean.
```bash
git add src/resources/complaint-types/SubTypeTable.tsx src/resources/complaint-types/SubTypeTable.test.tsx
git commit -m "feat(complaint-types): edit/delete actions per sub-type with last-sub-type warning"
```

---

### Task 3: Wire delete in ComplaintTypeList

**Files:**
- Modify: `src/resources/complaint-types/ComplaintTypeList.tsx`

`ComplaintTypeList` already has `refetch` from `useGetList`. Add `useDataProvider` + `useNotify`, define `handleDeleteSubType`, and pass it to `SubTypeTable`. The data provider's `delete('complaint-types', …)` already performs the MDMS soft-delete; on success notify + refetch so the row (and, if last, the whole type) disappears. Errors propagate to the dialog.

- [ ] **Step 1: Extend the ra-core imports**

In `src/resources/complaint-types/ComplaintTypeList.tsx`, change:

```ts
import { useGetList, useTranslate } from 'ra-core';
```
to:
```ts
import { useGetList, useTranslate, useDataProvider, useNotify } from 'ra-core';
```

- [ ] **Step 2: Add the delete handler**

Immediately after the `useGetList(...)` call (the line block that destructures `data, isPending, isFetching, error, refetch`), add:

```tsx
  const dataProvider = useDataProvider();
  const notify = useNotify();

  const handleDeleteSubType = async (record: SubTypeRecord) => {
    // dataProvider.delete maps to an MDMS soft-delete (isActive:false). On
    // success the active-only list no longer returns the row; refetch reflects
    // it (and drops the whole type if that was its last sub-type). A rejection
    // propagates to DeleteConfirmDialog, which shows the message in-dialog.
    await dataProvider.delete('complaint-types', {
      id: record.id,
      previousData: record as unknown as Record<string, unknown>,
    });
    notify('Sub-type deleted', { type: 'info' });
    await refetch();
  };
```

- [ ] **Step 3: Pass the handler to SubTypeTable**

Change:
```tsx
                      <SubTypeTable subTypes={g.subTypes} />
```
to:
```tsx
                      <SubTypeTable subTypes={g.subTypes} onDelete={handleDeleteSubType} />
```

- [ ] **Step 4: Type-check, lint, full suite**

Run:
```bash
npx tsc --noEmit
npx eslint src/resources/complaint-types/ComplaintTypeList.tsx src/resources/complaint-types/SubTypeTable.tsx
npx vitest run
```
Expected: tsc clean; eslint clean on these files; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/complaint-types/ComplaintTypeList.tsx
git commit -m "feat(complaint-types): wire sub-type soft-delete via data provider + refetch"
```

---

### Task 4: Verify + production build

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run (from `configurator/`): `npm run build`
Expected: build succeeds. If it fails, confirm the errors are pre-existing and unrelated to complaint-types (the repo has known unrelated `tsc -b` failures); the complaint-types files must contribute none.

- [ ] **Step 2: Manual verification (dev server)**

Run: `npm run dev`. Then:
1. Open `/manage/complaint-types`, expand a type with ≥2 sub-types.
2. Click the **Edit** (pencil) icon on a row → lands on the edit form for that sub-type (not the Show page).
3. Back on the list, click **Delete** (trash) on a non-last sub-type → confirm → row disappears, "Sub-type deleted" toast shows, the rest of the type remains.
4. Expand a type with exactly **one** sub-type, click **Delete** → confirm the dialog warns it will remove the entire complaint type → confirm → the whole type disappears from the list.
5. Confirm clicking Edit/Delete never also opens the Show page (stopPropagation works).

- [ ] **Step 3: Push**

```bash
git push egov feature/complaint-types-accordion
```
(Updates PR #899.)

---

## Out of scope (later increments)
- Increment 4 — Create Complaint Type (combined type + first sub-type form, top-level "+ Add Complaint Type").
- Increment 5 — Edit Complaint Type (rename display name via localization + cache bust).
- Hard delete, delete-type, and code rename remain out of scope per the spec.
