import { useTranslation } from "react-i18next";
import React, { useEffect, useMemo, useState } from "react";
import { Dropdown, Loader } from "@egovernments/digit-ui-components";

/**
 * StatusDropdownComponent — dynamic status filter.
 *
 * FormComposerV2 `type:"component"` contract: receives { config, onSelect } and
 * writes the selected value via onSelect(config.key, value).
 *
 * Unlike the inbox's `workflowstatesfilter` (checkboxes), this renders a single
 * dropdown. Options are the states of the configured BusinessService
 * (default "PGR"), fetched live from egov-workflow-v2 so a tenant's actual
 * workflow drives the list. Emits { code } where code is the state /
 * applicationStatus — the config preProcess maps it to `applicationStatus`.
 */
const StatusDropdownComponent = ({ config, onSelect, formData }) => {
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const [selected, setSelected] = useState(null);

  // Reset the dropdown when the form value is cleared (e.g. "Clear All").
  const boundValue = formData?.[config?.key];
  useEffect(() => {
    if (!boundValue && selected) setSelected(null);
  }, [boundValue]);

  const businessService = config?.populators?.businessService || "PGR";

  const { isLoading, data } = Digit.Hooks.useCustomAPIHook({
    url: "/egov-workflow-v2/egov-wf/businessservice/_search",
    params: { tenantId, businessServices: businessService },
    config: { enabled: true, cacheTime: 5 * 60 * 1000 },
  });

  const options = useMemo(() => {
    const states = data?.BusinessServices?.[0]?.states || [];
    const seen = {};
    return states
      .map((s) => s?.state)
      .filter((code) => code && !seen[code] && (seen[code] = true))
      .map((code) => {
        const key = `CS_COMMON_${code}`;
        const name = t(key) === key ? code : t(key);
        return { code, name };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, t]);

  if (isLoading) return <Loader />;

  return (
    <div className="status-dropdown-container">
      <Dropdown
        t={t}
        option={options}
        optionKey="name"
        selected={selected}
        select={(value) => {
          setSelected(value);
          if (config?.key) onSelect(config.key, value || null);
        }}
        placeholder={t("PGR_SELECT_STATUS")}
        label={t(config.label)}
      />
    </div>
  );
};

export default StatusDropdownComponent;
