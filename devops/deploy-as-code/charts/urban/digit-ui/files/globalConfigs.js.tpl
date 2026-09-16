// Rendered by the digit-ui Helm chart from values (see values.yaml
// `globalConfigs:`). Served same-origin at {{ .Values.globalConfigs.contextPath | default "/digit-ui" }}/globalConfigs.js.
//
// Read at boot by digit-ui (the static SPA) via a <script> tag that nginx
// injects into <head>. Every key the SPA looks up with
// Digit.Utils.getConfig(KEY) must be in the switch below, so a missing key
// is a blank page with no server-side error. Keep this file and
// values.yaml in step.
var globalConfigs = (function () {
  var stateTenantId = "{{ .Values.globalConfigs.stateTenantId }}";
  var contextPath = "{{ .Values.globalConfigs.contextPath }}";
  var gmaps_api_key = "{{ .Values.globalConfigs.gmapsApiKey }}";
  var finEnv = "{{ .Values.globalConfigs.finEnv }}";
  var centralInstanceEnabled = {{ .Values.globalConfigs.centralInstanceEnabled }};
  var footerBWLogoURL = "{{ .Values.globalConfigs.footerBWLogoURL }}";
  var footerLogoURL = "{{ .Values.globalConfigs.footerLogoURL }}";
  var digitHomeURL = "{{ .Values.globalConfigs.digitHomeURL }}";
  var assetS3Bucket = "{{ .Values.globalConfigs.assetS3Bucket }}";
  var configModuleName = "{{ .Values.globalConfigs.configModuleName }}";
  var localeRegion = "{{ .Values.globalConfigs.localeRegion }}";
  var localeDefault = "{{ .Values.globalConfigs.localeDefault }}";
  var mdmsContext = "{{ .Values.globalConfigs.mdmsContext }}";
  var hrmsContext = "{{ .Values.globalConfigs.hrmsContext }}";
  var invalidEmployeeRoles = {{ .Values.globalConfigs.invalidEmployeeRoles | toJson }};
  var authProvider = "{{ .Values.globalConfigs.authProvider }}";
  var citizenAuthProvider = "{{ .Values.globalConfigs.citizenAuthProvider }}";
  var employeeAuthProvider = "{{ .Values.globalConfigs.employeeAuthProvider }}";
  var pgrBoundaryHighestLevel = "{{ .Values.globalConfigs.pgrBoundaryHighestLevel }}";
  var pgrBoundaryLowestLevel = "{{ .Values.globalConfigs.pgrBoundaryLowestLevel }}";
  var boundaryType = "{{ .Values.globalConfigs.boundaryType }}";
  var hierarchyType = "{{ .Values.globalConfigs.hierarchyType }}";
  var complaintHierarchyType = "{{ .Values.globalConfigs.complaintHierarchyType }}";
  var mapCenter = {{ .Values.globalConfigs.mapCenter | toJson }};
  var mapTenant = "{{ .Values.globalConfigs.mapTenant }}";
  var employeeModuleDenylist = {{ .Values.globalConfigs.employeeModuleDenylist | toJson }};
  var loginTenantAllowlist = {{ .Values.globalConfigs.loginTenantAllowlist | toJson }};
  var coreMobileConfigs = {{ .Values.globalConfigs.coreMobileConfigs | toJson }};
  var corePostalConfigs = {{ .Values.globalConfigs.corePostalConfigs | toJson }};
  var dashboardMetricsEnabled = {{ .Values.globalConfigs.dashboardMetricsEnabled }};
  var keycloakUrl = "{{ .Values.globalConfigs.keycloakUrl }}";
  var keycloakRealm = "{{ .Values.globalConfigs.keycloakRealm }}";
  var keycloakClientId = "{{ .Values.globalConfigs.keycloakClientId }}";
  var tokenExchangeUrl = "{{ .Values.globalConfigs.tokenExchangeUrl }}";

  var getConfig = function (key) {
    if (key === "STATE_LEVEL_TENANT_ID") { return stateTenantId; }
    else if (key === "CONTEXT_PATH") { return contextPath; }
    else if (key === "GMAPS_API_KEY") { return gmaps_api_key; }
    else if (key === "FIN_ENV") { return finEnv; }
    else if (key === "CENTRAL_INSTANCE_ENABLED") { return centralInstanceEnabled; }
    else if (key === "FOOTER_BW_LOGO_URL") { return footerBWLogoURL; }
    else if (key === "FOOTER_LOGO_URL") { return footerLogoURL; }
    else if (key === "DIGIT_HOME_URL") { return digitHomeURL; }
    else if (key === "ASSET_S3_BUCKET") { return assetS3Bucket; }
    else if (key === "CONFIG_MODULE_NAME") { return configModuleName; }
    else if (key === "LOCALE_REGION") { return localeRegion; }
    else if (key === "LOCALE_DEFAULT") { return localeDefault; }
    else if (key === "MDMS_CONTEXT_PATH") { return mdmsContext; }
    else if (key === "HRMS_CONTEXT_PATH") { return hrmsContext; }
    else if (key === "INVALIDROLES") { return invalidEmployeeRoles; }
    else if (key === "AUTH_PROVIDER") { return authProvider; }
    else if (key === "CITIZEN_AUTH_PROVIDER") { return citizenAuthProvider; }
    else if (key === "EMPLOYEE_AUTH_PROVIDER") { return employeeAuthProvider; }
    else if (key === "PGR_BOUNDARY_HIGHEST_LEVEL") { return pgrBoundaryHighestLevel; }
    else if (key === "PGR_BOUNDARY_LOWEST_LEVEL") { return pgrBoundaryLowestLevel; }
    else if (key === "BOUNDARYTYPE") { return boundaryType; }
    else if (key === "HIERARCHY_TYPE") { return hierarchyType; }
    else if (key === "COMPLAINT_HIERARCHY_TYPE") { return complaintHierarchyType; }
    else if (key === "MAP_CENTER") { return mapCenter; }
    else if (key === "MAP_TENANT") { return mapTenant; }
    else if (key === "EMPLOYEE_MODULE_DENYLIST") { return employeeModuleDenylist; }
    else if (key === "LOGIN_TENANT_ALLOWLIST") { return loginTenantAllowlist; }
    else if (key === "CORE_MOBILE_CONFIGS") { return coreMobileConfigs; }
    else if (key === "CORE_POSTAL_CONFIGS") { return corePostalConfigs; }
    else if (key === "DASHBOARD_METRICS_ENABLED") { return dashboardMetricsEnabled; }
    else if (key === "KEYCLOAK_URL") { return keycloakUrl; }
    else if (key === "KEYCLOAK_REALM") { return keycloakRealm; }
    else if (key === "KEYCLOAK_CLIENT_ID") { return keycloakClientId; }
    else if (key === "TOKEN_EXCHANGE_URL") { return tokenExchangeUrl; }
  };

  return { getConfig };
})();
