import { hrmsService } from '@/api/services/hrms';
import { mdmsService } from '@/api/services/mdms';
import type { Employee } from '@/api/types';

/**
 * D16 (amended): a root workspace (`ke`) binds EMPLOYEE accounts at its own
 * tenant or a child tenant (`ke.nairobi`), never another root or a tenant that
 * only shares the prefix (`kex`). The child keeps its own tenant: Kong
 * authorizes the employee's token there.
 */
export function withinWorkspace(tenantId: string | undefined, workspace: string): boolean {
  return typeof tenantId === 'string' && workspace.length > 0 &&
    (tenantId === workspace || tenantId.startsWith(`${workspace}.`));
}

/** The workspace tenant first, then its child tenants from the root's `tenant.tenants`. */
export async function workspaceTenants(workspace: string): Promise<string[]> {
  // Without the tenant list, the workspace's own employees still show.
  const tenants = await mdmsService.getTenants(workspace.split('.')[0]).catch(() => []);
  const children = tenants.map((tenant) => tenant.code).filter((code) => code !== workspace && withinWorkspace(code, workspace));
  return [workspace, ...new Set(children)];
}

type SearchOptions = Parameters<typeof hrmsService.searchEmployees>[1];

/** HRMS filters `tenantId` exactly, so the workspace's employees are searched at each of its tenants. */
export async function searchWorkspaceEmployees(workspace: string, options?: SearchOptions): Promise<Employee[]> {
  const tenants = await workspaceTenants(workspace);
  return (await Promise.all(tenants.map((tenantId) => hrmsService.searchEmployees(tenantId, options)))).flat();
}
