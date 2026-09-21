// @vitest-environment jsdom
//
// Configure-tab dual-master write path, happy path.
//
// Component-level smoke test proving the "Add notification" flow writes BOTH
// MDMS masters (notifications-routing + notifications-template) with the EVENT
// key and a scheme-form audience — and that the screen renders from the event
// catalogue alone, with no workflow record anywhere in the mocked provider.
//
// The failure / duplicate / reactivation / key-change branches are covered
// exhaustively at the pure-module level in notificationWritePath.test.ts
// (saveNotificationPair / upsert / isMdmsDuplicate) and the phantom-200 case in
// packages/data-provider/src/client/DigitApiClient.test.ts — those live behaviors
// are hard to drive through Radix selects in jsdom and are better asserted on the
// extracted helper. This file only asserts the happy path end to end.

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

const EVENT = 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME';

/** One catalogue row, exactly as the seed-time generator emits it for PGR. */
const CATALOGUE_ROW = {
  id: EVENT,
  module: 'Complaints',
  eventName: EVENT,
  entityType: 'COMPLAINT',
  label: 'ASSIGN → PENDINGATLME',
  actors: [
    { name: 'citizen', label: 'The citizen who filed the complaint', required: true },
    { name: 'assignee', label: 'The employee the complaint is assigned to' },
  ],
  placeholders: [{ name: 'id' }, { name: 'status' }, { name: 'date' }],
  channels: ['SMS', 'WHATSAPP', 'EMAIL'],
  active: true,
};

function makeDataProvider() {
  return {
    getList: vi.fn(async (resource: string) => {
      switch (resource) {
        case 'notifications-event-catalogue':
          return { data: [CATALOGUE_ROW], total: 1 };
        case 'access-roles':
          return {
            data: [
              { id: 'GRO', code: 'GRO', name: 'GRO' },
              { id: 'PGR_LME', code: 'PGR_LME', name: 'PGR_LME' },
            ],
            total: 2,
          };
        // Every other master — the new ones and the legacy ones — starts empty:
        // a migrated tenant with a catalogue and nothing configured yet.
        default:
          return { data: [], total: 0 };
      }
    }),
    getOne: vi.fn(async (_resource: string, params: { id: unknown }) => ({ data: { id: params.id } })),
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

describe('NotificationConfigure (Configure tab)', () => {
  it('add_createsBothMasters_keyedOnTheCatalogueEvent', async () => {
    notifySpy.mockClear();
    const dataProvider = makeDataProvider();
    renderConfigure(dataProvider);

    // Wait for the catalogue to load and the event row to render.
    const addBtn = await screen.findByRole('button', { name: 'Add' }, { timeout: 5000 });
    fireEvent.click(addBtn);

    // Inline form defaults: audience = ACTOR:<first declared actor> (citizen),
    // channel = the event's first declared channel (SMS). No select interaction
    // needed — just type the body and Save.
    const body = await screen.findByPlaceholderText(/Message body/);
    fireEvent.change(body, { target: { value: 'Hi {id}, your complaint {status}.' } });

    const saveBtn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveBtn);

    // Both masters must be created — and they are the NOTIFICATIONS.* ones.
    await waitFor(
      () => {
        const resources = dataProvider.create.mock.calls.map((c) => c[0]);
        expect(resources).toContain('notifications-routing');
        expect(resources).toContain('notifications-template');
      },
      { timeout: 5000 },
    );

    const routingCall = dataProvider.create.mock.calls.find((c) => c[0] === 'notifications-routing');
    const templateCall = dataProvider.create.mock.calls.find((c) => c[0] === 'notifications-template');

    // Routing master: the EVENT key from the catalogue, and an audience written
    // in scheme form rather than a bare legacy name.
    expect(routingCall![1].data).toMatchObject({
      module: 'Complaints',
      eventName: EVENT,
      audience: 'ACTOR:citizen',
      channel: 'SMS',
      active: true,
    });
    // The dropped columns must not be written back by habit.
    expect(routingCall![1].data).not.toHaveProperty('businessService');
    expect(routingCall![1].data).not.toHaveProperty('action');
    expect(routingCall![1].data).not.toHaveProperty('toState');
    expect(routingCall![1].data).not.toHaveProperty('fromState');

    // Template master: default locale (en_IN) + the typed body.
    expect(templateCall![1].data).toMatchObject({
      module: 'Complaints',
      eventName: EVENT,
      audience: 'ACTOR:citizen',
      channel: 'SMS',
      locale: 'en_IN',
      body: 'Hi {id}, your complaint {status}.',
      active: true,
    });

    // The mutations await with { returnPromise: true }, so the success toast
    // fires (and only after both writes resolve).
    await waitFor(() => {
      expect(notifySpy).toHaveBeenCalledWith('Notification added.', { type: 'success' });
    });

    // The notification screens must not need the PGR workflow any more.
    const fetched = dataProvider.getList.mock.calls.map((c) => c[0]);
    expect(fetched).not.toContain('workflow-business-services');
    expect(dataProvider.getOne).not.toHaveBeenCalledWith('workflow-business-services', expect.anything(), expect.anything());
  });

  it('shows an un-migrated tenant its legacy rows, read-only, and offers no Add', async () => {
    notifySpy.mockClear();
    const dataProvider = makeDataProvider();
    // Nothing in NOTIFICATIONS.*; the live configuration is still the legacy rows.
    dataProvider.getList = vi.fn(async (resource: string) => {
      if (resource === 'notification-routing') {
        return {
          data: [{ id: 'PGR.ASSIGN.PENDINGATLME.CITIZEN.SMS', businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'SMS', active: true }],
          total: 1,
        };
      }
      if (resource === 'notification-template') {
        return {
          data: [{ id: 'CITIZEN.ASSIGN.PENDINGATLME.SMS.en_IN', audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS', locale: 'en_IN', body: 'Complaint {id} assigned', active: true }],
          total: 1,
        };
      }
      return { data: [], total: 0 };
    }) as unknown as typeof dataProvider.getList;

    renderConfigure(dataProvider);

    // The banner names the tenant's state and what to run — never just "read-only".
    await screen.findByText(/has not been migrated yet/i, undefined, { timeout: 5000 });
    expect(screen.getByText(/--tags notifications/)).toBeTruthy();

    // The legacy row is shown, translated into the new vocabulary...
    await screen.findByText(/citizen \(actor\) · SMS/i);
    // ...and there is no way to write anything from here.
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });
});
