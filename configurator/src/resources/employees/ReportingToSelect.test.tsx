import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportingToSelect } from './ReportingToSelect';
import type { EmployeeCandidate } from '@/admin/hrms/useEmployeeLookup';

const CANDIDATES: EmployeeCandidate[] = [
  { uuid: 'u1', code: 'EMP1', name: 'Jane Doe' },
  { uuid: 'u2', code: 'EMP2', name: 'John Smith' },
];

describe('ReportingToSelect', () => {
  it('shows a placeholder and no manager when unset', () => {
    render(<ReportingToSelect id="rt" candidates={CANDIDATES} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search manager…')).toHaveValue('');
  });

  it('displays the selected manager\'s name and code', () => {
    render(<ReportingToSelect id="rt" value="u1" candidates={CANDIDATES} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Jane Doe (EMP1)')).toBeInTheDocument();
  });

  it('picking an option from the list calls onChange with that employee\'s uuid', () => {
    const onChange = vi.fn();
    render(<ReportingToSelect id="rt" candidates={CANDIDATES} onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText('Search manager…'));
    fireEvent.mouseDown(screen.getByText('John Smith'));
    expect(onChange).toHaveBeenCalledWith('u2');
  });

  it('filters candidates as you type', () => {
    render(<ReportingToSelect id="rt" candidates={CANDIDATES} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search manager…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'john' } });
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
  });

  it('excludes the given uuid so an employee cannot be set as their own manager', () => {
    render(
      <ReportingToSelect id="rt" candidates={CANDIDATES} onChange={vi.fn()} excludeUuid="u1" />,
    );
    fireEvent.focus(screen.getByPlaceholderText('Search manager…'));
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    expect(screen.getByText('John Smith')).toBeInTheDocument();
  });

  it('the clear button unsets the manager', () => {
    const onChange = vi.fn();
    render(<ReportingToSelect id="rt" value="u1" candidates={CANDIDATES} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Clear reporting manager'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
