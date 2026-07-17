/**
 * Guards the three invariants the rest of the suite leans on.
 *
 * (a) The profile describes THIS run's deployment — see below.
 * (b) The profile is non-empty — re-asserted here rather than trusted from
 *     profile.setup, because a stale deployment-profile.json from an earlier
 *     run against a different stack would otherwise sail through.
 * (c) Every declared expectation holds. This is where a gap the suite would
 *     otherwise skip past turns red: `mdms.rejectionReasons` is declared
 *     'required' on both deployments precisely so its absence is a failure and
 *     not a shrug. Soft assertions so one gap does not mask the others.
 */
import { test, expect } from '@playwright/test';
import { currentTarget, getProfile, probeFailuresOf, profileTargetMismatches, PROFILE_PATH } from '../utils/profile';
import { auditExpectations, loadExpectations } from '../utils/capabilities';

/**
 * The identity check (a). The non-emptiness test below is NOT this: a complete,
 * structurally perfect profile from yesterday's bomet run satisfies every
 * assertion in it while describing a deployment this run is not even talking to
 * — and then gates, seeds and asserts the local stack with `ke`'s tenant,
 * boundaries and personas. "Populated" and "correct" are different claims.
 *
 * getProfile() already refuses a mismatched profile at load, so in practice this
 * fails first and with a better message than the fifty specs that would
 * otherwise fail obscurely downstream. It is asserted rather than assumed
 * because it is the single load-bearing precondition for the whole suite: if
 * this ever passes vacuously, everything after it is measuring the wrong box.
 */
test('deployment profile describes the deployment under test', { tag: ['@persona:system'] }, async () => {
  const p = getProfile();
  const target = currentTarget();

  expect(
    profileTargetMismatches(p),
    `${PROFILE_PATH} was discovered against a different deployment than this run targets ` +
      `(${target.baseUrl}${target.tenant ? ` / ${target.tenant}` : ''}). Re-run the profile-setup project.`,
  ).toEqual([]);

  // Independent of the mismatch list above, which only compares what the env
  // pins: assert the profile positively names a deployment. A blank baseUrl or
  // tenant would trivially "match" nothing and pass the check above.
  expect(p.baseUrl, 'profile records no baseUrl').toBeTruthy();
  expect(p.tenant.city, 'profile records no city tenant').toBeTruthy();
  expect(p.tenant.root, 'profile records no root tenant').toBeTruthy();

  // Freshness: a profile is a snapshot, and generatedAt is the only evidence of
  // when the deployment was actually looked at. Same-target staleness is real —
  // a re-seed between runs makes yesterday's snapshot fiction — and a `--no-deps`
  // run is exactly how you get one. The window is generous because it only has
  // to catch "left over from a previous session", not "written 3 minutes ago";
  // a normal run rewrites this file at the start of every invocation.
  const ageMs = Date.now() - Date.parse(p.generatedAt);
  expect(Number.isFinite(ageMs), `profile has an unparseable generatedAt: ${p.generatedAt}`).toBe(true);
  expect(ageMs, `profile generatedAt is in the future (${p.generatedAt}) — clock skew or a hand-edited file`).toBeGreaterThanOrEqual(-60_000);
  const maxAgeMs = (Number(process.env.PROFILE_MAX_AGE_HOURS) || 12) * 3_600_000;
  expect(
    ageMs,
    `${PROFILE_PATH} was discovered at ${p.generatedAt}, over ${maxAgeMs / 3_600_000}h ago — it is a stale ` +
      'snapshot of a deployment that may have been re-seeded since. Re-run profile-setup (drop `--no-deps`), ' +
      'or raise PROFILE_MAX_AGE_HOURS if you meant to reuse it.',
  ).toBeLessThan(maxAgeMs);

  // A probe that could not be READ is not a deployment that lacks the thing.
  // Every field it fed degraded to a fallback, so any capability decided from it
  // is a guess — fail rather than let a transient outage be reported as a seed
  // gap, which is the exact misdiagnosis this design exists to prevent.
  expect(
    Object.entries(probeFailuresOf(p)).map(([k, v]) => `${k}: ${v}`),
    'discovery could not read parts of the deployment; the profile is a guess where they should be',
  ).toEqual([]);
});

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
