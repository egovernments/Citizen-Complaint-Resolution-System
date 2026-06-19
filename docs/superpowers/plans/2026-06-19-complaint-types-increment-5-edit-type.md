# Complaint Types — Increment 5 (Edit Complaint Type) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators rename a complaint type's **display name** from the accordion, updating the localization label across locales — without touching any MDMS record or the type's code.

**Architecture:** A type's display name lives only in localization at `SERVICEDEFS.<MENUPATH_UPPER>` (one entry per locale); the `menuPath` code is fixed. Add a pencil action on each (non-Uncategorized) type row that opens a small `RenameTypeDialog`. Saving upserts `SERVICEDEFS.<menuPath>` for every configured locale via `localizationService.upsertMessages`, calls `cacheBust()`, and refetches the list so the new label resolves. No record/data-provider/registry changes (frontend-only).

**Tech Stack:** React 19, ra-core (`useTranslate`, `useDataProvider`, `useNotify`, `useGetList`), shadcn `Dialog`/`Input`/`Button`, lucide `Pencil`, `localizationService`, `useAvailableLocales`, `digitClient` (bridge), vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-19-complaint-types-hierarchy-design.md` — Increment 5 ("rename the type's display name only — localization upsert of `SERVICEDEFS.<MENUPATH>` across locales + `cacheBust()`. No record changes.").

**Behavior note (approved via spec):** the new name is written to **all configured locales** (same approach as the create flow's label seeding); per-locale translations can be refined later via the bulk localization import/export. The `menuPath` code is never changed.

**Conventions:** paths relative to `configurator/`. Tests `npx vitest run <path>`, type-check `npx tsc --noEmit`, lint `npx eslint <files>`. Branch `feature/complaint-types-accordion`. Commit trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
(jsdom dialog polyfills already exist in `src/test/setup.ts` from increment 3.)

## File structure
- Create `src/resources/complaint-types/RenameTypeDialog.tsx` — the rename dialog (presentational; `onRename` callback).
- Create `src/resources/complaint-types/RenameTypeDialog.test.tsx` — dialog behavior tests.
- Modify `src/resources/complaint-types/ComplaintTypeList.tsx` — pencil action on type rows + `handleRenameType` (localization upsert + cacheBust + refetch).
- Modify `src/resources/complaint-types/ComplaintTypeList.test.tsx` — cover the action, Uncategorized exclusion, and the rename wiring.

---

### Task 1: RenameTypeDialog component (TDD)

**Files:**
- Create: `src/resources/complaint-types/RenameTypeDialog.tsx`
- Test: `src/resources/complaint-types/RenameTypeDialog.test.tsx`

A self-contained dialog (like `DeleteConfirmDialog`): renders a caller-supplied `trigger`, opens a dialog with a text input prefilled with the current name, and calls `onRename(newName)` on Save. Resets the field to the current name each time it opens; surfaces errors in-dialog; blocks an empty name.

- [ ] **Step 1: Write the failing tests**

Create `src/resources/complaint-types/RenameTypeDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RenameTypeDialog } from './RenameTypeDialog';

function setup(onRename = vi.fn().mockResolvedValue(undefined)) {
  render(
    <RenameTypeDialog
      currentName="Sanitation"
      onRename={onRename}
      trigger={<button>edit</button>}
    />,
  );
  return { onRename };
}

