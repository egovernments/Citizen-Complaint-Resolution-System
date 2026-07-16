/**
 * Guards the two invariants the rest of the suite leans on.
 *
 * (a) The profile is non-empty — re-asserted here rather than trusted from
 *     profile.setup, because a stale deployment-profile.json from an earlier
 *     run against a different stack would otherwise sail through.
 * (b) Every declared expectation holds. This is where a gap the suite would
 *     otherwise skip past turns red: `mdms.rejectionReasons` is declared
 *     'required' on both deployments precisely so its absence is a failure and
 *     not a shrug. Soft assertions so one gap does not mask the others.
 */
import { test, expect } from '@playwright/test';
import { getProfile } from '../utils/profile';
import { auditExpectations, loadExpectations } from '../utils/capabilities';

test('deployment profile is non-empty', { tag: ['@persona:system'] }, async () => {
  const p = getProfile();
  expect(p.boundary.nodeCount, 'boundary hierarchy is empty').toBeGreaterThan(0);
  expect(p.boundary.levels.length, 'boundary hierarchy has no cascade').toBeGreaterThanOrEqual(2);
  expect(p.workflow.pgr.found, 'no PGR businessService').toBe(true);
  expect(p.workflow.pgr.actions.length, 'PGR defines no actions').toBeGreaterThan(0);
  expect(p.complaintTypes.services.length, 'no complaint types').toBeGreaterThan(0);
  expect(p.personas.resolved.employee, 'no employee persona').not.toBeNull();
  expect(p.tenant.label, 'no tenant display label').not.toBe('');
});

test('deployment meets its declared expectations', { tag: ['@persona:system'] }, async () => {
  const p = getProfile();
  const { name } = loadExpectations();
  const rows = auditExpectations(p);

  expect(rows.length, `${name} declares no expectations — nothing would be checked`).toBeGreaterThan(0);
  for (const row of rows) {
    console.log(`[expectations] ${row.verdict.padEnd(7)} ${row.key} (expected ${row.expected}, present ${row.present}) — ${row.reason}`);
  }
  for (const row of rows.filter((r) => r.verdict === 'fail')) {
    expect.soft(row.present, row.reason).toBe(true);
  }
});
