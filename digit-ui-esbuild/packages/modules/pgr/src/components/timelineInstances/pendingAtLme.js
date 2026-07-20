import { TelePhone, CheckPoint } from "@egovernments/digit-ui-react-components";
import React from "react";
import { useTranslation } from "react-i18next";

const PendingAtLME = ({ name, isCompleted, mobile, customChild }) => {
  let { t } = useTranslation();
  // The CheckPoint label already prints "Pending at LME". Earlier this
  // component re-printed the same label as a `text` prefix in front of
  // the assignee name, producing "Pending at LME" on the row header
  // and "Pending at LME <name>" again right below — read as a stutter
  // on the citizen timeline (egovernments/CCRS#490 sub-bug 5). Just
  // render the assignee name + phone now; the label handles the
  // "Pending at LME" copy.
  return <CheckPoint label={t("CS_COMMON_PENDINGATLME")} isCompleted={isCompleted} customChild={
          <div>
            {name && mobile ? <TelePhone mobile={mobile} text={name}/> : null }
            {customChild}
          </div>
        } />
};

export default PendingAtLME;
