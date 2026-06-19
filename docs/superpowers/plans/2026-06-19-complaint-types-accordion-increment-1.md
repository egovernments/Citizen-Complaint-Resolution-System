# Complaint Types Accordion — Increment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `/complaint-types` list with a read-only two-level accordion: Complaint Types (grouped by `menuPath`) that expand to reveal their Sub-Types.

**Architecture:** Frontend-only. A pure helper groups the flat MDMS sub-type records by `menuPath` (case-insensitive), resolving each type's display label from localization and computing count + active rollup, ordered by the `order` field. A presentational nested table renders one group's sub-types. The list page becomes a self-contained accordion container that fetches all records via `useGetList` and manages local expand/collapse state. No backend, data-provider, registry, or routing changes.

**Tech Stack:** React + TypeScript, react-admin (`ra-core`) hooks, Tailwind/shadcn UI, lucide-react icons, Vitest + Testing Library.

---

## Spec reference

`docs/superpowers/specs/2026-06-19-complaint-types-hierarchy-design.md` — Increment 1 section.

## File structure

- `src/resources/complaint-types/groupComplaintTypes.ts` (new) — pure grouping helper + types. One responsibility: turn flat records into ordered, labelled groups.
- `src/resources/complaint-types/groupComplaintTypes.test.ts` (new) — unit tests for the helper.
- `src/resources/complaint-types/SubTypeTable.tsx` (new) — presentational nested table for one group's sub-types; row click → Show page.
- `src/resources/complaint-types/SubTypeTable.test.tsx` (new) — render + navigation test.
- `src/resources/complaint-types/ComplaintTypeList.tsx` (rewrite) — accordion container: fetch, group, expand/collapse, chrome (title, refresh, loading/error/empty).
- `src/resources/complaint-types/ComplaintTypeList.test.tsx` (new) — render + expand interaction test.

No changes to `App.tsx`, `packages/data-provider`, or `resourceRegistry.ts`.

---

## Task 1: Create the feature branch

**Files:** none (git only)

- [ ] **Step 1: Branch off develop**

We are on the default branch `develop`; isolate the work.

Run:
```bash
git checkout -b feature/complaint-types-accordion
```
Expected: `Switched to a new branch 'feature/complaint-types-accordion'`

---

## Task 2: `groupComplaintTypes` pure helper

