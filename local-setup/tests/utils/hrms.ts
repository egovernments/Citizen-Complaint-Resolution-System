/**
 * HRMS employees for the PGR smoke suites.
 *
 * PGR scopes an employee's complaint search to their HRMS record (department and
 * jurisdiction), so a test that files and then searches complaints needs a real HRMS
 * employee, not a bare user. Shared so the next HRMS contract change lands in one place.
 */
import { api, createRequestInfo } from './api';
import { config } from './config';

export interface RoleRef {
  code: string;
  name: string;
  tenantId: string;
}

export interface Admin {
  token: string;
  uuid: string;
  tenantId: string;
}

export interface EmployeeSpec {
  tenantId: string;
  userName: string;
  name: string;
  mobileNumber: string;
  roles: RoleRef[];
  department: string;
  designation: string;
  /** A boundary in the tenant's ADMIN tree; PGR scopes search to its subtree. */
  jurisdiction: { code: string; boundaryType: string };
  password?: string;
}

const AUTH = 'Basic ZWdvdi11c2VyLWNsaWVudDo=';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function adminLogin(tenantId: string): Promise<Admin> {
  const r = await fetch(`${config.baseUrl}:${config.ports.user}/user/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: AUTH },
    body: new URLSearchParams({ username: 'ADMIN', password: 'eGov@123', grant_type: 'password', scope: 'read', tenantId, userType: 'EMPLOYEE' }),
  });
  if (!r.ok) throw new Error(`ADMIN login on ${tenantId} failed: HTTP ${r.status}`);
  const data = (await r.json()) as { access_token: string; UserRequest: { uuid: string } };
  return { token: data.access_token, uuid: data.UserRequest.uuid, tenantId };
}

function asSuperuser(admin: Admin) {
  return {
    ...createRequestInfo({ authToken: admin.token }),
    userInfo: {
      uuid: admin.uuid, type: 'EMPLOYEE', tenantId: admin.tenantId,
      roles: [{ code: 'SUPERUSER', name: 'Super User', tenantId: admin.tenantId }],
    },
  };
}

/**
 * userInfo for a request sent straight to PGR (not through Kong). PGR looks the caller's
 * HRMS record up by userName; without it every search is scoped to nothing and returns [].
 */
export function employeeUserInfo(uuid: string, userName: string, tenantId: string, roles: RoleRef[]) {
  return { uuid, userName, type: 'EMPLOYEE', tenantId, roles };
}

/**
 * Create an HRMS employee and set its password. Throws with HRMS's response on any failure,
 * so a broken setup fails here rather than as an empty search several steps later.
 */
export async function createHrmsEmployee(admin: Admin, spec: EmployeeSpec): Promise<{ uuid: string }> {
  const { hrms } = config.ports;
  const created = await api.post(hrms, '/egov-hrms/employees/_create', {
    RequestInfo: asSuperuser(admin),
    Employees: [{
      tenantId: spec.tenantId,
      code: spec.userName,
      employeeStatus: 'EMPLOYED',
      employeeType: 'PERMANENT',
      dateOfAppointment: 1704067200000,
      assignments: [{ fromDate: 1704067200000, isCurrentAssignment: true, department: spec.department, designation: spec.designation }],
      jurisdictions: [{
        hierarchy: 'ADMIN', boundaryType: spec.jurisdiction.boundaryType, boundary: spec.jurisdiction.code,
        tenantId: spec.tenantId, roles: spec.roles,
      }],
      user: {
        name: spec.name, userName: spec.userName, mobileNumber: spec.mobileNumber, gender: 'MALE',
        active: true, type: 'EMPLOYEE', tenantId: spec.tenantId, roles: spec.roles,
        password: 'TempHRMS@999', otpReference: '12345',
      },
      serviceHistory: [], education: [], tests: [],
    }],
  }, { timeout: 30000 });
  if (!created.ok) throw new Error(`HRMS _create for ${spec.userName} failed: ${JSON.stringify(created.data).slice(0, 800)}`);
  const uuid: string = (created.data as any).Employees[0].user.uuid;

  // HRMS writes the employee through Kafka and the persister, so poll the search.
  let emp: any;
  for (let i = 0; i < 30 && !emp?.id; i++) {
    if (i > 0) await sleep(2000);
    const found = await api.post(hrms, `/egov-hrms/employees/_search?tenantId=${spec.tenantId}&codes=${spec.userName}`, {
      RequestInfo: asSuperuser(admin),
    }, { timeout: 30000 });
    emp = (found.data as any)?.Employees?.[0];
  }
  if (!emp?.id) throw new Error(`HRMS _search did not return ${spec.userName} within 60s`);

  // HRMS ignores the password on _create; set the real one through _update.
  emp.user.password = spec.password ?? 'eGov@123';
  const updated = await api.post(hrms, '/egov-hrms/employees/_update', {
    RequestInfo: asSuperuser(admin),
    Employees: [emp],
  }, { timeout: 30000 });
  if (!updated.ok) throw new Error(`HRMS _update for ${spec.userName} failed: ${JSON.stringify(updated.data).slice(0, 800)}`);
  return { uuid };
}
