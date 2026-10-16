// React wiring for the notification screens: load the configuration, decide
// which namespace it lives in, and adapt the result to react-hook-form.
//
// Everything decidable lives in pure modules — notificationSaveGuard.ts (what
// may block a save), notificationSource.ts (which namespace serves this tenant),
// legacyAdapter.ts (how a legacy row reads in the new vocabulary) — so this file
// is only data loading and plumbing.
//
// It loads BOTH namespaces on purpose. A tenant that has not been migrated
// (migrate-notifications.py) still has its live configuration in the legacy masters, and showing
// that tenant an empty Configure screen would invite an operator to re-enter the
// whole configuration into the new masters while the old rows keep firing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGetList, useTranslate } from 'ra-core';
import { useQuery } from '@tanstack/react-query';
import { digitClient, getResourceConfig } from '@/providers/bridge';
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
  NAMESPACE_SWITCH_RULE,
  namespaceSwitchMessage,
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

/** Shown when a save is attempted before the configuration the check needs has loaded.
 *  The English default of `app.notification_guard.config_loading`. */
export const CONFIG_LOADING_KEY = 'app.notification_guard.config_loading';
export const CONFIG_LOADING_MESSAGE =
  'The notification configuration is still loading, so this change cannot be checked yet — wait a moment and save again.';

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
  /**
   * True while any master — or the tenant's roles or the provider list, which the checker
   * also reads — is still loading. Tells "not loaded yet" apart from "no catalogue": a save
   * must wait for the first, and must not be locked out by the second.
   */
  loading: boolean;
  /** Which namespace served this tenant, and whether the screens may write. */
  decision: SourceDecision;
  /** The same decision for channel policy, which the box makes on its own master. */
  channelDecision: SourceDecision;
  catalogue: EventCatalogueRow[];
  routingRows: Ided<RoutingRow>[];
  templateRows: Ided<TemplateRow>[];
  providerTemplateRows?: Ided<ProviderTemplateRow>[];
  channelRows?: ChannelRow[];
  integrationRows?: IntegrationRow[];
  roleCodes: string[];
}

/**
 * Does `resource`'s master hold ANY record at the state tenant, active or not?
 * That, not the active-row count the lists show, is what novu-bridge switches
 * on: its routing read carries no isActive filter, so a tenant whose routing
 * rows were all deleted stays on NOTIFICATIONS.* rather than falling back to
 * legacy. `present` is undefined while unknown (loading, failed, no state
 * tenant); the decision then falls back to the active counts.
 */
function useAnyRecord(resource: string, stateTenant: string, enabled: boolean): { present?: boolean; loading: boolean } {
  const schema = getResourceConfig(resource)?.schema;
  const { data, isLoading } = useQuery({
    queryKey: ['notification-source-probe', stateTenant, schema],
    queryFn: async () => (await digitClient.mdmsSearch(stateTenant, schema!, { limit: 1 })).length > 0,
    enabled: enabled && !!stateTenant && !!schema,
    retry: false,
  });
  return { present: data, loading: isLoading };
}

/**
 * Load the whole notification configuration, from whichever namespace this
 * tenant's configuration actually lives in — decided exactly as novu-bridge
 * decides it (see notificationSource.ts).
 */
