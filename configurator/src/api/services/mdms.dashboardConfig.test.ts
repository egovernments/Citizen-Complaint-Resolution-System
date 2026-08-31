import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('../client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    buildRequestInfo: () => ({ apiId: 'test' }),
  },
}));

import { mdmsService } from './mdms';

const SCHEMA = 'dss.DashboardConfig';
const lastCall = () => post.mock.calls[post.mock.calls.length - 1];

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ Mdms: {} });
});

describe('DashboardConfig write path', () => {
  it('patches an owned record without dropping existing config fields', async () => {
    post.mockResolvedValueOnce({ mdms: [{
      id: 'row-1',
      tenantId: 'ke',
      schemaCode: SCHEMA,
      uniqueIdentifier: 'default',
      isActive: true,
      data: {
        id: 'default',
        timeZone: 'Africa/Nairobi',
        publicDashboardEnabled: false,
      },
    }] });

    await mdmsService.upsertDashboardConfig('ke', { publicDashboardEnabled: true });

    const [url, body] = lastCall();
    expect(url).toContain('_update');
    expect(body.Mdms.data).toMatchObject({
      id: 'default',
      timeZone: 'Africa/Nairobi',
      publicDashboardEnabled: true,
    });
  });

  it('creates a schema-valid default record for an unconfigured state root', async () => {
    post.mockResolvedValueOnce({ mdms: [] });

    await mdmsService.upsertDashboardConfig('ke', { publicDashboardEnabled: true });

    const [url, body] = lastCall();
    expect(url).toContain('_create');
    expect(body.Mdms).toMatchObject({
      tenantId: 'ke',
      schemaCode: SCHEMA,
      uniqueIdentifier: 'default',
      data: { id: 'default', publicDashboardEnabled: true },
    });
    expect(body.Mdms.data).not.toHaveProperty('allowedRoles');
  });

  it('does not rewrite an inherited record', async () => {
    post.mockResolvedValueOnce({ mdms: [{
      id: 'parent', tenantId: 'ke', schemaCode: SCHEMA,
      uniqueIdentifier: 'default', isActive: true,
      data: { id: 'default', publicDashboardEnabled: true },
    }] });

    await mdmsService.upsertDashboardConfig('ke.bomet', { publicDashboardEnabled: false });

    expect(lastCall()[0]).toContain('_create');
    expect(lastCall()[1].Mdms.tenantId).toBe('ke.bomet');
  });

  it('refreshes the protected analytics config cache', async () => {
    post.mockResolvedValueOnce({ publicDashboardEnabled: true });

    await expect(mdmsService.refreshDashboardConfig('ke')).resolves.toBe(true);

    expect(lastCall()[0]).toBe('/pgr-services/v2/analytics/config/_refresh');
    expect(lastCall()[1]).toMatchObject({ tenantId: 'ke', RequestInfo: { apiId: 'test' } });
  });
});
