/**
 * Canonical policy for the self-scoped employee working-context endpoint.
 *
 * This action deliberately has no ACCESSCONTROL-ROLEACTIONS grants. The
 * access-control policy resolver evaluates the authenticated principal's type,
 * so every HRMS-created employee is eligible regardless of functional roles.
 */
export const EMPLOYEE_CONTEXT_ACTION_ID = 2635;

export const EMPLOYEE_CONTEXT_CONDITION: Record<string, unknown> = {
  '==': [{ var: 'user.type' }, 'EMPLOYEE'],
};

export const EMPLOYEE_CONTEXT_ACTION: Record<string, unknown> = {
  id: EMPLOYEE_CONTEXT_ACTION_ID,
  url: '/pgr-services/v2/employee/_context',
  code: 'null',
  name: 'Employee Working Context',
  path: '',
  enabled: false,
  displayName: 'View own employee working context',
  orderNumber: 0,
  serviceCode: 'pgr-services',
  parentModule: '',
  method: 'POST',
  condition: EMPLOYEE_CONTEXT_CONDITION,
};

export type EmployeeContextPolicyReconciliation =
  | { kind: 'create'; data: Record<string, unknown> }
  | { kind: 'update'; data: Record<string, unknown> }
  | { kind: 'current' }
  | { kind: 'conflict'; reason: string };

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Reconcile the legacy, condition-less action added by #1867 without silently
 * overwriting an operator-authored policy. A conflicting condition is a hard
 * bootstrap finding because silently accepting it could broaden access.
 */
export function reconcileEmployeeContextPolicy(
  existing?: Record<string, unknown>,
): EmployeeContextPolicyReconciliation {
  if (!existing) {
    return { kind: 'create', data: { ...EMPLOYEE_CONTEXT_ACTION } };
  }

  if (existing.url !== EMPLOYEE_CONTEXT_ACTION.url) {
    return {
      kind: 'conflict',
      reason: `action ${EMPLOYEE_CONTEXT_ACTION_ID} is bound to unexpected URL "${String(existing.url)}"`,
    };
  }

  if (existing.condition != null && !sameJson(existing.condition, EMPLOYEE_CONTEXT_CONDITION)) {
    return {
      kind: 'conflict',
      reason: `action ${EMPLOYEE_CONTEXT_ACTION_ID} has a non-canonical condition`,
    };
  }

  if (existing.condition == null || existing.method !== 'POST') {
    return {
      kind: 'update',
      data: {
        ...existing,
        method: 'POST',
        condition: EMPLOYEE_CONTEXT_CONDITION,
      },
    };
  }

  return { kind: 'current' };
}
