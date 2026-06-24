import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastMock, getNotificationChannels, saveNotificationChannels } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  getNotificationChannels: vi.fn(),
  saveNotificationChannels: vi.fn(),
}));

vi.mock('../App', () => ({
  useApp: () => ({ state: { tenant: 'pb.amritsar', targetTenant: 'pb.amritsar' } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return { ...actual, configService: { getNotificationChannels, saveNotificationChannels } };
});

import CommunicationsSettingsPage from './CommunicationsSettingsPage';
import { ApiClientError } from '@/api';

beforeEach(() => {
  toastMock.mockReset();
  getNotificationChannels.mockReset().mockResolvedValue([]);
  saveNotificationChannels.mockReset().mockResolvedValue(undefined);
});

const saveBtn = () => screen.getByRole('button', { name: /^Save$/i });

describe('CommunicationsSettingsPage (management)', () => {
  it('renders channels OFF by default and targets the logged-in tenant', async () => {
    render(<CommunicationsSettingsPage />);
    await waitFor(() => expect(getNotificationChannels).toHaveBeenCalledWith('pb.amritsar'));

    expect(await screen.findByRole('switch', { name: 'Enable WhatsApp' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Enable SMS' })).not.toBeChecked();
  });

  it('pre-populates from existing config', async () => {
    getNotificationChannels.mockResolvedValue([{ code: 'WHATSAPP', name: 'WhatsApp', enabled: true }]);
    render(<CommunicationsSettingsPage />);
    expect(await screen.findByRole('switch', { name: 'Enable WhatsApp' })).toBeChecked();
  });

  it('saves toggled channels and toasts (no navigation in management)', async () => {
    render(<CommunicationsSettingsPage />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable WhatsApp' }));
    fireEvent.click(saveBtn());

    await waitFor(() => expect(saveNotificationChannels).toHaveBeenCalledTimes(1));
    const [tenant, channels] = saveNotificationChannels.mock.calls[0];
    expect(tenant).toBe('pb.amritsar');
    expect(channels).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'WHATSAPP', enabled: true })])
    );
    expect(toastMock).toHaveBeenCalled();
  });

  it('shows an error when saving fails', async () => {
    saveNotificationChannels.mockRejectedValue(
      new ApiClientError([{ code: 'CONFIG_ERR', message: 'config-service unavailable' }], 500)
    );
    render(<CommunicationsSettingsPage />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable WhatsApp' }));
    fireEvent.click(saveBtn());

    expect(await screen.findByText('config-service unavailable')).toBeInTheDocument();
  });
});
