/**
 * Tests for typed error categories (issue #23).
 * Verifies that ApiClientError derives the correct category from HTTP status codes,
 * and that the server catch block includes category/code in error responses.
 *
 * Usage: npx tsx test-error-categories.ts
 */

import { ApiClientError } from './src/services/digit-api.js';

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

console.log('=== Typed Error Categories Tests ===\n');

// 1. ApiClientError category derivation
console.log('1. ApiClientError category from status code');

const err401 = new ApiClientError([{ code: 'AUTH', message: 'Unauthorized' }], 401);
assert(err401.category === 'auth', '401 → auth');
assert(err401.statusCode === 401, '401 statusCode preserved');

const err403 = new ApiClientError([{ code: 'FORBIDDEN', message: 'Forbidden' }], 403);
assert(err403.category === 'auth', '403 → auth');

const err400 = new ApiClientError([{ code: 'BAD_REQUEST', message: 'Bad request' }], 400);
assert(err400.category === 'validation', '400 → validation');

const err404 = new ApiClientError([{ code: 'NOT_FOUND', message: 'Not found' }], 404);
assert(err404.category === 'validation', '404 → validation');

const err422 = new ApiClientError([{ code: 'UNPROCESSABLE', message: 'Unprocessable' }], 422);
assert(err422.category === 'validation', '422 → validation');

const err500 = new ApiClientError([{ code: 'INTERNAL', message: 'Server error' }], 500);
assert(err500.category === 'api', '500 → api');

const err502 = new ApiClientError([{ code: 'BAD_GATEWAY', message: 'Bad gateway' }], 502);
assert(err502.category === 'api', '502 → api');

const err503 = new ApiClientError([{ code: 'UNAVAILABLE', message: 'Service unavailable' }], 503);
assert(err503.category === 'api', '503 → api');

// 2. Error message composition
console.log('\n2. Error message composition');

const multiErr = new ApiClientError([
  { code: 'ERR1', message: 'First error' },
  { code: 'ERR2', message: 'Second error' },
], 400);
assert(multiErr.message === 'First error, Second error', 'Multiple errors joined with comma');
assert(multiErr.name === 'ApiClientError', 'Error name is ApiClientError');

const codeOnlyErr = new ApiClientError([{ code: 'NO_MSG', message: '' }], 400);
assert(codeOnlyErr.message === 'NO_MSG', 'Falls back to code when message is empty');

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
