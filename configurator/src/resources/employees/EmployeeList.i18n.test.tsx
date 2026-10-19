// @vitest-environment jsdom
//
// #1880 review (PR #2211): deriving a header's code from its source turned the
// hand-written "Employee Code" column into `app.fields.code`, seeded as "Code".
// A hand-written English label must stay as written; coded labels still resolve.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoreAdminContext, ResourceContextProvider, TestMemoryRouter, type TranslationMessages } from 'ra-core';
import polyglotI18nProvider from 'ra-i18n-polyglot';
import { QueryClient } from '@tanstack/react-query';
import { EmployeeList } from './EmployeeList';

const messages = {
  // The seeded values that used to leak into the Employees header.
  app: { fields: { code: 'Code', name: 'Full name' } },
} as unknown as TranslationMessages;

function renderEmployees() {
  const dataProvider = {
    getList: vi.fn(async () => ({
      data: [{ id: 'EMP-1', code: 'EMP-1', user: { name: 'Asha' }, employeeStatus: 'EMPLOYED', isActive: true }],
      total: 1,
    })),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider as never}
        i18nProvider={polyglotI18nProvider(() => messages, 'en_IN', [], { allowMissing: true })}
        queryClient={queryClient}
      >
        <ResourceContextProvider value="employees">
          <EmployeeList />
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
}

describe('Employees list headers', () => {
  it('keeps the hand-written "Employee Code" header instead of the seeded app.fields.code', async () => {
    renderEmployees();
    const header = await screen.findByRole('button', { name: 'Employee Code' });
    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
    // No code to show in Inspect: "Employee Code" isn't a localization code.
    expect(header.querySelector('[data-i18n-key]')).toBeNull();
  });

  it('still resolves and tags a header whose label is a code', async () => {
    renderEmployees();
    const name = await screen.findByText('Full name');
    expect(name).toHaveAttribute('data-i18n-key', 'app.fields.name');
  });
});
