/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useAvailableLocales', () => ({
  useAvailableLocales: () => ({ locales: [] }),
}));
vi.mock('@/api/services/localization', () => ({ localizationService: {} }));
vi.mock('@/providers/bridge', () => ({ digitClient: { stateTenantId: 'pb' } }));

// Capture the props passed to DigitCreate so we can assert on the transform fn.
const captured = vi.hoisted(() => ({ props: null as any }));

vi.mock('@/admin', () => ({
  DigitCreate: (props: any) => {
    captured.props = props;
    const { title, record, children } = props;
    return (
      <div
        data-testid="create"
        data-title={title}
        data-menupath={String(record?.menuPath)}
      >
        {children}
      </div>
    );
  },
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

  it('stamps the preset menuPath onto the payload via transform (survives RHF dropping the disabled field)', () => {
    renderAt('?menuPath=Sanitation');
    // RHF omits the disabled menuPath field, so the submitted data would lack it;
    // the transform must re-add it.
    expect(captured.props.transform({ name: 'Garbage', serviceCode: 'GARB' })).toEqual({
      name: 'Garbage',
      serviceCode: 'GARB',
      menuPath: 'Sanitation',
    });
  });

  it('provides no transform when menuPath is not preset', () => {
    renderAt('');
    expect(captured.props.transform).toBeUndefined();
  });
});
