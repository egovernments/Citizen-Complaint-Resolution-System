import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/react';
import { maskPersonal } from './personalData';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './sentryScrub';

describe('Sentry scrub', () => {
  it('masks emails and phone numbers however they are written', () => {
    expect(maskPersonal('User amina.o@example.co.ke with mobile 0712 345 678 or +254-712-345678 exists'))
      .toBe('User [email] with mobile [number] or [number] exists');
  });

  it('leaves codes, short numbers and dates alone', () => {
    expect(maskPersonal('HTTP 400 at row 12 on 2026-10-19: DUPLICATE_CODE')).toBe('HTTP 400 at row 12 on 2026-10-19: DUPLICATE_CODE');
  });

  it('masks the message, exceptions, extras and breadcrumbs, and drops queries', () => {
    const event = scrubSentryEvent({
      type: undefined,
      message: 'failed for a@b.ke',
      exception: { values: [{ type: 'Error', value: 'mobile 0712345678 taken' }] },
      extra: { tenant: 'ke', detail: { reason: 'a@b.ke' } },
      request: { url: 'https://x.test/configurator/signup?token=abc', query_string: 'token=abc' },
      breadcrumbs: [{ message: 'sent to a@b.ke', data: { url: '/api?mobile=0712345678' } }],
    } as ErrorEvent);
    expect(event.message).toBe('failed for [email]');
    expect(event.exception?.values?.[0].value).toBe('mobile [number] taken');
    expect(event.extra).toEqual({ tenant: 'ke', detail: { reason: '[email]' } });
    expect(event.request).toEqual({ url: 'https://x.test/configurator/signup' });
    expect(event.breadcrumbs?.[0]).toEqual({ message: 'sent to [email]', data: { url: '/api' } });
  });

  it('keeps navigation breadcrumbs as paths', () => {
    expect(scrubSentryBreadcrumb({ category: 'navigation', data: { from: '/a?x=1', to: '/b#c' } }).data).toEqual({ from: '/a', to: '/b' });
  });
});
