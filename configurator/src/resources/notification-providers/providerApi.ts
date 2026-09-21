// Client for the novu-bridge provider-management endpoints (Novu-native).
//
// These four endpoints live under Kong's keyless SPA route
// `/novu-bridge/novu-adapter/v1/providers*` and are same-origin behind
// nginx/Kong — exactly like the read-only integrations list the
// NotificationProviderList already renders (see dataProvider.ts
// customFetchList). We reuse that pattern: origin-relative fetch + the same
// DIGIT bearer token pulled from the shared digitClient's auth info. No new
// auth plumbing, and — importantly — credentials are only ever sent on an
// explicit submit and are never persisted anywhere on the client.
import { digitClient } from '@/providers/bridge';
import {
  credLabelKey,
  FALLBACK_CATALOG,
  normalizeCatalog,
  type Channel,
  type CreateProviderLegacyBody,
  type CreateProviderTypedBody,
  type ProviderType,
} from './providerCatalog';

const BASE = '/novu-bridge/novu-adapter/v1/providers';

export type { Channel };
// The catalog types + the pure helpers that drive the forms live in
// providerCatalog.ts (no app imports, so they stay unit-testable).
export type {
  ProviderType,
  ProviderTransport,
  CatalogCredentialField,
  IntegrationRow,
  CreateProviderTypedBody,
  CreateProviderLegacyBody,
} from './providerCatalog';
export {
  FALLBACK_CATALOG,
  normalizeCatalog,
  groupCatalogByChannel,
  findProviderType,
  integrationChannel,
  integrationKey,
  integrationLabel,
  isDeliverableIntegration,
  DELIVERABLE_NOVU_CHANNELS,
  providerChoicesForChannel,
  findSelectedIntegration,
  matchesProviderSelection,
  credLabelKey,
  providerTypeLabelKey,
  missingRequiredFields,
  buildCredentials,
  createProviderBody,
  rowChannel,
} from './providerCatalog';

/** Novu integration projection returned by the bridge (never carries secrets). */
export interface Integration {
  _id?: string;
  channel?: string;
  providerId?: string;
  name?: string;
  identifier?: string;
  /** Catalog provider type, or null on integrations created before the catalog existed. */
  type?: string | null;
  active?: boolean;
  primary?: boolean;
}

export interface CreateProviderInput {
  channel: Channel;
  providerId: string;
  name: string;
  identifier?: string;
  credentials: Record<string, unknown>;
}

export interface UpdateProviderInput {
  id: string;
  name?: string;
  /** A FULL replacement credential set — rotation, not a patch. Omit to leave credentials alone. */
  credentials?: Record<string, unknown>;
  active?: boolean;
}

export interface DeleteProviderInput {
  id: string;
  tenantId?: string;
}

export interface DeleteProviderResponse {
  id: string;
  deleted: boolean;
}

export interface TemplatesResponse {
  data: { workflowId: string; name: string; channels?: string[] }[];
  total: number;
}

export interface VerifyResponse {
  ok: boolean;
  active: boolean;
  detail?: string;
}

export interface TestSendPayload {
  /** Operator's tenant: the test row is written here (flagged is_test) so it shows on their Logs screen. */
  tenantId?: string;
  /** Integration to send through; omit to let the bridge pick the channel's provider. */
  id?: string;
  /** Catalog provider type of that integration, when known. */
  type?: string;
  channel: Channel;
  to: { phone?: string; email?: string };
  workflowId?: string;
  body?: string;
  subject?: string;
  contentSid?: string;
  variables?: string[];
}

