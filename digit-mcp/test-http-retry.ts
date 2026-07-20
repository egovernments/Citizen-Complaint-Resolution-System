/**
 * Tests for HTTP retry with exponential backoff (issue #25).
 * Uses globalThis.fetch override to simulate 429/503 responses
 * and verify retry behavior.
 *
 * Usage: npx tsx test-http-retry.ts
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`);
  }
}

// Track fetch calls
let fetchCallCount = 0;
let fetchResponses: Array<{ status: number; body: unknown; headers?: Record<string, string> }> = [];
const originalFetch = globalThis.fetch;

function mockFetch(responses: typeof fetchResponses): void {
  fetchCallCount = 0;
  fetchResponses = responses;
  // @ts-expect-error — overriding fetch for testing
  globalThis.fetch = async (_url: string, _opts?: RequestInit) => {
    const resp = fetchResponses[fetchCallCount] || fetchResponses[fetchResponses.length - 1];
    fetchCallCount++;
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      headers: {
        get: (name: string) => resp.headers?.[name] ?? null,
      },
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    } as unknown as Response;
  };
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

console.log('=== HTTP Retry Tests ===\n');

// Import after mock is set up — the module doesn't call fetch at import time
// We need to set env vars and then use a fresh import
process.env.CRS_ENVIRONMENT = 'chakshu-digit';

// Dynamically import to get a fresh client
const { digitApi } = await import('./src/services/digit-api.js');

// We need to authenticate first (mock the login)
mockFetch([{ status: 200, body: { access_token: 'test-token', UserRequest: { userName: 'TEST', name: 'Test', tenantId: 'pg' } } }]);
await digitApi.login('TEST', 'pass', 'pg');
restoreFetch();

// 1. No retry on success (200)
console.log('1. No retry on 200 OK');
mockFetch([{ status: 200, body: { mdms: [{ data: { code: 'TEST' } }] } }]);
try {
  await digitApi.mdmsV2Search('pg', 'test.Schema');
  assert(fetchCallCount === 1, `Single fetch call on success (got ${fetchCallCount})`);
} catch {
  assert(false, 'Should not throw on 200');
}
restoreFetch();

// 2. No retry on 400 (client error)
console.log('\n2. No retry on 400 Bad Request');
mockFetch([{ status: 400, body: { Errors: [{ code: 'BAD', message: 'Bad request' }] } }]);
try {
  await digitApi.mdmsV2Search('pg', 'test.Schema');
  assert(false, 'Should throw on 400');
} catch (err) {
  assert(fetchCallCount === 1, `Single fetch call on 400 (got ${fetchCallCount})`);
  assert((err as Error).message.includes('Bad request'), 'Error message preserved');
}
restoreFetch();

// 3. No retry on 401 (auth error)
console.log('\n3. No retry on 401 Unauthorized');
mockFetch([{ status: 401, body: { Errors: [{ code: 'AUTH', message: 'Unauthorized' }] } }]);
try {
  await digitApi.mdmsV2Search('pg', 'test.Schema');
  assert(false, 'Should throw on 401');
} catch {
  assert(fetchCallCount === 1, `Single fetch call on 401 (got ${fetchCallCount})`);
}
restoreFetch();

// 4. Retry on 429 then succeed
console.log('\n4. Retry on 429 → success on 2nd attempt');
mockFetch([
  { status: 429, body: {}, headers: {} },
  { status: 200, body: { mdms: [{ data: { code: 'RETRIED' } }] } },
]);
try {
  const result = await digitApi.mdmsV2Search<{ code: string }>('pg', 'test.Schema');
  assert(fetchCallCount === 2, `Two fetch calls on 429→200 (got ${fetchCallCount})`);
  assert(result[0]?.code === 'RETRIED', 'Got correct data after retry');
} catch (err) {
  assert(false, `Should not throw: ${(err as Error).message}`);
}
restoreFetch();

// 5. Retry on 503 then succeed
console.log('\n5. Retry on 503 → success on 2nd attempt');
mockFetch([
  { status: 503, body: {} },
  { status: 200, body: { mdms: [] } },
]);
try {
  await digitApi.mdmsV2Search('pg', 'test.Schema');
  assert(fetchCallCount === 2, `Two fetch calls on 503→200 (got ${fetchCallCount})`);
} catch {
  assert(false, 'Should not throw on 503→200');
}
restoreFetch();

// 6. All 3 retries exhausted on 429
console.log('\n6. All 3 retries exhausted on persistent 429');
mockFetch([
  { status: 429, body: {} },
  { status: 429, body: {} },
  { status: 429, body: { Errors: [{ code: 'RATE_LIMIT', message: 'Too many requests' }] } },
]);
try {
  await digitApi.mdmsV2Search('pg', 'test.Schema');
  assert(false, 'Should throw after 3 retries');
} catch (err) {
  assert(fetchCallCount === 3, `Exactly 3 fetch calls (got ${fetchCallCount})`);
  assert((err as Error).message.includes('Too many requests') || (err as Error).message.includes('429'), 'Error includes rate limit info');
}
restoreFetch();

// 7. Retry-After header is respected (we can't easily test timing, but verify it doesn't crash)
console.log('\n7. Retry-After header handling');
mockFetch([
  { status: 429, body: {}, headers: { 'Retry-After': '1' } },
  { status: 200, body: { mdms: [] } },
]);
try {
  await digitApi.mdmsV2Search('pg', 'test.Schema');
  assert(fetchCallCount === 2, `Retried with Retry-After header (got ${fetchCallCount})`);
} catch {
  assert(false, 'Should not throw with Retry-After → 200');
}
restoreFetch();

// 8. No retry on 500 (server error, not retryable)
console.log('\n8. No retry on 500 Internal Server Error');
mockFetch([{ status: 500, body: { Errors: [{ code: 'INTERNAL', message: 'Server error' }] } }]);
try {
  await digitApi.mdmsV2Search('pg', 'test.Schema');
  assert(false, 'Should throw on 500');
} catch {
  assert(fetchCallCount === 1, `Single fetch call on 500 (got ${fetchCallCount})`);
}
restoreFetch();

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
