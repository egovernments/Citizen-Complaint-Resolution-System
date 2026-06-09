/**
 * react-admin glue for the citizen UI — a slim dataProvider + authProvider
 * scoped to the single `complaints` resource.
 *
 * Why bother with ra-core when we could call PGR endpoints directly?
 *   - The list / show / create routes get for-free filtering / pagination /
 *     loading-state plumbing.
 *   - Same pattern as digit-configurator's ManagementAdmin, so anyone who
 *     knows that codebase reads this one without context-switching.
 *
 * What this is NOT:
 *   - A general-purpose MDMS dataProvider. Citizens only ever touch
 *     pgr-services from react-admin; MDMS reads (for the type dropdown) go
 *     through a plain react-query hook, not this dataProvider.
 */
import type {
  AuthProvider,
  DataProvider,
  GetListParams,
  GetOneParams,
  CreateParams,
  RaRecord,
} from 'ra-core';
import { apiClient, getApiBaseUrl, isKeycloakMode, hasKcToken } from '@/api';
import { getKcIdToken, clearKcTokens, logoutKc } from '@/api/keycloak';

const CITY_TENANT = (import.meta.env.VITE_CITIZEN_TENANT as string) || 'ke.nairobi';

// ── Types ────────────────────────────────────────────────────────────────

// PGR _search returns address.city + address.locality as either bare strings
// (older deploys) or as boundary-shaped objects { code, name, label, latitude,
// longitude, children, materializedPath } (naipepea). Type both shapes here
// so flatten() can coerce to a string without TypeScript complaining.
type Boundaryish = {
  code?: string | null;
  name?: string | null;
  label?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};
type CityOrLocality = string | Boundaryish | null | undefined;

interface ServiceWrapper {
  service: {
    id?: string;
    serviceRequestId: string;
    serviceCode: string;
    tenantId: string;
    description?: string;
    applicationStatus?: string;
    source?: string;
    address?: {
      city?: CityOrLocality;
      locality?: CityOrLocality;
      landmark?: string;
      geoLocation?: { latitude?: number; longitude?: number };
    };
    accountId?: string;
    auditDetails?: { createdTime?: number; lastModifiedTime?: number };
    additionalDetail?: { images?: string[] } | null;
  };
  workflow?: {
    processInstances?: Array<{
      state?: { state: string };
      action?: string;
      assignee?: { name?: string };
      auditDetails?: { createdTime?: number };
      comment?: string | null;
      documents?: Array<{ fileStoreId: string }> | null;
    }>;
  };
}

/** Coerce a city/locality value to a human-readable string. */
function asString(v: CityOrLocality): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v.name ?? v.label ?? v.code ?? '';
}

/** The flattened shape react-admin sees. id === serviceRequestId. */
export interface Complaint extends RaRecord {
  id: string;
  serviceRequestId: string;
  serviceCode: string;
  description: string;
  applicationStatus: string;
  createdTime: number;
  lastModifiedTime: number;
  city: string;
  locality: string;
  landmark: string;
  latitude: number | null;
  longitude: number | null;
  photos: string[];
  workflow: ServiceWrapper['workflow'];
  raw: ServiceWrapper;
}

function flatten(w: ServiceWrapper): Complaint {
  const s = w.service;
  const addr = s.address ?? {};
  const geo = addr.geoLocation ?? {};
  // city + locality come back as either strings or boundary objects depending
  // on the deploy; asString() handles both — see CityOrLocality type above.
  return {
    id: s.serviceRequestId,
    serviceRequestId: s.serviceRequestId,
    serviceCode: s.serviceCode,
    description: s.description ?? '',
    applicationStatus: s.applicationStatus ?? 'OPEN',
    createdTime: s.auditDetails?.createdTime ?? 0,
    lastModifiedTime: s.auditDetails?.lastModifiedTime ?? 0,
    city: asString(addr.city),
    locality: asString(addr.locality),
    landmark: addr.landmark ?? '',
    latitude: typeof geo.latitude === 'number' ? geo.latitude : null,
    longitude: typeof geo.longitude === 'number' ? geo.longitude : null,
    photos: s.additionalDetail?.images ?? [],
    workflow: w.workflow,
    raw: w,
  };
}

// ── PGR search wrapper ───────────────────────────────────────────────────

