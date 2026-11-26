import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// A tenant whose newest StateInfo row is a deactivated copy, ahead of the active
// one. MDMS v2 returns newest first and applies isActive before limit.
const stateInfoRows = [
  { uniqueIdentifier: 'copied', isActive: false, data: { languages: [{ value: 'en_IN' }, { value: 'hi_IN' }] } },
  { uniqueIdentifier: 'current', isActive: true, data: { languages: [{ value: 'en_IN', label: 'ENGLISH' }, { value: 'pt_MZ', label: 'PORTUGUÊS' }] } },
];

const mdmsSearch = vi.fn(async (_tenantId: string, _schema: string, options?: { limit?: number; isActive?: boolean }) => {
  const rows = options?.isActive === undefined ? stateInfoRows : stateInfoRows.filter((r) => r.isActive === options.isActive);
  return rows.slice(0, options?.limit ?? 100);
});

vi.mock('@/providers/bridge', () => ({
  digitClient: { stateTenantId: 'pg', mdmsSearch: (...args: Parameters<typeof mdmsSearch>) => mdmsSearch(...args) },
}));

import { useAvailableLocales } from './useAvailableLocales';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAvailableLocales', () => {
  it('reads the active StateInfo even when a newer inactive one exists', async () => {
    const { result } = renderHook(() => useAvailableLocales(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.locales.map((l) => l.value)).toEqual(['en_IN', 'pt_MZ', 'default']);
  });
});
