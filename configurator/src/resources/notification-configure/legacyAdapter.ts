// Adapter-on-read for a tenant still on the legacy `RAINMAKER-PGR.Notification*`
// masters — the browser half of the day-one safety net (design §5.2 case (i)).
//
// A live server runs the current code with real data in the PGR-namespaced
// masters, and MDMS migrations do not run on deployed boxes: the only vehicle
// for the copy is the deploy-time seed step. Until that has run, the screens
// must NOT show an empty configuration (an operator would "fix" it by writing a
// second, parallel set of rows) and must NOT write to the legacy masters
// either. So they read the legacy rows, adapt them to the new vocabulary here,
// and show them READ-ONLY with a banner. Nothing in this file writes.
//
// The mapping is exactly the one the box performs, so what the screen shows is
// what the runtime resolves:
//
//   businessService + action + toState  ->  eventName COMPLAINTS.WORKFLOW.<ACTION>.<TOSTATE>
//   audience (bare) + assigneeOnly      ->  an audience chain (audienceScheme.ts)
//   fromState                           ->  dropped (it is documentation-only)
//
// THIS FILE IS DATED. It is deleted, together with PLACEHOLDER_VOCABULARY and
// the legacy read-only screens, two releases after the copy ships.

import {
  type EventCatalogueRow,
  isActiveRow,
} from './eventCatalogue';
import { parseAudience, LEGACY_ASSIGNEE_ACTOR, LEGACY_CITIZEN_ACTOR } from './audienceScheme';
import type {
  ProviderTemplateRow,
  RoutingRow,
  TemplateRow,
} from '../workflow-services/validateNotifications';

/** The module PGR's events belong to (the thin event's `module`). */
export const LEGACY_MODULE = 'Complaints';

/** Every PGR workflow transition becomes `COMPLAINTS.WORKFLOW.<ACTION>.<TOSTATE>`. */
export const LEGACY_EVENT_PREFIX = 'COMPLAINTS.WORKFLOW.';

/**
 * Placeholder tokens pgr-services fills today
 * (`NotificationService.buildPlaceholderValues`). This is the FALLBACK
 * vocabulary for a tenant whose catalogue has not been seeded yet; once the
 * catalogue is in place the vocabulary is per event and comes from there.
 * Keep it in parity with the Java side by hand; it is deleted with the rest
 * of this file.
 */
export const PLACEHOLDER_VOCABULARY = [
  'id', 'complaint_type', 'status', 'date', 'additional_comments', 'rating', 'citizen_name',
  'download_link', 'ulb', 'ao_designation', 'emp_name', 'emp_department', 'emp_designation',
] as const;

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

/** The BusinessService (workflow) record, trimmed to what the generator needs. */
export interface BusinessServiceRecord {
  businessService?: string;
  states?: WorkflowState[];
}

/** One legacy `RAINMAKER-PGR.NotificationRouting` row. */
export interface LegacyRoutingRow {
  businessService?: string;
  fromState?: string;
  action?: string;
  toState?: string;
  audience?: string;
  channel?: string;
  assigneeOnly?: boolean;
  active?: boolean | string;
  id?: string;
  _uniqueIdentifier?: string;
}

/** One legacy `RAINMAKER-PGR.NotificationTemplate` row. */
export interface LegacyTemplateRow {
  audience?: string;
  action?: string;
  toState?: string;
  channel?: string;
  locale?: string;
  subject?: string | null;
  body?: string;
  placeholders?: string[];
  active?: boolean | string;
  id?: string;
  _uniqueIdentifier?: string;
}

/** One legacy `RAINMAKER-PGR.NotificationProviderTemplate` row. */
export interface LegacyProviderTemplateRow {
  provider?: string;
  channel?: string;
  audience?: string;
  action?: string;
  toState?: string;
  locale?: string;
  templateId?: string;
  templateName?: string;
  variables?: string[];
  approvalStatus?: string;
  active?: boolean | string;
  id?: string;
  _uniqueIdentifier?: string;
}

const trim = (v: unknown) => String(v ?? '').trim();
const up = (v: unknown) => trim(v).toUpperCase();

/**
 * The event key a legacy (action, toState) pair maps to.
 *
 * `businessService` is deliberately NOT part of it: the column had exactly one
 * value ever (`"PGR"`), and the prefix subsumes it.
 */
export function legacyEventName(action: unknown, toState: unknown): string {
  const a = up(action);
  const s = up(toState);
  if (!a && !s) return '';
  return `${LEGACY_EVENT_PREFIX}${a}.${s}`;
}

/** The audience chain a legacy `(audience, assigneeOnly)` pair means. */
export function legacyAudience(audience: unknown, assigneeOnly?: boolean): string {
  const ref = parseAudience(audience, { assigneeOnly: assigneeOnly === true });
  if (ref.empty || ref.nonNotifiable) return trim(audience);
  // The chain, as the box would read it — written out so the screen shows the
  // same string the validator and (after the copy) the new master will carry.
  return ref.terms.map((t) => t.raw).join('|');
}

/** Adapt legacy routing rows. `fromState` is dropped; `assigneeOnly` becomes a chain. */
export function adaptLegacyRouting(rows: LegacyRoutingRow[] | undefined): Array<RoutingRow & { id?: string; _uniqueIdentifier?: string }> {
  return (rows ?? []).map((r) => ({
    module: LEGACY_MODULE,
    eventName: legacyEventName(r.action, r.toState),
    audience: legacyAudience(r.audience, r.assigneeOnly),
    channel: trim(r.channel),
    active: r.active,
    id: r.id,
    _uniqueIdentifier: r._uniqueIdentifier,
  }));
}

