import React, { useState } from "react";
import { CardLabel, Dropdown, FormStep } from "@egovernments/digit-ui-react-components";

const SelectSubType = ({ t, config, onSelect, value }) => {
  const [subType, setSubType] = useState(() => {
    const { subType } = value;
    return subType ? subType : {};
  });
  const { complaintType } = value;

  // A–Z sorted sub-types (sorting happens in the hook), rendered as a
  // searchable Dropdown so the citizen can type to filter (CCRS#941).
  const menu = Digit.Hooks.pgr.useComplaintSubType(complaintType, t);

  function selectedValue(value) {
    setSubType(value);
  }

  const onSubmit = () => {
    onSelect({ subType });
  };

  const isDisabled = !subType || Object.keys(subType).length === 0;

  // Preserve the original behaviour of showing the chosen parent type as the
  // card caption above the sub-type picker.
  const configWithCaption = {
    ...config,
    texts: {
      ...config.texts,
      headerCaption: complaintType?.name || complaintType?.key,
    },
  };

  return (
    <FormStep config={configWithCaption} onSelect={onSubmit} t={t} isDisabled={isDisabled}>
      <CardLabel>{t("CS_COMPLAINT_DETAILS_SUB_COMPLAINT_TYPE")}</CardLabel>
      <Dropdown isMandatory selected={subType} option={menu || []} select={selectedValue} optionKey="name" t={t} />
    </FormStep>
  );
};

export default SelectSubType;
