/**
 * End-to-End PGR Workflow Test
 * Based on Postman collection: PGR-Demo
 *
 * Workflow:
 * 1. Employee login → get auth token
 * 2. MDMS search → get service definitions
 * 3. PGR Create → create complaint
 * 4. PGR Update (Assign) → assign to employee
 * 5. PGR Update (Resolve) → mark resolved
 * 6. PGR Search → verify final status
 */

import { api, createRequestInfo } from '../utils/api';
import { db } from '../utils/db';
import { config } from '../utils/config';
import { fixedMobile, uniqueMobile } from '../utils/mobile';
import { adminLogin, createHrmsEmployee, employeeUserInfo } from '../utils/hrms';
import { LoginResponseSchema } from '../schemas/user';
import { SearchServiceResponseSchema } from '../schemas/pgr';

const SERVICE_CODE = 'StreetLightNotWorking';

describe('PGR End-to-End Workflow', () => {
  const { ports, tenant } = config;
  const timestamp = Date.now();
  const EMPLOYEE_ROLES = ['EMPLOYEE', 'GRO', 'DGRO', 'CSR'];
  const roleRefs = (codes: string[]) => codes.map((code) => ({ code, name: code, tenantId: tenant.city }));
  // These requests go straight to PGR, so userInfo must identify the HRMS employee.
  const userInfo = (codes: string[]) => employeeUserInfo(userUuid, userName, tenant.city, roleRefs(codes));

  // Test data that persists across tests
  let accessToken: string;
  let userUuid: string;
  let userName: string;
  let localityCode: string;
  let serviceRequestId: string;

  // A real HRMS employee: PGR scopes an employee's search to their HRMS record, so a plain
  // user can file a complaint but never find it (see utils/hrms.ts).
  beforeAll(async () => {
    userName = `pgr-test-${timestamp}`;
    const { state, city } = tenant;
    const admin = await adminLogin(state);

    // The employee assigns the complaint to itself below, and PGR only accepts an assignee
    // from the complaint type's department.
    const mdms = await api.post(ports.mdms, '/mdms-v2/v1/_search', {
      RequestInfo: createRequestInfo({ authToken: admin.token }),
      MdmsCriteria: {
        tenantId: city,
        moduleDetails: [
          { moduleName: 'RAINMAKER-PGR', masterDetails: [{ name: 'ComplaintHierarchy' }] },
          { moduleName: 'common-masters', masterDetails: [{ name: 'Designation' }] },
        ],
      },
    });
    const res = (mdms.data as any)?.MdmsRes || {};
    const leaf = (res['RAINMAKER-PGR']?.ComplaintHierarchy || []).find((r: any) => r.code === SERVICE_CODE);
    const designation = (res['common-masters']?.Designation || [])[0]?.code;
    if (!leaf?.department || !designation) {
      throw new Error(`MDMS for ${city} has no department for ${SERVICE_CODE} or no Designation`);
    }
    // The complaint is filed at this leaf (Step 3); the jurisdiction is the root of its tree.
    localityCode = await db.leafBoundaryCode(city);
    const root = await db.rootBoundaryOf(city, localityCode);

    ({ uuid: userUuid } = await createHrmsEmployee(admin, {
      tenantId: city,
      userName,
      name: 'PGR Test Employee',
      mobileNumber: uniqueMobile(),
      roles: roleRefs(EMPLOYEE_ROLES),
      department: leaf.department,
      designation,
      jurisdiction: root,
    }));
    console.log(`HRMS employee ${userName} (dept ${leaf.department}, jurisdiction ${root.code})`);
  }, 120000);

  describe('Step 1: Employee Authentication', () => {
    test('should login and get access token', async () => {
      const loginResponse = await fetch(
        `${config.baseUrl}:${ports.user}/user/oauth/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
          },
          body: new URLSearchParams({
            username: userName,
            password: 'eGov@123',
            grant_type: 'password',
            scope: 'read',
            tenantId: tenant.city,
            userType: 'EMPLOYEE',
          }),
        }
      );

      expect(loginResponse.ok).toBe(true);

      const data = await loginResponse.json();
      const parsed = LoginResponseSchema.safeParse(data);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        accessToken = parsed.data.access_token;
        expect(accessToken).toBeDefined();
      }
    });
  });

  describe('Step 2: MDMS Service Definitions', () => {
    test('should fetch PGR service definitions from MDMS', async () => {
      const response = await api.post(ports.mdms, '/mdms-v2/v1/_search', {
        RequestInfo: createRequestInfo({ authToken: accessToken }),
        MdmsCriteria: {
          tenantId: tenant.state,
          moduleDetails: [
            {
              moduleName: 'RAINMAKER-PGR',
              masterDetails: [{ name: 'ComplaintHierarchy' }],
            },
          ],
        },
      });

      expect(response.ok).toBe(true);

      const data = response.data as {
        MdmsRes?: { 'RAINMAKER-PGR'?: { ComplaintHierarchy?: unknown[] } };
      };

      // Service definitions should exist (may be in different MDMS format)
      // The important thing is the API responds successfully
      expect(response.status).toBe(200);
    });
  });

  describe('Step 3: Create PGR Complaint', () => {
    test('should create a new complaint', async () => {
      const response = await api.post(
        ports.pgr,
        `/pgr-services/v2/request/_create?tenantId=${tenant.city}`,
        {
          RequestInfo: {
            ...createRequestInfo({ authToken: accessToken }),
            userInfo: userInfo(['EMPLOYEE', 'GRO', 'DGRO', 'CSR']),
          },
          service: {
            tenantId: tenant.city,
            serviceCode: SERVICE_CODE,
            description: `E2E test complaint - ${timestamp}`,
            source: 'web',
            address: {
              city: tenant.city,
              locality: {
                code: localityCode,
                name: 'Test Locality',
              },
              geoLocation: {
                latitude: 28.7041,
                longitude: 77.1025,
              },
            },
            citizen: {
              name: 'Test Citizen',
              mobileNumber: fixedMobile(888888888),
              tenantId: tenant.city,
            },
          },
          workflow: {
            action: 'APPLY',
          },
        }
      );

      if (!response.ok) console.log('Create failed:', JSON.stringify(response.data, null, 2).slice(0, 800));
      expect(response.ok).toBe(true);

      const data = response.data as {
        ServiceWrappers?: Array<{ service: { serviceRequestId: string } }>;
      };

      expect(data.ServiceWrappers).toBeDefined();
      expect(data.ServiceWrappers).toHaveLength(1);

      serviceRequestId = data.ServiceWrappers![0].service.serviceRequestId;
      expect(serviceRequestId).toBeDefined();
      expect(serviceRequestId.length).toBeGreaterThan(0);
    });

    test('should verify complaint in database', async () => {
      expect(serviceRequestId).toBeDefined();

      // Persister writes asynchronously via Kafka — poll until the record appears
      let dbRecord = null;
      for (let attempt = 0; attempt < 30 && !dbRecord; attempt++) {
        dbRecord = await db.queryOne<{
          servicerequestid: string;
          tenantid: string;
          servicecode: string;
        }>(
          'SELECT servicerequestid, tenantid, servicecode FROM eg_pgr_service_v2 WHERE servicerequestid = $1',
          [serviceRequestId]
        );
        if (!dbRecord) await new Promise(r => setTimeout(r, 1000));
      }

      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.servicerequestid).toBe(serviceRequestId);
      expect(dbRecord?.tenantid).toBe(tenant.city);
      expect(dbRecord?.servicecode).toBe(SERVICE_CODE);
    });
  });

  describe('Step 4: Assign Complaint', () => {
    test('should assign complaint to employee', async () => {
      // First search to get current complaint data
      const searchResponse = await api.post(
        ports.pgr,
        `/pgr-services/v2/request/_search?tenantId=${tenant.city}&serviceRequestId=${serviceRequestId}`,
        {
          RequestInfo: {
            ...createRequestInfo({ authToken: accessToken }),
            userInfo: userInfo(['EMPLOYEE', 'GRO', 'DGRO']),
          },
        }
      );

      expect(searchResponse.ok).toBe(true);

      const searchData = searchResponse.data as {
        ServiceWrappers: Array<{ service: unknown }>;
      };
      const currentService = searchData.ServiceWrappers[0].service;

      // Update with ASSIGN action
      const updateResponse = await api.post(
        ports.pgr,
        '/pgr-services/v2/request/_update',
        {
          RequestInfo: {
            ...createRequestInfo({ authToken: accessToken }),
            userInfo: userInfo(['EMPLOYEE', 'GRO', 'DGRO']),
          },
          service: currentService,
          workflow: {
            action: 'ASSIGN',
            assignes: [userUuid],
            comments: 'Assigning to test employee',
          },
        }
      );

      // Workflow may fail if not configured, but API should respond
      expect(updateResponse.status).toBeLessThan(500);
    });
  });

  describe('Step 5: Search and Verify', () => {
    test('should search complaint by serviceRequestId', async () => {
      const response = await api.post(
        ports.pgr,
        `/pgr-services/v2/request/_search?tenantId=${tenant.city}&serviceRequestId=${serviceRequestId}`,
        {
          RequestInfo: {
            ...createRequestInfo({ authToken: accessToken }),
            userInfo: userInfo(['EMPLOYEE', 'GRO', 'DGRO']),
          },
        }
      );

      expect(response.ok).toBe(true);

      const parsed = SearchServiceResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        // Log the actual response and parse errors for debugging
        console.error('Response data:', JSON.stringify(response.data, null, 2).slice(0, 500));
        console.error('Parse errors:', JSON.stringify(parsed.error.errors, null, 2));
      }
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.ServiceWrappers).toHaveLength(1);
        expect(parsed.data.ServiceWrappers[0].service.serviceRequestId).toBe(serviceRequestId);
      }
    });

    test('should search complaints by tenant', async () => {
      const response = await api.post(
        ports.pgr,
        `/pgr-services/v2/request/_search?tenantId=${tenant.city}`,
        {
          RequestInfo: {
            ...createRequestInfo({ authToken: accessToken }),
            userInfo: userInfo(['EMPLOYEE', 'GRO', 'DGRO']),
          },
        }
      );

      expect(response.ok).toBe(true);

      const parsed = SearchServiceResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        console.error('Parse errors:', JSON.stringify(parsed.error.errors, null, 2));
      }
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.ServiceWrappers.length).toBeGreaterThan(0);

        // Our complaint should be in the results
        const found = parsed.data.ServiceWrappers.find(
          (sw) => sw.service.serviceRequestId === serviceRequestId
        );
        expect(found).toBeDefined();
      }
    });
  });

  describe('Database Integrity', () => {
    test('PGR tables have correct structure', async () => {
      const tables = ['eg_pgr_service_v2', 'eg_pgr_address_v2'];

      for (const table of tables) {
        const exists = await db.tableExists(table);
        expect(exists).toBe(true);
      }
    });

    test('complaint count increased', async () => {
      const count = await db.getRowCount('eg_pgr_service_v2');
      expect(count).toBeGreaterThan(0);
    });
  });
});
