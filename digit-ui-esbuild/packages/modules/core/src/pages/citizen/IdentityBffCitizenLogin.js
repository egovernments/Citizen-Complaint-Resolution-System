import React, { useMemo, useState } from "react";
import { Loader } from "@egovernments/digit-ui-components";
import {
  establishIdentityBffSession,
  fetchCitizenSigninMethods,
  fillMessage,
  sendCitizenOtp,
  verifyCitizenOtp,
} from "@egovernments/digit-ui-libraries";

import { SignInFailureCard, useIdentityBffSignIn } from "../../components/IdentityBffSignIn";
import { setCitizenDetail } from "../../components/citizenSession";
import { loginSteps } from "../../components/IdentityLogin/citizenConfig";
import SelectMobileNumber, { V2LoginShell } from "../../components/IdentityLogin/SelectMobileNumber";
import SelectOtp from "../../components/IdentityLogin/SelectOtp";
import { useMobileValidationConfig } from "../../components/IdentityLogin/useMobileValidationConfig";

/**
 * Citizen sign-in on canonical tenant routes. When the BFF offers `phone_otp`
 * (#2189), the phone and code steps run here against the BFF, which sets the
 * citizen session itself. Otherwise signed-out visitors are sent to the
 * `digit-ui-citizen` Keycloak client. Either way the BFF session is exchanged
 * for a DIGIT CITIZEN token issued at the route tenant's root and bound to
 * the route tenant; the card only renders for failures.
 */
