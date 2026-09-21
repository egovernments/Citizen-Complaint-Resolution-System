// React wiring for the notification screens: load the configuration, decide
// which namespace it lives in, and adapt the result to react-hook-form.
//
// Everything decidable lives in pure modules — notificationSaveGuard.ts (what
// may block a save), notificationSource.ts (which namespace serves this tenant),
// legacyAdapter.ts (how a legacy row reads in the new vocabulary) — so this file
// is only data loading and plumbing.
//
// It loads BOTH namespaces on purpose. A tenant whose deploy-time copy step has
// not run still has its live configuration in the legacy masters, and showing
// that tenant an empty Configure screen would invite an operator to re-enter the
// whole configuration into the new masters while the old rows keep firing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGetList } from 'ra-core';
import {
  checkPendingChanges,
  fieldErrorsFor,
  isNotificationResource,
  replacesKeyFor,
  type GuardResult,
  type NotificationResource,
  type NotificationSnapshot,
  type PendingChange,
} from './notificationSaveGuard';
import {
  selectNotificationSource,
  type SourceDecision,
} from './notificationSource';
import {
  adaptLegacyProviderTemplate,
  adaptLegacyRouting,
  adaptLegacyTemplate,
  catalogueFromLegacyRows,
  type LegacyProviderTemplateRow,
  type LegacyRoutingRow,
  type LegacyTemplateRow,
} from './legacyAdapter';
import type { EventCatalogueRow } from './eventCatalogue';
import type {
  ChannelRow,
  IntegrationRow,
  ProviderTemplateRow,
  RoutingRow,
  TemplateRow,
  ValidationFinding,
} from '../workflow-services/validateNotifications';

const BIG = { pagination: { page: 1, perPage: 1000 }, sort: { field: 'eventName', order: 'ASC' as const } };
const SMALL = { pagination: { page: 1, perPage: 20 }, sort: { field: 'code', order: 'ASC' as const } };
const LEGACY_BIG = { pagination: { page: 1, perPage: 1000 }, sort: { field: 'action', order: 'ASC' as const } };

/** A row carrying the react-admin id + the raw MDMS uniqueIdentifier. */
export type Ided<T> = T & { id?: string; _uniqueIdentifier?: string };

export interface NotificationConfigQuery {
  /**
   * Everything the checker needs, or null while data is still arriving or when
   * there is no event catalogue to validate against. The guard must NOT run
   * then: without a vocabulary every routing row would fail transition-exists
   * and the operator would be locked out of a screen by a loading race.
   */
  snapshot: NotificationSnapshot | null;
  ready: boolean;
  /** Which namespace served this tenant, and whether the screens may write. */
  decision: SourceDecision;
  catalogue: EventCatalogueRow[];
  routingRows: Ided<RoutingRow>[];
  templateRows: Ided<TemplateRow>[];
  providerTemplateRows?: Ided<ProviderTemplateRow>[];
  channelRows?: ChannelRow[];
  integrationRows?: IntegrationRow[];
  roleCodes: string[];
}

/**
 * Load the whole notification configuration, from whichever namespace this
 * tenant's configuration actually lives in.
 */
