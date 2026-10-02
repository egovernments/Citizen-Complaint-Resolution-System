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
