import { API_ORIGIN, selectContext, type SessionUser } from '@/api/onboarding';
import { apiClient } from '@/api/client';
import type { UserInfo } from '@/api/types';
import { installDigitContext } from '@/lib/session';
import { completedSteps, searchWorkspace } from './workspace';
import { HOME_PATH } from '@/onboarding/steps';

/** Identity discovery has no readiness. PGR is consulted only after token selection. */
/**
 * The DIGIT tenant id of a workspace. Tenant ids are lowercase (`ke`, `ke.bomet`); a v3 realm / Organization code is
 * the same name in upper case (`KE`), and is what the identity service lists for the state workspace. MDMS, the
 * workspace checklist and every list read the tenant id.
 */
export const digitTenantId = (tenantId: string): string => tenantId.trim().toLowerCase();

export async function enterWorkspace(tenantId: string, identity?: Pick<SessionUser, 'name' | 'email'> | null) {
  const context = await selectContext(tenantId);
  const previous = apiClient.getAuth();
  const previousEnvironment = apiClient.getEnvironment();
  apiClient.setEnvironment(API_ORIGIN || window.location.origin);
  apiClient.setAuth(context.access_token, context.UserRequest as UserInfo);
  // Workspace setup belongs to ACCOUNT_ADMIN. Other staff enter their existing workspace.
  // the workspace is entered under the identity service's code (KE); it is worked at its tenant id (ke)
  const workspace = digitTenantId(tenantId);
  const admin = context.UserRequest.roles.some(role => role.code === 'ACCOUNT_ADMIN' && digitTenantId(role.tenantId ?? '') === workspace);
  try {
    const progress = admin ? completedSteps((await searchWorkspace(workspace)).Workspace) : [1, 2, 3, 4, 5];
    installDigitContext(context, identity, progress);
    // An account still setting up lands on onboarding's Home, which says what to do next.
    window.location.assign(progress.length === 5 ? '/configurator/manage' : `/configurator${HOME_PATH}`);
  } catch (error) {
    // A failed switch must not leave the old UI using the newly selected token.
    apiClient.setEnvironment(previousEnvironment);
    if (previous.token && previous.user) apiClient.setAuth(previous.token, previous.user);
    else apiClient.logout();
    throw error;
  }
}
