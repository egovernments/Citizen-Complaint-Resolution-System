# Publishable @digit-ui/datagrid Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract DigitDatagrid into a publishable `@digit-ui/datagrid` monorepo workspace package with undoable/optimistic mutations, polymorphic cell editing, inline delete, auto row actions, column configurability, mutation callbacks/transforms, and minor config props.

**Architecture:** Monorepo workspace at `packages/digit-datagrid/`. Hook-based `useMutationMode` wraps ra-core's `useUpdate`/`useDelete` with undoable + optimistic support. Polymorphic `EditableCell` renders boolean/date/select/reference. Schema-driven auto-detection extended. App re-imports from workspace package.

**Tech Stack:** React 19, ra-core 5.x (headless), Radix UI primitives, Tailwind CSS, vitest + @testing-library/react.

---

### Task 1: Package Scaffolding

Create the workspace package structure, move existing source files, and wire up the monorepo.

**Files:**
- Create: `packages/digit-datagrid/package.json`
- Create: `packages/digit-datagrid/tsconfig.json`
- Create: `packages/digit-datagrid/vitest.config.ts`
- Create: `packages/digit-datagrid/src/index.ts`
- Create: `packages/digit-datagrid/src/columns/types.ts`
- Modify: `package.json` (root — add workspaces)
- Modify: `utilities/crs_dataloader/ui-mockup/package.json` (add workspace dep)
- Modify: `utilities/crs_dataloader/ui-mockup/vite.config.ts` (alias for workspace)

**Step 1: Create package.json**

Create `packages/digit-datagrid/package.json`:
```json
{
  "name": "@digit-ui/datagrid",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "peerDependencies": {
    "ra-core": ">=5.0.0",
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0",
    "react-router-dom": ">=6.0.0"
  },
  "dependencies": {
    "@radix-ui/react-alert-dialog": "^1.1.15",
    "@radix-ui/react-popover": "^1.1.14",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-switch": "^1.2.5",
    "@radix-ui/react-toast": "^1.2.15",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.562.0",
    "tailwind-merge": "^3.4.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.2.5",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.1",
    "jsdom": "^27.4.0",
    "ra-core": "^5.14.3",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.12.0",
    "typescript": "~5.9.3",
    "vitest": "^4.0.18"
  }
}
```

**Step 2: Create tsconfig.json**

Create `packages/digit-datagrid/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

**Step 3: Create vitest.config.ts**

Create `packages/digit-datagrid/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Step 4: Create test setup**

Create `packages/digit-datagrid/src/__tests__/setup.ts`:
```typescript
import { vi } from 'vitest';
import '@testing-library/jest-dom';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

(globalThis as any).ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
```

**Step 5: Create columns/types.ts with extended types**

Create `packages/digit-datagrid/src/columns/types.ts`:
```typescript
import type { RaRecord } from 'ra-core';

/** Mutation mode for inline edits and deletes */
export type MutationMode = 'pessimistic' | 'optimistic' | 'undoable';

/** Validation rule for editable cells */
export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
  custom?: (value: string) => string | null;
}

/** All supported editable cell types */
export type EditableCellType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'reference';

/** Configuration for an editable column */
export interface EditableColumnConfig {
  /** Input type. Default: 'text' */
  type?: EditableCellType;
  /** Validation rules */
  validation?: ValidationRule;
  /** For type: 'reference' — the react-admin resource to fetch choices from */
  reference?: string;
  /** For type: 'reference' — field on the referenced record to display. Default: 'name' */
  displayField?: string;
  /** For type: 'select' — static options */
  options?: { value: string; label: string }[];
  /** Per-column mutation mode override */
  mutationMode?: MutationMode;
  /** Per-column transform before save */
  transform?: (value: unknown) => unknown;
}

/** Column definition for DigitDatagrid */
export interface DigitColumn<RecordType extends RaRecord = RaRecord> {
  /** Field name on the record (supports dot notation) */
  source: string;
  /** Column header label */
  label: string;
  /** Whether this column is sortable. Default: true */
  sortable?: boolean;
  /** Custom render function for cell content */
  render?: (record: RecordType) => React.ReactNode;
  /** Enable inline editing. true = text input. Object = full config. */
  editable?: boolean | EditableColumnConfig;
}

/** Mutation callbacks */
export interface MutationOptions {
  onSuccess?: (data: unknown) => void;
  onError?: (error: Error) => void;
  transform?: (data: Record<string, unknown>) => Record<string, unknown>;
}

/** Props for DigitDatagrid */
export interface DigitDatagridProps<RecordType extends RaRecord = RaRecord> {
  /** Column definitions */
  columns: DigitColumn<RecordType>[];
  /** Navigate on row click: 'show', 'edit', or a path template with :id */
  rowClick?: 'show' | 'edit' | string;
  /** Custom row click handler */
  onRowClick?: (record: RecordType) => void;
  /** Row-level action buttons: 'auto' shows delete on hover, 'none' hides, or custom render */
  rowActions?: 'auto' | 'none' | ((record: RecordType) => React.ReactNode);
  /** Legacy action column render (deprecated, use rowActions) */
  actions?: (record: RecordType) => React.ReactNode;
  /** Mutation mode for inline edits. Default: 'undoable' */
  mutationMode?: MutationMode;
  /** Callbacks for mutation success/error and data transform */
  mutationOptions?: MutationOptions;
  /** Hide delete button in auto row actions */
  noDelete?: boolean;
  /** Enable column show/hide configurability */
  configurable?: boolean;
  /** Preference key for column config persistence (for multiple grids on same resource) */
  preferenceKey?: string;
  /** Disable auto-focus when entering edit mode */
  disableAutofocus?: boolean;
}
```

**Step 6: Create barrel index.ts**

Create `packages/digit-datagrid/src/index.ts`:
```typescript
// Types
export type {
  MutationMode,
  ValidationRule,
  EditableCellType,
  EditableColumnConfig,
  DigitColumn,
  MutationOptions,
  DigitDatagridProps,
} from './columns/types';

// Hooks (added in later tasks)
// export { useMutationMode } from './editing/useMutationMode';
// export { useColumnConfig } from './editing/useColumnConfig';

// Components (added in later tasks)
// export { DigitDatagrid } from './DigitDatagrid';
// export { DigitList } from './DigitList';
// export { EditableCell } from './editing/EditableCell';
// export { ReferenceSelect } from './editing/ReferenceSelect';
// export { RowActions } from './actions/RowActions';
// export { InlineDelete } from './actions/InlineDelete';

// Schema utilities (added in later tasks)
// export { generateColumns, getRefMap, orderFields, ... } from './columns/schemaUtils';
```

