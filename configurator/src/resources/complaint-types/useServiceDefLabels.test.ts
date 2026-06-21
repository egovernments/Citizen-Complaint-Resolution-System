import { describe, it, expect, vi } from 'vitest';

// Isolate the module's bridge import (the hook itself isn't exercised here).
vi.mock('@/providers/bridge', () => ({
  digitClient: { stateTenantId: 'pb', localizationSearch: vi.fn() },
}));

import { buildServiceDefLabelMap } from './useServiceDefLabels';

describe('buildServiceDefLabelMap', () => {
  it('maps code → message and skips rows missing a code or message', () => {
    const map = buildServiceDefLabelMap([
      { code: 'SERVICEDEFS.COMPLAINTS.CATEGORIES.X', message: 'Garbage' },
      { code: 'SERVICEDEFS.Y' },
      { message: 'orphan' },
    ]);
    expect(map).toEqual({ 'SERVICEDEFS.COMPLAINTS.CATEGORIES.X': 'Garbage' });
  });
});
