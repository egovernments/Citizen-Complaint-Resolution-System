import { ApiClientError } from '@/api';

/** A failed save, in words someone setting up their workspace can act on. */
export function describeSaveError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  const denied =
    (err instanceof ApiClientError && err.statusCode === 403) || /AccessDenied|not authori[sz]ed|forbidden/i.test(message);
  if (denied) {
    return 'Your account doesn’t have permission to change this workspace yet, so nothing was saved.';
  }
  // mdms-v2 has no parent fallback on _create: a workspace missing a schema cannot hold its records.
  if (/SCHEMA_DEFINITION_NOT_FOUND|Schema definition .*not found/i.test(message)) {
    return 'This workspace isn’t fully set up on the server yet, so this couldn’t be saved.';
  }
  return message || fallback;
}
