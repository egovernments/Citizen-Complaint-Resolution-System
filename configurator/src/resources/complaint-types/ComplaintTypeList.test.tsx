import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const { upsertMessages, cacheBust } = vi.hoisted(() => ({
  upsertMessages: vi.fn().mockResolvedValue({ success: 1, failed: 0 }),
  cacheBust: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/api/services/localization', () => ({
  localizationService: { upsertMessages, cacheBust },
}));
vi.mock('@/hooks/useAvailableLocales', () => ({
  useAvailableLocales: () => ({ locales: [{ value: 'en_IN' }] }),
}));
vi.mock('@/providers/bridge', () => ({ digitClient: { stateTenantId: 'pb' } }));

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ toast }));

// Type labels come from the rainmaker-pgr SERVICEDEFS map; mock it so tests can
// control whether a real label exists (else the UI humanizes the menuPath).
const labelsState = vi.hoisted(() => ({ labels: {} as Record<string, string> }));
vi.mock('./useServiceDefLabels', () => ({
  useServiceDefLabels: () => ({ labels: labelsState.labels, refetch: vi.fn() }),
}));

vi.mock('ra-core', () => ({
  useTranslate: () => (key: string, opts?: { _?: string }) => opts?._ ?? key,
  useDataProvider: () => ({ delete: vi.fn().mockResolvedValue({ data: {} }) }),
  useLocaleState: () => ['en_IN', vi.fn()],
  useGetList: () => ({
    data: [
      {
        id: 'GarbageNotCollected',
        serviceCode: 'GarbageNotCollected',
        name: 'Garbage not collected',
        menuPath: 'Sanitation',
        department: 'Public Health',
        slaHours: 48,
        active: true,
        order: 1,
      },
      {
        id: 'PotHole',
        serviceCode: 'PotHole',
        name: 'Pot hole',
        menuPath: 'Roads',
        slaHours: 72,
        active: true,
        order: 2,
      },
      {
        id: 'Streetlight',
        serviceCode: 'Streetlight',
        name: 'Street light broken',
        slaHours: 24,
        active: true,
        order: 3,
      },
    ],
    isPending: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { ComplaintTypeList } from './ComplaintTypeList';

describe('ComplaintTypeList (accordion)', () => {
  afterEach(() => {
    labelsState.labels = {};
  });

  it('shows the real SERVICEDEFS label as a normal name (not a code) when localization provides one', () => {
    labelsState.labels = { 'SERVICEDEFS.SANITATION': 'Sanitation & Waste' };
    render(<ComplaintTypeList />);
    const label = screen.getByText('Sanitation & Waste');
    expect(label).toBeInTheDocument();
    expect(label).not.toHaveClass('font-mono');
  });

  it('shows an unlabeled type as its menuPath code in monospace', () => {
    labelsState.labels = {};
    render(<ComplaintTypeList />);
    const label = screen.getByText('Sanitation');
    expect(label).toHaveClass('font-mono');
  });

  it('renders complaint type rows collapsed by default', () => {
    render(<ComplaintTypeList />);
    expect(screen.getByText('Sanitation')).toBeInTheDocument();
    expect(screen.getByText('Roads')).toBeInTheDocument();
    // sub-type rows hidden while collapsed
    expect(screen.queryByText('Garbage not collected')).not.toBeInTheDocument();
  });

  it('expands a type to reveal its sub-types on click', () => {
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByText('Sanitation'));
    expect(screen.getByText('Garbage not collected')).toBeInTheDocument();
  });

  it('filters and auto-expands matching sub-types when searching', () => {
    render(<ComplaintTypeList />);
    const input = screen.getByPlaceholderText('Search complaint types…');
    fireEvent.change(input, { target: { value: 'garbage' } });
    // matching type auto-expands and shows the matching sub-type
    expect(screen.getByText('Garbage not collected')).toBeInTheDocument();
    // non-matching type is hidden
    expect(screen.queryByText('Roads')).not.toBeInTheDocument();
  });

  it('navigates to the create page with the type menuPath when adding a sub-type', () => {
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByText('Sanitation')); // expand the group
    fireEvent.click(screen.getByText('Add Sub-Type'));
    expect(navigate).toHaveBeenCalledWith(
      '/manage/complaint-types/create?menuPath=Sanitation',
    );
  });

  it('navigates to the create page (no menuPath) when adding a complaint type', () => {
    navigate.mockClear();
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByText('Add Complaint Type'));
    expect(navigate).toHaveBeenCalledWith('/manage/complaint-types/create');
  });

  it('shows a rename action on a type row but not on Uncategorized', () => {
    render(<ComplaintTypeList />);
    expect(screen.getByLabelText('Rename Sanitation')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rename Uncategorized')).not.toBeInTheDocument();
  });

  it('renames a type: upserts SERVICEDEFS.<menuPath> for the current locale only, then cache-busts', async () => {
    upsertMessages.mockClear();
    cacheBust.mockClear();
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByLabelText('Rename Sanitation'));
    const input = await screen.findByLabelText('Complaint type display name');
    fireEvent.change(input, { target: { value: 'Sanitation & Waste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(cacheBust).toHaveBeenCalled());
    // Only the active locale is written — other languages are left untouched.
    expect(upsertMessages).toHaveBeenCalledTimes(1);
    expect(upsertMessages).toHaveBeenCalledWith(
      'pb',
      'en_IN',
      [{ code: 'SERVICEDEFS.SANITATION', message: 'Sanitation & Waste', module: 'rainmaker-pgr', locale: 'en_IN' }],
    );
  });

  it('clicking rename does not toggle the type open', () => {
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByLabelText('Rename Sanitation'));
    // The sub-type stays hidden because the row didn't expand.
    expect(screen.queryByText('Garbage not collected')).not.toBeInTheDocument();
  });

  it('shows a toast after deleting a sub-type', async () => {
    toast.mockClear();
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByText('Sanitation')); // expand
    fireEvent.click(screen.getByLabelText('Delete Garbage not collected'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Sub-type deleted' }),
      ),
    );
  });
});
