import { useTranslation } from "react-i18next";
import React, { useEffect, useMemo, useState } from "react";
import { Dropdown, Loader } from "@egovernments/digit-ui-components";

/**
 * DepartmentComponent — filter dropdown of complaint departments.
 *
 * FormComposerV2 `type:"component"` contract (same as AssigneeComponent /
 * BoundaryComponent): receives { config, onSelect } and writes the selected
 * value via onSelect(config.key, value).
 *
 * Data source: the cached serviceDefs (adapted from RAINMAKER-PGR.ComplaintHierarchy
 * leaves — see useServiceDefs). Each leaf carries `.department`, so the distinct
 * set of department codes here is guaranteed to match what pgr-services filters
 * on server-side (?department=<code>). Emits { code } so the config preProcess
 * maps it straight to the `department` search param.
 *
 * Label: COMMON_MASTERS_DEPARTMENT_<code> localization key (same key
 * AssigneeComponent uses), falling back to the raw code.
 */
const DepartmentComponent = ({ config, onSelect, formData }) => {
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const [selected, setSelected] = useState(null);

  // Keep internal selection in sync with the form value so "Clear All"
  // (which resets the filter form to defaults) also clears this dropdown.
  const boundValue = formData?.[config?.key];
  useEffect(() => {
    if (!boundValue && selected) setSelected(null);
  }, [boundValue]);

  // useServiceDefs caches leaves in SessionStorage under "serviceDefs".
  const serviceDefs = Digit.Hooks.pgr.useServiceDefs(tenantId, "PGR");

  const options = useMemo(() => {
    const defs = serviceDefs?.length ? serviceDefs : Digit.SessionStorage.get("serviceDefs") || [];
    const byCode = {};
    (Array.isArray(defs) ? defs : []).forEach((d) => {
      const code = d?.department;
      if (!code || byCode[code]) return;
      const key = `COMMON_MASTERS_DEPARTMENT_${code}`;
      const name = t(key) === key ? code : t(key);
      byCode[code] = { code, name };
    });
    return Object.values(byCode).sort((a, b) => a.name.localeCompare(b.name));
  }, [serviceDefs, t]);

  if (!serviceDefs) return <Loader />;

  return (
    <div className="department-dropdown-container">
      <Dropdown
        t={t}
        option={options}
        optionKey="name"
        selected={selected}
        select={(value) => {
          setSelected(value);
          if (config?.key) onSelect(config.key, value || null);
        }}
        placeholder={t("PGR_SELECT_DEPARTMENT")}
        label={t(config.label)}
      />
    </div>
  );
};

export default DepartmentComponent;
