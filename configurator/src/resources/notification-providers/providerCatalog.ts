// Provider CATALOG: the shape of the out-of-the-box notification providers the
// novu-bridge advertises (`GET /novu-bridge/novu-adapter/v1/providers/catalog`)
// and the pure helpers the Providers / Channels screens derive from it.
//
// Deliberately React-free and app-import-free so every rule here is unit-testable
// without rendering (the app module graph drags in optional deps that are not
// always installed in CI — see channelStatus.ts for the same reasoning).
//
// The catalog is the SOURCE OF TRUTH for which provider types exist, which
// credentials each one needs, and whether verify / test-send are supported.
// FALLBACK_CATALOG below is only used when the catalog call fails (an older
// bridge that predates this endpoint) and therefore only describes the three
// provider types such a bridge could actually create.

import type { Channel } from './channelStatus';

export type { Channel };

/** How the bridge delivers for a provider type. Informational for the UI. */
export type ProviderTransport = 'novu' | 'novu-generic-sms' | 'bridge-adapter';

/** One credential input the operator must fill for a provider type. */
export interface CatalogCredentialField {
  key: string;
  /** English label as the bridge supplies it; used as the i18n default. */
  label: string;
  type: 'text' | 'password' | 'checkbox';
  required: boolean;
  placeholder?: string;
  help?: string;
}

/** One entry of `GET /providers/catalog`. */
export interface ProviderType {
  /** Stable catalog id, e.g. `twilio-sms`, `smtp`, `ozeki`. */
  type: string;
  label: string;
  channel: Channel;
  transport: ProviderTransport;
  novuProviderId: string;
  credentialFields: CatalogCredentialField[];
  supportsVerify: boolean;
  supportsTestSend: boolean;
}

/** A row of `GET /integrations` (never carries secrets). */
export interface IntegrationRow {
  _id?: string;
  id?: string;
  channel?: string;
  providerId?: string;
  name?: string;
  identifier?: string;
  /** Catalog type, or null on integrations created before the catalog existed. */
  type?: string | null;
  active?: boolean;
  primary?: boolean;
}

/** Display order for channel groupings — SMS first because it also carries login OTPs. */
export const CATALOG_CHANNEL_ORDER: Channel[] = ['SMS', 'WHATSAPP', 'EMAIL'];

/**
 * The Novu `channel` values novu-bridge can actually deliver a DIGIT event on.
 *
 * Novu hosts more channels than we use — every workspace ships with a built-in
 * "Novu Inbox" integration on `in_app`, and `push` / `chat` are available too.
 * None of them is a DIGIT delivery provider: there is no SMS/EMAIL/WHATSAPP
 * channel behind them, no credentials for an operator to rotate and nothing to
 * test-send through. WhatsApp is absent on purpose — Novu stores it as a Twilio
 * `sms` integration, which the identifier/name marker recovers (see rowChannel).
 */
export const DELIVERABLE_NOVU_CHANNELS = ['sms', 'email'];

// ---------------------------------------------------------------------------
// Offline fallback
// ---------------------------------------------------------------------------

/**
 * Used ONLY when `GET /providers/catalog` fails. It mirrors exactly what a
 * pre-catalog bridge accepted on `POST /providers` (Twilio for SMS/WhatsApp,
 * nodemailer for email) — SMSCountry and Ozeki are intentionally absent because
 * a bridge without the catalog endpoint cannot create them either. Creation from
 * a fallback entry uses the LEGACY request body (see createProviderBody).
 */
