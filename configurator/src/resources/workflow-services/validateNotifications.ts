// Pure, React-free static checker for PGR notification configuration.
//
// Cross-validates the two MDMS masters (RAINMAKER-PGR.NotificationRouting and
// RAINMAKER-PGR.NotificationTemplate) against the workflow BusinessService's
// state machine. Hand-written (no ajv/zod/yup in this project by design).
//
// Consumed by WorkflowServiceShow's "Validate notifications" button, by the
// Configure tab's Validate panel, and — through notificationSaveGuard.ts — by
// every save path that writes notification configuration. Kept pure and
// well-typed so it is unit-testable in isolation and so the SEED data we ship
// can be run through it in CI (defaultSeeds.test.ts).

import {
  measureSms,
  SMS_SEGMENT_WARN_ABOVE,
  SMS_SINGLE_GSM7,
  SMS_CONCAT_GSM7,
  SMS_SINGLE_UCS2,
  SMS_CONCAT_UCS2,
} from '../notification-configure/smsSegments';

/** A single flattened NotificationRouting row (see notification-routing.ts). */
export interface RoutingRow {
  businessService?: string;
  fromState?: string;
  action?: string;
  toState?: string;
  audience?: string;
  channel?: string;
  assigneeOnly?: boolean;
  active?: boolean | string;
}

/** A single NotificationTemplate row (see notification-template.ts). */
export interface TemplateRow {
  audience?: string;
  action?: string;
  toState?: string;
  channel?: string;
  locale?: string;
  subject?: string;
  body?: string;
  active?: boolean | string;
}

/** A workflow action within a state (subset of the BusinessService shape). */
export interface WorkflowAction {
  action?: string;
  nextState?: string;
  roles?: string[];
}

/** A workflow state within the BusinessService (subset of the shape). */
export interface WorkflowState {
  state?: string;
  uuid?: string;
  applicationStatus?: string;
  actions?: WorkflowAction[];
}

/** The BusinessService (workflow) record, trimmed to what the checker needs. */
export interface BusinessServiceRecord {
  businessService?: string;
  states?: WorkflowState[];
}

/** A RAINMAKER-PGR.NotificationChannel row (per-tenant channel policy novu-bridge enforces). */
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

/** A RAINMAKER-PGR.NotificationProviderTemplate row (approved provider template per routing key). */
export interface ProviderTemplateRow {
  provider?: string;
  channel?: string;
  audience?: string;
  action?: string;
  toState?: string;
  locale?: string;
  templateId?: string;
  templateName?: string;
  /** ORDERED placeholder names the provider template expects; pgr-services turns
   *  these into Twilio positional contentVariables {"1":…,"2":…}. */
  variables?: string[];
  approvalStatus?: string;
  active?: boolean | string;
}

/** Placeholder tokens pgr-services fills (NotificationService.buildPlaceholderValues). Anything
 *  else in a body ships literally. Keep in sync with the Java side. */
export const PLACEHOLDER_VOCABULARY = [
  'id', 'complaint_type', 'status', 'date', 'additional_comments', 'rating', 'citizen_name',
  'download_link', 'ulb', 'ao_designation', 'emp_name', 'emp_department', 'emp_designation',
] as const;

/**
 * The single-brace `{token}` shape pgr-services substitutes. Anything else — a
 * double brace, an unclosed brace, a stray `}`, spaces or punctuation inside —
 * is NOT substituted and ships to the recipient literally.
 */
export const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

export interface PlaceholderScan {
  /** Tokens pgr-services will substitute, first-appearance order, deduplicated.
   *  Produced with PLACEHOLDER_PATTERN so this list is EXACTLY what the backend
   *  replaces — including the `{id}` hiding inside a `{{id}}`. */
  tokens: string[];
  /** Brace sequences that are not a well-formed single-brace token, in order,
   *  deduplicated. Reported by the `placeholder-braces` rule. */
  malformed: string[];
}

/** Tokens in `text`, first-appearance order — mirrors pgr-services exactly. */
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
 * Single brace is the convention (`{id}`): that is what
 * NotificationService.buildPlaceholderValues fills. Everything else is reported
 * as malformed — most importantly `{{id}}`, the Handlebars/Novu shape operators
 * paste in by habit. That one is NOT harmless: pgr-services' own regex still
 * matches the inner `{id}`, so the recipient gets the value wrapped in a pair of
 * stray braces (`{PGR-2026-…}`).
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
  businessService: BusinessServiceRecord;
  routingRows: RoutingRow[];
  templateRows: TemplateRow[];
  /** Role codes from the access-roles resource. */
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

