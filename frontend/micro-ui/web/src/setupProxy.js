const { createProxyMiddleware } = require("http-proxy-middleware");

// Use HTTPS to Bomet directly. http://127.0.0.1:18000 (SSH tunnel :80) gets 301 → empty city list.
const proxyTarget =
  process.env.REACT_APP_PROXY_URL || "https://bometfeedbackhub.digit.org";
const isLocalTunnel = /localhost|127\.0\.0\.1/.test(proxyTarget);

const onProxyReq = (proxyReq) => {
  if (isLocalTunnel) {
    proxyReq.setHeader("host", "bometfeedbackhub.digit.org");
  }
};

const createProxy = createProxyMiddleware({
  target: proxyTarget,
  changeOrigin: true,
  secure: !isLocalTunnel,
  onProxyReq,
});

// Browser path must match REACT_APP_ANALYTICS_BASE (see analyticsService.js).
// Public /api/analytics is behind nginx HTTP Basic Auth (realm "bomet analytics"),
// which triggers a browser sign-in loop on 401. On Bomet, analytics is on Kong
// at 127.0.0.1:18000 (/pgr-services/v2/analytics). Tunnel local 18280 there:
//   ssh -N -L 18280:127.0.0.1:18000 bomet
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
    onProxyReq(proxyReq);
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

  [
    "/egov-mdms-service",
    "/egov-location",
    "/localization",
    "/egov-workflow-v2",
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
