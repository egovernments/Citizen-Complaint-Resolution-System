import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const useComplaintStatus = () => {
  const { t } = useTranslation();
  const [complaintStatus, setComplaintStatus] = useState([]);
  const tenantId = Digit.ULBService.getCurrentTenantId();

  useEffect(() => {
    (async () => {
      const WorkflowServiceResponse = await Digit.WorkflowService.init(tenantId, "PGR");
      let applicationStatus = WorkflowServiceResponse.BusinessServices[0].states
        .filter((state) => state.applicationStatus)
        .map((state) => ({
          name: t(`CS_COMMON_${state.applicationStatus}`),
          code: state.applicationStatus,
        }));
      setComplaintStatus(applicationStatus);
    })();
  }, [t, tenantId]);

  return complaintStatus;
};

export default useComplaintStatus;
