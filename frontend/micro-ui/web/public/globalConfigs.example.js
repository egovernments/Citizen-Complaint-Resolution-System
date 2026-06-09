// Copy to globalConfigs.js for local CRA dev:
//   cp public/globalConfigs.example.js public/globalConfigs.js
// Production uses nginx/ansible-injected globalConfigs (see local-setup/nginx/).
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

  var getConfig = function (key) {
    if (key === "STATE_LEVEL_TENANT_ID") return stateTenantId;
    if (key === "GMAPS_API_KEY") return gmaps_api_key;
    if (key === "FIN_ENV") return finEnv;
    if (key === "ENABLE_SINGLEINSTANCE") return centralInstanceEnabled;
    if (key === "DIGIT_FOOTER_BW") return footerBWLogoURL;
    if (key === "DIGIT_FOOTER") return footerLogoURL;
    if (key === "DIGIT_HOME_URL") return digitHomeURL;
    if (key === "S3BUCKET") return assetS3Bucket;
    if (key === "JWT_TOKEN") return "ZWdvdi11c2VyLWNsaWVudDo=";
    if (key === "CONTEXT_PATH") return contextPath;
    if (key === "UICONFIG_MODULENAME") return configModuleName;
    if (key === "LOCALE_REGION") return localeRegion;
    if (key === "LOCALE_DEFAULT") return localeDefault;
    if (key === "MDMS_CONTEXT_PATH") return mdmsContext;
    if (key === "MDMS_V2_CONTEXT_PATH") return mdmsContext;
    if (key === "MDMS_V1_CONTEXT_PATH") return mdmsContext;
    if (key === "HRMS_CONTEXT_PATH") return hrmsContext;
    if (key === "INVALIDROLES") return invalidEmployeeRoles;
    return null;
  };

  return { getConfig };
})();
