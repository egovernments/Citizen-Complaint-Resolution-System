import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EMPLOYEE_CONTEXT_ACTION,
  EMPLOYEE_CONTEXT_ACTION_ID,
  EMPLOYEE_CONTEXT_CONDITION,
  reconcileEmployeeContextPolicy,
} from './src/tools/employee-context-policy-seed.js';

const dumpRows = fs.readFileSync('../local-setup/db/full-dump.sql', 'utf8')
  .split('\n')
  .map((line) => line.split('\t'))
  .filter((columns) => columns.length >= 5);

test('the full dump contains exactly one canonical employee-context policy', () => {
  const actions = dumpRows
    .filter((columns) => columns[3] === 'ACCESSCONTROL-ACTIONS-TEST.actions-test')
    .map((columns) => JSON.parse(columns[4]) as Record<string, unknown>)
    .filter((action) => Number(action.id) === EMPLOYEE_CONTEXT_ACTION_ID);

  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0], EMPLOYEE_CONTEXT_ACTION);
});

test('employee-context policy is role independent', () => {
  const grants = dumpRows
    .filter((columns) => columns[3] === 'ACCESSCONTROL-ROLEACTIONS.roleactions')
    .map((columns) => JSON.parse(columns[4]) as { actionid?: number })
    .filter((grant) => Number(grant.actionid) === EMPLOYEE_CONTEXT_ACTION_ID);

  assert.deepEqual(grants, []);
  assert.deepEqual(EMPLOYEE_CONTEXT_CONDITION, {
    '==': [{ var: 'user.type' }, 'EMPLOYEE'],
  });
});

test('bootstrap creates a missing policy and upgrades the legacy bare action', () => {
  assert.deepEqual(reconcileEmployeeContextPolicy(), {
    kind: 'create',
    data: EMPLOYEE_CONTEXT_ACTION,
  });

  const legacy = { ...EMPLOYEE_CONTEXT_ACTION };
  delete legacy.method;
  delete legacy.condition;
  assert.deepEqual(reconcileEmployeeContextPolicy(legacy), {
    kind: 'update',
    data: EMPLOYEE_CONTEXT_ACTION,
  });
});

test('bootstrap is idempotent and refuses a conflicting authored policy', () => {
  assert.deepEqual(reconcileEmployeeContextPolicy(EMPLOYEE_CONTEXT_ACTION), { kind: 'current' });

  const conflict = {
    ...EMPLOYEE_CONTEXT_ACTION,
    condition: { '==': [{ var: 'user.type' }, 'CITIZEN'] },
  };
  assert.deepEqual(reconcileEmployeeContextPolicy(conflict), {
    kind: 'conflict',
    reason: `action ${EMPLOYEE_CONTEXT_ACTION_ID} has a non-canonical condition`,
  });
});
