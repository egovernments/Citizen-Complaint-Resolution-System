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
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { assertEnv, BASE_URL, IGNORE_HTTPS_ERRORS, TENANT } from '../utils/env';
import { resolveTenant, tenantSlug } from '../utils/identity-bff';
import { discoverProfile, writeProfile } from '../utils/profile';

test('discover the deployment profile', async () => {
  // Fail fast, before any sign-in: a missing env value or a slug that routes to
  // another tenant would otherwise surface as dozens of unrelated failures.
  assertEnv();
  const api = await playwrightRequest.newContext({ ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS });
  try {
    const route = await resolveTenant(api, BASE_URL).catch((err: Error) => {
      throw new Error(`Workspace slug '${tenantSlug()}' does not resolve via /identity/v1/tenant-contexts: ${err.message}`);
    });
    if (route.tenantId !== TENANT) {
      throw new Error(
        `Workspace slug '${tenantSlug()}' resolves to tenant '${route.tenantId}' (/identity/v1/tenant-contexts), ` +
          `but DIGIT_TENANT is '${TENANT}'. The suite targets that one root tenant: fix the env profile.`,
      );
    }
  } finally {
    await api.dispose();
  }

  const profile = await discoverProfile();

  console.log(
    `[profile.setup] ${profile.tenant.city} @ ${profile.baseUrl}\n` +
      `  tenant       ${profile.tenant.label} (${profile.tenant.labelSource}), slug ${tenantSlug()}\n` +
      `  boundary     ${profile.boundary.hierarchyType} — ${profile.boundary.depth} levels [${profile.boundary.levels.join(' > ')}], ${profile.boundary.nodeCount} nodes, leaf ${profile.boundary.leafCode}\n` +
      `  complaints   ${profile.complaintTypes.serviceDefCount} types, cascade depth ${profile.complaintTypes.hierarchyDepth}\n` +
      `  workflow     PGR ${profile.workflow.pgr.found ? profile.workflow.pgr.actions.join(', ') : 'NOT FOUND'}\n` +
      `  mobile       ${profile.mobile.countryCode ?? '?'} ${profile.mobile.pattern ?? '(none)'}\n` +
      `  postal       ${profile.postal.pattern} sample ${profile.postal.validSample}${profile.postal.configuredExplicitly ? '' : ' (SPA default — not configured)'}\n` +
      `  locales      ${profile.locales.join(', ') || 'none'}\n` +
      `  seed plan    ${profile.pgr.seedServiceCode ?? 'UNRESOLVED'} @ ${profile.pgr.seedLocalityCode ?? 'UNRESOLVED'} (idPrefix ${profile.pgr.idPrefix ?? '?'})\n` +
      `  personas     ${Object.entries(profile.personas.resolved).map(([k, v]) => `${k}=${v?.username ?? 'none'}`).join(' ')}\n` +
      `  citizen      sign-in methods ${profile.identity?.citizenMethods?.join(', ') ?? '(unread)'}`,
  );
  for (const [key, why] of Object.entries(profile.personas.unresolvedDiagnostics)) {
    console.log(`[profile.setup] unresolved ${key}: ${why}`);
  }

  expect(profile.boundary.nodeCount, `boundary hierarchy ${profile.boundary.hierarchyType} is empty — no complaint can be filed`).toBeGreaterThan(0);
  expect(profile.boundary.levels.length, `boundary hierarchy ${profile.boundary.hierarchyType} has no cascade to walk`).toBeGreaterThanOrEqual(2);
  expect(profile.workflow.pgr.found, `no PGR businessService on ${profile.tenant.city} — no workflow to drive`).toBe(true);
  expect(profile.workflow.pgr.actions.length, 'PGR businessService defines no actions').toBeGreaterThan(0);
  expect(profile.complaintTypes.services.length, `no complaint types on ${profile.tenant.city} — nothing to file`).toBeGreaterThan(0);
  // toBeTruthy, not .not.toBeNull(): `resolved` starts life as `{}` and only
  // gains a key when a persona resolves, so an unresolved employee is
  // UNDEFINED, not null — and `expect(undefined).not.toBeNull()` passes. This
  // guard has therefore never once fired for the case it exists to catch. The
  // whole point of failing here is that a suite with no employee persona cannot
  // test anything downstream, so it must stop at setup with the diagnostic
  // rather than let every employee spec skip with its own vaguer reason.
  expect(
    profile.personas.resolved.employee,
    `no employee persona on ${profile.tenant.city}: ${profile.personas.unresolvedDiagnostics.employee ?? ''}`,
  ).toBeTruthy();
  expect(profile.tenant.label, `tenant ${profile.tenant.city} has no display label`).not.toBe('');

  console.log(`[profile.setup] wrote ${writeProfile(profile)}`);
});