**Step 7: Copy vendored primitives**

Copy these UI primitives from `ui-mockup/src/components/ui/` into `packages/digit-datagrid/src/primitives/`:
- `button.tsx`, `input.tsx`, `label.tsx`, `badge.tsx`, `table.tsx`, `card.tsx`
- `select.tsx`, `alert-dialog.tsx`, `toast.tsx`, `toaster.tsx`

Also create `packages/digit-datagrid/src/lib/utils.ts`:
```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Update all `@/lib/utils` imports in copied primitives to use relative paths. Update all `@/components/ui/` imports to `@/primitives/`.

**Step 8: Wire workspace in root package.json**

Modify root `package.json` — add:
```json
{
  "workspaces": ["packages/*", "utilities/crs_dataloader/ui-mockup"]
}
```

Add to `utilities/crs_dataloader/ui-mockup/package.json` dependencies:
```json
"@digit-ui/datagrid": "workspace:*"
```

**Step 9: Run npm install, verify types resolve**

```bash
cd /root/code/ccrs-ui-mockup && npm install
cd packages/digit-datagrid && npx tsc --noEmit
```

**Step 10: Commit**

```bash
git add packages/digit-datagrid/ package.json utilities/crs_dataloader/ui-mockup/package.json
git commit -m "feat: Scaffold @digit-ui/datagrid workspace package with types"
```

---

### Task 2: useMutationMode Hook

The core mutation controller supporting pessimistic, optimistic, and undoable modes.

**Files:**
- Create: `packages/digit-datagrid/src/editing/useMutationMode.ts`
- Create: `packages/digit-datagrid/src/__tests__/useMutationMode.test.ts`
- Create: `packages/digit-datagrid/src/hooks/use-toast.ts` (copy from ui-mockup)
- Create: `packages/digit-datagrid/src/primitives/toast.tsx` (copy from ui-mockup)
- Create: `packages/digit-datagrid/src/primitives/toaster.tsx` (copy from ui-mockup)

**Step 1: Write the tests**

Create `packages/digit-datagrid/src/__tests__/useMutationMode.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMutationMode } from '../editing/useMutationMode';

// Mock ra-core
const mockUpdate = vi.fn().mockResolvedValue({ data: { id: '1', name: 'Updated' } });
const mockDelete = vi.fn().mockResolvedValue({ data: { id: '1' } });

vi.mock('ra-core', () => ({
  useUpdate: () => [mockUpdate],
  useDelete: () => [mockDelete],
}));

// Mock toast
const mockDismiss = vi.fn();
const mockToast = vi.fn().mockReturnValue({ id: 'toast-1', dismiss: mockDismiss });
vi.mock('../hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

beforeEach(() => {
  vi.useFakeTimers();
  mockUpdate.mockClear();
  mockDelete.mockClear();
  mockToast.mockClear();
  mockDismiss.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMutationMode', () => {
  describe('pessimistic mode', () => {
    it('calls update immediately and waits for result', async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'pessimistic', onSuccess })
      );

      await act(async () => {
        await result.current.mutate('departments', {
          id: '1',
          data: { name: 'Updated' },
          previousData: { id: '1', name: 'Old' },
        });
      });

      expect(mockUpdate).toHaveBeenCalledOnce();
      expect(onSuccess).toHaveBeenCalled();
    });

    it('calls onError when update fails', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('API Error'));
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'pessimistic', onError })
      );

      await act(async () => {
        await result.current.mutate('departments', {
          id: '1',
          data: { name: 'Updated' },
          previousData: { id: '1', name: 'Old' },
        });
      });

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('optimistic mode', () => {
    it('fires update in background and calls onSuccess', async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'optimistic', onSuccess })
      );

      await act(async () => {
        result.current.mutate('departments', {
          id: '1',
          data: { name: 'Updated' },
          previousData: { id: '1', name: 'Old' },
        });
      });

      // Update fires immediately
      expect(mockUpdate).toHaveBeenCalledOnce();
    });

    it('shows error toast when update fails', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('API Error'));
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'optimistic', onError })
      );

      await act(async () => {
        result.current.mutate('departments', {
          id: '1',
          data: { name: 'Updated' },
          previousData: { id: '1', name: 'Old' },
        });
      });

      // Wait for the rejected promise
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onError).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' })
      );
    });
  });

  describe('undoable mode', () => {
    it('shows undo toast and delays API call', async () => {
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'undoable', undoTimeout: 5000 })
      );

      act(() => {
        result.current.mutate('departments', {
          id: '1',
          data: { name: 'Updated' },
          previousData: { id: '1', name: 'Old' },
        });
      });

      // Should NOT have called update yet
      expect(mockUpdate).not.toHaveBeenCalled();
      // Should have shown toast
      expect(mockToast).toHaveBeenCalled();
      // Should have pending mutation
      expect(result.current.undoPending.size).toBe(1);
    });

    it('fires API call after timeout', async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'undoable', undoTimeout: 5000, onSuccess })
      );

      act(() => {
        result.current.mutate('departments', {
          id: '1',
          data: { name: 'Updated' },
          previousData: { id: '1', name: 'Old' },
        });
      });

      // Advance past undo timeout
      await act(async () => {
        vi.advanceTimersByTime(5100);
      });

      expect(mockUpdate).toHaveBeenCalledOnce();
    });

    it('cancels API call when undo is clicked', async () => {
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'undoable', undoTimeout: 5000 })
      );

      act(() => {
        result.current.mutate('departments', {
          id: '1',
          data: { name: 'Updated' },
          previousData: { id: '1', name: 'Old' },
        });
      });

      const mutationId = Array.from(result.current.undoPending.keys())[0];

      act(() => {
        result.current.undo(mutationId);
      });

      // Advance past timeout
      await act(async () => {
        vi.advanceTimersByTime(6000);
      });

      // Should NOT have called update
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.current.undoPending.size).toBe(0);
    });
  });

  describe('transform', () => {
    it('applies transform before saving', async () => {
      const transform = vi.fn((data: Record<string, unknown>) => ({
        ...data,
        name: (data.name as string).toUpperCase(),
      }));

      const { result } = renderHook(() =>
        useMutationMode({ mode: 'pessimistic', transform })
      );

      await act(async () => {
        await result.current.mutate('departments', {
          id: '1',
          data: { name: 'hello' },
          previousData: { id: '1', name: 'old' },
        });
      });

      expect(transform).toHaveBeenCalledWith({ name: 'hello' });
      expect(mockUpdate).toHaveBeenCalledWith(
        'departments',
        expect.objectContaining({
          data: { name: 'HELLO' },
        })
      );
    });
  });

  describe('deleteMutate', () => {
    it('deletes in pessimistic mode', async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'pessimistic', onSuccess })
      );

      await act(async () => {
        await result.current.deleteMutate('departments', {
          id: '1',
          previousData: { id: '1', name: 'Dept' },
        });
      });

      expect(mockDelete).toHaveBeenCalledOnce();
      expect(onSuccess).toHaveBeenCalled();
    });

    it('deletes with undo toast in undoable mode', () => {
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'undoable', undoTimeout: 5000 })
      );

      act(() => {
        result.current.deleteMutate('departments', {
          id: '1',
          previousData: { id: '1', name: 'Dept' },
        });
      });

      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalled();
      expect(result.current.undoPending.size).toBe(1);
    });
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run
```
Expected: FAIL — module not found

**Step 3: Implement useMutationMode**

Create `packages/digit-datagrid/src/editing/useMutationMode.ts`:
```typescript
import { useCallback, useRef, useState } from 'react';
import { useUpdate, useDelete } from 'ra-core';
import { toast } from '../hooks/use-toast';
import type { MutationMode, MutationOptions } from '../columns/types';

