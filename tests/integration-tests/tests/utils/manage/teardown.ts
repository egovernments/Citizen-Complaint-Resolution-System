/**
 * Teardown helpers — soft-delete MDMS rows and REJECT PGR complaints.
 *
 * MDMS has no DELETE endpoint, so cleanup is `_update isActive=false`. PGR
 * complaints route to REJECTED via the workflow REJECT action, taking them
 * out of every active inbox / queue. Both helpers swallow per-record errors
 * so one stale row doesn't tank an afterAll cleaning a dozen.
 */
import {
  loadAuth,
  mdmsSearch,
  mdmsUpdate,
  pgrSearch,
  pgrUpdate,
  type AuthInfo,
} from './api';

interface CleanupResult {
  cleaned: string[];
  failed: Array<{ id: string; reason: string }>;
}

/**
 * Soft-delete MDMS rows by uniqueIdentifier. We search by code rather than
 * trusting the caller to remember the row's `id` — this lets the cleanup
 * survive partial failures where a create may have succeeded server-side
 * but the test exited before capturing the response.
 */
export async function cleanupMdms(
  codes: string[],
  schemaCode: string,
  tenantId: string,
  auth: AuthInfo = loadAuth(),
): Promise<CleanupResult> {
  const result: CleanupResult = { cleaned: [], failed: [] };
  if (!codes.length) return result;

  let records;
  try {
    records = await mdmsSearch(auth, tenantId, schemaCode, {
      uniqueIdentifiers: codes,
      limit: codes.length + 10,
    });
  } catch (e) {
    for (const code of codes) {
      result.failed.push({
        id: code,
        reason: `mdmsSearch failed: ${(e as Error).message}`,
      });
    }
    return result;
  }

  for (const record of records) {
    if (record.isActive === false) {
      // Already inactive — count as cleaned, nothing to do.
      result.cleaned.push(record.uniqueIdentifier);
      continue;
    }
    try {
      await mdmsUpdate(auth, record, false);
      result.cleaned.push(record.uniqueIdentifier);
    } catch (e) {
      result.failed.push({
        id: record.uniqueIdentifier,
        reason: (e as Error).message,
      });
    }
  }
  return result;
}

/**
 * REJECT each complaint via the PGR workflow. Skips ones already in a
 * terminal state (REJECTED / CLOSEDAFTERRESOLUTION / CLOSEDAFTERREJECTION)
 * so we don't spam the workflow engine with no-op transitions.
 */
const TERMINAL_STATUSES = new Set([
  'REJECTED',
  'CLOSEDAFTERRESOLUTION',
  'CLOSEDAFTERREJECTION',
]);

export async function cleanupPgrComplaints(
  serviceRequestIds: string[],
  tenantId: string,
  auth: AuthInfo = loadAuth(),
): Promise<CleanupResult> {
  const result: CleanupResult = { cleaned: [], failed: [] };
  if (!serviceRequestIds.length) return result;

  for (const srid of serviceRequestIds) {
    let wrapper;
    try {
      const matches = await pgrSearch(auth, tenantId, {
        serviceRequestId: srid,
        limit: 1,
      });
      wrapper = matches[0];
    } catch (e) {
      result.failed.push({ id: srid, reason: `search: ${(e as Error).message}` });
      continue;
    }
    if (!wrapper) {
      // Already gone or never existed — treat as cleaned for our purposes.
      result.cleaned.push(srid);
      continue;
    }
    const service = wrapper.service as Record<string, unknown> | undefined;
    const status = service?.applicationStatus as string | undefined;
    if (status && TERMINAL_STATUSES.has(status)) {
      result.cleaned.push(srid);
      continue;
    }
    try {
      await pgrUpdate(auth, service || {}, 'REJECT', {
        comment: 'Cleaned up by Playwright manage suite',
      });
      result.cleaned.push(srid);
    } catch (e) {
      result.failed.push({ id: srid, reason: (e as Error).message });
    }
  }
  return result;
}
