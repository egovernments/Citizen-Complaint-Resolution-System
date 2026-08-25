/**
 * Canonical employee-dashboard access floor for a newly-created tenant.
 *
 * Keep this deliberately narrower than the dashboard UI's backwards-compatible
 * fallback role list. These are the roles that the platform's reference access
 * data already grants action 4557 to. Operators can override the list through
 * tenant_bootstrap/dashboard_allowed_roles without editing the seed itself.
 */
export const DEFAULT_DASHBOARD_ROLES = [
  'SUPERVISOR',
  'GRO',
  'DGRO',
  'SUPERUSER',
] as const;

export const DASHBOARD_ACTION_ID = 4557;

export const DASHBOARD_ACTION: Record<string, unknown> = {
  id: DASHBOARD_ACTION_ID,
  url: 'url',
  name: 'Dashboard',
  path: 'Dashboard',
  enabled: true,
  leftIcon: 'action:dashboard',
  rightIcon: '',
  displayName: 'Dashboard',
  orderNumber: 2,
  queryParams: '',
  serviceCode: 'DASHBOARD',
  parentModule: '',
  navigationURL: '/digit-ui/employee/dashboard',
};

export function normalizeDashboardRoles(value: unknown): string[] {
  const roles = value === undefined
    ? [...DEFAULT_DASHBOARD_ROLES]
    : Array.isArray(value)
      ? value
      : [];

  const normalized = [...new Set(roles.map((role) => String(role).trim().toUpperCase()))]
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new Error('dashboard_roles must contain at least one role code');
  }
  const invalid = normalized.find((role) => !/^[A-Z0-9_-]+$/.test(role));
  if (invalid) {
    throw new Error(`dashboard_roles contains an invalid role code: "${invalid}"`);
  }
  return normalized;
}

export function buildDashboardConfig(roles: string[]): Record<string, unknown> {
  return {
    id: 'default',
    allowedRoles: [...roles],
    numberFormat: {
      en_IN: '#,##0.00',
      pt_PT: '#.##0,00',
      fr_FR: '# ##0,00',
      default: '#,##0.00',
    },
    // The 0→1 access floor is intentionally employee-only. Public dashboard
    // exposure is a separate operator decision and must not be implied by
    // granting a small authenticated role set.
    publicDashboardEnabled: false,
  };
}

export function buildDashboardRoleAction(role: string, tenantId: string): Record<string, unknown> {
  return {
    actionid: DASHBOARD_ACTION_ID,
    rolecode: role,
    tenantId,
    actioncode: '',
  };
}