describe('RenameTypeDialog', () => {
  it('opens with the current name prefilled', async () => {
    setup();
    fireEvent.click(screen.getByText('edit'));
    const input = await screen.findByLabelText('Complaint type display name');
    expect((input as HTMLInputElement).value).toBe('Sanitation');
  });

  it('calls onRename with the trimmed new name on Save', async () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByText('edit'));
    const input = await screen.findByLabelText('Complaint type display name');
    fireEvent.change(input, { target: { value: '  Sanitation & Waste  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Sanitation & Waste'));
  });

  it('does not call onRename when the name is empty', async () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByText('edit'));
    const input = await screen.findByLabelText('Complaint type display name');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `npx vitest run src/resources/complaint-types/RenameTypeDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dialog**

Create `src/resources/complaint-types/RenameTypeDialog.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface RenameTypeDialogProps {
  currentName: string;
  onRename: (newName: string) => Promise<void>;
  trigger: ReactNode;
}

export function RenameTypeDialog({ currentName, onRename, trigger }: RenameTypeDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName(currentName); // reset to the live label each time it opens
      setError(null);
    }
    setOpen(next);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(trimmed);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Complaint Type</DialogTitle>
          <DialogDescription>
            Updates the display name across all configured languages. The internal
            code is unchanged.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Complaint type display name"
          placeholder="Display name"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `npx vitest run src/resources/complaint-types/RenameTypeDialog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add src/resources/complaint-types/RenameTypeDialog.tsx src/resources/complaint-types/RenameTypeDialog.test.tsx
git commit -m "feat(complaint-types): rename-type dialog"
```

---

### Task 2: Wire rename into ComplaintTypeList (TDD)

**Files:**
- Modify: `src/resources/complaint-types/ComplaintTypeList.tsx`
- Test: `src/resources/complaint-types/ComplaintTypeList.test.tsx`

Add a pencil action beside each non-Uncategorized type label that opens `RenameTypeDialog`, and a `handleRenameType` that upserts `SERVICEDEFS.<menuPath>` for every configured locale, cache-busts, then refetches. The pencil must `stopPropagation` so it doesn't toggle the accordion.

- [ ] **Step 1: Extend the test mocks + write failing tests**

In `src/resources/complaint-types/ComplaintTypeList.test.tsx`:

(a) Add a record **without** `menuPath` to the `useGetList` mock data (creates an "Uncategorized" group), appended after the existing `PotHole` entry:

```tsx
      {
        id: 'Streetlight',
        serviceCode: 'Streetlight',
        name: 'Street light broken',
        slaHours: 24,
        active: true,
        order: 3,
      },
```

(b) Replace the single `vi.mock('ra-core', …)` hooks block additions — extend it to include the data-provider/notify hooks already used, plus add module mocks below the existing `react-router-dom` mock:

```tsx
const upsertMessages = vi.fn().mockResolvedValue({ success: 1, failed: 0 });
const cacheBust = vi.fn().mockResolvedValue(undefined);
vi.mock('@/api/services/localization', () => ({
  localizationService: {
    upsertMessages: (...args: unknown[]) => upsertMessages(...args),
    cacheBust: () => cacheBust(),
  },
}));
vi.mock('@/hooks/useAvailableLocales', () => ({
  useAvailableLocales: () => ({ locales: [{ value: 'en_IN' }] }),
}));
vi.mock('@/providers/bridge', () => ({ digitClient: { stateTenantId: 'pb' } }));
```

(Place these `vi.mock` calls at top level, next to the existing mocks. `upsertMessages`/`cacheBust` are referenced inside the factory, so declare them with `vi.hoisted` if your vitest flags TDZ — wrap as `const { upsertMessages, cacheBust } = vi.hoisted(() => ({ upsertMessages: vi.fn().mockResolvedValue({ success: 1, failed: 0 }), cacheBust: vi.fn().mockResolvedValue(undefined) }));`.)

(c) Add tests inside the describe block:

```tsx
  it('shows a rename action on a type row but not on Uncategorized', () => {
    render(<ComplaintTypeList />);
    expect(screen.getByLabelText('Rename Sanitation')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rename Uncategorized')).not.toBeInTheDocument();
  });

  it('renames a type: upserts SERVICEDEFS.<menuPath> across locales then cache-busts', async () => {
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByLabelText('Rename Sanitation'));
    const input = await screen.findByLabelText('Complaint type display name');
    fireEvent.change(input, { target: { value: 'Sanitation & Waste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(cacheBust).toHaveBeenCalled());
    expect(upsertMessages).toHaveBeenCalledWith(
      'pb',
      'en_IN',
      [{ code: 'SERVICEDEFS.SANITATION', message: 'Sanitation & Waste', module: 'rainmaker-pgr', locale: 'en_IN' }],
    );
  });

  it('clicking rename does not toggle the type open', () => {
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByLabelText('Rename Sanitation'));
    // The sub-type stays hidden because the row didn't expand.
    expect(screen.queryByText('Garbage not collected')).not.toBeInTheDocument();
  });
```

Also add `waitFor` to the testing-library import.

- [ ] **Step 2: Run, confirm FAIL**

Run: `npx vitest run src/resources/complaint-types/ComplaintTypeList.test.tsx`
Expected: FAIL — no rename action yet.

- [ ] **Step 3: Implement in ComplaintTypeList.tsx**

(a) Imports — add `Pencil` to the lucide import and the three service imports:

```tsx
import { RefreshCw, ChevronRight, ChevronDown, Search, Plus, Pencil } from 'lucide-react';
```
```tsx
import { RenameTypeDialog } from './RenameTypeDialog';
import { localizationService } from '@/api/services/localization';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { digitClient } from '@/providers/bridge';
```

(b) Inside the component, after `const notify = useNotify();`, add the locales hook + handler:

```tsx
  const { locales } = useAvailableLocales();

  const handleRenameType = async (menuPath: string, newName: string) => {
    const tenantId = digitClient.stateTenantId;
    if (!tenantId) return;
    // The type's display name is localization-only: upsert SERVICEDEFS.<CODE>
    // for every configured locale, then cache-bust so the list re-reads it.
    // The menuPath code itself is never modified.
    const code = `SERVICEDEFS.${menuPath.toUpperCase()}`;
    const targetLocales = new Set<string>([...locales.map((l) => l.value), 'en_IN']);
    for (const locale of targetLocales) {
      await localizationService.upsertMessages(tenantId, locale, [
        { code, message: newName, module: 'rainmaker-pgr', locale },
      ]);
    }
    await localizationService.cacheBust();
    notify('Complaint type renamed', { type: 'info' });
    await refetch();
  };
```

(c) The type label cell — replace:

```tsx
                    <span
                      className={`min-w-0 break-words font-semibold ${
                        g.isUncategorized ? 'text-muted-foreground' : ''
                      }`}
                    >
                      {g.label}
                    </span>
```

with a label + pencil:

```tsx
                    <span
                      className={`min-w-0 flex items-center gap-1 font-semibold ${
                        g.isUncategorized ? 'text-muted-foreground' : ''
                      }`}
                    >
                      <span className="truncate">{g.label}</span>
                      {!g.isUncategorized && (
                        <RenameTypeDialog
                          currentName={g.label}
                          onRename={(newName) => handleRenameType(g.menuPath, newName)}
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Rename ${g.label}`}
                              className="h-6 w-6 p-0 flex-shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                      )}
                    </span>