/** Adapt legacy template rows. */
export function adaptLegacyTemplate(rows: LegacyTemplateRow[] | undefined): Array<TemplateRow & { id?: string; _uniqueIdentifier?: string }> {
  return (rows ?? []).map((t) => ({
    module: LEGACY_MODULE,
    eventName: legacyEventName(t.action, t.toState),
    audience: legacyAudience(t.audience),
    channel: trim(t.channel),
    locale: trim(t.locale),
    subject: t.subject ?? undefined,
    body: t.body,
    placeholders: t.placeholders,
    active: t.active,
    id: t.id,
    _uniqueIdentifier: t._uniqueIdentifier,
  }));
}

/** Adapt legacy provider-template rows. */
export function adaptLegacyProviderTemplate(rows: LegacyProviderTemplateRow[] | undefined): Array<ProviderTemplateRow & { id?: string; _uniqueIdentifier?: string }> {
  return (rows ?? []).map((p) => ({
    provider: trim(p.provider),
    channel: trim(p.channel),
    eventName: legacyEventName(p.action, p.toState),
    audience: legacyAudience(p.audience),
    locale: trim(p.locale),
    templateId: p.templateId,
    templateName: p.templateName,
    variables: p.variables,
    approvalStatus: p.approvalStatus,
    active: p.active,
    id: p.id,
    _uniqueIdentifier: p._uniqueIdentifier,
  }));
}

/**
 * The catalogue a PGR workflow definition produces — the SAME derivation the
 * seed-time generator performs (design §6.2), including the bit the browser
 * used to redo on every render: workflow-v2's `action.nextState` is the target
 * state's UUID while a routing row's `toState` is its applicationStatus, so the
 * uuid is resolved here, once.
 *
 * The screens do not call this — they read the catalogue master. It exists so
 * the shipped PGR seeds can be validated against the workflow we ship them
 * with, and so the derivation has one tested implementation on this side.
 */
export function catalogueFromWorkflow(
  businessService: BusinessServiceRecord | undefined,
  opts: { module?: string; placeholders?: readonly string[]; channels?: string[] } = {},
): EventCatalogueRow[] {
  const module = opts.module ?? LEGACY_MODULE;
  const placeholders = (opts.placeholders ?? PLACEHOLDER_VOCABULARY).map((name) => ({ name }));
  const states = businessService?.states ?? [];

  const statusByUuid = new Map<string, string>();
  for (const s of states) {
    if (s.uuid) statusByUuid.set(s.uuid, trim(s.applicationStatus ?? s.state));
  }
  const resolve = (nextState?: string) => (nextState && statusByUuid.get(nextState)) || trim(nextState);

  const out: EventCatalogueRow[] = [];
  const seen = new Set<string>();
  for (const state of states) {
    for (const action of state.actions ?? []) {
      const toState = resolve(action.nextState);
      const eventName = legacyEventName(action.action, toState);
      if (!eventName || seen.has(eventName)) continue;
      seen.add(eventName);
      out.push({
        module,
        eventName,
        entityType: 'COMPLAINT',
        label: `${up(action.action)} → ${toState}`,
        actors: [
          { name: LEGACY_CITIZEN_ACTOR, label: 'The citizen who filed the complaint', required: true },
          { name: LEGACY_ASSIGNEE_ACTOR, label: 'The employee the complaint is assigned to' },
        ],
        placeholders,
        channels: opts.channels,
        active: true,
      });
    }
  }
  return out;
}

/**
 * A catalogue derived from the legacy rows THEMSELVES, for a tenant that has
 * not been copied yet.
 *
 * It deliberately does not read the workflow: the notification screens are
 * module-neutral now, and a screen that still needed the PGR workflow record
 * would not be. The cost is that `transition-exists` cannot fail on a legacy
 * tenant (every event exists because it was derived from the rows) — which is
 * correct, because those rows are read-only there: the operator cannot author a
 * transition that does not exist, and the deployed pgr-services keeps
 * validating the real state machine.
 */
export function catalogueFromLegacyRows(
  routingRows: LegacyRoutingRow[] | undefined,
  templateRows: LegacyTemplateRow[] | undefined,
  providerTemplateRows?: LegacyProviderTemplateRow[] | undefined,
): EventCatalogueRow[] {
  const byEvent = new Map<string, { action: string; toState: string; channels: Set<string> }>();
  const add = (action: unknown, toState: unknown, channel: unknown, active: boolean | string | undefined) => {
    if (!isActiveRow(active)) return;
    const eventName = legacyEventName(action, toState);
    if (!eventName) return;
    const entry = byEvent.get(eventName) ?? { action: up(action), toState: up(toState), channels: new Set<string>() };
    const ch = up(channel);
    if (ch) entry.channels.add(ch);
    byEvent.set(eventName, entry);
  };
  for (const r of routingRows ?? []) add(r.action, r.toState, r.channel, r.active);
  for (const t of templateRows ?? []) add(t.action, t.toState, t.channel, t.active);
  for (const p of providerTemplateRows ?? []) add(p.action, p.toState, p.channel, p.active);

  return Array.from(byEvent.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([eventName, entry]) => ({
      module: LEGACY_MODULE,
      eventName,
      entityType: 'COMPLAINT',
      label: `${entry.action} → ${entry.toState}`,
      actors: [
        { name: LEGACY_CITIZEN_ACTOR, label: 'The citizen who filed the complaint', required: true },
        { name: LEGACY_ASSIGNEE_ACTOR, label: 'The employee the complaint is assigned to' },
      ],
      placeholders: PLACEHOLDER_VOCABULARY.map((name) => ({ name })),
      channels: Array.from(entry.channels),
      active: true,
    }));
}
