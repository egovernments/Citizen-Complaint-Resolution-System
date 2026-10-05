import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { identityJson, type DigitContext, type ReadOtp } from './identity-bff';

/**
 * Real-stack onboarding journey (#2266): self-service signup, workspace setup
 * through the configurator's own endpoints, then a complaint lifecycle on the
 * new tenant. Every value that points at a deployment comes from env.
 */
export const requiredKeys = ['ONBOARDING_E2E_BASE_URL', 'ONBOARDING_E2E_MAILPIT_URL', 'ONBOARDING_E2E_OTP_COMMAND'] as const;
export function missingConfig() {
  return requiredKeys.filter(key => !process.env[key]);
}
export const baseURL = () => process.env.ONBOARDING_E2E_BASE_URL!.replace(/\/$/, '');
const mailpitURL = () => process.env.ONBOARDING_E2E_MAILPIT_URL!.replace(/\/$/, '');
export const emailDomain = () => process.env.ONBOARDING_E2E_EMAIL_DOMAIN || 'e2e.test';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs leave their tenant behind (there is no tenant delete API), so the slug
 * carries a recognisable `e2e-` prefix. Tenant ids keep only a-z, so the run
 * stamp is written in letters: slug `e2e-<stamp>` becomes tenant `ee<stamp>`.
 */
export function runSlug(now = Date.now()) {
  let stamp = '';
  for (let n = now; n > 0; n = Math.floor(n / 26)) stamp = String.fromCharCode(97 + (n % 26)) + stamp;
  return `e2e-${stamp}`;
}

/** A national mobile number; the spec checks it against the tenant's own rule. */
export function testMobile() {
  const prefix = process.env.ONBOARDING_E2E_MOBILE_PREFIX || '7';
  const length = Number(process.env.ONBOARDING_E2E_MOBILE_LENGTH || 9);
  let digits = prefix;
  while (digits.length < length) digits += String(randomBytes(1)[0] % 10);
  return digits;
}

export const testPassword = () => `E2e-${randomBytes(9).toString('base64url')}-9a`;

// ---------------------------------------------------------------------------
// Strict responses
// ---------------------------------------------------------------------------

const allowances = new WeakMap<APIRequestContext, Set<number>>();
/** Status codes the journey never expects: each fails the run where it happens. */
const unexpected = (status: number) => status === 403 || status === 404 || status >= 500;

/**
 * Every request through this context, including the ones shared identity
 * helpers make, fails on 403/404/5xx unless the call sits inside `allowing`.
 */
export function strict(context: APIRequestContext, label: string): APIRequestContext {
  for (const method of ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head'] as const) {
    const original = (context[method] as (...args: unknown[]) => Promise<APIResponse>).bind(context);
    (context as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      const response = await original(...args);
      const status = response.status();
      if (unexpected(status) && !allowances.get(context)?.has(status)) {
        const target = typeof args[0] === 'string' ? args[0] : (args[0] as { url(): string }).url();
        throw new Error(`${label}: ${method.toUpperCase()} ${new URL(target, 'http://x').pathname} -> HTTP ${status}${await errorCodes(response)}`);
      }
      return response;
    };
  }
  return context;
}

/** A deliberate negative probe: only the listed statuses are tolerated for its duration. */
export async function allowing<T>(context: APIRequestContext, statuses: number[], run: () => Promise<T>): Promise<T> {
  const previous = allowances.get(context);
  allowances.set(context, new Set(statuses));
  try { return await run(); } finally {
    if (previous) allowances.set(context, previous); else allowances.delete(context);
  }
}

/** Error codes only: DIGIT `Errors[]` and the BFF's upper-case `code`, never other body fields. */
async function errorCodes(response: APIResponse) {
  const body = await response.json().catch(() => null);
  if (typeof body?.code === 'string' && /^[A-Z_]+$/.test(body.code)) return ` (${body.code})`;
  const errors = Array.isArray(body?.Errors) ? body.Errors : [];
  return errors.length ? ` ${errors.map((e: { code?: string; message?: string }) => `${e.code}: ${String(e.message ?? '').slice(0, 160)}`).join('; ')}` : '';
}

