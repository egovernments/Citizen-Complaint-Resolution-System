var globalConfigs = (function () {
  var stateTenantId = "pg";
  var contextPath = "digit-ui";
  var gmaps_api_key = "";
  var finEnv = "dev";
  var centralInstanceEnabled = false;
  var footerBWLogoURL = "https://s3.ap-south-1.amazonaws.com/egov-uat-assets/digit-footer-bw.png";
  var footerLogoURL = "https://s3.ap-south-1.amazonaws.com/egov-uat-assets/digit-footer.png";
  var digitHomeURL = "https://www.digit.org/";
  var assetS3Bucket = "pg-egov-assets";
  var configModuleName = "commonMDMSConfig";
  var localeRegion = "IN";
  var localeDefault = "en";
  var mdmsContext = "mdms-v2";
  var hrmsContext = "egov-hrms";
  var invalidEmployeeRoles = ["SYSTEM"];

  // Keycloak auth adapter config
  var authProvider = "keycloak";
  var keycloakUrl = "";  // same origin — resolved at runtime
  var keycloakRealm = "digit-sandbox";
  var keycloakClientId = "digit-sandbox-ui";
  var tokenExchangeUrl = "";  // same origin — API calls go through nginx

  // Runtime locale fallback for local setup
  try {
    var parseMaybeJSON = function (value) {
      if (!value || value === "undefined" || value === "null") return null;
      try { return JSON.parse(value); } catch (e) { return value; }
    };

    var employeeTenant = window.localStorage.getItem("Employee.tenant-id");
    if (!employeeTenant) {
      var employeeInfo = parseMaybeJSON(window.localStorage.getItem("Employee.user-info"));
      var employeeInfoTenant = employeeInfo && (employeeInfo.tenantId || employeeInfo.tenantid);
      if (employeeInfoTenant) window.localStorage.setItem("Employee.tenant-id", employeeInfoTenant);
    }

    var citizenTenant = window.localStorage.getItem("Citizen.tenant-id");
    if (!citizenTenant) {
      var citizenInfo = parseMaybeJSON(window.localStorage.getItem("Citizen.user-info"));
      var citizenInfoTenant = citizenInfo && (citizenInfo.tenantId || citizenInfo.tenantid);
      if (citizenInfoTenant) window.localStorage.setItem("Citizen.tenant-id", citizenInfoTenant);
    }

    var current = window.localStorage.getItem("selectedLanguage") || window.localStorage.getItem("locale");
    if (!current || current === "undefined" || current === "null") {
      window.localStorage.setItem("selectedLanguage", localeDefault);
      window.localStorage.setItem("locale", localeDefault);
      window.localStorage.setItem("i18nextLng", localeDefault);
    }
  } catch (e) {}

  // Resolve keycloakUrl at runtime from window.location.origin
  try {
    keycloakUrl = window.location.origin;
  } catch (e) {}


  // Keycloak mode: intercept SPA navigation to citizen/employee login
  try {
    if (authProvider === 'keycloak') {
      var loginPaths = ['/citizen/login', '/employee/login', '/employee/user/login'];
      var isLoginPath = function(p) {
        return p && loginPaths.some(function(lp) { return p.includes(lp); });
      };
      var origPushState = history.pushState;
      history.pushState = function() {
        origPushState.apply(this, arguments);
        if (isLoginPath(arguments[2])) {
          window.location.replace(window.location.origin + '/digit-ui/user/login');
        }
      };
      var origReplaceState = history.replaceState;
      history.replaceState = function() {
        origReplaceState.apply(this, arguments);
        if (isLoginPath(arguments[2])) {
          window.location.replace(window.location.origin + '/digit-ui/user/login');
        }
      };
      // Also check on initial page load
      if (isLoginPath(window.location.pathname)) {
        window.location.replace(window.location.origin + '/digit-ui/user/login');
      }
    }
  } catch(e) {}

    // Boundary hierarchy config for generic boundary component
  var pgrBoundaryLowestLevel = "Locality";
  var pgrBoundaryHighestLevel = "City";
  var hierarchyType = "ADMIN";
  var boundaryType = "Locality";

  var getConfig = function (key) {
    if (key === "STATE_LEVEL_TENANT_ID") return stateTenantId;
    else if (key === "GMAPS_API_KEY") return gmaps_api_key;
    else if (key === "FIN_ENV") return finEnv;
    else if (key === "ENABLE_SINGLEINSTANCE") return centralInstanceEnabled;
    else if (key === "DIGIT_FOOTER_BW") return footerBWLogoURL;
    else if (key === "DIGIT_FOOTER") return footerLogoURL;
    else if (key === "DIGIT_HOME_URL") return digitHomeURL;
    else if (key === "S3BUCKET") return assetS3Bucket;
    else if (key === "JWT_TOKEN") return "ZWdvdi11c2VyLWNsaWVudDo=";
    else if (key === "CONTEXT_PATH") return contextPath;
    else if (key === "UICONFIG_MODULENAME") return configModuleName;
    else if (key === "LOCALE_REGION") return localeRegion;
    else if (key === "LOCALE_DEFAULT") return localeDefault;
    else if (key === "MDMS_CONTEXT_PATH") return mdmsContext;
    else if (key === "MDMS_V2_CONTEXT_PATH") return mdmsContext;
    else if (key === "MDMS_V1_CONTEXT_PATH") return mdmsContext;
    else if (key === "HRMS_CONTEXT_PATH") return hrmsContext;
    else if (key === "INVALIDROLES") return invalidEmployeeRoles;
    // Keycloak adapter keys
    else if (key === "AUTH_PROVIDER") return authProvider;
    else if (key === "KEYCLOAK_URL") return keycloakUrl;
    else if (key === "KEYCLOAK_REALM") return keycloakRealm;
    else if (key === "KEYCLOAK_CLIENT_ID") return keycloakClientId;
    else if (key === "TOKEN_EXCHANGE_URL") return tokenExchangeUrl;
    else if (key === "PGR_BOUNDARY_LOWEST_LEVEL") return pgrBoundaryLowestLevel;
    else if (key === "PGR_BOUNDARY_HIGHEST_LEVEL") return pgrBoundaryHighestLevel;
    else if (key === "HIERARCHY_TYPE") return hierarchyType;
    else if (key === "BOUNDARY_TYPE") return boundaryType;
  };

  return {
    getConfig,
  };
})();
