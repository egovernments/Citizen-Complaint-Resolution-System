import { useQuery, useQueryClient } from "react-query";

const useWorkflowDetails = ({ tenantId, id, moduleCode, role = "CITIZEN", serviceData = {}, getStaleData,  getTripData = false,config }) => {
  const queryClient = useQueryClient();

  const staleDataConfig = { staleTime: Infinity };

  const { isLoading, error, isError, isIdle, isFetching, data, refetch } = useQuery(
    ["workFlowDetails", tenantId, id, moduleCode, role, config],
    () => Digit.WorkflowService.getDetailsById({ tenantId, id, moduleCode, role, getTripData }),
    getStaleData ? { ...staleDataConfig, ...config } : config
  );

  if (getStaleData) return { isLoading, error, isError, data };

  // isIdle / isFetching / refetch (ours#770): a caller can tell a query that ended without data from one in flight.
  return { isLoading, error, isError, isIdle, isFetching, data, refetch, revalidate: () => queryClient.invalidateQueries(["workFlowDetails", tenantId, id, moduleCode, role]) };
};

export default useWorkflowDetails;