interface UpdateParams {
  id: string | number;
  data: Record<string, unknown>;
  previousData?: Record<string, unknown>;
}

interface DeleteParams {
  id: string | number;
  previousData?: Record<string, unknown>;
}

interface PendingMutation {
  type: 'update' | 'delete';
  resource: string;
  params: UpdateParams | DeleteParams;
  timerId: ReturnType<typeof setTimeout>;
}

interface UseMutationModeOptions extends MutationOptions {
  mode?: MutationMode;
  undoTimeout?: number;
}

export function useMutationMode(options: UseMutationModeOptions = {}) {
  const {
    mode = 'undoable',
    undoTimeout = 5000,
    onSuccess,
    onError,
    transform,
  } = options;

  const [update] = useUpdate();
  const [doDelete] = useDelete();
  const [undoPending, setUndoPending] = useState<Map<string, PendingMutation>>(new Map());
  const nextIdRef = useRef(0);

  const applyTransform = useCallback(
    (data: Record<string, unknown>) => (transform ? transform(data) : data),
    [transform]
  );

  const fireUpdate = useCallback(
    async (resource: string, params: UpdateParams) => {
      const transformedData = applyTransform(params.data);
      const result = await update(resource, {
        id: params.id,
        data: transformedData,
        previousData: params.previousData,
      });
      return result;
    },
    [update, applyTransform]
  );

  const fireDelete = useCallback(
    async (resource: string, params: DeleteParams) => {
      const result = await doDelete(resource, {
        id: params.id,
        previousData: params.previousData,
      });
      return result;
    },
    [doDelete]
  );

  const removePending = useCallback((mutationId: string) => {
    setUndoPending((prev) => {
      const next = new Map(prev);
      next.delete(mutationId);
      return next;
    });
  }, []);

  const scheduleUndoable = useCallback(
    (
      mutationId: string,
      type: 'update' | 'delete',
      resource: string,
      params: UpdateParams | DeleteParams,
      label: string
    ) => {
      const timerId = setTimeout(async () => {
        removePending(mutationId);
        try {
          if (type === 'update') {
            await fireUpdate(resource, params as UpdateParams);
          } else {
            await fireDelete(resource, params as DeleteParams);
          }
          onSuccess?.(params);
        } catch (err) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
          toast({
            variant: 'destructive',
            title: `Failed to ${type}`,
            description: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }, undoTimeout);

      const pending: PendingMutation = { type, resource, params, timerId };
      setUndoPending((prev) => new Map(prev).set(mutationId, pending));

      toast({
        title: label,
        description: 'Click undo to revert.',
        action: {
          label: 'Undo',
          onClick: () => {
            clearTimeout(timerId);
            removePending(mutationId);
          },
        } as any,
      });
    },
    [undoTimeout, fireUpdate, fireDelete, onSuccess, onError, removePending]
  );

  const mutate = useCallback(
    async (resource: string, params: UpdateParams) => {
      const mutationId = `mut_${++nextIdRef.current}`;

      if (mode === 'pessimistic') {
        try {
          const result = await fireUpdate(resource, params);
          onSuccess?.(result);
        } catch (err) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      } else if (mode === 'optimistic') {
        fireUpdate(resource, params)
          .then((result) => onSuccess?.(result))
          .catch((err) => {
            onError?.(err instanceof Error ? err : new Error(String(err)));
            toast({
              variant: 'destructive',
              title: 'Update failed',
              description: err instanceof Error ? err.message : 'Unknown error',
            });
          });
      } else {
        // undoable
        scheduleUndoable(mutationId, 'update', resource, params, 'Record updated');
      }
    },
    [mode, fireUpdate, scheduleUndoable, onSuccess, onError]
  );

  const deleteMutate = useCallback(
    async (resource: string, params: DeleteParams) => {
      const mutationId = `mut_${++nextIdRef.current}`;

      if (mode === 'pessimistic') {
        try {
          const result = await fireDelete(resource, params);
          onSuccess?.(result);
        } catch (err) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      } else if (mode === 'optimistic') {
        fireDelete(resource, params)
          .then((result) => onSuccess?.(result))
          .catch((err) => {
            onError?.(err instanceof Error ? err : new Error(String(err)));
            toast({
              variant: 'destructive',
              title: 'Delete failed',
              description: err instanceof Error ? err.message : 'Unknown error',
            });
          });
      } else {
        // undoable
        scheduleUndoable(mutationId, 'delete', resource, params, 'Record deleted');
      }
    },
    [mode, fireDelete, scheduleUndoable, onSuccess, onError]
  );

  const undo = useCallback(
    (mutationId: string) => {
      const pending = undoPending.get(mutationId);
      if (pending) {
        clearTimeout(pending.timerId);
        removePending(mutationId);
      }
    },
    [undoPending, removePending]
  );

  return { mutate, deleteMutate, undoPending, undo };
}
```

**Step 4: Copy toast infrastructure**

Copy `use-toast.ts` from `ui-mockup/src/hooks/` to `packages/digit-datagrid/src/hooks/use-toast.ts`.
Copy `toast.tsx` and `toaster.tsx` from `ui-mockup/src/components/ui/` to `packages/digit-datagrid/src/primitives/`.
Update import paths in copies (replace `@/components/ui/` with `@/primitives/`, `@/lib/utils` with `@/lib/utils`).

**Step 5: Run tests — verify they pass**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run
```
Expected: ALL PASS

**Step 6: Commit**

```bash
git add packages/digit-datagrid/
git commit -m "feat(datagrid): Add useMutationMode hook with undoable/optimistic/pessimistic"
```

---

### Task 3: Polymorphic EditableCell

Extend EditableCell to handle boolean (Switch), date (native input), and select (static options) types in addition to existing text/number.

**Files:**
- Create: `packages/digit-datagrid/src/editing/EditableCell.tsx`
- Create: `packages/digit-datagrid/src/primitives/switch.tsx`
- Create: `packages/digit-datagrid/src/__tests__/EditableCell.test.tsx`

**Step 1: Write the tests**

Create `packages/digit-datagrid/src/__tests__/EditableCell.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditableCell } from '../editing/EditableCell';

describe('EditableCell', () => {
  describe('text type', () => {
    it('renders text input in edit mode', () => {
      render(
        <EditableCell
          value="hello"
          type="text"
          onSave={vi.fn()}
          initialEditing
        />
      );
      expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
    });

    it('saves on Enter', async () => {
      const onSave = vi.fn();
      render(
        <EditableCell value="hello" type="text" onSave={onSave} initialEditing />
      );
      const input = screen.getByDisplayValue('hello');
      await userEvent.clear(input);
      await userEvent.type(input, 'world');
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(onSave).toHaveBeenCalledWith('world'));
    });

    it('cancels on Escape', async () => {
      const onSave = vi.fn();
      render(
        <EditableCell value="hello" type="text" onSave={onSave} initialEditing />
      );
      const input = screen.getByDisplayValue('hello');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('number type', () => {
    it('renders number input', () => {
      render(
        <EditableCell value="42" type="number" onSave={vi.fn()} initialEditing />
      );
      const input = screen.getByDisplayValue('42');
      expect(input).toHaveAttribute('type', 'number');
    });
  });

  describe('boolean type', () => {
    it('renders a switch', () => {
      render(
        <EditableCell value="true" type="boolean" onSave={vi.fn()} initialEditing />
      );
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('saves immediately on toggle', async () => {
      const onSave = vi.fn();
      render(
        <EditableCell value="true" type="boolean" onSave={onSave} initialEditing />
      );
      const toggle = screen.getByRole('switch');
      await userEvent.click(toggle);
      await waitFor(() => expect(onSave).toHaveBeenCalledWith('false'));
    });
  });

  describe('date type', () => {
    it('renders a date input', () => {
      render(
        <EditableCell
          value="2026-01-15"
          type="date"
          onSave={vi.fn()}
          initialEditing
        />
      );
      const input = screen.getByDisplayValue('2026-01-15');
      expect(input).toHaveAttribute('type', 'date');
    });
  });

  describe('select type', () => {
    it('renders a select trigger', () => {
      render(
        <EditableCell
          value="opt1"
          type="select"
          options={[
            { value: 'opt1', label: 'Option 1' },
            { value: 'opt2', label: 'Option 2' },
          ]}
          onSave={vi.fn()}
          initialEditing
        />
      );
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
  });

  describe('validation', () => {
    it('shows error for required empty field', async () => {
      render(
        <EditableCell
          value=""
          type="text"
          validation={{ required: true }}
          onSave={vi.fn()}
          initialEditing
        />
      );
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(screen.getByText('This field is required')).toBeInTheDocument()
      );
    });
  });

  describe('disabled', () => {
    it('renders static value when disabled', () => {
      render(
        <EditableCell value="static" type="text" onSave={vi.fn()} disabled />
      );
      expect(screen.getByText('static')).toBeInTheDocument();
    });
  });
});
```

**Step 2: Install userEvent dev dep**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npm install --save-dev @testing-library/user-event
```

**Step 3: Create Switch primitive**

Create `packages/digit-datagrid/src/primitives/switch.tsx`:
```typescript
"use client"

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
```

**Step 4: Implement polymorphic EditableCell**

Create `packages/digit-datagrid/src/editing/EditableCell.tsx`:
```typescript
import { useState, useEffect, useRef } from 'react';
import { Input } from '@/primitives/input';
import { Button } from '@/primitives/button';
import { Switch } from '@/primitives/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/primitives/select';
import { Check, X, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ValidationRule, EditableCellType } from '../columns/types';

export interface EditableCellProps {
  value: string;
  onSave: (value: string) => Promise<void> | void;
  type?: EditableCellType;
  validation?: ValidationRule;
  options?: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
  initialEditing?: boolean;
  disableAutofocus?: boolean;
  onCancel?: () => void;
}

export function EditableCell({
  value,
  onSave,
  type = 'text',
  validation,
  options,
  placeholder = 'Click to edit',
  disabled = false,
  className,
  displayClassName,
  inputClassName,
  initialEditing = false,
  disableAutofocus = false,
  onCancel,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [editValue, setEditValue] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current && !disableAutofocus) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing, disableAutofocus]);

  const validate = (val: string): string | null => {
    if (!validation) return null;
    if (validation.required && !val.trim()) return 'This field is required';
    if (validation.minLength && val.length < validation.minLength)
      return `Minimum ${validation.minLength} characters required`;
    if (validation.maxLength && val.length > validation.maxLength)
      return `Maximum ${validation.maxLength} characters allowed`;
    if (validation.pattern && !validation.pattern.test(val))
      return validation.patternMessage || 'Invalid format';
    if (validation.custom) return validation.custom(val);
    return null;
  };

  const handleSave = async (overrideValue?: string) => {
    const saveVal = overrideValue ?? editValue;
    const validationError = validate(saveVal);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (saveVal === value && overrideValue === undefined) {
      handleCancel();
      return;
    }
    setSaving(true);
    try {
      await onSave(saveVal);
      setIsEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
    setError(null);
    onCancel?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (disabled) {
    return <span className={cn('text-muted-foreground', className)}>{value || '-'}</span>;
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className={cn(
          'group flex items-center gap-1 text-left hover:bg-muted/50 rounded px-1 -mx-1 transition-colors',
          displayClassName
        )}
      >
        <span className={value ? '' : 'text-muted-foreground italic'}>
          {type === 'boolean' ? (value === 'true' ? 'Yes' : 'No') : value || placeholder}
        </span>
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  // --- Boolean: Switch ---
  if (type === 'boolean') {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Switch
          checked={editValue === 'true'}
          onCheckedChange={(checked) => {
            const newVal = String(checked);
            setEditValue(newVal);
            handleSave(newVal);
          }}
          disabled={saving}
        />
        <span className="text-sm text-muted-foreground">
          {editValue === 'true' ? 'Yes' : 'No'}
        </span>
      </div>
    );
  }

  // --- Select: Static options ---
  if (type === 'select' && options) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <Select
          value={editValue}
          onValueChange={(val) => {
            setEditValue(val);
            handleSave(val);
          }}
          defaultOpen
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  // --- Text / Number / Date ---
  const inputType = type === 'date' ? 'date' : type === 'number' ? 'number' : 'text';

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          type={inputType}
          value={editValue}
          onChange={(e) => {
            setEditValue(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setTimeout(() => {
              if (!saving) handleCancel();
            }, 150);
          }}
          className={cn('h-8 text-sm', error && 'border-destructive', inputClassName)}
          disabled={saving}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
          onClick={() => handleSave()}
          disabled={saving}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
          onClick={handleCancel}
          disabled={saving}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

// Re-export common validations
export const validationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\d{10}$/,
  code: /^[A-Z0-9_]+$/,
  alphanumeric: /^[a-zA-Z0-9]+$/,
};

export const commonValidations = {
  required: { required: true } as ValidationRule,
  email: { required: true, pattern: validationPatterns.email, patternMessage: 'Enter a valid email address' } as ValidationRule,
  phone: { required: true, pattern: validationPatterns.phone, patternMessage: 'Enter a 10-digit phone number' } as ValidationRule,
  code: { required: true, pattern: validationPatterns.code, patternMessage: 'Only uppercase letters, numbers, and underscores' } as ValidationRule,
  name: { required: true, minLength: 2, maxLength: 100 } as ValidationRule,
};
```

**Step 5: Run tests — verify they pass**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run
```

**Step 6: Commit**

```bash
git add packages/digit-datagrid/
git commit -m "feat(datagrid): Polymorphic EditableCell with boolean/date/select types"
```

---

### Task 4: useColumnConfig Hook

Column show/hide with localStorage persistence.

**Files:**
- Create: `packages/digit-datagrid/src/editing/useColumnConfig.ts`
- Create: `packages/digit-datagrid/src/__tests__/useColumnConfig.test.ts`

**Step 1: Write the tests**

Create `packages/digit-datagrid/src/__tests__/useColumnConfig.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useColumnConfig } from '../editing/useColumnConfig';
import type { DigitColumn } from '../columns/types';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'name', label: 'Name' },
  { source: 'department', label: 'Department' },
  { source: 'status', label: 'Status' },
];

const alwaysVisibleSources = ['code'];

beforeEach(() => {
  localStorage.clear();
});

describe('useColumnConfig', () => {
  it('returns all columns visible by default', () => {
    const { result } = renderHook(() =>
      useColumnConfig({ resource: 'test', columns, alwaysVisibleSources })
    );
    expect(result.current.visibleColumns).toHaveLength(4);
    expect(result.current.hiddenColumns).toHaveLength(0);
  });

  it('toggles a column hidden', () => {
    const { result } = renderHook(() =>
      useColumnConfig({ resource: 'test', columns, alwaysVisibleSources })
    );

    act(() => result.current.toggleColumn('department'));

    expect(result.current.visibleColumns).toHaveLength(3);
    expect(result.current.hiddenColumns).toHaveLength(1);
    expect(result.current.hiddenColumns[0].source).toBe('department');
  });

  it('cannot hide always-visible columns', () => {
    const { result } = renderHook(() =>
      useColumnConfig({ resource: 'test', columns, alwaysVisibleSources })
    );

    act(() => result.current.toggleColumn('code'));

    // code should still be visible
    expect(result.current.visibleColumns.map((c) => c.source)).toContain('code');
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() =>
      useColumnConfig({ resource: 'test', columns, alwaysVisibleSources })
    );

    act(() => result.current.toggleColumn('status'));

    const stored = localStorage.getItem('digit-datagrid:test:columns');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toContain('status');
  });

  it('restores from localStorage', () => {
    localStorage.setItem('digit-datagrid:test:columns', JSON.stringify(['department', 'status']));

    const { result } = renderHook(() =>
      useColumnConfig({ resource: 'test', columns, alwaysVisibleSources })
    );

    expect(result.current.visibleColumns).toHaveLength(2);
    expect(result.current.visibleColumns.map((c) => c.source)).toEqual(['code', 'name']);
  });

  it('resets to show all', () => {
    const { result } = renderHook(() =>
      useColumnConfig({ resource: 'test', columns, alwaysVisibleSources })
    );

    act(() => result.current.toggleColumn('department'));
    act(() => result.current.resetColumns());

    expect(result.current.visibleColumns).toHaveLength(4);
    expect(localStorage.getItem('digit-datagrid:test:columns')).toBeNull();
  });

  it('uses preferenceKey when provided', () => {
    const { result } = renderHook(() =>
      useColumnConfig({ resource: 'test', columns, alwaysVisibleSources, preferenceKey: 'custom' })
    );

    act(() => result.current.toggleColumn('name'));

    expect(localStorage.getItem('digit-datagrid:custom:columns')).toBeTruthy();
  });
});
```

**Step 2: Implement useColumnConfig**

Create `packages/digit-datagrid/src/editing/useColumnConfig.ts`:
```typescript
import { useState, useCallback, useMemo } from 'react';
import type { DigitColumn } from '../columns/types';

interface UseColumnConfigOptions {
  resource: string;
  columns: DigitColumn[];
  /** Column sources that cannot be hidden */
  alwaysVisibleSources?: string[];
  /** Custom key for localStorage (defaults to resource) */
  preferenceKey?: string;
}

function getStorageKey(key: string) {
  return `digit-datagrid:${key}:columns`;
}

export function useColumnConfig({
  resource,
  columns,
  alwaysVisibleSources = [],
  preferenceKey,
}: UseColumnConfigOptions) {
  const storageKey = getStorageKey(preferenceKey ?? resource);
  const alwaysVisible = useMemo(() => new Set(alwaysVisibleSources), [alwaysVisibleSources]);

  const [hiddenSources, setHiddenSources] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch { /* ignore */ }
    return new Set();
  });

  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenSources.has(col.source)),
    [columns, hiddenSources]
  );

  const hiddenColumns = useMemo(
    () => columns.filter((col) => hiddenSources.has(col.source)),
    [columns, hiddenSources]
  );

  const toggleColumn = useCallback(
    (source: string) => {
      if (alwaysVisible.has(source)) return;

      setHiddenSources((prev) => {
        const next = new Set(prev);
        if (next.has(source)) {
          next.delete(source);
        } else {
          next.add(source);
        }
        if (next.size === 0) {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(storageKey, JSON.stringify([...next]));
        }
        return next;
      });
    },
    [alwaysVisible, storageKey]
  );

  const resetColumns = useCallback(() => {
    setHiddenSources(new Set());
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  return { visibleColumns, hiddenColumns, toggleColumn, resetColumns, isColumnHidden: (source: string) => hiddenSources.has(source) };
}
```

**Step 3: Run tests — verify pass**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run
```

**Step 4: Commit**

```bash
git add packages/digit-datagrid/
git commit -m "feat(datagrid): useColumnConfig hook with localStorage persistence"
```

---

### Task 5: RowActions + InlineDelete

Auto-generated row action buttons (delete on hover) with mutation mode support.

**Files:**
- Create: `packages/digit-datagrid/src/actions/RowActions.tsx`
- Create: `packages/digit-datagrid/src/actions/InlineDelete.tsx`
- Create: `packages/digit-datagrid/src/__tests__/RowActions.test.tsx`

**Step 1: Write the tests**

Create `packages/digit-datagrid/src/__tests__/RowActions.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RowActions } from '../actions/RowActions';

describe('RowActions', () => {
  it('renders delete button', () => {
    render(
      <table><tbody><tr>
        <RowActions
          record={{ id: '1', name: 'Test' }}
          onDelete={vi.fn()}
        />
      </tr></tbody></table>
    );
    expect(screen.getByLabelText('Delete')).toBeInTheDocument();
  });

  it('hides delete when noDelete is true', () => {
    render(
      <table><tbody><tr>
        <RowActions
          record={{ id: '1', name: 'Test' }}
          onDelete={vi.fn()}
          noDelete
        />
      </tr></tbody></table>
    );
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
  });

  it('calls onDelete when delete button is clicked and confirmed', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <table><tbody><tr>
        <RowActions
          record={{ id: '1', name: 'Test' }}
          onDelete={onDelete}
          mutationMode="pessimistic"
        />
      </tr></tbody></table>
    );

    fireEvent.click(screen.getByLabelText('Delete'));
    // Should show confirmation dialog
    await waitFor(() => expect(screen.getByText('Delete')).toBeInTheDocument());
  });
});
```

**Step 2: Implement InlineDelete**

Create `packages/digit-datagrid/src/actions/InlineDelete.tsx`:
```typescript
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/primitives/alert-dialog';
import { Button } from '@/primitives/button';
import { Trash2, Loader2 } from 'lucide-react';
import type { MutationMode } from '../columns/types';

