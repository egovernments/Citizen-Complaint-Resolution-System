import React from "react";
import { useTranslation } from "react-i18next";
import ImageComponent from "./ImageComponent";
import { ERROR_IMAGE_FALLBACK } from "./errorImageFallback";

// buttonInfo is CORE_ERROR_GO_HOME, not the shared ACTION_TEST_HOME: that key is
// also the employee/dashboard breadcrumb's "Home" crumb, so the two surfaces
// cannot be worded independently while they share it — and a tenant that seeded
// ACTION_TEST_HOME with its portal NAME (Mozambique seeded "Fala Cidadão") then
// renders a button that reads like a title with no hint that it navigates.
const ErrorConfig = {
  error: {
    imgUrl: `https://digit-ui-assets.s3.ap-south-1.amazonaws.com/error-image.png`,
    infoMessage: "CORE_SOMETHING_WENT_WRONG",
    buttonInfo: "CORE_ERROR_GO_HOME",
  },
  maintenance: {
    imgUrl: `https://digit-ui-assets.s3.ap-south-1.amazonaws.com/maintainence-image.png`,
    infoMessage: "CORE_UNDER_MAINTENANCE",
    buttonInfo: "CORE_ERROR_GO_HOME",
  },
  notfound: {
    imgUrl: `https://digit-ui-assets.s3.ap-south-1.amazonaws.com/PageNotFound.png`,
    infoMessage: "MODULE_NOT_FOUND",
    buttonInfo: "CORE_ERROR_GO_HOME",
  },
};

const ModuleBasedErrorConfig = {
  sandbox: {
    imgUrl: `https://digit-ui-assets.s3.ap-south-1.amazonaws.com/error-image.png`,
    infoMessage: "WRONG_TENANT_SIGN_UP",
    buttonInfo: "CREATE_TENANT_ERROR_BUTTON",
  },
};

const ErrorComponent = (props) => {
  const { type = "error" } = Digit.Hooks.useQueryParams();
  const module = props?.errorData?.module;
  const { t } = useTranslation();
  const config = module ? ModuleBasedErrorConfig[module] : ErrorConfig[type];
  const stateInfo = props.stateInfo;

  return (
    <div className="error-boundary">
      <div className="error-container">
        <ImageComponent src={config.imgUrl} alt="error" fallbackSrc={ERROR_IMAGE_FALLBACK} />
        <h1>{t(config.infoMessage)}</h1>
        <button
          onClick={() => {
            if (module && props?.errorData?.action) {
              props.errorData.action();
            } else if (props.goToHome) {
              props.goToHome();
            } else {
              window.location.href = `/${window?.contextPath}/citizen`;
            }
          }}
        >
          {t(config.buttonInfo)}
        </button>
      </div>
    </div>
  );
};

export default ErrorComponent;
