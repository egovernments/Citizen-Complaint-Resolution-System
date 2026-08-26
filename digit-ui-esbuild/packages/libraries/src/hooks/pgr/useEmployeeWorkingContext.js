import { useQuery } from "react-query";

/**
 * The logged-in employee's working context — tenant, departments, roles,
 * normalized role contexts and jurisdictions (CCRS#1833).
 *
 * Sourced from pgr-services rather than assembled in the UI: the backend owns
 * the role -> role-context mapping (RESOLVER / CITIZEN / ADMIN) and filters
 * assignments to the current one, so the same classification is used wherever
 * it is displayed. The employee is taken from the auth token, never from a uuid
 * the client supplies.
 *
 * Returns `data.WorkingContext`, or `null` when the employee has no HRMS record
 * (`available: false`) — callers render nothing in that case rather than a
 * half-populated block.
 */
const useEmployeeWorkingContext = (tenantId, config = {}) => {
  const user = Digit.UserService.getUser();
  const isEmployee = user?.info?.type === "EMPLOYEE";
  const userUuid = user?.info?.uuid;

  return useQuery(
    ["EMPLOYEE_WORKING_CONTEXT", tenantId, userUuid],
    async () => {
      const response = await Digit.PGRService.employeeContext(tenantId);
      const context = response?.WorkingContext;
      if (!context || context.available === false) return null;
      return context;
    },
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      // One retry only, and never on a 4xx: the endpoint is absent until #1858
      // lands and retrying a missing route just doubles the noise.
      retry: 0,
      ...config,
      // Spread last so a caller can narrow the guard but never widen it —
      // otherwise `enabled` from config drops the employee/uuid checks and a
      // citizen-typed token on an /employee route fires this POST.
      enabled: !!tenantId && !!userUuid && isEmployee && (config.enabled ?? true),
    }
  );
};

export default useEmployeeWorkingContext;
