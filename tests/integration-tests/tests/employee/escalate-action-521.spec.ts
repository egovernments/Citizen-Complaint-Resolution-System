/**
 * Employee — manual Escalate action end-to-end (CCRS #521).
 *
 * Closes Gurjeet's #521 retest: complaint at PENDINGATLME, employee
 * picks Escalate from the action dropdown, submits comment, workflow
 * state moves to PENDINGATSUPERVISOR.
 *
 * Self-create-then-test: the spec now seeds its own complaint in
 * PENDINGATLME at suite setup instead of depending on a pre-seeded
 * ASSIGNED_COMPLAINT_ID env var. Setup pulls everything dynamically:
 *   - serviceCode: random active row from RAINMAKER-PGR.ServiceDefs
 *   - locality: random ward leaf from egov-location boundary tree
 *   - phone: shaped by MDMS ValidationConfigs.mobileNumberValidation
 *   - assignee: ADMIN's own uuid (ADMIN carries PGR_LME role on the
 *     tenant, which is what the workflow needs to act on PENDINGATLME)
 *
 * Requires a deployment where:
 *   - PGR ACTION_CONFIGS lists ESCALATE (#521 frontend half)
 *   - PGR workflow has PENDINGATLME → ESCALATE → PENDINGATSUPERVISOR
 *     with PGR_LME role (PR #635 / commit ce302053)
 *   - ADMIN has both GRO (for the ASSIGN) and PGR_LME (for the ESCALATE)
 *     roles on the configured TENANT (true on bomet, naipepea)
 *   - At least one active ServiceDef + leaf boundary on the tenant
 */
import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  TENANT,
  ROOT_TENANT,
  ADMIN_USER,
  ADMIN_PASS,
} from '../utils/env';
import { loginViaApi, getDigitToken } from '../utils/auth';
import { getMobileValidationRule, generateValidMobile } from '../utils/mdms-mobile';

interface BoundaryNode {
  code: string;
  name?: string;
  children?: BoundaryNode[];
}

