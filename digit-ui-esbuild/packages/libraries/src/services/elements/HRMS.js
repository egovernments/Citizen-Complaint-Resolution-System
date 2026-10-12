import { roundToNearestMinutes } from "date-fns/esm";
import Urls from "../atoms/urls";
import { Request } from "../atoms/Utils/Request";

// Every new employee gets CSR so they can file a complaint on a citizen's
// behalf (#2239), whichever roles the admin picked.
const withCsrRole = (employee) => {
  const roles = employee?.user?.roles || [];
  if (!employee?.user || roles.some((role) => role?.code === "CSR")) return employee;
  const tenantId = employee.user.tenantId || employee.tenantId;
  return { ...employee, user: { ...employee.user, roles: [...roles, { code: "CSR", name: "Complainant", tenantId }] } };
};

const HrmsService = {
  search: (tenantId, filters, searchParams) =>
    Request({
      url: Urls.hrms.search,
      useCache: false,
      method: "POST",
      auth: true,
      userService: true,
      params: { tenantId, ...filters, ...searchParams },
    }),
  create: (data, tenantId) =>
    Request({
      data: { ...data, Employees: data?.Employees?.map(withCsrRole) },
      url: Urls.hrms.create,
      useCache: false,
      method: "POST",
      auth: true,
      userService: true,
      params: { tenantId },
    }),
  update: (data, tenantId) =>
    Request({
      data: data,
      url: Urls.hrms.update,
      useCache: false,
      method: "POST",
      auth: true,
      userService: true,
      params: { tenantId },
    }),
  count: (tenantId) =>
    Request({
      url: Urls.hrms.count,
      useCache: false,
      method: "POST",
      auth: true,
      userService: true,
      params: { tenantId },
    }),
};

export default HrmsService;
