// @vitest-environment jsdom
//
// Create-side parity for ThemeConfig (single-source-of-truth follow-up):
// MdmsResourceCreate must dispatch 'theme-config' to the same tabbed/
// live-preview editor Edit already uses, not the generic schema-driven form.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoreAdminContext, ResourceContextProvider, TestMemoryRouter, type DataProvider } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';
import { MdmsResourceCreate } from '../MdmsResourceCreate';
import { digitClient } from '@/providers/bridge';
import type { MdmsRecord } from '@digit-mcp/data-provider';

// ThemeConfigCreate reads the current tenant via useApp() (to scope the
// deactivate-stale-siblings call after a successful create) — mock just that
// hook rather than mounting the real AppProvider, which drives full app
// login/session state unrelated to this dispatch test.
vi.mock('../../App', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../App')>();
  return { ...actual, useApp: () => ({ state: { tenant: 'pg' } }) };
});

function makeDataProvider(): DataProvider {
  return {
    getList: async () => ({ data: [], total: 0 }),
    getOne: async (_resource: string, params: { id: unknown }) => ({ data: { id: params.id } }),
    getMany: async () => ({ data: [] }),
    getManyReference: async () => ({ data: [], total: 0 }),
    create: async (_resource: string, params: { data: Record<string, unknown> }) => ({
      data: { ...params.data, id: 'new-id' },
    }),
    update: async (_resource: string, params: { id: unknown; data: Record<string, unknown> }) => ({
      data: { ...params.data, id: params.id },
    }),
    delete: async (_resource: string, params: { id: unknown }) => ({ data: { id: params.id } }),
    deleteMany: async () => ({ data: [] }),
    updateMany: async () => ({ data: [] }),
  } as unknown as DataProvider;
}

function renderCreate(resource: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <TestMemoryRouter>
      <CoreAdminContext dataProvider={makeDataProvider()} queryClient={queryClient}>
        <ResourceContextProvider value={resource}>
          <MdmsResourceCreate />
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== 'function') proto.hasPointerCapture = () => false;
  if (typeof proto.releasePointerCapture !== 'function') proto.releasePointerCapture = () => {};
  if (typeof proto.scrollIntoView !== 'function') proto.scrollIntoView = () => {};
});

describe('MdmsResourceCreate — theme-config dispatch', () => {
  it('mounts the tabbed/live-preview theme editor instead of the generic schema-driven form', async () => {
    renderCreate('theme-config');

    // The custom editor's tab labels (from theme-config.ts's descriptor
    // groups) and the live-preview panel are only present on that editor —
    // the generic form would show "Loading schema..." then plain inputs.
    expect(await screen.findByText('Live preview')).toBeInTheDocument();
    expect(screen.getByText('Brand & Surface')).toBeInTheDocument();
    expect(screen.queryByText('Loading schema...')).not.toBeInTheDocument();
  });

  it('still uses the generic form for a schema with no custom editor', async () => {
    renderCreate('departments');

    // No tabbed theme layout for an unrelated resource.
    expect(screen.queryByText('Live preview')).not.toBeInTheDocument();
  });

  it('deactivates other active themes on THIS tenant, but not a differently-coded row on another tenant, after create', async () => {
    const staleSameTenant: MdmsRecord = {
      id: '1', tenantId: 'pg', schemaCode: 'common-masters.ThemeConfig',
      uniqueIdentifier: 'old-theme', data: { code: 'old-theme' }, isActive: true,
    };
    const sameCodeRow: MdmsRecord = {
      id: '2', tenantId: 'pg', schemaCode: 'common-masters.ThemeConfig',
      uniqueIdentifier: 'maputo-green', data: { code: 'maputo-green' }, isActive: true,
    };
    // mdms-v2 resolves up the tenant tree, so a search at 'pg' can return a
    // row this tenant doesn't own (e.g. inherited from an ancestor). That row
    // must never be deactivated by a create at 'pg' — doing so would silently
    // re-theme every other tenant that inherits it.
    const otherTenantRow: MdmsRecord = {
      id: '3', tenantId: 'mz', schemaCode: 'common-masters.ThemeConfig',
      uniqueIdentifier: 'other-theme', data: { code: 'other-theme' }, isActive: true,
    };

    const searchSpy = vi
      .spyOn(digitClient, 'mdmsSearch')
      .mockResolvedValue([staleSameTenant, sameCodeRow, otherTenantRow]);
    const updateSpy = vi.spyOn(digitClient, 'mdmsUpdate').mockResolvedValue(staleSameTenant);

    renderCreate('theme-config');
    await screen.findByText('Live preview');

    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'maputo-green' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(searchSpy).toHaveBeenCalledWith('pg', 'common-masters.ThemeConfig', { limit: 200 });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(staleSameTenant, false);
  });
});
