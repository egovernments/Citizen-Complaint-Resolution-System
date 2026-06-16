/**
 * Tests for the tenant_bootstrap pincode_allowlist normalization.
 *
 * The tenant.tenants MDMS schema types pincode items as Number, and
 * mdms-v2 rejects both string items ("expected type: Number, found:
 * String") and empty arrays — so the normalizer must coerce numeric
 * strings and collapse empty/absent input to null ("don't touch").
 *
 * Usage: npx tsx test-pincode-allowlist.ts
 */
import { normalizePincodeAllowlist } from './src/tools/mdms-tenant.js';

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

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('=== pincode_allowlist normalization ===\n');

console.log('1. numeric coercion (mdms-v2 schema wants Number items)');
assert(eq(normalizePincodeAllowlist(['1000']), [1000]), "['1000'] → [1000]");
assert(eq(normalizePincodeAllowlist(['1000', '2000']), [1000, 2000]), "['1000','2000'] → [1000,2000]");
assert(eq(normalizePincodeAllowlist([143001, '143002']), [143001, 143002]), 'mixed numbers/strings all become numbers');
assert(eq(normalizePincodeAllowlist([' 1000 ']), [1000]), 'whitespace trimmed before coercion');
// Leading zeros collapse under Number(); the UI gate strips them from
// both sides before comparing, so "00100" still matches a stored 100.
assert(eq(normalizePincodeAllowlist(['00100']), [100]), "leading-zero '00100' → 100");

console.log('\n2. non-numeric postcodes pass through unchanged');
assert(eq(normalizePincodeAllowlist(['EC1A 1BB']), ['EC1A 1BB']), 'alphanumeric postcode kept as string');
assert(eq(normalizePincodeAllowlist(['1000', 'EC1A 1BB']), [1000, 'EC1A 1BB']), 'mixed numeric + alphanumeric');

console.log('\n3. off states return null (never an empty array)');
assert(normalizePincodeAllowlist(undefined) === null, 'undefined → null');
assert(normalizePincodeAllowlist(null) === null, 'null → null');
assert(normalizePincodeAllowlist('1000') === null, 'non-array → null');
assert(normalizePincodeAllowlist([]) === null, '[] → null');
assert(normalizePincodeAllowlist(['', '  ']) === null, 'blank entries only → null');
assert(eq(normalizePincodeAllowlist(['', '1000']), [1000]), 'blank entries dropped, rest kept');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
