// @vitest-environment jsdom
//
// The data-testid hooks are for the integration suite to find a Related list
// without matching its label: the label is copy ("Complaint Types" →
// "Complaint Categories" in #2243 broke departments 5a), and the empty-state
// "No … found" sentence is built from it. Pin the hook on every render state,
// keep a failed lookup distinguishable from an empty list, and keep two lists
// on one page (as DepartmentShow renders them) addressable separately —
// Playwright's getByTestId is strict.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

type ManyRefResult = {
  data?: Array<{ id: string; name: string; code?: string }>;
  total?: number;
  isPending: boolean;
  error?: Error | null;
};
let mockResult: ManyRefResult;

vi.mock('ra-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ra-core')>()),
  useGetManyReference: () => mockResult,
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}));

import { ReverseReferenceList } from './ReverseReferenceList';

describe('ReverseReferenceList test hook', () => {
  const props = { resource: 'complaint-hierarchy', target: 'department', id: 'MEDICAL_SVC', label: 'Complaint Categories' };

  const cases: Array<[string, ManyRefResult]> = [
    ['loading', { isPending: true }],
    ['error', { isPending: false, error: new Error('HTTP 403') }],
    ['empty', { data: [], total: 0, isPending: false }],
    ['loaded', { data: [{ id: 'C1', name: 'Medical' }], total: 1, isPending: false }],
  ];
  it.each(cases)('carries reverse-ref-<resource> and data-state=%s', (state, result) => {
    mockResult = result;
    render(<ReverseReferenceList {...props} />);
    const el = screen.getByTestId('reverse-ref-complaint-hierarchy');
    expect(el.getAttribute('data-state')).toBe(state);
    expect(el.getAttribute('data-target')).toBe('department');
  });

  it('gives the two lists DepartmentShow renders distinct, unique hooks', () => {
    mockResult = { data: [{ id: 'C1', name: 'Medical', code: 'E1' }], total: 1, isPending: false };
    render(
      <>
        <ReverseReferenceList resource="complaint-hierarchy" target="department" id="D1" label="Complaint Categories" />
        <ReverseReferenceList resource="employees" target="assignments.department" id="D1" label="Employees" displayField="code" />
      </>,
    );
    // getByTestId throws on zero or on more than one match.
    expect(screen.getByTestId('reverse-ref-complaint-hierarchy')).not.toBe(screen.getByTestId('reverse-ref-employees'));
  });
});
