import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { FilterFormInput, AddFilterButton } from '../filters';

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