/** The provider whose WhatsApp templates pgr-services resolves (hard-coded there). */
export const PROVIDER_TEMPLATE_PROVIDER = 'twilio';

/**
 * Every rule this checker can emit, with the severity it emits at and a one-line
 * description. The operator doc (docs/2.12/notifications/message-templates.md)
 * is written from this table, and a unit test asserts no rule escapes it — so a
 * new rule cannot ship undocumented.
 *
 * `level: 'error | warn'` means the severity depends on blast radius; the rule's
 * own comment explains when.
 */
export const NOTIFICATION_RULES: ReadonlyArray<{
  id: string;
  level: 'error' | 'warn' | 'error | warn';
  /** Which form field the finding belongs next to, when it maps to one. */
  field?: 'audience' | 'channel' | 'locale' | 'subject' | 'body' | 'variables' | 'provider' | 'enabled';
  summary: string;
}> = [
  { id: 'audience-role-exists', level: 'error', field: 'audience', summary: 'The routing audience is not CITIZEN, not EMPLOYEE and not a known role code, so nobody is ever resolved.' },
  { id: 'routing-has-template', level: 'error', summary: 'An active routing row has no active en_IN NotificationTemplate, so there is nothing to send.' },
  { id: 'channel-allowed', level: 'error', field: 'channel', summary: 'The channel is not one of SMS, WHATSAPP, EMAIL.' },
  { id: 'transition-exists', level: 'error', summary: 'The routing row names an action -> toState pair the workflow cannot produce.' },
  { id: 'no-orphan-template', level: 'warn', summary: 'A template exists for a key no active routing row uses; it will never be rendered.' },
  { id: 'non-notifiable-audience', level: 'warn', field: 'audience', summary: 'AUTO_ESCALATE / SYSTEM are workflow actors, not people; a routing row on them never sends.' },
  { id: 'channel-enabled', level: 'warn', field: 'channel', summary: 'Routing rows exist on a channel with no policy row, or one that is switched off.' },
  { id: 'channel-needs-provider', level: 'error | warn', field: 'provider', summary: 'An enabled channel has no provider selected, so it falls back to deployment-wide settings. Error when routing rows use the channel.' },
  { id: 'channel-provider-missing', level: 'error | warn', field: 'provider', summary: 'The selected provider no longer exists. Error when routing rows use the channel.' },
  { id: 'channel-provider-inactive', level: 'error | warn', field: 'provider', summary: 'The selected provider exists but is disabled. Error when routing rows use the channel.' },
  { id: 'unknown-token', level: 'warn', field: 'body', summary: 'The body uses a {token} pgr-services does not fill; the braces ship literally.' },
  { id: 'placeholder-braces', level: 'error', field: 'body', summary: 'Malformed placeholder braces ({{id}}, an unclosed {, a stray }) that will not be substituted.' },
  { id: 'template-needs-body', level: 'error', field: 'body', summary: 'An active template has an empty body, so the recipient is skipped with nothing sent.' },
  { id: 'email-needs-subject', level: 'warn', field: 'subject', summary: 'An EMAIL template has no subject; pgr-services substitutes "Complaint <id>".' },
  { id: 'email-subject-length', level: 'warn', field: 'subject', summary: 'An EMAIL subject longer than 150 characters is truncated by most mail clients.' },
  { id: 'sms-length', level: 'warn', field: 'body', summary: 'An SMS body is estimated to cost more than 3 segments (each segment is billed separately).' },
  { id: 'whatsapp-needs-template', level: 'warn', summary: 'An active WHATSAPP routing row has no approved provider template; every event is skipped.' },
  { id: 'whatsapp-variable-unmapped', level: 'error', field: 'body', summary: 'The WhatsApp body uses a placeholder the provider template does not declare, so that value never reaches the recipient.' },
  { id: 'whatsapp-variable-unfilled', level: 'warn', field: 'variables', summary: 'The provider template declares a variable pgr-services cannot fill; it is sent as an empty string.' },
];

/** Warn above this many characters in an EMAIL subject. */
export const EMAIL_SUBJECT_MAX = 150;

