// @vitest-environment jsdom
//
// Regression coverage for CCRS #1957 — "User is unable to revoke the access of
// a particular jurisdiction/department that was already assigned to user".
//
// The department half of that bug. egov-hrms treats assignments as append-only
// and gives them no isActive flag, so EmployeeValidator boxes a client in from
// three sides at once:
//
//   validateConsistencyAssignment  every previously stored assignment id must
//                                  come back, or the whole update fails with
//                                  ERR_HRMS_UPDATE_ASSIGNEMENT_INCOSISTENT
//   validateAssignments            exactly ONE assignment may be current, and
//                                  every non-current one must carry a toDate
//                                  (ERR_HRMS_INVALID_ASSIGNMENT_NON_CURRENT_TO_DATE)
//   validateAssignments            a non-current assignment must have ENDED by
//                                  the time the current one starts
//                                  (ERR_HRMS_OVERLAPPING_ASSGN_CURRENT), which
//                                  in effect means the current assignment is
//                                  always the latest one
//
// The editor used to splice the row out of the form value (tripping the first
// rule) and to hand `current` over without closing the row it demoted (tripping
// the second), so on bomet an admin could not take a department away from
// HR_CSR by any route. Revoking now ENDS the assignment instead: the row stays
// on record, and pgr-services' PolicyDrivenScopeResolver — which counts only
// current assignments — stops putting that department in the employee's scope.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoreAdminContext, Form, TestMemoryRouter, type DataProvider } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';
import { AssignmentEditor } from './AssignmentEditor';

const DEPARTMENTS = [
  { id: 'DEPT_9', code: 'DEPT_9', name: 'Department 9' },
  { id: 'ADMIN_PUBLIC_SVC', code: 'ADMIN_PUBLIC_SVC', name: 'Administration & Public Service' },
];

const DESIGNATIONS = [
  { id: 'chief_officer', code: 'chief_officer', name: 'Chief Officer' },
  { id: 'DESIG_58', code: 'DESIG_58', name: 'Designation 58' },
];

/** HR_CSR as bomet actually stores it: one closed historical row + the current one. */
const HISTORICAL = {
  id: 'asg-dept9',
  department: 'DEPT_9',
  designation: 'chief_officer',
  fromDate: 1788048000000,
  toDate: 1788048000000,
  isCurrentAssignment: false,
};

const CURRENT = {
  id: 'asg-admin',
  department: 'ADMIN_PUBLIC_SVC',
  designation: 'DESIG_58',
  fromDate: 1788156757544,
  isCurrentAssignment: true,
};

interface SubmittedAssignment {
  id?: string;
  department?: string;
  fromDate: number;
  toDate?: number;
  isCurrentAssignment?: boolean;
}

function makeDataProvider(): DataProvider {
  return {
    getList: async (resource: string) => {
      if (resource === 'departments') return { data: DEPARTMENTS, total: DEPARTMENTS.length };
      if (resource === 'designations') return { data: DESIGNATIONS, total: DESIGNATIONS.length };
      return { data: [], total: 0 };
    },
    getOne: async (_r: string, params: { id: unknown }) => ({ data: { id: params.id } }),
    getMany: async () => ({ data: [] }),
    getManyReference: async () => ({ data: [], total: 0 }),
    create: async (_r: string, params: { data: unknown }) => ({ data: params.data }),
    update: async (_r: string, params: { data: unknown }) => ({ data: params.data }),
    updateMany: async () => ({ data: [] }),
    delete: async (_r: string, params: { id: unknown }) => ({ data: { id: params.id } }),
    deleteMany: async () => ({ data: [] }),
  } as unknown as DataProvider;
}

