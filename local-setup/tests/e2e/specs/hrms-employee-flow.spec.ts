import { test, expect } from '@playwright/test';
import { getDigitToken, loginViaApi } from '../utils/auth';
import { requiredEnv } from '../utils/identity';
import { getMobileValidationRule, generateValidMobile } from '../common/mdms-mobile';
import { getEmployees } from '../common/hrms-employees';

const BASE_URL = requiredEnv('BASE_URL');
const TENANT = requiredEnv('DIGIT_TENANT');
const ADMIN_USER = requiredEnv('DIGIT_USERNAME');
const ADMIN_PASS = requiredEnv('DIGIT_PASSWORD');

// Tenant-aware phone, sourced from MDMS at suite setup. See
// common/mdms-mobile.ts — replaces the env-heuristic uniqueMobile().
let PHONE: string;
const EMPLOYEE_NAME = 'Playwright Test Employee';

test.describe.serial('HRMS employee creation and login', () => {
  test.slow();

  let employeeCode: string | undefined;
  let createSucceeded = false;

  test.beforeAll(async () => {
    const rule = await getMobileValidationRule(TENANT, {
      baseURL: BASE_URL,
      adminUser: ADMIN_USER,
      adminPassword: ADMIN_PASS,
    });
    PHONE = generateValidMobile(rule);
    console.log(`[hrms-flow] phone=${PHONE} pattern=${rule.pattern} (tenant=${TENANT})`);
  });

  test('login as ADMIN', async ({ page }) => {
    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    expect(page.url()).toContain('/employee');
  });

  test('create employee via API', async () => {
    // Use HRMS API directly for reliability — UI form filling is fragile
    // with DIGIT's custom components. The API test proves the default
    // password patch works end-to-end.
    const tokenResponse = await getDigitToken({
      baseURL: BASE_URL,
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });
    expect(tokenResponse.access_token).toBeTruthy();

    const accessToken = tokenResponse.access_token;
    const userInfo = tokenResponse.UserRequest;

    // Department, designation and jurisdiction come from the admin persona's
    // own HRMS record: a workspace has no fixed codes to hardcode.
    const [admin] = await getEmployees(TENANT, { baseURL: BASE_URL, adminUser: ADMIN_USER, adminPassword: ADMIN_PASS, uuids: [userInfo.uuid] });
    const adminAssignment = admin?.assignments?.[0] as { department?: string; designation?: string } | undefined;
    const adminJurisdiction = admin?.jurisdictions?.[0] as { hierarchy?: string; boundaryType?: string; boundary?: string } | undefined;
    expect(adminAssignment?.department && adminJurisdiction?.boundary, 'the admin persona has no HRMS assignment and jurisdiction to copy').toBeTruthy();

    const dob = new Date('1990-01-15').getTime();
    const appointmentDate = new Date('2024-01-01').getTime();

    const createPayload = {
      RequestInfo: {
        apiId: 'Rainmaker',
        authToken: accessToken,
        userInfo,
      },
      Employees: [
        {
          tenantId: TENANT,
          employeeStatus: 'EMPLOYED',
          employeeType: 'PERMANENT',
          dateOfAppointment: appointmentDate,
          user: {
            name: EMPLOYEE_NAME,
            mobileNumber: PHONE,
            gender: 'MALE',
            dob,
            correspondenceAddress: '123 Test Street',
            tenantId: TENANT,
            roles: [
              { code: 'EMPLOYEE', name: 'Employee', tenantId: TENANT },
              { code: 'GRO', name: 'Grievance Routing Officer', tenantId: TENANT },
            ],
          },
          jurisdictions: [
            {
              hierarchy: adminJurisdiction!.hierarchy,
              boundaryType: adminJurisdiction!.boundaryType,
              boundary: adminJurisdiction!.boundary,
              tenantId: TENANT,
              roles: [
                { code: 'EMPLOYEE', name: 'Employee', tenantId: TENANT },
                { code: 'GRO', name: 'Grievance Routing Officer', tenantId: TENANT },
              ],
            },
          ],
          assignments: [
            {
              department: adminAssignment!.department,
              designation: adminAssignment!.designation,
              fromDate: appointmentDate,
              isCurrentAssignment: true,
            },
          ],
          serviceHistory: [],
          education: [],
          tests: [],
        },
      ],
    };

    const resp = await fetch(
      `${BASE_URL}/egov-hrms/employees/_create?tenantId=${TENANT}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createPayload),
      },
    );

    expect(resp.ok, `HRMS create failed (${resp.status}): ${(await resp.clone().text()).slice(0, 300)}`).toBe(true);

    const data = await resp.json();
    expect(data.Employees).toBeDefined();
    expect(data.Employees.length).toBeGreaterThan(0);

    employeeCode = data.Employees[0].code;
    console.log(`Created employee: ${employeeCode} (phone: ${PHONE})`);
    createSucceeded = true;

    // Wait for async persistence (Kafka → persister → Postgres)
    await new Promise((r) => setTimeout(r, 3000));
  });

  test('verify employee searchable via HRMS API', async () => {
    test.skip(!createSucceeded, 'Skipped — employee not created');

    const tokenResponse = await getDigitToken({
      baseURL: BASE_URL,
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });

    const searchResp = await fetch(
      `${BASE_URL}/egov-hrms/employees/_search?tenantId=${TENANT}&phone=${PHONE}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResponse.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          RequestInfo: {
            apiId: 'Rainmaker',
            authToken: tokenResponse.access_token,
            userInfo: tokenResponse.UserRequest,
          },
        }),
      },
    );

    expect(searchResp.ok).toBe(true);
    const data = await searchResp.json();
    expect(data.Employees).toBeDefined();
    expect(data.Employees.length).toBe(1);
    expect(data.Employees[0].user.name).toBe(EMPLOYEE_NAME);
    expect(data.Employees[0].user.mobileNumber).toBe(PHONE);
  });

  test('verify new employee can authenticate via API', async () => {
    test.skip(!createSucceeded, 'Skipped — employee not created');
    expect(employeeCode).toBeTruthy();

    // HRMS gives every new employee the deployment's default password
    // (egov_hrms_default_password, a deploy secret: no fixed value to assume).
    // Employee username is the employee code. A new HRMS employee is not
    // linked to a Keycloak account, so this is an egov-user check, not a
    // sign-in: the employee cannot use the hosted sign-in until invited.
    const resp = await fetch(`${BASE_URL}/user/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=' },
      body: new URLSearchParams({
        grant_type: 'password', scope: 'read', userType: 'EMPLOYEE',
        username: employeeCode!, password: requiredEnv('EGOV_HRMS_DEFAULT_PASSWORD'), tenantId: TENANT,
      }).toString(),
    });
    expect(resp.ok, `egov-user refused the HRMS default password (${resp.status})`).toBe(true);
    const tokenResponse = await resp.json();
    expect(tokenResponse.access_token).toBeTruthy();
    expect(tokenResponse.UserRequest).toBeDefined();
    console.log(`Employee ${employeeCode} authenticated successfully via API`);
  });
});
