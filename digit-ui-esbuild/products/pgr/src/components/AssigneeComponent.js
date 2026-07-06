import { useTranslation } from "react-i18next";
import React, { useEffect, useState } from "react";
import { Dropdown, Loader } from "@egovernments/digit-ui-components";

const AssigneeComponent = ({ config, onSelect, formState, defaultValues, formData }) => {
  const { t } = useTranslation();
  const [assignees, setAssignees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const tenantId = Digit.ULBService.getCurrentTenantId();

  // Reset the picker when the bound form value is cleared (e.g. filter "Clear All").
  // No-op in the create flow (the value is only empty at initial mount).
  const boundValue = formData?.[config?.key];
  useEffect(() => {
    if (!boundValue && selectedEmployee) setSelectedEmployee(null);
  }, [boundValue]);
  const hrmsContext = window?.globalConfigs?.getConfig("HRMS_CONTEXT_PATH") || "egov-hrms";

  // Get roles from config populators. `allDepartments` is true only for a
  // CMS_SCREENING_OFFICER, who routes across EVERY department in the tenant;
  // everyone else stays scoped to the single primary `department`.
  //
  // `dependsOnKey` (filter usage) makes this picker DEPENDENT: the department
  // comes from another field's selected value (e.g. the Department filter), and
  // employees are loaded ONLY for that department — so we never pull every
  // employee in the tenant up front.
  const { roles = [], department, allDepartments, dependsOnKey } = config?.populators || {};
  const effectiveDept = dependsOnKey ? formData?.[dependsOnKey]?.code : department;
  const waitingForDept = !!dependsOnKey && !effectiveDept;

  // Fetch employees by role, scoped to the effective department. When dependent
  // and no department is chosen yet, the query is disabled (nothing loads).
  const {
    isLoading: isEmployeeDataLoading,
    data: employeeData,
    error
  } = Digit.Hooks.useCustomAPIHook({
    url: `/${hrmsContext}/employees/_search`,
    params: {
      tenantId: tenantId,
      roles: roles.join(","),
      ...(effectiveDept ? { departments: effectiveDept } : {}),
    },
    // useCustomAPIHook's react-query key is [url, changeQueryName, body] — it does
    // NOT include params. url/body are constant here, so without a dept-scoped
    // changeQueryName every department shares one cache entry and switching depts
    // returns the previous dept's employees (staleTime + keepPreviousData) instead
    // of refetching. Key on dept (+roles) so a department change refetches.
    changeQueryName: `pgr-employees-${roles.join("_")}-${effectiveDept || "all"}`,
    config: {
      enabled: roles.length > 0 && !waitingForDept,
    },
  });

  // Changing the department invalidates any prior assignee pick.
  useEffect(() => {
    if (!dependsOnKey) return;
    setSelectedEmployee(null);
    if (config?.key) onSelect(config.key, null);
  }, [effectiveDept]);

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
        if (effectiveDept) return d === effectiveDept;
        return allDepartments ? true : d === department;
      });
      setAssignees(transformData(filtered));
    } else {
      setAssignees([]);
    }
  }, [employeeData, effectiveDept]);

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
    <div className={`assignee-dropdown-container${waitingForDept ? " is-disabled" : ""}`}>
      <Dropdown
        t={t}
        option={assignees}
        optionKey="name"
        selected={selectedEmployee}
        select={(value) => {
          handleEmployeeSelect(value);
        }}
        placeholder={
          waitingForDept
            ? (t("PGR_SELECT_DEPARTMENT_FIRST") === "PGR_SELECT_DEPARTMENT_FIRST"
                ? "Select a department first"
                : t("PGR_SELECT_DEPARTMENT_FIRST"))
            : t("CS_COMMON_SELECT_EMPLOYEE")
        }
        label={t(config.label)}
        variant="nesteddropdown"
        disabled={waitingForDept}
      />
    </div>
  );
};

export default AssigneeComponent;