export interface TestSendResponse {
  ok: boolean;
  novuStatus?: string;
  transactionId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Twilio Content template metadata as the bridge returns it — NO routing decision; the
 *  configurator matches these against the tenant's own routing/template rows
 *  (see twilioTemplateMatch.ts). */
export interface TwilioTemplateMeta {
  templateId: string;
  templateName?: string;
  language?: string;
  approvalStatus?: string;
  tokens?: string[];
}

export interface TwilioTemplatesResponse {
  templates: TwilioTemplateMeta[];
  total: number;
}

export type { MatchedTemplate as TwilioMatchedTemplate, UnmatchedTemplate as TwilioUnmatchedTemplate } from './twilioTemplateMatch';

/** Same-origin base — the novu-bridge route is served behind Kong/nginx on the
 *  page's own origin. Falls back to a relative URL in non-browser contexts. */
function origin(): string {
  return typeof window !== 'undefined' && window.location ? window.location.origin : '';
}

/**
 * A bridge failure that keeps its machine-readable `NB_*` code and HTTP status,
 * so callers can react to a specific one (e.g. NB_PROVIDER_IN_USE on delete)
 * instead of string-matching the message.
 */
export class BridgeError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.status = status;
  }
}

/** The bridge's `NB_*` code for an error, or '' when it was not one of ours. */
export function bridgeErrorCode(err: unknown): string {
  return err instanceof BridgeError ? err.code : '';
}

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = digitClient.getAuthInfo().token;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${origin()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON body — leave data empty and fall through to status handling */
  }

  if (!response.ok) {
    const errors = data.Errors as { message?: string; code?: string }[] | undefined;
    const msg =
      errors?.map((e) => e.message || e.code).join(', ') ||
      (data.message as string) ||
      (data.detail as string) ||
      (data.error as string) ||
      `Request failed (${response.status})`;
    // `Errors[].code` is the documented shape; `error`/`code` are the flatter
    // variants some bridge handlers emit — accept all three so NB_* codes survive.
    const code =
      errors?.map((e) => e.code).find(Boolean) ||
      (typeof data.code === 'string' ? data.code : '') ||
      (typeof data.error === 'string' && /^NB_[A-Z0-9_]+$/.test(data.error) ? data.error : '') ||
      '';
    throw new BridgeError(msg, code, response.status);
  }
  return data as T;
}

/** Unwrap the `{data: T}` envelope the newer provider endpoints use. */
function unwrap<T>(payload: unknown): T {
  const envelope = payload as { data?: unknown } | null;
  return (envelope && typeof envelope === 'object' && 'data' in envelope
    ? (envelope.data as T)
    : (payload as T));
}

/** GET /providers/catalog — the out-of-the-box provider types this bridge can create,
 *  with the credential fields each one needs. The SOURCE OF TRUTH for the Add /
 *  Rotate forms; callers fall back to FALLBACK_CATALOG when this rejects (an older
 *  bridge that predates the endpoint). */
export async function fetchProviderCatalog(): Promise<ProviderType[]> {
  const payload = await call<unknown>(`${BASE}/catalog`, 'GET');
  return normalizeCatalog(payload);
}

/** POST /providers — create a Novu integration. Credentials go straight through
 *  to Novu over TLS; the response never echoes them back. Accepts either the
 *  catalog body `{type, name, credentials, active?}` or the legacy
 *  `{channel, providerId, name, identifier, credentials}` one. */
export async function createProvider(
  input: CreateProviderInput | CreateProviderTypedBody | CreateProviderLegacyBody,
): Promise<Integration> {
  return unwrap<Integration>(await call<unknown>(BASE, 'POST', input));
}

/** POST /providers/_update — rename, rotate credentials, or flip the active flag.
 *  Rotation replaces the whole credential set; the bridge never returns stored
 *  credentials, so there is nothing to merge client-side. */
export async function updateProvider(input: UpdateProviderInput): Promise<Integration> {
  return unwrap<Integration>(await call<unknown>(`${BASE}/_update`, 'POST', input));
}

/** POST /providers/_delete — remove an integration. Rejects with HTTP 409 /
 *  NB_PROVIDER_IN_USE while a NotificationChannel row still selects it. */
export async function deleteProvider(input: DeleteProviderInput): Promise<DeleteProviderResponse> {
  return unwrap<DeleteProviderResponse>(await call<unknown>(`${BASE}/_delete`, 'POST', input));
}

