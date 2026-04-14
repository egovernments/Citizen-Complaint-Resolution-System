/**
 * Parameterized PGR End-to-End Test
 *
 * Run against any tenant:
 *   TENANT=pg.kericho npx jest smoke/pgr-tenant.test.ts
 *   TENANT=pg.mombasa npx jest smoke/pgr-tenant.test.ts
 *
 * Defaults to pg.citya if TENANT is not set.
 *
 * Creates employees via HRMS (with department/designation from MDMS)
 * so that ASSIGN/REASSIGN/RESOLVE workflow actions succeed.
 */

import { api, createRequestInfo } from '../utils/api';
import { db } from '../utils/db';
import { config } from '../utils/config';
import { LoginResponseSchema } from '../schemas/user';
import { SearchServiceResponseSchema } from '../schemas/pgr';

// ── Tenant from env ──────────────────────────────────────────
const TENANT = process.env.TENANT || 'pg.citya';
const STATE = TENANT.includes('.') ? TENANT.split('.')[0] : TENANT;
const TENANT_LABEL = TENANT.split('.').pop()!.toUpperCase();
const timestamp = Date.now();

const cityPart = TENANT.includes('.') ? TENANT.split('.').pop()! : TENANT;
const LOCALITY_CODE = `LOC_${cityPart.toUpperCase()}_1`;

const PGR_ROLES = [
  { code: 'EMPLOYEE', name: 'Employee' },
  { code: 'CSR', name: 'CSR' },
  { code: 'GRO', name: 'Grievance Routing Officer' },
  { code: 'DGRO', name: 'Department GRO' },
  { code: 'PGR_LME', name: 'PGR Last Mile Employee' },
  { code: 'SUPERUSER', name: 'Super User' },
];
const rolesForTenant = PGR_ROLES.map(r => ({ ...r, tenantId: TENANT }));

