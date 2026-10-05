import { apiClient } from '@/api/client';
import { mdmsService } from '@/api/services/mdms';

// Contract: b0f7b37770d99acc0579eb830d93f8ebcbedf053, PGR onboarding-workspace-contract.md.
export const WORKSPACE_STEPS = ['BRANDING', 'GEOGRAPHY', 'DEPARTMENTS', 'EMPLOYEES', 'COMPLAINT_TYPES'] as const;
export type WorkspaceStep = typeof WORKSPACE_STEPS[number];
export type StepState = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED';
interface Audit { updatedAt: number | null; updatedBy: string | null; lastErrorCode?: string }
export interface Workspace extends Audit {
  tenantId: string;
  status: string;
  version: number;
  legacy: boolean;
  seedVersion: string | null;
  steps: Record<WorkspaceStep, Audit & { state: StepState }>;
}
export interface Rename {
  id: string;
  tenantId: string;
  name: string;
  version: number;
  status: 'PENDING' | 'DONE';
  updatedAt: number;
  lastErrorCode?: string;
}
export interface WorkspaceView {
  Workspace: Workspace;
  /** Advisory. A probe whose dependency check failed is null (unknown / not ready); _update returns only the
   *  probe it ran, and legacy rows return null for the whole block. Never treat a missing or null probe as true. */
  Probes: Partial<Record<WorkspaceStep, boolean | null>> | null;
  Rename: Rename | null;
}
const base = '/pgr-services/v2/onboarding/workspaces';
export async function searchWorkspace(tenantId: string): Promise<WorkspaceView> {
  return await apiClient.post(`${base}/_search`, { RequestInfo: apiClient.buildRequestInfo(), tenantId }) as unknown as WorkspaceView;
}
export async function updateWorkspace(tenantId: string, step: WorkspaceStep, state: StepState, version: number) {
  return await apiClient.post(`${base}/_update`, { RequestInfo: apiClient.buildRequestInfo(), tenantId, step, state, version }) as unknown as WorkspaceView;
}
export interface RenameRequest { tenantId: string; name: string; version: number }
export async function renameWorkspace(request: RenameRequest): Promise<Rename> {
  const response = await apiClient.post(`${base}/_rename`, { RequestInfo: apiClient.buildRequestInfo(), ...request });
  return response.Rename as Rename;
}
export function completedSteps(workspace: Workspace): number[] {
  return WORKSPACE_STEPS.flatMap((step, index) => ['DONE', 'SKIPPED'].includes(workspace.steps[step].state) ? [index + 1] : []);
}

export function validateExpiry(hours: number) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 2160) throw new Error('Enter a whole number of hours between 1 and 2160 (90 days).');
}
export async function invitationPolicy(tenantId: string) {
  const rows = await mdmsService.searchRecords(tenantId, 'identity.invitationPolicy');
  return rows.find(row => row.tenantId === tenantId && row.uniqueIdentifier === 'default' && row.isActive !== false) ?? null;
}
export async function saveInvitationPolicy(tenantId: string, hours: number) {
  validateExpiry(hours);
  const row = await invitationPolicy(tenantId);
  if (!row) throw new Error('The invitation policy has not been seeded for this workspace. Retry after workspace provisioning finishes.');
  return mdmsService.update(row, { ...row.data, invitationExpiryHours: hours });
}
