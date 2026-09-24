// Pure, React-free static checker for notification configuration.
//
// Cross-validates the notification masters (NOTIFICATIONS.Routing,
// NOTIFICATIONS.Template, NOTIFICATIONS.ProviderTemplate, NOTIFICATIONS.Channel)
// against NOTIFICATIONS.EventCatalogue — the module's declaration of which
// events exist, which actors they carry and which placeholder tokens they fill.
// Hand-written (no ajv/zod/yup in this project by design).
//
// WHAT CHANGED WHEN THE EVENT CATALOGUE LANDED
//   This checker used to read the PGR workflow's state machine: an audience had
//   to be a role on some workflow action, and a routing row had to name a real
//   (action -> toState) transition, which meant resolving workflow-v2's state
//   UUIDs to applicationStatus names in the browser on every render. Exactly TWO
//   of the nineteen rules needed the state machine. Both now read the catalogue
//   instead, and the uuid resolution happens once, in the generator that emits
//   the catalogue rows — so no validation strength is lost and the checker works
//   for any module, not just PGR. Every other rule was already
//   vocabulary-shaped rather than workflow-shaped; those kept their ids, their
//   severities and their messages, with the key shortened from
//   (audience, action, toState, channel) to (audience, eventName, channel).
//
// Consumed by WorkflowServiceShow's "Validate notifications" button, by the
// Configure tab's Validate panel, and — through notificationSaveGuard.ts — by
// every save path that writes notification configuration. Kept pure and
// well-typed so it is unit-testable in isolation.

import {
  measureSms,
  SMS_SEGMENT_WARN_ABOVE,
  SMS_SINGLE_GSM7,
  SMS_CONCAT_GSM7,
  SMS_SINGLE_UCS2,
  SMS_CONCAT_UCS2,
} from '../notification-configure/smsSegments';
import {
  audienceKey,
  describeAudience,
  parseAudience,
  NON_NOTIFIABLE_AUDIENCES,
} from '../notification-configure/audienceScheme';
import {
  actorNames,
  catalogueIndex,
  eventChannels,
  placeholderNames,
  type EventCatalogueRow,
} from '../notification-configure/eventCatalogue';

/** A single flattened NOTIFICATIONS.Routing row. `x-unique` = [eventName, audience, channel]. */
export interface RoutingRow {
  /** Owning module — a required non-key column, for grouping and filtering. */
  module?: string;
  /** The catalogue event this row routes. Replaces (businessService, action, toState). */
  eventName?: string;
  /** An audience reference: `ACTOR:x`, `ROLE:x`, `EVENT_RECIPIENTS`, or a `|` chain. */
  audience?: string;
  channel?: string;
  active?: boolean | string;
}

/** A single NOTIFICATIONS.Template row. `x-unique` = [eventName, audience, channel, locale]. */
export interface TemplateRow {
  module?: string;
  eventName?: string;
  audience?: string;
  channel?: string;
  locale?: string;
  subject?: string;
  body?: string;
  /** Declared tokens this body uses (documentation; the Configure screen regenerates it). */
  placeholders?: string[];
  active?: boolean | string;
}

/** A NOTIFICATIONS.Channel row (per-tenant channel policy novu-bridge enforces). */
export interface ChannelRow {
  code?: string;
  enabled?: boolean | string;
  gateway?: string;
  /** Identifier of the Novu integration selected for this channel (one per channel). */
  provider?: string | null;
  active?: boolean | string;
}

/** A Novu integration as the Providers screen lists it (never carries secrets). */
export interface IntegrationRow {
  _id?: string;
  id?: string;
  identifier?: string;
  name?: string;
  active?: boolean;
}

/** A NOTIFICATIONS.ProviderTemplate row. `x-unique` = [provider, channel, eventName, audience, locale]. */
export interface ProviderTemplateRow {
  provider?: string;
  channel?: string;
  eventName?: string;
  audience?: string;
  locale?: string;
  templateId?: string;
  templateName?: string;
  /** ORDERED placeholder names the provider template expects; the box turns
   *  these into Twilio positional contentVariables {"1":…,"2":…}. */
  variables?: string[];
  approvalStatus?: string;
  active?: boolean | string;
}

/**
 * The single-brace `{token}` shape the renderer substitutes. Anything else — a
 * double brace, an unclosed brace, a stray `}`, spaces or punctuation inside —
 * is NOT substituted and ships to the recipient literally.
 */
export const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

export interface PlaceholderScan {
  /** Tokens the renderer will substitute, first-appearance order, deduplicated.
   *  Produced with PLACEHOLDER_PATTERN so this list is EXACTLY what the backend
   *  replaces — including the `{id}` hiding inside a `{{id}}`. */
  tokens: string[];
  /** Brace sequences that are not a well-formed single-brace token, in order,
   *  deduplicated. Reported by the `placeholder-braces` rule. */
  malformed: string[];
}

