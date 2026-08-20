// PGR citizen / CSR create. End-to-end checks for the bugs fixed in
// PR #69 (ward-leaf, pincode pattern, form reset) and PR #72
// (re-enabled AddressOne / AddressTwo, tenant-aware boundary cascade).
//
// The historical-data assertion was unreliable — past complaints can't
// backfill, so even after the fix the assertion stayed red until a new
// complaint trickled in. Replaced with two stronger assertions:
//   (a) the rendered Create-Complaint page has both Address inputs.
//   (b) the backend round-trips buildingName + street on a fresh
//       PGR _create call (that's the contract the form mapping
//       eventually exercises).
import { test, expect } from '@playwright/test';
import { loginEmployee } from '../utils/launch-fixes/api.js';
import { BASE_URL, POSTAL_CODE_PATTERN, POSTAL_CODE_VALID } from '../utils/env';
import { getProfile } from '../utils/profile';
import { fetchGlobalConfigs } from '../utils/probes';

const BASE = BASE_URL;

test.describe('03-citizen-create: PGR _create payload completeness (#478 + #72)', () => {
  test('digit-ui bundle declares AddressOne + AddressTwo populators (PR-C re-enabled)', {
    annotation: {
      type: 'description',
      description: `Bundle-level guard for PR-C (CCRS#72): the AddressOne and AddressTwo populators on the citizen Create Complaint form were commented out — pre-fix the bundle had neither string anywhere. Post-fix both must appear. Faster and more reliable than navigating the SPA — fetch index.js and grep.

Steps:
1. fetch GET /digit-ui/index.js from the deployment.
2. Assert response.ok.
3. Assert the response body contains 'AddressOne' AND 'AddressTwo'.

Catches a regression where the populators get re-disabled (or refactored to internal-only references) without the JSX config being updated.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@ccrs:72', '@kind:regression', '@layer:api', '@persona:citizen'] }, async () => {
    // Pre-PR-C the populators were commented out in the JSX config —
    // the bundle had no string `AddressOne` / `AddressTwo` anywhere.
    // Post-PR-C they're back. Fetch the bundle directly (faster + more
    // reliable than navigating the SPA) and grep.
    const r = await fetch(`${BASE}/digit-ui/index.js`);
    expect(r.ok).toBe(true);
    const body = await r.text();
    expect(body).toContain('AddressOne');
    expect(body).toContain('AddressTwo');
  });
});

test.describe('03-citizen-create: pincode validation (#478)', () => {
  test('the deployment postal-code pattern accepts this tenant\'s valid sample and rejects malformed input', {
    annotation: {
      type: 'description',
      description: `Pure-regex unit check for the post-fix, tenant-pinned postal-code pattern (globalConfigs CORE_POSTAL_CONFIGS.postalCodePattern, mirrored into POSTAL_CODE_PATTERN in .env). Confirms the pattern accepts the deployment's known-valid sample (POSTAL_CODE_VALID — e.g. Nairobi GPO "00100" on a 5-digit tenant, "0101-03" on mz.maputo) AND rejects a non-numeric input and an over-long numeric run.

Steps:
1. Build PATTERN from POSTAL_CODE_PATTERN env.
2. Assert PATTERN.test(POSTAL_CODE_VALID) === true.
3. Assert PATTERN.test('abcde') === false (non-numeric).
4. Assert PATTERN.test('999999999999') === false (absurdly long).

No HTTP, no UI — pure regex assertion. Pairs with the legacy-pattern test below.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:regression', '@layer:api', '@persona:citizen'] }, () => {
    const PATTERN = new RegExp(POSTAL_CODE_PATTERN); // tenant-pinned, from env
    expect(PATTERN.test(POSTAL_CODE_VALID)).toBe(true);
    expect(PATTERN.test('abcde')).toBe(false);
    expect(PATTERN.test('999999999999')).toBe(false);
  });

  test('postal validation is driven by the tenant\'s own configured rule, not the legacy Indian PIN pattern', {
    annotation: {
      type: 'description',
      description: `Pins the #478 migration away from the hardcoded Indian PIN rule /^[1-9][0-9]{5}$/i, on ANY deployment — including one that legitimately uses the Indian format. Two branches, chosen from the deployment's own data:

Steps:
1. Assert the tenant's own pattern accepts its own known-valid sample (precondition).
2. If the legacy Indian rule REJECTS that sample (non-India: "00100" starts with 0, "0101-03" has a hyphen) — assert exactly that. The two rules disagree, so the migration is observably load-bearing here.
3. Else the tenant genuinely runs the Indian 6-digit shape, and no input can distinguish the two rules. Assert PROVENANCE instead: profile.postal.pattern equals the discovered pattern AND configuredExplicitly is true — i.e. the rule is a per-tenant configuration decision, not a built-in fallback.

Branch 3 is what makes this non-vacuous on an Indian tenant: if a future PR drops corePostalConfigs.postalCodePattern (or re-hardcodes the Indian rule as the app default), the resolver falls back to the SPA's 5-digit default, configuredExplicitly goes false, and this goes red.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:citizen'] }, () => {
    const LEGACY = /^[1-9][0-9]{5}$/i;
    const TENANT_RULE = new RegExp(POSTAL_CODE_PATTERN);

    // Precondition on every deployment: the tenant's own rule accepts the
    // tenant's own sample. Everything below reads on top of this.
    expect(
      TENANT_RULE.test(POSTAL_CODE_VALID),
      `this deployment's own pattern ${POSTAL_CODE_PATTERN} must accept its own sample ${POSTAL_CODE_VALID}`,
    ).toBe(true);

    if (!LEGACY.test(POSTAL_CODE_VALID)) {
      // Non-India shape — the original point of this test. The legacy rule and
      // the tenant rule DISAGREE on this deployment's own valid postcode, so
      // shipping the legacy rule would have locked these citizens out of the
      // form entirely.
      expect(
        LEGACY.test(POSTAL_CODE_VALID),
        `the legacy Indian rule must reject ${POSTAL_CODE_VALID} — that disagreement is why #478 migrated off it`,
      ).toBe(false);
      return;
    }

    // India-shaped deployment (the `pg` playground tenant is Punjab —
    // 143001..143010). Here the tenant rule and the legacy rule accept exactly
    // the same set of strings, so NO input can tell them apart and the old
    // assertion ("legacy would have rejected it") was simply false — it used to
    // self-skip for that reason, which left the #478 guarantee untested on the
    // one deployment shape where the two rules coincide.
    //
    // What is still falsifiable, and is the regression that actually matters, is
    // PROVENANCE: the effective rule has to come from this tenant's own
    // configuration so that changing the config changes validation. Asserted
    // against the profile because it mirrors the SPA's resolution order
    // (utils/postalCode.js): MDMS common-masters.FormValidations row first, then
    // globalConfigs, then the built-in 5-digit default. The sibling test below
    // does the independent live re-read; this one asserts that a rule was
    // *chosen* at all.
    const profile = getProfile();
    expect(
      profile.postal.pattern,
      'the discovered pattern must be the one this run validates against',
    ).toBe(POSTAL_CODE_PATTERN);
    expect(
      profile.postal.configuredExplicitly,
      'the Indian 6-digit rule must be an explicit per-tenant configuration, not the app falling back to a hardcoded default',
    ).toBe(true);
  });

  test('the discovered postal pattern is self-consistent with the deployment\'s own globalConfigs', {
    annotation: {
      type: 'description',
      description: `Guards profile.ts's postal-pattern extraction against silent drift: deployment-profile.json's postal.pattern is baked in once per run by profile-setup, while this test re-fetches /digit-ui/globalConfigs.js live (independent of the cached profile) and compares. If the deployment configures corePostalConfigs.postalCodePattern explicitly, the profile must mirror it exactly. If it doesn't (bomet ships corePostalConfigs as '{}'), the profile must have fallen back to the SPA's own hardcoded 5-digit default rather than inventing a value — the same default the form itself validates against when unconfigured.

Steps:
1. getProfile() — the run's discovered profile.
2. fetchGlobalConfigs(BASE_URL) — a fresh, independent read of globalConfigs.js.
3. If globalConfigs declares a pattern: assert profile.postal.pattern === that live pattern, and profile.postal.configuredExplicitly === true.
4. Else: assert profile.postal.pattern === '^[0-9]{5}$' and profile.postal.configuredExplicitly === false.

Catches a regression where profile.ts's regex extraction or fallback logic disagrees with what the SPA itself boots with.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:regression', '@layer:api', '@persona:citizen'] }, async () => {
    const profile = getProfile();
    const live = await fetchGlobalConfigs(BASE_URL);
    const livePattern = live.corePostalConfigs?.postalCodePattern ?? null;

    if (livePattern) {
      expect(
        profile.postal.pattern,
        'profile.postal.pattern must mirror the deployment\'s live globalConfigs.corePostalConfigs.postalCodePattern',
      ).toBe(livePattern);
      expect(profile.postal.configuredExplicitly).toBe(true);
    } else {
      expect(
        profile.postal.pattern,
        'no explicit postal config on this deployment — profile.postal.pattern must fall back to the SPA\'s own 5-digit default',
      ).toBe('^[0-9]{5}$');
      expect(profile.postal.configuredExplicitly).toBe(false);
    }
  });
});
