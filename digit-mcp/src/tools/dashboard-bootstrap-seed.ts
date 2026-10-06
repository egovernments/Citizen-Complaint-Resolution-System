/**
 * Canonical employee-dashboard access floor for a newly-created tenant.
 *
 * Route discovery and every dashboard API are granted together. The browser has
 * no role allow-list: it asks /analytics/_access, so seeding action 4557 alone
 * would produce a link that immediately denies the same employee.
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

const analyticsAction = (id: number, name: string, url: string): Record<string, unknown> => ({
  id,
  name,
  url,
  displayName: name,
  orderNumber: 0,
  parentModule: '',
  enabled: false,
  serviceCode: 'pgr-services',
  code: 'null',
  path: '',
  method: 'POST',
});

/** Base capabilities required to open and use the employee dashboard. */
export const DASHBOARD_ACCESS_ACTIONS: Record<string, unknown>[] = [
  DASHBOARD_ACTION,
  analyticsAction(2640, 'Analytics Access', '/pgr-services/v2/analytics/_access'),
  analyticsAction(2641, 'Analytics Query', '/pgr-services/v2/analytics/_query'),
  analyticsAction(2642, 'Analytics Packs', '/pgr-services/v2/analytics/packs'),
  analyticsAction(2643, 'Analytics Catalog Search', '/pgr-services/v2/analytics/catalog/_search'),
  analyticsAction(2644, 'Analytics Schema', '/pgr-services/v2/analytics/_schema'),
];

/** Vinoth's action-2008 row scope, embedded for source-less tenant bootstrap. */
export const PGR_SEARCH_SCOPE_RESOURCE: Record<string, unknown> = {
  complaint: {
    scope: {
      axes: ['department', 'jurisdiction'],
      roleScopes: {
        GRO: { department: 'ALL', jurisdiction: 'OWN' },
        PGR_LME: { department: 'OWN', jurisdiction: 'OWN' },
        SUPERVISOR: { department: 'OWN', jurisdiction: 'ALL' },
      },
      default: { department: 'ALL', jurisdiction: 'OWN' },
    },
    attributes: Object.fromEntries(
      ['citizen.mobileNumber', 'citizen.name', 'citizen.userName'].map((attribute) => [
        attribute,
        {
          condition: {
            or: [
              { '==': [{ var: 'user.attributes.tenantWide' }, true] },
              { '==': [{ var: 'resource.complaint.accountId' }, { var: 'user.uuid' }] },
            ],
          },
          onDeny: { strategy: 'REDACT' },
        },
      ]),
    ),
  },
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

export function buildDashboardConfig(): Record<string, unknown> {
  return {
    id: 'default',
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

export function buildDashboardRoleAction(
  actionId: number,
  role: string,
  tenantId: string,
): Record<string, unknown> {
  return {
    actionid: actionId,
    rolecode: role,
    tenantId,
    actioncode: '',
  };
}
