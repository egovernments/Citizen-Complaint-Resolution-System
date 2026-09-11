/**
 * Citizen reopen-complaint UI — Story 7.1.
 *
 * State-gated flow. Reopen requires the complaint to be in `RESOLVED`
 * (server-side check). Same seed-plan pattern as rate-resolved-complaint.spec.ts:
 *   1. seedComplaintAsCitizen() — always a CITIZEN token → PENDINGFORASSIGNMENT.
 *   2. driveToPendingAtLme() — the seed plan's actor (GRO + department) ASSIGNs
 *      to the plan's assignee → PENDINGATLME.
 *   3. driveToResolved() — a persona holding PGR_LME RESOLVEs → RESOLVED.
 *   4. Walk the citizen reopen UI for step-0 contract.
 *
 * ADMIN can't be assumed to hold GRO/PGR_LME or an HRMS department on every
 * deployment (see tests/utils/personas.ts for the measured triple), so the
 * seed plan resolves a real (serviceCode, actor, assignee) triple instead of
 * driving ASSIGN/RESOLVE with an ADMIN token.
 *
 * Asserts step 0 (Reason) renders the catalogued title + 4 radio
 * options. Subsequent steps (Upload / Additional / Response) aren't
 * walked here — too brittle without an explicit fixture, and the doc
 * marks them inferred. If they get wired up cleanly, extend this spec
 * + Story 7.1 in the same PR.
 */
import { test, expect } from '@playwright/test';

// Disable trace/video so the spec runs cleanly with --no-deps (the
// .playwright-artifacts-0 dir is only created by the full setup DAG).
test.use({ trace: 'off', video: 'off' });

import { citizenOtpLogin } from '../utils/citizen-login';
import { seedComplaintAsCitizen, driveToPendingAtLme, driveToResolved } from '../utils/seed';
import { BASE_URL } from '../utils/env';

test.describe('Citizen reopen-complaint UI', () => {
  let serviceRequestId: string;

  test.beforeAll(async () => {
    test.setTimeout(120_000);

    const created = await seedComplaintAsCitizen({ description: 'PW reopen UI test — auto-resolved by spec' });
    serviceRequestId = created.srid;
    await driveToPendingAtLme(serviceRequestId);
    await driveToResolved(serviceRequestId);

    console.log(`Seeded ${serviceRequestId} → RESOLVED`);
  });

  test('reopen step 0 renders title + 4 reason radios + Next button', {
    annotation: {
      type: 'description',
      description: `Story 7.1 contract for /citizen/pgr/reopen/{srid} step 0: the page renders the heading "Choose Reason to Re-open the Complaint", the four radio reasons, and a Next control. Subsequent steps (Upload / Additional / Response) aren't walked here because they're inferred in the doc and brittle without an explicit fixture.

Steps:
1. setTimeout 120s; citizenOtpLogin (the suite-wide provisioned citizen).
2. Navigate to /digit-ui/citizen/pgr/reopen/{seeded SR id} (seeded by beforeAll → seedComplaintAsCitizen + driveToPendingAtLme + driveToResolved, the seed plan's real actor/assignee triple — see tests/utils/seed.ts).
3. Wait 5s; assert body does NOT contain "Something went wrong".
4. Assert body matches /Choose Reason to Re-open the Complaint/.
5. For each reason ['No work was done','Only partial work was done','Employee did not turn up','No permanent solution'], assert body contains it.
6. Assert body matches /Next/i (Next is sometimes a styled element, not always a semantic button).

beforeAll is API-only because the reopen UI requires the complaint to be in RESOLVED state and the citizen needs to own it.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:api', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/reopen/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');
    await expect(body).toContainText(/Choose Reason to Re-open the Complaint/);

    // Four radio reasons — Story 7.1 enumeration
    for (const reason of [
      'No work was done',
      'Only partial work was done',
      'Employee did not turn up',
      'No permanent solution',
    ]) {
      await expect(
        body,
        `reopen reason "${reason}" missing`,
      ).toContainText(reason);
    }

    // Next control present (rendered as a styled element on this build,
    // not always a semantic <button>).
    await expect(
      body,
      'reopen step 0 should expose a Next control',
    ).toContainText(/Next/i);
  });
});
