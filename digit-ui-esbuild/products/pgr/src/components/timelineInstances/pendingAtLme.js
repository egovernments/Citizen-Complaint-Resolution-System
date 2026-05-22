import { TelePhone, CheckPoint } from "@egovernments/digit-ui-react-components";
import React from "react";
import { useTranslation } from "react-i18next";

const PendingAtLME = ({ name, isCompleted, mobile, text, customChild }) => {
  let { t } = useTranslation();
  // `text` is an optional prefix (kept for backward compatibility); when
  // the caller already renders the status label outside (TimeLine.js does),
  // it should pass text="" so we don't print "Pending at LME Lionel" under
  // the existing "Pending at LME" header (issue CCRS#490).
  const displayText = text ? `${text} ${name}` : name;
  return <CheckPoint label={t("CS_COMMON_PENDINGATLME")} isCompleted={isCompleted} customChild={
          <div>
            {name && mobile ? <TelePhone mobile={mobile} text={displayText}/> : null }
            {customChild}
          </div>
        } />
};

export default PendingAtLME;
