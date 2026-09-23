// "Validate on update": run the SAME checker over the state a save would
// produce, and decide what may block the save.
//
// Pure and React-free (no ra-core, no MDMS): the hook that wires this into the
// forms is in useNotificationGuard.ts, and everything decidable lives here so it
// can be unit-tested without the app graph.
//
// THE RULE ABOUT BLOCKING
//   A configurator screen shows ONE row at a time, but the checker is
//   whole-config. If any error anywhere blocked every save, an operator could
//   never dig a tenant out of a broken state — the first repair would be
//   refused because the second row is still wrong. So a save is blocked only by
//   an error that
//     (a) sits on a row this change touches, or
//     (b) did not exist before this change.
//   Everything else — warnings, and pre-existing errors on untouched rows —
//   is shown as advisory and lets the save through.

import {
  validateNotifications,
  NOTIFICATION_RULES,
  type ChannelRow,
  type IntegrationRow,
  type ProviderTemplateRow,
  type RoutingRow,
  type TemplateRow,
  type ValidationFinding,
} from '../workflow-services/validateNotifications';
import { audienceKey } from './audienceScheme';
import type { EventCatalogueRow } from './eventCatalogue';

/**
 * The four writable MDMS masters that make up notification configuration, in
 * the shared `NOTIFICATIONS.*` namespace.
 *
 * The legacy `RAINMAKER-PGR.Notification*` resources are deliberately NOT here:
 * they are read-only in this release (see notificationSource.ts), so there is no
 * save path to guard. `NOTIFICATIONS.EventCatalogue` is not here either — a
 * module owns its own events and the Configurator does not author them.
 */
export type NotificationResource =
  | 'notifications-routing'
  | 'notifications-template'
  | 'notifications-channel'
  | 'notifications-provider-template';

export const NOTIFICATION_RESOURCES: NotificationResource[] = [
  'notifications-routing',
  'notifications-template',
  'notifications-channel',
  'notifications-provider-template',
];

/** True when `resource` is one of the notification masters this guard covers. */
export function isNotificationResource(resource: string | undefined): resource is NotificationResource {
  return !!resource && (NOTIFICATION_RESOURCES as string[]).includes(resource);
}

/** Everything the checker needs, as the screens have it loaded. */
export interface NotificationSnapshot {
  /** NOTIFICATIONS.EventCatalogue rows (or the legacy-derived stand-in). */
  catalogue: EventCatalogueRow[];
  routingRows: RoutingRow[];
  templateRows: TemplateRow[];
  roleCodes: string[];
  channelRows?: ChannelRow[];
  providerTemplateRows?: ProviderTemplateRow[];
  integrationRows?: IntegrationRow[];
}

export interface PendingChange {
  resource: NotificationResource;
  /** `upsert` covers create and edit; `remove` covers delete and deactivate. */
  op: 'upsert' | 'remove';
  /** The row as it would be written (for `remove`, the row being dropped). */
  row: Record<string, unknown>;
  /**
   * Natural key of the row this change REPLACES, when an edit moved the row's
   * key fields (e.g. the operator switched channel SMS -> EMAIL). Without it the
   * would-be state would contain both the old and the new row.
   */
  replaces?: string;
}

export interface GuardResult {
  /** Errors this change is answerable for. A save must not proceed past these. */
  blocking: ValidationFinding[];
  /** Warnings, plus pre-existing errors on rows this change does not touch. */
  advisory: ValidationFinding[];
  /** Findings before the change — useful for "you did not cause this" copy. */
  before: ValidationFinding[];
  /** Findings after the change. */
  after: ValidationFinding[];
}

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();
const get = (row: Record<string, unknown>, key: string) => row[key];

/**
 * The MDMS `x-unique` tuple for each master, joined with '.' — the same scheme
 * egov-mdms-service derives `uniqueIdentifier` from server-side, and the same
 * one NotificationConfigure builds its uids with.
 */
export const UNIQUE_FIELDS: Record<NotificationResource, string[]> = {
  'notifications-routing': ['eventName', 'audience', 'channel'],
  'notifications-template': ['eventName', 'audience', 'channel', 'locale'],
  'notifications-channel': ['code'],
  'notifications-provider-template': ['provider', 'channel', 'eventName', 'audience', 'locale'],
};

/** Case-insensitive natural key for a row of `resource`. */
export function naturalKey(resource: NotificationResource, row: Record<string, unknown>): string {
  return UNIQUE_FIELDS[resource].map((f) => norm(get(row, f))).join('.');
}

/**
 * Accept an MDMS `uniqueIdentifier` as a `replaces` key, or reject it.
 *
 * MDMS derives the uid by joining the x-unique field VALUES with '.', which is
 * exactly `naturalKey`'s scheme. It is no longer DECOMPOSABLE, though:
 * `eventName` itself contains dots (`COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT`),
 * so counting parts — which is how this function used to reject a uid from a
 * differently-shaped record — would reject every legitimate key. What survives
 * is a lower bound: n key fields need at least n-1 separators. The exact match
 * is recovered elsewhere: `applyPendingChanges` also drops a row whose stored
 * `id` / `_uniqueIdentifier` equals the `replaces` value, which is the case
 * this function was really protecting.
 */
export function replacesKeyFor(resource: NotificationResource, uid: unknown): string | undefined {
  const raw = String(uid ?? '').trim();
  if (!raw) return undefined;
  const separators = raw.split('.').length - 1;
  if (separators < UNIQUE_FIELDS[resource].length - 1) return undefined;
  return norm(raw);
}

