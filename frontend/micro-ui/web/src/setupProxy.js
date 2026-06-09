const { createProxyMiddleware } = require("http-proxy-middleware");

const proxyTarget = process.env.REACT_APP_PROXY_URL;
const isLocalTunnel = proxyTarget && /localhost|127\.0\.0\.1/.test(proxyTarget);

function hostFromTarget(target) {
  if (!target) return null;
  try {
    return new URL(target).host;
  } catch {
    return null;
  }
}

const proxyHost =
  process.env.REACT_APP_PROXY_HOST || hostFromTarget(proxyTarget);

const onProxyReq = (proxyReq) => {
  if (isLocalTunnel && proxyHost) {
    proxyReq.setHeader("host", proxyHost);
  }
};

const createProxy = proxyTarget
  ? createProxyMiddleware({
      target: proxyTarget,
      changeOrigin: true,
      secure: !isLocalTunnel,
      onProxyReq,
    })
  : null;

// Browser path must match REACT_APP_ANALYTICS_BASE (see analyticsService.js).
// Public /api/analytics may require HTTP Basic Auth on some deployments.
// For local dev, SSH-tunnel local 18280 to your Kong gateway / analytics service.
const analyticsBrowserPath = (
  process.env.REACT_APP_ANALYTICS_BASE || "/pgr-analytics"
).replace(/\/$/, "");
const analyticsProxyTarget =
  process.env.ANALYTICS_PROXY_URL || "http://127.0.0.1:18280";
const analyticsUsesInternalPort = /127\.0\.0\.1:18280|localhost:18280/.test(
  analyticsProxyTarget
);
const analyticsPathKey = `^${analyticsBrowserPath}`;

const analyticsProxy = createProxyMiddleware({
  target: analyticsProxyTarget,
  changeOrigin: !analyticsUsesInternalPort,
  secure: !analyticsUsesInternalPort && !isLocalTunnel,
  pathRewrite: analyticsUsesInternalPort
    ? { [analyticsPathKey]: "/pgr-services/v2/analytics" }
    : { [analyticsPathKey]: "/api/analytics" },
  onProxyReq: (proxyReq) => {
    if (isLocalTunnel && proxyHost) {
      proxyReq.setHeader("host", proxyHost);
    }
    if (!analyticsUsesInternalPort) {
      const user = process.env.ANALYTICS_BASIC_USER;
      const pass = process.env.ANALYTICS_BASIC_PASSWORD;
      if (user && pass) {
        const token = Buffer.from(`${user}:${pass}`).toString("base64");
        proxyReq.setHeader("Authorization", `Basic ${token}`);
      }
    }
  },
});

module.exports = function (app) {
  if (!/^https?:\/\//i.test(analyticsBrowserPath)) {
    app.use(analyticsBrowserPath, analyticsProxy);
  }

  if (!createProxy) {
    return;
  }

  [
    "/egov-mdms-service",
    "/egov-location",
    "/localization",
    "/egov-workflow-v2",
    "/inbox",
    "/pgr-services",
    "/filestore",
    "/egov-hrms",
    "/user-otp",
    "/user",
    "/fsm",
    "/billing-service",
    "/collection-services",
    "/pdf-service",
    "/pg-service",
    "/vehicle",
    "/vendor",
    "/property-services",
    "/fsm-calculator/v1/billingSlab/_search",
    "/muster-roll",
    "/service-request",
    "/mdms-v2",
    "/tenant-management",
    "/boundary-service",
    "/default-data-handler",
    "/user-preference",
    "/config-service",
  ].forEach((location) => app.use(location, createProxy));
};
