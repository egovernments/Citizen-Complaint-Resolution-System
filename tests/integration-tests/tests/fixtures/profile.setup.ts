/**
 * Interrogate the deployment once, before anything else runs.
 *
 * Writes deployment-profile.json, which env.ts then reads synchronously at
 * import time — that ordering is the whole trick, and it is why this is a
 * project dependency rather than a beforeAll hook.
 *
 * The asserts below are the anti-vacuous-pass guard. Everything else in the
 * profile is allowed to degrade to null (its capability then reads as absent and
 * the expectations file judges it), but these six describe a deployment that
 * cannot be meaningfully tested at all: no boundaries means no complaint can be
 * filed, no personas means no workflow can be driven. Without them a run against
 * an empty stack would skip every spec and report green, which is precisely the
 * failure mode this design exists to prevent. Fail loudly here instead.
 */
import { test, expect } from '@playwright/test';
import { discoverProfile, writeProfile } from '../utils/profile';

test('discover the deployment profile', async () => {
  const profile = await discoverProfile();

  console.log(
    `[profile.setup] ${profile.tenant.city} @ ${profile.baseUrl}\n` +
      `  tenant       ${profile.tenant.label} (${profile.tenant.labelSource})${profile.tenant.flat ? ' [flat]' : ` under ${profile.tenant.root}`}\n` +
      `  boundary     ${profile.boundary.hierarchyType} — ${profile.boundary.depth} levels [${profile.boundary.levels.join(' > ')}], ${profile.boundary.nodeCount} nodes, leaf ${profile.boundary.leafCode}\n` +
      `  complaints   ${profile.complaintTypes.serviceDefCount} types, cascade depth ${profile.complaintTypes.hierarchyDepth}\n` +
      `  workflow     PGR ${profile.workflow.pgr.found ? profile.workflow.pgr.actions.join(', ') : 'NOT FOUND'}\n` +
      `  mobile       ${profile.mobile.countryCode ?? '?'} ${profile.mobile.pattern ?? '(none)'}\n` +
      `  postal       ${profile.postal.pattern} sample ${profile.postal.validSample}${profile.postal.configuredExplicitly ? '' : ' (SPA default — not configured)'}\n` +
      `  locales      ${profile.locales.join(', ') || 'none'}\n` +
      `  seed plan    ${profile.pgr.seedServiceCode ?? 'UNRESOLVED'} @ ${profile.pgr.seedLocalityCode ?? 'UNRESOLVED'} (idPrefix ${profile.pgr.idPrefix ?? '?'})\n` +
      `  personas     ${Object.entries(profile.personas.resolved).map(([k, v]) => `${k}=${v?.username ?? 'none'}`).join(' ')}`,
  );
  for (const [key, why] of Object.entries(profile.personas.unresolvedDiagnostics)) {
    console.log(`[profile.setup] unresolved ${key}: ${why}`);
  }

  // R4: the label is asserted against the login City combobox, which renders the
  // localization value. Anything else means we are testing the UI against a
  // guess — "Ke" for bomet's flat tenant, say — so say so out loud.
  if (profile.tenant.labelSource !== 'localization') {
    console.warn(
      `[profile.setup] WARNING: tenant label "${profile.tenant.label}" came from ${profile.tenant.labelSource}, ` +
        `not localization. The employee login City combobox renders TENANT_TENANTS_${profile.tenant.city.toUpperCase().replace(/\./g, '_')}; ` +
        'seed that key or any label assertion is checking our guess, not the deployment.',
    );
  }

  expect(profile.boundary.nodeCount, `boundary hierarchy ${profile.boundary.hierarchyType} is empty — no complaint can be filed`).toBeGreaterThan(0);
  expect(profile.boundary.levels.length, `boundary hierarchy ${profile.boundary.hierarchyType} has no cascade to walk`).toBeGreaterThanOrEqual(2);
  expect(profile.workflow.pgr.found, `no PGR businessService on ${profile.tenant.city} — no workflow to drive`).toBe(true);
  expect(profile.workflow.pgr.actions.length, 'PGR businessService defines no actions').toBeGreaterThan(0);
  expect(profile.complaintTypes.services.length, `no complaint types on ${profile.tenant.city} — nothing to file`).toBeGreaterThan(0);
  expect(
    profile.personas.resolved.employee,
    `no employee persona on ${profile.tenant.city}: ${profile.personas.unresolvedDiagnostics.employee ?? ''}`,
  ).not.toBeNull();
  expect(profile.tenant.label, `tenant ${profile.tenant.city} has no display label`).not.toBe('');

  console.log(`[profile.setup] wrote ${writeProfile(profile)}`);
});
