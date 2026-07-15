// Pure, testable write-path orchestration for the Notifications "Configure" tab.
//
// Extracted from NotificationConfigure.tsx so the create -> reactivate ->
// deactivate sequencing can be unit-tested without rendering the form. This
// closes the review findings:
//   C1 — every mutation is awaited with { returnPromise: true } (the ra-core
//        callable otherwise returns fire-and-forget mutate() that never rejects,
//        so awaits are no-ops and success toasts lie).
//   C2 — a duplicate/phantom-200 Add lands as an update-with-reactivation
//        instead of a swallowed TypeError; a partial write is retry-recoverable.
//   C3 — a key-changing edit deactivates the OLD (audience, channel) pair so the
//        "edited" notification does not fire twice.
//   C4 — Remove -> re-Add resurrects the soft-deleted row via meta.includeInactive.

/** A ra-core-style mutation callable: (resource, params, options) => Promise. */
export type Mutate = (
  resource: string,
  params: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<unknown>;

export interface WritePathDeps {
  create: Mutate;
  update: Mutate;
  deleteOne: Mutate;
}

export interface WritePathInput {
  /** True when editing an existing notification (seed carried ids). */
  isEdit: boolean;
  /** True when the (audience, channel) unique-key components are unchanged. */
  keyUnchanged: boolean;
  /** Deterministic uids mirroring MDMS's server-side x-unique derivation. */
  routingUid: string;
  templateUid: string;
  routingData: Record<string, unknown>;
  templateData: Record<string, unknown>;
  seedRoutingId?: string;
  seedTemplateId?: string;
}

/** react-admin mutation option that turns the callable into an awaitable promise. */
const RETURN_PROMISE = { returnPromise: true };

/** MDMS phantom-200 duplicate marker raised by DigitApiClient.mdmsCreate. */
export function isMdmsDuplicate(err: unknown): boolean {
  return String((err as Error)?.message ?? '').includes('MDMS_DUPLICATE');
}

/** create -> on MDMS_DUPLICATE fall back to update-with-reactivation. */
export async function upsert(
  deps: WritePathDeps,
  resource: string,
  uid: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await deps.create(resource, { data }, RETURN_PROMISE);
  } catch (err) {
    if (isMdmsDuplicate(err)) {
      await deps.update(
        resource,
        { id: uid, data, previousData: {}, meta: { includeInactive: true } },
        RETURN_PROMISE,
      );
    } else {
      throw err;
    }
  }
}

/**
 * Write the routing + template pair for one notification.
 *
 * TEMPLATE FIRST: an orphan template (R5 warn) is harmless; an active routing
 * row without a template is a live misfire (R2 error). If the routing write
 * fails after the template landed, the operator retries and upsert() resolves
 * the duplicate.
 *
 * Old-pair deactivation runs AFTER the new pair is fully written, so a
 * mid-flight failure leaves the old behavior intact rather than no
 * notification at all.
 */
export async function saveNotificationPair(deps: WritePathDeps, input: WritePathInput): Promise<void> {
  const {
    isEdit, keyUnchanged, routingUid, templateUid,
    routingData, templateData, seedRoutingId, seedTemplateId,
  } = input;

  if (isEdit && seedRoutingId && seedTemplateId && keyUnchanged) {
    // In-place edit, key unchanged: plain updates (with returnPromise).
    await deps.update('notification-template', { id: seedTemplateId, data: templateData, previousData: {} }, RETURN_PROMISE);
    await deps.update('notification-routing', { id: seedRoutingId, data: routingData, previousData: {} }, RETURN_PROMISE);
    return;
  }

  await upsert(deps, 'notification-template', templateUid, templateData);
  await upsert(deps, 'notification-routing', routingUid, routingData);

  if (isEdit && !keyUnchanged) {
    // The old (audience, channel) pair must stop firing — otherwise the "edit"
    // doubled the notification.
    if (seedRoutingId) {
      await deps.deleteOne('notification-routing', { id: seedRoutingId, previousData: {} }, RETURN_PROMISE);
    }
    if (seedTemplateId) {
      try {
        await deps.deleteOne('notification-template', { id: seedTemplateId, previousData: {} }, RETURN_PROMISE);
      } catch {
        /* old template may be shared/absent — routing deactivation already stops the send */
      }
    }
  }
}