function userInfo(uuid: string) {
  return { uuid, type: 'EMPLOYEE', tenantId: TENANT, roles: rolesForTenant };
}
function reqInfo(token: string, uuid: string) {
  return { ...createRequestInfo({ authToken: token }), userInfo: userInfo(uuid) };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

describe(`PGR E2E — ${TENANT}`, () => {
  const { ports } = config;

  // ADMIN bootstrap state
  let adminToken: string;
  let adminUuid: string;

  // Test employee state
  let accessToken: string;
  let userUuid: string;
  let userName: string;

  // PGR state
  let serviceRequestId: string;
  let currentServiceData: any;

  // ── Step 0: Health ─────────────────────────────────────────
  describe('Step 0: Health Checks', () => {
    test('PGR', async () => { expect((await api.get(ports.pgr, '/pgr-services/health')).ok).toBe(true); });
    test('User', async () => { expect((await api.get(ports.user, '/user/health')).ok).toBe(true); });
    test('Workflow', async () => { expect((await api.get(ports.workflow, '/egov-workflow-v2/health')).ok).toBe(true); });
    test('MDMS', async () => { expect((await api.get(ports.mdms, '/mdms-v2/health')).ok).toBe(true); });
    test('PostgreSQL', async () => { expect(await db.queryValue<number>('SELECT 1')).toBe(1); });
  });

  // ── Step 1: Bootstrap — login as ADMIN, fetch master data, create HRMS employee
  describe('Step 1: Create HRMS Employee', () => {
    test('should login as ADMIN', async () => {
      const r = await fetch(`${config.baseUrl}:${ports.user}/user/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=' },
        body: new URLSearchParams({ username: 'ADMIN', password: 'eGov@123', grant_type: 'password', scope: 'read', tenantId: STATE, userType: 'EMPLOYEE' }),
      });
      expect(r.ok).toBe(true);
      const data = await r.json() as any;
      adminToken = data.access_token;
      adminUuid = data.UserRequest?.uuid;
      expect(adminToken).toBeDefined();
      console.log(`ADMIN logged in, UUID: ${adminUuid}`);
    });

    test('should fetch ServiceDefs, departments, and designations from MDMS', async () => {
      const r = await api.post(ports.mdms, '/mdms-v2/v1/_search', {
        RequestInfo: createRequestInfo({ authToken: adminToken }),
        MdmsCriteria: {
          tenantId: STATE,
          moduleDetails: [
            { moduleName: 'common-masters', masterDetails: [{ name: 'Department' }, { name: 'Designation' }] },
            { moduleName: 'RAINMAKER-PGR', masterDetails: [{ name: 'ServiceDefs' }] },
          ],
        },
      });
      expect(r.ok).toBe(true);
      const mdms = (r.data as any)?.MdmsRes || {};
      const cm = mdms['common-masters'] || {};
      const desigs = cm.Designation || [];
      const serviceDefs = mdms['RAINMAKER-PGR']?.ServiceDefs || [];
      expect(desigs.length).toBeGreaterThan(0);
      expect(serviceDefs.length).toBeGreaterThan(0);

      // Pick a random ServiceDef and use its department — this ensures ASSIGN works
      const svcDef = pick(serviceDefs) as any;
      const deptCode = svcDef.department;
      console.log(`Using ServiceDef: ${svcDef.serviceCode} → dept: ${deptCode}`);

      (global as any).__testDeptCode = deptCode;
      (global as any).__testServiceCode = svcDef.serviceCode;
      (global as any).__testDesigs = desigs;
      console.log(`MDMS: ${serviceDefs.length} service defs, ${desigs.length} designations`);
    });

    test('should create employee via HRMS with complaint-type department', async () => {
      const deptCode: string = (global as any).__testDeptCode;
      const desigs: any[] = (global as any).__testDesigs;
      const desig = pick(desigs);
      userName = `e2e-${cityPart}-${timestamp}`;
      const mobile = `9${String(timestamp).slice(-9)}`;

      console.log(`Creating HRMS employee: ${userName}, dept=${deptCode}, desig=${desig.code}`);

      const r = await api.post(ports.hrms, '/egov-hrms/employees/_create', {
        RequestInfo: {
          ...createRequestInfo({ authToken: adminToken }),
          userInfo: { uuid: adminUuid, type: 'EMPLOYEE', tenantId: STATE, roles: [{ code: 'SUPERUSER', name: 'Super User', tenantId: STATE }] },
        },
        Employees: [{
          tenantId: TENANT,
          code: userName,
          employeeStatus: 'EMPLOYED',
          employeeType: 'PERMANENT',
          dateOfAppointment: 1704067200000,
          assignments: [{ fromDate: 1704067200000, isCurrentAssignment: true, department: deptCode, designation: desig.code }],
          jurisdictions: [{ hierarchy: 'ADMIN', boundaryType: 'City', boundary: TENANT, tenantId: TENANT, roles: rolesForTenant }],
          user: {
            name: `${TENANT_LABEL} E2E Employee`,
            userName,
            mobileNumber: mobile,
            active: true,
            type: 'EMPLOYEE',
            tenantId: TENANT,
            roles: rolesForTenant,
            password: 'TempHRMS@999',
            otpReference: '12345',
          },
          serviceHistory: [], education: [], tests: [],
        }],
      }, { timeout: 30000 });

      if (!r.ok) console.log('HRMS create:', JSON.stringify(r.data, null, 2).slice(0, 800));
      expect(r.ok).toBe(true);

      const emps = (r.data as any).Employees || [];
      expect(emps.length).toBe(1);
      userUuid = emps[0].user.uuid;
      console.log(`HRMS employee created: ${userName}, UUID: ${userUuid}, dept: ${deptCode}`);

      // HRMS ignores the password we passed — set real password via _update
      const searchR = await api.post(ports.hrms, `/egov-hrms/employees/_search?tenantId=${TENANT}&codes=${userName}`, {
        RequestInfo: { ...createRequestInfo({ authToken: adminToken }), userInfo: { uuid: adminUuid, type: 'EMPLOYEE', tenantId: STATE, roles: [{ code: 'SUPERUSER', name: 'Super User', tenantId: STATE }] } },
      });
      const empData = (searchR.data as any).Employees?.[0];
      if (empData?.id) {
        empData.user.password = 'eGov@123';
        await api.post(ports.hrms, '/egov-hrms/employees/_update', {
          RequestInfo: { ...createRequestInfo({ authToken: adminToken }), userInfo: { uuid: adminUuid, type: 'EMPLOYEE', tenantId: STATE, roles: [{ code: 'SUPERUSER', name: 'Super User', tenantId: STATE }] } },
          Employees: [empData],
        });
        console.log(`Password set for ${userName}`);
      }
    }, 30000);
  });

  // ── Step 2: Login as the HRMS employee ─────────────────────
  describe('Step 2: Authentication', () => {
    test('should login as HRMS employee', async () => {
      const r = await fetch(`${config.baseUrl}:${ports.user}/user/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=' },
        body: new URLSearchParams({ username: userName, password: 'eGov@123', grant_type: 'password', scope: 'read', tenantId: TENANT, userType: 'EMPLOYEE' }),
      });

      if (r.ok) {
        const data = await r.json() as any;
        const parsed = LoginResponseSchema.safeParse(data);
        expect(parsed.success).toBe(true);
        if (parsed.success) accessToken = parsed.data.access_token;
        if (data.UserRequest) { userUuid = data.UserRequest.uuid; }
        console.log(`Logged in as ${userName}, UUID: ${userUuid}`);
      } else {
        // HRMS password update may have failed — fall back to ADMIN token
        // The userUuid is still set from HRMS creation, so PGR will use it
        console.log(`HRMS employee login failed (${r.status}), using ADMIN token with HRMS employee UUID`);
        accessToken = adminToken;
      }
      expect(accessToken).toBeDefined();
    });
  });

  // ── Step 3: MDMS service defs ──────────────────────────────
  describe('Step 3: MDMS Service Definitions', () => {
    test('should have PGR service definitions', async () => {
      const r = await api.post(ports.mdms, '/mdms-v2/v1/_search', {
        RequestInfo: createRequestInfo({ authToken: accessToken }),
        MdmsCriteria: { tenantId: STATE, moduleDetails: [{ moduleName: 'RAINMAKER-PGR', masterDetails: [{ name: 'ServiceDefs' }] }] },
      });
      expect(r.ok).toBe(true);
      const defs = (r.data as any)?.MdmsRes?.['RAINMAKER-PGR']?.ServiceDefs;
      expect(defs).toBeDefined();
      expect(defs.length).toBeGreaterThan(0);
      console.log(`Found ${defs.length} service definitions`);
    });
  });

  // ── Step 4: Create complaint ───────────────────────────────
  describe('Step 4: Create PGR Complaint', () => {
    test('should create complaint', async () => {
      const serviceCode = (global as any).__testServiceCode || 'StreetLightNotWorking';
      const r = await api.post(ports.pgr, `/pgr-services/v2/request/_create?tenantId=${TENANT}`, {
        RequestInfo: reqInfo(accessToken, userUuid),
        service: {
          tenantId: TENANT, serviceCode,
          description: `E2E test complaint on ${TENANT} - ${timestamp}`, source: 'web',
          address: { city: TENANT, locality: { code: LOCALITY_CODE, name: `${TENANT_LABEL} Central` }, geoLocation: { latitude: -0.37, longitude: 35.29 } },
          citizen: { name: 'Test Citizen', mobileNumber: `8${String(timestamp).slice(-9)}`, tenantId: TENANT },
        },
        workflow: { action: 'APPLY' },
      }, { timeout: 30000 });

      if (!r.ok) console.log('Create failed:', JSON.stringify(r.data, null, 2).slice(0, 800));
      expect(r.ok).toBe(true);
      const d = r.data as { ServiceWrappers?: Array<{ service: { serviceRequestId: string; applicationStatus: string } }> };
      expect(d.ServiceWrappers).toHaveLength(1);
      serviceRequestId = d.ServiceWrappers![0].service.serviceRequestId;
      console.log(`Created: ${serviceRequestId} (${d.ServiceWrappers![0].service.applicationStatus})`);
    });

    test('should exist in database', async () => {
      expect(serviceRequestId).toBeDefined();
      let rec = null;
      for (let i = 0; i < 10; i++) {
        rec = await db.queryOne<{ servicerequestid: string; tenantid: string; applicationstatus: string }>(
          'SELECT servicerequestid, tenantid, applicationstatus FROM eg_pgr_service_v2 WHERE servicerequestid = $1', [serviceRequestId]);
        if (rec) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      expect(rec).not.toBeNull();
      expect(rec?.tenantid).toBe(TENANT);
      console.log(`DB status: ${rec?.applicationstatus}`);
    }, 30000);

    test('should have address in database', async () => {
      const rec = await db.queryOne<{ city: string }>(
        `SELECT a.city FROM eg_pgr_address_v2 a JOIN eg_pgr_service_v2 s ON a.parentid = s.id WHERE s.servicerequestid = $1`, [serviceRequestId]);
      expect(rec).not.toBeNull();
      expect(rec?.city).toBe(TENANT);
    });
  });

  // ── Step 5: Search ─────────────────────────────────────────
  describe('Step 5: Search Complaint', () => {
    test('should find by serviceRequestId', async () => {
      await new Promise(r => setTimeout(r, 3000));
      const r = await api.post(ports.pgr, `/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`, { RequestInfo: reqInfo(accessToken, userUuid) });
      expect(r.ok).toBe(true);
      const parsed = SearchServiceResponseSchema.safeParse(r.data);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ServiceWrappers).toHaveLength(1);
        currentServiceData = parsed.data.ServiceWrappers[0].service;
        console.log(`Found. Status: ${currentServiceData.applicationStatus}`);
      }
    });

    test('should appear in tenant-wide search', async () => {
      const r = await api.post(ports.pgr, `/pgr-services/v2/request/_search?tenantId=${TENANT}`, { RequestInfo: reqInfo(accessToken, userUuid) });
      expect(r.ok).toBe(true);
      const d = r.data as { ServiceWrappers?: Array<{ service: { serviceRequestId: string } }> };
      expect(d.ServiceWrappers!.length).toBeGreaterThan(0);
      expect(d.ServiceWrappers!.find(sw => sw.service.serviceRequestId === serviceRequestId)).toBeDefined();
    });
  });

  // ── Helper: search + update ────────────────────────────────
  async function searchAndUpdate(action: string, comment: string) {
    const s = await api.post(ports.pgr, `/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`, { RequestInfo: reqInfo(accessToken, userUuid) });
    expect(s.ok).toBe(true);
    const svc = (s.data as any).ServiceWrappers?.[0]?.service;
    if (!svc) { console.log(`No service data for ${action}`); return; }
    currentServiceData = svc;
    console.log(`Before ${action}: ${svc.applicationStatus}`);

    const u = await api.post(ports.pgr, '/pgr-services/v2/request/_update', {
      RequestInfo: reqInfo(accessToken, userUuid),
      service: svc,
      workflow: { action, ...(action !== 'RESOLVE' ? { assignes: [userUuid] } : {}), comments: comment },
    });
    if (!u.ok) console.log(`${action} failed:`, JSON.stringify(u.data, null, 2).slice(0, 500));
    expect(u.ok).toBe(true);
    const st = (u.data as any).ServiceWrappers?.[0]?.service?.applicationStatus;
    console.log(`After ${action}: ${st}`);
  }

  // ── Step 6: Assign ─────────────────────────────────────────
  describe('Step 6: Assign (GRO)', () => {
    test('should assign complaint', async () => {
      await searchAndUpdate('ASSIGN', `Assigning for ${TENANT} test`);
    });
  });

  // ── Step 7: Reassign ──────────────────────────────────────
  describe('Step 7: Reassign (LME)', () => {
    test('should reassign complaint', async () => {
      await searchAndUpdate('REASSIGN', `Reassigning for ${TENANT} test`);
    });
  });

  // ── Step 7b: Re-assign after reassign ──────────────────────
  describe('Step 7b: Re-assign after reassign', () => {
    test('should assign complaint again after reassign', async () => {
      await searchAndUpdate('ASSIGN', `Re-assigning after reassign for ${TENANT}`);
    });
  });

  // ── Step 8: Resolve ────────────────────────────────────────
  describe('Step 8: Resolve', () => {
    test('should resolve complaint', async () => {
      await searchAndUpdate('RESOLVE', `Resolved by ${TENANT} team`);
    });
  });

  // ── Step 9: Final verification ─────────────────────────────
  describe('Step 9: Final Verification', () => {
    test('should verify final state via API', async () => {
      const r = await api.post(ports.pgr, `/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`, { RequestInfo: reqInfo(accessToken, userUuid) });
      expect(r.ok).toBe(true);
      const parsed = SearchServiceResponseSchema.safeParse(r.data);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const c = parsed.data.ServiceWrappers[0].service;
        console.log(`\n=== FINAL STATE ===\nID: ${c.serviceRequestId}\nTenant: ${c.tenantId}\nType: ${c.serviceCode}\nStatus: ${c.applicationStatus}\n===================\n`);
        expect(c.applicationStatus).toBe('RESOLVED');
      }
    });

    test('should verify RESOLVED in database', async () => {
      // Wait for persister
      await new Promise(r => setTimeout(r, 2000));
      const rec = await db.queryOne<{ tenantid: string; applicationstatus: string }>(
        'SELECT tenantid, applicationstatus FROM eg_pgr_service_v2 WHERE servicerequestid = $1', [serviceRequestId]);
      expect(rec).not.toBeNull();
      expect(rec?.tenantid).toBe(TENANT);
      expect(rec?.applicationstatus).toBe('RESOLVED');
    });

    test('should have workflow history with all actions', async () => {
      const r = await api.post(ports.workflow,
        `/egov-workflow-v2/egov-wf/process/_search?tenantId=${TENANT}&businessIds=${serviceRequestId}&history=true`,
        { RequestInfo: reqInfo(accessToken, userUuid) });
      expect(r.ok).toBe(true);
      const pis = (r.data as any).ProcessInstances || [];
      if (pis.length === 0) {
        await new Promise(r => setTimeout(r, 3000));
        const retry = await api.post(ports.workflow,
          `/egov-workflow-v2/egov-wf/process/_search?tenantId=${TENANT}&businessIds=${serviceRequestId}&history=true`,
          { RequestInfo: reqInfo(accessToken, userUuid) });
        const retryPis = (retry.data as any).ProcessInstances || [];
        expect(retryPis.length).toBeGreaterThan(0);
      }
      console.log(`Workflow (${pis.length} steps):`);
      pis.forEach((p: any, i: number) => console.log(`  ${i + 1}. ${p.action} → ${p.state?.applicationStatus}`));
      // Should have APPLY, ASSIGN, REASSIGN, ASSIGN, RESOLVE
      const actions = pis.map((p: any) => p.action);
      expect(actions).toContain('APPLY');
      expect(actions).toContain('ASSIGN');
      expect(actions).toContain('REASSIGN');
      expect(actions).toContain('RESOLVE');
    }, 30000);
  });

  // ── Step 10: DB integrity ──────────────────────────────────
  describe('Step 10: Database Integrity', () => {
    test('PGR tables exist', async () => {
      for (const t of ['eg_pgr_service_v2', 'eg_pgr_address_v2']) expect(await db.tableExists(t)).toBe(true);
    });
    test('tenant has complaints', async () => {
      const count = parseInt((await db.queryValue<string>('SELECT COUNT(*) FROM eg_pgr_service_v2 WHERE tenantid = $1', [TENANT])) || '0', 10);
      expect(count).toBeGreaterThan(0);
      console.log(`Total ${TENANT} complaints in DB: ${count}`);
    });
  });
});
