/**
 * Public (unauthenticated) dashboard entry.
 *
 * A second esbuild entry over the SAME products/dashboard source tree that the
 * employee app mounts at /employee/dashboard — not a fork. The only difference
 * is the mount: `mode="public"` skips the standalone login gate, so requests go
 * out with no authToken/userInfo and the backend's PUBLIC floor decides what
 * comes back (see AnalyticsService.extractRoles → PUBLIC).
 *
 * Deliberately does NOT call initLibraries(): with no window.Digit runtime the
 * dashboard's own fallbacks engage, which is exactly what a public page wants —
 *   - useDashboardConfig  → { config: null, loading: false } (no MDMS gate)
 *   - i18n/localeRuntime  → standalone branch, fetches message bundles straight
 *                           from /localization/messages/v1/_search
 * The subtree pulls in no @egovernments modules, no react-router and no Digit
 * services, so this stays a small independent bundle.
 *
 * Tenant: the page lives at /<slug>/digit-ui/public-dashboard and shows THAT
 * workspace's dashboard. The slug is resolved through the Identity BFF before
 * the first render (see publicDashboardTenant.js); an unresolvable slug shows
 * an unavailable page and never falls back to STATE_LEVEL_TENANT_ID.
 *
 * Served from the same /digit-ui/ docroot as the employee build (so hashed
 * assets resolve against one publicPath) at public-dashboard.html. Nginx gives it the
 * canonical friendly URL /digit-ui/public-dashboard (with /dashboard retained as an alias)
 * rather than adding a second docroot.
 *
 * The analytics read paths this page calls are explicitly auth-optional on Kong,
 * so anonymous access is a declared compose/Ansible contract rather than a side
 * effect of Kong's audit mode. Kubernetes' Spring mixed-mode gateway is
 * deliberately not opened: unlike Kong, it does not strip spoofed userInfo from
 * anonymous bodies. The actual data boundary remains server-side.
 */
import React from "react";
import ReactDOM from "react-dom";
import AdminDashboard from "../products/dashboard/src/AdminDashboard";
import { configurePublicDashboardRuntime } from "../products/dashboard/src/services/dashboardRuntime";
import { resolvePublicDashboardTenant } from "./publicDashboardTenant";
import { applyTheme } from "./theme/applyTheme";
import cmsBlueTheme from "./theme/cms-blue.json";

// The page has no tenant theme of its own (there is nothing to pick one with),
// so it wears CMS Blue: the top bar in its header navy, the buttons in its
// primary. Applied synchronously before render, as the employee app applies
// its theme, so the shared design tokens resolve the same way.
configurePublicDashboardRuntime();
applyTheme(cmsBlueTheme);

// Shown when the URL names a workspace that cannot be resolved. Rendering the
// dashboard here would query the deployment's state tenant instead.
const PublicTenantUnavailable = () => (
  <div style={{ maxWidth: 560, margin: "64px auto", padding: "0 16px", textAlign: "center" }}>
    <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Public dashboard is not available</h1>
    <p style={{ marginTop: 12, fontSize: 14, lineHeight: "24px", color: "#505A5F" }}>
      This dashboard link is not available.
    </p>
  </div>
);

// The dashboard must not render before the URL's workspace is known: its
// first requests read getTenantId(), which prefers the resolved route tenant.
resolvePublicDashboardTenant(window.location.pathname).then(({ unavailable }) => {
  ReactDOM.render(
    <React.StrictMode>
      {unavailable ? <PublicTenantUnavailable /> : <AdminDashboard mode="public" />}
    </React.StrictMode>,
    document.getElementById("root")
  );
});
