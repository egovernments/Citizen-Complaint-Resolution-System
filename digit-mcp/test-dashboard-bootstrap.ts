import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_ACTION,
  DASHBOARD_ACTION_ID,
  DEFAULT_DASHBOARD_ROLES,
  buildDashboardConfig,
  buildDashboardRoleAction,
  normalizeDashboardRoles,
} from './src/tools/dashboard-bootstrap-seed.js';

test('fresh installs get the narrow reference dashboard role set', () => {
  const roles = normalizeDashboardRoles(undefined);
  assert.deepEqual(roles, [...DEFAULT_DASHBOARD_ROLES]);
  assert.deepEqual(buildDashboardConfig(roles).allowedRoles, roles);
  assert.equal(buildDashboardConfig(roles).publicDashboardEnabled, false);
});

test('operator role overrides are normalized and deduplicated', () => {
  assert.deepEqual(
    normalizeDashboardRoles([' gro ', 'SUPERUSER', 'gro']),
    ['GRO', 'SUPERUSER'],
  );
  assert.throws(() => normalizeDashboardRoles([]), /at least one role code/);
  assert.throws(() => normalizeDashboardRoles(['bad role']), /invalid role code/);
});

test('the navigation action and grants share the employee dashboard contract', () => {
  assert.equal(DASHBOARD_ACTION.id, DASHBOARD_ACTION_ID);
  assert.equal(DASHBOARD_ACTION.navigationURL, '/digit-ui/employee/dashboard');
  assert.deepEqual(buildDashboardRoleAction('GRO', 'ke'), {
    actionid: DASHBOARD_ACTION_ID,
    rolecode: 'GRO',
    tenantId: 'ke',
    actioncode: '',
  });
});
