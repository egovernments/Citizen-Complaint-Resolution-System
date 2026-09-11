// Direct REST helpers — let tests assert on the wire payload that's
// actually traveling through the system, not just the rendered DOM.

// Deployment target + tenants come from env.ts, which resolves them
// env var -> discovered deployment profile -> legacy default.
//
// This file used to re-derive both from process.env with its own
// `?? 'ke.nairobi'` fallback, on the claim that it read "the same env vars
// env.ts reads". That was true only while every deployment pinned DIGIT_TENANT:
// once the pins came out and the profile became the source of truth, this copy
// kept answering `ke` and every helper here authenticated against a tenant that
// doesn't exist on a Mozambique stack — surfacing as a bare
// "login failed: 400 Invalid login credentials" nowhere near the real cause.
// Import the resolved values; never re-derive deployment shape locally.
import { BASE_URL, ROOT_TENANT } from '../env';

// NAIPEPEA_BASE remains an explicit override for the (now-legacy) naipepea host.
const BASE = process.env.NAIPEPEA_BASE ?? BASE_URL;
const KONG_BASIC = 'Basic ZWdvdi11c2VyLWNsaWVudDo='; // egov-user-client: (no secret) — Kong convention

export type EmployeeAuth = {
  token: string;
  uuid: string;
  type: 'EMPLOYEE';
};

export async function loginEmployee(username = 'ADMIN', password = 'eGov@123', tenantId = ROOT_TENANT): Promise<EmployeeAuth> {
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
      tenantId: ROOT_TENANT,
      roles: [{ code: 'SUPERUSER', tenantId: ROOT_TENANT }],
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
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: contentType });
  fd.append('file', blob, fileName);
  const r = await fetch(`${BASE}/filestore/v1/files`, {
    method: 'POST',
    headers: { 'auth-token': auth.token },
    body: fd,
  });
  return { status: r.status, body: await r.json() };
}

// ── PGR _create helper — CRS-compatible across tenants ───────────────────────
//
// The legacy RAINMAKER-PGR schema (Ethiopia) and the new CRS schema (ke/Bomet)
// both accept the same minimal payload EXCEPT for `verificationDocuments`:
//   • Legacy (Ethiopia): accepts `verificationDocuments: []` in workflow (but
//     omitting it also works fine).
//   • CRS (ke/Bomet): `verificationDocuments: []` triggers JsonMappingException
//     because the CRS Workflow model declares the field as a different type.
//
// Fix: omit `verificationDocuments` entirely — both deployments accept the
// `workflow: { action: 'APPLY' }` shape without it.
//
// SERVICE_CODE: the caller supplies the code.  Use `resolveServiceCode` to
// pick the first active code from MDMS when the configured SERVICE_CODE is
// unknown on the target tenant.

export interface CitizenAuthSimple {
  token: string;
  userInfo: Record<string, unknown>;
}

export interface PgrCreateParams {
  baseUrl: string;
  auth: CitizenAuthSimple;
  tenantId: string;
  serviceCode: string;
  localityCode: string;
  description: string;
  citizenName: string;
  citizenPhone: string;
  /** Optional: override the workflow action (default: 'APPLY'). */
  workflowAction?: string;
  /** Optional: send extended_attributes in service body. Per user direction:
   *  content must stay empty {}. Defaults to undefined (omitted). */
  extendedAttributes?: Record<string, unknown>;
  /** Optional geo-location override for map/detail contract tests. The legacy
   * default remains (0,0) so existing fixture semantics do not change. Pass
   * an empty object to exercise a genuinely missing persisted location. */
  geoLocation?: { latitude?: number; longitude?: number };
}

export interface PgrCreateResult {
  serviceRequestId: string;
  applicationStatus: string;
  rawWrapper: Record<string, unknown>;
}

/**
 * POST /pgr-services/v2/request/_create in a way that works on both:
 *   - Legacy RAINMAKER-PGR deployments (Ethiopia).
 *   - CRS-schema deployments (ke / Bomet).
 *
 * Key difference from the old inline calls: `verificationDocuments` is
 * intentionally omitted from the workflow object. Sending `[]` causes a
 * JsonMappingException on CRS deployments.
 */
