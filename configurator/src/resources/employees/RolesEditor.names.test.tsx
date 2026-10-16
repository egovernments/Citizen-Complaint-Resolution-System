import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// cfgreview F17 (#1563): roles are shown and picked by name, the code after it.
vi.mock('ra-core', () => ({
  useInput: () => ({
    id: 'roles', isRequired: false, fieldState: {},
    field: { value: [{ code: 'GRO', name: 'Grievance Routing Officer', tenantId: 'ke.bomet' }], onChange: vi.fn() },
  }),
}));
vi.mock('@/admin/hrms/useRolesLookup', () => ({
  useRolesLookup: () => ({
    roles: [{ code: 'GRO', name: 'Grievance Routing Officer' }, { code: 'PGR_LME', name: 'Last Mile Employee' }, { code: 'X_ROLE', name: 'X_ROLE' }],
    isLoading: false, isError: false, buildRole: (code: string, tenantId: string) => ({ code, name: code, tenantId }),
  }),
}));
import { RolesEditor } from './RolesEditor';

describe('RolesEditor names', () => {
  it('shows a held role by name, then its code (the code stays first for the accessible name)', () => {
    render(<RolesEditor tenantId="ke.bomet" />);
    const chip = screen.getByText('Grievance Routing Officer');
    expect(chip.className).toContain('order-1');
    expect(screen.getByText('GRO').className).toContain('order-2');
    expect(screen.getByLabelText('remove GRO')).toBeInTheDocument();
  });
  it('offers roles by name (code muted), a role without a name once', () => {
    render(<RolesEditor tenantId="ke.bomet" />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Last Mile Employee').className).toContain('order-1');
    expect(screen.getByText('PGR_LME').className).toContain('order-2');
    // scripts and screen readers find an option by its code: the accessible name starts with it
    expect(screen.getByRole('option', { name: /^PGR_LME/ })).toBeTruthy();
    expect(screen.getAllByText('X_ROLE')).toHaveLength(1);
  });
});
