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

const BASE = '/novu-bridge/novu-adapter/v1/providers';

export type Channel = 'SMS' | 'EMAIL' | 'WHATSAPP';

/** Novu integration projection returned by the bridge (never carries secrets). */
export interface Integration {
  _id?: string;
  channel?: string;
  providerId?: string;
  name?: string;
  identifier?: string;
  active?: boolean;
  primary?: boolean;
  credentials?: Record<string, unknown>;
}

export interface CreateProviderInput {
  channel: Channel;
  providerId: string;
  name: string;
  identifier?: string;
  credentials: Record<string, unknown>;
}

export interface TemplatesResponse {
  data: { workflowId: string; name: string }[];
  total: number;
}

export interface VerifyResponse {
  ok: boolean;
  active: boolean;
  detail?: string;
}

export interface TestSendPayload {
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
}

/** Same-origin base — the novu-bridge route is served behind Kong/nginx on the
 *  page's own origin. Falls back to a relative URL in non-browser contexts. */
function origin(): string {
  return typeof window !== 'undefined' && window.location ? window.location.origin : '';
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
    throw new Error(msg);
  }
  return data as T;
}

/** POST /providers — create a Novu integration. Credentials go straight through
 *  to Novu over TLS; the response never echoes them back. */
export function createProvider(input: CreateProviderInput): Promise<Integration> {
  return call<Integration>(BASE, 'POST', input);
}

/** GET /providers/templates — read-only discovery of Novu delivery workflows. */
export function pullTemplates(channel: string, providerId: string): Promise<TemplatesResponse> {
  const qs = new URLSearchParams();
  if (channel) qs.set('channel', channel);
  if (providerId) qs.set('providerId', providerId);
  const q = qs.toString();
  return call<TemplatesResponse>(`${BASE}/templates${q ? `?${q}` : ''}`, 'GET');
}

/** POST /providers/verify — connectivity/active check for one integration. */
export function verifyProvider(integrationId: string): Promise<VerifyResponse> {
  return call<VerifyResponse>(`${BASE}/verify`, 'POST', { integrationId });
}

/** POST /providers/test-send — dispatch one live test message via Novu. */
export function testSend(payload: TestSendPayload): Promise<TestSendResponse> {
  return call<TestSendResponse>(`${BASE}/test-send`, 'POST', payload);
}

// ---------------------------------------------------------------------------
// Per-channel provider + credential-field metadata (drives the Add dialog).
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

/** Default providerId per channel (SMS/WhatsApp → twilio, Email → nodemailer). */
export const DEFAULT_PROVIDER: Record<Channel, string> = {
  SMS: 'twilio',
  WHATSAPP: 'twilio',
  EMAIL: 'nodemailer',
};

/** Credential fields the operator must fill for a given channel + providerId. */
export function credFields(channel: Channel, providerId: string): CredField[] {
  if (providerId === 'nodemailer' || channel === 'EMAIL') {
    return [
      { key: 'host', labelKey: 'app.providers.cred.host', labelDefault: 'SMTP Host', type: 'text', placeholder: 'smtp.example.com', required: true },
      { key: 'user', labelKey: 'app.providers.cred.user', labelDefault: 'SMTP User', type: 'text', placeholder: 'apikey / username', required: true },
      { key: 'password', labelKey: 'app.providers.cred.password', labelDefault: 'SMTP Password', type: 'password', required: true },
      { key: 'from', labelKey: 'app.providers.cred.from', labelDefault: 'From', type: 'text', placeholder: 'noreply@example.com', required: true },
      { key: 'secure', labelKey: 'app.providers.cred.secure', labelDefault: 'Use TLS (secure)', type: 'checkbox' },
    ];
  }
  // Twilio (SMS + WhatsApp share the same integration).
  const fromPlaceholder = channel === 'WHATSAPP' ? 'whatsapp:+15551234567' : '+15551234567';
  return [
    { key: 'accountSid', labelKey: 'app.providers.cred.account_sid', labelDefault: 'Account SID', type: 'text', placeholder: 'ACxxxxxxxx', required: true },
    { key: 'token', labelKey: 'app.providers.cred.token', labelDefault: 'Auth Token', type: 'password', required: true },
    { key: 'from', labelKey: 'app.providers.cred.from', labelDefault: 'From', type: 'text', placeholder: fromPlaceholder, required: true },
  ];
}

/** Coarse channel for a row served by the integrations projection. WhatsApp is
 *  stored as a Twilio `sms` integration, so a `sms` row may be used for either —
 *  the Test dialog lets the operator pick SMS vs WhatsApp explicitly. */
export function rowChannel(raw: unknown): Channel {
  return String(raw ?? '').toUpperCase() === 'EMAIL' ? 'EMAIL' : 'SMS';
}
