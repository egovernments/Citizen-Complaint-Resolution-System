import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConfig, upsertConfig, refreshConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  upsertConfig: vi.fn(),
  refreshConfig: vi.fn(),
}));

vi.mock('@/App', () => ({
  useApp: () => ({
    state: {
      tenant: 'ke.bomet',
      environment: 'https://complaints.example/',
      user: { name: 'Vikram Mehta', email: 'vikram@example.org' },
    },
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

/** MDMS record wrapper the screen reads `.data` off. */
const record = (data: Record<string, unknown>) => ({ data });

beforeEach(() => {
  getConfig.mockReset().mockResolvedValue(null);
  upsertConfig.mockReset().mockResolvedValue({});
  refreshConfig.mockReset().mockResolvedValue(true);
});

const openAccessDialog = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Manage public access' }));
  return screen.findByRole('dialog');
};

describe('PublicDashboardConfigure', () => {
  it('shows the canonical state-level public URL', async () => {
    render(<PublicDashboardConfigure />);

    const url = await screen.findByLabelText('Public dashboard URL');
    expect(url).toHaveValue('https://complaints.example/digit-ui/public-dashboard');
    expect(screen.getByText(/Control credential-free access/)).toHaveTextContent('ke');
  });

  it('enables in one click and stamps the published time', async () => {
    render(<PublicDashboardConfigure />);
    await openAccessDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Turn on public dashboard' }));

    await waitFor(() => expect(refreshConfig).toHaveBeenCalledWith('ke'));
    const [tenant, patch] = upsertConfig.mock.calls[0];
    expect(tenant).toBe('ke');
    expect(patch.publicDashboardEnabled).toBe(true);
    expect(typeof patch.lastPublishedAt).toBe('number');
    // Turning it back on must clear the stale attribution, so the notice can
    // never outlive the state it describes.
    expect(patch.disabledBy).toBe('');
    expect(patch.disabledAt).toBe(0);

    expect(await screen.findByText('Public dashboard enabled and available at the URL above.'))
      .toBeInTheDocument();
  });

  it('requires a confirmation step before disabling, and records who did it', async () => {
    getConfig.mockResolvedValue(record({ publicDashboardEnabled: true }));
    render(<PublicDashboardConfigure />);
    await openAccessDialog();

    // Stage 1 offers no immediate destructive action.
    fireEvent.click(screen.getByRole('button', { name: 'Turn off public dashboard' }));
    expect(upsertConfig).not.toHaveBeenCalled();

    // Stage 2 is the confirmation.
    expect(await screen.findByText('Turn off public dashboard?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off public dashboard' }));

    await waitFor(() => expect(upsertConfig).toHaveBeenCalledTimes(1));
    const [, patch] = upsertConfig.mock.calls[0];
    expect(patch.publicDashboardEnabled).toBe(false);
    expect(patch.disabledBy).toBe('Vikram Mehta');
    expect(typeof patch.disabledAt).toBe('number');
  });

  it('backs out of the confirmation without writing anything', async () => {
    getConfig.mockResolvedValue(record({ publicDashboardEnabled: true }));
    render(<PublicDashboardConfigure />);
    await openAccessDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Turn off public dashboard' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep dashboard active' }));

    // Back on stage 1, and nothing was persisted.
    expect(await screen.findByText('Public dashboard status')).toBeInTheDocument();
    expect(upsertConfig).not.toHaveBeenCalled();
    expect(refreshConfig).not.toHaveBeenCalled();
  });

  it('attributes the disable inside the Public URL box', async () => {
    getConfig.mockResolvedValue(record({
      publicDashboardEnabled: false,
      disabledBy: 'Vikram Mehta',
      disabledAt: Date.UTC(2026, 7, 1, 9, 30),
    }));
    render(<PublicDashboardConfigure />);

    const notice = await screen.findByTestId('disabled-attribution');
    expect(notice.textContent).toMatch(/^Public Dashboard disabled by Vikram Mehta on .+/);
  });

  it('shows no attribution while the dashboard is public', async () => {
    getConfig.mockResolvedValue(record({
      publicDashboardEnabled: true,
      disabledBy: 'Vikram Mehta',
      disabledAt: Date.UTC(2026, 7, 1, 9, 30),
    }));
    render(<PublicDashboardConfigure />);

    await screen.findByLabelText('Public dashboard URL');
    expect(screen.queryByTestId('disabled-attribution')).toBeNull();
  });

  it('renders an em dash when nothing has ever been published', async () => {
    getConfig.mockResolvedValue(record({ publicDashboardEnabled: true }));
    render(<PublicDashboardConfigure />);

    await screen.findByText('Last published');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the static preview on the Dashboard tab', async () => {
    render(<PublicDashboardConfigure />);

    // Preview labels, not KPI-table rows — the tab starts on Dashboard.
    expect(await screen.findByText('Complaint trends')).toBeInTheDocument();
    expect(screen.getByText('Map region')).toBeInTheDocument();
  });

  it('lists every KPI on the KPIs tab', async () => {
    render(<PublicDashboardConfigure />);
    // Radix selects a tab on mousedown, not a bare click.
    const tab = await screen.findByRole('tab', { name: 'KPIs' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);

    const table = await screen.findByRole('table');
    // Header row + one per KPI.
    expect(within(table).getAllByRole('row')).toHaveLength(9);
    for (const name of [
      'Complaints received', 'Complaints resolved', 'Resolution rate', 'SLA compliance',
      'Complaint trend over time', 'Complaints by service', 'Resolution performance',
      'Geographic distribution',
    ]) {
      expect(within(table).getByText(name)).toBeInTheDocument();
    }
  });
});
