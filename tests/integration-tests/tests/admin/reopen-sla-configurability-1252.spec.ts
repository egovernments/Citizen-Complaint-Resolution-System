/**
 * PGR reopen-window MDMS constant actually impacts the citizen UI, live (#1252).
 *
 * tests/citizen/reopen-window-1252.spec.ts already proves the citizen timeline
 * consumes whatever REOPENSLA MDMS returns — but it stubs MDMS entirely, so it
 * never proves the real RAINMAKER-PGR.UIConstants record can actually be
 * edited and that the edit has real effect. This spec closes that gap the
 * other way round from a stub: instead of faking the MDMS response, it makes
 * a real _update call against the live DEFAULT record, and fakes only the
 * complaint/workflow surface (same shapes as the sibling spec) so the
 * complaint's "resolved N seconds ago" clock is under the test's control.
 *
 * Sets REOPENSLA to the shortest value the schema allows
 * (configurator/src/admin/schemaDescriptors/pgr-ui-constants.ts: min: 60000),
 * so the real window can be waited out for real inside one test, then
 * reverts to whatever was actually live before the test ran — not a
 * hardcoded guess, since this is shared/live tenant data, not scratch PW_ row.
 */
import { test, expect } from '@playwright/test';
import {
  apiAuth,
  mdmsSearch,
  mdmsUpdate,
  type AuthInfo,
  type MdmsRecord,
} from '../utils/manage/api';
import { ROOT_TENANT, TENANT, BASE_URL } from '../utils/env';
import { citizenOtpLogin } from '../utils/citizen-login';

const SCHEMA = 'RAINMAKER-PGR.UIConstants';
const RECORD_KEY = 'DEFAULT';
const COMPLAINT_ID = 'reopensla-1252-live';
// Shortest value the schema allows — short enough to wait out for real
// inside one test, while still exercising a genuine, non-trivial window.
const TEST_WINDOW_MS = 60_000;

async function getDefaultRecord(auth: AuthInfo): Promise<MdmsRecord> {
  const records = await mdmsSearch(auth, ROOT_TENANT, SCHEMA, {
    uniqueIdentifiers: [RECORD_KEY],
  });
  const record = records[0];
  if (!record) {
    throw new Error(
      `No ${SCHEMA} record keyed "${RECORD_KEY}" on ${ROOT_TENANT} — #1252 assumes this deployment already seeded one.`,
    );
  }
  return record;
}

function reopenSlaOf(record: MdmsRecord): number {
  return Number((record.data as Record<string, unknown>).REOPENSLA);
}

/**
 * Restore REOPENSLA to `targetReopenSla`, retrying and re-verifying rather
 * than firing one update and trusting it. Confirmed live against
 * bometfeedbackhub (2026-09-01): an _update call requesting isActive:true
 * does not always persist it on the first attempt — a bare retry of the
 * identical payload fixed it moments later. Cleanup must not leave the
 * shared record broken because of that intermittent behaviour.
 */
async function restoreReopenSla(auth: AuthInfo, targetReopenSla: number, attempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const current = await getDefaultRecord(auth);
    if (reopenSlaOf(current) === targetReopenSla && current.isActive !== false) return;
    await mdmsUpdate(
      auth,
      { ...current, data: { ...current.data, REOPENSLA: targetReopenSla } },
      true,
    );
  }
  const final = await getDefaultRecord(auth);
  if (reopenSlaOf(final) !== targetReopenSla || final.isActive === false) {
    throw new Error(
      `Could not restore DEFAULT.REOPENSLA to ${targetReopenSla} (isActive:true) after ${attempts} attempts — ` +
        `left it at REOPENSLA=${reopenSlaOf(final)} isActive=${final.isActive}. Fix the shared record manually.`,
    );
  }
}