test.describe('employee — manual Escalate action #521', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let selfCreatedSrid: string | undefined;
  let setupFailure: string | undefined;
  // Reused by the final workflow process-search verification — bomet's
  // workflow service rejects calls with an empty RequestInfo.
  let workflowAuthToken: string | undefined;

  test.beforeAll(async () => {
    try {
      // 1. Admin token (admin acts as both GRO for ASSIGN and as the
      //    LME assignee for the subsequent ESCALATE).
      const admin = await getDigitToken({
        baseURL: BASE_URL,
        tenant: ROOT_TENANT,
        username: ADMIN_USER,
        password: ADMIN_PASS,
      });
      const adminToken = admin.access_token;
      const adminUserInfo = admin.UserRequest as Record<string, unknown>;
      workflowAuthToken = adminToken;
      // adminUserInfo.uuid is the user-service uuid; we use the HRMS
      // employee uuid (resolved below) as the workflow's assignee.

      // 2. Mobile rule from MDMS (drives the citizen phone shape).
      const mobileRule = await getMobileValidationRule(TENANT);
      const citizenPhone = generateValidMobile(mobileRule);

      // 3. Random active serviceCode from MDMS RAINMAKER-PGR.ServiceDefs.
      const sdResp = await fetch(`${BASE_URL}/egov-mdms-service/v1/_search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { apiId: 'Rainmaker', authToken: adminToken },
          MdmsCriteria: {
            tenantId: TENANT,
            moduleDetails: [
              { moduleName: 'RAINMAKER-PGR', masterDetails: [{ name: 'ServiceDefs' }] },
            ],
          },
        }),
      });
      if (!sdResp.ok) {
        throw new Error(`ServiceDefs MDMS lookup failed: HTTP ${sdResp.status}`);
      }
      const sdJson = (await sdResp.json()) as {
        MdmsRes?: {
          'RAINMAKER-PGR'?: {
            ServiceDefs?: Array<{ serviceCode: string; active?: boolean; department?: string }>;
          };
        };
      };
      const allDefs = sdJson.MdmsRes?.['RAINMAKER-PGR']?.ServiceDefs ?? [];
      const activeDefs = allDefs.filter((d) => d.active !== false);
      if (activeDefs.length === 0) {
        throw new Error(`No active ServiceDefs on tenant ${TENANT}`);
      }

      // 4. HRMS employee with PGR_LME role on the tenant — the workflow's
      //    ASSIGN action validates the assignee uuid against HRMS, so the
      //    assignee MUST be HRMS-listed (a user-service-only principal
      //    like ADMIN produces PARSING_ERROR from the workflow service).
      //    Filter client-side because the server-side roles query param
      //    isn't reliable cross-deployment.
      const hrmsResp = await fetch(
        `${BASE_URL}/egov-hrms/employees/_search?tenantId=${encodeURIComponent(TENANT)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker', authToken: adminToken },
          }),
        },
      );
      if (!hrmsResp.ok) {
        throw new Error(`HRMS lookup failed: HTTP ${hrmsResp.status}`);
      }
      const hrmsJson = (await hrmsResp.json()) as {
        Employees?: Array<{
          user: { uuid: string; name?: string; roles?: Array<{ code: string }> };
          assignments?: Array<{ department?: string; isCurrentAssignment?: boolean }>;
        }>;
      };
      const allEmps = hrmsJson.Employees ?? [];
      const lmeCandidates = allEmps.filter((e) =>
        (e.user.roles ?? []).some((r) => r.code === 'PGR_LME'),
      );
      if (lmeCandidates.length === 0) {
        throw new Error(
          `No HRMS employee on tenant=${TENANT} carries role=PGR_LME (deployment gap — ASSIGN cannot proceed). ` +
            `Seed an employee with that role to enable this test.`,
        );
      }
      const assignee = lmeCandidates[Math.floor(Math.random() * lmeCandidates.length)];
      const assigneeHrmsUuid = assignee.user.uuid;
      const assigneeName = assignee.user.name ?? '(unnamed)';
      // Workflow's PGR rule: a complaint's serviceCode-mapped department
      // must match the assignee's current-assignment department. Pick the
      // serviceCode AFTER we know the assignee, constrained to that dept.
      const assigneeDept = (assignee.assignments ?? []).find((a) => a.isCurrentAssignment)?.department
        ?? assignee.assignments?.[0]?.department;
      if (!assigneeDept) {
        throw new Error(
          `Assignee ${assigneeName} (${assigneeHrmsUuid}) on tenant=${TENANT} has no department in HRMS assignments — workflow ASSIGN would reject. Fix the HRMS record.`,
        );
      }
      const matchingDefs = activeDefs.filter((d) => d.department === assigneeDept);
      if (matchingDefs.length === 0) {
        throw new Error(
          `No active ServiceDef maps to department=${assigneeDept} on tenant=${TENANT} ` +
            `(needed to match assignee ${assigneeName}'s current assignment). Either seed a ServiceDef ` +
            `in that department or seed a PGR_LME employee in a department that has ServiceDefs.`,
        );
      }
      const serviceCode = matchingDefs[Math.floor(Math.random() * matchingDefs.length)].serviceCode;

      // 5. Random leaf boundary (ward) from egov-location.
      const bResp = await fetch(
        `${BASE_URL}/egov-location/boundarys/_search` +
          `?tenantId=${encodeURIComponent(TENANT)}` +
          `&hierarchyTypeCode=ADMIN`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker', authToken: adminToken },
          }),
        },
      );
      if (!bResp.ok) {
        throw new Error(`Boundary lookup failed: HTTP ${bResp.status}`);
      }
      const bJson = (await bResp.json()) as {
        TenantBoundary?: Array<{ boundary?: BoundaryNode[] }>;
      };
      const tree = bJson.TenantBoundary?.[0]?.boundary ?? [];
      const leaves: BoundaryNode[] = [];
      const walk = (n: BoundaryNode): void => {
        const kids = n.children ?? [];
        if (kids.length === 0) leaves.push(n);
        else kids.forEach(walk);
      };
      tree.forEach(walk);
      if (leaves.length === 0) {
        throw new Error(`No leaf boundaries on tenant ${TENANT}`);
      }
      const localityCode = leaves[Math.floor(Math.random() * leaves.length)].code;

      // 6. Create the citizen user (admin-side, bypasses OTP).
      const userResp = await fetch(`${BASE_URL}/user/users/_createnovalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
          user: {
            userName: citizenPhone,
            name: 'Escalate Test Citizen',
            mobileNumber: citizenPhone,
            tenantId: TENANT,
            type: 'CITIZEN',
            roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: TENANT }],
            active: true,
          },
        }),
      });
      if (!userResp.ok) {
        throw new Error(`Citizen create failed: HTTP ${userResp.status} ${await userResp.text()}`);
      }

      // 7. Admin creates the PGR complaint on behalf of the citizen.
      const createResp = await fetch(
        `${BASE_URL}/pgr-services/v2/request/_create?tenantId=${TENANT}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
            service: {
              tenantId: TENANT,
              serviceCode,
              description: `[escalate-action-521 self-create] ${new Date().toISOString()}`,
              source: 'web',
              address: {
                city: TENANT,
                locality: { code: localityCode },
                geoLocation: { latitude: 0, longitude: 0 },
              },
              citizen: {
                name: 'Escalate Test Citizen',
                mobileNumber: citizenPhone,
                tenantId: TENANT,
              },
            },
            workflow: { action: 'APPLY' },
          }),
        },
      );
      if (!createResp.ok) {
        throw new Error(`Complaint create failed: HTTP ${createResp.status} ${await createResp.text()}`);
      }
      const createJson = (await createResp.json()) as {
        ServiceWrappers: Array<{ service: Record<string, unknown> & { serviceRequestId: string } }>;
      };
      const srid = createJson.ServiceWrappers[0].service.serviceRequestId;

      // 8. Re-fetch the full service via _search before ASSIGN. The
      //    create response shape differs subtly from the canonical
      //    service object the _update endpoint expects.
      const refetchResp = await fetch(
        `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${srid}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
          }),
        },
      );
      if (!refetchResp.ok) {
        throw new Error(`Complaint re-fetch failed: HTTP ${refetchResp.status}`);
      }
      const refetchJson = (await refetchResp.json()) as {
        ServiceWrappers: Array<{ service: Record<string, unknown> }>;
      };
      const fullService = refetchJson.ServiceWrappers[0].service;

      // 9. Admin assigns the complaint to the HRMS PGR_LME employee → PENDINGATLME.
      //    Admin has GRO role on the tenant so workflow accepts the ASSIGN.
      const assignResp = await fetch(
        `${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
            service: fullService,
            workflow: {
              action: 'ASSIGN',
              assignes: [assigneeHrmsUuid],
              comments: 'escalate-test self-create assign',
            },
          }),
        },
      );
      if (!assignResp.ok) {
        throw new Error(`Complaint ASSIGN failed: HTTP ${assignResp.status} ${await assignResp.text()}`);
      }
      const assignJson = (await assignResp.json()) as {
        ServiceWrappers: Array<{ service: { applicationStatus: string } }>;
      };
      expect(
        assignJson.ServiceWrappers[0].service.applicationStatus,
        'complaint must be at PENDINGATLME after ASSIGN',
      ).toBe('PENDINGATLME');

      selfCreatedSrid = srid;
      console.log(
        `[escalate-self-create] srid=${srid} serviceCode=${serviceCode} dept=${assigneeDept} ` +
          `locality=${localityCode} assignee=${assigneeName} (${assigneeHrmsUuid}) tenant=${TENANT}`,
      );
    } catch (err) {
      setupFailure = (err as Error).message;
      console.log(`[escalate-self-create] FAILED: ${setupFailure}`);
    }
  });

  test('PENDINGATLME → Escalate → PENDINGATSUPERVISOR (workflow state moves)', async ({ page }) => {
    test.skip(
      !selfCreatedSrid,
      `Self-create setup failed — cannot run the escalate flow without a PENDINGATLME complaint. ` +
        `Cause: ${setupFailure ?? 'unknown'}`,
    );

    // ============ API session injection ============
    // Login as ADMIN (carries PGR_LME role on TENANT, which is what
    // the workflow requires to ESCALATE from PENDINGATLME).
    await loginViaApi(page, {
      baseURL: BASE_URL,
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });

    // ============ Open the assigned complaint detail ============
    await page.goto(
      `${BASE_URL}/digit-ui/employee/pgr/complaint-details/${selfCreatedSrid}?cb=${Date.now()}`,
    );
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_000);

    // ============ Take action → Escalate ============
    const takeAction = page.getByRole('button', { name: /take action/i }).first();
    await expect(takeAction).toBeVisible({ timeout: 15_000 });
    await takeAction.click();
    await page.waitForTimeout(1_500);

    const escalateOption = page.getByText(/^Escalate$/i).first();
    await expect(
      escalateOption,
      '#521 — Escalate option must appear in the Take action menu when state = PENDINGATLME',
    ).toBeVisible({ timeout: 8_000 });
    await escalateOption.click();
    await page.waitForTimeout(2_000);

    // ============ Fill comment + submit ============
    const commentBox = page.locator('textarea').first();
    await expect(commentBox).toBeVisible({ timeout: 10_000 });
    await commentBox.fill('Integration test escalation comment.');

    const submitBtn = page.getByRole('button', { name: /^submit$|^send$|^escalate$/i }).first();
    await submitBtn.click();
    await page.waitForTimeout(3_000);

    // ============ Verify workflow state via process-search ============
    const wfResp = await page.request.post(
      `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?businessIds=${selfCreatedSrid}&tenantId=${TENANT}`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: {
          RequestInfo: { apiId: 'Rainmaker', authToken: workflowAuthToken },
        },
      },
    );
    expect(wfResp.ok(), `workflow process-search HTTP ${wfResp.status()}`).toBeTruthy();
    const body = await wfResp.text();
    expect(
      body,
      '#521 — workflow state must move to PENDINGATSUPERVISOR after Escalate submit',
    ).toContain('PENDINGATSUPERVISOR');
  });
});
