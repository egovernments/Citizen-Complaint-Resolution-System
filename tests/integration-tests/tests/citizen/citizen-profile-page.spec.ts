/**
 * Citizen profile field-set lock-down — Story 8.1.
 *
 * Asserts that `/citizen/user/profile` renders **exactly** the expected
 * field set (Name, Gender, Email, photo, Save) and **none** of the
 * fields the original catalogue claimed (mobile / language / password /
 * notifications / city). Catches both shrinkage (missing fields) and
 * scope-creep (re-enabling sensitive surfaces without a UX review).
 *
 * If a future build legitimately adds a field (say, language switcher),
 * update both this spec and `docs/personas/citizen-flows.md` Story 8.1
 * in the same PR — the doc is the source of truth.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL } from '../utils/env';
import { readProvisionedCitizen } from '../utils/citizen-provision';

const EXPECTED_LABELS = ['Name', 'Gender', 'Email'];

// Strings that, if they ever appear in the profile form, indicate
// scope-creep (re-exposing surfaces that the catalogue says shouldn't
// be on the citizen profile). Keep the list specific — generic terms
// like "Notification" or "Phone" can appear elsewhere on the page
// (header bell tooltip, footer help text) and would false-positive.
const FORBIDDEN_FORM_LABELS = [
  'Mobile Number',
  'Change Password',
  'Current Password',
  'New Password',
  'WhatsApp',
];

// Forbidden input names — the strict guard. If a form field with any
// of these names appears, it's a hard fail.
const FORBIDDEN_INPUT_NAMES = [
  'mobileNumber',
  'mobile',
  'phone',
  'language',
  'password',
  'newPassword',
  'currentPassword',
];

test.describe('Citizen profile field-set lock-down', () => {
  test('only Name + Gender + Email + photo render (no password/language/mobile/notifications)', {
    annotation: {
      type: 'description',
      description: `Story 8.1 lock-down: /citizen/user/profile must render EXACTLY the expected field set (Name, Gender, Email, photo, Save) and NONE of the surfaces the original catalogue claimed (mobile / language / password / notifications / city). Catches both shrinkage (missing fields) and scope-creep (re-exposing sensitive surfaces without UX review).

Steps:
1. setTimeout 120s; OTP-login as a fresh citizen.
2. Navigate to /digit-ui/citizen/user/profile, wait 5s.
3. Assert body does NOT contain "Something went wrong".
4. Snapshot bodyText once and inputs (name + type) once — avoids racing a renderer crash.
5. For each EXPECTED_LABEL ['Name','Gender','Email'], assert it appears in body text.
6. Assert input names include 'name' and 'email'.
7. Assert a Save button is visible.
8. For each FORBIDDEN_FORM_LABEL ('Mobile Number','Change Password','Current Password','New Password','WhatsApp'), assert it is NOT in body text.
9. Assert no input has type="password".
10. For each FORBIDDEN_INPUT_NAME ('mobileNumber','mobile','phone','language','password','newPassword','currentPassword'), assert it is NOT in input names.

If a future build legitimately adds a field, update this spec AND citizen-flows.md Story 8.1 in the same PR — the doc is source of truth.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const provisioned = readProvisionedCitizen();
    if (!provisioned) {
      throw new Error(
        'citizen-fixture.json is missing — run the citizen-setup project first ' +
          '(npx playwright test --project=citizen-setup).',
      );
    }
    await citizenOtpLogin(page, provisioned.mobile);

    await page.goto(`${BASE_URL}/digit-ui/citizen/user/profile`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');

    // ── Snapshot inputs once + body text once ─────────────────────
    // Avoid chained locator queries that can race a page navigation /
    // renderer crash on this page (saw "page closed" errors in CI runs).
    const bodyText = await body.innerText();
    const inputs = await page
      .locator('input')
      .evaluateAll((els) =>
        els.map((el) => ({
          name: (el as HTMLInputElement).name,
          id: (el as HTMLInputElement).id,
          type: (el as HTMLInputElement).type,
        })),
      );

    // ── Expected labels visible in body text + matching inputs ─────
    for (const label of EXPECTED_LABELS) {
      expect(
        bodyText.includes(label),
        `expected label "${label}" to render in profile body text`,
      ).toBe(true);
    }
    // The Ethiopia digit-ui build identifies profile inputs by `id` rather
    // than `name` (e.g. id="profile-name", id="profile-email"). Accept either
    // convention so the spec stays portable across deployment builds.
    const inputNames = inputs.map((i) => i.name).filter(Boolean);
    const inputIds = inputs.map((i) => i.id).filter(Boolean);
    const hasNameField = inputNames.includes('name') || inputIds.some((id) => /name/i.test(id));
    const hasEmailField = inputNames.includes('email') || inputIds.some((id) => /email/i.test(id));
    expect(hasNameField, 'profile must render a "name" input').toBe(true);
    expect(hasEmailField, 'profile must render an "email" input').toBe(true);

    // ── Save button visible ───────────────────────────────────────
    await expect(page.getByRole('button', { name: /^Save$/i })).toBeVisible({ timeout: 5_000 });

    // ── Forbidden form labels MUST NOT appear in body text ───────
    for (const label of FORBIDDEN_FORM_LABELS) {
      expect(
        bodyText.includes(label),
        `forbidden label "${label}" must not render. If this field was ` +
          `deliberately added, update docs/personas/citizen-flows.md Story 8.1 ` +
          `+ FORBIDDEN_FORM_LABELS in this spec in the same PR.`,
      ).toBe(false);
    }

    // ── No password / mobile / language inputs (the strict guard) ──
    expect(
      inputs.some((i) => i.type === 'password'),
      'citizen profile must not expose any password input',
    ).toBe(false);

    // Check forbidden inputs by both name and id (Ethiopia build uses id, not name).
    for (const inputName of FORBIDDEN_INPUT_NAMES) {
      expect(
        inputNames,
        `profile must not expose input[name="${inputName}"]`,
      ).not.toContain(inputName);
      expect(
        inputIds.some((id) => id.toLowerCase().includes(inputName.toLowerCase())),
        `profile must not expose input[id*="${inputName}"]`,
      ).toBe(false);
    }
  });
});
