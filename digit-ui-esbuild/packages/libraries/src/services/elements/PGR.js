import Axios from "axios";
import Urls from "../atoms/urls";
import { Request } from "../atoms/Utils/Request";

// A client with no interceptors — see employeeContext below for why.
const bareClient = Axios.create();

const buildRequestInfo = () => {
  const user = Digit.UserService.getUser();
  return {
    apiId: "Rainmaker",
    ver: ".01",
    ts: "",
    action: "",
    did: "",
    key: "",
    msgId: `${new Date().getTime()}|${Digit.StoreData.getCurrentLanguage()}`,
    authToken: user?.access_token || null,
    userInfo: user?.info,
  };
};

export const PGRService = {
  search: (tenantId, filters = {}) => {
    return Request({
      url: Urls.pgr_search,
      useCache: false,
      method: "POST",
      auth: true,
      userService: true,
      params: { tenantId: tenantId, ...filters },
    });
  },
  create: (details, tenantId) =>
    Request({
      url: Urls.PGR_Create,
      data: details,
      useCache: true,
      method: "POST",
      params: { tenantId },
      auth: true,
      userService: true,
    }),
  update: (details) =>
    Request({
      url: Urls.pgr_update,
      data: details,
      useCache: true,
      auth: true,
      method: "POST",
      params: { tenantId: details.tenantId },
      userService: true,
    }),
  count: (tenantId, params) =>
    Request({
      url: Urls.pgr_count,
      useCache: true,
      auth: true,
      method: "POST",
      params: { tenantId, ...params },
    }),

  // Working context for the *authenticated* employee (CCRS#1833). The backend
  // resolves the employee from the RequestInfo auth token and returns only
  // display-safe fields, so the UI must not pass a uuid of its own.
  //
  // Deliberately NOT routed through Request(): that shares the default Axios
  // instance, whose global response interceptor turns a ZuulRuntimeException
  // into `window.location.href = /employee/user/error?type=notfound` and a 500
  // into the maintenance page (services/atoms/Utils/Request.js). This call
  // fires on every employee page, so a gateway with no route for it — every
  // deployment until #1858 lands — would bounce operators off whatever screen
  // they were on. A decorative header widget must not be able to navigate the
  // app. `bareClient` has no interceptors, so failures stay local and the hook
  // renders its own non-blocking unavailable state.
  employeeContext: (tenantId) =>
    bareClient
      .post(Urls.employee_context, { RequestInfo: buildRequestInfo() }, { params: { tenantId } })
      .then((res) => res.data),

  employeeSearch: (tenantId, roles) => {
    return Request({
      url: Urls.EmployeeSearch,
      params: { tenantId, roles },
      auth: true,
    });
  },

  PGROpensearch: ({ tenantId, filters }) =>
    Request({
     url: Urls.pgr_search,
     useCache: false,
     method: "POST",
     auth: false ,
     userService: false,
     params: { tenantId, ...filters },
   }),
};