async function pgrSearch(params: Record<string, string | number>): Promise<ServiceWrapper[]> {
  const { token } = apiClient.getAuth();
  const qs = new URLSearchParams({
    tenantId: CITY_TENANT,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  const res = await fetch(`${getApiBaseUrl()}/pgr-services/v2/request/_search?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: { apiId: 'citizen-ui', authToken: token ?? '' } }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { Errors?: Array<{ message?: string }> }).Errors?.[0]?.message ?? `HTTP ${res.status}`);
  }
  const data = await res.json();
  return (data.ServiceWrappers as ServiceWrapper[]) ?? [];
}

// ── DataProvider ─────────────────────────────────────────────────────────

// react-admin v5's DataProvider types are generic-paranoid: every method's
// return type is generic over RecordType, so concretely-typed returns
// (Complaint[]) don't satisfy the constraint without `as unknown as ...`.
// Annotating the object as `DataProvider<Complaint>` won't help — the type
// is still generic-over-method-call. Cast at the export and keep method
// bodies concrete + readable.
const provider = {
  async getList(resource: string, params: GetListParams) {
    if (resource !== 'complaints') throw new Error(`Unsupported resource: ${resource}`);
    // Citizen mobile is implicit — pulled from the authenticated user.
    const auth = apiClient.getAuth();
    const mobile = auth.user?.mobileNumber;
    if (!mobile) throw new Error('No authenticated citizen — refusing to list complaints.');

    const wrappers = await pgrSearch({ mobileNumber: mobile });
    const all = wrappers.map(flatten);

    // Honour react-admin's pagination + sort locally — PGR search returns
    // unsorted in practice. Citizens rarely have more than a handful.
    const sorted = [...all].sort((a, b) => {
      const dir = params.sort?.order === 'ASC' ? 1 : -1;
      const field = (params.sort?.field as keyof Complaint) || 'createdTime';
      const av = (a[field] ?? 0) as number;
      const bv = (b[field] ?? 0) as number;
      return (av - bv) * dir;
    });
    const { page, perPage } = params.pagination ?? { page: 1, perPage: 50 };
    const start = (page - 1) * perPage;
    return { data: sorted.slice(start, start + perPage) as Complaint[], total: sorted.length };
  },

  async getOne(resource: string, params: GetOneParams) {
    if (resource !== 'complaints') throw new Error(`Unsupported resource: ${resource}`);
    const wrappers = await pgrSearch({ serviceRequestId: String(params.id) });
    if (wrappers.length === 0) throw new Error(`Complaint not found: ${params.id}`);
    return { data: flatten(wrappers[0]) as Complaint };
  },

  async create(resource: string, params: CreateParams) {
    if (resource !== 'complaints') throw new Error(`Unsupported resource: ${resource}`);
    const auth = apiClient.getAuth();
    const token = auth.token;
    const user = auth.user;
    if (!token || !user) throw new Error('Not authenticated.');

    const d = params.data as Record<string, unknown>;
    // Two PGR quirks worth pinning here:
    //   1. `source` must be lowercase ('web', not 'WEB'); the backend's
    //      enum validator throws INVALID_SOURCE on caps.
    //   2. `address.locality` is a structured object { code, name } — passing
    //      a bare string produces "Failed to deserialize certain JSON fields"
    //      at submit. We use the same string as both code + name; operators
    //      reading the dashboard see the human label, downstream services
    //      that key on `locality.code` see a stable token.
    const localityRaw = (d.locality as string | undefined)?.trim() ?? '';
    const localityCode = localityRaw ? localityRaw.replace(/\s+/g, '_').toUpperCase() : '';

    const payload = {
      RequestInfo: { apiId: 'citizen-ui', authToken: token, userInfo: user },
      service: {
        tenantId: CITY_TENANT,
        serviceCode: d.serviceCode,
        description: d.description,
        source: 'web',
        accountId: user.uuid,
        address: {
          city: d.city ?? 'Nairobi',
          locality: localityRaw
            ? { code: localityCode, name: localityRaw }
            : { code: 'UNKNOWN', name: 'Unknown' },
          landmark: d.landmark ?? '',
          tenantId: CITY_TENANT,
          geoLocation:
            d.latitude != null && d.longitude != null
              ? { latitude: d.latitude, longitude: d.longitude }
              : undefined,
        },
        additionalDetail: d.photos && (d.photos as string[]).length > 0 ? { images: d.photos } : {},
      },
      workflow: { action: 'APPLY' },
    };

    const res = await fetch(`${getApiBaseUrl()}/pgr-services/v2/request/_create?tenantId=${CITY_TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { Errors?: Array<{ message?: string }> }).Errors?.[0]?.message ?? `HTTP ${res.status}`);
    }
    const json = await res.json();
    const created = (json.ServiceWrappers as ServiceWrapper[])?.[0];
    if (!created) throw new Error('Create succeeded but no ServiceWrapper returned.');
    return { data: flatten(created) as Complaint };
  },

  // Unsupported — react-admin's <Resource> only uses getList/getOne/create
  // for the citizen-facing screens. Throw loudly so a missing-feature bug
  // doesn't get masked as a silent empty response.
  getMany() { return Promise.reject(new Error('getMany is not supported on complaints')); },
  getManyReference() { return Promise.reject(new Error('getManyReference is not supported on complaints')); },
  update() { return Promise.reject(new Error('update is not supported on complaints (T1)')); },
  updateMany() { return Promise.reject(new Error('updateMany is not supported on complaints')); },
  delete() { return Promise.reject(new Error('delete is not supported on complaints')); },
  deleteMany() { return Promise.reject(new Error('deleteMany is not supported on complaints')); },
};

export const citizenDataProvider = provider as unknown as DataProvider;

// ── AuthProvider ─────────────────────────────────────────────────────────

// We let our own App.tsx own the login + logout flow (CitizenLoginPage drives
// register/auth, AppContext drives state). The authProvider here is the read
// view of that — it tells react-admin who the user is + whether the session
// is alive. login()/logout() throw so react-admin can't surface its own
// /login route over ours.
export const citizenAuthProvider: AuthProvider = {
  async login() {
    throw new Error('react-admin login is not used; auth is driven by /citizen/login');
  },
  async logout() {
    // In KC mode with a live KC session, do RP-initiated logout — Keycloak
    // kills its server-side session, then redirects to /citizen/login. The
    // browser navigates away so this function never actually returns.
    if (isKeycloakMode() && hasKcToken()) {
      const idToken = getKcIdToken();
      clearKcTokens();
      logoutKc(idToken);
      return;
    }
    // OTP mode: App.tsx already handles the logout side effect — nothing
    // to do here.
  },
  async checkAuth() {
    if (!apiClient.isAuthenticated()) throw new Error('Not authenticated');
  },
  async checkError(error: { status?: number } | undefined) {
    if (error?.status === 401 || error?.status === 403) {
      throw new Error('Session expired');
    }
  },
  async getPermissions() {
    return ['CITIZEN'];
  },
  async getIdentity() {
    const { user } = apiClient.getAuth();
    if (!user) throw new Error('No identity available');
    return {
      id: user.uuid ?? user.userName,
      fullName: user.name,
    };
  },
};
