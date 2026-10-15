import { roundToNearestMinutes } from "date-fns/esm";
import Urls from "../atoms/urls";
import { Request } from "../atoms/Utils/Request";

// Every new employee gets CSR so they can file a complaint on a citizen's
// behalf (#2239), whichever roles the admin picked. CSR goes on each tenant the
// other roles are tagged with: the create form tags them per jurisdiction, and
// the edit form keeps only roles on a jurisdiction tenant. With no roles, the
// employee's own tenant.
const withCsrRole = (employee) => {
  if (!employee?.user) return employee;
  const roles = employee.user.roles || [];
  const tenants = [...new Set(roles.map((role) => role?.tenantId).filter(Boolean))];
  if (!tenants.length) tenants.push(employee.user.tenantId || employee.tenantId);
  const missing = tenants.filter((tenantId) => !roles.some((role) => role?.code === "CSR" && role?.tenantId === tenantId));
  if (!missing.length) return employee;
  return { ...employee, user: { ...employee.user, roles: [...roles, ...missing.map((tenantId) => ({ code: "CSR", name: "Complainant", tenantId }))] } };
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