const ALLOWED_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'];
const NON_NOTIFIABLE_AUDIENCES = ['AUTO_ESCALATE', 'SYSTEM'];
const CITIZEN = 'CITIZEN';
// Backend pseudo-audience (PGRConstants.AUDIENCE_EMPLOYEE): resolves to the
// complaint's assignee, not the pool of users holding an "EMPLOYEE" role. It is a
// valid routing audience even when "EMPLOYEE" is absent from the role registry, so
// R1 must not flag it as an unknown role code.
const EMPLOYEE = 'EMPLOYEE';
const DEFAULT_LOCALE = 'en_IN';

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

function routingKey(r: RoutingRow): string {
  return `${r.audience ?? ''} · ${r.action ?? ''} -> ${r.toState ?? ''} · ${r.channel ?? ''}`;
}

function templateKey(t: TemplateRow): string {
  return `${t.audience ?? ''} · ${t.action ?? ''} -> ${t.toState ?? ''} · ${t.channel ?? ''}`;
}

/**
 * The approved WhatsApp provider template pgr-services would resolve for a
 * template row. Mirrors NotificationService.resolveProviderTemplate +
 * providerTemplateFor exactly:
 *   - provider "twilio", channel WHATSAPP, active, approvalStatus "approved",
 *     non-empty templateId, all matched case-insensitively;
 *   - the row's own locale first, then the default locale;
 *   - FIRST match wins (the backend returns on the first hit).
 */
