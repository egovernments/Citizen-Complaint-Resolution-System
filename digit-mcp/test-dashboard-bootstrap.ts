import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DASHBOARD_ACTION,
  DASHBOARD_ACCESS_ACTIONS,
  DASHBOARD_ACTION_ID,
  DEFAULT_DASHBOARD_ROLES,
  PGR_SEARCH_SCOPE_RESOURCE,
  buildDashboardConfig,
  buildDashboardRoleAction,
  normalizeDashboardRoles,
} from './src/tools/dashboard-bootstrap-seed.js';

test('fresh installs get the narrow reference dashboard role set', () => {
  const roles = normalizeDashboardRoles(undefined);
  assert.deepEqual(roles, [...DEFAULT_DASHBOARD_ROLES]);
  assert.equal(buildDashboardConfig().allowedRoles, undefined);
  assert.equal(buildDashboardConfig().publicDashboardEnabled, false);
});

test('fresh tenant bootstrap carries Vinoth action-2008 row scope', () => {
  const complaint = PGR_SEARCH_SCOPE_RESOURCE.complaint as {
    scope: { axes: string[]; roleScopes: Record<string, unknown> };
  };
  assert.deepEqual(complaint.scope.axes, ['department', 'jurisdiction']);
  assert.deepEqual(Object.keys(complaint.scope.roleScopes).sort(), ['GRO', 'PGR_LME', 'SUPERVISOR']);
  const canonical = JSON.parse(fs.readFileSync(
    '../utilities/default-data-handler/src/main/resources/mdmsData/' +
      'ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json',
    'utf8',
  )).find((action: { id?: number }) => action.id === 2008);
  assert.deepEqual(PGR_SEARCH_SCOPE_RESOURCE, canonical.resource);
});

test('operator role overrides are normalized and deduplicated', () => {
  assert.deepEqual(
    normalizeDashboardRoles([' gro ', 'SUPERUSER', 'gro']),
    ['GRO', 'SUPERUSER'],
  );
  assert.throws(() => normalizeDashboardRoles([]), /at least one role code/);
  assert.throws(() => normalizeDashboardRoles(['bad role']), /invalid role code/);
});

test('the navigation action and API capability grants share one employee contract', () => {
  assert.equal(DASHBOARD_ACTION.id, DASHBOARD_ACTION_ID);
  assert.equal(DASHBOARD_ACTION.navigationURL, '/digit-ui/employee/dashboard');
  assert.deepEqual(
    DASHBOARD_ACCESS_ACTIONS.map((action) => action.id),
    [4557, 2640, 2641, 2642, 2643, 2644],
  );
  assert.deepEqual(buildDashboardRoleAction(2640, 'GRO', 'ke'), {
    actionid: 2640,
    rolecode: 'GRO',
    tenantId: 'ke',
    actioncode: '',
  });
});
