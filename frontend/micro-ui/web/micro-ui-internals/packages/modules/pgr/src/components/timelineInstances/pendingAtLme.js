import { TelePhone, CheckPoint } from "@egovernments/digit-ui-react-components";
import React from "react";
import { useTranslation } from "react-i18next";

// Helper function to mask phone numbers for citizen view (show last 4 digits only)
const maskPhoneNumber = (phone) => {
  if (!phone || phone.length < 4) return phone;
  return 'XXXXXX' + phone.slice(-4);
};

const PendingAtLME = ({ name, isCompleted, mobile, text, customChild }) => {
  let { t } = useTranslation();
  return <CheckPoint label={t("CS_COMMON_PENDINGATLME")} isCompleted={isCompleted} customChild={
          <div>
            {name && mobile ? <TelePhone mobile={maskPhoneNumber(mobile)} text={`${text} ${name}`}/> : null }
            {customChild}
          </div>
        } />
};

export default PendingAtLME;
