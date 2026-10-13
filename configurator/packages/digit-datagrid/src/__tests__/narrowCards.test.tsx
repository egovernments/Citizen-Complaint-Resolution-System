import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DigitDatagrid } from '../DigitDatagrid';
import type { DigitColumn } from '../columns/types';

vi.mock('ra-core', () => ({
  useListContext: () => ({
    data: [{ id: '1', code: 'D1', name: 'Health' }], total: 1, page: 1, perPage: 25,
    setPage: vi.fn(), sort: { field: 'code', order: 'ASC' }, setSort: vi.fn(), isPending: false,
  }),
  useResourceContext: () => 'departments',
  useTranslate: () => (_k: string, o?: { _?: string }) => o?._ ?? _k,
  useUpdate: () => [vi.fn()],
  useDelete: () => [vi.fn()],
  useGetList: () => ({ data: [], isPending: false }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const cols: DigitColumn[] = [{ source: 'code', label: 'Code' }, { source: 'name', label: 'Name' }];
const mm = (matches: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

// cfgreview F22 (#1568): a phone gets stacked cards, a desktop the table.
describe('DigitDatagrid on a phone', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('renders card rows below md', () => {
    mm(true);
    render(<DigitDatagrid columns={cols} />);
    expect(screen.getByTestId('datagrid-cards')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Health')).toBeTruthy();
  });
  it('keeps the table from md up', () => {
    mm(false);
    render(<DigitDatagrid columns={cols} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByTestId('datagrid-cards')).toBeNull();
  });
});