test.describe('PGR reopen-window MDMS constant has real effect on the citizen UI (#1252)', () => {
  let auth: AuthInfo;
  let originalReopenSla: number;

  test.beforeAll(async () => {
    auth = await apiAuth();
    originalReopenSla = reopenSlaOf(await getDefaultRecord(auth));
  });

  test.afterAll(async () => {
    await restoreReopenSla(auth, originalReopenSla);
  });

  test(
    'a real, shortest-allowed REOPENSLA update actually gates the citizen REOPEN button in real time',
    {
      annotation: {
        type: 'description',
        description:
          'No MDMS stubbing. Steps:\n' +
          '1. Update the real DEFAULT record to REOPENSLA=60000 (the schema minimum) via a real ' +
          '   mdms-v2 _update call, and confirm the response reflects it.\n' +
          '2. Stub only the complaint/workflow surface — same shapes as ' +
          '   tests/citizen/reopen-window-1252.spec.ts — with the complaint resolved at the ' +
          '   actual current wall-clock time.\n' +
          '3. Open the citizen complaint page; assert REOPEN is visible (inside the real window) ' +
          '   and RATE is visible (proof the timeline actually rendered).\n' +
          '4. Wait out the real 60s window, reload (a hard reload gets a fresh MDMS fetch — ' +
          '   useReopenWindow\'s cacheTime:Infinity only survives client-side SPA navigation).\n' +
          '5. Assert REOPEN is now gone, RATE is still visible.\n' +
          '6. afterAll reverts REOPENSLA to whatever was actually live before this test ran.',
      },
      tag: ['@area:pgr', '@ccrs:1252', '@kind:regression', '@kind:lifecycle', '@layer:ui', '@persona:citizen'],
    },
    async ({ page }) => {
      test.setTimeout(180_000);

      // --- 1. Real MDMS update, not a stub ---
      const before = await getDefaultRecord(auth);
      const updated = await mdmsUpdate(
        auth,
        { ...before, data: { ...before.data, REOPENSLA: TEST_WINDOW_MS } },
        true,
      );
      expect(reopenSlaOf(updated)).toBe(TEST_WINDOW_MS);
      expect(updated.isActive, 'DEFAULT must stay isActive:true after setting the live test window').toBe(true);

      // --- 2. Stub only the complaint/workflow surface, real current timestamp ---
      const resolvedAt = Date.now();

      await page.route('**/pgr-services/v2/request/_search*', async (route) => {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            ServiceWrappers: [
              {
                service: {
                  tenantId: TENANT,
                  serviceRequestId: COMPLAINT_ID,
                  serviceCode: 'streetlights',
                  description: 'Streetlight not working',
                  applicationStatus: 'RESOLVED',
                  source: 'citizen',
                  rating: null,
                  address: { landmark: 'Near school', locality: { code: 'Locality1' }, pincode: '123456' },
                  auditDetails: { createdTime: resolvedAt - 3600 * 1000, lastModifiedTime: resolvedAt },
                },
                workflow: { action: 'RESOLVE' },
              },
            ],
          }),
        });
      });

      const reopenAction = {
        action: 'REOPEN',
        roles: ['CITIZEN', 'CFC', 'CSR', 'PGR_VIEWER'],
        nextState: 'PENDINGFORASSIGNMENT',
      };
      const rateAction = {
        action: 'RATE',
        roles: ['CITIZEN', 'CFC', 'CSR', 'PGR_VIEWER'],
        nextState: 'CLOSEDAFTERRESOLUTION',
      };
      const stateActions = [reopenAction, rateAction];

      await page.route('**/egov-workflow-v2/egov-wf/businessservice/_search*', async (route) => {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            BusinessServices: [
              {
                tenantId: TENANT,
                businessService: 'PGR',
                states: [
                  { uuid: 'resolved-state-uuid', state: 'RESOLVED', isStateUpdatable: false, actions: stateActions },
                ],
              },
            ],
          }),
        });
      });

      await page.route('**/egov-workflow-v2/egov-wf/process/_search*', async (route) => {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            ProcessInstances: [
              {
                id: 'wf-reopensla-1252-live',
                tenantId: TENANT,
                businessId: COMPLAINT_ID,
                businessService: 'PGR',
                action: 'RESOLVE',
                state: {
                  uuid: 'resolved-state-uuid',
                  // WorkflowService.getDetailsById maps the checkpoint's `status` from
                  // state.applicationStatus, not state.state — see the sibling spec's note.
                  applicationStatus: 'RESOLVED',
                  isStateUpdatable: false,
                  actions: stateActions,
                },
                nextActions: stateActions,
                timeline: [],
                auditDetails: { createdTime: resolvedAt - 3600 * 1000, lastModifiedTime: resolvedAt },
                assigner: { name: 'Jane Doe', mobileNumber: '9800000001' },
              },
            ],
          }),
        });
      });

      const reopenLink = page.locator(`a[href*="/citizen/pgr/reopen/${COMPLAINT_ID}"]`);
      const rateLink = page.locator(`a[href*="/citizen/pgr/rate/${COMPLAINT_ID}"]`);

      // --- 3. Open the real citizen page; inside the real window ---
      await citizenOtpLogin(page);
      await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints/${COMPLAINT_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText('Something went wrong');

      await expect(reopenLink).toBeVisible();
      await expect(rateLink).toBeVisible();

      // --- 4. Wait out the real window, then hard-reload ---
      await page.waitForTimeout(TEST_WINDOW_MS + 10_000);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');

      // --- 5. Outside the real window ---
      await expect(rateLink).toBeVisible();
      await expect(reopenLink).toHaveCount(0);
    },
  );
});
