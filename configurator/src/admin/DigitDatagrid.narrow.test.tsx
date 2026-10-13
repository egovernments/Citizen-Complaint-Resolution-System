import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListContextProvider, type ListControllerResult } from 'ra-core';
import { MemoryRouter } from 'react-router-dom';

vi.mock('ra-core', async (orig) => ({ ...(await orig<typeof import('ra-core')>()), useResourceContext: () => 'departments', useUpdate: () => [vi.fn()], useTranslate: () => (_k: string, o?: { _?: string }) => o?._ ?? _k }));
import { DigitDatagrid } from './DigitDatagrid';

const ctx = { data: [{ id: 'D1', code: 'D1', name: 'Health' }], total: 1, page: 1, perPage: 25, sort: { field: 'code', order: 'ASC' }, setSort: vi.fn(), setPage: vi.fn(), isPending: false } as unknown as ListControllerResult;
const cols = [{ source: 'code', label: 'Code' }, { source: 'name', label: 'Name' }];
const mm = (matches: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

// cfgreview F22 (#1568): a phone gets stacked cards, a desktop the table.
describe('DigitDatagrid on a phone', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('renders card rows below md', () => {
    mm(true);
    render(<MemoryRouter><ListContextProvider value={ctx}><DigitDatagrid columns={cols} /></ListContextProvider></MemoryRouter>);
    expect(screen.getByTestId('datagrid-cards')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Health')).toBeTruthy();
  });
  it('keeps the table from md up', () => {
    mm(false);
    render(<MemoryRouter><ListContextProvider value={ctx}><DigitDatagrid columns={cols} /></ListContextProvider></MemoryRouter>);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByTestId('datagrid-cards')).toBeNull();
  });
});
