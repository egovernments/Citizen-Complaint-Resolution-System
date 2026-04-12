import utils from "../utils";
import useProjectSearch from "./project/useProjectSearch";
import usePGRInitialization from "./project/usePGRInitialization";
import useFetchBoundaries from "./boundary/useFetchBoundaries";
import useCreateComplaint from "./pgr/useCreateComplaint";
import usePGRSearch from "./pgr/usePGRSearch";
import usePGRUpdate from "./pgr/usePGRUpdate";
import useServiceDefs from "./pgr/useServiceDefs";
import useMobileValidation from "./pgr/useMobileValidation";
import useInboxData from "./pgr/useInboxData";
import useComplaintStatus from "./pgr/useComplaintStatus";
import useComplaintStatusCount from "./pgr/useComplaintStatusCount";

const pgr = {
  useProjectSearch,
  usePGRInitialization,
  useFetchBoundaries,
  useCreateComplaint,
  usePGRSearch,
  usePGRUpdate,
  useServiceDefs,
  useMobileValidation,
  useInboxData,
  useComplaintStatus,
  useComplaintStatusCount,
};

const Hooks = {
  pgr,
};

const Utils = {
  browser: {
    pgr: () => { },
  },
  pgr: {
    ...utils,
  },
};

export const CustomisedHooks = {
  Hooks,
  Utils,
};
