import { useTranslation } from "react-i18next";
import React, { useEffect, useState } from "react";
import { Dropdown, Loader } from "@egovernments/digit-ui-components";

const AssigneeComponent = ({ config, onSelect, formState, defaultValues }) => {
  const { t } = useTranslation();
  const [assignees, setAssignees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const hrmsContext = window?.globalConfigs?.getConfig("HRMS_CONTEXT_PATH") || "egov-hrms";

  // Get roles from config populators. `allDepartments` is true only for a
  // CMS_SCREENING_OFFICER, who routes across EVERY department in the tenant;
  // everyone else stays scoped to the single primary `department`.
  const { roles = [], department, allDepartments } = config?.populators || {};

  // Fetch employee data based on roles
  const { 
    isLoading: isEmployeeDataLoading, 
    data: employeeData, 
    error 
  } = Digit.Hooks.useCustomAPIHook({
    url: `/${hrmsContext}/employees/_search`,
    params: {
      tenantId: tenantId,
      roles: roles.join(","),
    },
    config: {
      enabled: roles.length > 0,
    },
  });

  // Transform employee data for dropdown
  function transformData(data) {
    return Object.values(
      data?.reduce((acc, employee) => {
        const department = employee?.assignments?.[0]?.department;
        const uuid = employee?.user?.uuid;
        const userServiceUUID = employee?.user?.userServiceUuid;
        if (!department) return acc;
        // Department display name. Onboarding seeds COMMON_MASTERS_DEPARTMENT_<code>
        // (not DEPARTMENT_<code>), so use that key; fall back to the raw code.
        const deptKey = `COMMON_MASTERS_DEPARTMENT_${department}`;
        const deptName = t(deptKey) === deptKey ? department : t(deptKey);

        if (!acc[department]) {
          acc[department] = {
            code: department,
            name: deptName,
            options: []
          };
        }

        acc[department].options.push({
          code: `${employee.user?.name} (${deptName})`,
          name: `${employee.user?.name} (${deptName})`,
          uuid: uuid,
          userServiceUUID: userServiceUUID,
          mobileNumber: employee.user?.mobileNumber,
          department: department
        });
  
        return acc;
      }, {}) || {}
    );
  }
  
  

  // Update assignees when employee data changes
  useEffect(() => {
    if (employeeData?.Employees?.length > 0) {
      // Screening officer (allDepartments): NO department filter — list every
      // department's assignable employees (transformData groups them by
      // department). Every other actor stays scoped to the single primary dept.
      const filtered = employeeData.Employees.filter((e) => {
        const d = e?.assignments?.[0]?.department;
        if (!d || !e?.user?.uuid) return false;
        return allDepartments ? true : d === department;
      });
      setAssignees(transformData(filtered));
    }
  }, [employeeData]);

  // Handle employee selection
  const handleEmployeeSelect = (employee) => {
    setSelectedEmployee(employee);
    if (employee && config?.key) {
      onSelect(config.key, employee);
    }
  };
  

  if (error) return <div>{t("CS_COMMON_EMPLOYEE_FETCH_ERROR")}</div>;
  if (isEmployeeDataLoading) return <Loader />;

  return (
    <div className="assignee-dropdown-container">
      <Dropdown
        t={t}
        option={assignees}
        optionKey="name"
        selected={selectedEmployee}
        select={(value) => {
          handleEmployeeSelect(value);
        }}
        placeholder={t("CS_COMMON_SELECT_EMPLOYEE")}
        label={t(config.label)}
        variant="nesteddropdown"
      />
    </div>
  );
};

export default AssigneeComponent;
