import { API_ORIGIN, selectContext, type SessionUser } from '@/api/onboarding';
import { apiClient } from '@/api/client';
import type { UserInfo } from '@/api/types';
import { installDigitContext } from '@/lib/session';
import { completedSteps, isWorkspaceApiMissing, searchWorkspace } from './workspace';
import { resumePath } from '@/onboarding/progress';

/** Identity discovery has no readiness. PGR is consulted only after token selection. */
export async function enterWorkspace(tenantId: string, identity?: Pick<SessionUser, 'name' | 'email'> | null) {
  const context = await selectContext(tenantId);
  const previous = apiClient.getAuth();
  const previousEnvironment = apiClient.getEnvironment();
  apiClient.setEnvironment(API_ORIGIN || window.location.origin);
  apiClient.setAuth(context.access_token, context.UserRequest as UserInfo);
  // Workspace setup belongs to ACCOUNT_ADMIN. Other staff enter their existing workspace.
  const admin = context.UserRequest.roles.some(role => role.code === 'ACCOUNT_ADMIN' && role.tenantId === tenantId);
  try {
    const progress = admin ? await adminProgress(tenantId) : [1, 2, 3, 4, 5];
    installDigitContext(context, identity, progress);
    window.location.assign(progress.length === 5 ? '/configurator/manage' : `/configurator${resumePath(progress)}`);
  } catch (error) {
    // A failed switch must not leave the old UI using the newly selected token.
    apiClient.setEnvironment(previousEnvironment);
    if (previous.token && previous.user) apiClient.setAuth(previous.token, previous.user);
    else apiClient.logout();
    throw error;
  }
}

/** Without the PGR workspace API there is no setup state to resume, so the
 *  admin enters management exactly as before the workspace API existed. */
async function adminProgress(tenantId: string): Promise<number[]> {
  try {
    return completedSteps((await searchWorkspace(tenantId)).Workspace);
  } catch (error) {
    if (isWorkspaceApiMissing(error)) return [1, 2, 3, 4, 5];
    throw error;
  }
}
