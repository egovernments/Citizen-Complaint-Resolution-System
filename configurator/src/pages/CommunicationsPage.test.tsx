import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- mocks ---------------------------------------------------------------
// vi.mock factories are hoisted above imports, so the fns they reference must
// be created with vi.hoisted (not plain top-level consts).
const { navigateMock, completePhaseMock, toastMock, getNotificationChannels, saveNotificationChannels } =
  vi.hoisted(() => ({
    navigateMock: vi.fn(),
    completePhaseMock: vi.fn(),
    toastMock: vi.fn(),
    getNotificationChannels: vi.fn(),
    saveNotificationChannels: vi.fn(),
  }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../App', () => ({
  useApp: () => ({
    completePhase: completePhaseMock,
    state: { tenant: 'pb.amritsar', targetTenant: 'pb.amritsar' },
  }),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    configService: { getNotificationChannels, saveNotificationChannels },
  };
});

import CommunicationsPage from './CommunicationsPage';
import { ApiClientError } from '@/api';

beforeEach(() => {
  navigateMock.mockReset();
  completePhaseMock.mockReset();
  toastMock.mockReset();
  getNotificationChannels.mockReset().mockResolvedValue([]);
  saveNotificationChannels.mockReset().mockResolvedValue(undefined);
});

const wa = () => screen.getByRole('switch', { name: 'Enable WhatsApp' });
const saveBtn = () => screen.getByRole('button', { name: /Save & Continue/i });

describe('CommunicationsPage', () => {
  it('renders all three channels OFF by default when nothing is configured', async () => {
    render(<CommunicationsPage />);
    await waitFor(() => expect(getNotificationChannels).toHaveBeenCalled());

    expect(await screen.findByRole('switch', { name: 'Enable WhatsApp' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Enable SMS' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Enable Email' })).not.toBeChecked();
  });

  it('pre-populates a toggle from existing enabled config', async () => {
    getNotificationChannels.mockResolvedValue([
      { code: 'WHATSAPP', name: 'WhatsApp', enabled: true },
    ]);
    render(<CommunicationsPage />);

    expect(await screen.findByRole('switch', { name: 'Enable WhatsApp' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Enable SMS' })).not.toBeChecked();
  });

  it('saves the toggled channels, toasts, completes the phase and navigates', async () => {
    render(<CommunicationsPage />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable WhatsApp' }));
    expect(wa()).toBeChecked();

    fireEvent.click(saveBtn());

    await waitFor(() => expect(saveNotificationChannels).toHaveBeenCalledTimes(1));
    const [tenant, channels] = saveNotificationChannels.mock.calls[0];
    expect(tenant).toBe('pb.amritsar');
    expect(channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'WHATSAPP', enabled: true }),
        expect.objectContaining({ code: 'SMS', enabled: false }),
        expect.objectContaining({ code: 'EMAIL', enabled: false }),
      ])
    );
    expect(toastMock).toHaveBeenCalled();
    expect(completePhaseMock).toHaveBeenCalledWith(5);
    expect(navigateMock).toHaveBeenCalledWith('/complete');
  });

  it('Skip writes nothing but still completes the phase and navigates', async () => {
    render(<CommunicationsPage />);
    await screen.findByRole('switch', { name: 'Enable WhatsApp' });

    fireEvent.click(screen.getByRole('button', { name: /Skip for now/i }));

    expect(saveNotificationChannels).not.toHaveBeenCalled();
    expect(completePhaseMock).toHaveBeenCalledWith(5);
    expect(navigateMock).toHaveBeenCalledWith('/complete');
  });

  it('shows an error and does not navigate when saving fails', async () => {
    saveNotificationChannels.mockRejectedValue(
      new ApiClientError([{ code: 'CONFIG_ERR', message: 'config-service exploded' }], 500)
    );
    render(<CommunicationsPage />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable WhatsApp' }));
    fireEvent.click(saveBtn());

    expect(await screen.findByText('config-service exploded')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(completePhaseMock).not.toHaveBeenCalled();
  });
});