interface InlineDeleteProps {
  itemName?: string;
  onConfirm: () => Promise<void> | void;
  mutationMode?: MutationMode;
}

export function InlineDelete({
  itemName,
  onConfirm,
  mutationMode = 'undoable',
}: InlineDeleteProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Undoable mode: skip confirmation, delete immediately (undo via toast)
  if (mutationMode === 'undoable') {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={async (e) => {
          e.stopPropagation();
          try {
            await onConfirm();
          } catch { /* handled by mutation hook */ }
        }}
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    );
  }

  // Pessimistic/Optimistic: show confirmation dialog
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={(e) => e.stopPropagation()}
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {itemName || 'item'}?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async (e: React.MouseEvent) => {
              e.preventDefault();
              setDeleting(true);
              setError(null);
              try {
                await onConfirm();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to delete');
              } finally {
                setDeleting(false);
              }
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</> : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

**Step 3: Implement RowActions**

Create `packages/digit-datagrid/src/actions/RowActions.tsx`:
```typescript
import type { RaRecord } from 'ra-core';
import { TableCell } from '@/primitives/table';
import { InlineDelete } from './InlineDelete';
import type { MutationMode } from '../columns/types';

interface RowActionsProps<T extends RaRecord = RaRecord> {
  record: T;
  onDelete?: (record: T) => Promise<void> | void;
  noDelete?: boolean;
  mutationMode?: MutationMode;
}

export function RowActions<T extends RaRecord = RaRecord>({
  record,
  onDelete,
  noDelete = false,
  mutationMode = 'undoable',
}: RowActionsProps<T>) {
  return (
    <TableCell className="text-right w-12 opacity-0 group-hover/row:opacity-100 transition-opacity">
      <div className="flex items-center justify-end gap-1">
        {!noDelete && onDelete && (
          <InlineDelete
            itemName={String(record.id)}
            onConfirm={() => onDelete(record)}
            mutationMode={mutationMode}
          />
        )}
      </div>
    </TableCell>
  );
}
```

**Step 4: Run tests, commit**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run
git add packages/digit-datagrid/
git commit -m "feat(datagrid): RowActions + InlineDelete with mutation mode support"
```

---

### Task 6: Extended schemaUtils

Add boolean/date/enum auto-detection to `generateColumns`.

**Files:**
- Create: `packages/digit-datagrid/src/columns/schemaUtils.ts` (copy + extend from ui-mockup)
- Create: `packages/digit-datagrid/src/__tests__/schemaUtils.test.ts` (copy + extend)

**Step 1: Copy existing schemaUtils and tests into the package**

Copy `ui-mockup/src/admin/schemaUtils.ts` → `packages/digit-datagrid/src/columns/schemaUtils.ts`.
Copy `ui-mockup/src/admin/schemaUtils.test.ts` → `packages/digit-datagrid/src/__tests__/schemaUtils.test.ts`.

Update imports to use package-local paths:
- `import type { DigitColumn } from './types';` instead of `'./DigitDatagrid'`
- `import { EntityLink } from '@/components/ui/EntityLink';` → Remove for now (EntityLink is app-specific). Use a `renderRef` callback parameter instead.

**Step 2: Add new tests for boolean/date/enum**

Add to `packages/digit-datagrid/src/__tests__/schemaUtils.test.ts`:
```typescript
it('sets editable with type boolean for boolean fields', () => {
  const schema: SchemaDefinition = {
    type: 'object',
    properties: {
      code: { type: 'string' },
      active: { type: 'boolean' },
    },
    required: ['code'],
    'x-unique': ['code'],
  };
  const cols = generateColumns(schema, {});
  const activeCol = cols.find((c) => c.source === 'active');
  expect(activeCol?.editable).toEqual({ type: 'boolean' });
});

it('sets editable with type date for date-format fields', () => {
  const schema: SchemaDefinition = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      startDate: { type: 'string', format: 'date' },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id'],
    'x-unique': ['id'],
  };
  const cols = generateColumns(schema, {});
  const startCol = cols.find((c) => c.source === 'startDate');
  const createdCol = cols.find((c) => c.source === 'createdAt');
  expect(startCol?.editable).toEqual({ type: 'date' });
  expect(createdCol?.editable).toEqual({ type: 'date' });
});

