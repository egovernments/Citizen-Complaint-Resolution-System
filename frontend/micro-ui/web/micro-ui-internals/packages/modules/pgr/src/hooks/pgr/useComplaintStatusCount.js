import { useEffect, useState } from "react";
import useComplaintStatus from "./useComplaintStatus";

const useComplaintStatusCount = (complaints) => {
  const [complaintStatusWithCount, setcomplaintStatusWithCount] = useState([]);
  let complaintStatus = useComplaintStatus();
  let tenantId = Digit.ULBService.getCurrentTenantId();

  const getCount = async (value) => {
    try {
      const countFn = Digit.PGRService?.count;
      if (!countFn) return "";
      let response = await countFn(tenantId, { applicationStatus: value });
      return response?.count || "";
    } catch (e) {
      return "";
    }
  };

  useEffect(() => {
    let getStatusWithCount = async () => {
      let statusWithCount = complaintStatus.map(async (status) => ({
        ...status,
        count: await getCount(status.code),
      }));
      setcomplaintStatusWithCount(await Promise.all(statusWithCount));
    };
    getStatusWithCount();
  }, [complaints, complaintStatus]);
  return complaintStatusWithCount;
};

export default useComplaintStatusCount;