/** Tokens in `text`, first-appearance order — mirrors the renderer exactly. */
export function placeholderTokens(text: unknown): string[] {
  const out: string[] = [];
  // Fresh regex per call: PLACEHOLDER_PATTERN is /g and shared, and a stray
  // lastIndex would silently skip the first token.
  for (const m of String(text ?? '').matchAll(new RegExp(PLACEHOLDER_PATTERN.source, 'g'))) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Scan a body/subject for placeholder braces. Pure.
 *
 * Single brace is the convention (`{id}`): that is what the renderer fills.
 * Everything else is reported as malformed — most importantly `{{id}}`, the
 * Handlebars/Novu shape operators paste in by habit. That one is NOT harmless:
 * the renderer's own regex still matches the inner `{id}`, so the recipient gets
 * the value wrapped in a pair of stray braces (`{PGR-2026-…}`).
 */
export function scanPlaceholders(text: unknown): PlaceholderScan {
  const s = String(text ?? '');
  const malformed: string[] = [];
  const add = (v: string) => { if (!malformed.includes(v)) malformed.push(v); };

  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{') {
      if (s[i + 1] === '{') { add('{{'); i += 2; continue; }
      const close = s.indexOf('}', i + 1);
      if (close === -1) { add(s.slice(i, Math.min(i + 12, s.length))); break; }
      const inner = s.slice(i + 1, close);
      if (!/^[a-zA-Z0-9_]+$/.test(inner)) add(`{${inner}}`);
      if (s[close + 1] === '}') { add('}}'); i = close + 2; continue; }
      i = close + 1;
      continue;
    }
    if (ch === '}') { add('}'); i += 1; continue; }
    i += 1;
  }
  return { tokens: placeholderTokens(s), malformed };
}

export interface ValidateNotificationsInput {
  /**
   * The event vocabulary: NOTIFICATIONS.EventCatalogue rows. On a tenant still
   * on the legacy masters the screens pass a catalogue derived from those rows
   * (legacyAdapter.catalogueFromLegacyRows), so this is never undefined —
   * passing an empty catalogue means "no event exists", and every routing row
   * is then reported by `transition-exists`.
   */
  catalogue: EventCatalogueRow[];
  routingRows: RoutingRow[];
  templateRows: TemplateRow[];
  /** Role codes from the access-roles resource — the vocabulary for `ROLE:` terms. */
  roleCodes: string[];
  /** Channel policy rows; omit to skip the channel-enabled family (e.g. master not seeded). */
  channelRows?: ChannelRow[];
  /** Provider-template rows; omit to skip the whatsapp-needs-template rule. */
  providerTemplateRows?: ProviderTemplateRow[];
  /** Novu integrations; omit to skip the channel-provider-missing / -inactive rules. */
  integrationRows?: IntegrationRow[];
}

export interface ValidationFinding {
  level: 'error' | 'warn';
  rule: string;
  message: string;
  /** Optional short reference to the offending row/key. */
  ref?: string;
}

/** The provider whose WhatsApp templates the box resolves (hard-coded there). */
export const PROVIDER_TEMPLATE_PROVIDER = 'twilio';

/**
 * Every rule this checker can emit, with the severity it emits at and a one-line
 * description. The operator doc (docs/2.20/notifications/setup-guide.md, §5.4)
 * is written from this table, and a unit test asserts no rule escapes it — so a
 * new rule cannot ship undocumented.
 *
 * `level: 'error | warn'` means the severity depends on blast radius; the rule's
 * own comment explains when.
 *
 * A rule that stops making sense is RETIRED here — `status: 'retired'` with a
 * reason — and never silently deleted. An operator who reads a finding id in an
 * old ticket, a doc or a CI log must be able to find out what happened to it,
 * and a test asserts a retired rule is never emitted.
 */