**Files:**
- Create: `src/resources/complaint-types/groupComplaintTypes.ts`
- Test: `src/resources/complaint-types/groupComplaintTypes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/resources/complaint-types/groupComplaintTypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupComplaintTypes, type SubTypeRecord } from './groupComplaintTypes';

// translate stub: returns the provided default (opts._) when given, else the
// key — simulates "no message found, fall back to default".
const translate = (key: string, opts?: { _?: string }) => opts?._ ?? key;

// translate stub with a known label only for SERVICEDEFS.SANITATION.
const translateWithLabel = (key: string, opts?: { _?: string }) =>
  key === 'SERVICEDEFS.SANITATION' ? 'Sanitation & Waste' : opts?._ ?? key;

function rec(p: Partial<SubTypeRecord> & { serviceCode: string }): SubTypeRecord {
  return { id: p.serviceCode, ...p };
}

describe('groupComplaintTypes', () => {
  it('groups records by menuPath case-insensitively', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'A', menuPath: 'Sanitation', order: 1, active: true }),
        rec({ serviceCode: 'B', menuPath: 'SANITATION', order: 2, active: true }),
      ],
      translate,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('computes count and activeCount', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'A', menuPath: 'Roads', order: 1, active: true }),
        rec({ serviceCode: 'B', menuPath: 'Roads', order: 2, active: false }),
        rec({ serviceCode: 'C', menuPath: 'Roads', order: 3, active: true }),
      ],
      translate,
    );
    expect(groups[0].count).toBe(3);
    expect(groups[0].activeCount).toBe(2);
  });

  it('puts records with no menuPath into an Uncategorized group, placed last', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'A', menuPath: undefined, order: 1 }),
        rec({ serviceCode: 'B', menuPath: '  ', order: 2 }),
        rec({ serviceCode: 'C', menuPath: 'Water', order: 5 }),
      ],
      translate,
    );
    expect(groups).toHaveLength(2);
    const last = groups[groups.length - 1];
    expect(last.isUncategorized).toBe(true);
    expect(last.count).toBe(2);
  });

  it('uses SERVICEDEFS.<MENUPATH> label when present, else the raw menuPath', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'A', menuPath: 'Sanitation', order: 1 }),
        rec({ serviceCode: 'B', menuPath: 'Roads', order: 2 }),
      ],
      translateWithLabel,
    );
    const sanitation = groups.find((g) => g.menuPath === 'SANITATION')!;
    const roads = groups.find((g) => g.menuPath === 'ROADS')!;
    expect(sanitation.label).toBe('Sanitation & Waste');
    expect(roads.label).toBe('Roads');
  });

  it('orders types by the group minimum order, Uncategorized always last', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'A', menuPath: 'Water', order: 10 }),
        rec({ serviceCode: 'B', menuPath: 'Roads', order: 2 }),
        rec({ serviceCode: 'C', menuPath: 'Roads', order: 99 }),
        rec({ serviceCode: 'D', menuPath: undefined, order: 1 }),
      ],
      translate,
    );
    expect(groups.map((g) => g.menuPath)).toEqual(['ROADS', 'WATER', '']);
  });

  it('orders sub-types within a group by order then serviceCode', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'Zebra', menuPath: 'Roads', order: 1 }),
        rec({ serviceCode: 'Alpha', menuPath: 'Roads', order: 1 }),
        rec({ serviceCode: 'Mango', menuPath: 'Roads', order: 0 }),
      ],
      translate,
    );
    expect(groups[0].subTypes.map((s) => s.serviceCode)).toEqual([
      'Mango',
      'Alpha',
      'Zebra',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/resources/complaint-types/groupComplaintTypes.test.ts`
Expected: FAIL — cannot resolve `./groupComplaintTypes` (module not found).

- [ ] **Step 3: Write the helper implementation**

Create `src/resources/complaint-types/groupComplaintTypes.ts`:

```ts
import type { RaRecord } from 'ra-core';

/** One MDMS PGR ServiceDef record (a sub-type), as normalized by the data provider. */
export interface SubTypeRecord {
  id: RaRecord['id'];
  serviceCode: string;
  name?: string;
  department?: string;
  slaHours?: number;
  menuPath?: string;
  active?: boolean;
  order?: number;
}

/** A derived Complaint Type — a group of sub-types sharing a menuPath. */
export interface ComplaintTypeGroup {
  /** Upper-cased menuPath key, or '' for the uncategorized bucket. */
  menuPath: string;
  /** Display label: localized SERVICEDEFS.<MENUPATH>, or the raw menuPath. */
  label: string;
  count: number;
  activeCount: number;
  isUncategorized: boolean;
  /** Lowest order value among sub-types; drives type ordering. */
  minOrder: number;
  subTypes: SubTypeRecord[];
}

type TranslateFn = (key: string, options?: { _?: string }) => string;

const orderOf = (r: SubTypeRecord): number =>
  typeof r.order === 'number' ? r.order : Number.POSITIVE_INFINITY;

/**
 * Group flat sub-type records into Complaint Types by menuPath.
 * Grouping is case-insensitive (Sanitation / SANITATION collapse into one).
 * Records with no menuPath fall into a single "Uncategorized" group, always
 * rendered last. Types are ordered by their minimum `order`; sub-types within a
 * type by `order` then `serviceCode`.
 */
export function groupComplaintTypes(
  records: SubTypeRecord[],
  translate: TranslateFn,
): ComplaintTypeGroup[] {
  const buckets = new Map<string, { original: string; records: SubTypeRecord[] }>();

  for (const r of records) {
    const raw = (r.menuPath ?? '').trim();
    const key = raw.toUpperCase(); // '' => uncategorized
    const existing = buckets.get(key);
    if (existing) {
      existing.records.push(r);
    } else {
      buckets.set(key, { original: raw, records: [r] });
    }
  }

  const groups: ComplaintTypeGroup[] = [];
  for (const [key, { original, records: subs }] of buckets) {
    const isUncategorized = key === '';
    const sortedSubs = [...subs].sort(
      (a, b) =>
        orderOf(a) - orderOf(b) || a.serviceCode.localeCompare(b.serviceCode),
    );
    const label = isUncategorized
      ? translate('app.complaint_types.uncategorized', { _: 'Uncategorized' })
      : translate(`SERVICEDEFS.${key}`, { _: original });
    groups.push({
      menuPath: key,
      label,
      count: subs.length,
      activeCount: subs.filter((s) => s.active === true).length,
      isUncategorized,
      minOrder: Math.min(...subs.map(orderOf)),
      subTypes: sortedSubs,
    });
  }

  groups.sort((a, b) => {
    if (a.isUncategorized !== b.isUncategorized) return a.isUncategorized ? 1 : -1;
    return a.minOrder - b.minOrder || a.label.localeCompare(b.label);
  });

  return groups;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/resources/complaint-types/groupComplaintTypes.test.ts`
