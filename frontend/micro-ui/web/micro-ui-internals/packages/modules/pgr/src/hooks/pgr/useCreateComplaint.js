import { useQuery, useMutation } from "react-query";
import PGRService from "../../services/pgr/PGRService";

export const useCreateComplaint = (tenantId, config = {}) => {
  return useMutation((data) => {
    console.log("PGR_CREATE_PAYLOAD_LOG", data);
    return PGRService.create(data, tenantId);
  });
};

export default useCreateComplaint;