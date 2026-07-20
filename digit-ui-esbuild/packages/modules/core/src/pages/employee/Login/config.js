export const loginConfig = [
  {
    texts: {
      header: "CORE_COMMON_LOGIN",
      submitButtonLabel: "CORE_COMMON_LOGIN",
      secondaryButtonLabel: "CORE_COMMON_FORGOT_PASSWORD",
    },
    inputs: [
      {
        label: "CORE_LOGIN_USERNAME",
        type: "text",
        key: "username",
        isMandatory: true,
        populators: {
          name: "username",
          validation: {
            required: true,
          },
          error: "ERR_USERNAME_REQUIRED",
        },
      },
      {
        label: "CORE_LOGIN_PASSWORD",
        type: "password",
        key: "password",
        isMandatory: true,
        populators: {
          name: "password",
          validation: {
            required: true,
          },
          error: "ERR_PASSWORD_REQUIRED",
        },
      },
    {
        isMandatory: true,
        type: "dropdown",
        key: "city",
        // Label key resolves to "County" on naipepea via the
        // rainmaker-common localization override (CCRS#443 sub-2).
        // Other deployments still get the historical "City" string.
        label: "CORE_COMMON_CITY",
        disable: false,
        populators: {
          name: "city",
          optionsKey: "name",
          error: "ERR_HRMS_INVALID_CITY",
          mdmsConfig: {
            masterName: "tenants",
            moduleName: "tenant",
            localePrefix: "TENANT_TENANTS",
            // The dropdown was showing every Kenya tenant
            // (ke.nairobi, ke.bomet, ke.eldoret, …) plus the root
            // "Kenya" placeholder. On a single-county deployment
            // operators only ever pick one — surface that as the
            // single option (or hide the picker) by reading a
            // `LOGIN_TENANT_ALLOWLIST` from globalConfigs. When set,
            // the dropdown is filtered to those codes; when absent,
            // the historical "all tenants" behaviour is preserved
            // (CCRS#443 sub-1).
            select:
              "(data)=>{ const all=Array.isArray(data['tenant'].tenants)?Digit.Utils.getUnique(data['tenant'].tenants):[]; const allow=window?.globalConfigs?.getConfig?.('LOGIN_TENANT_ALLOWLIST'); const filtered=Array.isArray(allow)&&allow.length>0?all.filter(t=>allow.includes(t.code)):all; return filtered.map(ele=>({code:ele.code,name:Digit.Utils.locale.getTransformedLocale('TENANT_TENANTS_'+ele.code)}))}",
          },
        },
      },
      {
        key: "check",
        type: "component",
        disable: false,
        component: "PrivacyComponent",
        populators: {
          name: "check"
        },
        customProps: {
          module: "HCM"
        },
        isMandatory: false,
        withoutLabel: true
      },
    ],
  },
];