export const NOTIFICATION_RULES: ReadonlyArray<{
  id: string;
  level: 'error' | 'warn' | 'error | warn';
  /** Which form field the finding belongs next to, when it maps to one. */
  field?: 'audience' | 'channel' | 'locale' | 'subject' | 'body' | 'variables' | 'provider' | 'enabled' | 'eventName' | 'gateway';
  summary: string;
  /** Absent means active. */
  status?: 'retired';
  /** Required when status is 'retired'. */
  retiredReason?: string;
}> = [
  { id: 'audience-role-exists', level: 'error', field: 'audience', summary: 'The audience names an actor the event does not declare, or a role code that does not exist, so nobody is ever resolved.' },
  { id: 'audience-scheme', level: 'error', field: 'audience', summary: 'The audience uses a scheme the box has no resolver for; the event is recorded SKIPPED / NB_UNKNOWN_AUDIENCE_SCHEME.' },
  { id: 'routing-has-template', level: 'error', summary: 'An active routing row has no active en_IN template, so there is nothing to send.' },
  { id: 'channel-allowed', level: 'error', field: 'channel', summary: 'The channel is not one of SMS, WHATSAPP, EMAIL.' },
  { id: 'channel-in-event', level: 'warn', field: 'channel', summary: 'The routing row uses a channel the event\'s catalogue row does not declare.' },
  { id: 'transition-exists', level: 'error', field: 'eventName', summary: 'The row names an event with no active row in the event catalogue.' },
  { id: 'no-orphan-template', level: 'warn', summary: 'A template exists for a key no active routing row uses; it will never be rendered.' },
  { id: 'non-notifiable-audience', level: 'warn', field: 'audience', summary: 'AUTO_ESCALATE / SYSTEM are workflow actors, not people; a routing row on them never sends.' },
  { id: 'channel-enabled', level: 'warn', field: 'channel', summary: 'Routing rows exist on a channel with no policy row, or one that is switched off.' },
  { id: 'channel-gateway-mismatch', level: 'error', field: 'gateway', summary: 'The row points at a legacy direct gateway that does not carry its channel (smscountry is SMS only).' },
  { id: 'channel-needs-provider', level: 'error | warn', field: 'provider', summary: 'An enabled channel has no provider selected, so it falls back to deployment-wide settings. Error when routing rows use the channel.' },
  { id: 'channel-provider-missing', level: 'error | warn', field: 'provider', summary: 'The selected provider no longer exists. Error when routing rows use the channel.' },
  { id: 'channel-provider-inactive', level: 'error | warn', field: 'provider', summary: 'The selected provider exists but is disabled. Error when routing rows use the channel.' },
  { id: 'unknown-token', level: 'warn', field: 'body', summary: 'The body uses a {token} the event does not declare; the braces ship literally.' },
  { id: 'placeholder-braces', level: 'error', field: 'body', summary: 'Malformed placeholder braces ({{id}}, an unclosed {, a stray }) that will not be substituted.' },
  { id: 'template-needs-body', level: 'error', field: 'body', summary: 'An active template has an empty body, so the recipient is skipped with nothing sent.' },
  { id: 'email-needs-subject', level: 'warn', field: 'subject', summary: 'An EMAIL template has no subject; the box substitutes a default one.' },
  { id: 'email-subject-length', level: 'warn', field: 'subject', summary: 'An EMAIL subject longer than 150 characters is truncated by most mail clients.' },
  { id: 'sms-length', level: 'warn', field: 'body', summary: 'An SMS body is estimated to cost more than 3 segments (each segment is billed separately).' },
  { id: 'whatsapp-needs-template', level: 'warn', summary: 'An active WHATSAPP routing row has no approved provider template; every event is skipped.' },
  { id: 'whatsapp-variable-unmapped', level: 'error', field: 'body', summary: 'The WhatsApp body uses a placeholder the provider template does not declare, so that value never reaches the recipient.' },
  { id: 'whatsapp-variable-unfilled', level: 'warn', field: 'variables', summary: 'The provider template declares a variable the event cannot fill; it is sent as an empty string.' },
];

/** Rule ids that must never be emitted again. Asserted by the unit tests. */
export const RETIRED_RULES: ReadonlySet<string> = new Set(
  NOTIFICATION_RULES.filter((r) => r.status === 'retired').map((r) => r.id),
);

/** Warn above this many characters in an EMAIL subject. */
export const EMAIL_SUBJECT_MAX = 150;

const ALLOWED_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'];
const DEFAULT_LOCALE = 'en_IN';

/**
 * The legacy DIRECT gateways and the channels each one can carry. These bypass
 * the notification service and post straight to a vendor API, so the transport
 * itself fixes the channel: SMSCountry is a bulk SMS API and has no notion of
 * email or WhatsApp. `novu` is absent because it is not direct — it delivers
 * whatever the channel's selected provider delivers.
 */
export const DIRECT_GATEWAY_CHANNELS: Record<string, string[]> = {
  SMSCOUNTRY: ['SMS'],
};

