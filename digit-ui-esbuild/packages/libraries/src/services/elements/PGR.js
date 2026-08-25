import Urls from "../atoms/urls";
import { Request } from "../atoms/Utils/Request";

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
  employeeContext: (tenantId) =>
    Request({
      url: Urls.employee_context,
      useCache: false,
      method: "POST",
      auth: true,
      userService: true,
      params: { tenantId },
    }),

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
