/**
 * Tests for the tenant_bootstrap master-derived localization floor (#1590).
 *
 * tenant_bootstrap copies department/designation MASTERS unconditionally but
 * can only copy a localization message that already exists on some source
 * tenant. A master the source dump never localized lands on the target with no
 * `COMMON_MASTERS_DEPARTMENT_<CODE>` message and renders as its raw code (the
 * dashboard's department tiles show `PMC_ELEC` — the dimensionLabel contract
 * has no humaniser by design). deriveMasterLocalizations() builds the floor
 * from the master's own operator-authored `name`.
 *
 * Usage: npx tsx test-master-localizations.ts
 */
import { deriveMasterLocalizations } from './src/tools/mdms-tenant.js';

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

const find = (rows: { code: string; message: string; module: string }[], code: string) =>
  rows.find((r) => r.code === code);

console.log('=== tenant_bootstrap master-derived localization floor (#1590) ===\n');

console.log('1. the reported case: PMC departments copied from a never-localized source dump');
const pmc = deriveMasterLocalizations(
  [
    { uniqueIdentifier: 'PMC_ELEC', data: { code: 'PMC_ELEC', name: 'Electrical', active: true } },
    { uniqueIdentifier: 'PMC_PWD', data: { code: 'PMC_PWD', name: 'Public Works Department', active: true } },
  ],
  [],
);
assert(pmc.length === 2, 'both departments yield a message');
assert(find(pmc, 'COMMON_MASTERS_DEPARTMENT_PMC_ELEC')?.message === 'Electrical', 'PMC_ELEC → "Electrical"');
assert(
  find(pmc, 'COMMON_MASTERS_DEPARTMENT_PMC_PWD')?.message === 'Public Works Department',
  'PMC_PWD → "Public Works Department"',
);
assert(pmc.every((m) => m.module === 'rainmaker-common'), 'module is rainmaker-common (where dimensionLabel looks)');

console.log('\n2. key convention matches dimensionLabel CANDIDATES');
assert(
  pmc.every((m) => m.code.startsWith('COMMON_MASTERS_DEPARTMENT_')),
  'department prefix is COMMON_MASTERS_DEPARTMENT_',
);
const desig = deriveMasterLocalizations([], [
  { uniqueIdentifier: 'DESIG_01', data: { code: 'DESIG_01', name: 'Ward Officer' } },
]);
assert(
  desig.length === 1 && desig[0].code === 'COMMON_MASTERS_DESIGNATION_DESIG_01',
  'designation prefix is COMMON_MASTERS_DESIGNATION_',
);

console.log('\n3. no fabricated labels — a master with no name yields nothing');
assert(deriveMasterLocalizations([{ uniqueIdentifier: 'NO_NAME', data: { code: 'NO_NAME' } }], []).length === 0,
  'missing name → no message (gap stays visible, not humanised from the code)');
assert(deriveMasterLocalizations([{ uniqueIdentifier: 'BLANK', data: { code: 'BLANK', name: '   ' } }], []).length === 0,
  'whitespace-only name → no message');
assert(deriveMasterLocalizations([{ data: { name: 'Orphan' } }], []).length === 0,
  'missing code → no message');
assert(deriveMasterLocalizations([{ uniqueIdentifier: 'N', data: { code: 'N', name: 42 as unknown as string } }], []).length === 0,
  'non-string name → no message');

// A non-string `code` used to reach String.prototype.trim and throw. The throw
// escaped into the caller's catch, dropping the ENTIRE derived floor for the
// bootstrap rather than just the malformed row. (CodeRabbit, PR #1655.)
const malformed = [
  { data: { code: 42 as unknown as string, name: 'Numeric code' } },
  { data: { code: { nested: true } as unknown as string, name: 'Object code' } },
  { uniqueIdentifier: 'GOOD', data: { code: 'GOOD', name: 'Good Department' } },
];
let survived = true;
let out: ReturnType<typeof deriveMasterLocalizations> = [];
try {
  out = deriveMasterLocalizations(malformed, []);
} catch {
  survived = false;
}
assert(survived, 'non-string code does not throw');
assert(out.length === 1 && out[0].code === 'COMMON_MASTERS_DEPARTMENT_GOOD',
  'a malformed row is skipped without taking the well-formed rows with it');

console.log('\n4. shape tolerance (mdms-v2 rows vary between search paths)');
const fallbackCode = deriveMasterLocalizations([{ data: { code: 'FROM_DATA', name: 'From data.code' } }], []);
assert(fallbackCode[0]?.code === 'COMMON_MASTERS_DEPARTMENT_FROM_DATA', 'falls back to data.code when uniqueIdentifier is absent');
const trimmed = deriveMasterLocalizations([{ uniqueIdentifier: '  SPACED  ', data: { code: 'SPACED', name: '  Padded Name  ' } }], []);
assert(trimmed[0]?.code === 'COMMON_MASTERS_DEPARTMENT_SPACED', 'code is trimmed');
assert(trimmed[0]?.message === 'Padded Name', 'name is trimmed');
assert(deriveMasterLocalizations([], []).length === 0, 'empty input → empty output');
assert(
  deriveMasterLocalizations(undefined as unknown as [], undefined as unknown as []).length === 0,
  'undefined rows (search failed and was caught) → empty output, never throws',
);

console.log('\n5. duplicate codes collapse (root + city rows for the same department)');
const dup = deriveMasterLocalizations(
  [
    { uniqueIdentifier: 'DEPT_1', data: { code: 'DEPT_1', name: 'Street Lights' } },
    { uniqueIdentifier: 'DEPT_1', data: { code: 'DEPT_1', name: 'Street Lights (city copy)' } },
  ],
  [],
);
assert(dup.length === 1, 'same code twice → one message');
assert(dup[0].message === 'Street Lights', 'first row wins');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
