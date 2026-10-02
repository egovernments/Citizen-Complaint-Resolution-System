// @vitest-environment jsdom
//
// Regression coverage for CCRS #1957 — "User is unable to revoke the access of
// a particular jurisdiction/department that was already assigned to user".
//
// The department half of that bug. egov-hrms treats assignments as append-only
// and gives them no isActive flag, so EmployeeValidator boxes a client in from
// several sides at once:
//
//   validateConsistencyAssignment  every previously stored assignment id must
//                                  come back, or the whole update fails with
//                                  ERR_HRMS_UPDATE_ASSIGNEMENT_INCOSISTENT
//   validateAssignments            exactly ONE assignment may be current, and
//                                  every non-current one must carry a toDate
//                                  (ERR_HRMS_INVALID_ASSIGNMENT_NON_CURRENT_TO_DATE)
//                                  that is not before its own fromDate
//                                  (ERR_HRMS_INVALID_ASSIGNMENT_PERIOD)
//   validateAssignments            EVERY non-current assignment must have ended
//                                  by the time the current one starts
//                                  (ERR_HRMS_OVERLAPPING_ASSGN_CURRENT) — which
//                                  HRMS also enforces on create, so the current
//                                  assignment is always the latest one on record
//
// The editor used to splice the row out of the form value (tripping the first
// rule) and to hand `current` over without closing the row it demoted (tripping
// the second), so on bomet an admin could not take a department away from
// HR_CSR by any route. Revoking now goes through the "Current assignment"
// radio, which ends the outgoing row: it stays on record, and pgr-services'
// PolicyDrivenScopeResolver — which counts only current assignments — stops
// putting that department in the employee's scope.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoreAdminContext, Form, TestMemoryRouter, type DataProvider } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';
import { AssignmentEditor } from './AssignmentEditor';

const DEPARTMENTS = [
  { id: 'DEPT_1', code: 'DEPT_1', name: 'Department 1' },
  { id: 'DEPT_2', code: 'DEPT_2', name: 'Department 2' },
  { id: 'DEPT_3', code: 'DEPT_3', name: 'Department 3' },
  { id: 'ADMIN_PUBLIC_SVC', code: 'ADMIN_PUBLIC_SVC', name: 'Administration & Public Service' },
];

const DESIGNATIONS = [
  { id: 'chief_officer', code: 'chief_officer', name: 'Chief Officer' },
  { id: 'DESIG_58', code: 'DESIG_58', name: 'Designation 58' },
];

const DAY = 86_400_000;

