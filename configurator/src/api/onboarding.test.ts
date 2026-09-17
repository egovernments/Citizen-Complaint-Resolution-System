import { afterEach, describe, expect, it } from 'vitest';
import {
  OnboardingError,
  __setFetchForTests,
  checkIdentifier,
  createSignup,
  deriveAccountCode,
  findSignup,
  isValidAccountCode,
  isValidUrlSlug,
  newIdempotencyKey,
  session,
  tenantReadiness,
  type Signup,
  slugifyAccountName,
  submitSignup,
} from './onboarding';

type Call = { url: string; init: RequestInit };

/** Stands in for the network so the contract can be asserted without one. */
function stubFetch(responder: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  __setFetchForTests((async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    const { status = 200, body = {} } = responder(call);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as Response;
  }) as typeof fetch);
  return calls;
}

afterEach(() => __setFetchForTests(null));

describe('transport', () => {
  it('sends the identity cookie on every call', async () => {
    const calls = stubFetch(() => ({ body: { authenticated: true } }));
    await session();
    // The session is an opaque HttpOnly cookie; without this it never travels.
    expect(calls[0].init.credentials).toBe('include');
  });

  it('requires an idempotency key on create, and sends the one it was given', async () => {
    const calls = stubFetch(() => ({ status: 201, body: { Signup: { id: 'a' } } }));
    await createSignup({ accountName: 'Bomet County' }, 'key-123');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('key-123');
  });

  it('reuses the caller key on submit rather than minting a new one', async () => {
    const calls = stubFetch(() => ({ status: 202, body: { Operation: { id: 'op' } } }));
    await submitSignup('signup-1', 'submit-key');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('submit-key');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ Signup: { id: 'signup-1' } });
  });

  it('scopes an availability check to the current signup when editing', async () => {
    // Without signupId the draft collides with its own reservation.
    const calls = stubFetch(() => ({
      body: { Identifier: { type: 'URL_SLUG', value: 'bomet-county', available: true } },
    }));
    await checkIdentifier('URL_SLUG', 'bomet-county', 'signup-1');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Identifier: { type: 'URL_SLUG', value: 'bomet-county', signupId: 'signup-1' },
    });
  });

  it('reports an empty search as no signup rather than throwing', async () => {
    stubFetch(() => ({ body: { Signups: [] } }));
    await expect(findSignup()).resolves.toBeNull();
  });

  it('treats a 401 on session as signed out, not as a failure', async () => {
    stubFetch(() => ({ status: 401, body: { authenticated: false } }));
    await expect(session()).resolves.toEqual({ authenticated: false });
  });

  it('keeps the backend error code alongside the message', async () => {
    stubFetch(() => ({
      status: 409,
      body: { code: 'ONBOARDING_IDENTIFIER_TAKEN', message: 'That URL is taken.' },
    }));
    const caught = await createSignup({}, 'k').catch((e) => e);
    expect(caught).toBeInstanceOf(OnboardingError);
    expect((caught as OnboardingError).code).toBe('ONBOARDING_IDENTIFIER_TAKEN');
    expect((caught as OnboardingError).status).toBe(409);
  });
});

describe('idempotency keys', () => {
  it('are unique and inside the contract length', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a.length).toBeLessThanOrEqual(128);
  });
});

describe('deriveAccountCode', () => {
  it('takes the initials of the first three words', () => {
    expect(deriveAccountCode('Bomet County Government', '')).toBe('BCG');
  });

  it('prefixes the country once one is chosen', () => {
    expect(deriveAccountCode('Bomet County Government', 'KE')).toBe('KE-BCG');
  });

  it('ignores words beyond the third', () => {
    expect(deriveAccountCode('One Two Three Four Five', 'IN')).toBe('IN-OTT');
  });
});

describe('validation mirrors the server rules', () => {
  it('accepts a normal slug', () => {
    expect(isValidUrlSlug('bomet-county')).toBe(true);
  });

  it('rejects a slug with fewer than two letters', () => {
    // The server requires at least two letters, so a digits-only name has to be
    // fixed by the operator rather than silently padded.
    expect(isValidUrlSlug('12-34')).toBe(false);
  });

  it('rejects an uppercase slug', () => {
    expect(isValidUrlSlug('Bomet')).toBe(false);
  });

  it('accepts an account code of A-Z, 0-9 and hyphens', () => {
    expect(isValidAccountCode('KE-BCG')).toBe(true);
  });

  it('rejects a lowercase account code', () => {
    expect(isValidAccountCode('ke-bcg')).toBe(false);
  });
});

describe('slugifyAccountName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyAccountName('Bomet County Government')).toBe('bomet-county-government');
  });
});

describe('tenantReadiness', () => {
  const signup = (status: Signup['status'], tenantId = 'kisumucounty') =>
    ({ status, requestedTenantId: tenantId } as Signup);

  it('treats a root this path created as identity-ready, not ready', () => {
    // The contract's own position until the Level 1 baseline saga exists: the
    // identity floor is installed and nothing else.
    expect(tenantReadiness('kisumucounty', signup('ACTIVE'))).toBe('IDENTITY_READY');
  });

  it('reports a baseline job that is actually running', () => {
    expect(tenantReadiness('kisumucounty', signup('PROVISIONING'))).toBe('PROVISIONING');
  });

  it('reports a baseline job that did not finish', () => {
    expect(tenantReadiness('kisumucounty', signup('FAILED'))).toBe('FAILED');
  });

  it('leaves a tenant this path did not create alone', () => {
    // No signup at all, and a signup for a different tenant, are both somebody
    // else's provisioning. Gating them would be a guess.
    expect(tenantReadiness('pg', null)).toBe('READY');
    expect(tenantReadiness('pg', signup('ACTIVE'))).toBe('READY');
  });
});
