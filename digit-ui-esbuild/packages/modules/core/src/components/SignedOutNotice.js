import React from "react";
import { useTranslation } from "react-i18next";
import { readLoginRedirect, SIGN_OUT_REASONS } from "@egovernments/digit-ui-libraries";

// Why the user is on a login page, when the app sent them there (#224): without
// it an idle sign-out looks like a crash or a lost session. Shared by the
// employee and citizen login pages; renders nothing without a known reason.
const SignedOutNotice = () => {
  const { t } = useTranslation();
  const tr = (key, fallback) => (t(key) === key ? fallback : t(key));
  const { reason } = readLoginRedirect(window?.location?.search, window?.contextPath);
  const text = {
    [SIGN_OUT_REASONS.IDLE]: tr("CORE_SIGNED_OUT_IDLE", "You were signed out because you had not used CMS for a while. Sign in again to continue."),
    [SIGN_OUT_REASONS.EXPIRED]: tr("CORE_SIGNED_OUT_EXPIRED", "Your session has ended. Sign in again to continue."),
    [SIGN_OUT_REASONS.OTHER_TAB]: tr("CORE_SIGNED_OUT_OTHER_TAB", "You signed out in another tab. Sign in again to continue."),
  }[reason];
  if (!text) return null;

  return (
    <div
      role="status"
      className="v2-signed-out-notice"
      style={{
        margin: 0,
        padding: "10px 12px",
        borderLeft: "4px solid var(--color-digitv2-alert-info, #3498DB)",
        background: "var(--color-grey-light, #FAFAFA)",
        color: "var(--color-text-primary, #0B0C0C)",
        fontSize: "0.875rem",
        lineHeight: 1.5,
        textAlign: "left",
      }}
    >
      {text}
    </div>
  );
};

export default SignedOutNotice;