/** The bridge's error code for "this provider is still selected on a channel". */
export const PROVIDER_IN_USE = 'NB_PROVIDER_IN_USE';

/** GET /providers/templates — read-only discovery of Novu delivery workflows.
 *  `channel` filters server-side by the workflow's Novu step types; these are
 *  Novu workflows, NOT provider templates (Twilio has no SMS template registry —
 *  SMS/EMAIL text lives in MDMS NotificationTemplate, approved WhatsApp
 *  ContentSids in NotificationProviderTemplate). */
export function pullTemplates(channel: string, providerId: string): Promise<TemplatesResponse> {
  const qs = new URLSearchParams();
  if (channel) qs.set('channel', channel);
  if (providerId) qs.set('providerId', providerId);
  const q = qs.toString();
  return call<TemplatesResponse>(`${BASE}/templates${q ? `?${q}` : ''}`, 'GET');
}

/** POST /providers/verify — connectivity/active check for one integration. The
 *  catalog `type` is sent alongside when known: newer bridges use it to pick the
 *  right probe, older ones ignore the extra field. */
export function verifyProvider(integrationId: string, type?: string): Promise<VerifyResponse> {
  return call<VerifyResponse>(`${BASE}/verify`, 'POST', {
    integrationId,
    id: integrationId,
    ...(type ? { type } : {}),
  });
}

/** GET /providers/twilio-templates — pull the operator's OWN Twilio WhatsApp Content
 *  templates as metadata (SID, name, language, approval, name tokens). Matching to
 *  routing keys happens client-side in twilioTemplateMatch.ts. Twilio secrets stay
 *  server-side. Surfaces bridge errors (e.g. NB_NO_TWILIO_INTEGRATION) through call()'s
 *  Errors/message extraction so the caller can prompt to add the Twilio provider first. */
export function syncTwilioTemplates(): Promise<TwilioTemplatesResponse> {
  return call<TwilioTemplatesResponse>(`${BASE}/twilio-templates`, 'GET');
}

/** POST /providers/test-send — dispatch one live test message via Novu. */
export function testSend(payload: TestSendPayload): Promise<TestSendResponse> {
  return call<TestSendResponse>(`${BASE}/test-send`, 'POST', payload);
}

// ---------------------------------------------------------------------------
// OFFLINE FALLBACK ONLY.
//
// `GET /providers/catalog` is the source of truth for provider types and their
// credential fields. The two helpers below survive for the case where that call
// fails (a bridge older than the catalog endpoint) and for callers written
// before it existed; both are thin projections of FALLBACK_CATALOG so there is
// exactly one definition of the legacy credential shapes.
// ---------------------------------------------------------------------------

export interface CredField {
  key: string;
  /** i18n key for the label. */
  labelKey: string;
  /** English fallback for the label. */
  labelDefault: string;
  type: 'text' | 'password' | 'checkbox';
  placeholder?: string;
  required?: boolean;
}

export const CHANNELS: Channel[] = ['SMS', 'EMAIL', 'WHATSAPP'];

/** Default Novu providerId per channel (SMS/WhatsApp -> twilio, Email -> nodemailer). */
export const DEFAULT_PROVIDER: Record<Channel, string> = FALLBACK_CATALOG.reduce(
  (acc, pt) => {
    if (!acc[pt.channel]) acc[pt.channel] = pt.novuProviderId;
    return acc;
  },
  {} as Record<Channel, string>,
);

/** Credential fields for a legacy channel + providerId pair, from the fallback catalog. */
export function credFields(channel: Channel, providerId: string): CredField[] {
  const entry =
    FALLBACK_CATALOG.find((pt) => pt.channel === channel && pt.novuProviderId === providerId) ??
    FALLBACK_CATALOG.find((pt) => pt.channel === channel) ??
    FALLBACK_CATALOG[0];
  return entry.credentialFields.map((f) => ({
    key: f.key,
    labelKey: credLabelKey(f.key),
    labelDefault: f.label,
    type: f.type,
    placeholder: f.placeholder,
    required: f.required,
  }));
}