/**
 * The `ref` strings validateNotifications attaches to findings about this row.
 * Routing, template and provider-template rows all key on the same
 * `AUDIENCE · EVENT · CHANNEL` shape; channel policy keys on the channel code.
 *
 * The audience goes through `audienceKey`, exactly as the checker's own `ref`
 * does, so a legacy bare `CITIZEN` and an `ACTOR:citizen` produce the SAME ref
 * — otherwise a save would fail to recognise its own finding and block nothing.
 */
export function refsForChange(change: PendingChange): string[] {
  const r = change.row;
  if (change.resource === 'notifications-channel') return [norm(get(r, 'code'))].filter(Boolean);
  const ref = `${audienceKey(get(r, 'audience'))} · ${norm(get(r, 'eventName'))} · ${norm(get(r, 'channel'))}`;
  return [ref];
}

/** Normalised ref for comparison — findings carry the row's raw casing. */
function normRef(ref: string | undefined): string {
  return String(ref ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function replaceByKey<T>(rows: T[], resource: NotificationResource, change: PendingChange): T[] {
  const targetKey = change.replaces ? norm(change.replaces) : naturalKey(resource, change.row);
  const newKey = naturalKey(resource, change.row);
  const kept = rows.filter((row) => {
    const record = row as unknown as Record<string, unknown>;
    const k = naturalKey(resource, record);
    // The stored uid is matched too: `eventName` carries dots, so a `replaces`
    // value that came straight off a record's `uniqueIdentifier` cannot be
    // decomposed and compared field by field, but it CAN be compared whole.
    const uid = norm(record.id ?? record._uniqueIdentifier ?? '');
    if (uid && uid === targetKey) return false;
    return k !== targetKey && k !== newKey;
  });
  return change.op === 'remove' ? kept : [...kept, change.row as unknown as T];
}

/**
 * The configuration as it WOULD BE if `changes` were saved. Pure — the input
 * snapshot is never mutated.
 */
export function applyPendingChanges(
  snapshot: NotificationSnapshot,
  changes: PendingChange[],
): NotificationSnapshot {
  let next: NotificationSnapshot = { ...snapshot };
  for (const change of changes) {
    switch (change.resource) {
      case 'notifications-routing':
        next = { ...next, routingRows: replaceByKey(next.routingRows ?? [], change.resource, change) };
        break;
      case 'notifications-template':
        next = { ...next, templateRows: replaceByKey(next.templateRows ?? [], change.resource, change) };
        break;
      case 'notifications-channel':
        next = { ...next, channelRows: replaceByKey(next.channelRows ?? [], change.resource, change) };
        break;
      case 'notifications-provider-template':
        next = { ...next, providerTemplateRows: replaceByKey(next.providerTemplateRows ?? [], change.resource, change) };
        break;
    }
  }
  return next;
}

/** Stable identity of a finding, so "the same finding" survives a re-run. */
function identity(f: ValidationFinding): string {
  return `${f.level}|${f.rule}|${normRef(f.ref)}|${f.message}`;
}

/**
 * Split the would-be findings into what may block the save and what is merely
 * shown. See the header for why pre-existing errors on untouched rows do not
 * block.
 */
export function partitionFindings(
  before: ValidationFinding[],
  after: ValidationFinding[],
  touchedRefs: string[],
): Pick<GuardResult, 'blocking' | 'advisory'> {
  const wasThere = new Set(before.map(identity));
  const touched = new Set(touchedRefs.map(normRef).filter(Boolean));
  const blocking: ValidationFinding[] = [];
  const advisory: ValidationFinding[] = [];
  for (const f of after) {
    const isOurs = touched.has(normRef(f.ref)) || !wasThere.has(identity(f));
    if (f.level === 'error' && isOurs) blocking.push(f);
    else advisory.push(f);
  }
  return { blocking, advisory };
}

/** Validate the would-be state and decide what blocks the save. */
export function checkPendingChanges(
  snapshot: NotificationSnapshot,
  changes: PendingChange[],
): GuardResult {
  const before = validateNotifications(snapshot);
  const after = validateNotifications(applyPendingChanges(snapshot, changes));
  const touchedRefs = changes.flatMap(refsForChange);
  return { ...partitionFindings(before, after, touchedRefs), before, after };
}

const FIELD_BY_RULE = new Map(NOTIFICATION_RULES.map((r) => [r.id, r.field]));

/** The form field a finding belongs next to, or undefined for the summary. */
export function fieldForRule(rule: string): string | undefined {
  return FIELD_BY_RULE.get(rule);
}

/**
 * Blocking findings as react-hook-form field errors, keyed by form field name.
 * Findings with no field mapping (and any extra finding for a field that is
 * already taken) stay out — they belong in the summary the caller renders, so
 * nothing is ever silently dropped.
 */
export function fieldErrorsFor(
  blocking: ValidationFinding[],
  knownFields?: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of blocking) {
    const field = fieldForRule(f.rule);
    if (!field) continue;
    if (knownFields && !knownFields.includes(field)) continue;
    if (out[field]) continue;
    out[field] = `${f.rule}: ${f.message}`;
  }
  return out;
}

/** One-line summary for a toast / banner header. */
export function blockingSummary(blocking: ValidationFinding[]): string {
  if (blocking.length === 0) return '';
  const n = blocking.length;
  return `Cannot save: ${n} validation error${n === 1 ? '' : 's'} — ${blocking
    .map((f) => f.rule)
    .filter((r, i, a) => a.indexOf(r) === i)
    .join(', ')}.`;
}