export function useNotificationConfig(options: { enabled?: boolean } = {}): NotificationConfigQuery {
  const enabled = options.enabled !== false;
  const q = { enabled };

  // The shared NOTIFICATIONS.* namespace.
  const { data: catalogueData, isPending: cataloguePending } = useGetList('notifications-event-catalogue', BIG, q);
  const { data: routingData, isPending: routingPending } = useGetList('notifications-routing', BIG, q);
  const { data: templateData, isPending: templatePending } = useGetList('notifications-template', BIG, q);
  const { data: providerTemplateData, isPending: providerTemplatePending } = useGetList('notifications-provider-template', BIG, q);
  const { data: channelData, isPending: channelPending } = useGetList('notifications-channel', SMALL, q);

  // The legacy PGR namespace — read-only, and only used when the tenant has
  // nothing in the namespace above.
  const { data: legacyRoutingData, isPending: legacyRoutingPending } = useGetList('notification-routing', LEGACY_BIG, q);
  const { data: legacyTemplateData, isPending: legacyTemplatePending } = useGetList('notification-template', LEGACY_BIG, q);
  const { data: legacyProviderTemplateData, isPending: legacyProviderTemplatePending } = useGetList('notification-provider-template', LEGACY_BIG, q);
  const { data: legacyChannelData, isPending: legacyChannelPending } = useGetList('notification-channel', SMALL, q);

  // Not namespaced: Novu integrations (a runtime fact, not MDMS) and the tenant's roles.
  const { data: integrationData } = useGetList('notification-provider', { pagination: { page: 1, perPage: 100 }, sort: { field: 'channel', order: 'ASC' } }, q);
  const { data: roleData } = useGetList('access-roles', { pagination: { page: 1, perPage: 1000 }, sort: { field: 'name', order: 'ASC' } }, q);

  const pending =
    !enabled ||
    cataloguePending || routingPending || templatePending || providerTemplatePending || channelPending ||
    legacyRoutingPending || legacyTemplatePending || legacyProviderTemplatePending || legacyChannelPending;

  const decision = useMemo(
    () =>
      selectNotificationSource({
        pending,
        modern: {
          catalogue: catalogueData?.length ?? 0,
          routing: routingData?.length ?? 0,
          template: templateData?.length ?? 0,
          providerTemplate: providerTemplateData?.length ?? 0,
          channel: channelData?.length ?? 0,
        },
        legacy: {
          routing: legacyRoutingData?.length ?? 0,
          template: legacyTemplateData?.length ?? 0,
          providerTemplate: legacyProviderTemplateData?.length ?? 0,
          channel: legacyChannelData?.length ?? 0,
        },
      }),
    [
      pending, catalogueData, routingData, templateData, providerTemplateData, channelData,
      legacyRoutingData, legacyTemplateData, legacyProviderTemplateData, legacyChannelData,
    ],
  );

  const roleCodes = useMemo<string[]>(
    () => (roleData ?? []).map((r) => String((r as Record<string, unknown>).code ?? (r as Record<string, unknown>).id ?? '')),
    [roleData],
  );

  return useMemo(() => {
    const legacy = decision.source === 'LEGACY';

    const catalogue = legacy
      ? catalogueFromLegacyRows(
          legacyRoutingData as unknown as LegacyRoutingRow[] | undefined,
          legacyTemplateData as unknown as LegacyTemplateRow[] | undefined,
          legacyProviderTemplateData as unknown as LegacyProviderTemplateRow[] | undefined,
        )
      : ((catalogueData ?? []) as unknown as EventCatalogueRow[]);

    const routingRows = legacy
      ? adaptLegacyRouting(legacyRoutingData as unknown as LegacyRoutingRow[] | undefined)
      : ((routingData ?? []) as unknown as Ided<RoutingRow>[]);
    const templateRows = legacy
      ? adaptLegacyTemplate(legacyTemplateData as unknown as LegacyTemplateRow[] | undefined)
      : ((templateData ?? []) as unknown as Ided<TemplateRow>[]);
    const providerTemplateRows = legacy
      ? adaptLegacyProviderTemplate(legacyProviderTemplateData as unknown as LegacyProviderTemplateRow[] | undefined)
      : ((providerTemplateData ?? []) as unknown as Ided<ProviderTemplateRow>[]);

    const rawChannels = legacy ? legacyChannelData : channelData;
    // An EMPTY channel master is "not seeded", not "everything is off" — pass
    // undefined so the channel rules stay silent rather than inventing findings.
    const channelRows = rawChannels && rawChannels.length > 0 ? (rawChannels as unknown as ChannelRow[]) : undefined;
    const integrationRows = integrationData ? (integrationData as unknown as IntegrationRow[]) : undefined;

    const ready = !pending && catalogue.length > 0;

    return {
      ready,
      decision,
      catalogue,
      routingRows,
      templateRows,
      providerTemplateRows,
      channelRows,
      integrationRows,
      roleCodes,
      snapshot: ready
        ? {
            catalogue,
            routingRows,
            templateRows,
            roleCodes,
            channelRows,
            providerTemplateRows,
            integrationRows,
          }
        : null,
    };
  }, [
    pending, decision, catalogueData, routingData, templateData, providerTemplateData, channelData,
    legacyRoutingData, legacyTemplateData, legacyProviderTemplateData, legacyChannelData,
    integrationData, roleCodes,
  ]);
}