export async function pgrCreate(params: PgrCreateParams): Promise<PgrCreateResult> {
  const {
    baseUrl,
    auth,
    tenantId,
    serviceCode,
    localityCode,
    description,
    citizenName,
    citizenPhone,
    workflowAction = 'APPLY',
    extendedAttributes,
    geoLocation,
  } = params;

  const serviceBody: Record<string, unknown> = {
    tenantId,
    serviceCode,
    description,
    source: 'web',
    address: {
      city: tenantId,
      locality: { code: localityCode },
      geoLocation: geoLocation ?? { latitude: 0, longitude: 0 },
    },
    citizen: { name: citizenName, mobileNumber: citizenPhone },
  };

  // Per user direction: extended_attributes content stays empty {}.
  // Only include the key if the caller explicitly passes it.
  if (extendedAttributes !== undefined) {
    serviceBody.extended_attributes = extendedAttributes;
  }

  const body: Record<string, unknown> = {
    RequestInfo: {
      apiId: 'Rainmaker',
      authToken: auth.token,
      userInfo: auth.userInfo,
    },
    service: serviceBody,
    // CRS-compatible workflow: omit verificationDocuments entirely.
    // Legacy deployments also accept this shape.
    workflow: { action: workflowAction },
  };

  const r = await fetch(`${baseUrl}/pgr-services/v2/request/_create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await r.json()) as {
    ServiceWrappers?: Array<{ service: { serviceRequestId: string; applicationStatus: string } }>;
    Errors?: Array<{ code: string; message: string }>;
  };

  if (!r.ok || !data.ServiceWrappers?.length) {
    const errMsg = data.Errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? `HTTP ${r.status}`;
    throw new Error(`pgrCreate failed: ${errMsg}`);
  }

  const svc = data.ServiceWrappers[0].service;
  return {
    serviceRequestId: svc.serviceRequestId,
    applicationStatus: svc.applicationStatus,
    rawWrapper: data.ServiceWrappers[0] as Record<string, unknown>,
  };
}

/**
 * Resolve a locality (boundary) code against the deployment's
 * boundary-service. Returns `preferred` if it exists in the boundary list for
 * `tenantId`; otherwise returns the first ward-level boundary code found.
 *
 * Ward-level codes are identified by having three or more underscore-separated
 * segments (e.g. `BOMET_BOMET_CENTRAL_CHESOEN`) and not starting with `ZZ_`
 * (test-only boundaries). Falls back to `preferred` on any network error so
 * the _create call surfaces the original error.
 *
 * Useful when `LOCALITY_CODE` env var holds a Nairobi code
 * (`NAIROBI_CITY_VIWANDANI`) but the deployment is Bomet ke.
 */
export async function resolveLocalityCode(
  baseUrl: string,
  authToken: string,
  tenantId: string,
  preferred: string,
): Promise<string> {
  try {
    const r = await fetch(
      `${baseUrl}/boundary-service/boundary/_search?tenantId=${encodeURIComponent(tenantId)}&hierarchyType=REVENUE&offset=0&limit=100`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { authToken } }),
      },
    );
    const data = (await r.json()) as { Boundary?: Array<{ code: string }> };
    const codes = (data.Boundary || []).map((b) => b.code);

    // Return preferred if the deployment knows about it
    if (codes.includes(preferred)) return preferred;

    // Pick the first ward-level code: 3+ underscore-delimited segments,
    // not a synthetic test boundary (ZZ_ prefix), not WARD_ORD.
    const wardCode = codes.find(
      (c) => c.split('_').length >= 4 && !c.startsWith('ZZ_') && c !== 'WARD_ORD',
    );
    if (wardCode) return wardCode;
  } catch {
    // Network or parse failure — return preferred and let _create surface the error
  }
  return preferred;
}

interface MdmsCodeRow {
  uniqueIdentifier?: string;
  isActive?: boolean;
  data?: {
    active?: boolean;
    serviceCode?: string;
    code?: string;
    department?: string;
    departments?: string[];
  };
}

/**
 * Active, FILEABLE complaint codes held by one MDMS master on `tenantId`.
 *
 * "Fileable" is why ComplaintHierarchy needs the department clause: a node with
 * no department is a cascade CATEGORY (pg's `Garbage`, `StreetLights`), a level
 * in the picker rather than something a complaint can be filed against. Same
 * rule profile.ts's discoverComplaintTypes applies.
 *
 * The code is read from data.serviceCode / data.code BEFORE uniqueIdentifier
 * because the two are not the same field on every deployment — see
 * resolveServiceCode.
 */
async function activeComplaintCodes(
  baseUrl: string,
  authToken: string,
  tenantId: string,
  schemaCode: string,
): Promise<string[]> {
  // PAGE the catalogue rather than taking a single slice of it. ANY fixed limit
  // that happens to sit below the row count silently changes WHICH code the
  // fallback returns — and can hide `preferred` itself on a later page, which is
  // the exact failure this helper exists to prevent. 50 truncated every real
  // tenant; 200 still truncated bomet's `ke` at 251 ServiceDefs.
  const PAGE = 200;
  // Backstop for a deployment whose mdms-v2 ignores `offset` and re-serves page
  // 0 forever: stop as soon as a page contributes nothing we have not already
  // seen. MAX_PAGES is a second belt in case such a server also churns the row
  // order, so `fresh` never quite empties.
  const MAX_PAGES = 25;
  const rows: MdmsCodeRow[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const r = await fetch(`${baseUrl}/mdms-v2/v2/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { authToken },
        MdmsCriteria: { tenantId, schemaCode, limit: PAGE, offset: page * PAGE },
      }),
    });
    const batch = ((await r.json()) as { mdms?: MdmsCodeRow[] }).mdms || [];
    const fresh = batch.filter((row, i) => {
      const key =
        row.uniqueIdentifier ||
        `${page}:${i}:${row.data?.serviceCode || row.data?.code || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    rows.push(...fresh);
    if (batch.length < PAGE || fresh.length === 0) break;
  }
  const isHierarchy = schemaCode.endsWith('ComplaintHierarchy');
  const codes = rows
    .filter((row) => row.isActive !== false && row.data?.active !== false)
    .filter((row) => !isHierarchy || !!(row.data?.department ?? row.data?.departments?.[0]))
    .map((row) => row.data?.serviceCode || row.data?.code || row.uniqueIdentifier || '')
    .filter(Boolean);
  return [...new Set(codes)];
}

/**
 * Resolve a serviceCode the deployment will actually ACCEPT on a PGR _create.
 * Returns `preferred` when it is active on `tenantId`; otherwise the first
 * fileable code found.
 *
 * Two things this has to get right, both of which it used to get wrong and
 * which together produced
 * "INVALID_SERVICECODE: The service code: IllegalShopsOnFootPath is not
 * present in MDMS" on the local `pg` stack — for a run whose configured
 * SERVICE_CODE (BurningOfGarbage) was present and perfectly valid:
 *
 *  1. WHICH MASTER. pgr-services validates the code against
 *     RAINMAKER-PGR.ComplaintHierarchy, not ServiceDefs — see
 *     PGRConstants.MDMS_SERVICEDEF_SEARCH,
 *     `$.MdmsRes.RAINMAKER-PGR.ComplaintHierarchy[?(@.code=='<CODE>')]`, read
 *     by ServiceRequestValidator.validateMDMS. `pg` carries 33 ServiceDefs
 *     against 8 ComplaintHierarchy codes, so 25 of the codes this helper could
 *     hand back were unfileable by construction. ServiceDefs stays as the
 *     FALLBACK master, for deployments that keep the catalogue there instead
 *     (profile.ts's discoverComplaintTypes unions both for the same reason).
 *
 *  2. WHERE THE CODE LIVES IN A ROW. mdms-v2's `uniqueIdentifier` is not the
 *     serviceCode everywhere: pg keys ServiceDefs rows by a sha256 hash and
 *     ComplaintHierarchy rows by `PGR.<code>`, so matching `preferred` against
 *     uniqueIdentifier alone never hit and the helper fell through to its
 *     "first active" branch on every single call.
 */
export async function resolveServiceCode(
  baseUrl: string,
  authToken: string,
  tenantId: string,
  preferred: string,
): Promise<string> {
  for (const schemaCode of ['RAINMAKER-PGR.ComplaintHierarchy', 'RAINMAKER-PGR.ServiceDefs']) {
    let codes: string[] = [];
    try {
      codes = await activeComplaintCodes(baseUrl, authToken, tenantId, schemaCode);
    } catch {
      // Network or parse failure — try the next master, then give up and let
      // _create surface the real error against `preferred`.
      continue;
    }
    if (!codes.length) continue;
    if (codes.includes(preferred)) return preferred;
    // Deterministic: an arbitrary "first row MDMS happened to return" turns a
    // seed regression into flake. Suite leftovers (the PW_/Pw… complaint types
    // other specs create and soft-delete) sort last so a real seeded code wins.
    return codes
      .slice()
      .sort((a, b) => Number(/^pw/i.test(a)) - Number(/^pw/i.test(b)) || a.localeCompare(b))[0];
  }
  return preferred;
}
