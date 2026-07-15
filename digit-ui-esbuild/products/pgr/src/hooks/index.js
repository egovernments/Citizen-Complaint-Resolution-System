import utils from "../utils";
import useProjectSearch from "./project/useProjectSearch";
import usePGRInitialization from "./project/usePGRInitialization";
import useFetchBoundaries from "./boundary/useFetchBoundaries";
import useCreateComplaint from "./pgr/useCreateComplaint";
import usePGRSearch from "./pgr/usePGRSearch";
import usePGRUpdate from "./pgr/usePGRUpdate";
import useServiceDefs from "./pgr/useServiceDefs";
import useMobileValidation from "./pgr/useMobileValidation";
import usePGRInboxSearch from "./pgr/usePGRInboxSearch";
import useAdminComplaintSearch from "./pgr/useAdminComplaintSearch";

const pgr = {
  useProjectSearch,
  usePGRInitialization,
  useFetchBoundaries,
  useCreateComplaint,
  usePGRSearch,
  usePGRUpdate,
  useServiceDefs,
  useMobileValidation,
  usePGRInboxSearch,
  useAdminComplaintSearch,
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

