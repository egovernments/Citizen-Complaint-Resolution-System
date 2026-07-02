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

export interface ValidateNotificationsInput {
  businessService: BusinessServiceRecord;
  routingRows: RoutingRow[];
  templateRows: TemplateRow[];
  /** Role codes from the access-roles resource. */
  roleCodes: string[];
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
}: ValidateNotificationsInput): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

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

    // R1: audience-role-exists (error). Skip CITIZEN (the filer) and the
    // non-notifiable pseudo-audiences (already flagged by R6).
    if (audience && audience !== CITIZEN && !NON_NOTIFIABLE_AUDIENCES.includes(audience)) {
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
