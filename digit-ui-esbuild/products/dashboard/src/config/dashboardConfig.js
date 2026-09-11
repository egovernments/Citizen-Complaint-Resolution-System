import { isPublicDashboardRuntime } from "../services/dashboardRuntime";

/**
 * Default brand palette — override per tenant via globalConfigs (see keys below).
 * Defaults mirror the canonical palette tokens (--primary / --chrome /
 * --chrome-muted) defined in styles/input.css so unbranded tenants stay
 * consistent with the standardized theme.
 */
export const DEFAULT_BRAND_THEME = {
  teal: "lab(35.8817% -24.1734 -2.46631)",
  dark: "lab(12.1586% -9.80562 -2.97114)",
  slate: "lab(56.1186% -6.32274 -2.64311)",
};

export const DASHBOARD_FONT_FAMILY =
  "Inter, Roboto, ui-sans-serif, system-ui, sans-serif";

export function getTenantId() {
  return (
    window.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID") ||
    process.env.REACT_APP_STATE_LEVEL_TENANT_ID ||
    "default"
  );
}

export function getBrandTheme() {
  const get = window.globalConfigs?.getConfig?.bind(window.globalConfigs);
  return {
    teal: get?.("DASHBOARD_BRAND_PRIMARY") || DEFAULT_BRAND_THEME.teal,
    dark: get?.("DASHBOARD_BRAND_DARK") || DEFAULT_BRAND_THEME.dark,
    slate: get?.("DASHBOARD_BRAND_SLATE") || DEFAULT_BRAND_THEME.slate,
  };
}

export function getStateLabel() {
  return (
    window.globalConfigs?.getConfig("DASHBOARD_STATE_LABEL") ||
    window.globalConfigs?.getConfig("STATE_NAME") ||
    "State"
  );
}

export function getProductLabel() {
  return (
    window.globalConfigs?.getConfig("DASHBOARD_PRODUCT_LABEL") ||
    "Complaint Resolution"
  );
}

export function getSystemTitle() {
  const configured = window.globalConfigs?.getConfig("DASHBOARD_SYSTEM_TITLE");
  if (configured) return configured;
  return `${getStateLabel()} — ${getProductLabel()} System`;
}

// The anonymous public page persists under its own `-public` suffix (#1797):
// a visitor's filter selection must survive a reload, but may never read or
// overwrite the employee slot a logged-in user on the same browser relies on.
const publicSuffix = () => (isPublicDashboardRuntime() ? "-public" : "");

export function getLayoutStorageKey() {
  return `${getTenantId()}-supervisor-dashboard-layout-v31${publicSuffix()}`;
}

export function getSubMetricStorageKey() {
  return `${getTenantId()}-supervisor-dashboard-submetrics-v1${publicSuffix()}`;
}

export function getFiltersStorageKey() {
  return `${getTenantId()}-supervisor-dashboard-filters-v4${publicSuffix()}`;
}