```

- [ ] **Step 4: Run, confirm PASS**

Run: `npx vitest run src/resources/complaint-types/ComplaintTypeList.test.tsx`
Expected: PASS (all list tests, incl. the three new ones).

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add src/resources/complaint-types/ComplaintTypeList.tsx src/resources/complaint-types/ComplaintTypeList.test.tsx
git commit -m "feat(complaint-types): rename a complaint type's display name via localization"
```

---

### Task 3: Verify + build + push

**Files:** none (verification only)

- [ ] **Step 1: Full checks**

```bash
npx tsc --noEmit
npx eslint src/resources/complaint-types/ComplaintTypeList.tsx src/resources/complaint-types/RenameTypeDialog.tsx
npx vitest run
```
Expected: tsc clean; eslint clean on these files; all tests pass.

- [ ] **Step 2: Production build (no complaint-types regressions)**

Run: `npm run build` — then `npm run build 2>&1 | grep -i "complaint-types"` must be empty (other pre-existing unrelated build errors are acceptable).

- [ ] **Step 3: Manual verification (dev server)**

Run: `npm run dev`. Then:
1. On `/manage/complaint-types`, click the pencil on a type row → dialog opens with the current name prefilled.
2. Change the name, Save → the row's label updates (after refetch), "Complaint type renamed" toast shows, sub-types unchanged.
3. Confirm the pencil click did NOT expand/collapse the type.
4. Confirm the **Uncategorized** group has no pencil.

- [ ] **Step 4: Push**

```bash
git push egov feature/complaint-types-accordion
```
(Updates PR #899.)

---

## Done after this increment
All five complaint-type increments (accordion view, add sub-type, edit/delete sub-type, create type, edit type) are complete. Out of scope per spec: hard delete, delete-type, menuPath code rename.