/** Case-insensitive, whitespace-trimmed normalisation. Nullish -> ''. */
function norm(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/** `active` is a boolean widget but may arrive as a string; default true. */
function isActive(value: boolean | string | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  const n = norm(value);
  return n !== 'FALSE' && n !== '0' && n !== 'NO';
}

/**
 * The `ref` a finding carries: `AUDIENCE · EVENT · CHANNEL`.
 *
 * The audience is the CANONICAL chain (`ACTOR:CITIZEN`), not the raw value, so a
 * tenant part-way through the copy does not produce two different refs for the
 * same row — the save guard matches findings to a pending change on this string.
 */
function rowRef(audience: unknown, eventName: unknown, channel: unknown): string {
  return `${audienceKey(audience)} · ${norm(eventName)} · ${norm(channel)}`;
}

function routingKey(r: RoutingRow): string {
  return rowRef(r.audience, r.eventName, r.channel);
}

function templateKey(t: TemplateRow): string {
  return rowRef(t.audience, t.eventName, t.channel);
}

/** Match key shared by routing, template and provider-template rows. */
function matchKey(audience: unknown, eventName: unknown, channel: unknown): string {
  return `${audienceKey(audience)}|${norm(eventName)}|${norm(channel)}`;
}

/**
 * The approved WhatsApp provider template the box would resolve for a template
 * row. Mirrors the runtime resolution order exactly:
 *   - provider "twilio", channel WHATSAPP, active, approvalStatus "approved",
 *     non-empty templateId, all matched case-insensitively;
 *   - the same (eventName, audience), with the audience compared as a canonical
 *     chain so a legacy `CITIZEN` row and an `ACTOR:citizen` row still match;
 *   - the row's own locale first, then the default locale;
 *   - FIRST match wins (the backend returns on the first hit).
 */
export function resolveProviderTemplate(
  rows: ProviderTemplateRow[] | undefined,
  t: Pick<TemplateRow, 'audience' | 'eventName' | 'locale'>,
  defaultLocale: string,
): ProviderTemplateRow | undefined {
  const forLocale = (locale: string) =>
    (rows ?? []).find((p) =>
      isActive(p.active) &&
      norm(p.approvalStatus) === 'APPROVED' &&
      norm(p.provider) === norm(PROVIDER_TEMPLATE_PROVIDER) &&
      norm(p.channel) === 'WHATSAPP' &&
      audienceKey(p.audience) === audienceKey(t.audience) &&
      norm(p.eventName) === norm(t.eventName) &&
      norm(p.locale) === norm(locale) &&
      String(p.templateId ?? '').trim() !== '',
    );
  const own = forLocale(String(t.locale ?? ''));
  if (own) return own;
  if (norm(t.locale) === norm(defaultLocale)) return undefined;
  return forLocale(defaultLocale);
}

/**
 * Run all rules over the loaded config. Pure — no side effects, no React.
 * Returns findings in rule order; empty array means all clean.
 */
export function validateNotifications({
  catalogue,
  routingRows,
  templateRows,
  roleCodes,
  channelRows,
  providerTemplateRows,
  integrationRows,
}: ValidateNotificationsInput): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  // R7: channel-enabled (warn). A routing row on a channel that is off (or has no policy
  // row) will be recorded SKIPPED/NB_NO_PROVIDER by novu-bridge — say so here, once per channel.
  if (channelRows) {
    const policyByCode = new Map<string, ChannelRow>();
    for (const c of channelRows) if (isActive(c.active)) policyByCode.set(norm(c.code), c);
    const flagged = new Set<string>();
    for (const r of routingRows ?? []) {
      if (!isActive(r.active)) continue;
      const channel = norm(r.channel);
      if (!ALLOWED_CHANNELS.includes(channel) || flagged.has(channel)) continue;
      const policy = policyByCode.get(channel);
      if (!policy) {
        flagged.add(channel);
        findings.push({
          level: 'warn',
          rule: 'channel-enabled',
          message: `Channel ${channel} has no channel-policy row for this tenant — novu-bridge will use its env fallback (usually off). Enable it under Notifications → Channels.`,
          ref: channel,
        });
      } else if (!isActive(policy.enabled)) {
        flagged.add(channel);
        findings.push({
          level: 'warn',
          rule: 'channel-enabled',
          message: `Channel ${channel} is disabled in the channel policy; every routing row on it will be SKIPPED / NB_NO_PROVIDER.`,
          ref: channel,
        });
      }
    }
  }

  // R7a: channel-gateway-mismatch (error). A direct gateway carries the channels its
  // vendor API carries, and nothing else — `smscountry` is a bulk SMS endpoint, so an
  // EMAIL or WHATSAPP row pointing at it can never deliver a single message. Unlike the
  // rules below this one does not wait for the channel to be switched on: the row is
  // wrong as written, and the save guard has to refuse it at the moment it is typed.
  if (channelRows) {
    for (const c of channelRows) {
      if (!isActive(c.active)) continue;
      const channel = norm(c.code);
      const gateway = norm(c.gateway);
      const carries = DIRECT_GATEWAY_CHANNELS[gateway];
      if (!carries || carries.includes(channel)) continue;
      findings.push({
        level: 'error',
        rule: 'channel-gateway-mismatch',
        message: `Channel ${channel || '(none)'} uses gateway "${c.gateway ?? ''}", which carries ${carries.join(', ')} only. Leave the gateway as novu and select a ${channel || 'channel'} provider instead.`,
        ref: channel,
      });
    }
  }

  // R7b: the provider-selection half of the channel-enabled family. Exactly ONE provider
  // is active per channel per tenant, named by the channel policy's `provider` (the Novu
  // integration's identifier). An enabled channel with no selection, or one pointing at a
  // provider that has been deleted or disabled, cannot deliver. Severity follows blast
  // radius: an ERROR when routing rows actually use the channel, a WARNING otherwise.
  //
  // Rows on a legacy direct gateway (e.g. smscountry) bypass Novu entirely and take no
  // provider, so they are exempt.
  if (channelRows) {
    const usedChannels = new Set<string>();
    for (const r of routingRows ?? []) {
      if (!isActive(r.active)) continue;
      const channel = norm(r.channel);
      if (ALLOWED_CHANNELS.includes(channel)) usedChannels.add(channel);
    }
    const integrationsKnown = Array.isArray(integrationRows);
    for (const c of channelRows) {
      const channel = norm(c.code);
      if (!ALLOWED_CHANNELS.includes(channel)) continue;
      if (!isActive(c.active) || !isActive(c.enabled)) continue;
      const gateway = norm(c.gateway) || 'NOVU';
      if (gateway !== 'NOVU') continue;
      const level: ValidationFinding['level'] = usedChannels.has(channel) ? 'error' : 'warn';
      const provider = String(c.provider ?? '').trim();
      // A BROKEN selection is fatal: novu-bridge targets exactly that integration.
      // An ABSENT selection is not fatal today — the bridge falls back to the
      // deployment-wide env settings — but the tenant's delivery is then not
      // actually configured here, which is what this rule is for.
      // A broken SELECTION is recorded NB_PROVIDER_UNAVAILABLE by the bridge (it refuses to
      // trigger an integration Novu cannot deliver through), not NB_NO_PROVIDER, which is
      // what a disabled channel gets.
      const suffix = usedChannels.has(channel)
        ? `every routing row on ${channel} will be SKIPPED / NB_PROVIDER_UNAVAILABLE`
        : `nothing routes on ${channel} yet, but it will not deliver once something does`;

      if (!provider) {
        findings.push({
          level,
          rule: 'channel-needs-provider',
          message: `Channel ${channel} is enabled but no provider is selected for it, so delivery falls back to the deployment's environment settings instead of this tenant's own configuration. Pick a provider under Notifications → Channels.`,
          ref: channel,
        });
        continue;
      }
      if (!integrationsKnown) continue;
      const match = (integrationRows ?? []).find((i) =>
        [i.identifier, i._id, i.id]
          .map((v) => String(v ?? '').trim().toLowerCase())
          .some((v) => !!v && v === provider.toLowerCase()),
      );
      if (!match) {
        findings.push({
          level,
          rule: 'channel-provider-missing',
          message: `Channel ${channel} selects provider "${provider}", which no longer exists; ${suffix}. Select another provider for this channel.`,
          ref: channel,
        });
      } else if (match.active === false) {
        findings.push({
          level,
          rule: 'channel-provider-inactive',
          message: `Channel ${channel} selects provider "${match.name || provider}", which is disabled; ${suffix}. Enable that provider or select another.`,
          ref: channel,
        });
      }
    }
  }

  // Role codes an audience may name in a `ROLE:` term. The workflow is no longer
  // consulted for this: an audience is a role in the TENANT, not a role that
  // happens to act on some transition, and the catalogue owns the actor half.
  const validRoles = new Set<string>();
  for (const code of roleCodes ?? []) validRoles.add(norm(code));

  // The event vocabulary. One string matched against one column — this is what
  // replaced walking the state machine and resolving state uuids in the browser.
  const events = catalogueIndex(catalogue);

  // Index active templates by (audience, eventName, channel) — locale collapsed
  // to "has any active template for this key" plus a default-locale set so
  // routing-has-template can prefer en_IN.
  const templateDefaultLocale = new Set<string>();
  const templateAnyLocale = new Set<string>();
  for (const t of templateRows ?? []) {
    if (!isActive(t.active)) continue;
    const key = matchKey(t.audience, t.eventName, t.channel);
    templateAnyLocale.add(key);
    if (norm(t.locale) === norm(DEFAULT_LOCALE)) templateDefaultLocale.add(key);
  }

  // Index active routing rows by the same key for the orphan-template check.
  const routingKeys = new Set<string>();
  for (const r of routingRows ?? []) {
    if (!isActive(r.active)) continue;
    routingKeys.add(matchKey(r.audience, r.eventName, r.channel));
  }

  for (const r of routingRows ?? []) {
    const audience = parseAudience(r.audience);
    const channel = norm(r.channel);
    const ref = routingKey(r);
    const event = events.get(norm(r.eventName));

    // R3: channel-allowed (error).
    if (!ALLOWED_CHANNELS.includes(channel)) {
      findings.push({
        level: 'error',
        rule: 'channel-allowed',
        message: `Routing channel "${r.channel ?? ''}" is not one of ${ALLOWED_CHANNELS.join(', ')}.`,
        ref,
      });
    }

    // R6: non-notifiable-audience (warn).
    if (audience.nonNotifiable) {
      findings.push({
        level: 'warn',
        rule: 'non-notifiable-audience',
        message: `Routing audience "${r.audience ?? ''}" is non-notifiable and will never send.`,
        ref,
      });
    }

    // R1b: audience-scheme (error). An audience whose scheme has no resolver is
    // NOT guessed at runtime — the event is recorded SKIPPED with
    // NB_UNKNOWN_AUDIENCE_SCHEME — so refuse it here rather than let an operator
    // discover it in the logs.
    if (!audience.empty && !audience.nonNotifiable && !audience.wellFormed) {
      findings.push({
        level: 'error',
        rule: 'audience-scheme',
        message: `Routing audience "${r.audience ?? ''}" is not a form the box can resolve (${audience.malformed.join(', ')}). Use ACTOR:<name> for an actor the event carries, ROLE:<code> for every holder of a role, EVENT_RECIPIENTS for contacts sent on the event, or a "first non-empty wins" chain such as ACTOR:assignee|ROLE:GRO.`,
        ref,
      });
    }

    // R1: audience-role-exists (error). Per TERM, because a chain can be half
    // right: `ACTOR:assignee|ROLE:TYPO` resolves for most events and silently
    // narrows for the rest.
    if (!audience.nonNotifiable) {
      for (const t of audience.terms) {
        if (t.scheme === 'ACTOR') {
          if (!event) continue;   // transition-exists already reports the real problem
          const actors = actorNames(event);
          if (!actors.some((a) => norm(a) === norm(t.value))) {
            findings.push({
              level: 'error',
              rule: 'audience-role-exists',
              message: `Routing audience "${r.audience ?? ''}" names actor "${t.value}", which event ${r.eventName ?? ''} does not declare (it declares: ${actors.join(', ') || 'no actors'}). Nobody is ever resolved for it.`,
              ref,
            });
          }
        } else if (t.scheme === 'ROLE') {
          if (!validRoles.has(norm(t.value))) {
            findings.push({
              level: 'error',
              rule: 'audience-role-exists',
              message: `Routing audience "${r.audience ?? ''}" names role "${t.value}", which is not a known role code (not in access-roles).`,
              ref,
            });
          }
        }
      }
    }

    // R4: transition-exists (error). Formerly "is this a real workflow
    // transition"; now "is this an active catalogue row". Same guarantee for
    // PGR — its catalogue rows are generated from that very workflow — and it
    // works for a module whose workflow this browser has never seen.
    // Only for active rows: an inactive row sends nothing, and flagging it would
    // make the save guard refuse the very deactivation that retires a stale row.
    if (!event) {
      if (isActive(r.active)) {
        findings.push({
          level: 'error',
          rule: 'transition-exists',
          message: `Routing row names event "${r.eventName ?? ''}", which has no active row in the event catalogue. Nothing will ever match it.`,
          ref,
        });
      }
    } else {
      // R4b: channel-in-event (warn). A module may declare EMAIL-only events.
      const allowed = eventChannels(event);
      if (allowed && ALLOWED_CHANNELS.includes(channel) && !allowed.some((c) => norm(c) === channel)) {
        findings.push({
          level: 'warn',
          rule: 'channel-in-event',
          message: `Event ${r.eventName ?? ''} declares channels ${allowed.join(', ')}, and this row routes it on ${channel}. Either the catalogue row or the routing row is wrong.`,
          ref,
        });
      }
    }

    // R2: routing-has-template (error). Only for active routing rows.
    if (isActive(r.active)) {
      const key = matchKey(r.audience, r.eventName, r.channel);
      if (!templateDefaultLocale.has(key)) {
        const hasOtherLocale = templateAnyLocale.has(key);
        findings.push({
          level: 'error',
          rule: 'routing-has-template',
          message: hasOtherLocale
            ? `No active ${DEFAULT_LOCALE} template for ${ref} (template exists in another locale only).`
            : `No active template for ${ref}.`,
          ref,
        });
      }
    }
  }

  // Per-active-template content rules (message STRUCTURE):
  //   unknown-token        (warn)
  //   email-needs-subject  (warn)
  //   placeholder-braces   (error)
  //   template-needs-body  (error)
  //   sms-length           (warn)
  //   email-subject-length (warn)
  for (const t of templateRows ?? []) {
    if (!isActive(t.active)) continue;
    const ref = templateKey(t);
    const channel = norm(t.channel);
    const body = String(t.body ?? '');
    const subject = String(t.subject ?? '');
    const scan = scanPlaceholders(body);
    const event = events.get(norm(t.eventName));

    // template-needs-body (error). The renderer returns null for a blank body and
    // the box then skips the recipient — an active row that can never send
    // anything. Applies to every channel, which covers the EMAIL case.
    if (!body.trim()) {
      findings.push({
        level: 'error',
        rule: 'template-needs-body',
        message: `Template ${ref} is active but its body is empty; the renderer produces nothing and every recipient is skipped. Write a body or deactivate the row.`,
        ref,
      });
    }

    // placeholder-braces (error). Single brace is the convention. A `{{id}}`
    // still matches the renderer's own regex on the INNER `{id}`, so the
    // recipient gets the value wrapped in stray braces — not a cosmetic problem.
    const malformed = [...scan.malformed, ...scanPlaceholders(subject).malformed.filter((m) => !scan.malformed.includes(m))];
    if (malformed.length > 0) {
      findings.push({
        level: 'error',
        rule: 'placeholder-braces',
        message: `Template ${ref} has malformed placeholder braces: ${malformed.join(', ')}. Use a single brace around a token name, e.g. {id} — not {{id}}, not an unclosed {.`,
        ref,
      });
    }

    // unknown-token (warn). The vocabulary is THIS EVENT's declared placeholders,
    // not one global list: a module fills the tokens it fills. When the event is
    // not in the catalogue we say nothing here — transition-exists already
    // reports the cause, and flagging every token as unknown would bury it.
    if (event) {
      const vocab = placeholderNames(event);
      const known = new Set(vocab.map((v) => v));
      const unknown = scan.tokens.filter((tok) => !known.has(tok));
      if (unknown.length > 0) {
        findings.push({
          level: 'warn',
          rule: 'unknown-token',
          message: `Template ${ref} uses {${unknown.join('}, {')}}, which event ${t.eventName ?? ''} does not declare — the braces will ship literally. Declared tokens: ${vocab.join(', ') || 'none'}.`,
          ref,
        });
      }
    }

    // sms-length (warn). Estimate only — see smsSegments.ts for the method.
    if (channel === 'SMS' && body.trim()) {
      const m = measureSms(body);
      if (m.segments > SMS_SEGMENT_WARN_ABOVE) {
        const why = m.encoding === 'UCS-2'
          ? `"${m.forcedUcs2By}" is not in the GSM-7 alphabet, so the whole message is sent as UCS-2 (${SMS_SINGLE_UCS2} characters in one part, ${SMS_CONCAT_UCS2} per part after that)`
          : `GSM-7 fits ${SMS_SINGLE_GSM7} characters in one part and ${SMS_CONCAT_GSM7} per part after that`;
        findings.push({
          level: 'warn',
          rule: 'sms-length',
          message: `SMS template ${ref} is estimated at ${m.segments} segments (${m.units} units: ${m.authoredUnits} written + ${m.allowance} allowed for ${m.placeholders} placeholder value${m.placeholders === 1 ? '' : 's'}) — every segment is billed separately. ${why}. Shorten the body or drop a placeholder.`,
          ref,
        });
      }
    }

    // email-needs-subject (warn) + email-subject-length (warn).
    if (channel === 'EMAIL') {
      if (!subject.trim()) {
        findings.push({
          level: 'warn',
          rule: 'email-needs-subject',
          message: `EMAIL template ${ref} has no subject; the producing module's default subject is used instead.`,
          ref,
        });
      } else if (subject.length > EMAIL_SUBJECT_MAX) {
        findings.push({
          level: 'warn',
          rule: 'email-subject-length',
          message: `EMAIL subject for ${ref} is ${subject.length} characters; most mail clients cut the preview around ${EMAIL_SUBJECT_MAX}. Move the detail into the body.`,
          ref,
        });
      }
    }
  }

  // whatsapp-variable-unmapped (error) + whatsapp-variable-unfilled (warn).
  //
  // WhatsApp never sends our body text. The box resolves an APPROVED provider
  // template (resolveProviderTemplate) and sends its Content SID plus POSITIONAL
  // contentVariables built from that row's ORDERED `variables` array (position
  // i+1 -> placeholderValues[variables[i]], missing value -> ""). So the only
  // values that reach the recipient are the ones the provider template declares.
  // A body placeholder that is not declared is silently dropped, which is exactly
  // the "message structure" mismatch this rule exists for.
  //
  // Locale resolution mirrors the runtime: the template's own locale first, then
  // the default locale.
  if (providerTemplateRows) {
    for (const t of templateRows ?? []) {
      if (!isActive(t.active) || norm(t.channel) !== 'WHATSAPP') continue;
      const pt = resolveProviderTemplate(providerTemplateRows, t, DEFAULT_LOCALE);
      if (!pt) continue;   // whatsapp-needs-template already reports the missing-template case
      const ref = templateKey(t);
      const event = events.get(norm(t.eventName));
      const vocab = placeholderNames(event);
      const declared = Array.isArray(pt.variables) ? pt.variables.map((v) => String(v ?? '')) : null;
      const bodyTokens = placeholderTokens(t.body);
      const unmapped = declared === null
        ? bodyTokens
        : bodyTokens.filter((tok) => !declared.some((d) => d === tok));
      if (unmapped.length > 0) {
        findings.push({
          level: 'error',
          rule: 'whatsapp-variable-unmapped',
          message: declared === null
            ? `WhatsApp provider template ${pt.templateId ?? ''} for ${ref} declares no variables, so none of {${unmapped.join('}, {')}} reaches the recipient — WhatsApp sends the approved provider template, not this body. Add the ordered variables to the provider template row.`
            : `WhatsApp body ${ref} uses {${unmapped.join('}, {')}}, which provider template ${pt.templateId ?? ''} does not declare (it declares: ${declared.join(', ') || 'nothing'}). Those values are never sent — WhatsApp renders the approved provider template from its declared variables only.`,
          ref,
        });
      }
      // Only meaningful when the event's vocabulary is known; an uncatalogued
      // event is reported by transition-exists instead.
      if (event) {
        const unfilled = (declared ?? []).filter((d) => !vocab.includes(d));
        if (unfilled.length > 0) {
          findings.push({
            level: 'warn',
            rule: 'whatsapp-variable-unfilled',
            message: `WhatsApp provider template ${pt.templateId ?? ''} for ${ref} declares ${unfilled.join(', ')}, which event ${t.eventName ?? ''} does not fill; those positions are sent as an empty string. Declared tokens: ${vocab.join(', ') || 'none'}.`,
            ref,
          });
        }
      }
    }
  }

  // whatsapp-needs-template (warn). WhatsApp is template-only at the provider: an active
  // WHATSAPP routing row with no approved provider template for its key (default
  // locale) is recorded SKIPPED / NB_TEMPLATE_NOT_APPROVED on every event.
  if (providerTemplateRows) {
    const approved = new Set<string>();
    for (const p of providerTemplateRows) {
      if (!isActive(p.active) || norm(p.approvalStatus) !== 'APPROVED' || norm(p.channel) !== 'WHATSAPP') continue;
      approved.add(`${audienceKey(p.audience)}|${norm(p.eventName)}|${norm(p.locale)}`);
    }
    for (const r of routingRows ?? []) {
      if (!isActive(r.active) || norm(r.channel) !== 'WHATSAPP') continue;
      const key = `${audienceKey(r.audience)}|${norm(r.eventName)}|${norm(DEFAULT_LOCALE)}`;
      if (!approved.has(key)) {
        findings.push({
          level: 'warn',
          rule: 'whatsapp-needs-template',
          message: `WHATSAPP routing ${routingKey(r)} has no approved provider template (${DEFAULT_LOCALE}); every event will be SKIPPED / NB_TEMPLATE_NOT_APPROVED. Use Providers → Sync WhatsApp templates.`,
          ref: routingKey(r),
        });
      }
    }
  }

  // no-orphan-template (warn). Every active template should have a matching
  // active routing row.
  for (const t of templateRows ?? []) {
    if (!isActive(t.active)) continue;
    const key = matchKey(t.audience, t.eventName, t.channel);
    if (!routingKeys.has(key)) {
      findings.push({
        level: 'warn',
        rule: 'no-orphan-template',
        message: `Template ${templateKey(t)} has no matching active routing row (orphan).`,
        ref: templateKey(t),
      });
    }
  }

  return findings;
}

/** Re-exported so callers that only import the checker still see the audience vocabulary. */
export { NON_NOTIFIABLE_AUDIENCES, describeAudience };
