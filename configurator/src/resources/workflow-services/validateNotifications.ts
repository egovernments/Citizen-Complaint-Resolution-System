// Pure, React-free static checker for PGR notification configuration.
//
// Cross-validates the two MDMS masters (RAINMAKER-PGR.NotificationRouting and
// RAINMAKER-PGR.NotificationTemplate) against the workflow BusinessService's
// state machine. Hand-written (no ajv/zod/yup in this project by design).
//
// Consumed by WorkflowServiceShow's "Validate notifications" button. Kept pure
// and well-typed so it is unit-testable in isolation.

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
  approvalStatus?: string;
  active?: boolean | string;
}

/** Placeholder tokens pgr-services fills (NotificationService.buildPlaceholderValues). Anything
 *  else in a body ships literally. Keep in sync with the Java side. */
export const PLACEHOLDER_VOCABULARY = [
  'id', 'complaint_type', 'status', 'date', 'additional_comments', 'rating', 'citizen_name',
  'download_link', 'ulb', 'ao_designation', 'emp_name', 'emp_department', 'emp_designation',
] as const;

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

  // R8: unknown-token (warn) + R9: email-needs-subject (warn), per active template.
  const vocab = new Set<string>(PLACEHOLDER_VOCABULARY);
  for (const t of templateRows ?? []) {
    if (!isActive(t.active)) continue;
    const unknown: string[] = [];
    for (const m of String(t.body ?? '').matchAll(/\{([a-zA-Z0-9_]+)\}/g)) if (!vocab.has(m[1]) && !unknown.includes(m[1])) unknown.push(m[1]);
    if (unknown.length > 0) {
      findings.push({
        level: 'warn',
        rule: 'unknown-token',
        message: `Template ${templateKey(t)} uses {${unknown.join('}, {')}} which pgr-services does not fill — the braces will ship literally. Known tokens: ${PLACEHOLDER_VOCABULARY.join(', ')}.`,
        ref: templateKey(t),
      });
    }
    if (norm(t.channel) === 'EMAIL' && !String(t.subject ?? '').trim()) {
      findings.push({
        level: 'warn',
        rule: 'email-needs-subject',
        message: `EMAIL template ${templateKey(t)} has no subject; pgr-services will send "Complaint <id>" instead.`,
        ref: templateKey(t),
      });
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
