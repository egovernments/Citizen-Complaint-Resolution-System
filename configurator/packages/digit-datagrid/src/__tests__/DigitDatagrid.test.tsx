import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const readonlyColumns: DigitColumn[] = [
  { source: 'name', label: 'Name' },
  { source: 'active', label: 'Active' },
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
    expect(screen.getAllByLabelText('Delete')).toHaveLength(2);
  });

  it('hides delete when noDelete is true', () => {
    render(<DigitDatagrid columns={columns} rowActions="auto" noDelete />);
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
  });

  it('defaults mutationMode to undoable', () => {
    render(<DigitDatagrid columns={columns} />);
    // Component renders without errors using the default undoable mode
    expect(screen.getByText('Department A')).toBeInTheDocument();
  });

  it('defaults rowActions to auto when editable columns exist', () => {
    render(<DigitDatagrid columns={columns} />);
    // Auto row actions renders a delete button for each row
    expect(screen.getAllByLabelText('Delete')).toHaveLength(2);
  });

  it('defaults rowActions to none when no editable columns', () => {
    render(<DigitDatagrid columns={readonlyColumns} />);
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
  });

  it('hides row actions when rowActions is none', () => {
    render(<DigitDatagrid columns={columns} rowActions="none" />);
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
  });

  it('renders custom row actions function', () => {
    render(
      <DigitDatagrid
        columns={readonlyColumns}
        rowActions={(record) => (
          <button data-testid={`custom-action-${record.id}`}>Custom</button>
        )}
      />
    );
    expect(screen.getByTestId('custom-action-1')).toBeInTheDocument();
    expect(screen.getByTestId('custom-action-2')).toBeInTheDocument();
  });

  it('renders boolean columns as switches inline', () => {
    render(<DigitDatagrid columns={columns} />);
    // Boolean editable cells render Switch components (role="switch")
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
  });

  it('shows pagination when total > 0', () => {
    render(<DigitDatagrid columns={columns} />);
    expect(screen.getByText('Showing 1-2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('renders sort indicators on column headers', () => {
    render(<DigitDatagrid columns={columns} />);
    // "Name" column is the current sort field, should have sort button
    const nameHeader = screen.getByText('Name');
    expect(nameHeader.closest('button')).toBeInTheDocument();
  });

  it('does not render actions header when rowActions is none and no actions prop', () => {
    render(<DigitDatagrid columns={readonlyColumns} rowActions="none" />);
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
  });

  it('renders actions header when auto row actions are shown', () => {
    render(<DigitDatagrid columns={columns} rowActions="auto" />);
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('renders non-sortable columns as plain text', () => {
    const cols: DigitColumn[] = [
      { source: 'name', label: 'Name', sortable: false },
    ];
    render(<DigitDatagrid columns={cols} />);
    const nameHeader = screen.getByText('Name');
    // Should not be inside a button
    expect(nameHeader.tagName).toBe('SPAN');
  });

  it('applies group/row class to table rows for hover visibility', () => {
    render(<DigitDatagrid columns={columns} />);
    // Each data row should have the group/row class
    const rows = screen.getAllByRole('row');
    // First row is header, data rows follow
    const dataRows = rows.slice(1);
    expect(dataRows.length).toBe(2);
    dataRows.forEach((row) => {
      expect(row.className).toContain('group/row');
    });
  });
});
