// @vitest-environment jsdom
//
// Create-side parity for ThemeConfig (single-source-of-truth follow-up):
// MdmsResourceCreate must dispatch 'theme-config' to the same tabbed/
// live-preview editor Edit already uses, not the generic schema-driven form.

import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoreAdminContext, ResourceContextProvider, TestMemoryRouter, type DataProvider } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';
import { MdmsResourceCreate } from '../MdmsResourceCreate';

function makeDataProvider(): DataProvider {
  return {
    getList: async () => ({ data: [], total: 0 }),
    getOne: async (_resource, params) => ({ data: { id: params.id } }),
    getMany: async () => ({ data: [] }),
    getManyReference: async () => ({ data: [], total: 0 }),
    create: async (_resource, params) => ({ data: { ...params.data, id: 'new-id' } }),
    update: async (_resource, params) => ({ data: { ...params.data, id: params.id } }),
    delete: async (_resource, params) => ({ data: { id: params.id } }),
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
});
