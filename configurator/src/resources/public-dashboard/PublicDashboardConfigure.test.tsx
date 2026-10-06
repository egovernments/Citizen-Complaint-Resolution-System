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
vi.mock('@/identity/workspaceSlug', () => ({ useWorkspaceSlug: () => 'bomet' }));
vi.mock('@/api/services/mdms', () => ({
  mdmsService: {
    getDashboardConfig: (...args: unknown[]) => getConfig(...args),
    upsertDashboardConfig: (...args: unknown[]) => upsertConfig(...args),
    refreshDashboardConfig: (...args: unknown[]) => refreshConfig(...args),
  },
}));

// Provide a small, deterministic timezone list so tests don't depend on the
// host Node runtime's complete IANA dataset.
vi.mock('@/lib/timezones', () => ({
  listTimeZones: () => [
    'Africa/Maputo',
    'Africa/Nairobi',
    'Asia/Kolkata',
  ],
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
  it('shows the workspace-scoped public URL', async () => {
    render(<PublicDashboardConfigure />);

    const url = await screen.findByLabelText('Public dashboard URL');
    expect(url).toHaveValue('https://complaints.example/bomet/digit-ui/public-dashboard');
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

  it('loads the saved time zone, defaulting to Africa/Nairobi when unset', async () => {
    render(<PublicDashboardConfigure />);
    const input = await screen.findByRole('combobox', { name: 'Dashboard time zone' });
    expect(input).toHaveValue('Africa/Nairobi');
  });

  it('shows a tenant-configured time zone instead of the default', async () => {
    getConfig.mockResolvedValue({ data: { id: 'default', timeZone: 'Asia/Kolkata' } });
    render(<PublicDashboardConfigure />);
    const input = await screen.findByRole('combobox', { name: 'Dashboard time zone' });
    expect(input).toHaveValue('Asia/Kolkata');
  });

  it('still shows a saved value the runtime tz database does not recognize (not blank)', async () => {
    getConfig.mockResolvedValue({ data: { id: 'default', timeZone: 'Bogus/Zone' } });
    render(<PublicDashboardConfigure />);
    const input = await screen.findByRole('combobox', { name: 'Dashboard time zone' });
    expect(input).toHaveValue('Bogus/Zone');
  });

  it('filters options as the user types', async () => {
    render(<PublicDashboardConfigure />);
    const input = await screen.findByRole('combobox', { name: 'Dashboard time zone' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Kolkata' } });

    expect(await screen.findByRole('option', { name: 'Asia/Kolkata' })).toBeInTheDocument();
    // Other zones that don't match should not be visible.
    expect(screen.queryByRole('option', { name: 'Africa/Nairobi' })).toBeNull();
  });

  it('persists and refreshes on time zone change', async () => {
    render(<PublicDashboardConfigure />);
    const input = await screen.findByRole('combobox', { name: 'Dashboard time zone' });

    // Open the dropdown and click the target option.
    fireEvent.focus(input);
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'Africa/Maputo' }));

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
    const input = await screen.findByRole('combobox', { name: 'Dashboard time zone' });
    await waitFor(() => expect(input).toHaveValue('Asia/Kolkata'));

    // Open the dropdown and click a different option.
    fireEvent.focus(input);
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'Africa/Maputo' }));

    expect(await screen.findByText('mdms-v2 unreachable')).toBeInTheDocument();
    expect(input).toHaveValue('Asia/Kolkata');
  });
});
