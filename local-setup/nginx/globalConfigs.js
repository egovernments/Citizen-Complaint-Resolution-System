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
  var localeDefault = "en_IN";
  var mdmsContext = "mdms-v2";
  var hrmsContext = "egov-hrms";
  var invalidEmployeeRoles = ["SYSTEM"];

  var getConfig = function (key) {
    if (key === "STATE_LEVEL_TENANT_ID") {
      return stateTenantId;
    } else if (key === "GMAPS_API_KEY") {
      return gmaps_api_key;
    } else if (key === "FIN_ENV") {
      return finEnv;
    } else if (key === "ENABLE_SINGLEINSTANCE") {
      return centralInstanceEnabled;
    } else if (key === "DIGIT_FOOTER_BW") {
      return footerBWLogoURL;
    } else if (key === "DIGIT_FOOTER") {
      return footerLogoURL;
    } else if (key === "DIGIT_HOME_URL") {
      return digitHomeURL;
    } else if (key === "S3BUCKET") {
      return assetS3Bucket;
    } else if (key === "JWT_TOKEN") {
      return "ZWdvdi11c2VyLWNsaWVudDo=";
    } else if (key === "CONTEXT_PATH") {
      return contextPath;
    } else if (key === "UICONFIG_MODULENAME") {
      return configModuleName;
    } else if (key === "LOCALE_REGION") {
      return localeRegion;
    } else if (key === "LOCALE_DEFAULT") {
      return localeDefault;
    } else if (key === "MDMS_CONTEXT_PATH") {
      return mdmsContext;
    } else if (key === "MDMS_V2_CONTEXT_PATH") {
      return mdmsContext;
    } else if (key === "MDMS_V1_CONTEXT_PATH") {
      return mdmsContext;
    } else if (key === "HRMS_CONTEXT_PATH") {
      return hrmsContext;
    } else if (key === "INVALIDROLES") {
      return invalidEmployeeRoles;
    }
  };

  return {
    getConfig,
  };
})();
