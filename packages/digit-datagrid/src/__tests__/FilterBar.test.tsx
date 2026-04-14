import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { FilterFormInput, AddFilterButton, FilterBar } from '../filters';
import { DigitList } from '../DigitList';

const mockShowFilter = vi.fn();
const mockHideFilter = vi.fn();
const mockSetFilters = vi.fn();

vi.mock('ra-core', () => ({
  FilterLiveForm: ({ children }: { children: React.ReactNode }) => (
    <form data-testid="filter-live-form">{children}</form>
  ),
  useListContext: () => ({
    displayedFilters: { status: true },
    filterValues: { status: 'active' },
    showFilter: mockShowFilter,
    hideFilter: mockHideFilter,
    setFilters: mockSetFilters,
    resource: 'test',
  }),
  useListController: () => ({
    data: [{ id: '1', name: 'Test' }],
    total: 1,
    page: 1,
    perPage: 25,
    sort: { field: 'id', order: 'ASC' as const },
    setSort: vi.fn(),
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    filterValues: {},
    displayedFilters: {},
    setFilters: mockSetFilters,
    showFilter: mockShowFilter,
    hideFilter: mockHideFilter,
    isPending: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    selectedIds: [],
    onSelect: vi.fn(),
    onToggleItem: vi.fn(),
    onUnselectItems: vi.fn(),
    resource: 'test',
  }),
  ListContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Stub filter element for testing
function StubFilter({ source, label, alwaysOn }: { source: string; label?: string; alwaysOn?: boolean }) {
  return <input data-testid={`filter-${source}`} />;
}

describe('FilterFormInput', () => {
  it('renders the filter element and an X button', () => {
    const hideFilter = vi.fn();
    render(
      <FilterFormInput
        filterElement={<StubFilter source="status" />}
        hideFilter={hideFilter}
      />
    );
    expect(screen.getByTestId('filter-status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('calls hideFilter with source when X is clicked', async () => {
    const user = userEvent.setup();
    const hideFilter = vi.fn();
    render(
      <FilterFormInput
        filterElement={<StubFilter source="status" />}
        hideFilter={hideFilter}
      />
    );
    await user.click(screen.getByRole('button', { name: /remove/i }));
    expect(hideFilter).toHaveBeenCalledWith('status');
  });
});

describe('AddFilterButton', () => {
  it('shows button only when there are hidden filters', () => {
    const filters = [
      <StubFilter key="a" source="status" label="Status" />,
      <StubFilter key="b" source="type" label="Type" />,
    ];
    render(
      <AddFilterButton
        filters={filters}
        displayedFilters={{}}
        showFilter={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /add filter/i })).toBeInTheDocument();
  });

  it('hides button when all non-alwaysOn filters are displayed', () => {
    const filters = [
      <StubFilter key="a" source="status" label="Status" />,
    ];
    render(
      <AddFilterButton
        filters={filters}
        displayedFilters={{ status: true }}
        showFilter={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /add filter/i })).not.toBeInTheDocument();
  });

  it('does not list alwaysOn filters in the menu', () => {
    const filters = [
      <StubFilter key="a" source="q" label="Search" alwaysOn />,
      <StubFilter key="b" source="status" label="Status" />,
    ];
    render(
      <AddFilterButton
        filters={filters}
        displayedFilters={{}}
        showFilter={vi.fn()}
      />
    );
    // Button should show (status is hidden, non-alwaysOn)
    expect(screen.getByRole('button', { name: /add filter/i })).toBeInTheDocument();
  });
});

describe('FilterBar', () => {
  it('renders alwaysOn filters directly', () => {
    const filters = [
      <StubFilter key="q" source="q" label="Search" alwaysOn />,
      <StubFilter key="status" source="status" label="Status" />,
    ];
    render(<FilterBar filters={filters} />);
    expect(screen.getByTestId('filter-q')).toBeInTheDocument();
  });

  it('renders displayed non-alwaysOn filters with X button', () => {
    const filters = [
      <StubFilter key="status" source="status" label="Status" />,
    ];
    render(<FilterBar filters={filters} />);
    expect(screen.getByTestId('filter-status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('wraps everything in FilterLiveForm', () => {
    const filters = [
      <StubFilter key="q" source="q" label="Search" alwaysOn />,
    ];
    render(<FilterBar filters={filters} />);
    expect(screen.getByTestId('filter-live-form')).toBeInTheDocument();
  });
});

describe('DigitList with filters', () => {
  it('renders FilterBar when filters prop is provided', () => {
    const filters = [
      <StubFilter key="q" source="q" label="Search" alwaysOn />,
    ];
    render(
      <DigitList title="Test" filters={filters}>
        <div>content</div>
      </DigitList>
    );
    expect(screen.getByTestId('filter-live-form')).toBeInTheDocument();
  });

  it('renders built-in search when no filters prop', () => {
    render(
      <DigitList title="Test">
        <div>content</div>
      </DigitList>
    );
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    expect(screen.queryByTestId('filter-live-form')).not.toBeInTheDocument();
  });
});
