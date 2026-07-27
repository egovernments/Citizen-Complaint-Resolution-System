import React, { useState } from "react";
import { CardLabel, Dropdown, FormStep } from "@egovernments/digit-ui-react-components";

const SelectComplaintType = ({ t, config, onSelect, value }) => {
  const [complaintType, setComplaintType] = useState(() => {
    const { complaintType } = value;
    return complaintType ? complaintType : {};
  });

  // A–Z sorted list of complaint types (sorting happens in the hook). The
  // Dropdown renders a searchable list so a citizen can type to filter rather
  // than scroll a long radio list (CCRS#941).
  const menu = Digit.Hooks.pgr.useComplaintTypes({ stateCode: Digit.ULBService.getCurrentTenantId() });

  function selectedValue(value) {
    setComplaintType(value);
  }

  const onSubmit = () => {
    onSelect({ complaintType });
  };

  const isDisabled = !complaintType || Object.keys(complaintType).length === 0;

  return (
    <FormStep config={config} onSelect={onSubmit} t={t} isDisabled={isDisabled}>
      <CardLabel>{t("CS_COMPLAINT_DETAILS_COMPLAINT_TYPE")}</CardLabel>
      <Dropdown isMandatory selected={complaintType} option={menu || []} select={selectedValue} optionKey="name" t={t} />
    </FormStep>
  );
};

export default SelectComplaintType;
