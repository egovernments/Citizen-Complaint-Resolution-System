/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useAvailableLocales', () => ({
  useAvailableLocales: () => ({ locales: [] }),
}));
vi.mock('@/api/services/localization', () => ({ localizationService: {} }));
vi.mock('@/providers/bridge', () => ({ digitClient: { stateTenantId: 'pb' } }));

vi.mock('@/admin', () => ({
  DigitCreate: ({ title, record, children }: any) => (
    <div
      data-testid="create"
      data-title={title}
      data-menupath={String(record?.menuPath)}
    >
      {children}
    </div>
  ),
  DigitFormInput: ({ source, disabled }: any) => (
    <div data-testid={`input-${source}`} data-disabled={String(!!disabled)} />
  ),
  DigitFormSelect: ({ source }: any) => <div data-testid={`select-${source}`} />,
  DigitFormCodeInput: ({ source }: any) => <div data-testid={`code-${source}`} />,
  v: {
    required: () => undefined,
    name: () => undefined,
    slaHours: () => undefined,
    codeRequired: () => undefined,
  },
}));

import { ComplaintTypeCreate } from './ComplaintTypeCreate';

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/manage/complaint-types/create${search}`]}>
      <ComplaintTypeCreate />
    </MemoryRouter>,
  );
}

describe('ComplaintTypeCreate', () => {
  it('prefills and locks menuPath when ?menuPath is provided', () => {
    renderAt('?menuPath=Sanitation');
    expect(screen.getByTestId('create').dataset.menupath).toBe('Sanitation');
    expect(screen.getByTestId('input-menuPath').dataset.disabled).toBe('true');
  });

  it('defaults menuPath and leaves it editable without a query param', () => {
    renderAt('');
    expect(screen.getByTestId('create').dataset.menupath).toBe('Complaint');
    expect(screen.getByTestId('input-menuPath').dataset.disabled).toBe('false');
  });
});