export function resolveProviderTemplate(
  rows: ProviderTemplateRow[] | undefined,
  t: Pick<TemplateRow, 'audience' | 'action' | 'toState' | 'locale'>,
  defaultLocale: string,
): ProviderTemplateRow | undefined {
  const forLocale = (locale: string) =>
    (rows ?? []).find((p) =>
      isActive(p.active) &&
      norm(p.approvalStatus) === 'APPROVED' &&
      norm(p.provider) === norm(PROVIDER_TEMPLATE_PROVIDER) &&
      norm(p.channel) === 'WHATSAPP' &&
      norm(p.audience) === norm(t.audience) &&
      norm(p.action) === norm(t.action) &&
      norm(p.toState) === norm(t.toState) &&
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
 * Returns findings in rule order (R1..R6); empty array means all clean.
 */
export function validateNotifications({
  businessService,
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
          message: `Channel ${channel} has no NotificationChannel row for this tenant — novu-bridge will use its env fallback (usually off). Enable it under Notifications → Channels.`,
          ref: channel,
        });
      } else if (!isActive(policy.enabled)) {
        flagged.add(channel);
        findings.push({
          level: 'warn',
          rule: 'channel-enabled',
          message: `Channel ${channel} is disabled in NotificationChannel; every routing row on it will be SKIPPED / NB_NO_PROVIDER.`,
          ref: channel,
        });
      }
    }
  }

  // R7b: the provider-selection half of the channel-enabled family. Exactly ONE provider
  // is active per channel per tenant, named by NotificationChannel.provider (the Novu
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

  // Set of valid role codes: access-roles codes + every role referenced on a
  // workflow action. Normalised for case-insensitive comparison.
  const validRoles = new Set<string>();
  for (const code of roleCodes ?? []) validRoles.add(norm(code));
  const states = businessService?.states ?? [];
  for (const state of states) {
    for (const action of state.actions ?? []) {
      for (const role of action.roles ?? []) validRoles.add(norm(role));
    }
  }

  // workflow-v2's action.nextState is the target state's UUID; routing.toState
  // is the applicationStatus NAME. Resolve UUID -> name so the transition set is
  // keyed by applicationStatus (matching how routing rows store toState).
  const statusByStateUuid = new Map<string, string>();
  for (const state of states) {
    if (state.uuid) statusByStateUuid.set(state.uuid, state.applicationStatus ?? state.state ?? '');
  }
  const resolveState = (ns?: string): string => (ns && statusByStateUuid.get(ns)) || ns || '';

  // Set of real workflow transitions, keyed by `ACTION|APPLICATIONSTATUS`.
  const transitions = new Set<string>();
  for (const state of states) {
    for (const action of state.actions ?? []) {
      transitions.add(`${norm(action.action)}|${norm(resolveState(action.nextState))}`);
    }
  }

  // Index active templates by (audience, action, toState, channel) — locale
  // collapsed to "has any active template for this key" plus a default-locale
  // set so R2 can prefer en_IN.
  const templateDefaultLocale = new Set<string>();
  const templateAnyLocale = new Set<string>();
  for (const t of templateRows ?? []) {
    if (!isActive(t.active)) continue;
    const key = `${norm(t.audience)}|${norm(t.action)}|${norm(t.toState)}|${norm(t.channel)}`;
    templateAnyLocale.add(key);
    if (norm(t.locale) === norm(DEFAULT_LOCALE)) templateDefaultLocale.add(key);
  }

  // Index active routing rows by the same key for R5 orphan-template check.
  const routingKeys = new Set<string>();
  for (const r of routingRows ?? []) {
    if (!isActive(r.active)) continue;
    routingKeys.add(`${norm(r.audience)}|${norm(r.action)}|${norm(r.toState)}|${norm(r.channel)}`);
  }

  for (const r of routingRows ?? []) {
    const audience = norm(r.audience);
    const channel = norm(r.channel);
    const ref = routingKey(r);

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
    if (NON_NOTIFIABLE_AUDIENCES.includes(audience)) {
      findings.push({
        level: 'warn',
        rule: 'non-notifiable-audience',
        message: `Routing audience "${r.audience ?? ''}" is non-notifiable and will never send.`,
        ref,
      });
    }

    // R1: audience-role-exists (error). Skip CITIZEN (the filer), the assignee
    // pseudo-audience EMPLOYEE (resolved by the backend, not a role code), and the
    // non-notifiable pseudo-audiences (already flagged by R6).
    if (audience && audience !== CITIZEN && audience !== EMPLOYEE && !NON_NOTIFIABLE_AUDIENCES.includes(audience)) {
      if (!validRoles.has(audience)) {
        findings.push({
          level: 'error',
          rule: 'audience-role-exists',
          message: `Routing audience "${r.audience ?? ''}" is not a known role code (not on any workflow action, not in access-roles).`,
          ref,
        });
      }
    }

    // R4: transition-exists (error).
    const transitionKey = `${norm(r.action)}|${norm(r.toState)}`;
    if (!transitions.has(transitionKey)) {
      findings.push({
        level: 'error',
        rule: 'transition-exists',
        message: `Routing transition ${r.action ?? ''} -> ${r.toState ?? ''} is not a real workflow transition.`,
        ref,
      });
    }

    // R2: routing-has-template (error). Only for active routing rows.
    if (isActive(r.active)) {
      const key = `${audience}|${norm(r.action)}|${norm(r.toState)}|${channel}`;
      if (!templateDefaultLocale.has(key)) {
        const hasOtherLocale = templateAnyLocale.has(key);
        findings.push({
          level: 'error',
          rule: 'routing-has-template',
          message: hasOtherLocale
            ? `No active ${DEFAULT_LOCALE} NotificationTemplate for ${ref} (template exists in another locale only).`
            : `No active NotificationTemplate for ${ref}.`,
          ref,
        });
      }
    }
  }

  // Per-active-template content rules (message STRUCTURE):
  //   R8  unknown-token           (warn)
  //   R9  email-needs-subject     (warn)
  //   R11 placeholder-braces      (error)
  //   R12 template-needs-body     (error)
  //   R13 sms-length              (warn)
  //   R14 email-subject-length    (warn)
  const vocab = new Set<string>(PLACEHOLDER_VOCABULARY);
  for (const t of templateRows ?? []) {
    if (!isActive(t.active)) continue;
    const ref = templateKey(t);
    const channel = norm(t.channel);
    const body = String(t.body ?? '');
    const subject = String(t.subject ?? '');
    const scan = scanPlaceholders(body);

    // R12: template-needs-body (error). templateRenderer.render returns null for a
    // blank body and pgr-services then skips the recipient — an active row that can
    // never send anything. Applies to every channel, which covers the EMAIL case.
    if (!body.trim()) {
      findings.push({
        level: 'error',
        rule: 'template-needs-body',
        message: `Template ${ref} is active but its body is empty; pgr-services renders nothing and skips every recipient. Write a body or deactivate the row.`,
        ref,
      });
    }

    // R11: placeholder-braces (error). Single brace is the convention. A `{{id}}`
    // still matches pgr-services' own regex on the INNER `{id}`, so the recipient
    // gets the value wrapped in stray braces — not a cosmetic problem.
    const malformed = [...scan.malformed, ...scanPlaceholders(subject).malformed.filter((m) => !scan.malformed.includes(m))];
    if (malformed.length > 0) {
      findings.push({
        level: 'error',
        rule: 'placeholder-braces',
        message: `Template ${ref} has malformed placeholder braces: ${malformed.join(', ')}. Use a single brace around a token name, e.g. {id} — not {{id}}, not an unclosed {.`,
        ref,
      });
    }

    // R8: unknown-token (warn).
    const unknown = scan.tokens.filter((tok) => !vocab.has(tok));
    if (unknown.length > 0) {
      findings.push({
        level: 'warn',
        rule: 'unknown-token',
        message: `Template ${ref} uses {${unknown.join('}, {')}} which pgr-services does not fill — the braces will ship literally. Known tokens: ${PLACEHOLDER_VOCABULARY.join(', ')}.`,
        ref,
      });
    }

    // R13: sms-length (warn). Estimate only — see smsSegments.ts for the method.
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

    // R9: email-needs-subject (warn) + R14: email-subject-length (warn).
    if (channel === 'EMAIL') {
      if (!subject.trim()) {
        findings.push({
          level: 'warn',
          rule: 'email-needs-subject',
          message: `EMAIL template ${ref} has no subject; pgr-services will send "Complaint <id>" instead.`,
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

  // R15: whatsapp-variable-unmapped (error) + R16: whatsapp-variable-unfilled (warn).
  //
  // WhatsApp never sends our body text. pgr-services resolves an APPROVED provider
  // template (resolveProviderTemplate) and sends its Content SID plus POSITIONAL
  // contentVariables built from that row's ORDERED `variables` array
  // (buildContentVariables: position i+1 -> placeholderValues[variables[i]], missing
  // value -> ""). So the only values that reach the recipient are the ones the
  // provider template declares. A body placeholder that is not declared is silently
  // dropped, which is exactly the "message structure" mismatch this rule exists for.
  //
  // Locale resolution mirrors providerTemplateFor: the template's own locale first,
  // then the default locale.
  if (providerTemplateRows) {
    for (const t of templateRows ?? []) {
      if (!isActive(t.active) || norm(t.channel) !== 'WHATSAPP') continue;
      const pt = resolveProviderTemplate(providerTemplateRows, t, DEFAULT_LOCALE);
      if (!pt) continue;   // R10 already reports the missing-template case
      const ref = templateKey(t);
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
      const unfilled = (declared ?? []).filter((d) => !vocab.has(d));
      if (unfilled.length > 0) {
        findings.push({
          level: 'warn',
          rule: 'whatsapp-variable-unfilled',
          message: `WhatsApp provider template ${pt.templateId ?? ''} for ${ref} declares ${unfilled.join(', ')}, which pgr-services cannot fill; those positions are sent as an empty string. Known tokens: ${PLACEHOLDER_VOCABULARY.join(', ')}.`,
          ref,
        });
      }
    }
  }

  // R10: whatsapp-needs-template (warn). WhatsApp is template-only at the provider: an active
  // WHATSAPP routing row with no approved NotificationProviderTemplate for its key (default
  // locale) is recorded SKIPPED / NB_TEMPLATE_NOT_APPROVED on every event.
  if (providerTemplateRows) {
    const approved = new Set<string>();
    for (const p of providerTemplateRows) {
      if (!isActive(p.active) || norm(p.approvalStatus) !== 'APPROVED' || norm(p.channel) !== 'WHATSAPP') continue;
      approved.add(`${norm(p.audience)}|${norm(p.action)}|${norm(p.toState)}|${norm(p.locale)}`);
    }
    for (const r of routingRows ?? []) {
      if (!isActive(r.active) || norm(r.channel) !== 'WHATSAPP') continue;
      const key = `${norm(r.audience)}|${norm(r.action)}|${norm(r.toState)}|${norm(DEFAULT_LOCALE)}`;
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

  // R5: no-orphan-template (warn). Every active template should have a matching
  // active routing row.
  for (const t of templateRows ?? []) {
    if (!isActive(t.active)) continue;
    const key = `${norm(t.audience)}|${norm(t.action)}|${norm(t.toState)}|${norm(t.channel)}`;
    if (!routingKeys.has(key)) {
      findings.push({
        level: 'warn',
        rule: 'no-orphan-template',
        message: `NotificationTemplate ${templateKey(t)} has no matching active routing row (orphan).`,
        ref: templateKey(t),
      });
    }
  }

  return findings;
}