const IdentityBffCitizenLogin = ({ t }) => {
  const [methods, setMethods] = useState(null);
  const [mobileNumber, setMobileNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState(null);
  const [resendAfter, setResendAfter] = useState(undefined);
  // Remounts SelectOtp so its timer restarts from `resendAfter`.
  const [otpStep, setOtpStep] = useState(0);
  const [phoneAlert, setPhoneAlert] = useState("");
  const [otpError, setOtpError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phoneWait, setPhoneWait] = useState(false);
  const validationConfig = useMobileValidationConfig();
  const fetchImpl = window.fetch.bind(window);

  const signIn = useIdentityBffSignIn({
    surface: "citizen",
    t,
    // `user.info.tenantId` is the root the DIGIT citizen account lives at
    // (as with the legacy OTP login); the stored citizen tenant is the route
    // tenant, so complaints and other business requests stay on this URL's
    // tenant.
    onAuthenticated: (user, tenant) => {
      Digit.SessionStorage.set("citizen.userRequestObject", user);
      Digit.UserService.setType("citizen");
      Digit.UserService.setUser(user);
      setCitizenDetail(user.info, user.access_token, tenant.tenantId);
    },
    onSignedOut: () => startSignIn(),
  });
  const { tenant, status, setStatus, setMessage, tr, unavailable } = signIn;

  // A BFF OTP failure in the user's language, with its seconds/attempts.
  const failureText = (failure) => {
    const value = t(failure.messageKey, failure.params);
    return value === failure.messageKey ? failure.message : fillMessage(value, failure.params);
  };
  const steps = useMemo(
    () => loginSteps.map((step) => ({
      ...step,
      texts: Object.fromEntries(Object.entries(step.texts).map(([key, text]) => [key, t(text)])),
    })),
    [t],
  );

  // Phone OTP runs in digit-ui; any other method is a Keycloak redirect.
  async function startSignIn() {
    const offered = methods || (await fetchCitizenSigninMethods({ fetchImpl }));
    // A failed lookup is not remembered, so "Try again" asks the BFF again.
    if (offered.ok) setMethods(offered);
    if (offered.phoneOtp) {
      setStatus("phone");
    } else if (offered.redirect) {
      signIn.beginSignIn();
    } else {
      setStatus("error");
      setMessage(unavailable());
    }
  }

  const sendCode = () =>
    sendCitizenOtp({
      tenant,
      // National number without a trunk 0: `0712…` and `712…` are one
      // subscriber, and the BFF prefixes the country code.
      mobileNumber: mobileNumber.replace(/^0+/, ""),
      locale: Digit.StoreData?.getCurrentLanguage?.(),
      fetchImpl,
    });

  const submitMobileNumber = async () => {
    setBusy(true);
    setPhoneAlert("");
    const sent = await sendCode().catch(() => null);
    setBusy(false);
    if (!sent?.ok) {
      setPhoneAlert(sent ? failureText(sent) : unavailable());
      if (sent?.retryAfter) {
        setPhoneWait(true);
        setTimeout(() => setPhoneWait(false), sent.retryAfter * 1000);
      }
      return;
    }
    setChallengeId(sent.challengeId);
    setResendAfter(sent.resendAfter);
    setOtpStep((step) => step + 1);
    setOtp("");
    setOtpError("");
    setStatus("otp");
  };

  // Resolves to the seconds until the next resend, for SelectOtp's timer.
  const resendCode = async () => {
    // One request at a time: a resend replaces the challenge being verified.
    if (busy) return null;
    setBusy(true);
    const sent = await sendCode().catch(() => null);
    setBusy(false);
    if (sent?.ok) {
      setChallengeId(sent.challengeId);
      setOtp("");
      setOtpError("");
      return sent.resendAfter;
    }
    setOtpError(sent ? failureText(sent) : unavailable());
    return sent?.retryAfter ?? 0;
  };

  const backToPhone = (text) => {
    setChallengeId(null);
    setOtp("");
    setOtpError("");
    setPhoneAlert(text);
    setStatus("phone");
  };

  const submitCode = async () => {
    setBusy(true);
    setOtpError("");
    try {
      const verified = await verifyCitizenOtp({ tenant, challengeId, code: otp, fetchImpl });
      if (!verified.ok) {
        if (verified.attemptsRemaining === 0 || ["IDENTITY_DISABLED", "IDENTITY_CONFLICT", "OTP_LOCKED"].includes(verified.code)) {
          // The challenge is spent or the account can't sign in: start again
          // from the number.
          backToPhone(failureText(verified));
        } else if (verified.code === "OTP_INVALID") {
          setOtp("");
          setOtpError(failureText(verified));
        } else if (verified.code === "OTP_EXPIRED") {
          setOtp("");
          setOtpError(failureText(verified));
          setResendAfter(0);
          setOtpStep((step) => step + 1);
        } else {
          // IDENTITY_UNAVAILABLE or another transient failure: the BFF keeps
          // the challenge, so the same code can be tried again.
          setOtpError(failureText(verified));
        }
        return;
      }
      const result = await establishIdentityBffSession({ surface: "citizen", tenant, fetchImpl });
      if (result.status === "authenticated") {
        signIn.complete(result.user);
        return;
      }
      setStatus(result.status === "signed-out" ? "error" : result.status);
      setMessage(result.messageKey
        ? tr(result.messageKey, result.message)
        : tr("CORE_IDENTITY_SIGNIN_FAILED", "Sign-in could not be completed. Please try again."));
    } catch (e) {
      // A dropped request: the challenge is still valid, retry the same code.
      setOtpError(unavailable());
    } finally {
      setBusy(false);
    }
  };

  if (status === "checking") return <Loader page={true} variant="PageLoader" />;

  if (status === "phone") {
    return (
      <SelectMobileNumber
        t={t}
        config={steps[0]}
        mobileNumber={mobileNumber}
        onMobileChange={(event) => {
          setMobileNumber(event.target.value);
          setPhoneAlert("");
        }}
        onSelect={submitMobileNumber}
        canSubmit={!busy && !phoneWait}
        validationConfig={validationConfig}
        alert={phoneAlert}
      />
    );
  }

  if (status === "otp") {
    return (
      <SelectOtp
        key={otpStep}
        t={t}
        config={steps[1]}
        recipient={[validationConfig.prefix, mobileNumber].filter(Boolean).join(" ")}
        otp={otp}
        onOtpChange={(value) => {
          setOtp(value);
          setOtpError("");
        }}
        onSelect={submitCode}
        onResend={resendCode}
        resendAfter={resendAfter}
        error={!otpError}
        errorMessage={otpError}
        onChangeNumber={() => backToPhone("")}
        canSubmit={!busy}
      />
    );
  }

  return <SignInFailureCard signIn={signIn} Shell={V2LoginShell} onSignIn={startSignIn} />;
};

export default IdentityBffCitizenLogin;