export async function ok<T = any>(response: APIResponse, statuses = [200, 201, 202]): Promise<T> {
  if (!statuses.includes(response.status())) {
    throw new Error(`${new URL(response.url()).pathname} -> HTTP ${response.status()}${await errorCodes(response)}`);
  }
  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Mail and OTP sinks
// ---------------------------------------------------------------------------

/** The first Keycloak or BFF link in the newest mail to `to`; earlier mail is ignored by id. */
export async function mailedLink(to: string, seen = new Set<string>(), timeout = 90_000): Promise<{ link: string; id: string; subject: string }> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailpitURL()}/search?${new URLSearchParams({ query: `to:${to}`, limit: '5' })}`);
    if (!search.ok) throw new Error(`Mailpit search failed: HTTP ${search.status}`);
    const fresh = ((await search.json()).messages ?? []).find((m: { ID: string }) => !seen.has(m.ID));
    if (fresh) {
      const message = await (await fetch(`${mailpitURL()}/message/${fresh.ID}`)).json();
      const urls = `${message.HTML ?? ''}\n${message.Text ?? ''}`.match(/https?:\/\/[^\s"<>]+/g) ?? [];
      const link = urls.map(unescapeHtml).find(url => url.includes('/auth/') || url.includes('/identity/'));
      if (link) return { link, id: fresh.ID, subject: message.Subject };
    }
    await sleep(1_500);
  }
  throw new Error(`No mail with a sign-in link reached ${to}`);
}

/**
 * Reads a citizen OTP by running ONBOARDING_E2E_OTP_COMMAND. The command gets
 * OTP_PHONE, OTP_TENANT_ID, OTP_CHALLENGE_ID and OTP_SINCE_MS and prints the
 * code (the last 6-digit run on stdout wins). It can read a log sender, an SMS
 * sink or anything else the deployment offers.
 */
export const commandOtp: ReadOtp = async challenge => {
  const env = { ...process.env, OTP_PHONE: challenge.mobileNumber, OTP_TENANT_ID: challenge.tenantId,
    OTP_CHALLENGE_ID: challenge.challengeId, OTP_SINCE_MS: String(challenge.requestedAt) };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const out = await new Promise<string>((resolve, reject) => execFile('/bin/sh', ['-c', process.env.ONBOARDING_E2E_OTP_COMMAND!],
      { env, timeout: 20_000 }, (error, stdout) => error ? reject(new Error(`OTP command failed: ${error.message.split('\n')[0]}`)) : resolve(stdout)));
    const code = out.match(/(\d{6})\s*$/)?.[1];
    if (code) return code;
    await sleep(1_000);
  }
  throw new Error('The OTP command printed no code within the test window');
};

// ---------------------------------------------------------------------------
// Keycloak pages. The theme renders forms with JS, so there are no inputs in
// the HTML: posts go straight to the page's login action.
// ---------------------------------------------------------------------------

function unescapeHtml(value: string) {
  return value.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/&#x3D;/gi, '=').replace(/&#61;/g, '=');
}
const pageId = (html: string) => html.match(/pageId"\s*:\s*"([^"]+)"/)?.[1];
function loginAction(html: string) {
  const match = html.match(/loginAction"\s*:\s*"([^"]+)"/) ?? html.match(/action="([^"]+)"/);
  return match ? unescapeHtml(match[1]) : undefined;
}
const LOGIN_PAGES = new Set(['login', 'login.ftl', 'login-username', 'login-password']);

/** Follows an activation mail through Keycloak's required actions and sets the password. */
export async function activateAccount(request: APIRequestContext, link: string, password: string): Promise<void> {
  let response = await request.get(link);
  let passwordSet = false;
  for (let step = 0; step < 6; step++) {
    const html = await response.text();
    const id = pageId(html);
    if (!id) break;
    if (html.includes('password-new') || id.includes('update-password')) {
      response = await request.post(loginAction(html)!, { form: { 'password-new': password, 'password-confirm': password } });
      passwordSet = true;
    } else if (id.startsWith('info')) {
      const proceed = html.match(/"actionUri"\s*:\s*"([^"]+)"/) ?? html.match(/href="([^"]*login-actions[^"]*)"/);
      if (!proceed) break;
      response = await request.get(unescapeHtml(proceed[1]));
    } else {
      throw new Error(`Activation stopped on Keycloak page ${id}`);
    }
  }
  if (!passwordSet) throw new Error('Activation mail did not lead to a password form');
  // A same-second sign-in after a credential change is revoked on purpose (#2284).
  await sleep(2_000);
}

/** Staff sign-in on the tenant's employee surface; the BFF session lands in `request`'s cookies. */
export async function employeeSignIn(request: APIRequestContext, base: string, slug: string, username: string, password: string) {
  const params = new URLSearchParams({ surface: 'employee', method: 'password', intent: 'signin', tenantSlug: slug,
    returnTo: `/${slug}/digit-ui/employee/user/login` });
  let response = await request.get(`${base}/identity/v1/authorize?${params}`);
  for (let step = 0; step < 4; step++) {
    const html = await response.text();
    const id = pageId(html);
    if (!id) break;
    if (!LOGIN_PAGES.has(id)) throw new Error(`Sign-in stopped on Keycloak page ${id}`);
    response = await request.post(loginAction(html)!, { form: { username, password } });
  }
  const session = await identityJson<{ authenticated: boolean }>(await request.get(`${base}/identity/v1/session?surface=employee`));
  if (session.authenticated !== true) throw new Error('Employee sign-in did not establish a BFF session');
}

// ---------------------------------------------------------------------------
// DIGIT calls, shaped like the configurator's apiClient
// ---------------------------------------------------------------------------

export class Digit {
  constructor(readonly request: APIRequestContext, readonly base: string, readonly context: DigitContext, readonly tenantId: string) {}
  get user() { return this.context.UserRequest; }
  ri(over: Record<string, unknown> = {}) {
    const userInfo = { ...this.user, tenantId: this.user.type === 'CITIZEN' ? this.user.tenantId : this.tenantId };
    return { apiId: 'Rainmaker', ver: '1.0', ts: Date.now(), msgId: `${Date.now()}|en_IN`, authToken: this.context.access_token, userInfo, ...over };
  }
  raw(path: string, body: Record<string, unknown> = {}, ri?: Record<string, unknown>) {
    return this.request.post(`${this.base}${path}`, {
      headers: { Authorization: `Bearer ${this.context.access_token}` }, data: { ...body, RequestInfo: ri ?? this.ri() },
    });
  }
  async post<T = any>(path: string, body: Record<string, unknown> = {}, ri?: Record<string, unknown>): Promise<T> {
    return ok<T>(await this.raw(path, body, ri));
  }
  async mdms(schemaCode: string, tenantId = this.tenantId): Promise<Array<{ id: string; tenantId: string; schemaCode: string; uniqueIdentifier: string; data: any; isActive?: boolean; auditDetails?: unknown }>> {
    const body = await this.post('/mdms-v2/v2/_search', { MdmsCriteria: { tenantId, schemaCode, limit: 5000, offset: 0 } });
    return body.mdms ?? [];
  }
  mdmsCreate(schemaCode: string, uniqueIdentifier: string, data: Record<string, unknown>) {
    return this.post(`/mdms-v2/v2/_create/${schemaCode}`, { Mdms: { tenantId: this.tenantId, schemaCode, uniqueIdentifier, data, isActive: true } });
  }
  upsertLabels(locales: string[], messages: Array<{ code: string; message: string; module: string }>) {
    return Promise.all(locales.map(locale => this.post('/localization/messages/v1/_upsert',
      { tenantId: this.tenantId, locale, messages: messages.map(m => ({ ...m, locale })) }, this.ri({ apiId: 'emp', action: 'create' }))));
  }
}

const WS = '/pgr-services/v2/onboarding/workspaces';
export interface Workspace { status: string; version: number; steps: Record<string, { state: string }> }
export async function workspace(digit: Digit): Promise<{ Workspace: Workspace; Probes?: Record<string, boolean | null> }> {
  return digit.post(`${WS}/_search`, { tenantId: digit.tenantId });
}
export async function markDone(digit: Digit, step: string): Promise<Workspace> {
  const { Workspace: current } = await workspace(digit);
  const updated = await digit.post(`${WS}/_update`, { tenantId: digit.tenantId, step, state: 'DONE', version: current.version });
  expect(updated.Workspace.steps[step].state, `${step} accepted as DONE`).toBe('DONE');
  return updated.Workspace;
}

/** en_IN plus the root StateInfo languages, as the configurator's labelLocales does. */
export async function labelLocales(digit: Digit) {
  const rows = await digit.mdms('common-masters.StateInfo', digit.tenantId.split('.')[0]);
  const languages = rows.map(row => row.data).find(data => Array.isArray(data.languages))?.languages ?? [];
  return [...new Set(['en_IN', ...languages.map((l: { value?: string }) => l.value).filter(Boolean)])] as string[];
}

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

export async function magicLinkSignIn(request: APIRequestContext, base: string, email: string, seen = new Set<string>()) {
  const origin = { Origin: new URL(base).origin };
  const requested = await request.post(`${base}/identity/v1/authentication/magic-link-requests`, {
    headers: origin, data: { email, firstName: 'E2E', lastName: 'Founder', returnTo: '/configurator/login' },
  });
  expect([200, 202], 'magic link requested').toContain(requested.status());
  const { link } = await mailedLink(email, seen);
  await request.get(link);
  const session = await identityJson<{ authenticated: boolean }>(await request.get(`${base}/identity/v1/session?surface=configurator`));
  expect(session.authenticated, 'magic link establishes a configurator session').toBe(true);
}

export async function signupFounder(request: APIRequestContext, base: string, input: { slug: string; email: string; mobile: string }) {
  const origin = { Origin: new URL(base).origin };
  await magicLinkSignIn(request, base, input.email);

  const stamp = input.slug.replace(/[^a-z]/g, '').toUpperCase();
  const draft = { accountName: `E2E Workspace ${stamp}`, accountCode: `KE-${stamp}`.slice(0, 32), urlSlug: input.slug,
    countryCode: 'KE', languages: ['en'], timeZone: 'Africa/Nairobi', financialYearPolicy: 'JUL_JUN', acceptedTermsVersion: '2026-09',
    tenantMetadata: { schemaVersion: 1, tenantAdmin: { mobileNumber: input.mobile } } };
  const write = (path: string, data: unknown) => request.post(`${base}/pgr-services/v2/onboarding/signups/${path}`,
    { headers: { ...origin, 'Idempotency-Key': randomUUID() }, data });
  const created = await ok(await write('_create', { Signup: draft }));
  const signupId = created.Signup?.id;
  expect(signupId, 'signup draft created').toBeTruthy();
  const submitted = await ok(await write('_submit', { Signup: { id: signupId } }));
  const operationId = submitted.Operation?.id;
  expect(operationId, 'submit returns an operation').toBeTruthy();

  // Provisioning takes about three minutes over a dozen or so retried attempts.
  // SUCCEEDED is published to the identity side on a later tick, and the tenant
  // is not listed until then, so wait for that too, as SignupPage does (#2303).
  let deadline = Date.now() + 8 * 60_000;
  let operation: { status?: string; currentStep?: string; errorCode?: string; lifecyclePublishedAt?: number | null } = {};
  while (Date.now() < deadline) {
    const found = await ok(await request.post(`${base}/pgr-services/v2/onboarding/operations/_search`, { headers: origin, data: { Operation: { id: operationId } } }));
    operation = found.Operations?.[0] ?? {};
    if ((operation.status === 'SUCCEEDED' && operation.lifecyclePublishedAt) || operation.status === 'TERMINAL_FAILED') break;
    if (operation.status === 'SUCCEEDED') deadline = Math.min(deadline, Date.now() + 2 * 60_000);
    await sleep(4_000);
  }
  expect(operation.status, `provisioning ended at ${operation.currentStep} (${operation.errorCode ?? 'no error code'})`).toBe('SUCCEEDED');
  expect(operation.lifecyclePublishedAt, 'SUCCEEDED outcome published to the identity side').toBeTruthy();
  const signup = (await ok(await request.post(`${base}/pgr-services/v2/onboarding/signups/_search`, { headers: origin, data: { Signup: { id: signupId } } }))).Signups?.[0];
  expect(signup?.urlSlug).toBe(input.slug);
  // As SignupPage does: the new tenant is offered to the same session, without another sign-in.
  const options = await identityJson<{ tenants: Array<{ tenantId: string }> }>(await request.get(`${base}/identity/v1/tenants`));
  expect(options.tenants.map(t => t.tenantId), 'new tenant offered to the founder session').toContain(signup.requestedTenantId);
  return { tenantId: signup.requestedTenantId as string, signupStatus: signup.status as string };
}

// ---------------------------------------------------------------------------
// Workspace steps, mirroring configurator/src/onboarding/**
// ---------------------------------------------------------------------------

/** A valid 8x8 PNG; filestore rejects SVG. */
function logoPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(8, 0); header.writeUInt32BE(8, 4); header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array(8).fill([0x25, 0x63, 0xeb]).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

export async function brandingStep(digit: Digit) {
  const { tenantId } = digit;
  const upload = await ok(await digit.request.post(`${digit.base}/filestore/v1/files`, {
    headers: { Authorization: `Bearer ${digit.context.access_token}` },
    multipart: { tenantId, module: 'branding', file: { name: 'e2e-logo.png', mimeType: 'image/png', buffer: logoPng() } },
  }));
  const fileStoreId = upload.files[0].fileStoreId as string;
  const logo = `${digit.base}/filestore/v1/files/id?tenantId=${tenantId}&fileStoreId=${fileStoreId}`;
  expect((await digit.request.get(logo, { headers: { Authorization: `Bearer ${digit.context.access_token}` } })).status()).toBe(200);
  const record = (await digit.mdms('tenant.tenants')).find(r => r.uniqueIdentifier === tenantId && r.isActive !== false);
  expect(record, 'tenant record exists to brand').toBeTruthy();
  await digit.post('/mdms-v2/v2/_update/tenant.tenants', { Mdms: { ...record, data: { ...record!.data, logoId: logo, imageId: fileStoreId }, isActive: true } });
  if (!(await digit.mdms('common-masters.ThemeConfig')).some(r => r.tenantId === tenantId && r.isActive !== false)) {
    await digit.mdmsCreate('common-masters.ThemeConfig', 'themeconfig', { code: 'themeconfig', name: 'E2E Blue', version: '3',
      colors: { 'button-primary-bg-default': '#2563EB', 'button-primary-text': '#FFFFFF', 'text-primary': '#0B0C0C' } });
  }
  return markDone(digit, 'BRANDING');
}

export const HIERARCHY = 'ADMIN';
export const BOUNDARIES = [
  { code: 'E2E_COUNTY', name: 'E2E County', type: 'County', lat: -1.30, lon: 36.80 },
  { code: 'E2E_WARD_A', name: 'Ward Alpha', type: 'Ward', parent: 'E2E_COUNTY', lat: -1.28, lon: 36.78 },
  { code: 'E2E_WARD_B', name: 'Ward Beta', type: 'Ward', parent: 'E2E_COUNTY', lat: -1.32, lon: 36.83 },
];

export async function geographyStep(digit: Digit, locales: string[]) {
  const { tenantId } = digit;
  await digit.post('/boundary-service/boundary-hierarchy-definition/_create', { BoundaryHierarchy: { tenantId, hierarchyType: HIERARCHY,
    boundaryHierarchy: [{ boundaryType: 'County', active: true }, { boundaryType: 'Ward', parentBoundaryType: 'County', active: true }] } });
  for (const b of BOUNDARIES) {
    await digit.post('/boundary-service/boundary/_create', { Boundary: [{ tenantId, code: b.code, geometry: { type: 'Point', coordinates: [b.lon, b.lat] } }] });
  }
  const codes = BOUNDARIES.map(b => b.code).join(',');
  await expect.poll(async () => ((await digit.post(`/boundary-service/boundary/_search?tenantId=${tenantId}&codes=${codes}&limit=10`)).Boundary ?? []).length,
    { message: 'boundary entities persisted', timeout: 60_000 }).toBe(BOUNDARIES.length);
  for (const b of BOUNDARIES) {
    await digit.post('/boundary-service/boundary-relationships/_create', { BoundaryRelationship: {
      tenantId, hierarchyType: HIERARCHY, code: b.code, boundaryType: b.type, ...(b.parent ? { parent: b.parent } : {}) } });
    // A child's parent must be persisted before the child's relationship is accepted.
    await sleep(1_000);
  }
  await expect.poll(async () => {
    const trees = (await digit.post(`/boundary-service/boundary-relationships/_search?tenantId=${tenantId}&hierarchyType=${HIERARCHY}&includeChildren=true`)).TenantBoundary ?? [];
    return trees.flatMap((t: any) => t.boundary ?? []).flatMap((root: any) => root.children ?? []).length;
  }, { message: 'two-level boundary tree readable', timeout: 60_000 }).toBe(2);
  await digit.mdmsCreate('CMS-BOUNDARY.HierarchySchema', 'CMS.All',
    { moduleName: 'CMS', department: 'All', hierarchy: HIERARCHY, highestHierarchy: 'County', lowestHierarchy: 'Ward' });
  const prefix = tenantId.toUpperCase().replace(/\./g, '_');
  await digit.upsertLabels(locales, [
    ...BOUNDARIES.flatMap(b => [b.code, `${prefix}_${HIERARCHY}_${b.code}`].map(code => ({ code, message: b.name, module: `rainmaker-boundary-${HIERARCHY.toLowerCase()}` }))),
    ...['County', 'Ward'].map(level => ({ code: `${HIERARCHY}_${level.toUpperCase()}`, message: level, module: 'rainmaker-common' })),
  ]);
  return markDone(digit, 'GEOGRAPHY');
}

export const DEPARTMENTS = [{ code: 'WATER', name: 'Water' }, { code: 'ROADS', name: 'Roads' }];
export const DESIGNATION = { code: 'ENGINEER', name: 'Engineer' };

export async function departmentsStep(digit: Digit, locales: string[]) {
  for (const d of DEPARTMENTS) await digit.mdmsCreate('common-masters.Department', d.code, { code: d.code, name: d.name, active: true });
  await digit.mdmsCreate('common-masters.Designation', DESIGNATION.code,
    { code: DESIGNATION.code, name: DESIGNATION.name, description: DESIGNATION.name, department: [], active: true });
  await digit.upsertLabels(locales, [
    ...DEPARTMENTS.map(d => ({ code: `COMMON_MASTERS_DEPARTMENT_${d.code}`, message: d.name, module: 'rainmaker-common' })),
    { code: `COMMON_MASTERS_DESIGNATION_${DESIGNATION.code}`, message: DESIGNATION.name, module: 'rainmaker-common' },
  ]);
  return markDone(digit, 'DEPARTMENTS');
}

export interface Staff { key: string; name: string; email: string; mobile: string; role: 'GRO' | 'PGR_LME'; department: string; jurisdiction: string }
export interface Hired extends Staff { code: string; uuid: string }

/** HRMS `_create` then BFF `_link`, as configurator `createAndLink` does. */
export async function hireAndLink(digit: Digit, base: string, people: Staff[]): Promise<Hired[]> {
  const { tenantId } = digit;
  const roles = new Map((await digit.mdms('ACCESSCONTROL-ROLES.roles')).map(r => [r.data.code, r.data.name]));
  const existing = (await digit.post(`/egov-hrms/employees/_search?tenantId=${tenantId}&limit=500&offset=0`, {}, digit.ri({ action: '_search' }))).Employees ?? [];
  let next = Math.max(0, ...existing.map((e: { code?: string }) => Number(/^EMP_(\d+)$/.exec(e.code ?? '')?.[1] ?? 0))) + 1;
  const hired: Hired[] = [];
  for (const person of people) {
    const code = `EMP_${String(next++).padStart(4, '0')}`;
    const employee = {
      code, tenantId, employeeStatus: 'EMPLOYED', employeeType: 'PERMANENT',
      user: { userName: person.name.toLowerCase().replace(/[^a-z0-9]+/g, '.'), name: person.name, mobileNumber: person.mobile, emailId: person.email,
        type: 'EMPLOYEE', active: true, tenantId,
        roles: ['EMPLOYEE', person.role].map(r => ({ code: r, name: roles.get(r) ?? r, tenantId })) },
      jurisdictions: [{ boundary: person.jurisdiction, boundaryType: BOUNDARIES.find(b => b.code === person.jurisdiction)!.type,
        hierarchy: HIERARCHY, hierarchyType: HIERARCHY, tenantId, isActive: true }],
      assignments: [{ designation: DESIGNATION.code, department: person.department, fromDate: Date.now(), isCurrentAssignment: true }],
    };
    const created = (await digit.post('/egov-hrms/employees/_create', { Employees: [employee] }, digit.ri({ action: '_create' }))).Employees[0];
    const uuid = created.user?.uuid ?? created.uuid;
    expect(uuid, `${person.key} has a DIGIT account`).toBeTruthy();
    const linked = await identityJson<{ binding: { state: string }; activationEmailSent?: boolean }>(
      await digit.request.post(`${base}/identity/v1/workspace-members/_link`, { headers: { Origin: new URL(base).origin },
        data: { tenantId, digitUuid: uuid, email: person.email } }), 201);
    expect(linked.binding.state, `${person.key} binding`).toBeTruthy();
    hired.push({ ...person, code, uuid });
  }
  return hired;
}

export const COMPLAINT_TYPES = [
  { code: 'Water', name: 'Water', leaves: [{ code: 'WaterLeak', name: 'Leak', department: 'WATER' }] },
  { code: 'Roads', name: 'Roads', leaves: [{ code: 'RoadsPothole', name: 'Pothole', department: 'ROADS' }] },
];

export async function complaintTypesStep(digit: Digit, locales: string[], slaHours = 24) {
  const DEF = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
  if (!(await digit.mdms(DEF)).some(r => r.isActive !== false && r.data.hierarchyType === 'PGR')) {
    const levels = [['COMPLAINT_TYPE', 'Complaint Category'], ['SUB_TYPE', 'Complaint Subcategory']].map(([levelCode, label], i) =>
      ({ levelCode, order: i + 1, parentLevel: i ? 'COMPLAINT_TYPE' : null, isFreeText: false, isLeafServiceCode: i === 1, label }));
    await digit.mdmsCreate(DEF, 'PGR', { hierarchyType: 'PGR', active: true, levels });
  }
  let order = 0;
  for (const type of COMPLAINT_TYPES) {
    await digit.mdmsCreate('RAINMAKER-PGR.ComplaintHierarchy', type.code, { hierarchyType: 'PGR', levelCode: 'COMPLAINT_TYPE', code: type.code,
      name: type.name, parentCode: null, order: ++order, active: true, path: type.code });
    for (const leaf of type.leaves) {
      await digit.mdmsCreate('RAINMAKER-PGR.ComplaintHierarchy', leaf.code, { hierarchyType: 'PGR', levelCode: 'SUB_TYPE', code: leaf.code,
        name: leaf.name, parentCode: type.code, order: ++order, active: true, path: `${type.code}.${leaf.code}`,
        department: leaf.department, slaHours, keywords: '' });
    }
  }
  const rows = COMPLAINT_TYPES.flatMap(t => [t, ...t.leaves]);
  await digit.upsertLabels(locales, rows.flatMap(r => [...new Set([r.code, r.code.toUpperCase()])]
    .map(code => ({ code: `COMPLAINT_HIERARCHY.${code}`, message: r.name, module: 'rainmaker-pgr' }))));
  return markDone(digit, 'COMPLAINT_TYPES');
}

/** Codes a step wrote that the apps will render for `locale`; returns those that do not resolve. */
export async function unresolvedLabels(digit: Digit, locale: string, codes: Record<string, string[]>) {
  const missing: string[] = [];
  for (const [module, wanted] of Object.entries(codes)) {
    const body = await digit.post(`/localization/messages/v1/_search?${new URLSearchParams({ tenantId: digit.tenantId, locale, module })}`);
    const found = new Map<string, string>((body.messages ?? []).map((m: { code: string; message: string }) => [m.code, m.message]));
    for (const code of wanted) if (!found.get(code) || found.get(code) === code) missing.push(`${module}:${code}`);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Complaint lifecycle
// ---------------------------------------------------------------------------

const PGR = '/pgr-services/v2/request';
export async function fileComplaint(citizen: Digit, serviceCode: string, ward: string) {
  const b = BOUNDARIES.find(x => x.code === ward)!;
  const now = Date.now();
  const service = { active: true, tenantId: citizen.tenantId, serviceCode, description: `E2E onboarding run: ${serviceCode}`, applicationStatus: 'CREATED',
    source: 'web', citizen: citizen.user, isDeleted: false, rowVersion: 1,
    address: { landmark: '', street: 'Main road', locality: { code: ward }, geoLocation: { latitude: b.lat, longitude: b.lon } },
    additionalDetail: JSON.stringify({ supervisorName: null, supervisorContactNumber: null }),
    auditDetails: { createdBy: citizen.user.uuid, createdTime: now, lastModifiedBy: citizen.user.uuid, lastModifiedTime: now } };
  const body = await citizen.post(`${PGR}/_create?tenantId=${citizen.tenantId}`, { service, workflow: { action: 'APPLY', verificationDocuments: [] } });
  return body.ServiceWrappers[0].service as { serviceRequestId: string; applicationStatus: string };
}

export async function complaint(digit: Digit, id: string) {
  const body = await digit.post(`${PGR}/_search?tenantId=${digit.tenantId}&serviceRequestId=${id}`);
  return (body.ServiceWrappers?.[0]?.service ?? null) as (Record<string, any> & { applicationStatus: string }) | null;
}

/** The inbox tab: MINE is assigned-to-me; TEAM adds the reportee subtree and unassigned queues. */
export async function inbox(digit: Digit, scope: 'MINE' | 'TEAM') {
  const body = await digit.post(`${PGR}/inbox/_search?tenantId=${digit.tenantId}&scope=${scope}&limit=50&offset=0`);
  return (body.ServiceWrappers ?? []).map((w: any) => w.service.serviceRequestId as string);
}

export async function act(digit: Digit, service: Record<string, unknown>, workflow: Record<string, unknown>) {
  const body = await digit.post(`${PGR}/_update?tenantId=${digit.tenantId}`, { service, workflow });
  return body.ServiceWrappers[0].service.applicationStatus as string;
}

export async function history(digit: Digit, id: string) {
  const body = await digit.post(`/egov-workflow-v2/egov-wf/process/_search?tenantId=${digit.tenantId}&businessIds=${id}&history=true`);
  return (body.ProcessInstances ?? []).reverse().map((p: any) => p.action as string);
}

/** Deactivate in HRMS, then drop the binding, as configurator `deactivateAndRemove` does. */
export async function removeMember(digit: Digit, base: string, member: Hired) {
  const rows = (await digit.post(`/egov-hrms/employees/_search?tenantId=${digit.tenantId}&codes=${member.code}`, {}, digit.ri({ action: '_search' }))).Employees ?? [];
  const row = rows.find((r: { code: string }) => r.code === member.code);
  expect(row, `${member.key} found in HRMS`).toBeTruthy();
  const user = { ...row.user };
  delete user.password;
  await digit.post('/egov-hrms/employees/_update', { Employees: [{ ...row, user, isActive: false, reActivateEmployee: false,
    deactivationDetails: [...(row.deactivationDetails ?? []), { reasonForDeactivation: 'OTHERS', effectiveFrom: Date.now() }] }] }, digit.ri({ action: '_update' }));
  return identityJson<{ removed: boolean; state: string }>(await digit.request.post(`${base}/identity/v1/workspace-members/_remove`,
    { headers: { Origin: new URL(base).origin }, data: { tenantId: digit.tenantId, digitUuid: member.uuid } }));
}
