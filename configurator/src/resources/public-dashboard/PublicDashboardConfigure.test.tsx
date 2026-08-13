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
});