export function useNotificationConfig(options: { enabled?: boolean } = {}): NotificationConfigQuery {
  const enabled = options.enabled !== false;
  // Every master is read where novu-bridge reads it: the STATE tenant. The
  // registry marks them stateLevel, but the generic list path reads the session
  // tenant unless told otherwise, and a city session would otherwise decide on
  // a city tenant that holds nothing.
  const stateTenant = String(digitClient.stateTenantId || '');
  const q = { enabled };
  const at = <T extends object>(params: T) => (stateTenant ? { ...params, filter: { __tenantId: stateTenant } } : params);

  // The shared NOTIFICATIONS.* namespace.
  const { data: catalogueData, isPending: cataloguePending } = useGetList('notifications-event-catalogue', at(BIG), q);
  const { data: routingData, isPending: routingPending } = useGetList('notifications-routing', at(BIG), q);
  const { data: templateData, isPending: templatePending } = useGetList('notifications-template', at(BIG), q);
  const { data: providerTemplateData, isPending: providerTemplatePending } = useGetList('notifications-provider-template', at(BIG), q);
  const { data: channelData, isPending: channelPending } = useGetList('notifications-channel', at(SMALL), q);

  // The legacy PGR namespace — read-only, and only used when the tenant has
  // no NOTIFICATIONS.Routing record (or, for channels, no NOTIFICATIONS.Channel row).
  const { data: legacyRoutingData, isPending: legacyRoutingPending } = useGetList('notification-routing', at(LEGACY_BIG), q);
  const { data: legacyTemplateData, isPending: legacyTemplatePending } = useGetList('notification-template', at(LEGACY_BIG), q);
  const { data: legacyProviderTemplateData, isPending: legacyProviderTemplatePending } = useGetList('notification-provider-template', at(LEGACY_BIG), q);
  const { data: legacyChannelData, isPending: legacyChannelPending } = useGetList('notification-channel', at(SMALL), q);

  // The switch itself, as the box reads it: any routing record, active or not.
  const modernRouting = useAnyRecord('notifications-routing', stateTenant, enabled);
  const legacyRouting = useAnyRecord('notification-routing', stateTenant, enabled);

  // Not namespaced: Novu integrations (a runtime fact, not MDMS) and the tenant's roles.
  const { data: integrationData, isPending: integrationPending } = useGetList('notification-provider', { pagination: { page: 1, perPage: 100 }, sort: { field: 'channel', order: 'ASC' } }, q);
  const { data: roleData, isPending: rolePending } = useGetList('access-roles', { pagination: { page: 1, perPage: 1000 }, sort: { field: 'name', order: 'ASC' } }, q);

  const pending =
    !enabled ||
    cataloguePending || routingPending || templatePending || providerTemplatePending || channelPending ||
    legacyRoutingPending || legacyTemplatePending || legacyProviderTemplatePending || legacyChannelPending ||
    modernRouting.loading || legacyRouting.loading;

  const decision = useMemo(
    () =>
      selectNotificationSource({
        pending,
        switchOn: 'routing',
        present: { modern: modernRouting.present, legacy: legacyRouting.present },
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
      pending, modernRouting.present, legacyRouting.present,
      catalogueData, routingData, templateData, providerTemplateData, channelData,
      legacyRoutingData, legacyTemplateData, legacyProviderTemplateData, legacyChannelData,
    ],
  );

  // Channel policy is switched on its own master (ChannelPolicyClient), the same
  // decision the Channels page makes in useChannelRows.
  const channelDecision = useMemo(
    () =>
      selectNotificationSource({
        pending,
        switchOn: 'channel',
        modern: { channel: channelData?.length ?? 0 },
        legacy: { channel: legacyChannelData?.length ?? 0 },
      }),
    [pending, channelData, legacyChannelData],
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

    const legacyRoutingRows = legacyRoutingData as unknown as LegacyRoutingRow[] | undefined;
    const routingRows = legacy
      ? adaptLegacyRouting(legacyRoutingRows)
      : ((routingData ?? []) as unknown as Ided<RoutingRow>[]);
    // Templates take the routing rows too: their audience is joined to the chain
    // routing produced, exactly as the box joins it (legacyAdapter.ts).
    const templateRows = legacy
      ? adaptLegacyTemplate(legacyTemplateData as unknown as LegacyTemplateRow[] | undefined, legacyRoutingRows)
      : ((templateData ?? []) as unknown as Ided<TemplateRow>[]);
    const providerTemplateRows = legacy
      ? adaptLegacyProviderTemplate(legacyProviderTemplateData as unknown as LegacyProviderTemplateRow[] | undefined, legacyRoutingRows)
      : ((providerTemplateData ?? []) as unknown as Ided<ProviderTemplateRow>[]);

    // Not `legacy ? … : …`: the box picks the channel master independently.
    const rawChannels = channelDecision.source === 'LEGACY' ? legacyChannelData : channelData;
    // An EMPTY channel master is "not seeded", not "everything is off" — pass
    // undefined so the channel rules stay silent rather than inventing findings.
    const channelRows = rawChannels && rawChannels.length > 0 ? (rawChannels as unknown as ChannelRow[]) : undefined;
    const integrationRows = integrationData ? (integrationData as unknown as IntegrationRow[]) : undefined;

    // The checker reads the roles (audience-role-exists) and the providers (channel-provider-*)
    // too. Checked while they load, every ROLE: audience would read as a role that does not
    // exist — a false error that blocks the save of the very row being edited.
    const loading = pending || rolePending || integrationPending;
    const ready = !loading && catalogue.length > 0;

    return {
      ready,
      loading,
      decision,
      channelDecision,
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
    pending, rolePending, integrationPending, decision, channelDecision, catalogueData, routingData, templateData,
    providerTemplateData, channelData, legacyRoutingData, legacyTemplateData, legacyProviderTemplateData, legacyChannelData,
    integrationData, roleCodes,
  ]);
}

/**
 * The snapshot a CHANNEL-policy or PROVIDER change is checked against, or null while the
 * configuration is still loading (the caller must then not save).
 *
 * Unlike `snapshot` it does not wait for an event catalogue. The rules such a change can
 * trip (channel-needs-provider, channel-provider-missing/-inactive, channel-gateway-mismatch)
 * never read it, and without one every routing row carries the SAME transition-exists error
 * before and after the change, on a routing ref the change does not touch — advisory, never
 * blocking (partitionFindings). Waiting for a catalogue would instead lock the Channels card
 * on a tenant that has none.
 */
export function channelGuardSnapshot(cfg: NotificationConfigQuery): NotificationSnapshot | null {
  if (cfg.loading) return null;
  return cfg.snapshot ?? {
    catalogue: cfg.catalogue,
    routingRows: cfg.routingRows,
    templateRows: cfg.templateRows,
    roleCodes: cfg.roleCodes,
    channelRows: cfg.channelRows,
    providerTemplateRows: cfg.providerTemplateRows,
    integrationRows: cfg.integrationRows,
  };
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
  const { snapshot, ready, loading, decision, channelDecision } = useNotificationConfig({ enabled });
  const t = useTranslate();
  const loadingMessage = t(CONFIG_LOADING_KEY, { _: CONFIG_LOADING_MESSAGE });
  const [result, setResult] = useState<GuardResult | null>(null);
  const lastSignature = useRef('');
  const { editingId } = options;

  // A save that would flip the tenant off its legacy configuration is refused
  // outright, before (and regardless of) the whole-config check.
  const switchBlock = useMemo<GuardResult | null>(() => {
    const message = enabled ? namespaceSwitchMessage(resource, decision, channelDecision) : null;
    if (!message) return null;
    const finding: ValidationFinding = { level: 'error', rule: NAMESPACE_SWITCH_RULE, message };
    return { blocking: [finding], advisory: [], before: [], after: [] };
  }, [enabled, resource, decision, channelDecision]);

  // Read through a ref so `validate` below never changes identity — see FormGuard.
  // Written in an effect, not during render: the ref only has to be fresh by the
  // time the operator types, which is always after the effect has run.
  const live = useRef({ enabled, ready, loading, loadingMessage, snapshot, resource, editingId, switchBlock });
  useEffect(() => {
    live.current = { enabled, ready, loading, loadingMessage, snapshot, resource, editingId, switchBlock };
  }, [enabled, ready, loading, loadingMessage, snapshot, resource, editingId, switchBlock]);

  // Shown as soon as it is known, not on the first keystroke: the operator should
  // learn why this form cannot be saved before filling it in.
  useEffect(() => {
    if (switchBlock) {
      lastSignature.current = JSON.stringify([switchBlock.blocking, switchBlock.advisory]);
      setResult(switchBlock);
    } else if (lastSignature.current.includes(NAMESPACE_SWITCH_RULE)) {
      lastSignature.current = '';
      setResult(null);
    }
  }, [switchBlock]);

  const validate = useCallback((values: Record<string, unknown>) => {
    const {
      enabled: on, ready: rdy, loading: busy, loadingMessage: waitText, snapshot: snap, resource: res0, editingId: id,
      switchBlock: block,
    } = live.current;
    if (!on) return {};
    // The row's key field: every form of that master has it, so an error there
    // always makes react-hook-form refuse the submit.
    const keyField = res0 === 'notifications-channel' ? 'code' : 'eventName';
    if (block) {
      const f = block.blocking[0];
      return { [keyField]: `${f.rule}: ${f.message}` };
    }
    // Still loading: refuse rather than let the save through unchecked. (No catalogue at all
    // is different — nothing can be checked then, and refusing would lock the form for good.)
    if (busy) return { [keyField]: waitText };
    if (!rdy || !snap) return {};
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
    return fieldErrorsFor(res.blocking, Object.keys(values ?? {}), keyField);
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
