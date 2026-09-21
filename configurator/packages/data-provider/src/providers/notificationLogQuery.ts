/**
 * Filter values (what the Logs screen's filter bar holds) → the query string
 * `GET /novu-bridge/novu-adapter/v1/logs` actually takes.
 *
 * Kept as a dependency-free module so it can be unit-tested from the
 * configurator app (see src/resources/notification-logs/*.test.ts) without
 * dragging the whole data provider — and so the parameter NAMES live in exactly
 * one place. They are the ones in docs/2.12/notifications/contract/openapi.yaml:
 *
 *   referenceNumber, referenceNumberPrefix, transactionId, channel, status,
 *   sourcePath, includeTest, limit, offset
 *
 * `tenantId` is NOT built here: the caller adds it, because it comes from the
 * session, not from a filter the operator typed.
 */

/** Every value the query can carry, all optional except the page window. */
export interface NotificationLogQuery {
  referenceNumber?: string;
  referenceNumberPrefix?: boolean;
  transactionId?: string;
  /** `SMS` | `WHATSAPP` | `EMAIL` | `NONE` — `NONE` selects the channel-less rows. */
  channel?: string;
  status?: string;
  /** `PRERENDERED` | `RESOLVED`. */
  sourcePath?: string;
  includeTest?: boolean;
  limit: number;
  offset: number;
  [key: string]: string | number | boolean | undefined;
}

/** A filter value only counts when it is a non-empty string. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * A tri-state coming out of a <select> whose only choice is "true": '' (or
 * absent) means "not asked for", 'true' means asked for. Anything else — an
 * explicit 'false', a real boolean — is honoured as written, so a caller that
 * hands us a boolean is not silently ignored.
 */
function flag(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return undefined;
  const s = text(value);
  if (s === undefined) return undefined;
  return s === 'true' ? true : undefined;
}

export function buildNotificationLogQuery(
  filter: Record<string, unknown>,
  page: number,
  perPage: number,
): NotificationLogQuery {
  const referenceNumber = text(filter.referenceNumber);
  return {
    referenceNumber,
    // Operators type a fragment of a complaint number, not the whole thing —
    // ask the server for a prefix match whenever there is something to match.
    referenceNumberPrefix: referenceNumber ? true : undefined,
    transactionId: text(filter.transactionId),
    channel: text(filter.channel),
    status: text(filter.status),
    sourcePath: text(filter.sourcePath),
    includeTest: flag(filter.includeTest),
    limit: perPage,
    offset: (page - 1) * perPage,
  };
}
