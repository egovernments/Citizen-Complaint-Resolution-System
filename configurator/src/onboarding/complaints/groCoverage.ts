import type { Employee } from '@/api/types';

/**
 * Departments complaints would route to that have no one to assign them.
 *
 * Mirrors the COMPLAINT_TYPES probe in pgr-services (WorkspaceGateway): GRO
 * access is limited to the GRO's own department, so every department a
 * complaint type routes to needs an active employee holding GRO for this
 * tenant whose current assignment is in it. A DGRO doesn't count; without a
 * GRO the department's complaints stay pending assignment, and the server
 * refuses to mark the step done.
 */
export function departmentsWithoutGro(routed: Iterable<string>, employees: Employee[], tenantId: string): string[] {
  const missing = new Set(Array.from(routed).filter(Boolean));
  for (const employee of employees) {
    if (employee.isActive === false || employee.user?.active === false) continue;
    if (!employee.user?.roles?.some((role) => role.code === 'GRO' && role.tenantId === tenantId)) continue;
    for (const assignment of employee.assignments ?? []) {
      if (assignment.isCurrentAssignment) missing.delete(assignment.department);
    }
  }
  return Array.from(missing);
}
