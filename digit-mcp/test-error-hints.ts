/**
 * Tests for actionable error hints (issue #24).
 * Verifies that getErrorHint() matches error patterns correctly and
 * returns actionable suggestions.
 *
 * Usage: npx tsx test-error-hints.ts
 */

import { getErrorHint } from './src/utils/error-hints.js';

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

console.log('=== Error Hints Tests ===\n');

// 1. Auth-related errors
console.log('1. Auth error patterns');

let hint = getErrorHint('User is not authorized to access tenant mz.chimoio');
assert(hint !== undefined, 'Matches "not authorized"');
assert(hint!.includes('user_role_add') || hint!.includes('configure'), 'Suggests user_role_add or configure');

hint = getErrorHint('Token expired, please re-authenticate');
assert(hint !== undefined, 'Matches "token expired"');
assert(hint!.includes('configure'), 'Suggests configure for token expired');

hint = getErrorHint('Not authenticated. Call configure first');
assert(hint !== undefined, 'Matches "not authenticated"');
assert(hint!.includes('configure'), 'Suggests configure for not authenticated');

// 2. Resource-not-found errors
console.log('\n2. Resource not found patterns');

hint = getErrorHint('Complaint not found in tenant pg.citya');
assert(hint !== undefined, 'Matches "complaint not found"');
assert(hint!.includes('pgr_search'), 'Suggests pgr_search');

hint = getErrorHint('Employee not found for code EMP001');
assert(hint !== undefined, 'Matches "employee not found"');
assert(hint!.includes('validate_employees'), 'Suggests validate_employees');

hint = getErrorHint('Tenant "xyz.abc" not found in MDMS');
assert(hint !== undefined, 'Matches "tenant not found"');
assert(hint!.includes('validate_tenant') || hint!.includes('mdms_get_tenants'), 'Suggests tenant validation');

hint = getErrorHint('Schema definition not found for common-masters.Department');
assert(hint !== undefined, 'Matches "schema not found"');
assert(hint!.includes('mdms_schema_search'), 'Suggests mdms_schema_search');

hint = getErrorHint('No boundary hierarchy found for tenant');
assert(hint !== undefined, 'Matches boundary not found');
assert(hint!.includes('validate_boundary') || hint!.includes('boundary_create'), 'Suggests boundary tools');

hint = getErrorHint('Workflow business service not configured');
assert(hint !== undefined, 'Matches workflow not found');
assert(hint!.includes('workflow_business_services') || hint!.includes('workflow_create'), 'Suggests workflow tools');

// 3. Duplicate/conflict errors
console.log('\n3. Duplicate/conflict patterns');

hint = getErrorHint('Record already exists with unique identifier DEPT_1');
assert(hint !== undefined, 'Matches "already exists"');
assert(hint!.includes('search'), 'Suggests search tool');

hint = getErrorHint('Unique constraint violation on user');
assert(hint !== undefined, 'Matches "unique constraint"');

// 4. Transient/network errors
console.log('\n4. Transient/network error patterns');

hint = getErrorHint('HTTP 429: Too Many Requests');
assert(hint !== undefined, 'Matches 429');
assert(hint!.includes('retry') || hint!.includes('Wait'), 'Suggests retry');

hint = getErrorHint('Service unavailable (503)');
assert(hint !== undefined, 'Matches 503');
assert(hint!.includes('health_check') || hint!.includes('retry'), 'Suggests health check or retry');

hint = getErrorHint('connect ECONNREFUSED 127.0.0.1:18000');
assert(hint !== undefined, 'Matches ECONNREFUSED');
assert(hint!.includes('get_environment_info'), 'Suggests get_environment_info');

// 5. Tool group not enabled
console.log('\n5. Tool group errors');

hint = getErrorHint('Tool "pgr_create" is in the "pgr" group which is not currently enabled. Call enable_tools to enable it.');
assert(hint !== undefined, 'Matches tool not enabled');
assert((hint ?? '').includes('enable_tools'), 'Suggests enable_tools');

// 6. No match — should return undefined
console.log('\n6. No match (benign errors)');

hint = getErrorHint('Some random error that does not match any pattern');
assert(hint === undefined, 'No hint for unrecognized errors');

hint = getErrorHint('Successfully created record');
assert(hint === undefined, 'No hint for success messages');

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