export interface FormGuard {
  /**
   * Pass to <Form validate=…>. Returns react-hook-form field errors.
   *
   * IDENTITY-STABLE for the life of the component, deliberately: ra-core turns
   * `validate` into a react-hook-form resolver when the form initialises, so a
   * function that only appears once the config has loaded could be installed
   * too late — and validation would silently never run. This one is installed
   * immediately and reads the config through a ref, returning no errors until
   * there is something to check.
   */
  validate: (values: Record<string, unknown>) => Record<string, string>;
  /** Everything the last run found, for the summary panel. */
  result: GuardResult | null;
  /** True for the writable notification masters — i.e. the guard applies at all. */
  enabled: boolean;
  /** True when the guard has the config it needs and is actually checking. */
  ready: boolean;
}

/**
 * Guard for a generic MDMS create/edit form on one of the notification masters.
 *
 * `editingId` is the MDMS uniqueIdentifier of the row being edited (omit on
 * create). It is the natural key the pending change REPLACES, so an edit that
 * moves a row's key fields is not validated against a config that contains both
 * the old and the new row.
 */
export function useNotificationFormGuard(
  resource: string | undefined,
  options: { editingId?: string } = {},
): FormGuard {
  const enabled = isNotificationResource(resource);
  const { snapshot, ready } = useNotificationConfig({ enabled });
  const [result, setResult] = useState<GuardResult | null>(null);
  const lastSignature = useRef('');
  const { editingId } = options;

  // Read through a ref so `validate` below never changes identity — see FormGuard.
  // Written in an effect, not during render: the ref only has to be fresh by the
  // time the operator types, which is always after the effect has run.
  const live = useRef({ enabled, ready, snapshot, resource, editingId });
  useEffect(() => {
    live.current = { enabled, ready, snapshot, resource, editingId };
  }, [enabled, ready, snapshot, resource, editingId]);

  const validate = useCallback((values: Record<string, unknown>) => {
    const { enabled: on, ready: rdy, snapshot: snap, resource: res0, editingId: id } = live.current;
    if (!on || !rdy || !snap) return {};
    const res = checkPendingChanges(snap, [
      {
        resource: res0 as NotificationResource,
        op: 'upsert',
        row: values,
        replaces: replacesKeyFor(res0 as NotificationResource, id),
      },
    ]);
    // Set state only when the outcome actually changed: <Form mode="onChange">
    // calls validate on every keystroke.
    const signature = JSON.stringify([res.blocking, res.advisory]);
    if (signature !== lastSignature.current) {
      lastSignature.current = signature;
      setResult(res);
    }
    return fieldErrorsFor(res.blocking, Object.keys(values ?? {}));
  }, []);

  return { validate, result, enabled, ready: enabled && ready };
}

/**
 * Guard for a change made outside a react-hook-form (the Configure screen drives
 * its own inputs). Returns the findings; the caller decides what to do.
 */
export function checkChangeAgainst(
  snapshot: NotificationSnapshot | null,
  changes: PendingChange[],
): GuardResult | null {
  if (!snapshot) return null;
  return checkPendingChanges(snapshot, changes);
}

/** Findings worth showing in a panel: blocking first, then advisory. */
export function orderedFindings(result: GuardResult | null): ValidationFinding[] {
  if (!result) return [];
  return [...result.blocking, ...result.advisory];
}
