import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EMPLOYEE_CONTEXT_ACTION,
  EMPLOYEE_CONTEXT_ACTION_ID,
  EMPLOYEE_CONTEXT_CONDITION,
  reconcileEmployeeContextPolicy,
} from './src/tools/employee-context-policy-seed.js';

// The first 4 tab-delimited columns are plain scalars; the 5th is a JSON
// object that can itself contain literal tab characters, so it cannot be
// carved out with a plain `line.split('\t')` without shifting every column
// that follows it.
function splitDumpRow(line: string): { columns: string[]; json: unknown } | null {
  let start = 0;
  const columns: string[] = [];
  for (let i = 0; i < 4; i++) {
    const idx = line.indexOf('\t', start);
    if (idx === -1) return null;
    columns.push(line.slice(start, idx));
    start = idx + 1;
  }
  if (line[start] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = start;
  for (; end < line.length; end++) {
    const ch = line[end];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end++;
        break;
      }
    }
  }

  try {
    return { columns, json: JSON.parse(line.slice(start, end)) };
  } catch {
    return null;
  }
}

const dumpRows = fs.readFileSync('../local-setup/db/full-dump.sql', 'utf8')
  .split('\n')
  .map(splitDumpRow)
  .filter((row): row is { columns: string[]; json: unknown } => row !== null);

test('the full dump contains exactly one canonical employee-context policy', () => {
  const actions = dumpRows
    .filter((row) => row.columns[3] === 'ACCESSCONTROL-ACTIONS-TEST.actions-test')
    .map((row) => row.json as Record<string, unknown>)
    .filter((action) => Number(action.id) === EMPLOYEE_CONTEXT_ACTION_ID);

  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0], EMPLOYEE_CONTEXT_ACTION);
});

test('employee-context policy is role independent', () => {
  const grants = dumpRows
    .filter((row) => row.columns[3] === 'ACCESSCONTROL-ROLEACTIONS.roleactions')
    .map((row) => row.json as { actionid?: number })
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
