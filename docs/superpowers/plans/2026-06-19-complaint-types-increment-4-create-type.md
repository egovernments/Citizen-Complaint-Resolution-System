# Complaint Types — Increment 4 (Create Complaint Type) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators create a brand-new complaint type (with its first sub-type) from a discoverable top-level "+ Add Complaint Type" button.

**Architecture:** The combined create form already exists — `ComplaintTypeCreate`'s no-`menuPath` mode (titled "Create Complaint Type") captures the type code (`menuPath`) + the first sub-type and, in `afterCreate`, seeds the localization label `SERVICEDEFS.<MENUPATH_UPPER>` and sub-type keys, then cache-busts. It just isn't reachable from the UI. This increment adds the entry-point button and relabels the type field for create mode. **Decision (approved):** one "Complaint Type Name" field doubles as both the code (`menuPath`) and the seeded display label; an independently editable display name is Increment 5.

**Tech Stack:** React 19, ra-core (`useNavigate`, `useTranslate`), shadcn `Button`, lucide `Plus`, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-19-complaint-types-hierarchy-design.md` — Increment 4 ("Create Complaint Type — combined Type + first-Sub-Type form, seeding the type label").

**Conventions:** paths relative to `configurator/`; run npm/npx there. Tests `npx vitest run <path>`, type-check `npx tsc --noEmit`, lint `npx eslint <files>`. Branch `feature/complaint-types-accordion`. Commit trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File structure
- Modify `src/resources/complaint-types/ComplaintTypeList.tsx` — add the "+ Add Complaint Type" button.
- Modify `src/resources/complaint-types/ComplaintTypeList.test.tsx` — cover the button + navigation.
- Modify `src/resources/complaint-types/ComplaintTypeCreate.tsx` — relabel the type field in create mode.
- Modify `src/resources/complaint-types/ComplaintTypeCreate.test.tsx` — assert the create-mode label.

---

### Task 1: "+ Add Complaint Type" button (TDD)

**Files:**
- Modify: `src/resources/complaint-types/ComplaintTypeList.tsx`
- Test: `src/resources/complaint-types/ComplaintTypeList.test.tsx`

The title bar currently has only a Refresh button on the right. Add a primary "Add Complaint Type" button beside it that navigates to the create route with **no** `menuPath` param (so the form opens in create-type mode). `navigate`, `translate`, and the `Plus` icon are already imported/in scope.

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('ComplaintTypeList (accordion)', …)` block in `src/resources/complaint-types/ComplaintTypeList.test.tsx`:

```tsx
  it('navigates to the create page (no menuPath) when adding a complaint type', () => {
    navigate.mockClear();
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByText('Add Complaint Type'));
    expect(navigate).toHaveBeenCalledWith('/manage/complaint-types/create');
  });
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `npx vitest run src/resources/complaint-types/ComplaintTypeList.test.tsx`
Expected: FAIL — no element with text "Add Complaint Type".

- [ ] **Step 3: Add the button**

In `src/resources/complaint-types/ComplaintTypeList.tsx`, replace the lone Refresh button in the title bar:

```tsx
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
```

with a grouped pair (Add + Refresh):

```tsx
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => navigate('/manage/complaint-types/create')}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            {translate('app.complaintTypes.add_type', { _: 'Add Complaint Type' })}
          </Button>
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
      </div>
```

- [ ] **Step 4: Run it, confirm it PASSES**

Run: `npx vitest run src/resources/complaint-types/ComplaintTypeList.test.tsx`
Expected: PASS (all list tests, incl. the new one).

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add src/resources/complaint-types/ComplaintTypeList.tsx src/resources/complaint-types/ComplaintTypeList.test.tsx
git commit -m "feat(complaint-types): add top-level Add Complaint Type button"
```

---

### Task 2: Relabel the type field for create mode (TDD)

**Files:**
- Modify: `src/resources/complaint-types/ComplaintTypeCreate.tsx`
- Test: `src/resources/complaint-types/ComplaintTypeCreate.test.tsx`

