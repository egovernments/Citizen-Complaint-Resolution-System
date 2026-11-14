import { describe, it, expect, vi } from 'vitest';
import { resetStaffPassword, resetErrorMessage, ResetPasswordError, canResetPasswords } from './resetPassword';

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('reset a staff member\'s password (identity-bff admin, generate mode)', () => {
  it('posts generate + logout for the 2.x uuid with the DIGIT token, and returns the one-time password', async () => {
    const f = reply(200, { status: 'ok', uuid: 'u-1', temporary: true, sessionsEnded: 2, password: 'Ab3@xyzXYZ12' });
    const r = await resetStaffPassword('tok', 'ke.bomet', 'u-1', f as unknown as typeof fetch);
    expect(r).toEqual({ password: 'Ab3@xyzXYZ12', sessionsEnded: 2 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/identity\/v1\/admin\/users\/_password$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(String(init.body))).toEqual({ tenantId: 'ke.bomet', user: 'u-1', generate: true, logout: true });
  });
  it('maps the legacy Errors[0].code to a message, never a raw error', async () => {
    const f = reply(403, { Errors: [{ code: 'NOT_IN_SUBTREE', message: 'x' }] });
    const err = await resetStaffPassword('tok', 'ke', 'u-2', f as unknown as typeof fetch).catch((e) => e);
    expect(err).toBeInstanceOf(ResetPasswordError);
    expect(err.code).toBe('NOT_IN_SUBTREE');
    expect(resetErrorMessage(err.code)).toMatch(/outside the tenants you administer/);
    expect(resetErrorMessage('SOMETHING_NEW')).toMatch(/could not be reset/);
  });
  it('a 200 without a password is an error (never shows an empty password)', async () => {
    const err = await resetStaffPassword('tok', 'ke', 'u-3', reply(200, { status: 'ok' }) as unknown as typeof fetch).catch((e) => e);
    expect(err.code).toBe('INVALID_RESPONSE');
  });
  it('the action shows only to ACCOUNT_ADMIN / HRMS_ADMIN holders', () => {
    expect(canResetPasswords(['GRO', 'HRMS_ADMIN'])).toBe(true);
    expect(canResetPasswords(['account_admin'])).toBe(true);
    expect(canResetPasswords(['GRO', 'MDMS_ADMIN'])).toBe(false);
    expect(canResetPasswords(undefined)).toBe(false);
  });
});
