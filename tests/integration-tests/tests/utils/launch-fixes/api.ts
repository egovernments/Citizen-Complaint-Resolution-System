// Direct REST helpers — let tests assert on the wire payload that's
// actually traveling through the system, not just the rendered DOM.
// All calls go through the public Kong gateway at naipepea.digit.org so
// they exercise the same path the browser uses.

const BASE = process.env.NAIPEPEA_BASE ?? 'https://naipepea.digit.org';
const KONG_BASIC = 'Basic ZWdvdi11c2VyLWNsaWVudDo='; // egov-user-client: (no secret) — naipepea convention

export type EmployeeAuth = {
  token: string;
  uuid: string;
  type: 'EMPLOYEE';
};

export async function loginEmployee(username = 'ADMIN', password = 'eGov@123', tenantId = 'ke'): Promise<EmployeeAuth> {
  const body = new URLSearchParams({
    username,
    password,
    grant_type: 'password',
    scope: 'read',
    tenantId,
    userType: 'EMPLOYEE',
  });
  const r = await fetch(`${BASE}/user/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: KONG_BASIC },
    body,
  });
  if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return { token: j.access_token as string, uuid: j.UserRequest?.uuid ?? 'x', type: 'EMPLOYEE' };
}

export function requestInfo(auth: EmployeeAuth) {
  return {
    authToken: auth.token,
    apiId: 'Rainmaker',
    userInfo: {
      id: 1,
      uuid: auth.uuid,
      type: auth.type,
      tenantId: 'ke',
      roles: [{ code: 'SUPERUSER', tenantId: 'ke' }],
    },
  };
}

export async function pgrSearch(auth: EmployeeAuth, tenantId: string, serviceRequestId: string) {
  const r = await fetch(`${BASE}/pgr-services/v2/request/_search?tenantId=${encodeURIComponent(tenantId)}&serviceRequestId=${encodeURIComponent(serviceRequestId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: requestInfo(auth) }),
  });
  return r.json();
}

export async function mdmsSearch(auth: EmployeeAuth, tenantId: string, schemaCode: string, uniqueIdentifiers?: string[]) {
  const r = await fetch(`${BASE}/mdms-v2/v2/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: requestInfo(auth),
      MdmsCriteria: { tenantId, schemaCode, ...(uniqueIdentifiers ? { uniqueIdentifiers } : {}), limit: 50 },
    }),
  });
  return r.json();
}

export async function mdmsCreate(auth: EmployeeAuth, schemaCode: string, mdms: Record<string, unknown>) {
  const r = await fetch(`${BASE}/mdms-v2/v2/_create/${schemaCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: requestInfo(auth), Mdms: mdms }),
  });
  return r.json();
}

export async function mdmsUpdate(auth: EmployeeAuth, schemaCode: string, mdms: Record<string, unknown>) {
  const r = await fetch(`${BASE}/mdms-v2/v2/_update/${schemaCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: requestInfo(auth), Mdms: mdms }),
  });
  return r.json();
}

export async function hrmsSearch(auth: EmployeeAuth, tenantId: string, roles?: string[]) {
  const url = new URL(`${BASE}/egov-hrms/employees/_search`);
  url.searchParams.set('tenantId', tenantId);
  if (roles?.length) url.searchParams.set('roles', roles.join(','));
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: requestInfo(auth) }),
  });
  return r.json();
}

export async function workflowBusinessService(auth: EmployeeAuth, tenantId: string, code = 'PGR') {
  const r = await fetch(`${BASE}/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=${encodeURIComponent(tenantId)}&businessServices=${code}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: requestInfo(auth) }),
  });
  return r.json();
}

export async function uploadFile(auth: EmployeeAuth, tenantId: string, fileName: string, fileBuffer: Buffer, contentType: string, module = 'PGR') {
  const fd = new FormData();
  fd.append('tenantId', tenantId);
  fd.append('module', module);
  const blob = new Blob([fileBuffer], { type: contentType });
  fd.append('file', blob, fileName);
  const r = await fetch(`${BASE}/filestore/v1/files`, {
    method: 'POST',
    headers: { 'auth-token': auth.token },
    body: fd,
  });
  return { status: r.status, body: await r.json() };
}
