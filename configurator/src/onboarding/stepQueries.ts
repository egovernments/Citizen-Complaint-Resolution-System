import type { QueryClient } from '@tanstack/react-query';

/**
 * The Departments and Employees steps keep what they load in React Query,
 * keyed by workspace. Each step is its own route, so leaving one unmounts it;
 * held here, going back draws the last load at once and refreshes it behind
 * the table instead of starting again from a placeholder.
 */
export const stepKeys = {
  /**
   * Everything the steps loaded for one workspace. A save invalidates all of
   * it: the steps read each other's records (Employees names departments and
   * designations), so one step's change makes the other's load stale.
   */
  workspace: (tenant: string) => ['onboarding', tenant] as const,
  departments: (tenant: string) => ['onboarding', tenant, 'departments'] as const,
  employees: (tenant: string) => ['onboarding', tenant, 'employees'] as const,
  employeeOptions: (tenant: string) => ['onboarding', tenant, 'employee-options'] as const,
  members: (tenant: string) => ['onboarding', tenant, 'members'] as const,
};

/** Every onboarding load, for every workspace: what sign-out drops. */
export const ALL_STEP_QUERIES = ['onboarding'] as const;

export const STEP_QUERY_OPTIONS = {
  // Each visit refreshes, but behind what was already loaded.
  staleTime: 0,
  // Kept long enough to outlast time spent on the other steps.
  gcTime: 30 * 60 * 1000,
  // A failed load shows its error and Try again straight away, as it did
  // before these loads moved here, rather than after three silent retries.
  retry: false,
  refetchOnWindowFocus: false,
} as const;

/** A load's error worth showing: only when there is nothing loaded to show instead. */
export function blockingError(query: { error: unknown; data: unknown }): string | null {
  if (!query.error || query.data !== undefined) return null;
  return query.error instanceof Error ? query.error.message : String(query.error);
}

/**
 * Refresh everything the steps loaded for the workspace, on screen or not. By default
 * `invalidateQueries` refetches only what is on screen and just marks the rest stale, so a
 * step opened next drew its old load first: Employees said "create a department first" for
 * the length of its refetch right after a department was added.
 */
export function refreshWorkspace(queryClient: QueryClient, tenant: string) {
  return queryClient.invalidateQueries({ queryKey: stepKeys.workspace(tenant), refetchType: 'all' });
}