Expected: PASS — 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/resources/complaint-types/groupComplaintTypes.ts src/resources/complaint-types/groupComplaintTypes.test.ts
git commit -m "feat(complaint-types): add groupComplaintTypes helper"
```

---

## Task 3: `SubTypeTable` presentational component

**Files:**
- Create: `src/resources/complaint-types/SubTypeTable.tsx`
- Test: `src/resources/complaint-types/SubTypeTable.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/resources/complaint-types/SubTypeTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import { SubTypeTable } from './SubTypeTable';
import type { SubTypeRecord } from './groupComplaintTypes';

const subs: SubTypeRecord[] = [
  {
    id: 'GarbageNotCollected',
    serviceCode: 'GarbageNotCollected',
    name: 'Garbage not collected',
    department: 'Public Health',
    slaHours: 48,
    active: true,
  },
];

describe('SubTypeTable', () => {
  it('renders sub-type rows', () => {
    render(<SubTypeTable subTypes={subs} />);
    expect(screen.getByText('Garbage not collected')).toBeInTheDocument();
    expect(screen.getByText('GarbageNotCollected')).toBeInTheDocument();
  });

  it('navigates to the sub-type Show page on row click', () => {
    render(<SubTypeTable subTypes={subs} />);
    fireEvent.click(screen.getByText('Garbage not collected'));
    expect(navigate).toHaveBeenCalledWith(
      '/manage/complaint-types/GarbageNotCollected/show',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/resources/complaint-types/SubTypeTable.test.tsx`
Expected: FAIL — cannot resolve `./SubTypeTable`.

- [ ] **Step 3: Write the component**

Create `src/resources/complaint-types/SubTypeTable.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { StatusChip } from '@/admin/fields';
import type { SubTypeRecord } from './groupComplaintTypes';

interface SubTypeTableProps {
  subTypes: SubTypeRecord[];
}

export function SubTypeTable({ subTypes }: SubTypeTableProps) {
  const navigate = useNavigate();

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-muted-foreground">
          <th className="px-3 py-2 font-medium">Sub-Type</th>
          <th className="px-3 py-2 font-medium">Service Code</th>
          <th className="px-3 py-2 font-medium">Department</th>
          <th className="px-3 py-2 font-medium">SLA</th>
          <th className="px-3 py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {subTypes.map((s) => (
          <tr
            key={String(s.id)}
            onClick={() =>
              navigate(
                `/manage/complaint-types/${encodeURIComponent(String(s.id))}/show`,
              )
            }
            className="cursor-pointer border-t border-border hover:bg-muted/40"
          >
            <td className="px-3 py-2">{s.name ?? '--'}</td>
            <td className="px-3 py-2 font-mono text-xs text-primary">
              {s.serviceCode}
            </td>
            <td className="px-3 py-2">{s.department ?? '--'}</td>
            <td className="px-3 py-2">
              {s.slaHours != null ? `${s.slaHours}h` : '--'}
            </td>
            <td className="px-3 py-2">
              <StatusChip
                value={s.active}
                labels={{ true: 'Active', false: 'Inactive' }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/resources/complaint-types/SubTypeTable.test.tsx`
Expected: PASS — 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/resources/complaint-types/SubTypeTable.tsx src/resources/complaint-types/SubTypeTable.test.tsx
git commit -m "feat(complaint-types): add SubTypeTable nested table"
```

---

## Task 4: Rewrite `ComplaintTypeList` as the accordion container

**Files:**
- Modify (rewrite): `src/resources/complaint-types/ComplaintTypeList.tsx`
- Test: `src/resources/complaint-types/ComplaintTypeList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/resources/complaint-types/ComplaintTypeList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('ra-core', () => ({
  useTranslate: () => (key: string, opts?: { _?: string }) => opts?._ ?? key,
  useGetList: () => ({
    data: [
      {
        id: 'GarbageNotCollected',
        serviceCode: 'GarbageNotCollected',
        name: 'Garbage not collected',
        menuPath: 'Sanitation',
        department: 'Public Health',
        slaHours: 48,
        active: true,
        order: 1,
      },
      {
        id: 'PotHole',
        serviceCode: 'PotHole',
        name: 'Pot hole',
        menuPath: 'Roads',
        slaHours: 72,
        active: true,
        order: 2,
      },
    ],
    isPending: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { ComplaintTypeList } from './ComplaintTypeList';

describe('ComplaintTypeList (accordion)', () => {
  it('renders complaint type rows collapsed by default', () => {
    render(<ComplaintTypeList />);
    expect(screen.getByText('Sanitation')).toBeInTheDocument();
    expect(screen.getByText('Roads')).toBeInTheDocument();
    // sub-type rows hidden while collapsed
    expect(screen.queryByText('Garbage not collected')).not.toBeInTheDocument();
  });

  it('expands a type to reveal its sub-types on click', () => {
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByText('Sanitation'));
    expect(screen.getByText('Garbage not collected')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/resources/complaint-types/ComplaintTypeList.test.tsx`
Expected: FAIL — the current `ComplaintTypeList` renders `DigitList`/`DigitDatagrid` (no "Sanitation"/"Roads" grouping), so the assertions fail.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `src/resources/complaint-types/ComplaintTypeList.tsx` with:

```tsx
import { useState } from 'react';
import { useGetList, useTranslate } from 'ra-core';
import { RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { groupComplaintTypes, type SubTypeRecord } from './groupComplaintTypes';
import { SubTypeTable } from './SubTypeTable';

const GRID = 'grid grid-cols-[28px_1fr_120px_120px] gap-2';

export function ComplaintTypeList() {
  const translate = useTranslate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isPending, isFetching, error, refetch } = useGetList(
    'complaint-types',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'serviceCode', order: 'ASC' },
    },
  );

  const groups = groupComplaintTypes(
    (data ?? []) as unknown as SubTypeRecord[],
    translate,
  );

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Title bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
            {translate('app.resources.complaint_types', { _: 'Complaint Types' })}
          </h1>
          {data && (
            <Badge variant="secondary" className="text-xs">
              {groups.length}
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          {translate('app.list.refresh', { _: 'Refresh' })}
        </Button>
      </div>

      <DigitCard className="max-w-none">
        {isPending && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            {translate('app.list.loading', { _: 'Loading…' })}
          </div>
        )}

        {error && !isPending && (
          <div className="text-center py-12">
            <p className="text-destructive font-medium">
              {translate('app.list.error_loading', { _: 'Failed to load' })}
            </p>
          </div>
        )}

        {!isPending && !error && groups.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="font-medium">
              {translate('app.list.no_records', { _: 'No complaint types yet' })}
            </p>
          </div>
        )}

        {!isPending && !error && groups.length > 0 && (
          <div className="border border-border rounded-md overflow-hidden">
            {/* Column header */}
            <div
              className={`${GRID} px-3 py-2 text-xs uppercase text-muted-foreground bg-muted/50 border-b border-border`}
            >
              <span />
              <span>{translate('app.fields.complaint_type', { _: 'Complaint Type' })}</span>
              <span>{translate('app.fields.sub_types', { _: 'Sub-Types' })}</span>
              <span>{translate('app.fields.active', { _: 'Active' })}</span>
            </div>

            {groups.map((g) => {
              const key = g.menuPath || '__uncategorized__';
              const isOpen = expanded.has(g.menuPath);
              return (
                <div key={key}>
                  <div
                    onClick={() => toggle(g.menuPath)}
                    className={`${GRID} px-3 py-3 items-center cursor-pointer border-b border-border hover:bg-muted/40 ${
                      isOpen ? 'bg-muted/40' : ''
                    }`}
                  >
                    <span className="text-muted-foreground">
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </span>
                    <span
                      className={`font-semibold ${
                        g.isUncategorized ? 'text-muted-foreground' : ''
                      }`}
                    >
                      {g.label}
                    </span>
                    <span className="tabular-nums">{g.count}</span>
                    <span>
                      <Badge
                        variant="outline"
                        className="text-xs bg-green-100 text-green-800 border-green-200"
                      >
                        {g.activeCount} active
                      </Badge>
                    </span>
                  </div>
                  {isOpen && (
                    <div className="bg-muted/20 border-b border-border px-3 py-2 pl-10">
                      <SubTypeTable subTypes={g.subTypes} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DigitCard>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/resources/complaint-types/ComplaintTypeList.test.tsx`
Expected: PASS — 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/resources/complaint-types/ComplaintTypeList.tsx src/resources/complaint-types/ComplaintTypeList.test.tsx
git commit -m "feat(complaint-types): two-level accordion list view"
```

---

## Task 5: Lint, full test suite, and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Lint the new/changed files**

Run: `npm run lint`
Expected: PASS — no new errors. If lint flags the arbitrary Tailwind grid class, it is content-only and safe; fix any genuine TS/React lint errors it reports.

- [ ] **Step 2: Run the full unit test suite**

Run: `npm test`
Expected: PASS — all suites green, including the three new files.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: completes with no errors.

- [ ] **Step 4: Manual verification in the dev server**

The dev server runs at http://localhost:5173/configurator/ (proxying a real DIGIT tenant). Navigate to the Complaint Types page under Complaint Management and confirm:
- Types render grouped by menuPath, all collapsed, ordered by `order`.
- The count + "N active" rollup is correct per type.
- Clicking a type expands it; the nested table shows Sub-Type, Service Code, Department, SLA, Status.
- Clicking a sub-type row opens its existing Show page.
- Any sub-types with no menuPath appear under "Uncategorized", last.

If the page is broken, fix forward and re-run Steps 1–3 before considering the increment done.

- [ ] **Step 5: Final commit (only if Step 4 required fixes)**

```bash
git add -A
git commit -m "fix(complaint-types): address manual-verification findings"
```

---

## Self-review notes (author)

- **Spec coverage:** accordion view (Task 4), grouping by menuPath case-insensitive (Task 2), label fallback (Task 2), count + active rollup (Tasks 2/4), Uncategorized last (Task 2), order honored at type + sub-type level (Task 2), all-collapsed default (Task 4), sub-type row → Show (Task 3), no search / no CRUD / no backend changes (scope respected). Covered.
- **Type consistency:** `SubTypeRecord` / `ComplaintTypeGroup` defined in Task 2 are used unchanged in Tasks 3–4; `groupComplaintTypes(records, translate)` signature consistent across tasks.
- **No placeholders:** every code/command step is concrete.
- **Optional follow-up (not required):** add real `app.complaint_types.uncategorized`, `app.fields.complaint_type`, `app.fields.sub_types` localization keys to the message catalog; the `{ _: default }` fallbacks render correctly without them.
```
