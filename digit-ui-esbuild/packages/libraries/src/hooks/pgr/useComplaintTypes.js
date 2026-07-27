import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const useComplaintTypes = ({ stateCode }) => {
  const [complaintTypes, setComplaintTypes] = useState(null);
  const { t } = useTranslation();

  useEffect(() => {
    (async () => {
      const res = await Digit.GetServiceDefinitions.getMenu(stateCode, t);
      let menu = res.filter((o) => o.key !== "");
      // Sort the complaint types A–Z by their displayed label so the dropdown
      // is predictable to scan (CCRS#941). "Others" is appended afterwards so
      // it always stays last regardless of alphabetical order.
      menu.sort((a, b) => (a?.name || "").localeCompare(b?.name || ""));
      menu.push({ key: "Others", name: t("CS_COMPLAINT_TYPE_OTHERS") });
      setComplaintTypes(menu);
    })();
  }, [t, stateCode]);

  return complaintTypes;
};

export default useComplaintTypes;
