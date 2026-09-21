// React wiring for the notification save guard.
//
// The decidable half lives in notificationSaveGuard.ts (pure, unit-tested).
// This file only loads the current configuration and adapts the result to
// react-hook-form, so the four notification masters get the SAME validation
// whether they are edited through the Configure screen or through the generic
// MDMS create/edit forms.

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
import type {
  BusinessServiceRecord,
  ChannelRow,
  IntegrationRow,
  ProviderTemplateRow,
  RoutingRow,
  TemplateRow,
  ValidationFinding,
} from '../workflow-services/validateNotifications';

const BIG = { pagination: { page: 1, perPage: 1000 }, sort: { field: 'action', order: 'ASC' as const } };

export interface NotificationConfigQuery {
  snapshot: NotificationSnapshot | null;
  /**
   * False while data is still arriving, or when the workflow could not be
   * loaded. The guard must NOT run then: without the state machine every
   * routing row would fail transition-exists and the operator would be locked
   * out of a screen by a loading race.
   */
  ready: boolean;
}

/**
 * Load the whole notification configuration for the guard. `businessService` is
 * the workflow to validate transitions against; it defaults to PGR, which is
 * the only workflow these masters are seeded for.
 */
export function useNotificationConfig(
  businessServiceId = 'PGR',
  options: { enabled?: boolean } = {},
): NotificationConfigQuery {
  const enabled = options.enabled !== false;
  const q = { enabled };

  const { data: bsList, isPending: bsPending } = useGetList(
    'workflow-business-services',
    { pagination: { page: 1, perPage: 100 }, sort: { field: 'businessService', order: 'ASC' } },
    q,
  );
  const { data: routingData, isPending: routingPending } = useGetList('notification-routing', BIG, q);
  const { data: templateData, isPending: templatePending } = useGetList('notification-template', BIG, q);
  const { data: channelData } = useGetList('notification-channel', { pagination: { page: 1, perPage: 20 }, sort: { field: 'code', order: 'ASC' } }, q);
  const { data: providerTemplateData } = useGetList('notification-provider-template', BIG, q);
  const { data: integrationData } = useGetList('notification-provider', { pagination: { page: 1, perPage: 100 }, sort: { field: 'channel', order: 'ASC' } }, q);
  const { data: roleData } = useGetList('access-roles', { pagination: { page: 1, perPage: 1000 }, sort: { field: 'name', order: 'ASC' } }, q);

  const businessService = useMemo(() => {
    const want = String(businessServiceId ?? '').trim().toUpperCase();
    return (bsList ?? []).find(
      (b) => String(b.businessService ?? '').toUpperCase() === want || String(b.id ?? '').toUpperCase() === want,
    ) as unknown as BusinessServiceRecord | undefined;
  }, [bsList, businessServiceId]);

  return useMemo(() => {
    const ready =
      enabled &&
      !bsPending && !routingPending && !templatePending &&
      !!businessService && (businessService.states?.length ?? 0) > 0;
    if (!ready) return { snapshot: null, ready: false };
    return {
      ready: true,
      snapshot: {
        businessService: businessService as BusinessServiceRecord,
        routingRows: (routingData ?? []) as unknown as RoutingRow[],
        templateRows: (templateData ?? []) as unknown as TemplateRow[],
        roleCodes: (roleData ?? []).map((r) => String((r as Record<string, unknown>).code ?? (r as Record<string, unknown>).id ?? '')),
        // An EMPTY channel master is "not seeded", not "everything is off" —
        // pass undefined so the channel rules stay silent, exactly as the
        // Configure screen's Validate panel does.
        channelRows: channelData && channelData.length > 0 ? (channelData as unknown as ChannelRow[]) : undefined,
        providerTemplateRows: providerTemplateData ? (providerTemplateData as unknown as ProviderTemplateRow[]) : undefined,
        integrationRows: integrationData ? (integrationData as unknown as IntegrationRow[]) : undefined,
      },
    };
  }, [enabled, bsPending, routingPending, templatePending, businessService, routingData, templateData, roleData, channelData, providerTemplateData, integrationData]);
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
  /** True for the four notification masters — i.e. the guard applies at all. */
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
  options: { editingId?: string; businessService?: string } = {},
): FormGuard {
  const enabled = isNotificationResource(resource);
  const { snapshot, ready } = useNotificationConfig(options.businessService || 'PGR', { enabled });
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
