// @vitest-environment jsdom
//
// CFG-2 (gap G9) — Configure-tab dual-master write path, happy path.
//
// Component-level smoke test proving the "Add notification" flow writes BOTH
// MDMS masters (notification-routing + notification-template) and — critically —
// that the routing.toState is the RESOLVED applicationStatus NAME, not the raw
// workflow UUID that the workflow-v2 action.nextState carries.
//
// The failure / duplicate / reactivation / key-change branches (plan items 2–5)
// are covered exhaustively at the pure-module level in notificationWritePath.test.ts
// (saveNotificationPair / upsert / isMdmsDuplicate) and the phantom-200 case in
// packages/data-provider/src/client/DigitApiClient.test.ts — those live behaviors
// are hard to drive through Radix selects in jsdom and are better asserted on the
// extracted helper. This file only asserts the item-1 happy path end to end.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoreAdminContext, TestMemoryRouter } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';

// Partial-mock ra-core: keep everything real (CoreAdminContext, the mutation
// hooks, TestMemoryRouter) and only swap useNotify for a spy so the toast
// surface is observable without a NotificationContext provider.
const { notifySpy } = vi.hoisted(() => ({ notifySpy: vi.fn() }));
vi.mock('ra-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ra-core')>();
  return { ...actual, useNotify: () => notifySpy };
});

import NotificationConfigure from './NotificationConfigure';

// PGR_LIVE-shaped workflow record: action.nextState is the target state's UUID,
// and the target state carries the applicationStatus NAME. The Configure tab
// must resolve uuid-lme -> PENDINGATLME before writing routing.toState. Trimmed
// to one ASSIGN transition (plus its resolution-target state) so exactly one
// inline Add form renders — keeping the test off the Radix selects.
const PGR_LIVE_RECORD = {
  id: 'PGR',
  businessService: 'PGR',
  states: [
    {
      state: 'PENDINGFORASSIGNMENT',
      uuid: 'uuid-pfa',
      applicationStatus: 'PENDINGFORASSIGNMENT',
      isStartState: true,
      actions: [{ action: 'ASSIGN', nextState: 'uuid-lme', roles: ['GRO'] }],
    },
    {
      state: 'PENDINGATLME',
      uuid: 'uuid-lme',
      applicationStatus: 'PENDINGATLME',
      actions: [],
    },
  ],
};

function makeDataProvider() {
  return {
    getList: vi.fn(async (resource: string) => {
      switch (resource) {
        case 'workflow-business-services':
          return { data: [{ id: 'PGR', businessService: 'PGR' }], total: 1 };
        case 'access-roles':
          return {
            data: [
              { id: 'GRO', code: 'GRO', name: 'GRO' },
              { id: 'PGR_LME', code: 'PGR_LME', name: 'PGR_LME' },
            ],
            total: 2,
          };
        // notification-routing / notification-template start empty (fresh Add).
        default:
          return { data: [], total: 0 };
      }
    }),
    getOne: vi.fn(async (resource: string, params: { id: unknown }) => {
      if (resource === 'workflow-business-services') return { data: PGR_LIVE_RECORD };
      // EntityLink (actors) resolves access-roles by id.
      return { data: { id: params.id, code: params.id, name: String(params.id) } };
    }),
    getMany: vi.fn(async () => ({ data: [] })),
    getManyReference: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(async (resource: string, params: { data: Record<string, unknown> }) => ({
      data: { ...params.data, id: `created-${resource}` },
    })),
    update: vi.fn(async (_resource: string, params: { id: unknown; data: Record<string, unknown> }) => ({
      data: { ...params.data, id: params.id },
    })),
    delete: vi.fn(async (_resource: string, params: { id: unknown }) => ({ data: { id: params.id } })),
    deleteMany: vi.fn(async () => ({ data: [] })),
    updateMany: vi.fn(async () => ({ data: [] })),
  };
}

function renderConfigure(dataProvider: ReturnType<typeof makeDataProvider>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider as unknown as import('ra-core').DataProvider}
        queryClient={queryClient}
      >
        <NotificationConfigure />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
}

beforeAll(() => {
  // Radix Select touches these on some jsdom code paths; polyfill defensively.
  // Cast through Record so TS does not "always defined" narrow the guards.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== 'function') proto.hasPointerCapture = () => false;
  if (typeof proto.releasePointerCapture !== 'function') proto.releasePointerCapture = () => {};
  if (typeof proto.scrollIntoView !== 'function') proto.scrollIntoView = () => {};
});

describe('NotificationConfigure (Configure tab) — CFG-2 item 1', () => {
  it('add_createsBothMasters_withResolvedToState', async () => {
    notifySpy.mockClear();
    const dataProvider = makeDataProvider();
    renderConfigure(dataProvider);

    // Wait for the business service to load and the ASSIGN transition to render.
    const addBtn = await screen.findByRole('button', { name: 'Add' }, { timeout: 5000 });
    fireEvent.click(addBtn);

    // Inline form defaults: audience = first audienceOption (GRO), channel = SMS.
    // No select interaction needed — just type the body and Save.
    const body = await screen.findByPlaceholderText(/Message body/);
    fireEvent.change(body, { target: { value: 'Hi {id}, your complaint {status}.' } });

    const saveBtn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveBtn);

    // Both masters must be created.
    await waitFor(
      () => {
        const resources = dataProvider.create.mock.calls.map((c) => c[0]);
        expect(resources).toContain('notification-routing');
        expect(resources).toContain('notification-template');
      },
      { timeout: 5000 },
    );

    const routingCall = dataProvider.create.mock.calls.find((c) => c[0] === 'notification-routing');
    const templateCall = dataProvider.create.mock.calls.find((c) => c[0] === 'notification-template');

    // Routing master: toState is the RESOLVED status NAME, not the raw uuid-lme.
    expect(routingCall![1].data).toMatchObject({
      businessService: 'PGR',
      action: 'ASSIGN',
      toState: 'PENDINGATLME',
      audience: 'GRO',
      channel: 'SMS',
      active: true,
    });
    expect(routingCall![1].data.toState).not.toBe('uuid-lme');

    // Template master: default locale (en_IN) + the typed body.
    expect(templateCall![1].data).toMatchObject({
      audience: 'GRO',
      action: 'ASSIGN',
      toState: 'PENDINGATLME',
      channel: 'SMS',
      locale: 'en_IN',
      body: 'Hi {id}, your complaint {status}.',
      active: true,
    });

    // Post-W5 the mutations await with { returnPromise: true }, so the success
    // toast fires (and only after both writes resolve).
    await waitFor(() => {
      expect(notifySpy).toHaveBeenCalledWith('Notification added.', { type: 'success' });
    });
  });
});
