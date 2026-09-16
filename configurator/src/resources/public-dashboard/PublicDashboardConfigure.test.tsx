import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConfig, upsertConfig, refreshConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  upsertConfig: vi.fn(),
  refreshConfig: vi.fn(),
}));

vi.mock('@/App', () => ({
  useApp: () => ({
    state: { tenant: 'ke.bomet', environment: 'https://complaints.example/' },
  }),
}));
vi.mock('@/api', () => ({ getConfiguredRootTenant: () => 'ke' }));
vi.mock('@/api/services/mdms', () => ({
  mdmsService: {
    getDashboardConfig: (...args: unknown[]) => getConfig(...args),
    upsertDashboardConfig: (...args: unknown[]) => upsertConfig(...args),
    refreshDashboardConfig: (...args: unknown[]) => refreshConfig(...args),
  },
}));

import PublicDashboardConfigure from './PublicDashboardConfigure';

beforeEach(() => {
  getConfig.mockReset().mockResolvedValue(null);
  upsertConfig.mockReset().mockResolvedValue({});
  refreshConfig.mockReset().mockResolvedValue(true);
});

describe('PublicDashboardConfigure', () => {
  it('shows the canonical state-level public URL', async () => {
    render(<PublicDashboardConfigure />);

    const url = await screen.findByLabelText('Public dashboard URL');
    expect(url).toHaveValue('https://complaints.example/digit-ui/public-dashboard');
    expect(screen.getByText(/Control credential-free access/)).toHaveTextContent('ke');
  });

  it('persists and immediately applies the enable switch', async () => {
    render(<PublicDashboardConfigure />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable public dashboard' }));

    await waitFor(() => {
      expect(upsertConfig).toHaveBeenCalledWith('ke', { publicDashboardEnabled: true });
      expect(refreshConfig).toHaveBeenCalledWith('ke');
    });
    expect(await screen.findByText('Public dashboard enabled and available at the URL above.'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable public dashboard' })).toBeEnabled();
  });

  it('loads the saved time zone, defaulting to Africa/Nairobi when unset', async () => {
    render(<PublicDashboardConfigure />);
    const select = await screen.findByLabelText('Dashboard time zone');
    expect(select).toHaveValue('Africa/Nairobi');
  });

  it('shows a tenant-configured time zone instead of the default', async () => {
    getConfig.mockResolvedValue({ data: { id: 'default', timeZone: 'Asia/Kolkata' } });
    render(<PublicDashboardConfigure />);
    const select = await screen.findByLabelText('Dashboard time zone');
    expect(select).toHaveValue('Asia/Kolkata');
  });

  it('still shows a saved value the runtime tz database does not recognize (not blank)', async () => {
    getConfig.mockResolvedValue({ data: { id: 'default', timeZone: 'Bogus/Zone' } });
    render(<PublicDashboardConfigure />);
    const select = await screen.findByLabelText('Dashboard time zone');
    expect(select).toHaveValue('Bogus/Zone');
  });

  it('persists and refreshes on time zone change', async () => {
    render(<PublicDashboardConfigure />);
    const select = await screen.findByLabelText('Dashboard time zone');
    fireEvent.change(select, { target: { value: 'Africa/Maputo' } });

    await waitFor(() => {
      expect(upsertConfig).toHaveBeenCalledWith('ke', { timeZone: 'Africa/Maputo' });
      expect(refreshConfig).toHaveBeenCalledWith('ke');
    });
    expect(await screen.findByText('Dashboard time zone set to Africa/Maputo.')).toBeInTheDocument();
  });

  it('reverts to the PREVIOUS value (not just the default) when the save fails', async () => {
    // Starts from a non-default zone so a buggy always-reset-to-Nairobi revert would fail this.
    getConfig.mockResolvedValue({ data: { id: 'default', timeZone: 'Asia/Kolkata' } });
    upsertConfig.mockRejectedValue(new Error('mdms-v2 unreachable'));
    render(<PublicDashboardConfigure />);
    const select = await screen.findByLabelText('Dashboard time zone');
    await waitFor(() => expect(select).toHaveValue('Asia/Kolkata'));

    fireEvent.change(select, { target: { value: 'Africa/Maputo' } });

    expect(await screen.findByText('mdms-v2 unreachable')).toBeInTheDocument();
    expect(select).toHaveValue('Asia/Kolkata');
  });
});
