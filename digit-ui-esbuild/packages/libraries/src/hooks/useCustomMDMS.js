import { useQuery } from "react-query";
import { MdmsService } from "../services/elements/MDMS";
import useCustomAPIHook from "./useCustomAPIHook";
import Urls from "../services/atoms/urls";
import _ from "lodash";
/**
 * Custom hook which can be used to
 * make a single hook a module to get multiple masterdetails with/without filter
 *
 * @author jagankumar-egov
 *
 * @example
 * // returns useQuery object
 * Digit.Hooks.useCustomMDMS(
 *          "stateid",
 *          "modulename",
 *          [
 *              { name:"masterdetail1",filter:"[?(@.active == true)]"},
 *              { name:"masterdetail2" }
 *          ],
 *          { // all configs supported by the usequery
 *              default:(data)=>{
 *                          format
 *                          return formattedData;
 *                          }
 *          })
 *
 * @returns {Object} Returns the object of the useQuery from react-query.
 */
const useCustomMDMS = (tenantId, moduleName, masterDetails = [], config = {}, mdmsv2 = false) => {
  if (mdmsv2) {
    //here call the mdmsv2 api and return the options array
    return useCustomAPIHook({
      url: Urls.MDMS_V2,
      params: {},
      changeQueryName: `mdms-v2-dropdowns${mdmsv2?.schemaCode}${mdmsv2?.tenantId ? "-" + mdmsv2.tenantId : ""}`,
      body: {
        MdmsCriteria: {
          // Opt-in per-tenant fetch: callers that pass mdmsv2.tenantId (e.g. the
          // citizen authority→tenant flow) fetch at THAT tenant and get a
          // tenant-scoped cache key. Everyone else keeps the prior behaviour of
          // always using the logged-in tenant — unchanged.
          tenantId: mdmsv2?.tenantId || Digit.ULBService.getCurrentTenantId(),
          moduleDetails: [
            {
              moduleName: moduleName,
              masterDetails: masterDetails,
            },
          ],
        },
      },
      config: {
        enabled: mdmsv2 ? true : false,
        select: (response) => {
          //mdms will be an array of master data
          //published this change in 1.8.2-beta.7
          if (config.select) {
            return config.select(response.MdmsRes);
          }
          return response;
        },
      },
      // Persist MDMS v2 master data in IndexedDB for 1 day so dropdown catalogues
      // (ComplaintRelatedToMap, ComplaintHierarchy, ComplaintTemplateType, …) don't
      // re-fetch on every navigation. Key is tenant-scoped (changeQueryName + body).
      options: { idbTtlSecs: 86400 },
    });
  }
  return useQuery([tenantId, moduleName, masterDetails], () => MdmsService.getMultipleTypesWithFilter(tenantId, moduleName, masterDetails), config);
};

export default useCustomMDMS;
