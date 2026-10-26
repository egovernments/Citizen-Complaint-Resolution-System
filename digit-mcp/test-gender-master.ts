// user_create / employee_create accept only the genders the tenant's
// common-masters.GenderType master holds (#2397).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { MdmsRecord } from './src/types/index.js';
import { activeGenderCodes, validateGender, GENDER_SCHEMA } from './src/utils/gender.js';
import { ValidationError } from './src/utils/validation.js';

const row = (code: string, isActive = true, active?: boolean) =>
  ({ tenantId: 'pg', schemaCode: GENDER_SCHEMA, uniqueIdentifier: code, isActive, data: { code, ...(active === undefined ? {} : { active }) } }) as unknown as MdmsRecord;

const master = [row('MALE'), row('FEMALE'), row('OTHERS', true, false), row('TRANSGENDER', false)];

test('only active records count', () => {
  assert.deepEqual(activeGenderCodes(master), ['MALE', 'FEMALE']);
});

test('a gender in the master passes, searched at the state root', async () => {
  const calls: string[][] = [];
  const search = async (t: string, s: string) => { calls.push([t, s]); return master; };
  assert.equal(await validateGender('FEMALE', 'pg.citya', search), 'FEMALE');
  assert.deepEqual(calls, [['pg', GENDER_SCHEMA]]);
});

test('a gender missing from or inactive in the master is rejected with the allowed list', async () => {
  for (const g of ['TRANSGENDER', 'OTHERS', 'female']) {
    await assert.rejects(validateGender(g, 'pg', async () => master), (e: Error) =>
      e instanceof ValidationError && /Allowed: MALE, FEMALE\./.test(e.message));
  }
});

test('no gender given: no lookup, null sent', async () => {
  for (const g of [undefined, null, '']) {
    assert.equal(await validateGender(g, 'pg', async () => { throw new Error('should not search'); }), null);
  }
});