In create-type mode the `menuPath` field doubles as the type's name (it's the code and the seeded label), so label it "Complaint Type Name". In add-sub-type mode (preset `menuPath`, field disabled) keep the technical "Complaint Type (Menu Path)" label. The create test's `DigitFormInput` mock currently ignores `label`; extend it to expose the label so the relabel is assertable.

- [ ] **Step 1: Extend the mock + write the failing test**

In `src/resources/complaint-types/ComplaintTypeCreate.test.tsx`, change the `DigitFormInput` mock to expose the label:

```tsx
  DigitFormInput: ({ source, disabled, label }: any) => (
    <div
      data-testid={`input-${source}`}
      data-disabled={String(!!disabled)}
      data-label={String(label)}
    />
  ),
```

Then add these tests inside the `describe('ComplaintTypeCreate', …)` block:

```tsx
  it('labels the type field as a name when creating a new type', () => {
    renderAt('');
    expect(screen.getByTestId('input-menuPath').dataset.label).toBe('Complaint Type Name');
  });

  it('labels the type field as the menu path when adding a sub-type', () => {
    renderAt('?menuPath=Sanitation');
    expect(screen.getByTestId('input-menuPath').dataset.label).toBe('Complaint Type (Menu Path)');
  });
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `npx vitest run src/resources/complaint-types/ComplaintTypeCreate.test.tsx`
Expected: FAIL — current label is the static "Complaint Type (Menu Path)" in both modes.

- [ ] **Step 3: Make the label mode-aware**

In `src/resources/complaint-types/ComplaintTypeCreate.tsx`, change the type field:

```tsx
      <DigitFormInput
        source="menuPath"
        label="Complaint Type (Menu Path)"
        validate={presetMenuPath ? undefined : v.required}
        disabled={!!presetMenuPath}
      />
```

to:

```tsx
      <DigitFormInput
        source="menuPath"
        label={presetMenuPath ? 'Complaint Type (Menu Path)' : 'Complaint Type Name'}
        validate={presetMenuPath ? undefined : v.required}
        disabled={!!presetMenuPath}
      />
```

- [ ] **Step 4: Run it, confirm it PASSES**

Run: `npx vitest run src/resources/complaint-types/ComplaintTypeCreate.test.tsx`
Expected: PASS (all create tests, incl. the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/resources/complaint-types/ComplaintTypeCreate.tsx src/resources/complaint-types/ComplaintTypeCreate.test.tsx
git commit -m "feat(complaint-types): label the type field as a name in create mode"
```

---

### Task 3: Verify + build + push

**Files:** none (verification only)

- [ ] **Step 1: Full checks**

Run:
```bash
npx tsc --noEmit
npx eslint src/resources/complaint-types/ComplaintTypeList.tsx src/resources/complaint-types/ComplaintTypeCreate.tsx
npx vitest run
```
Expected: tsc clean; eslint clean on these files; all tests pass.

- [ ] **Step 2: Production build (no complaint-types regressions)**

Run: `npm run build`
Expected: build either succeeds, or fails ONLY on pre-existing unrelated errors. Confirm with:
`npm run build 2>&1 | grep -i "complaint-types"` → must be empty.

- [ ] **Step 3: Manual verification (dev server)**

Run: `npm run dev`. Then:
1. On `/manage/complaint-types`, click **+ Add Complaint Type** (title bar) → lands on the "Create Complaint Type" form (the type field labeled "Complaint Type Name", editable).
2. Fill the type name + the first sub-type (name, service code, department, SLA) and submit.
3. Back on the list, confirm the new type appears with its label (localization seeded) and its first sub-type listed when expanded.
4. Separately, expand a type and click **Add Sub-Type** → the same form opens with the type field locked (labeled "Complaint Type (Menu Path)") — confirm Increment 2 still works.

- [ ] **Step 4: Push**

```bash
git push egov feature/complaint-types-accordion
```
(Updates PR #899.)

---

## Out of scope (Increment 5)
- Editing a complaint type's **display name** independently of its code (rename via localization + cache-bust). The create flow here seeds the label from the typed name; changing it later is Increment 5.
