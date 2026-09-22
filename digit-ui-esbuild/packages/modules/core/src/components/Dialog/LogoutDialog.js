import { CardText, PopUp, Button } from "@egovernments/digit-ui-components";
import React from "react";
import { useTranslation } from "react-i18next";

/**
 * The dialog used to say "Logout" three times over — as the heading, again in
 * bold inside "Are you sure you want to Logout", and a third time on the
 * "Yes, Logout" button — and said nothing about which account was being signed
 * out of (#2038 review).
 *
 * The repetition was structural, not a wording slip: the body was assembled by
 * concatenating CORE_LOGOUT_WEB_CONFIRMATION_MESSAGE with CORE_LOGOUT_MESSAGE,
 * so it could only ever restate the heading. It is replaced with the thing a
 * confirm dialog is actually for — who this affects, and what it costs — which
 * leaves the word itself on the heading and the confirm button, where a
 * confirm dialog needs it.
 *
 * New keys carry an English default so a deployment that has not seeded them
 * renders a sentence rather than the key. The old keys are left in place for
 * any other consumer.
 */

/** Non-empty strings only; a blank name would render an empty detail row. */
const present = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Tenants are localised under `TENANT_TENANTS_<ID>`, uppercased with dots as
 * underscores — passing the raw id to t() just echoes `ke.nairobi` back.
 */
const tenantLabelKey = (tenantId) => `TENANT_TENANTS_${tenantId.toUpperCase().replace(/\./g, "_")}`;

/**
 * Two initials from the name, one from a single word. Falls back to the
 * identifier so the avatar is never an empty circle — an employee record can
 * carry a username with no display name.
 */
function initialsFor(name, identifier) {
  const source = name || identifier || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function useAccountSummary() {
  // Read here rather than by prop: LogoutDialog is mounted from the employee
  // topbar and the citizen drawer, and only one of the two has userDetails to
  // hand down.
  const user = Digit?.UserService?.getUser?.()?.info;
  if (!user) return null;

  const name = present(user.name);
  const identifier = present(user.userName) || present(user.mobileNumber) || present(user.emailId);
  const tenant = present(user.tenantId);

  if (!name && !identifier) return null;
  return { name, identifier, tenant };
}

const LogoutDialog = ({ onSelect, onCancel, onDismiss, PopupStyles, isDisabled, hideSubmit }) => {
  const { t } = useTranslation();
  const account = useAccountSummary();

  // The account card carries the whole body. The heading already asks the
  // question, so a separate "you will need to sign in again" line would be the
  // same restatement this dialog was rewritten to remove.
  const children = [
    <div className="digit-logout-popup-body" key="body">
      {account ? (
        <div className="digit-logout-account">
          <span className="digit-logout-account-avatar" aria-hidden="true">
            {initialsFor(account.name, account.identifier)}
          </span>
          <span className="digit-logout-account-text">
            <span className="digit-logout-account-name">{account.name || account.identifier}</span>
            <span className="digit-logout-account-meta">
              {[account.name && account.identifier, account.tenant && t(tenantLabelKey(account.tenant))]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </div>
      ) : (
        <CardText>
          {t("CORE_LOGOUT_CONFIRMATION_BODY", "You will need to sign in again to continue.")}
        </CardText>
      )}
    </div>,
  ];

  const footer = [
    <Button
      type={"button"}
      size={"large"}
      variation={"secondary"}
      label={t("CORE_LOGOUT_CANCEL")}
      className={"logout-cancel-button"}
      onClick={onCancel}
    />,
    <Button
      type={"button"}
      size={"large"}
      variation={"primary"}
      label={t("CORE_LOGOUT_CONFIRM_ACTION", "Log out")}
      formId={"modal-action"}
      onClick={onSelect}
      isDisabled={isDisabled}
    />
  ];

  const footerWithoutSubmit = [
    <Button
      type={"button"}
      size={"large"}
      variation={"digit-action-cancel"}
      label={t("CORE_LOGOUT_CANCEL")}
      className={"logout-cancel-button"}
      onClick={onCancel}
    />,
  ];

  return (
    <PopUp
      type="default"
      children={children}
      heading={t("CORE_LOGOUT_CONFIRM_HEADING", "Are you sure you want to log out?")}
      footerChildren={hideSubmit ? footerWithoutSubmit : footer}
      sortFooterButtons={true}
      onClose={onDismiss}
      className={"digit-logout-popup-wrapper"}
      onOverlayClick={onDismiss}
      equalWidthButtons={true}
      style={PopupStyles}
    ></PopUp>
  );
};
export default LogoutDialog;
