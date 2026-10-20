import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OnboardingError,
  __setFetchForTests,
  tenants,
  checkIdentifier,
  createSignup,
  deriveAccountCode,
  findSignup,
  isOperationReady,
  isOperationSettled,
  isValidAccountCode,
  isValidUrlSlug,
  RESERVED_URL_SLUGS,
  newIdempotencyKey,
  session,
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
  it('uses every word of the name', () => {
    expect(deriveAccountCode('Bomet County Government', '')).toBe('BOMET-COUNTY-GOVERNMENT');
  });

  it('prefixes the country once one is chosen', () => {
    expect(deriveAccountCode('Bomet County Government', 'KE')).toBe('KE-BOMET-COUNTY-GOVERNMENT');
  });

  it('changes when a word is added or edited', () => {
    expect(deriveAccountCode('Bomet County', 'KE')).not.toBe(deriveAccountCode('Bomet County Government', 'KE'));
    expect(deriveAccountCode('Bomet County', 'KE')).not.toBe(deriveAccountCode('Bomet Countie', 'KE'));
  });

  it('cuts a long name at a word boundary inside the limit', () => {
    const code = deriveAccountCode('Municipal Corporation of Greater Mumbai Region', 'IN');
    expect(code).toBe('IN-MUNICIPAL-CORPORATION-OF');
    expect(isValidAccountCode(code)).toBe(true);
  });

  it('hard-cuts a single word longer than the limit', () => {
    const code = deriveAccountCode('A'.repeat(40), 'KE');
    expect(code).toHaveLength(32);
    expect(isValidAccountCode(code)).toBe(true);
  });

  it('drops punctuation', () => {
    expect(deriveAccountCode("  St. John's  Ward ", 'KE')).toBe('KE-ST-JOHN-S-WARD');
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

  it('rejects a leading hyphen and reserved words, like the server', () => {
    expect(isValidUrlSlug('-bomet')).toBe(false);
    expect(isValidUrlSlug('digit-ui')).toBe(false);
    expect(isValidUrlSlug('configurator')).toBe(false);
  });

  it('keeps the reserved slugs equal to the identity-bff contract list (docs §2.4.1)', () => {
    const doc = readFileSync(resolve(process.cwd(), '../backend/identity-bff/docs/identity-bff.md'), 'utf8');
    const block = /<!-- reserved-url-slugs:begin -->([\s\S]*?)<!-- reserved-url-slugs:end -->/.exec(doc);
    expect(block, 'identity-bff.md must keep the reserved-url-slugs block').toBeTruthy();
    const documented = block![1].split('\n').map((line) => line.trim()).filter((line) => /^[a-z0-9-]+$/.test(line));
    expect([...RESERVED_URL_SLUGS].sort()).toEqual(documented.sort());
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

describe('workspace discovery contract', () => {
  it('accepts tenant discovery without a readiness field', async () => {
    __setFetchForTests(async () => new Response(JSON.stringify({ tenants: [{ tenantId: 'acme', name: 'Acme', roles: [], organizationAlias: 'acme' }], selectionRequired: false, onboardingRequired: false }), { status: 200 }));
    const result = await tenants();
    expect(result.tenants[0].tenantId).toBe('acme');
  });
  it('preserves inactive account codes for the picker', async () => {
    __setFetchForTests(async () => new Response(JSON.stringify({ tenants: [{ tenantId: 'acme', code: 'DIGIT_ACCOUNT_INACTIVE' }] }), { status: 200 }));
    expect((await tenants()).tenants[0].code).toBe('DIGIT_ACCOUNT_INACTIVE');
  });
  it('keeps empty membership discovery separate from invitations', async () => {
    __setFetchForTests(async () => new Response(JSON.stringify({ tenants: [], onboardingRequired: true }), { status: 200 }));
    expect((await tenants()).tenants).toEqual([]);
  });
});

describe('operation readiness (CCRS#2303)', () => {
  it('keeps polling a success whose outcome is not yet published', () => {
    // SUCCEEDED is written a tick before the identity side lists the tenant.
    expect(isOperationSettled({ status: 'SUCCEEDED' })).toBe(false);
    expect(isOperationSettled({ status: 'SUCCEEDED', lifecyclePublishedAt: null })).toBe(false);
    expect(isOperationReady({ status: 'SUCCEEDED', lifecyclePublishedAt: null })).toBe(false);
  });

  it('is ready once the success is published', () => {
    expect(isOperationSettled({ status: 'SUCCEEDED', lifecyclePublishedAt: 1 })).toBe(true);
    expect(isOperationReady({ status: 'SUCCEEDED', lifecyclePublishedAt: 1 })).toBe(true);
  });

  it('settles failures without waiting for publication', () => {
    expect(isOperationSettled({ status: 'RETRYABLE_FAILED' })).toBe(true);
    expect(isOperationSettled({ status: 'TERMINAL_FAILED' })).toBe(true);
    expect(isOperationReady({ status: 'TERMINAL_FAILED', lifecyclePublishedAt: 1 })).toBe(false);
    expect(isOperationSettled({ status: 'RUNNING' })).toBe(false);
  });
});