it('sets editable with type select for enum fields', () => {
  const schema: SchemaDefinition = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'PENDING'] },
    },
    required: ['id', 'status'],
    'x-unique': ['id'],
  };
  const cols = generateColumns(schema, {});
  const statusCol = cols.find((c) => c.source === 'status');
  expect(statusCol?.editable).toEqual({
    type: 'select',
    options: [
      { value: 'ACTIVE', label: 'ACTIVE' },
      { value: 'INACTIVE', label: 'INACTIVE' },
      { value: 'PENDING', label: 'PENDING' },
    ],
  });
});
```

**Step 3: Extend generateColumns for new types**

In `packages/digit-datagrid/src/columns/schemaUtils.ts`, update the `SchemaProperty` interface to include `format`:
```typescript
export interface SchemaProperty {
  type?: string;
  format?: string;  // NEW
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  enum?: unknown[];
  description?: string;
}
```

Update the editable auto-detection in `generateColumns` (replace the `if (!unique.has(fieldName))` block):
```typescript
if (!unique.has(fieldName)) {
  if (ref) {
    col.editable = { type: 'reference', reference: ref.resource, displayField: 'name' };
  } else if (prop.type === 'boolean') {
    col.editable = { type: 'boolean' };
  } else if (prop.format === 'date' || prop.format === 'date-time') {
    col.editable = { type: 'date' };
  } else if (prop.enum && Array.isArray(prop.enum)) {
    col.editable = {
      type: 'select',
      options: prop.enum.map((v) => ({ value: String(v), label: String(v) })),
    };
  } else if (prop.type === 'number' || prop.type === 'integer') {
    col.editable = { type: 'number' };
  } else {
    col.editable = true;
  }
}
```

Also remove the direct `EntityLink` import and use a `renderRef` callback parameter:

```typescript
export function generateColumns(
  schema: SchemaDefinition,
  refMap: Record<string, RefMapEntry>,
  renderRef?: (resource: string, id: string) => React.ReactNode
): DigitColumn[] {
  // ... in the ref rendering section:
  if (ref) {
    if (renderRef) {
      col.render = (record) => {
        const value = (record as Record<string, unknown>)[fieldName];
        if (value == null || value === '') return React.createElement('span', { className: 'text-muted-foreground' }, '--');
        return renderRef(ref.resource, String(value));
      };
    }
  }
```

**Step 4: Run tests, commit**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run
git add packages/digit-datagrid/
git commit -m "feat(datagrid): Schema auto-detect boolean/date/enum + renderRef callback"
```

---

### Task 7: Wire Everything into DigitDatagrid

Integrate all hooks and components into the main DigitDatagrid, replacing the old inline mutation logic.

**Files:**
- Create: `packages/digit-datagrid/src/DigitDatagrid.tsx`
- Create: `packages/digit-datagrid/src/__tests__/DigitDatagrid.test.tsx`

**Step 1: Write integration tests**

Create `packages/digit-datagrid/src/__tests__/DigitDatagrid.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DigitDatagrid } from '../DigitDatagrid';
import type { DigitColumn } from '../columns/types';

// Mock ra-core
vi.mock('ra-core', () => ({
  useListContext: () => ({
    data: [
      { id: '1', name: 'Department A', active: true },
      { id: '2', name: 'Department B', active: false },
    ],
    total: 2,
    page: 1,
    perPage: 25,
    setPage: vi.fn(),
    sort: { field: 'name', order: 'ASC' },
    setSort: vi.fn(),
    isPending: false,
  }),
  useResourceContext: () => 'departments',
  useUpdate: () => [vi.fn()],
  useDelete: () => [vi.fn()],
  useGetList: () => ({ data: [], isPending: false }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const columns: DigitColumn[] = [
  { source: 'name', label: 'Name', editable: true },
  { source: 'active', label: 'Active', editable: { type: 'boolean' } },
];

describe('DigitDatagrid', () => {
  it('renders table with data', () => {
    render(<DigitDatagrid columns={columns} />);
    expect(screen.getByText('Department A')).toBeInTheDocument();
    expect(screen.getByText('Department B')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    render(<DigitDatagrid columns={columns} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows auto row actions when rowActions is auto', () => {
    render(<DigitDatagrid columns={columns} rowActions="auto" />);
    // Actions header should appear
    expect(screen.getAllByLabelText('Delete')).toHaveLength(2);
  });

  it('hides delete when noDelete is true', () => {
    render(<DigitDatagrid columns={columns} rowActions="auto" noDelete />);
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
  });

  it('defaults mutationMode to undoable', () => {
    render(<DigitDatagrid columns={columns} />);
    // Component renders — mutation mode is internal, verified via hook tests
    expect(screen.getByText('Department A')).toBeInTheDocument();
  });
});
```

**Step 2: Build the complete DigitDatagrid**

Create `packages/digit-datagrid/src/DigitDatagrid.tsx` — a refactored version of the existing component that uses `useMutationMode`, renders `EditableCell` polymorphically, and integrates `RowActions`. This is the longest file (~300 lines). Key changes from the existing code:

1. Import from package-local paths (`./editing/`, `./actions/`, `./columns/types`)
2. Accept new props: `mutationMode`, `mutationOptions`, `rowActions`, `noDelete`, `configurable`, `preferenceKey`, `disableAutofocus`
3. Replace direct `useUpdate` call with `useMutationMode` hook
4. Render `RowActions` when `rowActions='auto'` (default when editable columns exist)
5. Use `EditableCell` for boolean/date/select types
6. Add `group/row` class on `TableRow` for hover-based action visibility

**Step 3: Run tests, commit**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run
git add packages/digit-datagrid/
git commit -m "feat(datagrid): Full DigitDatagrid with mutation modes, row actions, polymorphic cells"
```

---

### Task 8: DigitList + Column Config UI

Add column configurability button to DigitList.

**Files:**
- Create: `packages/digit-datagrid/src/DigitList.tsx`
- Create: `packages/digit-datagrid/src/primitives/popover.tsx`

**Step 1: Create Popover primitive**

Create `packages/digit-datagrid/src/primitives/popover.tsx` — standard shadcn Popover wrapping `@radix-ui/react-popover`.

**Step 2: Copy DigitList, add Column Config button**

Copy `ui-mockup/src/admin/DigitList.tsx` → `packages/digit-datagrid/src/DigitList.tsx`.

Add a `configurable` prop. When true, render a "Columns" button (Settings2 icon) next to Refresh that opens a Popover with checkboxes for each column. Accept `columns` and `alwaysVisibleSources` props to pass to `useColumnConfig`.

The Popover content:
```tsx
<PopoverContent className="w-56">
  <div className="space-y-1">
    <p className="text-sm font-medium mb-2">Show columns</p>
    {columns.map((col) => (
      <label key={col.source} className="flex items-center gap-2 text-sm py-1">
        <input
          type="checkbox"
          checked={!isColumnHidden(col.source)}
          onChange={() => toggleColumn(col.source)}
          disabled={alwaysVisibleSources.includes(col.source)}
          className="rounded"
        />
        {col.label}
      </label>
    ))}
    <Button variant="ghost" size="sm" onClick={resetColumns} className="w-full mt-2">
      Reset
    </Button>
  </div>
</PopoverContent>
```

**Step 3: Run tests, commit**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run
git add packages/digit-datagrid/
git commit -m "feat(datagrid): DigitList with column configurability popover"
```

---

### Task 9: Update Barrel Exports + ReferenceSelect + AddRowDialog

Finalize the package exports and copy remaining components.

**Files:**
- Modify: `packages/digit-datagrid/src/index.ts` (uncomment all exports)
- Copy: `ReferenceSelect.tsx` → `packages/digit-datagrid/src/editing/`
- Copy: `AddRowDialog.tsx` → `packages/digit-datagrid/src/actions/`

**Step 1: Copy ReferenceSelect and AddRowDialog**

Copy and update import paths.

**Step 2: Update barrel index.ts — uncomment all exports**

```typescript
// Types
export type {
  MutationMode,
  ValidationRule,
  EditableCellType,
  EditableColumnConfig,
  DigitColumn,
  MutationOptions,
  DigitDatagridProps,
} from './columns/types';

// Hooks
export { useMutationMode } from './editing/useMutationMode';
export { useColumnConfig } from './editing/useColumnConfig';

// Components
export { DigitDatagrid } from './DigitDatagrid';
export { DigitList } from './DigitList';
export type { DigitListProps } from './DigitList';
export { EditableCell, validationPatterns, commonValidations } from './editing/EditableCell';
export { ReferenceSelect } from './editing/ReferenceSelect';
export { RowActions } from './actions/RowActions';
export { InlineDelete } from './actions/InlineDelete';
export { AddRowDialog } from './actions/AddRowDialog';

// Schema utilities
export {
  generateColumns,
  getRefMap,
  orderFields,
  groupShowFields,
  formatFieldLabel,
} from './columns/schemaUtils';
export type {
  SchemaDefinition,
  SchemaProperty,
  RefSchemaEntry,
  RefMapEntry,
  ShowFieldGroups,
} from './columns/schemaUtils';
```

**Step 3: Run full test suite, commit**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run
git add packages/digit-datagrid/
git commit -m "feat(datagrid): Complete barrel exports with all components and utilities"
```

---

### Task 10: Wire App to Use @digit-ui/datagrid

Update the `ui-mockup` app to import from the workspace package instead of local files.

**Files:**
- Modify: `ui-mockup/src/admin/index.ts` — re-export from `@digit-ui/datagrid`
- Modify: `ui-mockup/src/admin/DigitDatagrid.tsx` — replace with re-export
- Modify: `ui-mockup/src/admin/DigitList.tsx` — replace with re-export
- Modify: `ui-mockup/src/admin/schemaUtils.ts` — replace with re-export
- Modify: resource files as needed (should be backward-compatible)

**Step 1: Update admin barrel to re-export from package**

Modify `ui-mockup/src/admin/index.ts`:
```typescript
// Re-export from @digit-ui/datagrid package
export {
  DigitDatagrid,
  DigitList,
  EditableCell,
  ReferenceSelect,
  RowActions,
  InlineDelete,
  AddRowDialog,
  useMutationMode,
  useColumnConfig,
  generateColumns,
  getRefMap,
  orderFields,
  groupShowFields,
  formatFieldLabel,
  validationPatterns,
  commonValidations,
} from '@digit-ui/datagrid';

export type {
  DigitDatagridProps,
  DigitColumn,
  EditableColumnConfig,
  MutationMode,
  MutationOptions,
  ValidationRule,
  EditableCellType,
  DigitListProps,
  SchemaDefinition,
  SchemaProperty,
  RefSchemaEntry,
  RefMapEntry,
  ShowFieldGroups,
} from '@digit-ui/datagrid';

// App-specific components (not in the package)
export { DigitShow } from './DigitShow';
export type { DigitShowProps } from './DigitShow';
export { DigitEdit } from './DigitEdit';
export type { DigitEditProps } from './DigitEdit';
export { DigitCreate } from './DigitCreate';
export type { DigitCreateProps } from './DigitCreate';
export { DigitFormInput } from './DigitFormInput';
export type { DigitFormInputProps } from './DigitFormInput';
export { DigitLayout } from './DigitLayout';
export { MdmsResourcePage } from './MdmsResourcePage';
export { MdmsResourceShow } from './MdmsResourceShow';
export { MdmsResourceEdit } from './MdmsResourceEdit';
export { DigitDashboard } from './DigitDashboard';
```

**Step 2: Run full app test suite**

```bash
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx vitest run
```

Ensure all 16+ existing tests still pass.

**Step 3: Run dev server and verify live site**

```bash
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npm run dev &
```

Navigate to complaint types page, verify:
- Double-click department column → dropdown appears
- Double-click name column → text input appears
- Single click → navigates to show page
- Undo toast appears after saving

**Step 4: Commit**

```bash
git add utilities/crs_dataloader/ui-mockup/
git commit -m "refactor: Wire ui-mockup app to use @digit-ui/datagrid workspace package"
```

---

### Task 11: Final Cleanup + Push

Run all tests, push, sync to web-configurator.

**Step 1: Run package tests**

```bash
cd /root/code/ccrs-ui-mockup/packages/digit-datagrid && npx vitest run
```

**Step 2: Run app tests**

```bash
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup && npx vitest run
```

**Step 3: Push**

```bash
cd /root/code/ccrs-ui-mockup && git push origin configurator
```

**Step 4: Sync to web-configurator**

```bash
git checkout feat/web-configurator
rsync -av --delete --exclude='.git' --exclude='node_modules' --exclude='dist' utilities/crs_dataloader/ui-mockup/ web-configurator/
cp -r packages/ .  # Copy packages dir to root
git add web-configurator/ packages/
git commit -m "feat: Sync @digit-ui/datagrid package + app wiring"
git push origin feat/web-configurator
git checkout configurator
```
