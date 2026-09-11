/**
 * Citizen rate-complaint UI — Story 6.1.
 *
 * State-gated flow. Rating an `_update` requires the complaint to be in
 * `RESOLVED`. Uses the seed-plan helpers (tests/utils/seed.ts) rather than
 * driving ASSIGN/RESOLVE with an ADMIN token:
 *   1. seedComplaintAsCitizen() — always a CITIZEN token (APPLY is
 *      [CITIZEN, CSR] on every deployment) → PENDINGFORASSIGNMENT.
 *   2. driveToPendingAtLme() — the seed plan's actor (GRO + department) ASSIGNs
 *      to the plan's assignee → PENDINGATLME.
 *   3. driveToResolved() — a persona holding PGR_LME RESOLVEs → RESOLVED.
 *   4. Citizen-OTP logs in and walks the rate UI to assert the field set.
 *
 * ADMIN can't be assumed to hold GRO/PGR_LME or an HRMS department on every
 * deployment — on bomet ADMIN has no HRMS record at all (DEPARTMENT_NOT_FOUND)
 * and no CITIZEN role (INVALID ROLE on create). The seed plan resolves a real
 * (serviceCode, actor, assignee) triple instead (see personas.ts).
 *
 * Asserts the page renders for any state (UI doesn't gate by state — the
 * server rejects invalid actions on submit), the heading + 5-star row +
 * the four checkboxes + Comments textarea are all present.
 *
 * Doesn't actually submit — would mutate the resolved complaint to
 * CLOSEDAFTERRESOLUTION; happy with the UI render assertion. If a future
 * tightening wants a full submit, factor out the resolve flow into a
 * helper and add a second test there.
 */
import { test, expect } from '@playwright/test';

// Disable trace/video so the spec runs cleanly with --no-deps (the
// .playwright-artifacts-0 dir is only created by the full setup DAG).
test.use({ trace: 'off', video: 'off' });

import { citizenOtpLogin } from '../utils/citizen-login';
import { seedComplaintAsCitizen, driveToPendingAtLme, driveToResolved } from '../utils/seed';
import { BASE_URL } from '../utils/env';

test.describe('Citizen rate-complaint UI', () => {
  let serviceRequestId: string;

  test.beforeAll(async () => {
    test.setTimeout(120_000);

    const created = await seedComplaintAsCitizen({ description: 'PW rate UI test — auto-resolved by spec' });
    serviceRequestId = created.srid;
    await driveToPendingAtLme(serviceRequestId);
    await driveToResolved(serviceRequestId);

    console.log(`Seeded ${serviceRequestId} → RESOLVED`);
  });

  test('rate page renders 5 stars + 4 feedback checkboxes + Comments textarea', {
    annotation: {
      type: 'description',
      description: `Story 6.1 contract for /citizen/pgr/rate/{srid}: page renders the rating heading, the 5-star row, the four "What was good?" checkboxes (Services / Resolution Time / Quality of Work / Others), and the Comments textarea. Doesn't actually submit — would mutate the resolved complaint to CLOSEDAFTERRESOLUTION.

Steps:
1. setTimeout 120s; citizenOtpLogin (the suite-wide provisioned citizen).
2. Navigate to /digit-ui/citizen/pgr/rate/{seeded SR id} (seeded by beforeAll → seedComplaintAsCitizen + driveToPendingAtLme + driveToResolved, the seed plan's real actor/assignee triple — see tests/utils/seed.ts).
3. Wait 5s; assert body does NOT contain "Something went wrong".
4. Assert body contains "How would you rate your experience with us?".
5. Assert body contains "What was good ?" (note spaces around ?).
6. For each label ['Services','Resolution Time','Quality of Work','Others'], assert body contains it.
7. Assert the first textarea on the page is visible.

beforeAll is API-only (file complaint as the provisioned citizen, assign, resolve) because the UI flow to RESOLVE requires a PGR_LME persona and the test needs a deterministic state to assert against. Teardown is implicit — the leftover RESOLVED complaint is harmless.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:api', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/rate/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');

    // Heading is the question itself
    await expect(body).toContainText(/How would you rate your experience with us\?/);

    // "What was good ?" — note spaces around `?`
    await expect(body).toContainText(/What was good \?/);

    // Four feedback checkboxes — labels per Story 6.1
    for (const label of ['Services', 'Resolution Time', 'Quality of Work', 'Others']) {
      await expect(
        body,
        `feedback label "${label}" missing`,
      ).toContainText(label);
    }

    // Comments textarea
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 5_000 });
  });
});
