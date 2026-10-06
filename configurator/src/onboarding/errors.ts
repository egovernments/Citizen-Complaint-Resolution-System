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
const STEP_REQUIREMENT: Record<string, string> = {
  BRANDING: 'Add a logo to finish branding, or skip the step.',
  GEOGRAPHY: 'Add at least two levels of places, for example counties and the wards inside them.',
  DEPARTMENTS: 'Add at least one department and one designation.',
  EMPLOYEES: 'Add at least one employee who can sign in.',
  COMPLAINT_TYPES:
    'Every department a complaint category goes to needs an employee with the GRO role (a DGRO doesn’t count), and at least one category needs a department and a resolution time.',
};

export function stepRequirement(step: string): string | undefined {
  return STEP_REQUIREMENT[step];
}

/** The workspace API's error codes (PGR onboarding-workspace-contract.md), in words. */
const WORKSPACE_ERRORS: Record<string, string> = {
  WORKSPACE_AUTH_REQUIRED: 'Your session has ended. Sign in again to carry on.',
  WORKSPACE_ADMIN_REQUIRED: 'Only an admin of this workspace can change its setup.',
  WORKSPACE_VERSION_CONFLICT: 'This workspace was just changed somewhere else. Reload the page and try again.',
  WORKSPACE_DEPENDENCY_UNAVAILABLE: 'A service this needs isn’t responding right now. Try again in a minute.',
  WORKSPACE_INVALID_DEPENDENCY_RESPONSE: 'A service this needs sent back something unexpected. Try again in a minute.',
  WORKSPACE_TENANT_NOT_FOUND: 'This workspace couldn’t be found. If it was just created, wait a minute and reload.',
  WORKSPACE_INVALID_STATE: 'That change isn’t allowed for this step.',
  WORKSPACE_INVALID_REQUEST: 'That request wasn’t valid. Reload the page and try again.',
  WORKSPACE_INVALID_TENANT: 'That request wasn’t valid. Reload the page and try again.',
  WORKSPACE_NAME_TAKEN: 'Another workspace already uses this name. Pick a different one.',
  WORKSPACE_INVALID_NAME: 'That name can’t be used. Try a different one.',
  WORKSPACE_RENAME_PENDING: 'A name change is still being applied. Wait for it to finish, then try again.',
};

/** A failed workspace call in words; anything that isn't a known workspace code keeps its own message. */
export function describeWorkspaceError(err: unknown, step?: string): string {
  const code = err instanceof ApiClientError ? err.errors[0]?.code : undefined;
  if (code === 'WORKSPACE_PROBE_INCOMPLETE') {
    const requirement = step ? STEP_REQUIREMENT[step] : undefined;
    return requirement ? `This step isn’t complete yet. ${requirement}` : 'This step isn’t complete yet.';
  }
  if (code && WORKSPACE_ERRORS[code]) return WORKSPACE_ERRORS[code];
  return err instanceof Error ? err.message : 'Reload and retry.';
}