/** HR_CSR as bomet actually stores it: one closed historical row + the current one. */
const HISTORICAL = {
  id: 'asg-dept9',
  department: 'DEPT_1',
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

/**
 * Everything validateAssignments insists on, asserted in one place, and applied
 * to EVERY non-current row because that is how HRMS applies it.
 */
function expectHrmsAccepts(sent: SubmittedAssignment[]) {
  const current = sent.filter((a) => a.isCurrentAssignment);
  expect(current).toHaveLength(1);
  expect(current[0].toDate ?? null).toBeNull();
  for (const a of sent) {
    if (a.isCurrentAssignment) continue;
    expect(typeof a.toDate).toBe('number');
    expect(a.toDate!).toBeGreaterThanOrEqual(a.fromDate);
    expect(a.toDate!).toBeLessThanOrEqual(current[0].fromDate);
  }
  // No two windows may overlap once sorted by fromDate.
  const sorted = [...sent].sort((x, y) => x.fromDate - y.fromDate);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].toDate == null) continue;
    expect(sorted[i].toDate!).toBeLessThanOrEqual(sorted[i + 1].fromDate);
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

  it('closes a freshly added row that is left behind by the promotion', async () => {
    // The reachable multi-row defect. setCurrent used to close only the row it
    // demoted and skip every other non-current row, so a department the
    // operator had just added — non-current, no toDate yet — travelled to HRMS
    // with a null toDate and the save 400d on
    // ERR_HRMS_INVALID_ASSIGNMENT_NOT_CURRENT_TO_DATE. Verified against a live
    // egov-hrms: this exact payload is rejected before the fix, accepted after.
    const base = 1735689600000; // 2025-01-01
    const currentFrom = base + 300 * DAY;
    const rows = [
      { id: 'a1', department: 'DEPT_1', designation: 'DESIG_58', fromDate: base, toDate: base + 30 * DAY, isCurrentAssignment: false },
      { id: 'a2', department: 'DEPT_2', designation: 'DESIG_58', fromDate: currentFrom, isCurrentAssignment: true },
      // No id: what addRow plus the two pickers leaves in the form.
      { department: 'DEPT_3', designation: 'DESIG_58', fromDate: currentFrom + 10 * DAY, isCurrentAssignment: false },
    ];

    const onSubmit = vi.fn();
    renderEditor(rows, onSubmit);

    fireEvent.click((await screen.findAllByRole('radio'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const sent = submitted(onSubmit);
    expect(sent).toHaveLength(3);
    expect(sent[0].isCurrentAssignment).toBe(true);
    // The added row is the one that used to slip through unclosed.
    expect(typeof sent[2].toDate).toBe('number');
    expectHrmsAccepts(sent);
  });

  it('clamps a stale toDate hiding on the row it demotes', async () => {
    // Defensive rather than a live bug: HRMS itself rejects a current
    // assignment carrying a toDate (ERR_HRMS_INVALID_ASSIGNMENT_CURRENT_TO_DATE,
    // checked against a real instance), so this shape can only arrive through a
    // bulk import or a direct DB write. If it does, the To Date input is blanked
    // and disabled while the row is current, so the operator cannot see or fix
    // the value — and passing it through unclamped would submit
    // toDate < fromDate and 400 on ERR_HRMS_INVALID_ASSIGNMENT_PERIOD.
    const onSubmit = vi.fn();
    const staleCurrent = { ...CURRENT, toDate: CURRENT.fromDate - 400 * DAY };
    renderEditor([HISTORICAL, staleCurrent], onSubmit);

    fireEvent.click((await screen.findAllByRole('radio'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const sent = submitted(onSubmit);
    expect(sent[1].toDate!).toBeGreaterThanOrEqual(sent[1].fromDate);
    expectHrmsAccepts(sent);
  });

  it('offers no remove control on a saved row, because none could ever fire', async () => {
    // HRMS forbids a second current assignment and forbids a non-current row
    // with a null toDate, so every row it can actually store is either the sole
    // current one (nothing to hand off to) or already ended (nothing to end).
    // A disabled icon in both cases was just noise; the radio is the revoke.
    renderEditor([HISTORICAL, CURRENT]);

    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /assignment 1$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assignment 2$/ })).not.toBeInTheDocument();
    // The mechanism is explained once, under the list.
    expect(screen.getByText(/mark another one as the/i)).toBeInTheDocument();
  });

  it('marks a saved closed row as retained history', async () => {
    renderEditor([HISTORICAL, CURRENT]);
    expect(await screen.findByText(/retained as history/)).toBeInTheDocument();
  });

  it('does not call an unsaved row "retained as history"', async () => {
    // setCurrent stamps a toDate on whatever row it demotes. When that row is
    // one the operator just added and is about to delete, claiming HRMS retains
    // it as history is simply untrue.
    renderEditor([CURRENT]);

    fireEvent.click(await screen.findByRole('button', { name: 'Add assignment' }));
    // Make the new row current, then hand `current` back to the saved one.
    const radios = await screen.findAllByRole('radio');
    fireEvent.click(radios[1]);
    fireEvent.click((await screen.findAllByRole('radio'))[0]);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove assignment 2' })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/retained as history/)).not.toBeInTheDocument();
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

// Review round on PR #2152. Each case below is a reviewer finding, kept in its
// own block because none of them is about revoking as such: they are about the
// radio staying reversible, and about the editor not generating shapes HRMS
// rejects.
describe('AssignmentEditor — PR #2152 review findings', () => {
  it('returning `current` to the row that had it restores the dates it arrived with', async () => {
    // setCurrent rewrites fromDate to clear every close date on the record, so
    // without a snapshot the radio was a one-way door: promote a row, change
    // your mind, promote the original back, and the original would be saved as
    // having started today. HRMS then permanently records the wrong start date,
    // and re-typing the old one is refused with ERR_HRMS_OVERLAPPING_ASSGN_CURRENT.
    const onSubmit = vi.fn();
    renderEditor([HISTORICAL, CURRENT], onSubmit);

    const radios = await screen.findAllByRole('radio');
    fireEvent.click(radios[0]); // promote the historical row
    fireEvent.click((await screen.findAllByRole('radio'))[1]); // and change your mind
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const sent = submitted(onSubmit);
    const historical = sent.find((a) => a.id === 'asg-dept9')!;
    const current = sent.find((a) => a.id === 'asg-admin')!;

    expect(current.isCurrentAssignment).toBe(true);
    expect(current.fromDate).toBe(CURRENT.fromDate);
    expect(current.toDate ?? null).toBeNull();
    expect(historical.isCurrentAssignment).toBe(false);
    expect(historical.fromDate).toBe(HISTORICAL.fromDate);
    expect(historical.toDate).toBe(HISTORICAL.toDate);
    expectHrmsAccepts(sent);
  });

  it('generates dates at midnight UTC, so re-picking the same visible day is a no-op', async () => {
    // The inputs are <input type="date">: they render a day and parse back to
    // 00:00 UTC. A ms-precision Date.now() in fromDate/toDate therefore moves
    // backwards by up to 24h the moment an operator re-selects the date already
    // showing, dropping the promoted row below the toDate just stamped on the
    // row it demoted and 400ing on ERR_HRMS_OVERLAPPING_ASSGN_CURRENT.
    const onSubmit = vi.fn();
    const older = { id: 'a1', department: 'DEPT_1', designation: 'DESIG_58', fromDate: 1788048000000, toDate: 1788048000000 + DAY, isCurrentAssignment: false };
    const current = { id: 'a2', department: 'DEPT_2', designation: 'DESIG_58', fromDate: 1788048000000 + DAY, isCurrentAssignment: true };
    const { container } = renderEditor([older, current], onSubmit);

    fireEvent.click((await screen.findAllByRole('radio'))[0]);

    // Re-select the date the From Date box is already showing: a no-op to the
    // operator, and the exact gesture that used to break the save.
    const dateInputs = container.querySelectorAll('input[type="date"]');
    const promotedFrom = dateInputs[0] as HTMLInputElement;
    fireEvent.change(promotedFrom, { target: { value: promotedFrom.value } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const sent = submitted(onSubmit);

    for (const a of sent) {
      expect(a.fromDate % DAY).toBe(0);
      if (a.toDate != null) expect(a.toDate % DAY).toBe(0);
    }
    expectHrmsAccepts(sent);
  });

  it('does not tell a saved row to mark another current in order to remove it', async () => {
    // The remove button is suppressed on saved rows, but the hint explaining
    // why it is disabled sat outside that gate, so every saved employee's
    // current assignment carried instructions for a control it does not render.
    renderEditor([HISTORICAL, CURRENT]);

    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    expect(screen.queryByText(/Mark another assignment as current first/i)).not.toBeInTheDocument();
  });

  it('numbers the remove button by the position of the card it sits on', async () => {
    // Unlike JurisdictionEditor, this editor renders every row: suppressing the
    // button does not hide the card, so the payload index and the visible
    // position stay in step. Two saved rows plus one added row means the only
    // trash icon belongs to the third card on screen, and says so. Locked down
    // with three rows because a single-saved-row fixture cannot tell the two
    // numbering schemes apart.
    renderEditor([HISTORICAL, CURRENT]);

    fireEvent.click(await screen.findByRole('button', { name: 'Add assignment' }));

    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(3));
    const removeButtons = screen.getAllByRole('button', { name: /^Remove assignment/ });
    expect(removeButtons).toHaveLength(1);
    expect(removeButtons[0]).toHaveAccessibleName('Remove assignment 3');
  });

  it('blocks a save that would send a non-current assignment with no To Date', async () => {
    // Add assignment creates exactly the shape HRMS always rejects
    // (ERR_HRMS_INVALID_ASSIGNMENT_NOT_CURRENT_TO_DATE): non-current from birth,
    // no toDate. setCurrent covers the rows it demotes, but an operator who adds
    // a department and saves without touching a radio never goes through it.
    const onSubmit = vi.fn();
    renderEditor(
      [
        CURRENT,
        { department: 'DEPT_3', designation: 'DESIG_58', fromDate: CURRENT.fromDate + DAY, isCurrentAssignment: false },
      ],
      onSubmit,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/must have a To Date/i),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