export const FALLBACK_CATALOG: ProviderType[] = [
  {
    type: 'twilio-sms',
    label: 'Twilio SMS',
    channel: 'SMS',
    transport: 'novu',
    novuProviderId: 'twilio',
    supportsVerify: true,
    supportsTestSend: true,
    credentialFields: [
      { key: 'accountSid', label: 'Account SID', type: 'text', required: true, placeholder: 'ACxxxxxxxx' },
      { key: 'token', label: 'Auth Token', type: 'password', required: true },
      { key: 'from', label: 'From', type: 'text', required: true, placeholder: '+15551234567' },
    ],
  },
  {
    type: 'twilio-whatsapp',
    label: 'Twilio WhatsApp',
    channel: 'WHATSAPP',
    transport: 'novu',
    novuProviderId: 'twilio',
    supportsVerify: true,
    supportsTestSend: true,
    credentialFields: [
      { key: 'accountSid', label: 'Account SID', type: 'text', required: true, placeholder: 'ACxxxxxxxx' },
      { key: 'token', label: 'Auth Token', type: 'password', required: true },
      { key: 'from', label: 'From', type: 'text', required: true, placeholder: 'whatsapp:+15551234567' },
    ],
  },
  {
    type: 'smtp',
    label: 'SMTP (email)',
    channel: 'EMAIL',
    transport: 'novu',
    novuProviderId: 'nodemailer',
    supportsVerify: true,
    supportsTestSend: true,
    credentialFields: [
      { key: 'host', label: 'SMTP Host', type: 'text', required: true, placeholder: 'smtp.example.com' },
      // Novu validates nodemailer `port` as a STRING — keep this a text input so it
      // serializes as "587" not 587 (a numeric port → 422 from Novu).
      { key: 'port', label: 'SMTP Port', type: 'text', required: true, placeholder: '587' },
      { key: 'user', label: 'SMTP User', type: 'text', required: true, placeholder: 'apikey / username' },
      { key: 'password', label: 'SMTP Password', type: 'password', required: true },
      { key: 'from', label: 'From', type: 'text', required: true, placeholder: 'noreply@example.com' },
      { key: 'secure', label: 'Use TLS (secure)', type: 'checkbox', required: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asChannel(value: unknown): Channel | null {
  const up = str(value).toUpperCase();
  return up === 'SMS' || up === 'EMAIL' || up === 'WHATSAPP' ? (up as Channel) : null;
}

function asFieldType(value: unknown): CatalogCredentialField['type'] {
  const v = str(value).toLowerCase();
  return v === 'password' || v === 'checkbox' ? v : 'text';
}

function asTransport(value: unknown): ProviderTransport {
  const v = str(value).toLowerCase();
  return v === 'novu-generic-sms' || v === 'bridge-adapter' ? v : 'novu';
}

/**
 * Coerce a raw `{"data":[...]}` catalog payload into well-formed ProviderTypes.
 * Entries without a `type` or without a recognised `channel` are dropped rather
 * than rendered as a broken row in the Add dialog.
 */
export function normalizeCatalog(raw: unknown): ProviderType[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown } | null)?.data)
      ? ((raw as { data: unknown[] }).data)
      : [];
  const out: ProviderType[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const type = str(entry.type);
    const channel = asChannel(entry.channel);
    if (!type || !channel) continue;
    const rawFields = Array.isArray(entry.credentialFields) ? entry.credentialFields : [];
    const credentialFields: CatalogCredentialField[] = [];
    for (const f of rawFields) {
      if (!f || typeof f !== 'object') continue;
      const field = f as Record<string, unknown>;
      const key = str(field.key);
      if (!key) continue;
      credentialFields.push({
        key,
        label: str(field.label) || key,
        type: asFieldType(field.type),
        required: field.required === true,
        placeholder: str(field.placeholder) || undefined,
        help: str(field.help) || undefined,
      });
    }
    out.push({
      type,
      label: str(entry.label) || type,
      channel,
      transport: asTransport(entry.transport),
      novuProviderId: str(entry.novuProviderId),
      credentialFields,
      // Absent flags are treated as "not supported" so the UI never offers an
      // action the bridge would reject.
      supportsVerify: entry.supportsVerify === true,
      supportsTestSend: entry.supportsTestSend === true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findProviderType(catalog: ProviderType[], type: unknown): ProviderType | undefined {
  const wanted = str(type).toLowerCase();
  if (!wanted) return undefined;
  return catalog.find((p) => p.type.toLowerCase() === wanted);
}

/** Catalog grouped by channel in CATALOG_CHANNEL_ORDER; empty groups are dropped. */
export function groupCatalogByChannel(
  catalog: ProviderType[],
): Array<{ channel: Channel; types: ProviderType[] }> {
  const groups: Array<{ channel: Channel; types: ProviderType[] }> = [];
  for (const channel of CATALOG_CHANNEL_ORDER) {
    const types = catalog.filter((p) => p.channel === channel);
    if (types.length > 0) groups.push({ channel, types });
  }
  return groups;
}

/**
 * Coarse channel for an integration row that carries NO catalog `type`. WhatsApp
 * is stored as a Twilio `sms` integration in Novu, so the create path marks
 * WhatsApp integrations in the identifier/name — the only round-trippable fields
 * (credentials are never echoed back). Derive WHATSAPP from that marker so the
 * row keeps its designation across refetches.
 *
 * `null` means "not a channel we deliver on": the row sits on a Novu channel
 * outside DELIVERABLE_NOVU_CHANNELS. This used to fall through to the SMS
 * default below, which is how Novu's built-in Inbox integration (`in_app`)
 * appeared as an SMS provider — in the table, in the SMS dropdown, and with a
 * full row of Verify / Test / Rotate / Delete buttons behind it.
 */
export function rowChannel(record: {
  channel?: unknown;
  identifier?: unknown;
  name?: unknown;
}): Channel | null {
  const channel = str(record.channel).toLowerCase();
  if (channel === 'email') return 'EMAIL';
  // An absent channel is a pre-Novu-projection row, not a foreign channel:
  // keep the historical SMS/WhatsApp reading for it rather than hiding it.
  if (channel && !DELIVERABLE_NOVU_CHANNELS.includes(channel)) return null;
  const marker = `${record.identifier ?? ''} ${record.name ?? ''}`;
  return /(^|[\s\-_])whatsapp/i.test(marker) ? 'WHATSAPP' : 'SMS';
}

/** Channel of an integration: the catalog type wins, the legacy marker is the fallback. */
export function integrationChannel(row: IntegrationRow, catalog: ProviderType[]): Channel | null {
  const pt = findProviderType(catalog, row.type);
  return pt ? pt.channel : rowChannel(row as Record<string, unknown>);
}

/**
 * Is this integration one this screen may list, offer and act on?
 *
 * The single rule behind "in_app is not an SMS provider": a row is deliverable
 * exactly when it resolves to a DIGIT channel. Used wherever integrations are
 * LISTED (the providers table and its count) or OFFERED (a channel's active
 * provider dropdown), so a Novu integration we cannot deliver through is never
 * presented as one that we can.
 */
export function isDeliverableIntegration(row: IntegrationRow, catalog: ProviderType[] = []): boolean {
  return integrationChannel(row, catalog) !== null;
}

/**
 * The value a NotificationChannel row's `provider` field holds for this
 * integration: its Novu `identifier`, falling back to the raw id for rows that
 * somehow have none.
 */
export function integrationKey(row: IntegrationRow): string {
  return str(row.identifier) || str(row._id) || str(row.id);
}

/** Every id a `provider` selection could legitimately have been written as. */
export function integrationAliases(row: IntegrationRow): string[] {
  return [str(row.identifier), str(row._id), str(row.id)].filter(Boolean);
}

/** Does `selection` (a NotificationChannel.provider value) point at this integration? */
export function matchesProviderSelection(row: IntegrationRow, selection: unknown): boolean {
  const wanted = str(selection).toLowerCase();
  if (!wanted) return false;
  return integrationAliases(row).some((a) => a.toLowerCase() === wanted);
}

/** Find the integration a `provider` selection refers to. */
export function findSelectedIntegration(
  integrations: IntegrationRow[],
  selection: unknown,
): IntegrationRow | undefined {
  return integrations.find((row) => matchesProviderSelection(row, selection));
}

/** Human label for a row: its name, else the type label, else the Novu providerId. */
export function integrationLabel(row: IntegrationRow, catalog: ProviderType[]): string {
  const name = str(row.name);
  if (name) return name;
  const pt = findProviderType(catalog, row.type);
  if (pt) return pt.label;
  return str(row.providerId) || integrationKey(row) || '—';
}

/**
 * The ACTIVE integrations that may be selected as a channel's provider: those
 * whose channel matches. WhatsApp therefore lists twilio-whatsapp rows only,
 * SMS lists twilio-sms / smscountry / ozeki, Email lists smtp. A row on a Novu
 * channel we do not deliver on is never offered for any channel.
 */
export function providerChoicesForChannel(
  integrations: IntegrationRow[],
  channel: Channel,
  catalog: ProviderType[],
): Array<{ value: string; label: string; typeLabel: string; row: IntegrationRow }> {
  return integrations
    .filter((row) =>
      row.active !== false &&
      isDeliverableIntegration(row, catalog) &&
      integrationChannel(row, catalog) === channel)
    .map((row) => {
      const pt = findProviderType(catalog, row.type);
      return {
        value: integrationKey(row),
        label: integrationLabel(row, catalog),
        typeLabel: pt?.label ?? str(row.providerId) ?? '',
        row,
      };
    })
    .filter((choice) => !!choice.value);
}

// ---------------------------------------------------------------------------
// Credential form helpers
// ---------------------------------------------------------------------------

export type CredentialValues = Record<string, string | boolean>;

/** i18n key for a credential label: `accountSid` -> `app.providers.cred.account_sid`. */
export function credLabelKey(key: string): string {
  const snake = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
  return `app.providers.cred.${snake}`;
}

/** i18n key for a provider-type label: `twilio-sms` -> `app.providers.type.twilio_sms`. */
export function providerTypeLabelKey(type: string): string {
  return `app.providers.type.${type.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase()}`;
}

/** Keys of required fields the operator has not filled in (checkboxes are never required-blank). */
export function missingRequiredFields(
  fields: CatalogCredentialField[],
  values: CredentialValues,
): string[] {
  return fields
    .filter((f) => f.required && f.type !== 'checkbox' && !String(values[f.key] ?? '').trim())
    .map((f) => f.key);
}

/**
 * Project the form state onto the credential object the bridge receives.
 * Checkboxes always ship (as booleans); blank optional text fields are omitted
 * so Novu keeps its own defaults instead of receiving empty strings.
 */
export function buildCredentials(
  fields: CatalogCredentialField[],
  values: CredentialValues,
): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.type === 'checkbox') credentials[f.key] = v === true;
    else if (String(v ?? '').trim()) credentials[f.key] = String(v).trim();
  }
  return credentials;
}

/** Slug used to mark a legacy WhatsApp integration in its identifier. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

export interface CreateProviderTypedBody {
  type: string;
  name: string;
  credentials: Record<string, unknown>;
  active?: boolean;
}

export interface CreateProviderLegacyBody {
  channel: Channel;
  providerId: string;
  name: string;
  identifier?: string;
  credentials: Record<string, unknown>;
}

/**
 * The `POST /providers` body for a chosen catalog entry.
 *
 * `legacy` is set when the catalog itself came from FALLBACK_CATALOG, i.e. the
 * bridge is old enough not to know the `type` body — then we send the original
 * {channel, providerId, name, identifier, credentials} shape. WhatsApp needs the
 * identifier marker in that mode, because a pre-catalog bridge stores it as a
 * plain Novu `sms` integration and rowChannel is the only way back.
 */
export function createProviderBody(
  providerType: ProviderType,
  name: string,
  credentials: Record<string, unknown>,
  options: { legacy?: boolean; active?: boolean } = {},
): CreateProviderTypedBody | CreateProviderLegacyBody {
  const trimmedName = name.trim();
  if (!options.legacy) {
    const body: CreateProviderTypedBody = { type: providerType.type, name: trimmedName, credentials };
    if (options.active !== undefined) body.active = options.active;
    return body;
  }
  const identifier =
    providerType.channel === 'WHATSAPP'
      ? `whatsapp-${slug(trimmedName) || providerType.type}`
      : undefined;
  return {
    channel: providerType.channel,
    providerId: providerType.novuProviderId || 'twilio',
    name: trimmedName,
    identifier,
    credentials,
  };
}