function renderEditor(
  assignments: Record<string, unknown>[],
  onSubmit: (values: unknown) => void = () => {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <TestMemoryRouter>
      <CoreAdminContext dataProvider={makeDataProvider()} queryClient={queryClient}>
        <Form record={{ tenantId: 'ke', assignments }} onSubmit={onSubmit}>
          <AssignmentEditor />
          <button type="submit">Save</button>
        </Form>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
}

/** The assignments array as the form would hand it to egov-hrms/_update. */
function submitted(onSubmit: ReturnType<typeof vi.fn>): SubmittedAssignment[] {
  const values = onSubmit.mock.calls[0][0] as { assignments?: SubmittedAssignment[] };
  return values.assignments ?? [];
}

/** Everything validateAssignments insists on, asserted in one place. */
function expectHrmsAccepts(sent: SubmittedAssignment[]) {
  const current = sent.filter((a) => a.isCurrentAssignment);
  expect(current).toHaveLength(1);
  expect(current[0].toDate ?? null).toBeNull();
  for (const a of sent) {
    if (a.isCurrentAssignment) continue;
    expect(typeof a.toDate).toBe('number');
    // Own period, then the "current assignment is the latest one" rule.
    expect(a.toDate!).toBeGreaterThanOrEqual(a.fromDate);
    expect(a.toDate!).toBeLessThanOrEqual(current[0].fromDate);
  }
}

beforeAll(() => {
  // Radix Select touches these on some jsdom code paths; polyfill defensively.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== 'function') proto.hasPointerCapture = () => false;
  if (typeof proto.setPointerCapture !== 'function') proto.setPointerCapture = () => {};
  if (typeof proto.releasePointerCapture !== 'function') proto.releasePointerCapture = () => {};
  if (typeof proto.scrollIntoView !== 'function') proto.scrollIntoView = () => {};
  // src/test/setup.ts installs ResizeObserver as `vi.fn().mockImplementation(…)`,
  // which vitest 4 refuses to `new` — and @floating-ui (under Radix's popper)
  // constructs one the moment a dropdown mounts.
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = TestResizeObserver;
});

describe('AssignmentEditor — #1957 revoking an assigned department', () => {
  it('handing `current` to another department closes the one it replaces', async () => {
    // The only route HRMS leaves open for revoking the department an employee
    // is actively working in. Both rows have to survive the trip.
    const onSubmit = vi.fn();
    renderEditor([HISTORICAL, CURRENT], onSubmit);

    const radios = await screen.findAllByRole('radio');
    fireEvent.click(radios[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const sent = submitted(onSubmit);
    expect(sent.map((a) => a.id)).toEqual(['asg-dept9', 'asg-admin']);
    expect(sent[0].isCurrentAssignment).toBe(true);
    expect(sent[1].isCurrentAssignment).toBe(false);
    expectHrmsAccepts(sent);
  });

  it('promoting an older assignment moves its start past the closing date', async () => {
    // ERR_HRMS_OVERLAPPING_ASSGN_CURRENT: a row that began BEFORE the one it
    // replaces can never be current while that row keeps a later toDate, so the
    // promoted row's fromDate has to move up. Nothing else can satisfy HRMS.
    const onSubmit = vi.fn();
    renderEditor([HISTORICAL, CURRENT], onSubmit);

    fireEvent.click((await screen.findAllByRole('radio'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const sent = submitted(onSubmit);
    expect(sent[0].fromDate).toBeGreaterThan(HISTORICAL.fromDate);
    expect(sent[0].fromDate).toBeGreaterThanOrEqual(sent[1].toDate!);
  });

  it('ends a saved department instead of dropping it from the payload', async () => {
    // An open non-current row (no toDate) is the one case the row button can
    // close on its own — and the id must still be in the payload afterwards.
    const onSubmit = vi.fn();
    const open = { ...HISTORICAL, toDate: undefined };
    renderEditor([open, CURRENT], onSubmit);

    fireEvent.click(await screen.findByRole('button', { name: 'End assignment 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const sent = submitted(onSubmit);
    expect(sent.map((a) => a.id)).toEqual(['asg-dept9', 'asg-admin']);
    expect(sent[0].isCurrentAssignment).toBe(false);
    expectHrmsAccepts(sent);
  });

  it('will not end the last current assignment, because HRMS demands exactly one', async () => {
    renderEditor([HISTORICAL, CURRENT]);

    const button = await screen.findByRole('button', { name: 'End assignment 2' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Mark another assignment as current first');
  });

  it('says so plainly when a saved assignment has already ended', async () => {
    // The reporter's DEPT_9 row. HRMS cannot delete it, so the button explains
    // itself rather than pretending the click did something.
    renderEditor([HISTORICAL, CURRENT]);

    const button = await screen.findByRole('button', { name: 'End assignment 1' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      'Already ended — HRMS keeps assignment history and cannot delete a row',
    );
    expect(screen.getByText(/retained as history/)).toBeInTheDocument();
  });

  it('a row the operator added but never saved is removed outright', async () => {
    // No id means HRMS has never seen it, so nothing needs to be preserved.
    const onSubmit = vi.fn();
    renderEditor([CURRENT], onSubmit);

    fireEvent.click(await screen.findByRole('button', { name: 'Add assignment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove assignment 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(submitted(onSubmit).map((a) => a.id)).toEqual(['asg-admin']);
  });
});
