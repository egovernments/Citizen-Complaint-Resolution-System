import { beforeEach, describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';
import { identifyUser, pseudonymousId } from './telemetry';

describe('admin identity', () => {
  beforeEach(() => {
    vi.mocked(posthog.identify).mockClear();
    vi.mocked(Sentry.setUser).mockClear();
  });

  it('is a stable hash of the uuid, never the uuid itself', async () => {
    const id = await pseudonymousId('7c1f3a52-uuid');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(await pseudonymousId('7c1f3a52-uuid')).toBe(id);
    expect(await pseudonymousId('another-uuid')).not.toBe(id);
  });

  it('sends PostHog and Sentry only the hash and the roles', async () => {
    await identifyUser({ uuid: '7c1f3a52-uuid', tenant: 'ke', roles: ['SUPERUSER', 'EMPLOYEE'] });
    const id = await pseudonymousId('7c1f3a52-uuid');
    expect(posthog.identify).toHaveBeenCalledWith(id, { roles: 'SUPERUSER, EMPLOYEE' });
    expect(Sentry.setUser).toHaveBeenCalledWith({ id });
  });

  it('stays anonymous without a uuid', async () => {
    await identifyUser({ tenant: 'ke', roles: [] });
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(Sentry.setUser).not.toHaveBeenCalled();
  });
});
