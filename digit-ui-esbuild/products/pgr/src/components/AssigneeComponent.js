import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import { Dropdown, Loader } from "@egovernments/digit-ui-components";

const AssigneeComponent = ({ config, onSelect, formData }) => {
  const { t } = useTranslation();
  const [assignees, setAssignees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const hrmsContext = window?.globalConfigs?.getConfig("HRMS_CONTEXT_PATH") || "egov-hrms";

  // Config populators. `department`/`allDepartments` drive the static
  // (create/assign flow) scoping. `dependsOnKey` opts into DEPENDENT mode used
  // by the search screen: the department is chosen live in another field
  // (formData[dependsOnKey]); the dropdown stays disabled until it's set, and
  // the employee list is scoped to that chosen department.
  const { roles = [], department: staticDepartment, allDepartments, dependsOnKey } = config?.populators || {};

  const isDependent = !!dependsOnKey;
  const selectedDepartment = isDependent ? (formData?.[dependsOnKey]?.code || null) : staticDepartment;
  const waitingForDept = isDependent && !selectedDepartment;

  // Fetch employee data based on roles (all matching employees; scoping to the
  // department is done client-side below so a dependent department change needs
  // no refetch).
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

  // Update assignees when employee data OR the (dependent) selected department
  // changes.
  useEffect(() => {
    if (waitingForDept || !(employeeData?.Employees?.length > 0)) {
      setAssignees([]);
      return;
    }
    // Screening officer (allDepartments): NO department filter — list every
    // department's assignable employees (transformData groups them by
    // department). Every other actor stays scoped to the single department.
    // Unmapped complaint type (department "NA" or absent): pgr-services skips
    // its department validation, so the actor may route to ANY department —
    // filtering by "NA" would empty the dropdown.
    const unscoped = !isDependent && (allDepartments || !selectedDepartment || selectedDepartment === "NA");
    const filtered = employeeData.Employees.filter((e) => {
      const d = e?.assignments?.[0]?.department;
      if (!d || !e?.user?.uuid) return false;
      return unscoped ? true : d === selectedDepartment;
    });
    setAssignees(transformData(filtered));
  }, [employeeData, selectedDepartment, waitingForDept, isDependent, allDepartments]);

  // Dependent mode: when the department changes, drop any stale assignee so the
  // filter never sends an employee that no longer matches the chosen department.
  const prevDeptRef = useRef(selectedDepartment);
  useEffect(() => {
    if (!isDependent) return; // create/assign flow: never auto-clear
    if (prevDeptRef.current !== selectedDepartment) {
      prevDeptRef.current = selectedDepartment;
      if (selectedEmployee) {
        setSelectedEmployee(null);
        if (config?.key) onSelect(config.key, undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepartment]);

  // Handle employee selection
  const handleEmployeeSelect = (employee) => {
    setSelectedEmployee(employee);
    if (config?.key) {
      onSelect(config.key, employee || undefined);
    }
  };

  if (error) return <div>{t("CS_COMMON_EMPLOYEE_FETCH_ERROR")}</div>;
  if (isEmployeeDataLoading) return <Loader />;

  const placeholder = waitingForDept
    ? (t("PGR_SELECT_DEPARTMENT_FIRST") === "PGR_SELECT_DEPARTMENT_FIRST"
        ? "Select a department first"
        : t("PGR_SELECT_DEPARTMENT_FIRST"))
    : t("CS_COMMON_SELECT_EMPLOYEE");

  return (
    <div className="assignee-dropdown-container">
      <Dropdown
        t={t}
        option={waitingForDept ? [] : assignees}
        optionKey="name"
        selected={selectedEmployee}
        select={(value) => {
          handleEmployeeSelect(value);
        }}
        placeholder={placeholder}
        label={t(config.label)}
        variant="nesteddropdown"
        disable={waitingForDept}
      />
    </div>
  );
};

export default AssigneeComponent;
