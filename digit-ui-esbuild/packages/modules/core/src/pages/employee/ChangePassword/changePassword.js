import { CardSubHeader, FormComposer,CardText} from "@egovernments/digit-ui-react-components";
import { BackLink,Toast} from "@egovernments/digit-ui-components";
import { DEFAULT_MOBILE_PREFIX } from "@egovernments/digit-ui-libraries";
import PropTypes from "prop-types";
import React, { useEffect, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import Background from "../../../components/Background";
import Header from "../../../components/Header";
import SelectOtp from "../../citizen/Login/SelectOtp";
import ImageComponent from "../../../components/ImageComponent";

const ChangePasswordComponent = ({ config: propsConfig, t }) => {
  const [user, setUser] = useState(null);
  const { USERNAME: userName, tenantId } = Digit.Hooks.useQueryParams();
  const history = useHistory();
  // Set by Forgot Password from the _send response. Only otp-publisher
  // returns it, so the page falls back to generic copy without it.
  const maskedMobileNumber = useLocation().state?.maskedMobileNumber;
  const stateId = window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
  // Priority: MDMS common-masters.MobileNumberValidation → globalConfigs.CORE_MOBILE_CONFIGS → constants fallback.
  const { data: mdmsCountryCode } = Digit.Hooks.useCustomMDMS(
    stateId,
    "common-masters",
    [{ name: "MobileNumberValidation" }],
    {
      select: (data) => {
        const list = data?.["common-masters"]?.MobileNumberValidation || [];
        const record =
          list.find((x) => x.default === true && x.isActive !== false) ||
          list.find((x) => x.isActive !== false) ||
          null;
        return record?.countryCode || null;
      },
      staleTime: 300000,
      enabled: !!stateId && !!maskedMobileNumber,
    }
  );
  const countryCode =
    mdmsCountryCode || window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS")?.countryCode || DEFAULT_MOBILE_PREFIX;
  const [otp, setOtp] = useState("");
  const [isOtpValid, setIsOtpValid] = useState(true);
  const [showToast, setShowToast] = useState(null);
  const getUserType = () => Digit.UserService.getType();
  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
  };
  useEffect(() => {
    if (!user) {
      Digit.UserService.setType("employee");
      return;
    }
    Digit.UserService.setUser(user);
    const redirectPath = location.state?.from || `/${window?.contextPath}/employee`;
    history.replace(redirectPath);
  }, [user]);

  const closeToast = () => {
    setShowToast(null);
  };

  const onResendOTP = async () => {
    const requestData = {
      otp: {
        userName,
        userType: getUserType().toUpperCase(),
        type: "passwordreset",
        tenantId,
      },
    };

    try {
      await Digit.UserService.sendOtp(requestData, tenantId);
      setShowToast(t("ES_OTP_RESEND"));
    } catch (err) {
      setShowToast(err?.response?.data?.error_description || t("ES_INVALID_LOGIN_CREDENTIALS"));
    }
    setTimeout(closeToast, 5000);
  };

  const onChangePassword = async (data) => {
    try {
      if (data.newPassword !== data.confirmPassword) {
        return setShowToast(t("ERR_PASSWORD_DO_NOT_MATCH"));
      }
      const requestData = {
        ...data,
        otpReference: otp,
        tenantId,
        type: getUserType().toUpperCase(),
      };

      const response = await Digit.UserService.changePassword(requestData, tenantId);
      navigateToLogin();
    } catch (err) {
      setShowToast(err?.response?.data?.error?.fields?.[0]?.message || t("ES_SOMETHING_WRONG"));
      setTimeout(closeToast, 5000);
    }
  };

  const navigateToLogin = () => {
    history.replace(`/${window?.contextPath}/employee/user/login`);
  };

  const [username, password, confirmPassword] = propsConfig.inputs;
  const config = [
    {
      body: [
        {
          label: t(username.label),
          type: username.type,
          populators: {
            name: username.name,
          },
          isMandatory: true,
        },
        {
          label: t(password.label),
          type: password.type,
          populators: {
            name: password.name,
          },
          isMandatory: true,
        },
        {
          label: t(confirmPassword.label),
          type: confirmPassword.type,
          populators: {
            name: confirmPassword.name,
          },
          isMandatory: true,
        },
      ],
    },
  ];

  return (
    <Background>
      <div className="employeeBackbuttonAlign">
        <BackLink variant="primary" style={{ borderBottom: "none" }} />
      </div>
      <FormComposer
        onSubmit={onChangePassword}
        noBoxShadow
        inline
        submitInForm
        config={config}
        defaultValues={{ [username.name]: userName || "" }}
        label={propsConfig.texts.submitButtonLabel}
        cardStyle={{ maxWidth: "408px", margin: "auto" }}
        className="employeeChangePassword"
      >
        <Header />
        <CardSubHeader style={{ textAlign: "center" }}> {propsConfig.texts.header} </CardSubHeader>
        {maskedMobileNumber ? (
          <CardText>
            {`${tr("CS_LOGIN_OTP_TEXT", "Enter the OTP sent to")} `}
            <b>{`${countryCode} ${maskedMobileNumber}`}</b>
          </CardText>
        ) : (
          <CardText>{tr("CORE_EMPLOYEE_OTP_CHECK_MESSAGE", "Please check your messages for the OTP & then set a new password.")}</CardText>
        )}
        <SelectOtp t={t} userType="employee" otp={otp} onOtpChange={setOtp} error={isOtpValid} onResend={onResendOTP} />
        {/* <div>
          <CardLabel style={{ marginBottom: "8px" }}>{t("CORE_OTP_SENT_MESSAGE")}</CardLabel>
          <CardLabelDesc style={{ marginBottom: "0px" }}> {mobileNumber} </CardLabelDesc>
          <CardLabelDesc style={{ marginBottom: "8px" }}> {t("CORE_EMPLOYEE_OTP_CHECK_MESSAGE")}</CardLabelDesc>
        </div>
        <CardLabel style={{ marginBottom: "8px" }}>{t("CORE_OTP_OTP")} *</CardLabel>
        <TextInput className="field" name={otpReference} isRequired={true} onChange={updateOtp} type={"text"} style={{ marginBottom: "10px" }} />
        <div className="flex-right">
          <div className="primary-label-btn" onClick={onResendOTP}>
            {t("CORE_OTP_RESEND")}
          </div>
        </div> */}
      </FormComposer>
      {showToast && <Toast type={"error"} label={t(showToast)} onClose={closeToast} />}
      <div className="EmployeeLoginFooter">
        <ImageComponent
          alt="Powered by DIGIT"
          src={window?.globalConfigs?.getConfig?.("DIGIT_FOOTER_BW")}
          style={{ cursor: "pointer" }}
          onClick={() => {
            window.open(window?.globalConfigs?.getConfig?.("DIGIT_HOME_URL"), "_blank").focus();
          }}
        />{" "}
      </div>
    </Background>
  );
};

ChangePasswordComponent.propTypes = {
  loginParams: PropTypes.any,
};

ChangePasswordComponent.defaultProps = {
  loginParams: null,
};

export default ChangePasswordComponent;
