import { ApiClientError } from '@/api';

/** A failed save, in words someone setting up their workspace can act on. */
export function describeSaveError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  const denied =
    (err instanceof ApiClientError && err.statusCode === 403) || /AccessDenied|not authori[sz]ed|forbidden/i.test(message);
  if (denied) {
    return 'Your account doesn’t have permission to change this workspace yet, so nothing was saved.';
  }
  return message || fallback;
}
