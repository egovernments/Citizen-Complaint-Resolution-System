// @vitest-environment jsdom
//
// Notifications → Channels card: every write is validated like the other notification forms,
// nothing is written while the configuration is loading, and only a provider admin is offered
// the controls. Kanav review of #2097: 4079418184 (the card saved without the checker, so
// "enable with no provider" on a channel routing uses went through silently) and 4079418187
// (the card's controls were shown to everyone; non-admins learned from a 403).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoreAdminContext, TestMemoryRouter } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';

const { notifySpy, session } = vi.hoisted(() => ({
  notifySpy: vi.fn(),
  session: { roles: ['SUPERUSER'] as string[] },
}));
vi.mock('./providerToast', () => ({ notify: notifySpy }));
vi.mock('../../App', () => ({
  useApp: () => ({ state: { tenant: 'mz', user: { roles: session.roles } } }),
}));
vi.mock('./providerApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providerApi')>();
  return { ...actual, pullTemplates: vi.fn(async () => ({ data: [] })) };
});

import { ChannelStatusCard } from './ChannelStatusCard';

const EVENT = 'COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT';

function makeDataProvider(options: { rolesNeverLoad?: boolean } = {}) {
  return {
    getList: vi.fn(async (resource: string) => {
      switch (resource) {
        case 'notifications-channel':
          // Both off, no provider selected yet.
          return {
            data: [
              { id: 'SMS', code: 'SMS', enabled: false, gateway: 'novu', provider: null, active: true },
              { id: 'EMAIL', code: 'EMAIL', enabled: false, gateway: 'novu', provider: null, active: true },
            ],
            total: 2,
          };
        case 'notifications-event-catalogue':
          return { data: [{ id: EVENT, module: 'Complaints', eventName: EVENT, channels: ['SMS', 'EMAIL'], actors: [{ name: 'citizen' }], active: true }], total: 1 };
        case 'notifications-routing':
          // Routing uses SMS only.
          return { data: [{ id: `${EVENT}.ACTOR:citizen.SMS`, eventName: EVENT, audience: 'ACTOR:citizen', channel: 'SMS', active: true }], total: 1 };
        case 'notifications-template':
          return { data: [{ id: `${EVENT}.ACTOR:citizen.SMS.en_IN`, eventName: EVENT, audience: 'ACTOR:citizen', channel: 'SMS', locale: 'en_IN', body: 'Complaint {id} filed', active: true }], total: 1 };
        case 'access-roles':
          if (options.rolesNeverLoad) return new Promise(() => {});
          return { data: [], total: 0 };
        default:
          return { data: [], total: 0 };
      }
    }),
    getOne: vi.fn(async (_r: string, params: { id: unknown }) => ({ data: { id: params.id } })),
    getMany: vi.fn(async () => ({ data: [] })),
    getManyReference: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(async (_r: string, params: { data: Record<string, unknown> }) => ({ data: { ...params.data, id: 'new' } })),
    update: vi.fn(async (_r: string, params: { id: unknown; data: Record<string, unknown> }) => ({ data: { ...params.data, id: params.id } })),
    delete: vi.fn(async (_r: string, params: { id: unknown }) => ({ data: { id: params.id } })),
    deleteMany: vi.fn(async () => ({ data: [] })),
    updateMany: vi.fn(async () => ({ data: [] })),
  };
}

/** Renders each string's English default (`_`), as the bundled app does with no API strings. */
const i18nProvider = {
  translate: (key: string, options?: Record<string, unknown>) =>
    String(options?._ ?? key).replace(/%\{(\w+)\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  changeLocale: async () => {},
  getLocale: () => 'en',
};

function renderCard(dataProvider: ReturnType<typeof makeDataProvider>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const catalogState = { catalog: [], isLoading: false, error: null } as unknown as Parameters<typeof ChannelStatusCard>[0]['catalogState'];
  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider as unknown as import('ra-core').DataProvider}
        queryClient={queryClient}
        i18nProvider={i18nProvider}
      >
        <ChannelStatusCard catalogState={catalogState} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
}

/** The Enable buttons, in CHANNELS order: SMS, EMAIL, WHATSAPP. */
async function enableButtons() {
  return screen.findAllByRole('button', { name: 'Enable' }, { timeout: 5000 });
}

beforeEach(() => {
  notifySpy.mockClear();
  session.roles = ['SUPERUSER'];
});

describe('ChannelStatusCard', () => {
  it('refuses to switch on a channel routing uses when it has no provider (channel-needs-provider)', async () => {
    const dp = makeDataProvider();
    renderCard(dp);
    const [sms] = await enableButtons();
    // Click until the configuration has loaded: before that the answer is "still loading"
    // (also no write); after it, the checker's refusal.
    await waitFor(() => {
      fireEvent.click(sms);
      expect(String(notifySpy.mock.calls.at(-1)?.[0])).toContain('channel-needs-provider');
    }, { timeout: 5000 });
    expect(notifySpy.mock.calls.every((c) => /channel-needs-provider|still loading/.test(String(c[0])))).toBe(true);
    expect(dp.update).not.toHaveBeenCalled();
    expect(dp.create).not.toHaveBeenCalled();
  });

  it('saves a change the checker only warns about (EMAIL: nothing routes on it yet)', async () => {
    const dp = makeDataProvider();
    renderCard(dp);
    const buttons = await enableButtons();
    await waitFor(() => {
      if (dp.update.mock.calls.length === 0) fireEvent.click(buttons[1]);
      expect(dp.update).toHaveBeenCalled();
    }, { timeout: 5000 });
    expect(notifySpy.mock.calls.every((c) => /still loading/.test(String(c[0])))).toBe(true);
    const [resource, params] = dp.update.mock.calls[0] as unknown as [string, { data: Record<string, unknown> }];
    expect(resource).toBe('notifications-channel');
    expect(params.data).toMatchObject({ code: 'EMAIL', enabled: true });
  });

  it('writes nothing while the configuration the check needs is still loading', async () => {
    const dp = makeDataProvider({ rolesNeverLoad: true });
    renderCard(dp);
    const buttons = await enableButtons();
    fireEvent.click(buttons[1]);   // EMAIL: would be allowed once loaded
    await waitFor(() => expect(notifySpy).toHaveBeenCalled());
    expect(String(notifySpy.mock.calls[0][0])).toMatch(/still loading/);
    expect(dp.update).not.toHaveBeenCalled();
  });

  it('offers a non-admin no controls, and says why', async () => {
    session.roles = ['EMPLOYEE', 'GRO'];
    const dp = makeDataProvider();
    renderCard(dp);
    await screen.findByTestId('channels-admin-only', undefined, { timeout: 5000 });
    await screen.findByText('SMS');
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
