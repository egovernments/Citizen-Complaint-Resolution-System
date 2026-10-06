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

/** What each step's server check (pgr-services WorkspaceGateway) looks for, for when it refuses DONE. */
const INCOMPLETE: Record<string, string> = {
  BRANDING: 'Add a logo to finish branding, or skip the step.',
  GEOGRAPHY: 'Add at least two levels of places, for example counties and the wards inside them.',
  DEPARTMENTS: 'Add at least one department and one designation.',
  EMPLOYEES: 'Add at least one employee who can sign in.',
  COMPLAINT_TYPES:
    'Every department a complaint category goes to needs an employee with the GRO role (a DGRO doesn’t count), and at least one category needs a department and a resolution time.',
};

/** A refused step completion, in words; other failures keep their own message. */
export function describeStepCompletionError(err: unknown, step: string): string {
  const code = err instanceof ApiClientError ? err.errors[0]?.code : undefined;
  if (code === 'WORKSPACE_PROBE_INCOMPLETE' && INCOMPLETE[step]) return `This step isn’t complete yet. ${INCOMPLETE[step]}`;
  return err instanceof Error ? err.message : 'Reload and retry.';
}
