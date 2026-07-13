import { useTranslation } from "react-i18next";
import React, { useEffect, useMemo, useState } from "react";
import { Dropdown, Loader } from "@egovernments/digit-ui-components";

/**
 * Department filter for the employee "Search Citizen Complaint" screen.
 *
 * A FormComposer `type:"component"` filter field (same contract as
 * PGRBoundaryComponent: receives { config, onSelect, formData } and writes the
 * form value via onSelect(config.key, value)).
 *
 * Options are the DISTINCT department codes carried by the complaint hierarchy
 * leaves (RAINMAKER-PGR.ComplaintHierarchy, cached in SessionStorage as
 * "serviceDefs" by useServiceDefs). This is deliberately the same source the
 * backend uses to resolve `department` -> serviceCodes (MDMSUtils
 * .getServiceCodesByDepartment), so the dropdown can only offer departments the
 * _search filter can actually match.
 *
 * The value emitted is { code, name }; UICustomizations.PGRComplaintSearchConfig
 * .preProcess reads `.code` and sends it as the `department` query param.
 */
const DepartmentComponent = ({ config, onSelect, formData }) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(null);

  // Humanised fallback when no COMMON_MASTERS_DEPARTMENT_<code> localisation
  // is seeded (e.g. ministry_of_the_interior -> "Ministry Of The Interior").
  const humanize = (code) =>
    String(code || "")
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  const deptName = (code) => {
    const key = `COMMON_MASTERS_DEPARTMENT_${code}`;
    const v = t(key);
    return v === key ? humanize(code) : v;
  };

  // Distinct departments from the cached complaint-hierarchy leaves.
  const options = useMemo(() => {
    const defs = Digit.SessionStorage.get("serviceDefs") || [];
    const seen = new Set();
    const list = [];
    (Array.isArray(defs) ? defs : []).forEach((d) => {
      const code = d?.department;
      if (!code || code === "NA" || seen.has(code)) return;
      seen.add(code);
      list.push({ code, name: deptName(code) });
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [t]);

  // Clear-All / external reset: when the form value for this field is wiped,
  // drop the local selection so the dropdown visibly clears too.
  const externalValue = formData?.[config?.key];
  useEffect(() => {
    if (!externalValue && selected) {
      setSelected(null);
    }
  }, [externalValue]);

  const handleSelect = (value) => {
    setSelected(value);
    if (config?.key) {
      onSelect(config.key, value || undefined);
    }
  };

  if (!options) return <Loader />;

  return (
    <div className="department-dropdown-container">
      <Dropdown
        t={t}
        option={options}
        optionKey="name"
        selected={selected}
        select={handleSelect}
        placeholder={t("PGR_SELECT_DEPARTMENT")}
        label={(() => {
          const k = "ES_PGR_FILTER_DEPARTMENT";
          const v = t(k);
          return v === k ? "Department" : v;
        })()}
      />
    </div>
  );
};

export default DepartmentComponent;
